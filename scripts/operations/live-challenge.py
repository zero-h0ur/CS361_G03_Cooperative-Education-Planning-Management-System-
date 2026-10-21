#!/usr/bin/env python3
"""Provision isolated, owner-authorized Live Challenge identities and DB fixtures.

identities runs in normal CloudShell; database runs in VPC CloudShell after migrations.
Credentials stay in a private file and hidden prompts, never command arguments/output.
"""
import argparse
import getpass
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import uuid

ACCOUNT = '676101350279'
REGION = 'us-east-1'
POOL = 'us-east-1_WzzG10dCP'
ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/' + POOL
BUCKET = 'coed-v3-release-676101350279-20261019'
HOST = 'coed-postgres.cgpzlcmjvrji.us-east-1.rds.amazonaws.com'
MARKER = 'CO-ED Live Challenge 135 synthetic'
NAMESPACE = uuid.UUID('a17c7d0d-4b8b-4c82-9bcf-27b1db59c134')
CA_SHA = '90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b'


def fixed(label):
    return str(uuid.uuid5(NAMESPACE, label))


def roster():
    roles = [('student1', 'STUDENT'), ('student2', 'STUDENT'), ('student3', 'STUDENT'),
             ('staff', 'STAFF'), ('advisor1', 'ADVISOR'), ('advisor2', 'ADVISOR'), ('admin', 'ADMIN')]
    return [{'key': key, 'role': role, 'email': f'challenge135-{key}@example.com',
             'user_id': fixed('user:' + key), 'link_id': fixed('link:' + key),
             **({'student_id': fixed('student:' + key), 'student_number': 'LIVE135000' + key[-1]} if role == 'STUDENT' else {})}
            for key, role in roles]


