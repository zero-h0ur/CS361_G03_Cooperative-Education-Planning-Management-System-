import contextlib
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deny83', ROOT / 'scripts/operations/deny-smoke83-mutations.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
READ = operator.load_reader()
read_test_spec = importlib.util.spec_from_file_location('read83_test_fakes', Path(__file__).with_name('test_read_smoke83_roles.py'))
read_tests = importlib.util.module_from_spec(read_test_spec)
read_test_spec.loader.exec_module(read_tests)
TOKEN = read_tests.token()
FIRST = {'id': operator.PLANS[0], 'status': 'DRAFT', 'version': 1, 'cycle_id': operator.ROUND,
         'company': {'id': '90000000-0000-4000-8000-000000000004'},
         'position': {'id': '90000000-0000-4000-8000-000000000005'}}


class FakeClient(read_tests.FakeAPI):
    def __init__(self, role):
        super().__init__(role)
        self.armed = False
        self.probes = []
        self.success_at = None
        self.changed = False

    def get(self, path):
        if self.role == 'ADVISOR' and path.startswith('/api/v3/advisor/plans/'):
            index = operator.PLANS.index(path.split('/')[-1])
            data = dict(FIRST, id=operator.PLANS[index], status=operator.STATES[index])
            if self.armed and self.changed:
                data['version'] = 2
            self.paths.append(path)
            return 200, {'data': data}
        return super().get(path)

    def arm(self, probes):
        self.armed = True

    def deny(self, probe):
        self.probes.append(probe)
        if len(self.probes) == self.success_at:
            raise operator.Stop('MUTATION_HTTP_200_EXPECTED_403_CHECK_DB_NO_RETRY')


