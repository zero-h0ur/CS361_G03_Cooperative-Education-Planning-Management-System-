#!/usr/bin/env python3
"""Admin account maintenance through the owner-only Ops channel, never the runtime role."""
import argparse
import getpass
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ACCOUNT = '676101350279'
REGION = 'us-east-1'
API = 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com'
HOST = 'coed-postgres.cgpzlcmjvrji.us-east-1.rds.amazonaws.com'
CA_SHA = '90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b'


def read_private(path):
    source = Path(path)
    if source.is_symlink() or not source.is_file() or source.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_FILE_0600_REQUIRED')
    return source.read_bytes()


def approval_document(actor_id, request, now=None):
    return {'account': ACCOUNT, 'api': API, 'actor_id': str(uuid.UUID(actor_id)),
            'expires_at': int(time.time() if now is None else now) + 600,
            'request': validate(request)}


def approved_request(raw, expected_hash, now=None):
    if not re.fullmatch('[0-9a-f]{64}', expected_hash) or hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError('APPROVAL_HASH_MISMATCH')
    value = json.loads(raw)
    if set(value) != {'account', 'api', 'actor_id', 'expires_at', 'request'} or value['account'] != ACCOUNT or value['api'] != API:
        raise ValueError('APPROVAL_TARGET_MISMATCH')
    current = int(time.time() if now is None else now)
    if type(value['expires_at']) is not int or not current < value['expires_at'] <= current + 600:
        raise ValueError('APPROVAL_EXPIRED_PREPARE_AGAIN')
    return str(uuid.UUID(value['actor_id'])), validate(value['request'])


def validate(value):
    if not isinstance(value, dict) or set(value) != {'user_id', 'role', 'account_status', 'expected_version', 'operation_id', 'reason'}:
        raise ValueError('INVALID_REQUEST_FIELDS')
    for field in ('user_id', 'operation_id'):
        if str(uuid.UUID(value[field])) != value[field]:
            raise ValueError('INVALID_UUID')
    if value['role'] not in {'STUDENT', 'STAFF', 'ADVISOR', 'ADMIN'} or value['account_status'] not in {'ACTIVE', 'DISABLED'}:
        raise ValueError('INVALID_ROLE_OR_STATUS')
    if type(value['expected_version']) is not int or value['expected_version'] < 1:
        raise ValueError('INVALID_VERSION')
    if not isinstance(value['reason'], str) or not 1 <= len(value['reason'].strip()) <= 1000 or re.search(r'[\x00-\x1f\x7f]', value['reason']):
        raise ValueError('REASON_REQUIRED')
    return value