def private_file(path, value, create=False):
    if any((parent / '.git').exists() for parent in path.absolute().parents):
        raise ValueError('CREDENTIAL_FILE_MUST_BE_OUTSIDE_REPOSITORY')
    if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_mode & 0o077)):
        raise ValueError('PRIVATE_FILE_0600_REQUIRED')
    if create:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        temporary = None
    else:
        descriptor, temporary = tempfile.mkstemp(prefix='.coed135-private-', dir=path.parent)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump(value, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    if temporary:
        os.replace(temporary, path)


def identities(client, path):
    if not path.exists():
        value = {'marker': MARKER, 'issuer': ISSUER, 'accounts':
                 [{**row, 'password': secrets.token_urlsafe(24) + 'aA1!'} for row in roster()]}
        private_file(path, value, create=True)
    else:
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError('PRIVATE_FILE_0600_REQUIRED')
        value = json.loads(path.read_text())
    if value.get('marker') != MARKER or value.get('issuer') != ISSUER or len(value.get('accounts', [])) != 7:
        raise ValueError('PRIVATE_IDENTITY_FILE_MISMATCH')
    for row, expected in zip(value['accounts'], roster()):
        if any(row.get(key) != wanted for key, wanted in expected.items()):
            raise ValueError('IDENTITY_ROSTER_MISMATCH')
        try:
            current = client.admin_get_user(UserPoolId=POOL, Username=row['email'])
        except Exception as error:
            if getattr(error, 'response', {}).get('Error', {}).get('Code') != 'UserNotFoundException':
                raise
            row['create_intent'] = True
            private_file(path, value)
            client.admin_create_user(UserPoolId=POOL, Username=row['email'], MessageAction='SUPPRESS',
                                     TemporaryPassword=row['password'], UserAttributes=[
                                         {'Name': 'email', 'Value': row['email']}, {'Name': 'email_verified', 'Value': 'true'},
                                         {'Name': 'name', 'Value': MARKER + ' ' + row['key']}])
            current = client.admin_get_user(UserPoolId=POOL, Username=row['email'])
        attrs = {item['Name']: item['Value'] for item in current['UserAttributes']}
        if attrs.get('name') != MARKER + ' ' + row['key'] or attrs.get('email') != row['email'] or current.get('Enabled') is not True:
            raise ValueError('EXISTING_IDENTITY_NOT_OWNED_BY_CHALLENGE')
        subject = str(uuid.UUID(attrs['sub']))
        if not row.get('sub') and row.get('create_intent') is not True:
            raise ValueError('RESTORE_ORIGINAL_PRIVATE_FILE_NO_PASSWORD_RESET')
        if row.get('sub') and row['sub'] != subject:
            raise ValueError('SUBJECT_CHANGED_DO_NOT_RECREATE')
        row['sub'] = subject
        private_file(path, value)
        if current['UserStatus'] == 'FORCE_CHANGE_PASSWORD':
            client.admin_set_user_password(UserPoolId=POOL, Username=current['Username'], Password=row['password'], Permanent=True)
        elif current['UserStatus'] != 'CONFIRMED':
            raise ValueError('UNEXPECTED_COGNITO_STATUS')
        verified = client.admin_get_user(UserPoolId=POOL, Username=row['email'])
        if verified['UserStatus'] != 'CONFIRMED':
            raise ValueError('IDENTITY_NOT_CONFIRMED')
    print('Seven synthetic Cognito identities CONFIRMED; no invitations or existing-account resets.')
    print('Private credentials file (0600): ' + str(path))
    print('DB links/roles and real Login smoke are separate gates; not yet demo-ready.')
    return value


def public_manifest(value):
    if value.get('marker') != MARKER or value.get('issuer') != ISSUER:
        raise ValueError('IDENTITY_MANIFEST_MISMATCH')
    accounts = value.get('accounts', [])
    if len(accounts) != 7:
        raise ValueError('IDENTITY_ROSTER_MISMATCH')
    result = []
    for row, expected in zip(accounts, roster()):
        if any(row.get(key) != wanted for key, wanted in expected.items()):
            raise ValueError('IDENTITY_ROSTER_MISMATCH')
        result.append({**expected, 'sub': str(uuid.UUID(row['sub']))})
    return {'marker': MARKER, 'issuer': ISSUER, 'accounts': result}


def provisioning_sql(value):
    manifest = public_manifest(value)
    body = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    digest = hashlib.sha256(body.encode()).hexdigest()
    literal = body.replace("'", "''")
    cycle = fixed('round')
    operation = fixed('provision-operation')
    admin_id = fixed('user:admin')
    staff_id = fixed('user:staff')
    tables = ['users', 'external_identity_links', 'students', 'plans', 'advisor_assignments', 'staff_scopes',
              'rounds', 'companies', 'positions', 'document_policies', 'plan_submissions', 'placements',
              'workflow_receipts', 'workflow_events', 'audit_events', 'plan_operations']
    keys = {'placements': 'plan_id', 'workflow_receipts': 'operation_id', 'plan_operations': 'operation_id', 'audit_events': 'event_id'}
    before = ' UNION ALL '.join(f"SELECT '{table}' AS table_name,{keys.get(table,'id')}::text AS row_id,md5(to_jsonb(t)::text) AS fingerprint FROM public.{table} t" for table in tables)
    checks = '\n'.join(f"IF EXISTS(SELECT 1 FROM challenge_before b LEFT JOIN public.{table} t ON t.{keys.get(table,'id')}::text=b.row_id WHERE b.table_name='{table}' AND (t IS NULL OR md5(to_jsonb(t)::text)<>b.fingerprint)) THEN RAISE EXCEPTION 'Existing records changed' USING ERRCODE='23514'; END IF;" for table in tables)
    return f"""BEGIN;
SET LOCAL search_path=pg_catalog,public; SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('coed-live-challenge-135',0));
CREATE TEMP TABLE challenge_before ON COMMIT DROP AS {before};
CREATE TEMP TABLE challenge_result(value jsonb) ON COMMIT DROP;
DO $fixture$
DECLARE b jsonb := '{literal}'::jsonb; a jsonb; old public.workflow_receipts%ROWTYPE;
BEGIN
 IF current_database()<>'coed' AND current_database()<>'coed_v3_test' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='008_returned_plan_cancellation.sql') THEN RAISE EXCEPTION 'Migrations must precede provisioning'; END IF;
 SELECT * INTO old FROM public.workflow_receipts WHERE operation_id='{operation}';
 IF FOUND THEN
   IF old.request_hash<>'{digest}' OR old.actor_id<>'{admin_id}' OR old.action<>'ops:challenge_provision' THEN RAISE EXCEPTION 'Fixture receipt mismatch'; END IF;
   INSERT INTO challenge_result VALUES(old.result); RETURN;
 END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(b->'accounts') LOOP
   IF EXISTS(SELECT 1 FROM public.users WHERE id=(a->>'user_id')::uuid)
     OR EXISTS(SELECT 1 FROM public.external_identity_links WHERE external_issuer=b->>'issuer' AND external_subject=a->>'sub') THEN
     RAISE EXCEPTION 'Fixture collision; no existing account changed'; END IF;
   INSERT INTO public.users(id,role,display_name) VALUES((a->>'user_id')::uuid,a->>'role','Live Challenge '||(a->>'key'));
   INSERT INTO public.external_identity_links(id,user_id,external_issuer,external_subject)
     VALUES((a->>'link_id')::uuid,(a->>'user_id')::uuid,b->>'issuer',a->>'sub');
   IF a->>'role'='STUDENT' THEN
     INSERT INTO public.students(id,anonymous_ref,source,visibility,data_status,user_id,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status)
       VALUES((a->>'student_id')::uuid,a->>'student_number','{MARKER}','private','mock',(a->>'user_id')::uuid,
       a->>'student_number','Synthetic '||(a->>'key'),a->>'email','CPE','CS','CS',2569,'ACTIVE');
   END IF;
 END LOOP;
 INSERT INTO public.staff_scopes(id,staff_id,department,program,academic_year)
   VALUES('{fixed('staff-scope')}','{staff_id}','CPE','CS',2569);
 INSERT INTO public.rounds(id,name,academic_year,semester,status,end_date,source,visibility,data_status)
   VALUES('{cycle}','Live Challenge 135 — synthetic',2569,2,'OPEN',CURRENT_TIMESTAMP+interval '90 days','{MARKER}','public','mock');
 INSERT INTO public.document_policies(id,cycle_id,department,program,version,requirements,published_by)
   VALUES('{fixed('policy')}','{cycle}','CPE','CS',1,
   '[{{"id":"cv","title":"Synthetic CV reference","required":true,"format":"pdf","filename_pattern":"{{student_number}}_cv.pdf"}}]'::jsonb,'{staff_id}');
 IF (SELECT count(*) FROM public.students WHERE source='{MARKER}')<>3 OR
   EXISTS(SELECT 1 FROM public.plans p JOIN public.students s ON s.id=p.student_id WHERE s.source='{MARKER}') THEN
   RAISE EXCEPTION 'New challenge Students must start without Plans'; END IF;
 {checks}
 INSERT INTO public.workflow_receipts(operation_id,actor_id,action,resource_id,request_hash,result)
   VALUES('{operation}','{admin_id}','ops:challenge_provision','{cycle}','{digest}',
   '{{"accounts":7,"students":3,"advisors":2,"staff":1,"admins":1,"initial_plans":0,"existing_rows_unchanged":true}}');
 INSERT INTO public.workflow_events(id,operation_id,actor_id,action,resource_id,detail)
   VALUES('{fixed('provision-event')}','{operation}','{admin_id}','ops:challenge_provision','{cycle}','{{"source":"synthetic","initial_plans":0}}');
 INSERT INTO challenge_result SELECT result FROM public.workflow_receipts WHERE operation_id='{operation}';
END $fixture$;
SELECT value FROM challenge_result;
COMMIT;
"""


def main():
    import boto3
    from botocore.config import Config
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['identities', 'database', 'export-manifest'])
    parser.add_argument('--private-file', default='coed-live135-private.json')
    parser.add_argument('--manifest', default='coed-live135-identities.json')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise ValueError('INTERACTIVE_CLOUDSHELL_REQUIRED')
    session = boto3.Session(region_name=REGION)
    config = Config(connect_timeout=5, read_timeout=20, retries={'total_max_attempts': 1})
    path = Path(args.private_file).absolute()
    if args.phase == 'identities':
        if session.client('sts', config=config).get_caller_identity()['Account'] != ACCOUNT:
            raise ValueError('WRONG_AWS_ACCOUNT')
        identities(session.client('cognito-idp', config=config), path)
        return
    if args.phase == 'export-manifest':
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError('PRIVATE_FILE_0600_REQUIRED')
        manifest = public_manifest(json.loads(path.read_text()))
        output = Path(args.manifest).absolute()
        private_file(output, manifest, create=True)
        print('Private identity metadata exported without passwords: ' + str(output))
        return
    manifest_path = Path(args.manifest)
    if manifest_path.is_symlink() or manifest_path.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_MANIFEST_0600_REQUIRED')
    sql = provisioning_sql(json.loads(manifest_path.read_text()))
    ca = session.client('s3', config=config).get_object(Bucket=BUCKET, Key='release/global-bundle.pem', ExpectedBucketOwner=ACCOUNT)['Body'].read()
    if hashlib.sha256(ca).hexdigest() != CA_SHA:
        raise ValueError('CA_HASH_MISMATCH')
    password = getpass.getpass('RDS owner password (hidden; not a test-account password): ')
    with tempfile.TemporaryDirectory(prefix='coed-live135-ca-') as folder:
        ca_path = Path(folder) / 'ca.pem'; ca_path.write_bytes(ca)
        conn = f'host={HOST} port=5432 dbname=coed user=postgres sslmode=verify-full sslrootcert={ca_path} connect_timeout=10'
        result = subprocess.run(['psql', conn, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-f', '-'],
                                input=sql, text=True, capture_output=True, timeout=45, env=dict(os.environ, PGPASSWORD=password))
    if result.returncode:
        raise ValueError('PROVISION_TRANSACTION_FAILED_CHECK_BEFORE_RETRY')
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    if len(rows) != 1:
        raise ValueError('PROVISION_OUTCOME_NOT_VERIFIED')
    print(json.dumps(rows[0]))
    print('Database fixture provision verified. Real Managed Login and API smoke still required.')


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.CRITICAL)
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
        print('STOP: ' + code + '; raw SQL, identities and credentials withheld. Do not delete/reset/recreate accounts.', file=sys.stderr)
        sys.exit(1)
