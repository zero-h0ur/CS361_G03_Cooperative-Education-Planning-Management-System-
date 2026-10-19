#!/usr/bin/env python3
"""Owner-operated live GET-only role matrix. No AWS credentials, writes or token files."""
import argparse
import base64
from datetime import datetime, timezone
import getpass
import json
import re
import sys
import time
import urllib.error
import urllib.request

API = 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com'
ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_WzzG10dCP'
CLIENT = '3r7a2qjn98v31r1f6vee8ag8e5'
PREFIX = '83000000-0000-4000-8000-'
STUDENTS = tuple(PREFIX + f'{n:012d}' for n in (12, 22, 32, 42))
PLANS = tuple(PREFIX + f'{n:012d}' for n in (13, 23, 33, 43))
ADVISOR = PREFIX + '000000000001'
UUID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')
MAX_BODY = 512 * 1024


class Stop(RuntimeError):
    """Only fixed, value-free failure codes may be reported to the console."""


def require(condition, code):
    if not condition:
        raise Stop(code)


def validate_token(token, now=None):
    # These unverified claims are target/freshness guards ONLY. The real API
    # authenticates the signature and /me supplies the trusted role below.
    require(isinstance(token, str) and 1 <= len(token) <= 16384
            and re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token),
            'ACCESS_TOKEN_FORMAT_INVALID')
    try:
        segment = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
    except Exception:
        raise Stop('ACCESS_TOKEN_PAYLOAD_INVALID') from None
    require(isinstance(claims, dict) and claims.get('iss') == ISSUER
            and claims.get('client_id') == CLIENT and claims.get('token_use') == 'access',
            'ACCESS_TOKEN_TARGET_INVALID')
    require(isinstance(claims.get('scope'), str)
            and 'coed-api/access' in claims['scope'].split(), 'OAUTH_ACCESS_SCOPE_REQUIRED')
    require(type(claims.get('exp')) is int
            and claims['exp'] > (time.time() if now is None else now) + 180,
            'TOKEN_EXPIRED_OR_TOO_CLOSE_TO_EXPIRY_LOGIN_AGAIN')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Stop('REDIRECT_REFUSED')


class ReadClient:
    def __init__(self, token, opener=None):
        self._token = token
        # Ignore proxy environment settings. Never forward this token on a
        # redirect, to another host, or via an application-specified proxy.
        self._opener = opener or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path):
        require(isinstance(path, str) and path.startswith('/api/v3/')
                and not any(c in path for c in ('\r', '\n', '#', '://', '..')),
                'REQUEST_TARGET_REFUSED')
        request = urllib.request.Request(API + path, method='GET', headers={
            'Accept': 'application/json', 'Authorization': 'Bearer ' + self._token})
        try:
            response = self._opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        except Stop:
            raise
        except Exception:
            raise Stop('NETWORK_OR_TLS_FAILURE_VALUES_WITHHELD') from None
        with response:
            require(response.geturl() == API + path, 'RESPONSE_TARGET_REFUSED')
            raw = response.read(MAX_BODY + 1)
            require(len(raw) <= MAX_BODY, 'RESPONSE_TOO_LARGE_VALUES_WITHHELD')
            require(self._token.encode() not in raw, 'TOKEN_ECHO_DETECTED_VALUES_WITHHELD')
            try:
                payload = json.loads(raw)
            except Exception:
                raise Stop('NON_JSON_RESPONSE_VALUES_WITHHELD') from None
            require(isinstance(payload, dict), 'INVALID_ENVELOPE_VALUES_WITHHELD')
            return response.code, payload


