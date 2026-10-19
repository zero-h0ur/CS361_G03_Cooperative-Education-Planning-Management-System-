import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('logs83', ROOT / 'scripts/operations/scan-smoke83-logs.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class Cloud:
    def __init__(self, gateway_logs=False):
        self.config = {'FunctionArn': operator.FUNCTION_ARN, 'CodeSha256': operator.CODE_SHA,
                       'State': 'Active', 'LastUpdateStatus': 'Successful',
                       'Environment': {'Variables': {'PRIVATE_CANARY': 'NEVER_PRINT_CONFIG'}}}
        self.stage = {'StageName': '$default'}
        if gateway_logs:
            self.stage['AccessLogSettings'] = {'DestinationArn':
                f'arn:aws:logs:{operator.REGION}:{operator.ACCOUNT}:log-group:/coed-api-access:*'}
        self.calls = []
        self.message = 'START RequestId: synthetic-runtime-id Version: $LATEST\nEND RequestId: synthetic-runtime-id'
        self.empty_first = False
        self.empty_all = False
        self.cycle = False
        self.duplicate = False

    def get_function_configuration(self, **kwargs):
        self.calls.append(('get_function_configuration', kwargs))
        assert kwargs == {'FunctionName': operator.FUNCTION}
        return copy.deepcopy(self.config)

    def get_stage(self, **kwargs):
        self.calls.append(('get_stage', kwargs))
        assert kwargs == {'ApiId': operator.API_ID, 'StageName': '$default'}
        return copy.deepcopy(self.stage)

    def filter_log_events(self, **kwargs):
        self.calls.append(('filter_log_events', kwargs))
        assert kwargs['limit'] == 1000 and kwargs['unmask'] is False
        assert kwargs['startTime'] < kwargs['endTime']
        assert 'filterPattern' not in kwargs  # Do not hide candidate leak events.
        if self.empty_all:
            return {'events': []}
        if self.cycle or (self.empty_first and 'nextToken' not in kwargs):
            return {'events': [], 'nextToken': 'unit-page-token'}
        event = {'eventId': 'unit-event', 'timestamp': kwargs['startTime'],
                 'message': self.message if kwargs['logGroupName'] == operator.LAMBDA_GROUP else '{"status":403}'}
        return {'events': [event, dict(event)] if self.duplicate else [event]}


class LogScan83Tests(unittest.TestCase):
    def scan(self, cloud):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result = operator.scan(cloud, cloud, cloud)
        self.output = output.getvalue()
        return result

    def test_clean_lambda_only_is_bounded_and_reports_scope_limits(self):
        cloud = Cloud()
        result = self.scan(cloud)
        self.assertEqual(len(result), 2)
        self.assertIn('BOUNDED LOG SCAN PASSED', self.output)
        self.assertIn('Lambda logs only', self.output)
        self.assertNotIn(cloud.message, self.output)
        self.assertNotIn('NEVER_PRINT_CONFIG', self.output)
        self.assertEqual([name for name, _ in cloud.calls], ['get_function_configuration', 'get_stage',
                                                          'filter_log_events', 'filter_log_events'])

    def test_configured_gateway_destination_is_scanned_without_arn_output(self):
        cloud = Cloud(gateway_logs=True)
        result = self.scan(cloud)
        self.assertEqual(len(result), 4)
        self.assertNotIn('arn:aws:', self.output)
        self.assertNotIn('/coed-api-access', self.output)
        self.assertIn('"APIGatewayAccessLogsConfigured": true', self.output)

    def test_private_material_stops_and_never_prints_messages(self):
        messages = [
            'Bearer PRIVATE_CANARY_123456789',
            'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJVTklUX0NBTkFSWSJ9.c2lnbmF0dXJlMTIzNDU2Nzg5',
            '{"password":"UNIT_PRIVATE_CANARY"}', 'postgresql://UNIT_PRIVATE_CANARY@host/db',
            '{"external_subject":"UNIT_PRIVATE_CANARY"}', 'UNIT_PRIVATE_CANARY@student.example.com',
            '{"sub":"UNIT_PRIVATE_CANARY"}', '{"student_number":"SMOKE830001"}',
            '{"sourceIp":"192.0.2.1"}', operator.LAMBDA_GROUP + ' TESTPR730001',
        ]
        for message in messages:
            cloud = Cloud(); cloud.message = message + '\nSTART RequestId: runtime-id'
            with self.subTest(message=message), contextlib.redirect_stdout(io.StringIO()) as output, \
                    self.assertRaisesRegex(operator.Stop, 'POTENTIAL_PRIVATE_LOG'):
                operator.scan(cloud, cloud, cloud)
            self.assertNotIn('UNIT_PRIVATE_CANARY', output.getvalue())
            self.assertNotIn(message, output.getvalue())
            self.assertNotIn('BOUNDED LOG SCAN PASSED', output.getvalue())

    def test_empty_pages_with_next_token_are_not_treated_as_completion(self):
        cloud = Cloud(); cloud.empty_first = True
        result = self.scan(cloud)
        self.assertEqual([row['Pages'] for row in result], [2, 2])
        self.assertEqual([row['Events'] for row in result], [1, 1])

    def test_pagination_cycle_fails_without_claiming_a_sample_pass(self):
        cloud = Cloud(); cloud.cycle = True
        with contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaisesRegex(operator.Stop, 'PAGINATION_CYCLE'):
            operator.scan(cloud, cloud, cloud)
        self.assertNotIn('BOUNDED LOG SCAN PASSED', output.getvalue())

    def test_all_budget_caps_stop_incomplete_results(self):
        for limits in [{'MAX_PAGES': 1}, {'MAX_EVENTS': 0}, {'MAX_BYTES': 1}]:
            with self.subTest(limits=limits), patch.multiple(operator, **limits), \
                    contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaisesRegex(operator.Stop, 'CAP_INCOMPLETE'):
                self.scan(Cloud())
            self.assertNotIn('BOUNDED LOG SCAN PASSED', output.getvalue())

    def test_no_events_cannot_pass(self):
        cloud = Cloud(); cloud.empty_all = True
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(operator.Stop, 'EMPTY_LOG_WINDOW'):
            operator.scan(cloud, cloud, cloud)

    def test_no_runtime_invocation_evidence_cannot_pass(self):
        cloud = Cloud(); cloud.message = 'INFO generic harmless line'
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(operator.Stop, 'NO_LAMBDA_INVOCATION'):
            operator.scan(cloud, cloud, cloud)

    def test_text_and_json_runtime_start_formats(self):
        self.assertTrue(operator.platform_start('START RequestId: runtime-id'))
        self.assertTrue(operator.platform_start('{"type":"platform.start","record":{"requestId":"unit"}}'))
        self.assertFalse(operator.platform_start('REPORT RequestId: unit'))
        cloud = Cloud(); cloud.message = '{"type":"platform.start"}'
        self.scan(cloud)

    def test_wrong_function_code_or_account_stops_before_log_reads(self):
        for field, value in [('FunctionArn', 'arn:wrong'), ('CodeSha256', 'wrong'), ('State', 'Pending')]:
            cloud = Cloud(); cloud.config[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(operator.Stop, 'LAMBDA_SOURCE_OR_ACCOUNT'):
                self.scan(cloud)
            self.assertFalse(any(name == 'filter_log_events' for name, _ in cloud.calls))

    def test_other_account_region_or_shared_gateway_destination_refused(self):
        for arn in ['arn:aws:logs:us-west-2:676101350279:log-group:/other',
                    'arn:aws:logs:us-east-1:000000000000:log-group:/other',
                    'arn:aws:logs:us-east-1:676101350279:log-group:' + operator.LAMBDA_GROUP]:
            cloud = Cloud(gateway_logs=True); cloud.stage['AccessLogSettings']['DestinationArn'] = arn
            with self.subTest(arn=arn), self.assertRaises(operator.Stop):
                self.scan(cloud)
            self.assertFalse(any(name == 'filter_log_events' for name, _ in cloud.calls))

    def test_duplicate_events_not_counted_twice(self):
        cloud = Cloud(); cloud.duplicate = True
        result = self.scan(cloud)
        self.assertEqual([row['Events'] for row in result], [1, 1])

    def test_mask_like_records_are_reported_not_unmasked(self):
        cloud = Cloud(); cloud.message += '\nmasked=****'
        result = self.scan(cloud)
        self.assertEqual([row['MaskLikeRecords'] for row in result], [1, 1])
        self.assertIn('masked values', self.output)


if __name__ == '__main__':
    unittest.main()
