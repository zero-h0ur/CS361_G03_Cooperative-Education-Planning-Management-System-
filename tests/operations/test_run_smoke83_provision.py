import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('provision83', ROOT / 'scripts/operations/run-smoke83-provision.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
FAKE_SUB = '00000000-0000-4000-8000-000000000083'
FAKE_DB_PASSWORD = 'LOCAL-UNIT-ONLY-NOT-A-CREDENTIAL'


class Cloud:
    def __init__(self):
        self.identity = {'email': 'advisor-preview-83@advisor.example.com', 'user_pool_id': operator.POOL,
                         'username': 'synthetic-canonical-username', 'sub': FAKE_SUB,
                         'issuer': 'https://cognito-idp.us-east-1.amazonaws.com/' + operator.POOL,
                         'fixture_marker': 'CO-ED synthetic Advisor smoke 83'}
        self.sql = "SET LOCAL coed.smoke83.advisor_sub = '__ADVISOR_SUB__';"
        self.ca = b'PUBLIC-TEST-CA'
        self.requests = []; self.processes = []; self.prompts = []
        self.ready = True; self.psql_error = None; self.extra_summary = False
    def blob(self, key):
        if key.endswith('identity.json'):
            return json.dumps(self.identity).encode()
        if key.endswith('.sql'):
            return self.sql.encode()
        return self.ca
    def get_object(self, **kwargs):
        assert kwargs['Bucket'] == operator.BUCKET and kwargs['ExpectedBucketOwner'] == operator.ACCOUNT
        self.requests.append(kwargs['Key'])
        return {'Body': io.BytesIO(self.blob(kwargs['Key']))}
    def prompt(self, label):
        self.prompts.append(label)
        return FAKE_DB_PASSWORD
    def run(self, args, **kwargs):
        self.processes.append(args[0])
        if args[0] == 'pg_isready':
            return types.SimpleNamespace(returncode=0 if self.ready else 2)
        assert args[0] == 'psql'
        assert FAKE_SUB not in ' '.join(args) and FAKE_DB_PASSWORD not in ' '.join(args)
        assert 'dbname=coed user=postgres' in args[1] and 'sslmode=verify-full' in args[1]
        assert '-X' in args and '-w' in args and '-f' in args and args[-1] == '-'
        assert kwargs['env']['PGPASSWORD'] == FAKE_DB_PASSWORD
        assert FAKE_SUB in kwargs['input']
        assert kwargs['capture_output'] is True
        if self.psql_error:
            return types.SimpleNamespace(returncode=3, stdout='', stderr=self.psql_error)
        summary = {'AdvisorRole': 'ADVISOR', 'IdentityStatus': 'ACTIVE', 'AssignedStudents': 3,
                   'PrivateFixtureStudents': 4, 'PrivateFixturePlans': 4, 'AssignmentDays': 7,
                   'ExistingRowsUnchanged': True, 'DemoPlansTouched': False,
                   'FixturePlanStates': [{'Case': f'SMOKE83{i:04}', 'State': 'DRAFT', 'Version': 1} for i in range(1,5)]}
        if self.extra_summary:
            summary['unexpected-private-field'] = 'MUST_NOT_PRINT'
        return types.SimpleNamespace(returncode=0, stdout='\n' + json.dumps(summary) + '\n', stderr='')


class RunProvision83Test(unittest.TestCase):
    def call(self, cloud, interactive=True, wrong_hash=False):
        hashes = {'IDENTITY_SHA': hashlib.sha256(cloud.blob('identity.json')).hexdigest(),
                  'SQL_SHA': hashlib.sha256(cloud.sql.encode()).hexdigest(),
                  'CA_SHA': hashlib.sha256(cloud.ca).hexdigest()}
        if wrong_hash:
            hashes['IDENTITY_SHA'] = '0' * 64
        with patch.multiple(operator, **hashes), contextlib.redirect_stdout(io.StringIO()) as stdout:
            try:
                operator.provision(cloud, cloud.prompt, cloud.run, interactive)
            finally:
                self.output = stdout.getvalue()
        return self.output

    def test_success_keeps_password_and_subject_out_of_args_output_and_files(self):
        cloud = Cloud(); output = self.call(cloud)
        self.assertEqual(cloud.processes, ['pg_isready', 'psql'])
        self.assertEqual(len(cloud.requests), 3)
        self.assertNotIn(FAKE_SUB, output); self.assertNotIn(FAKE_DB_PASSWORD, output)
        self.assertIn('THREE LIMITED ASSIGNMENTS VERIFIED', output)

    def test_input_hash_failure_stops_before_password_or_process(self):
        cloud = Cloud()
        with self.assertRaisesRegex(RuntimeError, '^INPUT_HASH_MISMATCH$'):
            self.call(cloud, wrong_hash=True)
        self.assertFalse(cloud.prompts); self.assertFalse(cloud.processes)

    def test_wrong_pool_stops_before_password_or_psql(self):
        cloud = Cloud(); cloud.identity['user_pool_id'] = 'different'
        with self.assertRaisesRegex(RuntimeError, '^IDENTITY_TARGET_MISMATCH$'):
            self.call(cloud)
        self.assertFalse(cloud.prompts); self.assertFalse(cloud.processes)

    def test_wrong_marker_stops_before_password_or_psql(self):
        cloud = Cloud(); cloud.identity['fixture_marker'] = 'unexpected'
        with self.assertRaisesRegex(RuntimeError, '^IDENTITY_TARGET_MISMATCH$'):
            self.call(cloud)
        self.assertFalse(cloud.prompts); self.assertFalse(cloud.processes)

    def test_invalid_subject_cannot_inject_sql(self):
        cloud = Cloud(); cloud.identity['sub'] = "x'; SELECT 1;--"
        with self.assertRaisesRegex(RuntimeError, '^IDENTITY_SUBJECT_INVALID$'):
            self.call(cloud)
        self.assertFalse(cloud.prompts); self.assertFalse(cloud.processes)

    def test_extra_identity_fields_are_refused(self):
        cloud = Cloud(); cloud.identity['password'] = 'DO_NOT_ACCEPT'
        with self.assertRaisesRegex(RuntimeError, '^IDENTITY_SCHEMA_MISMATCH$'):
            self.call(cloud)
        self.assertFalse(cloud.prompts); self.assertFalse(cloud.processes)

    def test_unreachable_db_stops_before_prompt_and_sql(self):
        cloud = Cloud(); cloud.ready = False
        with self.assertRaisesRegex(RuntimeError, '^RDS_NOT_READY_'):
            self.call(cloud)
        self.assertFalse(cloud.prompts); self.assertEqual(cloud.processes, ['pg_isready'])

    def test_raw_psql_error_is_not_echoed(self):
        cloud = Cloud(); cloud.psql_error = 'ERROR: P8306\nDETAIL: ' + FAKE_SUB + FAKE_DB_PASSWORD
        with self.assertRaisesRegex(RuntimeError, '^PSQL_FAILED_P8306$'):
            self.call(cloud)
        self.assertNotIn(FAKE_SUB, self.output); self.assertNotIn(FAKE_DB_PASSWORD, self.output)

    def test_unexpected_committed_summary_does_not_print_values(self):
        cloud = Cloud(); cloud.extra_summary = True
        with self.assertRaisesRegex(RuntimeError, '^DB_COMMITTED_UNEXPECTED_SUMMARY$'):
            self.call(cloud)
        self.assertNotIn('MUST_NOT_PRINT', self.output)

    def test_noninteractive_mode_does_not_read_private_input(self):
        cloud = Cloud()
        with self.assertRaisesRegex(RuntimeError, '^INTERACTIVE_'):
            self.call(cloud, interactive=False)
        self.assertFalse(cloud.requests); self.assertFalse(cloud.prompts); self.assertFalse(cloud.processes)


if __name__ == '__main__':
    unittest.main()