def safe_denial(payload):
    raw = json.dumps(payload)
    require(set(payload).issubset({'error', 'message'}) and 'data' not in payload,
            'DENIAL_ENVELOPE_UNSAFE_VALUES_WITHHELD')
    pattern = (r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|'
               r'postgres(?:ql)?://|external_subject|external_issuer|institutional_email|'
               r'student_number|preferred_name|SMOKE83|TESTPR73|@|'
               r'BEGIN [A-Z ]*PRIVATE KEY|\bat\s+\S+\s+\([^\n]*:\d+:\d+\)')
    require(not re.search(pattern, raw, re.I), 'DENIAL_PRIVATE_OR_DEBUG_MATERIAL_VALUES_WITHHELD')
    # All expected denials in this GET-only matrix are application-policy 403s.
    # An exact generic allowlist avoids treating unrecognized private text as safe.
    error = payload.get('error')
    require(set(payload) == {'error'} and isinstance(error, dict)
            and set(error).issubset({'code', 'message', 'details'})
            and error.get('code') == 'FORBIDDEN' and error.get('message') == 'Access denied.'
            and error.get('details') is None, 'NON_GENERIC_DENIAL_VALUES_WITHHELD')


class Matrix:
    def __init__(self, client):
        self.client = client
        self.passed = 0

    def check(self, label, path, status=200, validate=None):
        actual, payload = self.client.get(path)
        require(actual == status, 'UNEXPECTED_HTTP_' + str(actual) + '_EXPECTED_' + str(status))
        if status != 200:
            safe_denial(payload)
        else:
            require('data' in payload, 'DATA_ENVELOPE_MISSING_VALUES_WITHHELD')
        if validate:
            require(validate(payload.get('data')), 'READ_POSTCONDITION_FAILED_VALUES_WITHHELD')
        self.passed += 1
        print(f'PASS {self.passed:02d} {label}: HTTP {status}')
        return payload.get('data')


def exact_ids(data, expected):
    return (isinstance(data, list) and len(data) == len(expected)
            and all(isinstance(row, dict) for row in data)
            and {row.get('id') for row in data} == set(expected))


