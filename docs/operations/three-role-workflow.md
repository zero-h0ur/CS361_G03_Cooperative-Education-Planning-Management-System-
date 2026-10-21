# Workflow verification and rollout

The [API contract](../api/three-role-workflow.md) covers Student, Staff and Advisor.
This change contains source and forward migrations only. It does not deploy the
gateway/Lambda/frontend, run production migrations, provision storage, change Cognito
users or send email automatically. Admin has a separate operations view and owner-only
maintenance scripts, not a Student-review business area.

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
   `006_advisor_display_name.sql`, `007_submission_policy_integrity.sql`,
   `008_returned_plan_cancellation.sql` after the
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

## Preparing a Live Challenge cohort

Use the reviewed `scripts/operations/live-challenge.py`, not the development reset
seed against RDS. It creates exactly three new Student logins, two Advisor logins,
one scoped Staff and one Admin. All names and official-profile fields are synthetic.
It does not connect to a real TU API or invent academic eligibility thresholds.

Run the identity phase from normal CloudShell, outside a checkout:

```bash
python3 live-challenge.py identities --private-file /home/cloudshell-user/coed-live135-private.json
python3 live-challenge.py export-manifest \
  --private-file /home/cloudshell-user/coed-live135-private.json \
  --manifest /home/cloudshell-user/coed-live135-identities.json
```

Passwords are generated once, set permanent, and saved only in the `0600` private
file. Confirmed accounts are never reset on resume. No invitation is sent. Export
only the identity manifest to the private release bucket; never upload passwords.
Verify its SHA-256 when moving it into VPC CloudShell. The VPC environment cannot
use the normal CloudShell Upload/Download actions and has no general STS access.

After applying migrations and runtime ACLs, run from VPC CloudShell:

```bash
python3 live-challenge.py database --manifest /home/cloudshell-user/coed-live135-identities.json
```

The owner password is entered at a hidden prompt. Provisioning is one transaction,
checks existing rows in 16 tables, creates no Plans for the three new Students,
and stores an idempotent receipt/event. It creates a clearly labelled synthetic
round and synthetic PDF-reference requirement; these are not real course rules.
Staff scope is CPE / CS / 2569. Both new Advisors initially have no assignments.
Re-running the provisioner never clears a demo Plan or resets a role.

Confirm real Managed Login and `/api/v3/me` for every account after linking.
`CONFIRMED` in Cognito alone does not establish application access. Retain a separate
untouched Student for a fresh demonstration if smoke tests use one of the three.

## Account operations

Admin's `/api/v3/admin/operations` view shows account role/status/version, migration
names and catalogue counts. It contains no Student profile or review controls.
Changing an account uses `scripts/operations/admin-account.py` in two Ops phases,
an active Admin Access Token and a database owner credential. No credential is
placed in the Browser and `coed_app` keeps no role/status update privilege.

Prepare a private `0600` JSON request containing `user_id`, `role`, `account_status`,
`expected_version`, a fresh `operation_id` UUID and `reason`, then run:

```bash
# Normal CloudShell: token is entered at a hidden prompt, never saved.
python3 admin-account.py --prepare --request /absolute/private/account-change.json \
  --approval /absolute/private/account-approval.json

# Transfer the approval through the private release bucket. In VPC CloudShell,
# use the exact SHA256 printed above, not a hash supplied with an untrusted file.
python3 admin-account.py --apply --approval /absolute/private/account-approval.json \
  --sha256 <hash-from-prepare>
```

The first phase obtains the Admin identity from the authenticated API and produces
a request-bound approval valid for ten minutes. It contains no token or password.
The second phase requires the database owner, an exact operator-pinned approval
hash and a fresh active-Admin check in RDS. These are trusted owner operations;
approvals are not browser-submitted API credentials. This split avoids requiring
STS or public API access from the private VPC. It serializes account changes and stores the update, receipt and audit
in one transaction. It rejects self-changes, removal of the last active Admin,
changes conflicting with existing Student links/Staff scopes/Advisor assignments,
stale versions and operation reuse with a changed request. It never approves,
rejects or assigns a Student. Catalogue imports continue through the reviewed
[partner importer](partner-directory.md), not an unrestricted browser SQL endpoint.

## Building an operator release

Run `npm test`, `npm run lint`, `npm run test:docs` and the production auth-configured
build first. Lint currently checks JavaScript syntax; tests enforce behavior and
permission rules. Commit the reviewed source, build the Lambda ZIP with the trusted
RDS CA, then prepare the separate operator artifacts:

```bash
node scripts/operations/prepare-workflow-release.mjs \
  /absolute/path/coed-v3-lambda.zip /absolute/private/workflow-release
```

The output includes the source SHA, file hashes, Lambda ZIP, guarded migration SQL
and the two operator scripts. SQL validates the complete migration history, uses
the migration-runner lock, preserves existing column values across additive schema
changes, and defaults to `ROLLBACK`. Apply only after a fresh available RDS snapshot
and Lambda/frontend recovery points have been recorded. Check both dry run and apply
output; `RuntimeRoleMutation` must be false. Do not change a recorded checksum to
make a mismatch disappear.

After DB and backend verification, merge the frontend and wait for its existing
Amplify job instead of starting a duplicate build. Verify all four roles, a full
review/revision/approval cycle, assignment isolation, company mismatch and at least
three permission denials on the deployed commit. A successful build or local Preview
does not replace this acceptance gate.