def statement(actor_id, value):
    validate(value)
    actor_id = str(uuid.UUID(actor_id))
    payload = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    literal = payload.replace("'", "''")
    return f"""BEGIN;
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
CREATE TEMP TABLE admin_result(value jsonb) ON COMMIT DROP;
DO $admin$
DECLARE b jsonb := '{literal}'::jsonb; actor uuid := '{actor_id}';
 target public.users%ROWTYPE; old public.workflow_receipts%ROWTYPE; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(b->>'operation_id',0));
 -- Serialize last-Admin protection and account changes in a fixed order.
 PERFORM id FROM public.users WHERE role='ADMIN' OR id=(b->>'user_id')::uuid ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND role='ADMIN' AND account_status='ACTIVE') THEN
   RAISE EXCEPTION 'Active Admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.workflow_receipts WHERE operation_id=(b->>'operation_id')::uuid;
 IF FOUND THEN
   IF old.actor_id<>actor OR old.action<>'admin:account_update' OR old.resource_id<>(b->>'user_id')::uuid OR old.request_hash<>'{digest}' THEN
     RAISE EXCEPTION 'Operation reuse' USING ERRCODE='23505'; END IF;
   INSERT INTO admin_result VALUES(old.result); RETURN;
 END IF;
 SELECT * INTO target FROM public.users WHERE id=(b->>'user_id')::uuid;
 IF NOT FOUND OR target.id=actor THEN RAISE EXCEPTION 'Invalid target/self change' USING ERRCODE='42501'; END IF;
 IF target.version<>(b->>'expected_version')::int THEN RAISE EXCEPTION 'Stale version' USING ERRCODE='40001'; END IF;
 IF target.role='ADMIN' AND (b->>'role'<>'ADMIN' OR b->>'account_status'<>'ACTIVE')
   AND (SELECT count(*) FROM public.users WHERE role='ADMIN' AND account_status='ACTIVE')<=1 THEN
   RAISE EXCEPTION 'Cannot remove last active Admin' USING ERRCODE='42501'; END IF;
 IF target.role<>b->>'role' AND (
   EXISTS(SELECT 1 FROM public.staff_scopes WHERE staff_id=target.id AND status='ACTIVE') OR
   EXISTS(SELECT 1 FROM public.advisor_assignments WHERE advisor_id=target.id AND status='ACTIVE' AND effective_to>CURRENT_TIMESTAMP)) THEN
   RAISE EXCEPTION 'Reconcile existing scopes/assignments first' USING ERRCODE='42501'; END IF;
 UPDATE public.users SET role=b->>'role',account_status=b->>'account_status',version=version+1,updated_at=CURRENT_TIMESTAMP
   WHERE id=target.id RETURNING jsonb_build_object('user_id',id,'role',role,'account_status',account_status,'version',version) INTO result;
 INSERT INTO public.workflow_receipts(operation_id,actor_id,action,resource_id,request_hash,result)
   VALUES((b->>'operation_id')::uuid,actor,'admin:account_update',target.id,'{digest}',result);
 INSERT INTO public.workflow_events(id,operation_id,actor_id,action,resource_id,detail)
   VALUES(gen_random_uuid(),(b->>'operation_id')::uuid,actor,'admin:account_update',target.id,
   jsonb_build_object('from_role',target.role,'to_role',b->>'role','from_status',target.account_status,'to_status',b->>'account_status','reason',b->>'reason','version',target.version+1));
 INSERT INTO admin_result VALUES(result);
END $admin$;
SELECT value FROM admin_result;
COMMIT;
"""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    import boto3
    from botocore.config import Config
    parser = argparse.ArgumentParser(description=__doc__)
    phases = parser.add_mutually_exclusive_group(required=True)
    phases.add_argument('--prepare', action='store_true', help='Normal CloudShell: authenticate Admin and prepare one request')
    phases.add_argument('--apply', action='store_true', help='VPC CloudShell: apply the hash-pinned approval within ten minutes')
    parser.add_argument('--request', help='Private 0600 account-change JSON, prepare phase only')
    parser.add_argument('--approval', required=True, help='Private 0600 approval file, never contains a token/password')
    parser.add_argument('--sha256', help='Exact approval hash printed by the trusted prepare phase')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise ValueError('INTERACTIVE_TERMINAL_REQUIRED')
    session = boto3.Session(region_name=REGION)
    cfg = Config(connect_timeout=5, read_timeout=20, retries={'total_max_attempts': 1})
    if args.prepare:
        if not args.request or args.sha256:
            raise ValueError('INVALID_PREPARE_ARGUMENTS')
        request = validate(json.loads(read_private(args.request)))
        if session.client('sts', config=cfg).get_caller_identity()['Account'] != ACCOUNT:
            raise ValueError('WRONG_AWS_ACCOUNT')
        token = getpass.getpass('Active Admin Access Token (hidden): ')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(urllib.request.Request(API + '/api/v3/me', headers={'Authorization': 'Bearer ' + token}), timeout=15) as response:
            trusted = json.loads(response.read(128000))['data']
        del token
        if trusted['role'] != 'ADMIN' or trusted['user']['accountStatus'] != 'ACTIVE':
            raise ValueError('ADMIN_SESSION_REQUIRED')
        raw = (json.dumps(approval_document(trusted['user']['id'], request), sort_keys=True) + '\n').encode()
        approval = Path(args.approval)
        if any((parent / '.git').exists() for parent in approval.absolute().parents):
            raise ValueError('APPROVAL_MUST_BE_OUTSIDE_REPOSITORY')
        with os.fdopen(os.open(approval, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
            handle.write(raw)
        print('APPROVAL SHA256: ' + hashlib.sha256(raw).hexdigest())
        print('Transfer through the private release bucket; pin this hash in VPC CloudShell. Approval expires in ten minutes. No DB write.')
        return
    if args.request or not args.sha256:
        raise ValueError('INVALID_APPLY_ARGUMENTS')
    raw = read_private(args.approval)
    actor_id, request = approved_request(raw, args.sha256)
    sql = statement(actor_id, request)
    password = getpass.getpass('Database owner password (hidden, not runtime/test-user password): ')
    ca = session.client('s3', config=cfg).get_object(Bucket='coed-v3-release-676101350279-20261019', Key='release/global-bundle.pem', ExpectedBucketOwner=ACCOUNT)['Body'].read()
    if hashlib.sha256(ca).hexdigest() != CA_SHA:
        raise ValueError('CA_HASH_MISMATCH')
    # Owner authentication and the hash copied from --prepare are the Ops trust
    # boundary. VPC CloudShell has S3 access, but no STS or public API endpoint.
    approved_request(raw, args.sha256)
    with tempfile.TemporaryDirectory(prefix='coed-admin-ca-') as folder:
        ca_path = Path(folder) / 'ca.pem'; ca_path.write_bytes(ca)
        conn = f'host={HOST} port=5432 dbname=coed user=postgres sslmode=verify-full sslrootcert={ca_path} connect_timeout=10'
        result = subprocess.run(['psql', conn, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-f', '-'],
                                input=sql, text=True, capture_output=True, timeout=35,
                                env=dict(os.environ, PGPASSWORD=password))
    if result.returncode:
        raise ValueError('TRANSACTION_FAILED_CHECK_STATE_BEFORE_RETRY')
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    if len(rows) != 1:
        raise ValueError('OUTCOME_REQUIRES_OPERATOR_REVIEW')
    print(json.dumps(rows[0]))
    print('Account operation verified; no Student/Plan decisions, identity links, scopes or grants changed.')


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.CRITICAL)
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
        print('STOP: ' + code + '; credentials and raw responses withheld.', file=sys.stderr)
        sys.exit(1)
