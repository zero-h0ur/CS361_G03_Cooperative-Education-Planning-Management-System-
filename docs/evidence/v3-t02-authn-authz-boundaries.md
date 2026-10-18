# V3-T02 Verification Evidence: Authentication & Authorization Boundaries (Issue #79)

## 1. Verification Command

```bash
npm run test:v3-t02
```

Also included in the canonical CI test command (`npm test`) alongside:
- `npm run test:auth` (`tests/auth-context.test.js`)
- `npm run test:authz` (`tests/authorization.test.js`)
- `npm run test:session` (`tests/session-me.test.js`)
- `npm run test:profile` (`tests/student-profile.test.js`)
- `npm run test:plan` (`tests/student-plan.test.js`)
- `npm run test:staff` (`tests/staff-review-queue.test.js`)
- `npm run test:submit` (`tests/plan-submission.test.js`)
- `npm run test:review` (`tests/staff-review-commands.test.js`)
- `npm run test:history` (`tests/plan-history.test.js`)

## 2. Permission Matrix & Acceptance Criteria Coverage

| Acceptance Criterion | Verified Scenarios | Status |
| --- | --- | --- |
| Every protected endpoint rejects unauthenticated requests | All 16 currently registered routes covering session, profile, own Plan CRUD/list, submission/history, Staff lists/queue, and review commands return `401 UNAUTHORIZED` | PASS |
| Malformed, expired, wrong issuer/audience, ID token, missing scope, and tampered tokens rejected | Verified with real RS256 keypairs and `TokenValidator` (`401 UNAUTHORIZED`) | PASS |
| Client cannot spoof user/role/scope | Spoofed `X-User-Id`, `X-Role`, `X-Staff-Scope` headers and body fields (`student_id`, `role`, `department`) rejected (`403`/`400`) | PASS |
| Student ownership and Staff/Advisor scope enforced server-side | Student A denied on Student B plan (`403`); Out-of-scope EE Staff denied on CPE plan (`403`); In-scope CPE Staff allowed (`200`) | PASS |
| Advisor can read assigned data only and all Advisor mutations are rejected | Central policy allows assigned reads and denies unassigned reads; every currently registered mutation returns `403`. Positive HTTP coverage for Advisor read routes remains blocked by dependency #68 / PR #107. | BLOCKED |
| Errors and logs never leak raw tokens or private data | Verified response payloads and audit log entries contain zero raw JWT strings or unlinked private attributes | PASS |
| Public V2 Company Directory remains accessible without authentication | Anonymous `GET /api/health`, `/api/companies`, `/api/companies/:id`, `/api/companies/:id/positions`, and `/api/positions/:id` return `200 OK` | PASS |

## 3. Latest Local Result

- Date: 2026-10-19
- `npm run test:v3-t02`: 37/37 passed
- Full regression with PostgreSQL integration tests: 538/538 passed

Issue #79 must not be closed until PR #107 is merged and this suite adds positive and negative HTTP tests for every Advisor read endpoint introduced by #68.