class Deny83Tests(unittest.TestCase):
    def run_role(self, role, client=None):
        client = client or FakeClient(role)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            count = operator.run_matrix(role, TOKEN, True, reader=READ, client=client)
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertNotIn(FIRST['company']['id'], output.getvalue())
        return count, client, output.getvalue()

    def test_all_role_matrices_counts_and_no_demo_mutation_targets(self):
        for role, expected in [('ADVISOR', 14), ('STUDENT', 4), ('STAFF', 3)]:
            with self.subTest(role=role):
                count, client, output = self.run_role(role)
                self.assertEqual(count, expected)
                self.assertIn('DB BASELINE VERIFY STILL REQUIRED', output)
                for probe in client.probes:
                    self.assertTrue(probe.path.startswith('/api/v3/'))
                    if probe.path not in ('/api/v3/students/me', '/api/v3/plans'):
                        self.assertTrue(any(value in probe.path for value in operator.PLANS))
                if role == 'STUDENT':
                    self.assertTrue(all(operator.PLANS[0] in p.path or operator.PLANS[3] in p.path for p in client.probes))
                    self.assertTrue(all(p.method == 'PATCH' or p.path.endswith('/submit') for p in client.probes))
                if role == 'STAFF':
                    self.assertIn('not valid-state review acceptance', output)
                    self.assertTrue(all(operator.PLANS[3] in p.path for p in client.probes))

    def test_baseline_acknowledgment_required_before_token_or_network(self):
        client = FakeClient('ADVISOR')
        with self.assertRaisesRegex(operator.Stop, 'CAPTURE_PRIVATE_DB_BASELINE_FIRST'):
            operator.run_matrix('ADVISOR', TOKEN, reader=READ, client=client)
        self.assertFalse(client.paths); self.assertFalse(client.armed)

    def test_wrong_trusted_role_refused_before_arming(self):
        client = FakeClient('STUDENT')
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            operator.run_matrix('ADVISOR', TOKEN, True, READ, client)
        self.assertFalse(client.armed); self.assertFalse(client.probes)

    def test_wrong_fixture_state_or_version_refused_before_any_mutation(self):
        for field, value in [('status', 'APPROVED'), ('version', 2), ('cycle_id', 'wrong')]:
            client = FakeClient('ADVISOR'); original = client.get
            def get(path, field=field, value=value):
                status, payload = original(path)
                if path.startswith('/api/v3/advisor/plans/'):
                    payload['data'][field] = value
                return status, payload
            client.get = get
            with self.subTest(field=field), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                operator.run_matrix('ADVISOR', TOKEN, True, READ, client)
            self.assertFalse(client.armed); self.assertFalse(client.probes)

    def test_unexpected_success_stops_at_first_probe_no_retry_or_later_probes(self):
        client = FakeClient('ADVISOR'); client.success_at = 1
        with contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaisesRegex(operator.Stop, 'NO_RETRY'):
            operator.run_matrix('ADVISOR', TOKEN, True, READ, client)
        self.assertEqual(len(client.probes), 1)
        self.assertNotIn('MUTATION DENIALS PASSED', output.getvalue())

    def test_post_probe_advisor_detail_change_blocks_acceptance(self):
        client = FakeClient('ADVISOR'); client.changed = True
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            operator.run_matrix('ADVISOR', TOKEN, True, READ, client)
        self.assertEqual(len(client.probes), 14)

    def test_payloads_have_valid_json_uuid_version_and_review_notes(self):
        for role in ('ADVISOR', 'STUDENT', 'STAFF'):
            probes = operator.build_probes(role, FIRST if role == 'ADVISOR' else None)
            operations = []
            for probe in probes:
                if probe.body is None:
                    self.assertEqual(probe.expected, 405)
                    continue
                body = json.loads(probe.body)
                self.assertFalse(set(body) & {'actor', 'status', 'student_id', 'studentId', 'plan_id'})
                if probe.path == '/api/v3/students/me':
                    self.assertEqual(set(body), {'preferred_name'})
                    self.assertLessEqual(len(body['preferred_name']), 100)
                    continue
                self.assertRegex(body['operation_id'], r'^[0-9a-f-]{36}$')
                self.assertRegex(body['correlation_id'], r'^[0-9a-f-]{36}$')
                operations.append(body['operation_id'])
                if probe.path == '/api/v3/plans':
                    self.assertEqual(body['cycle_id'], operator.ROUND)
                    self.assertEqual(body['company_id'], FIRST['company']['id'])
                else:
                    self.assertEqual(body['expected_version'], 1)
                if probe.path.endswith('/return'):
                    self.assertTrue(1 <= len(body['review_notes']) <= 2000)
            self.assertEqual(len(operations), len(set(operations)))

    def test_advisor_workflow_probes_use_appropriate_existing_states(self):
        probes = operator.build_probes('ADVISOR', FIRST)
        for action, plan in [('submit', 0), ('start-review', 1), ('return', 2), ('approve', 2)]:
            matches = [p for p in probes if p.path.endswith('/' + action)]
            self.assertEqual(len(matches), 1)
            self.assertIn(operator.PLANS[plan], matches[0].path)

    def test_pinned_get_helper_hash_checked(self):
        with patch.object(operator, 'READER_SHA', '0' * 64), self.assertRaisesRegex(operator.Stop, 'GET_HELPER_HASH_MISMATCH'):
            operator.load_reader()

    def transport(self, response_code=403, payload=None, failure=None, chosen_probe=None):
        probe = chosen_probe or operator.build_probes('STUDENT')[0]
        client = operator.ProbeClient(READ, TOKEN)
        calls = []
        class Response(io.BytesIO):
            code = response_code
            def geturl(self):
                return READ.API + probe.path
        def open_request(request, timeout):
            calls.append(request)
            if failure:
                raise failure
            self.assertEqual(request.full_url, READ.API + probe.path)
            self.assertEqual(request.get_method(), probe.method)
            self.assertEqual(request.data, probe.body)
            self.assertEqual(timeout, 15)
            self.assertEqual(request.get_header('Authorization'), 'Bearer ' + TOKEN)
            return Response(json.dumps(payload or {'error': {'code': 'FORBIDDEN', 'message': 'Access denied.'}}).encode())
        client.transport._opener = types.SimpleNamespace(open=open_request)
        return client, probe, calls

    def test_transport_refuses_unarmed_and_altered_payloads_before_network(self):
        client, probe, calls = self.transport()
        with self.assertRaisesRegex(operator.Stop, 'UNREVIEWED_MUTATION'):
            client.deny(probe)
        client.arm([probe])
        for altered in [probe._replace(path='/api/v3/plans/demo'), probe._replace(body=b'{}'), probe._replace(method='DELETE')]:
            with self.assertRaisesRegex(operator.Stop, 'UNREVIEWED_MUTATION'):
                client.deny(altered)
        self.assertEqual(calls, [])
        client.deny(probe)
        self.assertEqual(len(calls), 1)

    def test_transport_cannot_arm_arbitrary_demo_target(self):
        client, probe, calls = self.transport()
        with self.assertRaisesRegex(operator.Stop, 'NON_FIXTURE_MUTATION_TARGET'):
            client.arm([probe._replace(path='/api/v3/plans/90000000-0000-4000-8000-000000000008')])
        self.assertEqual(calls, [])

    def test_exact_generic_405_contract_for_unsupported_routes(self):
        probe = next(p for p in operator.build_probes('ADVISOR', FIRST) if p.expected == 405)
        for message, succeeds in [('Method not allowed.', True), ('private unexpected text', False)]:
            client, probe, calls = self.transport(response_code=405, chosen_probe=probe,
                payload={'error': {'code': 'METHOD_NOT_ALLOWED', 'message': message}})
            client.arm([probe])
            if succeeds:
                client.deny(probe)
            else:
                with self.assertRaisesRegex(operator.Stop, 'UNSUPPORTED_METHOD_ERROR'):
                    client.deny(probe)
            self.assertEqual(len(calls), 1)

    def test_real_urllib_http_error_is_read_and_validated_without_raw_message(self):
        probe = operator.build_probes('STUDENT')[0]
        error = urllib.error.HTTPError(READ.API + probe.path, 403, 'PRIVATE_RAW_MESSAGE', {},
            io.BytesIO(b'{"error":{"code":"FORBIDDEN","message":"Access denied."}}'))
        client, probe, calls = self.transport(failure=error, chosen_probe=probe)
        client.arm([probe])
        with contextlib.redirect_stdout(io.StringIO()) as output:
            client.deny(probe)
        self.assertNotIn('PRIVATE_RAW_MESSAGE', output.getvalue())
        self.assertEqual(len(calls), 1)

    def test_http_status_must_be_exact_not_any_non_success(self):
        for status in (200, 201, 400, 401, 404, 409, 422, 500):
            client, probe, calls = self.transport(response_code=status)
            client.arm([probe])
            with self.subTest(status=status), self.assertRaisesRegex(operator.Stop, 'MUTATION_HTTP_'):
                client.deny(probe)
            self.assertEqual(len(calls), 1)

    def test_transport_failure_does_not_retry_and_outcome_is_unknown(self):
        for failure in (TimeoutError('PRIVATE_CANARY'), READ.Stop('REDIRECT_REFUSED')):
            client, probe, calls = self.transport(failure=failure)
            client.arm([probe])
            with self.assertRaisesRegex(operator.Stop, 'OUTCOME_UNKNOWN') as error:
                client.deny(probe)
            self.assertNotIn('PRIVATE_CANARY', str(error.exception))
            self.assertEqual(len(calls), 1)

    def test_response_values_and_tokens_never_printed(self):
        for payload in [{'error': {'code': 'FORBIDDEN', 'message': 'private-canary@example.com'}}, {'data': {'token': TOKEN}}]:
            client, probe, calls = self.transport(payload=payload)
            client.arm([probe])
            with contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaises(RuntimeError):
                client.deny(probe)
            self.assertNotIn(TOKEN, output.getvalue()); self.assertNotIn('private-canary', output.getvalue())


if __name__ == '__main__':
    unittest.main()
