#!/usr/bin/env python3
"""VPC CloudShell operator: bounded INSERT-only fixtures; no raw identity/error output."""
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

ACCOUNT = '676101350279'
REGION = 'us-east-1'
BUCKET = 'coed-v3-release-676101350279-20261019'
PREFIX = 'release/smoke83/'
IDENTITY_SHA = '13cd5694a56ba081fe1591bd6310494a9fa9cb7ca61dc69bf35798c5f1e66519'
SQL_SHA = '87b7c110b253a936bb557b05017633fb4a57ed3801ec5d2779e929071ef795da'
CA_SHA = '90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b'
POOL = 'us-east-1_WzzG10dCP'
HOST = 'coed-postgres.cgpzlcmjvrji.us-east-1.rds.amazonaws.com'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def read_verified(s3, key, expected):
    result = s3.get_object(Bucket=BUCKET, Key=key, ExpectedBucketOwner=ACCOUNT)
    stream = result['Body']
    try:
        value = stream.read(2 * 1024 * 1024 + 1)
    finally:
        stream.close()
    require(len(value) <= 2 * 1024 * 1024, 'INPUT_TOO_LARGE')
    require(hashlib.sha256(value).hexdigest() == expected, 'INPUT_HASH_MISMATCH')
    return value


def validate_identity(value):
    require(isinstance(value, dict) and set(value) ==
            {'email', 'user_pool_id', 'username', 'sub', 'issuer', 'fixture_marker'}, 'IDENTITY_SCHEMA_MISMATCH')
    require(value['email'] == 'advisor-preview-83@advisor.example.com'
            and value['user_pool_id'] == POOL
            and value['issuer'] == 'https://cognito-idp.us-east-1.amazonaws.com/' + POOL
            and value['fixture_marker'] == 'CO-ED synthetic Advisor smoke 83', 'IDENTITY_TARGET_MISMATCH')
    require(isinstance(value['sub'], str) and bool(re.fullmatch(
        r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', value['sub'])), 'IDENTITY_SUBJECT_INVALID')
    require(isinstance(value['username'], str) and 1 <= len(value['username']) <= 128
            and value['username'] == value['username'].strip(), 'IDENTITY_USERNAME_INVALID')
    return value['sub']


def validate_summary(value):
    expected = {'AdvisorRole': 'ADVISOR', 'IdentityStatus': 'ACTIVE', 'AssignedStudents': 3,
                'PrivateFixtureStudents': 4, 'PrivateFixturePlans': 4, 'AssignmentDays': 7,
                'ExistingRowsUnchanged': True, 'DemoPlansTouched': False}
    require(isinstance(value, dict) and set(value) == set(expected) | {'FixturePlanStates'},
            'DB_COMMITTED_UNEXPECTED_SUMMARY')
    require(all(value[key] == wanted for key, wanted in expected.items()), 'DB_COMMITTED_UNEXPECTED_SUMMARY')
    states = value['FixturePlanStates']
    require(isinstance(states, list) and len(states) == 4, 'DB_COMMITTED_UNEXPECTED_SUMMARY')
    require({row.get('Case') for row in states if isinstance(row, dict)} ==
            {'SMOKE830001', 'SMOKE830002', 'SMOKE830003', 'SMOKE830004'}, 'DB_COMMITTED_UNEXPECTED_SUMMARY')
    for row in states:
        require(set(row) == {'Case', 'State', 'Version'}
                and row['State'] in {'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'APPROVED', 'CANCELLED'}
                and type(row['Version']) is int and row['Version'] >= 1, 'DB_COMMITTED_UNEXPECTED_SUMMARY')
    return value


def provision(s3, prompt, run=subprocess.run, interactive=False):
    require(interactive, 'INTERACTIVE_VPC_CLOUDSHELL_REQUIRED')
    print('[1/3] Read hash-pinned private identity, SQL template and RDS CA; no identity values printed.')
    identity = json.loads(read_verified(s3, PREFIX + 'coed-advisor83-identity.json', IDENTITY_SHA))
    subject = validate_identity(identity)
    sql = read_verified(s3, PREFIX + 'coed-provision83.sql', SQL_SHA).decode('utf-8')
    require(sql.count('__ADVISOR_SUB__') == 1, 'SQL_TEMPLATE_INVALID')
    ca = read_verified(s3, 'release/global-bundle.pem', CA_SHA)
    print('[2/3] Check private RDS reachability from VPC CloudShell.')
    ready = run(['pg_isready', '-h', HOST, '-p', '5432', '-t', '5'],
                text=True, capture_output=True, timeout=8)
    require(ready.returncode == 0, 'RDS_NOT_READY_USE_COED_DB_VIEWER_VPC_CLOUDSHELL')
    password = prompt('RDS postgres password (hidden; NOT Advisor password): ')
    require(bool(password), 'EMPTY_DB_PASSWORD')
    print('[3/3] Apply/verify isolated fixtures atomically; no existing role/scope/demo content is changed.')
    with tempfile.TemporaryDirectory(prefix='coed-smoke83-ca-') as folder:
        ca_path = Path(folder) / 'global-bundle.pem'
        descriptor = os.open(ca_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(ca)
        connection = (f'host={HOST} port=5432 dbname=coed user=postgres '
                      f'sslmode=verify-full sslrootcert={ca_path} connect_timeout=10')
        result = run(['psql', connection, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
                      '-v', 'VERBOSITY=sqlstate', '-f', '-'],
                     input=sql.replace('__ADVISOR_SUB__', subject), text=True,
                     env=dict(os.environ, PGPASSWORD=password), capture_output=True, timeout=55)
    if result.returncode != 0:
        state = re.search(r'ERROR:\s+([A-Z0-9]{5})\b', result.stderr or '')
        raise RuntimeError('PSQL_FAILED_' + (state.group(1) if state else 'NO_SQLSTATE'))
    rows = [row for row in result.stdout.splitlines() if row.startswith('{')]
    require(len(rows) == 1, 'DB_COMMITTED_UNEXPECTED_SUMMARY')
    summary = validate_summary(json.loads(rows[0]))
    print(json.dumps(summary, indent=2))
    print('ADVISOR LINK + THREE LIMITED ASSIGNMENTS VERIFIED; FOUR ISOLATED STUDENT/PLAN FIXTURES READY.')
    print('No existing account role, Staff scope, demo Plan, credential, schema, IAM or deployment was changed.')


def main():
    import boto3
    from botocore.config import Config
    logging.getLogger().setLevel(logging.CRITICAL)
    s3 = boto3.Session(region_name=REGION).client('s3', config=Config(
        connect_timeout=5, read_timeout=20, retries={'total_max_attempts': 2}))
    provision(s3, getpass.getpass, interactive=sys.stdin.isatty() and sys.stderr.isatty())


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('STOP: interrupted; no credential printed. Transaction outcome must be checked before retrying.', file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        aws_code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Z0-9_]+', str(error)):
            code = str(error)
        elif aws_code and re.fullmatch(r'[A-Za-z0-9_]+', str(aws_code)):
            code = 'AWS_' + str(aws_code)
        else:
            code = type(error).__name__
        print('STOP: ' + code + '; raw SQL/identity/credential/error details withheld.', file=sys.stderr)
        print('No success is claimed. If a connection ended at COMMIT, use this idempotent helper again; never reset fixtures or roles.', file=sys.stderr)
        sys.exit(1)
