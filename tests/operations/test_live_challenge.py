import importlib.util
import contextlib
import io
import json
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / 'operations' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


live = load('live-challenge')
admin = load('admin-account')


class ChallengeSafetyTests(unittest.TestCase):
    def test_identity_create_and_resume_never_reset_confirmed_users_or_print_passwords(self):
        class Missing(Exception):
            response = {'Error': {'Code': 'UserNotFoundException'}}
        class Cognito:
            def __init__(self): self.users = {}; self.password_calls = 0
            def admin_get_user(self, **args):
                if args['Username'] not in self.users: raise Missing()
                return self.users[args['Username']]
            def admin_create_user(self, **args):
                self.assert_suppressed = args['MessageAction']
                self.users[args['Username']] = {'Username': args['Username'], 'Enabled': True, 'UserStatus': 'FORCE_CHANGE_PASSWORD',
                    'UserAttributes': args['UserAttributes'] + [{'Name': 'sub', 'Value': str(uuid.uuid4())}]}
            def admin_set_user_password(self, **args):
                if args['Permanent'] is not True: raise AssertionError('Permanent password required')
                self.password_calls += 1; self.users[args['Username']]['UserStatus'] = 'CONFIRMED'
        with tempfile.TemporaryDirectory() as folder:
            client = Cognito(); path = Path(folder) / 'private.json'; output = io.StringIO()
            with contextlib.redirect_stdout(output):
                first = live.identities(client, path); live.identities(client, path)
            self.assertEqual(client.password_calls, 7)
            self.assertEqual(client.assert_suppressed, 'SUPPRESS')
            for row in first['accounts']: self.assertNotIn(row['password'], output.getvalue())
            self.assertTrue(all(user['UserStatus'] == 'CONFIRMED' for user in client.users.values()))

    def test_exact_synthetic_roster_and_no_initial_plan_writes(self):
        rows = live.roster()
        self.assertEqual([r['role'] for r in rows].count('STUDENT'), 3)
        self.assertEqual([r['role'] for r in rows].count('ADVISOR'), 2)
        value = {'marker': live.MARKER, 'issuer': live.ISSUER, 'accounts': [{**r, 'sub': str(uuid.uuid4()), 'password': 'DO_NOT_EXPORT'} for r in rows]}
        exported = live.public_manifest(value)
        self.assertNotIn('password', json.dumps(exported))
        sql = live.provisioning_sql(value)
        self.assertNotIn('DO_NOT_EXPORT', sql)
        self.assertNotIn('INSERT INTO public.plans', sql)
        self.assertNotIn('DELETE FROM', sql)
        self.assertNotIn('UPDATE public.', sql)
        self.assertIn('existing_rows_unchanged', sql)
        self.assertIn('008_returned_plan_cancellation.sql', sql)

    def test_private_files_have_restrictive_permissions_and_no_symlink_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'accounts.json'
            live.private_file(path, {'safe': 1}, create=True)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            live.private_file(path, {'safe': 2})
            self.assertEqual(json.loads(path.read_text()), {'safe': 2})
            alias = Path(folder) / 'alias.json'; alias.symlink_to(path)
            with self.assertRaises(ValueError): live.private_file(alias, {})

    def test_admin_request_requires_exact_fields_reason_role_version_and_operation(self):
        body = {'user_id': str(uuid.uuid4()), 'role': 'ADVISOR', 'account_status': 'ACTIVE', 'expected_version': 1,
                'operation_id': str(uuid.uuid4()), 'reason': 'Synthetic test'}
        admin.validate(body)
        for patch in [{'role': 'SYSTEM'}, {'expected_version': True}, {'reason': ' '}, {'full_name': 'Not writable'}]:
            with self.assertRaises(ValueError): admin.validate({**body, **patch})
        sql = admin.statement(str(uuid.uuid4()), body)
        self.assertIn('FOR UPDATE', sql)
        self.assertIn('admin:account_update', sql)
        self.assertIn('workflow_events', sql)
        self.assertNotIn('UPDATE public.students', sql)
        self.assertNotIn('UPDATE public.plans', sql)

    def test_admin_approval_pins_target_request_and_short_lifetime_without_credentials(self):
        request = {'user_id': str(uuid.uuid4()), 'role': 'ADVISOR', 'account_status': 'ACTIVE', 'expected_version': 1,
                   'operation_id': str(uuid.uuid4()), 'reason': 'Synthetic test'}
        actor = str(uuid.uuid4())
        approval = admin.approval_document(actor, request, now=1000)
        raw = json.dumps(approval).encode()
        digest = hashlib.sha256(raw).hexdigest()
        self.assertEqual(admin.approved_request(raw, digest, now=1100), (actor, request))
        self.assertNotIn('token', approval)
        self.assertNotIn('password', approval)
        with self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
            admin.approved_request(raw + b' ', digest, now=1100)
        with self.assertRaisesRegex(ValueError, 'EXPIRED'):
            admin.approved_request(raw, digest, now=1600)
        approval['account'] = '000000000000'
        raw = json.dumps(approval).encode()
        with self.assertRaisesRegex(ValueError, 'TARGET_MISMATCH'):
            admin.approved_request(raw, hashlib.sha256(raw).hexdigest(), now=1100)


if __name__ == '__main__': unittest.main()
