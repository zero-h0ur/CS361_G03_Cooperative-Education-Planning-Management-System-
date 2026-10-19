#!/usr/bin/env python3
"""Read bounded deployed-smoke logs in memory; print aggregate findings only."""
from datetime import datetime
import json
import logging
import re
import sys

REGION = 'us-east-1'
ACCOUNT = '676101350279'
FUNCTION = 'coed-api'
API_ID = 'qtqlsb1aec'
FUNCTION_ARN = f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}'
CODE_SHA = 'jw6Koutmpa3kvfYUIr5nQG0bTQw3bpfkIalCB8+/OKI='
LAMBDA_GROUP = '/aws/lambda/coed-api'
WINDOWS = (
    ('public-regression', '2026-10-19T19:43:00+00:00', '2026-10-19T19:45:00+00:00'),
    ('authenticated-role-and-denial', '2026-10-19T20:27:00+00:00', '2026-10-19T20:51:00+00:00'),
)
MAX_PAGES = 40
MAX_EVENTS = 20000
MAX_BYTES = 16 * 1024 * 1024
PATTERNS = {
    'jwt_like': r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}',
    'bearer_value': r'\bBearer\s+[A-Za-z0-9_.~+/=-]{6,}',
    'credential_material': r'postgres(?:ql)?://|BEGIN [A-Z ]*PRIVATE KEY|'
        r'["\s](?:password|secretstring|client_secret|database_url)["\s]*[:=]',
    'private_fields_or_claims': r'\b(?:external_subject|external_issuer|institutional_email|'
        r'student_number|preferred_name|full_name|source_?ip)\b|'
        r'["\s](?:sub|username|email|access_token|id_token|refresh_token|authorization)["\s]*[:=]',
    'email_like': r'[A-Z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
    'synthetic_private_canary': r'TESTPR730001|SMOKE83|PR73 Secrets|PR73 Test Student|'
        r'83000000-0000-4000-8000-|coed-smoke83-invalid-token-canary',
}
COMPILED = {name: re.compile(pattern, re.I) for name, pattern in PATTERNS.items()}


