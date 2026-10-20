# Three-role workflow: verification and rollout

The [API contract](../api/three-role-workflow.md) covers Student, Staff and Advisor.
This change contains source and forward migrations only. It does not deploy the
gateway/Lambda/frontend, run production migrations, provision storage, change Cognito
users, send email or implement a Company/Admin business area.

## Local verification

Run frontend tests/build:

```powershell
npm run test:frontend
npm run test:workflow-ui
npm run test:ui-preview
npm run build
npm run test:docs
```

`npm run test:three-role` contains pure validation and real PostgreSQL tests. Set
`CO_ED_WORKFLOW_TEST_DATABASE_URL` to an explicitly disposable LOCAL PostgreSQL
server to run the integration portion; without it, integration is reported skipped.
Never point it at a production proxy, shared DB, or real data. The runner creates
random `wf_*` schemas and a temporary NOLOGIN runtime role, verifies the ACL script,
then removes only its own schema/role. The account needs permission for these isolated
objects and `btree_gist`; it is not the production runtime account.

```powershell
$env:CO_ED_WORKFLOW_TEST_DATABASE_URL='postgres://<local-test-user>@127.0.0.1:<test-port>/<disposable-test-db>'
npm run test:three-role
```

The new runner does not call seed/reset or enable `ALLOW_DB_RESET`. Some older
repository suites do reset seeded fixtures: inspect their targets and guards before
running them. Use a separately created disposable database for those suites, never
override the guard against an existing/shared target. Keep `.env` and credentials
out of test output, logs, screenshots and commits.

Tests cover scope/role/owner denials, pending-plan locks, terminal rejection,
snapshot immutability/policy versioning, current and future overlapping capacity,
concurrent fifth/sixth assignments via API services and direct SQL, atomic reassignment,
company mismatch, Lambda envelopes and runtime DB privileges.

## Local UI Preview

```powershell
npm run dev:ui
```

Open `http://localhost:8081/app.html#/student/profile` or `#/student/plan`.
Staff: `http://localhost:8081/app.html?role=STAFF#/staff/workflow`.
Advisor: `http://localhost:8081/app.html?role=ADVISOR#/advisor/students`.
The dropdowns select fictional scenarios including terminal rejection, no policy,
legacy/no-snapshot, company pending/confirmed and Advisor at capacity. Staff review
and assignment interactions are simulations; browser reload resets the mock state.
Role selection is NOT authentication. Preview contains no production credentials or
API calls and is excluded from production dependency graphs.

## Operator approval required before production

1. Preserve a recovery point and review existing data first. Report Advisors already
   above capacity and plans missing project/policy information; do not silently revoke
   assignments, approve applicants or invent files. Existing legacy data is retained.
2. Apply all unapplied migrations in order using the migration owner. This feature adds
   `004_three_role_workflow.sql`, `005_submission_snapshots.sql`,
   `006_advisor_display_name.sql`, `007_submission_policy_integrity.sql` after the
   existing directory migration 003. Applied checksums 001-003 must remain unchanged.
3. Apply the reviewed [runtime ACL script](../../src/db/operations/v3-runtime-grants.sql)
   as the owner. The app must not receive role/account/official TU field edits or
   update/delete privileges on policies, receipts, events and snapshots. Timestamp-only
   Staff scope UPDATE privilege supports row locking, not scope membership editing.
4. Populate optional `users.display_name` from a verified Advisor roster through the
   existing authorized operator process; there is no new identity-management UI. Without
   a verified name the UI clearly falls back to an Advisor ID, not a fabricated name.
5. Configure existing API Gateway JWT authorizer protection for every new path/method
   listed in the API contract. Lambda route registration alone does not create gateway
   routes. Never expose an unauthenticated proxy as a shortcut. Retain CORS rules and
   required scopes. API routes, schema and frontend must be released compatibly.
6. Deploy the compatible backend and frontend only after explicit approval. Staff must
   publish scoped requirement sets for live cycles before NEW Student submissions.
   Advisor assignment requires an approved plan, round semester and explicit future end.
7. Smoke-test with real nonproduction Student/Staff/Advisor test accounts: submit,
   return, resubmit, approve, assign, Advisor read, reassign and denial on old deep links;
   confirm company mismatch is rejected and a matching external response is recorded.
   Check an out-of-scope Staff and another Student as negative cases.

Browser visual review still requires an available browser: inspect desktop/mobile,
keyboard focus, errors/loading and reduced motion. jsdom/Preview/build success is not
proof of deployed IAM, Cognito, API Gateway, backend grants or visual fidelity.

## Implementation verification (local, 2026-10-21)

| Check | Result |
| --- | --- |
| Frontend regression | 335 passed |
| New Workflow UI + enhanced fictional scenarios | 21 passed |
| Existing Preview scenarios | 48 passed |
| Preview server / production dependency isolation | 2 passed |
| Backend API/role/profile/plan/review/history/Advisor regression | 204 passed, including real PostgreSQL fixture tests on a newly created disposable local DB |
| Workflow state-machine unit tests | 40 passed; 3 older PostgreSQL cases skipped for this command; dedicated new PostgreSQL coverage below was run separately |
| New three-role PostgreSQL/Lambda/runtime ACL checks | 16 passed, including direct SQL capacity races and future overlapping intervals |
| Migration checksum/concurrency/fixture guards + runtime grant regression | 33 passed |
| Production build | Passed, no warnings |
| Local documentation link scanner | 28 documents / 92 local links, zero failures, zero network requests |
| Documentation unit suite | 8 passed; 1 blocked by Windows `EPERM` when creating its symlink fixture, also when rerun outside sandbox; safety test was not weakened |
| Browser screenshots / real AWS smoke test | Not run: no controllable Browser available; production changes were not authorized |

PostgreSQL tests used only a task-created loopback server and disposable schemas/DBs.
The repository's existing `.env` DB was not reset. A scratch regression DB from an
earlier draft of migration 007 correctly refused a checksum mismatch; final regression
was rerun on a newly created empty test DB instead of modifying applied checksums.

## Recovery boundary

Before new-state writes, a compatible code rollback may leave additive schema in place.
After recording `REJECTED`, policies, snapshots or placements, do not blindly deploy an
old serializer/state machine or delete schema/history. Freeze affected writes and use
a compatibility-aware release/forward fix. Any production recovery or data correction
needs a separate reviewed operation; no reset/seed script is a rollback procedure.
