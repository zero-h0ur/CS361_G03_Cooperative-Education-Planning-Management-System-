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
- `npm run test:submit` (`tests/plan-submission.test.js`)
- `npm run test:review` (`tests/staff-review-commands.test.js`)

## 2. Permission Matrix & Acceptance Criteria Coverage

| Acceptance Criterion | Verified Scenarios | Status |
| --- | --- | --- |
| Every protected endpoint rejects unauthenticated requests | `GET /api/v3/me`, `GET/PATCH/PUT /api/v3/students/me`, `POST /api/v3/plans/:id/submit`, `/start-review`, `/return`, `/approve` all return `401 UNAUTHORIZED` | PASS |
| Malformed, expired, wrong issuer/audience, ID token, missing scope, and tampered tokens rejected | Verified with real RS256 keypairs and `TokenValidator` (`401 UNAUTHORIZED`) | PASS |
| Client cannot spoof user/role/scope | Spoofed `X-User-Id`, `X-Role`, `X-Staff-Scope` headers and body fields (`student_id`, `role`, `department`) rejected (`403`/`400`) | PASS |
| Student ownership and Staff/Advisor scope enforced server-side | Student A denied on Student B plan (`403`); Out-of-scope EE Staff denied on CPE plan (`403`); In-scope CPE Staff allowed (`200`) | PASS |
| Advisor can read assigned data only and all Advisor mutations are rejected | Assigned student read allowed (`200`), unassigned student read denied (`403`), all `PATCH`/`POST` mutations denied (`403`) | PASS |
| Errors and logs never leak raw tokens or private data | Verified response payloads and audit log entries contain zero raw JWT strings or unlinked private attributes | PASS |
| Public V2 Company Directory remains accessible without authentication | Anonymous `GET /api/v2/companies`, `/positions`, `/rounds`, `/documents` return `200 OK` | PASS |
