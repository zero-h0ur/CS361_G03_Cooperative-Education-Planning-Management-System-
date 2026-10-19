import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'scripts/operations/create-smoke83-advisor.py'
spec = importlib.util.spec_from_file_location('advisor83', SOURCE)
advisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(advisor)
FAKE_PASSWORD = 'Unit-Test83!NotReal'
SUB = '00000000-0000-4000-8000-000000000083'


class Missing(Exception):
    response = {'Error': {'Code': 'UserNotFoundException'}}


class Cloud:
    def __init__(self):
        self.user = None
        self.writes = []
        self.account = advisor.ACCOUNT
    def client(self, service):
        return self
    def get_caller_identity(self):
        return {'Account': self.account}
    def describe_user_pool(self, **kwargs):
        return {'UserPool': {'Id': advisor.POOL}}
    def admin_get_user(self, **kwargs):
        if self.user is None:
            raise Missing()
        return self.user
    def admin_create_user(self, **kwargs):
        assert kwargs['MessageAction'] == 'SUPPRESS'
        assert kwargs['UserPoolId'] == advisor.POOL and kwargs['Username'] == advisor.EMAIL
        self.writes.append('create')
        self.user = {'Username': advisor.EMAIL, 'Enabled': True, 'UserStatus': 'FORCE_CHANGE_PASSWORD',
                     'UserAttributes': kwargs['UserAttributes'] + [{'Name': 'sub', 'Value': SUB}]}
    def admin_set_user_password(self, **kwargs):
        assert set(kwargs) == {'UserPoolId', 'Username', 'Password', 'Permanent'}
        assert kwargs['Permanent'] is True and kwargs['Password'] == FAKE_PASSWORD
        self.writes.append('password')
        self.user['UserStatus'] = 'CONFIRMED'


class Advisor83Test(unittest.TestCase):
    def call(self, cloud, output, prompts=None, interactive=True):
        answers = iter(prompts if prompts is not None else [FAKE_PASSWORD, FAKE_PASSWORD])
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            advisor.provision(cloud.client, lambda _: next(answers), output, interactive)
        return stdout.getvalue()

    def test_creation_is_suppressed_and_only_private_metadata_is_written(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); output = Path(folder) / advisor.IDENTITY_FILE
            stdout = self.call(cloud, output)
            self.assertEqual(cloud.writes, ['create', 'password'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(output.read_text())['sub'], SUB)
            self.assertNotIn(FAKE_PASSWORD, stdout + output.read_text())
            self.assertNotIn(SUB, stdout)
            self.assertIn('still pending', stdout)

    def test_password_mismatch_prevents_all_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); output = Path(folder) / advisor.IDENTITY_FILE
            with self.assertRaises(RuntimeError):
                self.call(cloud, output, [FAKE_PASSWORD, 'different'])
            self.assertEqual(cloud.writes, [])
            self.assertFalse(output.exists())

    def test_policy_failure_prevents_all_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud()
            with self.assertRaises(RuntimeError):
                self.call(cloud, Path(folder) / advisor.IDENTITY_FILE, ['short', 'short'])
            self.assertEqual(cloud.writes, [])

    def test_wrong_account_prevents_all_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); cloud.account = '000000000000'
            with self.assertRaises(RuntimeError):
                self.call(cloud, Path(folder) / advisor.IDENTITY_FILE)
            self.assertEqual(cloud.writes, [])

    def test_unmarked_existing_identity_is_never_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud()
            cloud.admin_create_user(UserPoolId=advisor.POOL, Username=advisor.EMAIL,
                                    MessageAction='SUPPRESS', UserAttributes=[{'Name': 'email', 'Value': advisor.EMAIL}])
            cloud.writes.clear()
            with self.assertRaises(RuntimeError):
                self.call(cloud, Path(folder) / advisor.IDENTITY_FILE)
            self.assertEqual(cloud.writes, [])

    def test_resume_preserves_matching_private_file_and_creates_no_duplicate(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); output = Path(folder) / advisor.IDENTITY_FILE
            self.call(cloud, output); before = output.read_bytes(); cloud.writes.clear()
            self.call(cloud, output)
            self.assertEqual(cloud.writes, ['password'])
            self.assertEqual(output.read_bytes(), before)

    def test_noninteractive_run_stops_before_aws(self):
        with tempfile.TemporaryDirectory() as folder:
            def forbidden(_):
                self.fail('AWS must not be called without a TTY')
            with self.assertRaises(RuntimeError):
                advisor.provision(forbidden, lambda _: FAKE_PASSWORD, Path(folder) / advisor.IDENTITY_FILE, False)

    def test_disabled_marked_user_is_not_activated_or_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); output = Path(folder) / advisor.IDENTITY_FILE
            self.call(cloud, output); cloud.writes.clear(); cloud.user['Enabled'] = False
            with self.assertRaises(RuntimeError):
                self.call(cloud, output)
            self.assertEqual(cloud.writes, [])

    def test_mismatched_metadata_stops_before_password_change(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); output = Path(folder) / advisor.IDENTITY_FILE
            self.call(cloud, output); cloud.writes.clear()
            data = json.loads(output.read_text()); data['issuer'] = 'https://unexpected.example.com'
            output.write_text(json.dumps(data))
            with self.assertRaises(RuntimeError):
                self.call(cloud, output)
            self.assertEqual(cloud.writes, [])

    def test_world_readable_metadata_is_refused_without_password_change(self):
        with tempfile.TemporaryDirectory() as folder:
            cloud = Cloud(); output = Path(folder) / advisor.IDENTITY_FILE
            self.call(cloud, output); cloud.writes.clear(); output.chmod(0o644)
            with self.assertRaises(RuntimeError):
                self.call(cloud, output)
            self.assertEqual(cloud.writes, [])


if __name__ == '__main__':
    unittest.main()
