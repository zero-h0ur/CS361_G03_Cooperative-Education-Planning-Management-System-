import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('read83', ROOT / 'scripts/operations/read-smoke83-roles.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


def token(**changes):
    claims = {'iss': operator.ISSUER, 'client_id': operator.CLIENT, 'token_use': 'access',
              'scope': 'openid coed-api/access', 'exp': int(time.time()) + 3600}
    claims.update(changes)
    encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    return 'eyJhbGciOiJVTklUX09OTFkifQ.' + encoded + '.UNIT_TEST_NOT_A_REAL_SIGNATURE'


class FakeAPI:
    def __init__(self, role, leak=False):
        self.role = role
        self.paths = []
        self.leak = leak

    def get(self, path):
        self.paths.append(path)
        if path == '/api/v3/me':
            return 200, {'data': {'role': self.role, 'studentId': '11111111-1111-4111-8111-111111111111',
                                 'user': {'role': self.role, 'accountStatus': 'ACTIVE',
                                          'id': operator.ADVISOR}, 'scope': {'assignedStudentCount': 3}}}
        denied = (operator.PLANS[3] in path or operator.STUDENTS[3] in path)
        if self.role == 'ADVISOR':
            denied |= not path.startswith('/api/v3/advisor/')
        elif self.role == 'STAFF':
            denied |= not path.startswith('/api/v3/staff/')
        else:
            denied |= path.startswith(('/api/v3/staff/', '/api/v3/advisor/'))
            denied |= any(value in path for value in operator.PLANS)
        if denied:
            return 403, {'error': {'code': 'FORBIDDEN', 'message':
                                  'private-canary@example.com' if self.leak else 'Access denied.'}}
        if 'q=SMOKE830004' in path:
            data = []
        elif 'q=SMOKE83' in path or path == '/api/v3/advisor/students?pageSize=100':
            ids = operator.STUDENTS if '/students' in path else operator.PLANS
            data = [{'id': value} for value in ids[:3]]
        elif self.role == 'ADVISOR' and '/students/' in path:
            index = next(i for i, value in enumerate(operator.STUDENTS) if value in path)
            data = ([{'id': operator.PLANS[index]}] if '/plans' in path else {'id': operator.STUDENTS[index]})
        elif path.endswith('/history'):
            data = []
        elif path == '/api/v3/students/me':
            data = {'id': '11111111-1111-4111-8111-111111111111', 'student_number': 'TESTPR730001'}
        elif path == '/api/v3/plans?pageSize=100':
            data = [{'id': '22222222-2222-4222-8222-222222222222'}]
        else:
            data = {'id': path.split('/')[-1]}
        return 200, {'data': data}


class RoleRead83Tests(unittest.TestCase):
    def test_all_role_matrices_are_get_only_and_redact_values(self):
        for role, expected in [('ADVISOR', 17), ('STAFF', 15), ('STUDENT', 11)]:
            with self.subTest(role=role):
                api = FakeAPI(role)
                value = token()
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    self.assertEqual(operator.run_matrix(role, value, api), expected)
                self.assertNotIn(value, output.getvalue())
                self.assertNotIn('11111111-', output.getvalue())
                self.assertTrue(all(path.startswith('/api/v3/') for path in api.paths))

    def test_token_guards_fail_before_any_http_request(self):
        changes = [{'iss': 'https://wrong.example'}, {'client_id': 'wrong'}, {'token_use': 'id'},
                   {'scope': 'openid'}, {'scope': []}, {'exp': 0}, {'exp': True}]
        for change in changes:
            with self.subTest(change=change):
                api = FakeAPI('ADVISOR')
                with self.assertRaises(operator.Stop):
                    operator.run_matrix('ADVISOR', token(**change), api)
                self.assertEqual(api.paths, [])

    def test_malformed_token_rejected(self):
        for value in ['Bearer not-a-token', '', 'a.b.c', 'a.b.c\n']:
            with self.subTest(value=value), self.assertRaises(operator.Stop):
                operator.validate_token(value)

    def test_wrong_trusted_role_stops_after_me(self):
        api = FakeAPI('STUDENT')
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(operator.Stop):
            operator.run_matrix('ADVISOR', token(), api)
        self.assertEqual(api.paths, ['/api/v3/me'])

    def test_wrong_advisor_identity_stops_before_fixture_reads(self):
        api = FakeAPI('ADVISOR')
        original = api.get
        def get(path):
            status, payload = original(path)
            payload['data']['user']['id'] = 'wrong'
            return status, payload
        api.get = get
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(operator.Stop, 'WRONG_SYNTHETIC'):
            operator.run_matrix('ADVISOR', token(), api)
        self.assertEqual(api.paths, ['/api/v3/me'])

    def test_private_error_values_withheld(self):
        with contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaisesRegex(operator.Stop, 'PRIVATE_OR_DEBUG'):
            operator.run_matrix('ADVISOR', token(), FakeAPI('ADVISOR', leak=True))
        self.assertNotIn('private-canary', output.getvalue())

    def test_unexpected_access_stops_instead_of_counting_denial_as_pass(self):
        api = FakeAPI('ADVISOR')
        original = api.get
        api.get = lambda path: (200, {'data': {}}) if operator.STUDENTS[3] in path else original(path)
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(operator.Stop, 'UNEXPECTED_HTTP_200_EXPECTED_403'):
            operator.run_matrix('ADVISOR', token(), api)

    def test_denial_envelope_refuses_data_and_debug_material(self):
        for payload in [{'data': {}}, {'error': {'message': 'postgres://private'}},
                        {'error': {'external_subject': 'hidden'}}, {'debug': 'anything'}]:
            with self.subTest(payload=payload), self.assertRaises(operator.Stop):
                operator.safe_denial(payload)

    def test_denials_allow_only_exact_generic_contract(self):
        operator.safe_denial({'error': {'code': 'FORBIDDEN', 'message': 'Access denied.'}})
        for payload in [{'message': 'Forbidden'}, {'error': {'code': 'FORBIDDEN', 'message': 'unexpected text'}},
                        {'error': {'code': 'FORBIDDEN', 'message': 'Access denied.', 'details': ['hidden']}}]:
            with self.subTest(payload=payload), self.assertRaises(operator.Stop):
                operator.safe_denial(payload)

    def test_no_redirect_can_forward_authorization(self):
        with self.assertRaisesRegex(operator.Stop, 'REDIRECT_REFUSED'):
            operator.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example')

    def test_http_client_pins_target_method_timeout_and_hides_bad_bodies(self):
        class Response(io.BytesIO):
            code = 200
            def geturl(self):
                return operator.API + '/api/v3/me'
        class Opener:
            def __init__(self):
                self.body = b'{"data":{}}'
                self.called = []
            def open(self, request, timeout):
                self.called.append(request)
                assert request.full_url == operator.API + '/api/v3/me'
                assert request.get_method() == 'GET' and request.data is None and timeout == 15
                return Response(self.body)
        opener = Opener()
        client = operator.ReadClient(token(), opener=opener)
        self.assertEqual(client.get('/api/v3/me'), (200, {'data': {}}))
        for bad in ['https://other.example/', '//other.example/', '/api/v3/../escape', '/api/v3/me\r\nx:bad']:
            with self.subTest(bad=bad), self.assertRaises(operator.Stop):
                client.get(bad)
        self.assertEqual(len(opener.called), 1)
        for body in [b'not-json-private-canary', b'x' * (operator.MAX_BODY + 1), client._token.encode()]:
            opener.body = body
            with self.assertRaises(operator.Stop):
                client.get('/api/v3/me')

    def test_non_tty_refused_without_prompt(self):
        with patch('sys.argv', ['read83', '--role', 'ADVISOR']), patch('sys.stdin.isatty', return_value=False), \
                patch.object(operator.getpass, 'getpass') as prompt, self.assertRaisesRegex(operator.Stop, 'INTERACTIVE'):
            operator.main()
        prompt.assert_not_called()


if __name__ == '__main__':
    unittest.main()