def run_matrix(role, token, client=None):
    require(role in ('STUDENT', 'STAFF', 'ADVISOR'), 'ROLE_INVALID')
    validate_token(token)
    matrix = Matrix(client or ReadClient(token))
    print('StartedUTC: ' + datetime.now(timezone.utc).isoformat())
    print('GET ONLY; response values/token/claims withheld. API: ' + API)
    session = matrix.check('trusted API session role', '/api/v3/me', validate=lambda data:
                           isinstance(data, dict) and data.get('role') == role
                           and isinstance(data.get('user'), dict)
                           and data['user'].get('role') == role
                           and data['user'].get('accountStatus') == 'ACTIVE')
    if role == 'ADVISOR':
        require(session['user'].get('id') == ADVISOR, 'WRONG_SYNTHETIC_ADVISOR_ACCOUNT')
        require(session.get('scope', {}).get('assignedStudentCount') == 3,
                'ADVISOR_ASSIGNMENT_COUNT_MISMATCH')
        matrix.check('exact three assigned Students', '/api/v3/advisor/students?pageSize=100',
                     validate=lambda data: exact_ids(data, STUDENTS[:3]))
        for index in range(3):
            matrix.check(f'assigned Student {index + 1}', '/api/v3/advisor/students/' + STUDENTS[index],
                         validate=lambda data, i=index: isinstance(data, dict)
                         and data.get('id') == STUDENTS[i])
            matrix.check(f'assigned Student Plans {index + 1}',
                         '/api/v3/advisor/students/' + STUDENTS[index] + '/plans?pageSize=100',
                         validate=lambda data, i=index: exact_ids(data, [PLANS[i]]))
            matrix.check(f'assigned Plan {index + 1}', '/api/v3/advisor/plans/' + PLANS[index],
                         validate=lambda data, i=index: isinstance(data, dict)
                         and data.get('id') == PLANS[i])
        matrix.check('unassigned Student denied', '/api/v3/advisor/students/' + STUDENTS[3], 403)
        matrix.check('unassigned Student Plans denied',
                     '/api/v3/advisor/students/' + STUDENTS[3] + '/plans', 403)
        matrix.check('unassigned Plan denied', '/api/v3/advisor/plans/' + PLANS[3], 403)
        matrix.check('Staff search namespace denied', '/api/v3/staff/students', 403)
        matrix.check('Staff Plan namespace denied', '/api/v3/staff/plans/' + PLANS[0], 403)
        matrix.check('Student self-profile namespace denied', '/api/v3/students/me', 403)
    elif role == 'STAFF':
        for kind, ids in (('students', STUDENTS), ('plans', PLANS)):
            matrix.check('in-scope fixture ' + kind, '/api/v3/staff/' + kind + '?q=SMOKE83&pageSize=100',
                         validate=lambda data, ids=ids: exact_ids(data, ids[:3]))
            matrix.check('outside fixture excluded from ' + kind,
                         '/api/v3/staff/' + kind + '?q=SMOKE830004&academic_year=2569',
                         validate=lambda data: exact_ids(data, []))
        for index in range(3):
            matrix.check(f'in-scope Plan detail {index + 1}', '/api/v3/staff/plans/' + PLANS[index],
                         validate=lambda data, i=index: isinstance(data, dict)
                         and data.get('id') == PLANS[i])
            matrix.check(f'in-scope Plan history {index + 1}',
                         '/api/v3/staff/plans/' + PLANS[index] + '/history',
                         validate=lambda data: isinstance(data, list))
        matrix.check('out-of-scope Plan denied', '/api/v3/staff/plans/' + PLANS[3], 403)
        matrix.check('out-of-scope Plan history denied', '/api/v3/staff/plans/' + PLANS[3] + '/history', 403)
        matrix.check('Student self-profile namespace denied', '/api/v3/students/me', 403)
        matrix.check('Advisor namespace denied', '/api/v3/advisor/students', 403)
    else:
        profile = matrix.check('expected synthetic Student own profile', '/api/v3/students/me',
                               validate=lambda data: isinstance(data, dict)
                               and data.get('student_number') == 'TESTPR730001'
                               and data.get('id') == session.get('studentId'))
        own = matrix.check('own Plan list', '/api/v3/plans?pageSize=100',
                           validate=lambda data: isinstance(data, list) and bool(data)
                           and all(isinstance(row, dict) and isinstance(row.get('id'), str)
                                   and UUID.fullmatch(row['id']) and row['id'] not in PLANS for row in data))
        # These are existing own Plans; GET only. Never select them for mutations.
        own_id = own[0]['id']
        matrix.check('own Plan detail', '/api/v3/plans/' + own_id,
                     validate=lambda data: isinstance(data, dict) and data.get('id') == own_id)
        matrix.check('own Plan history', '/api/v3/plans/' + own_id + '/history',
                     validate=lambda data: isinstance(data, list))
        for index in (0, 3):
            matrix.check(f'other Student Plan {index + 1} denied', '/api/v3/plans/' + PLANS[index], 403)
            matrix.check(f'other Student Plan history {index + 1} denied',
                         '/api/v3/plans/' + PLANS[index] + '/history', 403)
        matrix.check('Staff namespace denied', '/api/v3/staff/students', 403)
        matrix.check('Advisor namespace denied', '/api/v3/advisor/students', 403)
    print('FinishedUTC: ' + datetime.now(timezone.utc).isoformat())
    print(f'{role} READ MATRIX PASSED: {matrix.passed}/{matrix.passed}; GET only; no data changed.')
    print('Mutation denial, before/after DB comparison, real expiry and log sampling remain separate gates.')
    return matrix.passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', required=True, choices=['STUDENT', 'STAFF', 'ADVISOR'])
    args = parser.parse_args()
    require(sys.stdin.isatty(), 'INTERACTIVE_TERMINAL_REQUIRED')
    print('Use your own synthetic test account on MAIN; paste Access Token ONLY at the hidden prompt.')
    print('Never paste tokens into chat, shell command arguments, files or PRs.')
    token = getpass.getpass('MAIN OAuth Access Token (hidden; NOT ID/refresh token or password): ')
    try:
        run_matrix(args.role, token)
    finally:
        token = None  # Best-effort release; Python cannot promise secure memory zeroization.


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('STOP: INPUT_CANCELLED', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('STOP: UNEXPECTED_FAILURE_VALUES_WITHHELD', file=sys.stderr)
        sys.exit(1)
