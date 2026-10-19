#!/usr/bin/env python3
"""Live negative mutation probes: fixed isolated #83 targets, never demo Plan writes."""
import argparse
from collections import namedtuple
from datetime import datetime, timezone
import getpass
import hashlib
import json
from pathlib import Path
import re
import sys
import types
import urllib.error
import urllib.request
import uuid

READER_SHA = '55e7e655a31f7471998fa88bb146d77ef04a6ed42a925a082dbd882e91bf2a18'
PREFIX = '83000000-0000-4000-8000-'
PLANS = tuple(PREFIX + f'{n:012d}' for n in (13, 23, 33, 43))
ROUND = PREFIX + '000000000090'
STATES = ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
CANARY = 'SMOKE83 negative mutation probe; must be denied'
Probe = namedtuple('Probe', 'label method path body expected')


class Stop(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Stop(code)


def load_reader():
    # Execute only reviewed exact bytes, not an arbitrary similarly named helper.
    folder = Path(__file__).resolve().parent
    path = folder / 'coed-read83.py'
    if not path.exists():
        path = folder / 'read-smoke83-roles.py'  # Repository/local-test name only.
    raw = path.read_bytes()
    require(len(raw) <= 65536 and hashlib.sha256(raw).hexdigest() == READER_SHA,
            'GET_HELPER_HASH_MISMATCH')
    module = types.ModuleType('coed_read83_reviewed')
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def encoded(value):
    return None if value is None else json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def build_probes(role, first_plan=None):
    require(role in ('ADVISOR', 'STUDENT', 'STAFF'), 'ROLE_INVALID')
    probes = []
    correlation = str(uuid.uuid4())

    def command(notes=False):
        result = {'expected_version': 1, 'operation_id': str(uuid.uuid4()), 'correlation_id': correlation}
        if notes:
            result['review_notes'] = CANARY
        return result

    def add(label, method, path, body=None, status=403):
        probes.append(Probe(label, method, path, encoded(body), status))

    if role == 'ADVISOR':
        require(isinstance(first_plan, dict) and first_plan.get('id') == PLANS[0], 'FIXTURE_REFERENCE_MISSING')
        for field in ('company', 'position'):
            require(isinstance(first_plan.get(field), dict)
                    and isinstance(first_plan[field].get('id'), str)
                    and bool(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', first_plan[field]['id'])),
                    'FIXTURE_PUBLIC_REFERENCE_INVALID')
        for method in ('PATCH', 'PUT'):
            add('Advisor self-profile ' + method + ' denied', method, '/api/v3/students/me',
                {'preferred_name': CANARY})
        add('Advisor Plan create denied', 'POST', '/api/v3/plans', {
            'cycle_id': ROUND, 'company_id': first_plan['company']['id'],
            'position_id': first_plan['position']['id'], 'notes': CANARY,
            'operation_id': str(uuid.uuid4()), 'correlation_id': correlation})
        add('Advisor DRAFT content update denied', 'PATCH', '/api/v3/plans/' + PLANS[0],
            dict(command(), notes=CANARY))
        for label, index, action, notes in [('DRAFT submit', 0, 'submit', False),
                ('SUBMITTED start-review', 1, 'start-review', False),
                ('UNDER_REVIEW return', 2, 'return', True), ('UNDER_REVIEW approve', 2, 'approve', True)]:
            add('Advisor ' + label + ' denied', 'POST', '/api/v3/plans/' + PLANS[index] + '/' + action,
                command(notes))
        # Existing GET routes; unsupported methods must be exactly 405, not a
        # validation error, success, or generic role denial counted as equivalent.
        for method in ('POST', 'PATCH', 'PUT', 'DELETE'):
            add('Unsupported Advisor Plan ' + method, method, '/api/v3/advisor/plans/' + PLANS[0], status=405)
        for method in ('PUT', 'DELETE'):
            add('Unsupported canonical Plan ' + method, method, '/api/v3/plans/' + PLANS[0], status=405)
    elif role == 'STUDENT':
        # No own-profile PATCH and no Plan create: those would be valid demo
        # writes. Only existing foreign isolated DRAFT Plans may be targeted.
        for index in (0, 3):
            add(f'Other-owner DRAFT {index + 1} content update denied', 'PATCH', '/api/v3/plans/' + PLANS[index],
                dict(command(), notes=CANARY))
            add(f'Other-owner DRAFT {index + 1} submit denied', 'POST', '/api/v3/plans/' + PLANS[index] + '/submit',
                command())
    else:
        # Fixture 4 is DRAFT, not a valid review-transition state. Requiring exact
        # policy 403 proves denial BEFORE state validation; a 422 MUST fail.
        # These are supplemental, not valid-state Staff workflow acceptance.
        for action in ('start-review', 'return', 'approve'):
            add('Out-of-scope review policy ' + action + ' denied before state validation', 'POST',
                '/api/v3/plans/' + PLANS[3] + '/' + action, command(action in ('return', 'approve')))
    return tuple(probes)


class ProbeClient:
    def __init__(self, reader, token):
        self.reader = reader
        self.transport = reader.ReadClient(token)
        self.allowed = frozenset()

    def get(self, path):
        return self.transport.get(path)

    def arm(self, probes):
        require(not self.allowed and bool(probes), 'PROBE_ARMING_INVALID')
        fixed_targets = {('PATCH', '/api/v3/students/me'), ('PUT', '/api/v3/students/me'),
                         ('POST', '/api/v3/plans')}
        for plan in PLANS:
            fixed_targets.add(('PATCH', '/api/v3/plans/' + plan))
            for action in ('submit', 'start-review', 'return', 'approve'):
                fixed_targets.add(('POST', '/api/v3/plans/' + plan + '/' + action))
        for method in ('POST', 'PATCH', 'PUT', 'DELETE'):
            fixed_targets.add((method, '/api/v3/advisor/plans/' + PLANS[0]))
        for method in ('PUT', 'DELETE'):
            fixed_targets.add((method, '/api/v3/plans/' + PLANS[0]))
        require(all((p.method, p.path) in fixed_targets and p.expected in (403, 405)
                    and (p.body is None or isinstance(p.body, bytes) and len(p.body) <= 4096)
                    for p in probes), 'NON_FIXTURE_MUTATION_TARGET_REFUSED')
        self.allowed = frozenset((p.method, p.path, p.body, p.expected) for p in probes)

    def deny(self, probe):
        require((probe.method, probe.path, probe.body, probe.expected) in self.allowed,
                'UNREVIEWED_MUTATION_REFUSED')
        headers = {'Accept': 'application/json', 'Authorization': 'Bearer ' + self.transport._token}
        if probe.body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.reader.API + probe.path, method=probe.method,
                                         data=probe.body, headers=headers)
        try:
            response = self.transport._opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        except Exception:
            raise Stop('MUTATION_TRANSPORT_FAILED_OUTCOME_UNKNOWN_CHECK_DB_NO_RETRY') from None
        with response:
            require(response.geturl() == self.reader.API + probe.path, 'MUTATION_RESPONSE_TARGET_REFUSED')
            require(response.code == probe.expected, 'MUTATION_HTTP_' + str(response.code)
                    + '_EXPECTED_' + str(probe.expected) + '_CHECK_DB_NO_RETRY')
            raw = response.read(self.reader.MAX_BODY + 1)
            require(len(raw) <= self.reader.MAX_BODY and self.transport._token.encode() not in raw,
                    'MUTATION_RESPONSE_UNSAFE_VALUES_WITHHELD')
            try:
                payload = json.loads(raw)
            except Exception:
                raise Stop('MUTATION_ERROR_JSON_INVALID_VALUES_WITHHELD') from None
            require(isinstance(payload, dict), 'MUTATION_ERROR_ENVELOPE_INVALID')
            if probe.expected == 403:
                self.reader.safe_denial(payload)
            else:
                error = payload.get('error')
                require(set(payload) == {'error'} and isinstance(error, dict)
                        and set(error).issubset({'code', 'message', 'details'})
                        and error.get('code') == 'METHOD_NOT_ALLOWED'
                        and error.get('message') == 'Method not allowed.' and error.get('details') is None,
                        'UNSUPPORTED_METHOD_ERROR_UNSAFE_VALUES_WITHHELD')


def run_matrix(role, token, baseline_captured=False, reader=None, client=None):
    require(baseline_captured is True, 'CAPTURE_PRIVATE_DB_BASELINE_FIRST')
    require(role in ('ADVISOR', 'STUDENT', 'STAFF'), 'ROLE_INVALID')
    reader = reader or load_reader()
    reader.validate_token(token)
    client = client or ProbeClient(reader, token)
    matrix = reader.Matrix(client)
    print('StartedUTC: ' + datetime.now(timezone.utc).isoformat())
    print('FIXED ISOLATED NEGATIVE PROBES; no demo Plan write targets; API: ' + reader.API)
    print('Any unexpected response/timeout: STOP; verify original DB baseline; do not retry/reset.')
    session = matrix.check('trusted active role', '/api/v3/me', validate=lambda data:
                           isinstance(data, dict) and data.get('role') == role
                           and isinstance(data.get('user'), dict) and data['user'].get('role') == role
                           and data['user'].get('accountStatus') == 'ACTIVE')
    before = []
    if role == 'ADVISOR':
        require(session['user'].get('id') == reader.ADVISOR, 'WRONG_SYNTHETIC_ADVISOR_ACCOUNT')
        require(session.get('scope', {}).get('assignedStudentCount') == 3, 'ASSIGNMENT_COUNT_MISMATCH')
        matrix.check('exact three assigned fixture Students', '/api/v3/advisor/students?pageSize=100',
                     validate=lambda data: reader.exact_ids(data, reader.STUDENTS[:3]))
        for index in range(3):
            before.append(matrix.check(f'valid-state v1 fixture preflight {index + 1}',
                '/api/v3/advisor/plans/' + PLANS[index], validate=lambda data, i=index:
                isinstance(data, dict) and data.get('id') == PLANS[i] and data.get('version') == 1
                and data.get('status') == STATES[i] and data.get('cycle_id') == ROUND))
    elif role == 'STUDENT':
        matrix.check('expected synthetic Student; no own writes', '/api/v3/students/me', validate=lambda data:
                     isinstance(data, dict) and data.get('student_number') == 'TESTPR730001'
                     and data.get('id') == session.get('studentId') and data.get('id') not in reader.STUDENTS)
        for index in (0, 3):
            matrix.check(f'foreign fixture read preflight {index + 1}', '/api/v3/plans/' + PLANS[index], 403)
    else:
        matrix.check('outside fixture absent from Staff search', '/api/v3/staff/plans?q=SMOKE830004',
                     validate=lambda data: reader.exact_ids(data, []))
        matrix.check('outside fixture detail policy denied', '/api/v3/staff/plans/' + PLANS[3], 403)
    probes = build_probes(role, before[0] if before else None)
    client.arm(probes)
    for index, probe in enumerate(probes, 1):
        print(f'PROBE {index:02d} {probe.label}', flush=True)
        client.deny(probe)
        print(f'PASS DENIAL {index:02d}: HTTP {probe.expected}')
    if role == 'ADVISOR':
        for index, original in enumerate(before):
            matrix.check(f'assigned fixture full detail unchanged {index + 1}',
                         '/api/v3/advisor/plans/' + PLANS[index], validate=lambda data, wanted=original: data == wanted)
    print('FinishedUTC: ' + datetime.now(timezone.utc).isoformat())
    print(f'{role} MUTATION DENIALS PASSED: {len(probes)}/{len(probes)}; DB BASELINE VERIFY STILL REQUIRED.')
    if role == 'STAFF':
        print('Staff probes establish policy 403 before state validation, not valid-state review acceptance.')
    print('Do not claim no DB change until the original VPC checkpoint verify passes; no redeploy/reset needed.')
    return len(probes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', required=True, choices=['ADVISOR', 'STUDENT', 'STAFF'])
    parser.add_argument('--baseline-captured', required=True, action='store_true',
                        help='Owner confirms the original VPC baseline capture passed; not cryptographic proof.')
    args = parser.parse_args()
    require(sys.stdin.isatty() and sys.stderr.isatty(), 'INTERACTIVE_TERMINAL_REQUIRED')
    reader = load_reader()  # Hash check before token prompt or network access.
    print('Only owner-authorized synthetic accounts/fixtures; keep original DB baseline in VPC CloudShell.')
    print('Unexpected success could change an isolated fixture: STOP and check DB; never retry/reset.')
    token = getpass.getpass('MAIN OAuth Access Token (hidden; no chat/files/args): ')
    try:
        run_matrix(args.role, token, args.baseline_captured, reader=reader)
    finally:
        token = None


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('STOP: INTERRUPTED_OUTCOME_UNCONFIRMED_CHECK_DB_NO_RETRY', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Z0-9_]+', str(error)) \
            else 'UNEXPECTED_FAILURE_VALUES_WITHHELD'
        print('STOP: ' + code + '; no success claimed.', file=sys.stderr)
        print('Verify the ORIGINAL VPC DB baseline before any retry. Do not reset fixtures or recapture baseline.', file=sys.stderr)
        sys.exit(1)
