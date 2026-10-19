import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('checkpoint83', ROOT / 'scripts/operations/checkpoint-smoke83-db.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


def snapshot():
    return {'guards': {key: True for key in ('database', 'operator', 'readOnly', 'migration',
                'fixtureStudents', 'fixturePlans', 'advisor', 'assignments', 'roundOpen')},
            'tables': {name: {'rows': 5, 'fingerprint': 'a' * 32} for name in operator.TABLES},
            'fixturePlans': [{'case': f'SMOKE83{i + 1:04d}', 'state': state, 'version': 1,
                              'auditRows': 1, 'operationRows': 0} for i, state in enumerate(operator.INITIAL_STATES)]}


class Checkpoint83Tests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='coed83-unit-')
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / operator.BASELINE

    def run_checkpoint(self, mode, data=None, interactive=True):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            operator.checkpoint(mode, self.path, lambda: copy.deepcopy(data or snapshot()), interactive)
        return output.getvalue()

    def test_capture_and_exact_verify_do_not_expose_hashes_or_raw_values(self):
        output = self.run_checkpoint('capture')
        self.assertIn('BASELINE CAPTURED', output)
        self.assertNotIn('a' * 32, output)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        before = self.path.read_bytes()
        output = self.run_checkpoint('verify')
        self.assertIn('DATABASE UNCHANGED VERIFIED', output)
        self.assertEqual(self.path.read_bytes(), before)

    def test_existing_capture_refused_before_any_database_call(self):
        self.run_checkpoint('capture')
        fetch = Mock()
        with self.assertRaisesRegex(operator.Stop, 'BASELINE_ALREADY_EXISTS'):
            operator.checkpoint('capture', self.path, fetch, interactive=True)
        fetch.assert_not_called()

    def test_changed_table_and_fixture_denial_preserves_baseline(self):
        self.run_checkpoint('capture')
        before = self.path.read_bytes()
        for change in ('table', 'fixture'):
            value = snapshot()
            if change == 'table':
                value['tables']['plans']['fingerprint'] = 'b' * 32
            else:
                value['fixturePlans'][0]['version'] = 2
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(operator.Stop, 'DATABASE_DIFFERENCE'):
                self.run_checkpoint('verify', value)
            self.assertEqual(self.path.read_bytes(), before)

    def test_changed_initial_fixture_does_not_create_baseline(self):
        value = snapshot(); value['fixturePlans'][0]['version'] = 2
        with self.assertRaisesRegex(operator.Stop, 'INITIAL_FIXTURE_BASELINE_CHANGED'):
            self.run_checkpoint('capture', value)
        self.assertFalse(self.path.exists())

    def test_all_database_guards_are_required(self):
        for key in snapshot()['guards']:
            value = snapshot(); value['guards'][key] = False
            with self.subTest(key=key), self.assertRaisesRegex(operator.Stop, 'DATABASE_OR_FIXTURE_GUARD'):
                operator.validate_snapshot(value)

    def test_unexpected_private_fields_rejected(self):
        for place in ('root', 'table', 'fixture'):
            value = snapshot()
            target = value if place == 'root' else value['tables']['users'] if place == 'table' else value['fixturePlans'][0]
            target['private_canary'] = 'DO_NOT_PRINT'
            with self.subTest(place=place), self.assertRaises(operator.Stop):
                operator.validate_snapshot(value)

    def test_non_tty_and_wrong_filename_stop_before_fetch(self):
        fetch = Mock()
        for path, interactive in [(self.path, False), (self.path.with_name('wrong.json'), True)]:
            with self.assertRaises(operator.Stop):
                operator.checkpoint('capture', path, fetch, interactive=interactive)
        fetch.assert_not_called()

    def test_symlink_and_open_permissions_refused(self):
        self.run_checkpoint('capture')
        real = self.path.with_name('private-existing.json')
        self.path.rename(real); self.path.symlink_to(real)
        with self.assertRaises(OSError):
            operator.read_baseline(self.path)
        self.path.unlink(); real.rename(self.path)
        self.path.chmod(0o644)
        with self.assertRaisesRegex(operator.Stop, 'BASELINE_FILE_PERMISSIONS'):
            operator.read_baseline(self.path)

    def test_rds_readiness_precedes_password_and_sql(self):
        s3 = Mock(); s3.get_object.return_value = {'Body': io.BytesIO(b'CA')}
        prompt = Mock(); run = Mock(return_value=types.SimpleNamespace(returncode=2))
        with patch.object(operator, 'CA_SHA', hashlib.sha256(b'CA').hexdigest()), \
                self.assertRaisesRegex(operator.Stop, 'RDS_NOT_READY'):
            operator.read_snapshot(s3, prompt, run)
        prompt.assert_not_called()
        self.assertEqual(run.call_args.args[0][0], 'pg_isready')

    def test_transport_readonly_sql_tls_no_password_in_args_output(self):
        s3 = Mock(); s3.get_object.return_value = {'Body': io.BytesIO(b'CA')}
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if args[0] == 'pg_isready':
                return types.SimpleNamespace(returncode=0)
            self.assertIn('sslmode=verify-full', args[1])
            self.assertNotIn('PRIVATE_UNIT_PASSWORD', ' '.join(args))
            self.assertEqual(kwargs['env']['PGPASSWORD'], 'PRIVATE_UNIT_PASSWORD')
            self.assertTrue(kwargs['capture_output'])
            self.assertEqual(kwargs['input'], operator.SQL)
            self.assertIn('REPEATABLE READ READ ONLY', kwargs['input'])
            self.assertTrue(kwargs['input'].strip().endswith('ROLLBACK;'))
            self.assertFalse(any(word in kwargs['input'] for word in ('INSERT ', 'UPDATE ', 'DELETE ', 'CREATE ', 'GRANT ')))
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(snapshot()))
        with patch.object(operator, 'CA_SHA', hashlib.sha256(b'CA').hexdigest()):
            self.assertEqual(operator.read_snapshot(s3, lambda _: 'PRIVATE_UNIT_PASSWORD', run), snapshot())
        self.assertEqual([args[0] for args in calls], ['pg_isready', 'psql'])
        s3.get_object.assert_called_once_with(Bucket=operator.BUCKET, Key='release/global-bundle.pem',
                                             ExpectedBucketOwner=operator.ACCOUNT)

    def test_sql_errors_and_raw_json_withheld(self):
        for result in [types.SimpleNamespace(returncode=1, stdout='PRIVATE_RAW_SQL', stderr='PRIVATE_RAW_SQL'),
                       types.SimpleNamespace(returncode=0, stdout='PRIVATE_RAW_BODY')]:
            s3 = Mock(); s3.get_object.return_value = {'Body': io.BytesIO(b'CA')}
            run = Mock(side_effect=[types.SimpleNamespace(returncode=0), result])
            with patch.object(operator, 'CA_SHA', hashlib.sha256(b'CA').hexdigest()), self.assertRaises(operator.Stop) as error:
                operator.read_snapshot(s3, lambda _: 'PRIVATE_UNIT_PASSWORD', run)
            self.assertNotIn('PRIVATE_RAW', str(error.exception))

    def test_ca_hash_failure_stops_before_password_or_sql(self):
        s3 = Mock(); s3.get_object.return_value = {'Body': io.BytesIO(b'wrong CA')}
        run = Mock(); prompt = Mock()
        with self.assertRaisesRegex(operator.Stop, 'CA_HASH_MISMATCH'):
            operator.read_snapshot(s3, prompt, run)
        run.assert_not_called(); prompt.assert_not_called()


if __name__ == '__main__':
    unittest.main()