class Stop(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Stop(code)


def milliseconds(value):
    return int(datetime.fromisoformat(value).timestamp() * 1000)


def platform_start(message):
    if re.search(r'^START RequestId:', message, re.M):
        return True
    try:
        value = json.loads(message)
    except (ValueError, TypeError):
        return False
    return isinstance(value, dict) and value.get('type') == 'platform.start'


def gateway_group(stage):
    require(isinstance(stage, dict) and stage.get('StageName') == '$default', 'API_STAGE_TARGET_MISMATCH')
    settings = stage.get('AccessLogSettings')
    if not settings:
        return None
    arn = settings.get('DestinationArn') if isinstance(settings, dict) else None
    require(isinstance(arn, str), 'ACCESS_LOG_DESTINATION_INVALID')
    match = re.fullmatch(r'arn:aws:logs:' + REGION + ':' + ACCOUNT
                         + r':log-group:([A-Za-z0-9_./#-]{1,512})(?::\*)?', arn)
    require(match is not None, 'ACCESS_LOG_DESTINATION_OUTSIDE_EXPECTED_ACCOUNT_OR_REGION')
    require(match.group(1) != LAMBDA_GROUP, 'SHARED_LOG_DESTINATION_REQUIRES_REVIEW')
    return match.group(1)


def scan_window(logs, group, label, start, end, budget):
    start_ms, end_ms = milliseconds(start), milliseconds(end)
    token = None
    tokens = set()
    seen = set()
    counts = {name: 0 for name in COMPILED}
    events = starts = masked = pages = 0
    while True:
        require(budget['pages'] < MAX_PAGES, 'LOG_PAGE_CAP_INCOMPLETE_NO_PASS')
        kwargs = {'logGroupName': group, 'startTime': start_ms, 'endTime': end_ms,
                  'limit': 1000, 'unmask': False}
        if token:
            kwargs['nextToken'] = token
        response = logs.filter_log_events(**kwargs)
        budget['pages'] += 1
        pages += 1
        require(isinstance(response, dict) and isinstance(response.get('events'), list), 'LOG_PAGE_SCHEMA_INVALID')
        for event in response['events']:
            require(isinstance(event, dict) and isinstance(event.get('eventId'), str)
                    and isinstance(event.get('message'), str) and type(event.get('timestamp')) is int,
                    'LOG_EVENT_SCHEMA_INVALID_VALUES_WITHHELD')
            require(start_ms <= event['timestamp'] <= end_ms, 'LOG_EVENT_OUTSIDE_PINNED_WINDOW')
            identity = event['eventId']
            if identity in seen:
                continue
            seen.add(identity)
            message = event['message']
            budget['events'] += 1
            budget['bytes'] += len(message.encode())
            require(budget['events'] <= MAX_EVENTS and budget['bytes'] <= MAX_BYTES,
                    'LOG_SIZE_CAP_INCOMPLETE_NO_PASS')
            events += 1
            starts += int(platform_start(message))
            masked += int('****' in message)
            for name, pattern in COMPILED.items():
                counts[name] += int(pattern.search(message) is not None)
        token = response.get('nextToken')
        if not token:
            break
        require(isinstance(token, str) and token not in tokens, 'LOG_PAGINATION_CYCLE_INCOMPLETE_NO_PASS')
        tokens.add(token)
        # Empty pages may still have nextToken. Continue until exhausted/capped.
    return {'Window': label, 'StartUTC': start, 'RequestedEndUTC': end,
            'Pages': pages, 'Events': events, 'LambdaStarts': starts,
            'MaskLikeRecords': masked, 'FindingRecordCounts': counts}


def scan(lambda_client, gateway, logs):
    config = lambda_client.get_function_configuration(FunctionName=FUNCTION)
    require(config.get('FunctionArn') == FUNCTION_ARN and config.get('CodeSha256') == CODE_SHA
            and config.get('State') == 'Active' and config.get('LastUpdateStatus') == 'Successful',
            'LAMBDA_SOURCE_OR_ACCOUNT_MISMATCH')
    destination = gateway_group(gateway.get_stage(ApiId=API_ID, StageName='$default'))
    groups = [('Lambda', LAMBDA_GROUP)]
    if destination:
        groups.append(('APIGatewayAccess', destination))
    print('CURRENT LAMBDA CODE/ACCOUNT VERIFIED; SDK log output suppressed; raw messages withheld.')
    budget = {'pages': 0, 'events': 0, 'bytes': 0}
    summaries = []
    for kind, group in groups:
        for label, start, end in WINDOWS:
            summary = scan_window(logs, group, label, start, end, budget)
            summary['LogSource'] = kind
            summaries.append(summary)
    # Print only fixed-key numerical aggregate data, never event messages, stream
    # names, event IDs, request IDs, destination ARN, query strings or errors.
    print(json.dumps({'APIGatewayAccessLogsConfigured': destination is not None,
                      'Samples': summaries, 'TotalEvents': budget['events'],
                      'TotalMessageBytes': budget['bytes']}, indent=2))
    require(all(summary['Events'] > 0 for summary in summaries), 'EMPTY_LOG_WINDOW_NO_COVERAGE_NO_PASS')
    require(all(summary['LambdaStarts'] > 0 for summary in summaries if summary['LogSource'] == 'Lambda'),
            'NO_LAMBDA_INVOCATION_EVIDENCE_NO_PASS')
    require(not any(count for summary in summaries for count in summary['FindingRecordCounts'].values()),
            'POTENTIAL_PRIVATE_LOG_MATERIAL_STOP_VALUES_WITHHELD')
    print('BOUNDED LOG SCAN PASSED: no configured token/PII/canary patterns found in these accessible records.')
    print('Heuristic sample only, not a guarantee for all PII, all services, masked values or all history.')
    if not destination:
        print('API Gateway access logs are not configured on this stage; Lambda logs only. No logging setting changed.')
    print('No raw log files saved; no credentials requested; no deployment, data or AWS settings changed.')
    return summaries


def main():
    import boto3
    from botocore.config import Config
    logging.getLogger().setLevel(logging.CRITICAL)
    session = boto3.Session(region_name=REGION)
    config = Config(connect_timeout=5, read_timeout=20, retries={'total_max_attempts': 2})
    scan(session.client('lambda', config=config), session.client('apigatewayv2', config=config),
         session.client('logs', config=config))


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        print('STOP: ' + str(error) + '; no log acceptance claimed; do not paste raw logs.', file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('STOP: INTERRUPTED_INCOMPLETE_NO_PASS', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        code = getattr(error, 'response', {}).get('Error', {}).get('Code')
        safe = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_]+', code) else type(error).__name__
        print('STOP: AWS_OR_SCAN_' + safe + '; details/logs withheld; no acceptance claimed.', file=sys.stderr)
        sys.exit(1)
