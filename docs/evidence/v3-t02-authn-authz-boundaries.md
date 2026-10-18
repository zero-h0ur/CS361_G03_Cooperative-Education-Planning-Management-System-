# V3-T02 Verification Evidence: Authentication & Authorization Boundaries (Issue #79)

## 1. Verification Command

```bash
npm run test:v3-t02
```

Included in `npm test` and the `V3 verification` GitHub Actions workflow alongside:

- `npm run test:auth` (`tests/auth-context.test.js`)
- `npm run test:authz` (`tests/authorization.test.js`)
- `npm run test:session` (`tests/session-me.test.js`)
- `npm run test:profile` (`tests/student-profile.test.js`)
- `npm run test:plan` (`tests/student-plan.test.js`)
- `npm run test:staff` (`tests/staff-review-queue.test.js`)
- `npm run test:submit` (`tests/plan-submission.test.js`)
- `npm run test:review` (`tests/staff-review-commands.test.js`)
- `npm run test:history` (`tests/plan-history.test.js`)
- `npm run test:advisor` (`tests/advisor-read.test.js`, including PostgreSQL/Lambda integration)

## 2. Permission Matrix & Acceptance Criteria Coverage

| Acceptance Criterion | Verified Scenarios | Status |
| --- | --- | --- |
| Every protected endpoint rejects unauthenticated requests | All 20 currently registered routes, including all four Advisor routes, return `401 UNAUTHORIZED`; a registration coverage guard detects missing routes in the matrix | PASS |
| Malformed, expired, wrong issuer/audience, ID token, missing scope, and tampered tokens rejected | All seven cases use real RS256 keypairs and `TokenValidator` and are checked at every protected endpoint (`401 UNAUTHORIZED`) | PASS |
| Trusted identity linking | Unknown subject, revoked identity, disabled account and Student identity without linked profile return uniform `403 FORBIDDEN` at all 20 endpoints | PASS |
| Client cannot spoof user/role/scope | Spoofed `X-User-Id`, `X-Role`, `X-Staff-Scope` headers and body fields (`student_id`, `role`, `department`) rejected (`403`/`400`) | PASS |
| Student ownership and Staff/Advisor scope enforced server-side | Student A denied on Student B plan (`403`); Out-of-scope EE Staff denied on CPE plan (`403`); In-scope CPE Staff allowed (`200`) | PASS |
| Advisor can read assigned data only and all Advisor mutations are rejected | Real HTTP requests exercise all four assigned reads (`200`), guessed/unassigned resources (`403`), Student/Staff/Admin cross-role and spoofed role claims (`403`), next-request assignment revocation, and all eight registered mutation endpoints (`403`) | PASS |
| Errors and logs do not leak tokens or private data in tested cases | Assertions inspect responses, captured console log/warn/error calls and audit entries; Advisor serializers exclude identity, institutional email, operation IDs and Staff review comments | PASS |
| Public V2 Company Directory remains accessible without authentication | Anonymous `GET /api/health`, `/api/companies`, `/api/companies/:id`, `/api/companies/:id/positions`, and `/api/positions/:id` return `200 OK` | PASS |

## 3. Latest Local Result

- Date: 2026-10-19
- `npm run test:v3-t02`: 55/55 passed
- Full regression with PostgreSQL integration tests: 575/575 passed, no skipped tests
- `git diff --check`: passed

PR #107 / Issue #68 is merged. The Advisor dependency is resolved.

The HTTP suite uses real token validation, identity resolution, authorization, handlers and serializers with in-memory repositories. `test:advisor` additionally verifies assignment SQL, exact expiry boundaries and revocation with PostgreSQL. AWS verification remains in #83.

## 4. Endpoint permission matrix

All rows require a valid access token and an active linked internal identity. Invalid credentials are rejected before endpoint-specific authorization.

| Method/path | Positive authorization | Negative coverage |
| --- | --- | --- |
| `GET /api/v3/me` | Active linked user | Unknown/revoked/disabled/unlinked identities |
| `GET/PATCH/PUT /api/v3/students/me` | Student owner | Forged official fields; Advisor mutation |
| `POST/GET /api/v3/plans` | Student owner | Advisor create; other roles in `test:plan` |
| `GET/PATCH /api/v3/plans/:id` | Student owner | Foreign owner and role boundaries in `test:plan`; Advisor mutation |
| `GET /api/v3/plans/:id/history` | Student owner | Foreign owner and other roles in `test:history` |
| `GET /api/v3/staff/{students,plans,review-queue}` | Scoped Staff | Student/Advisor/Admin/no-scope in `test:staff` |
| `POST /api/v3/plans/:id/submit` | Student owner | Foreign owner, Staff and Advisor |
| `POST /api/v3/plans/:id/{start-review,return,approve}` | Staff in operational scope | Student/Advisor and out-of-scope Staff |
| `GET /api/v3/advisor/students` | Advisor, scoped list | Other roles/spoofing; revoked assignment yields empty scoped list |
| `GET /api/v3/advisor/students/:id` | Assigned Advisor | Other roles, unassigned/guessed IDs, revoked assignment |
| `GET /api/v3/advisor/students/:id/plans` | Assigned Advisor | Other roles, unassigned Student, revoked assignment |
| `GET /api/v3/advisor/plans/:id` | Assigned Advisor | Other roles, unassigned/guessed Plan, revoked assignment |

## 5. CI evidence

`.github/workflows/v3-verification.yml` runs `npm ci` and the full test command against PostgreSQL 16 on pull requests and pushes to `main`. It uploads the test log as `v3-verification-<run_id>-<attempt>` for 14 days, including logs on test failure.

The latest recorded result above is local. A successful GitHub Actions run must be confirmed after pushing this change; no remote CI success is claimed here.
