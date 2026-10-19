#!/usr/bin/env python3
"""Read-only VPC RDS checkpoint before/after #83 denial probes; no raw DB values."""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ACCOUNT = '676101350279'
REGION = 'us-east-1'
BUCKET = 'coed-v3-release-676101350279-20261019'
HOST = 'coed-postgres.cgpzlcmjvrji.us-east-1.rds.amazonaws.com'
CA_SHA = '90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b'
TABLES = {'users': 'id', 'students': 'id', 'plans': 'id', 'rounds': 'id',
          'external_identity_links': 'id', 'advisor_assignments': 'id', 'staff_scopes': 'id',
          'audit_events': 'event_id', 'plan_operations': 'operation_id',
          'companies': 'id', 'positions': 'id'}
PREFIX = '83000000-0000-4000-8000-'
PLAN_IDS = tuple(PREFIX + f'{n:012d}' for n in (13, 23, 33, 43))
STUDENT_IDS = tuple(PREFIX + f'{n:012d}' for n in (12, 22, 32, 42))
INITIAL_STATES = ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'DRAFT')
STATES = set(INITIAL_STATES) | {'NEEDS_REVISION', 'APPROVED', 'CANCELLED'}
BASELINE = 'coed-db83-baseline.json'


class Stop(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Stop(code)


def id_list(values):
    # Only module-owned constant UUIDs; never operator input or identity subjects.
    return ','.join("'" + value + "'::uuid" for value in values)


TABLE_SQL = ','.join(
    "'%s',(SELECT jsonb_build_object('rows',count(*),'fingerprint',"
    "md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s)::text,'[]'))) FROM public.%s t)"
    % (table, key, table) for table, key in TABLES.items())
SQL = """
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog, public;
SELECT jsonb_build_object(
 'guards',jsonb_build_object(
  'database',current_database()='coed',
  'operator',current_user='postgres',
  'readOnly',current_setting('transaction_read_only')='on',
  'migration',EXISTS(SELECT 1 FROM public.schema_migrations
    WHERE version='002_v3_identity_student_plan_assignment_audit.sql'
    AND checksum='abf94231966248045543d736e3ab745359693c93f082317990489902e1e7484c'),
  'fixtureStudents',(SELECT count(*)=4 FROM public.students WHERE id IN (__STUDENT_IDS__)
    AND source='coed-v3-smoke83-v1' AND visibility='private' AND data_status='mock'),
  'fixturePlans',(SELECT count(*)=4 FROM public.plans WHERE id IN (__PLAN_IDS__)
    AND source='coed-v3-smoke83-v1' AND visibility='private' AND data_status='mock'),
  'advisor',EXISTS(SELECT 1 FROM public.users u JOIN public.external_identity_links e ON e.user_id=u.id
    WHERE u.id='83000000-0000-4000-8000-000000000001' AND u.role='ADVISOR'
    AND u.account_status='ACTIVE' AND e.id='83000000-0000-4000-8000-000000000002' AND e.status='ACTIVE'),
  'assignments',(SELECT count(*)=3 AND count(*) FILTER(WHERE status='ACTIVE'
    AND effective_from<=CURRENT_TIMESTAMP AND effective_to>CURRENT_TIMESTAMP
    AND student_id IN (__ASSIGNED_IDS__))=3 FROM public.advisor_assignments
    WHERE advisor_id='83000000-0000-4000-8000-000000000001'),
  'roundOpen',EXISTS(SELECT 1 FROM public.rounds
    WHERE id='83000000-0000-4000-8000-000000000090' AND status='OPEN' AND end_date>CURRENT_TIMESTAMP)
 ),
 'tables',jsonb_build_object(__TABLE_SQL__),
 'fixturePlans',(SELECT jsonb_agg(jsonb_build_object(
    'case',s.student_number,'state',p.status,'version',p.version,
    'auditRows',(SELECT count(*) FROM public.audit_events a WHERE a.plan_id=p.id OR a.resource_id=p.id),
    'operationRows',(SELECT count(*) FROM public.plan_operations o WHERE o.plan_id=p.id)
  ) ORDER BY p.id) FROM public.plans p JOIN public.students s ON s.id=p.student_id WHERE p.id IN (__PLAN_IDS__))
);
ROLLBACK;
""".replace('__STUDENT_IDS__', id_list(STUDENT_IDS)).replace('__PLAN_IDS__', id_list(PLAN_IDS)) \
    .replace('__ASSIGNED_IDS__', id_list(STUDENT_IDS[:3])).replace('__TABLE_SQL__', TABLE_SQL)


def validate_snapshot(value, initial=False):
    require(isinstance(value, dict) and set(value) == {'guards', 'tables', 'fixturePlans'}, 'SNAPSHOT_SCHEMA_INVALID')
    guards = value['guards']
    require(isinstance(guards, dict) and set(guards) == {'database', 'operator', 'readOnly', 'migration',
            'fixtureStudents', 'fixturePlans', 'advisor', 'assignments', 'roundOpen'}
            and all(item is True for item in guards.values()), 'DATABASE_OR_FIXTURE_GUARD_FAILED')
    require(isinstance(value['tables'], dict) and set(value['tables']) == set(TABLES), 'TABLE_SET_INVALID')
    for row in value['tables'].values():
        require(isinstance(row, dict) and set(row) == {'rows', 'fingerprint'}
                and type(row['rows']) is int and row['rows'] >= 0
                and isinstance(row['fingerprint'], str) and bool(re.fullmatch(r'[0-9a-f]{32}', row['fingerprint'])),
                'TABLE_FINGERPRINT_INVALID')
    plans = value['fixturePlans']
    require(isinstance(plans, list) and len(plans) == 4, 'FIXTURE_PLAN_SET_INVALID')
    for index, plan in enumerate(plans):
        require(isinstance(plan, dict) and set(plan) == {'case', 'state', 'version', 'auditRows', 'operationRows'}
                and plan['case'] == f'SMOKE83{index + 1:04d}' and plan['state'] in STATES
                and all(type(plan[key]) is int and plan[key] >= (1 if key == 'version' else 0)
                        for key in ('version', 'auditRows', 'operationRows')), 'FIXTURE_PLAN_VALUES_INVALID')
        if initial:
            require(plan['state'] == INITIAL_STATES[index] and plan['version'] == 1
                    and plan['auditRows'] == 1 and plan['operationRows'] == 0,
                    'INITIAL_FIXTURE_BASELINE_CHANGED_STOP_DO_NOT_RESET')
    return value


def read_snapshot(s3, prompt, run=subprocess.run):
    result = s3.get_object(Bucket=BUCKET, Key='release/global-bundle.pem', ExpectedBucketOwner=ACCOUNT)
    stream = result['Body']
    try:
        ca = stream.read(1024 * 1024 + 1)
    finally:
        stream.close()
    require(hashlib.sha256(ca).hexdigest() == CA_SHA, 'CA_HASH_MISMATCH')
    ready = run(['pg_isready', '-h', HOST, '-p', '5432', '-t', '5'],
                text=True, capture_output=True, timeout=8)
    require(ready.returncode == 0, 'RDS_NOT_READY_USE_VPC_CLOUDSHELL_AND_RETRY_SAME_COMMAND')
    password = prompt('RDS postgres password (hidden; NOT a test-user password): ')
    require(bool(password), 'EMPTY_PASSWORD')
    with tempfile.TemporaryDirectory(prefix='coed-db83-ca-') as folder:
        ca_path = Path(folder) / 'global-bundle.pem'
        descriptor = os.open(ca_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(ca)
        connection = (f'host={HOST} port=5432 dbname=coed user=postgres '
                      f'sslmode=verify-full sslrootcert={ca_path} connect_timeout=10')
        output = run(['psql', connection, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
                      '-v', 'VERBOSITY=sqlstate', '-f', '-'], input=SQL,
                     env=dict(os.environ, PGPASSWORD=password), text=True, capture_output=True, timeout=35)
    password = None
    require(output.returncode == 0, 'READ_ONLY_SQL_FAILED_DETAILS_WITHHELD')
    try:
        return validate_snapshot(json.loads(output.stdout))
    except Stop:
        raise
    except Exception:
        raise Stop('SNAPSHOT_JSON_INVALID_VALUES_WITHHELD') from None


def read_baseline(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 65536,
                'BASELINE_FILE_PERMISSIONS_OR_TYPE_INVALID')
        value = json.load(handle)
    require(isinstance(value, dict) and set(value) == {'format', 'host', 'capturedUTC', 'snapshot'}
            and value['format'] == 'coed-smoke83-readonly-v1' and value['host'] == HOST,
            'BASELINE_TARGET_INVALID')
    require(isinstance(value['capturedUTC'], str) and bool(re.fullmatch(
        r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00', value['capturedUTC'])),
        'BASELINE_TIMESTAMP_INVALID')
    datetime.fromisoformat(value['capturedUTC'])
    validate_snapshot(value['snapshot'], initial=True)
    return value


def checkpoint(mode, path, fetch, interactive=False):
    require(interactive, 'INTERACTIVE_VPC_CLOUDSHELL_REQUIRED')
    path = Path(path)
    require(mode in ('capture', 'verify'), 'MODE_INVALID')
    require(path.name == BASELINE, 'BASELINE_FILENAME_INVALID')
    if mode == 'capture':
        require(not path.exists() and not path.is_symlink(), 'BASELINE_ALREADY_EXISTS_USE_VERIFY_DO_NOT_OVERWRITE')
        baseline = None
    else:
        baseline = read_baseline(path)
    snapshot = fetch()
    validate_snapshot(snapshot, initial=mode == 'capture')
    now = datetime.now(timezone.utc).isoformat()
    if mode == 'capture':
        document = {'format': 'coed-smoke83-readonly-v1', 'host': HOST, 'capturedUTC': now, 'snapshot': snapshot}
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(document, handle, sort_keys=True, indent=2)
            handle.write('\n')
        print('BASELINE CAPTURED: 11 table counts/fingerprints; four fixture Plans; read-only transaction.')
        print('Private baseline file (0600): ' + str(path.absolute()))
        print('Keep this file in VPC CloudShell; do not edit, upload publicly or commit it.')
    else:
        before = baseline['snapshot']
        changed = [table for table in TABLES if before['tables'][table] != snapshot['tables'][table]]
        if changed:
            print('Changed tables (values withheld): ' + ', '.join(changed))
        require(not changed and before['fixturePlans'] == snapshot['fixturePlans'],
                'DATABASE_DIFFERENCE_FOUND_STOP_REVIEW_NO_RESET_OR_RECAPTURE')
        print('DATABASE UNCHANGED VERIFIED: all 11 table counts/fingerprints and four fixture summaries match.')
        print('BaselineCapturedUTC: ' + baseline['capturedUTC'])
    print('CheckedUTC: ' + now)
    # Validated synthetic-only summaries; no names, emails, subjects or raw hashes.
    print(json.dumps({'FixturePlans': snapshot['fixturePlans']}, indent=2))
    print('No DB writes, migrations, roles, credentials, schema, IAM or deployment changed by this helper.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['capture', 'verify'])
    args = parser.parse_args()
    require(sys.stdin.isatty() and sys.stderr.isatty(), 'INTERACTIVE_VPC_CLOUDSHELL_REQUIRED')
    import boto3
    from botocore.config import Config
    logging.getLogger().setLevel(logging.CRITICAL)
    s3 = boto3.Session(region_name=REGION).client('s3', config=Config(
        connect_timeout=5, read_timeout=20, retries={'total_max_attempts': 2}))
    checkpoint(args.mode, BASELINE, lambda: read_snapshot(s3, getpass.getpass), interactive=True)


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('STOP: INPUT_CANCELLED; keep any existing baseline unchanged.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('STOP: CHECKPOINT_FAILED_VALUES_WITHHELD; no success claimed; keep existing baseline.', file=sys.stderr)
        sys.exit(1)
