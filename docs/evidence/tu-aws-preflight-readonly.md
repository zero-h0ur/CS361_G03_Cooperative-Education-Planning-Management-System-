# TU AWS temporary read-only preflight

Date: 2026-11-04 (Asia/Bangkok)
Source baseline: `480e1cc`, branch `fix/tu-phase1-coordinator-delivery`.
Status: D0-D6 diagnostic scope completed; identity check NOT_CHECKED; temporary
AWS resources removed. Application deployment and production database writes are
not approved and were not performed.

## Scope and method

The user explicitly approved only D0-D6 in
`docs/plans/2026-11-04-tu-aws-preflight-and-approval.md`.
This allowed a temporary private Lambda, its scoped execution role/log group,
and one additive statement on the existing Secrets endpoint policy. It did not
authorize deploying the application, altering database grants/schema/identities,
writing secrets, live TU login, Git commits or push.

The fixed reader performed one metadata invocation against database `coed` in
account `130165494095`, region `ap-southeast-2`. It used the existing app database
credential in AWS memory only, never a master credential. The credential retains
its writer capability; read-only enforcement was in reviewed code and the SQL
transaction, not a new SELECT-only database role.

- Numeric immutable Lambda version `1`, exact operator-only invocation policy,
  reserved concurrency 1, 256 MB, 15-second Lambda timeout and 11-second handler
  deadline. No public URL, Gateway route, event source, S3 interface or arbitrary
  SQL input.
- TLS with the public RDS CA; one database connection; fixed metadata SELECTs;
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, bounded statement/lock/idle
  timers, verified database/user/read-only/isolation guards, then rollback/close.
- Actual guards all true: database matches, user matches, read-only and
  repeatable-read. PostgreSQL `server_version_num=160015`.
- No applicant payloads, files, passwords, tokens or unrelated profiles were
  read. No database function was invoked as an identity/provisioning shortcut.
- Identity status is `NOT_CHECKED`: no fresh securely supplied identifier was
  available. Earlier chat credentials were not reused. This is not proof that
  the owner's TU link/profile exists or that login works.

## Production findings

### Migration history is a different deployed lineage

Production has 16 recorded migrations, versus 15 in the local reviewed inventory.
The first 13 names/checksums, through `013_coordinator_workspace.sql`, match.

| Production recorded version | SHA256 | Interpretation |
| --- | --- | --- |
| `013_phase1_schedules_and_confirmations.sql` | `91466678848777ebe71759f178eaa35b7d51ccc9bff5367dd52159f5ad573396` | Same bytes as local `014_phase1_schedules_and_confirmations.sql`, different recorded name |
| `014_phase1_review_handoff.sql` | `9d84f1351bd8a0188ce4a7dbed6c03b225715136534d697590f995b782c8aba8` | Original SQL not located in current Git refs or inspected workspace checkpoints |
| `015_phase1_schedule_audit_integrity.sql` | `feb09714f156e35c9b337caf4421691bc37329583efc37f90b61d2faa3847433` | Original SQL not located in current Git refs or inspected workspace checkpoints |

Local `017_tu_phase1_delivery.sql` is not applied. Do not rewrite recorded names,
checksums or historical SQL; do not rerun local 014 simply because its local name
is absent. Equal hashes establish identical bytes for that entry, not full
lineage compatibility or corruption of the other lineage.

### Missing newest delivery and login prerequisites

- `phase1_submission_deliveries` is absent.
- `tu_identity_link_events` is absent.
- Proposed SELECT-only login role `coed_tu_login` is absent.
- `coordinator_round_schedules` **exists now**. The historical missing-table
  diagnosis must not be repeated as the current state.
- Common application table columns compared to the isolated local reference
  matched names/types/nullability. This is not a full semantic schema proof.
  Production migration bookkeeping uses `checksum text` and `applied_at`, as
  expected by the real runner; an earlier direct-SQL fixture mismatch was a test
  artifact, not production drift.

### Runtime capabilities need a targeted review

`coed_app` is not superuser, cannot create roles/databases/schema, does not bypass
RLS, and has no role memberships. Nevertheless its effective table-level grants
are wider than the currently checked-in runtime contract:

| Table | Effective production grant exceeding local table-level contract |
| --- | --- |
| `committee_workspace_events` | UPDATE, DELETE |
| `committee_workspaces` | DELETE |
| `coordinator_operations` | UPDATE, DELETE |
| `coordinator_round_schedules` | Table-wide UPDATE, DELETE |
| `phase1_reviews` | Table-wide UPDATE, DELETE |
| `phase1_selection_results` | INSERT, table-wide UPDATE |

Local column-specific UPDATE grants are intentionally narrower than table UPDATE.
Enabled guard/immutable triggers may still reject a write; these grants alone do
not prove that any data was modified. The diagnostic did not attempt writes or
revoke production grants. The `any_column_write` metadata combines multiple
privilege types and is not interpreted as UPDATE permission by itself.

The runtime can EXECUTE one non-trigger application routine:
`upsert_tu_student_identity`, which is `SECURITY DEFINER` (definition MD5
`fa1e88948ffb25923d4361d39af91968`). Its body was not fetched or invoked. Its name
alone does not establish its behavior. Dependency/body review and a targeted
retirement of elevated runtime execution must precede any approved ACL change;
do not blindly revoke PUBLIC grants or break another live consumer.

### Existing integrity protections must survive the upgrade

Production has enabled trigger `phase1_schedule_events_immutable`, absent in the
current local reference. It uses `reject_immutable_row_mutation` and its trigger
definition MD5 is `5c10132d00fdf4e55cd8fc5a51adada5`. Preserve this protection.
The application/attachment/review guards and audit-immutability triggers inspected
are enabled. Some routine definition fingerprints differ from local 017; MD5
differences can include formatting and are not a semantic diagnosis. Production
`guard_phase1_review` does not reference the newest delivery-receipt table.

## AWS cleanup and unchanged application baseline

Temporary names created and subsequently removed:

- Lambda `coed-tu-preflight-readonly-20261104`, including published versions.
- IAM role `coed-tu-preflight-readonly-role-20261104` and inline policy
  `ScopedPreflightOnly`.
- Log group `/aws/lambda/coed-tu-preflight-readonly-20261104`.
- Endpoint statement `CoedTuPreflight20261104` only; shared endpoint preserved.

Cleanup checked at `2026-11-04T13:44:54.111Z` (20:44 Bangkok):
`status=CLEANED_UP`, `endpointEqualsOriginal=true`, `applicationUnchanged=true`.
The endpoint policy equals the original baseline. Checked API/TU code/config and
Gateway integration manifests are unchanged. No shared ENI, SG, role, secret,
database object or application log group was removed. Normal AWS operational
history is not claimed to have been erased.

Unchanged code anchors:

- `coed-api`: `/0B5tQMbjcxxZDDsbLOd4+K7McqH9OAL0r5vJw9hU44=`,
  revision `fd169447-aa7a-40c3-8768-f69611a1004d`.
- `coed-tu-auth`: `IwMiSvavUadk27YoGWGYWj5vZAXAO83okw/GNkEGfY0=`,
  revision `a718abb5-99bd-477b-b05d-fe8b4fe73684`.
- TU integration `sr47ns9` still targets the unqualified old TU function with
  15-second timeout; main integration `ip14y62` is unchanged. No issuer was created.

Non-secret, ignored local artifacts:
`tmp/main-alignment/tu-preflight-gyjF8z/state.json` and `result-1.json`.
Run ID: `8853859598b49201f1d53048d532797a`; invocations: **1**.
Diagnostic ZIP SHA256:
`86075469fcb737a8611e4cfce287e0940e06381d6b0a2cd725659a8bea0820e7`.
Public CA SHA256:
`90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b`.
This ZIP is the temporary reader, **not** an application deployment artifact.

The initial version-policy request was rejected because it contained a function-
level resource list. The controller was corrected to restrict a qualified policy
to its single version ARN and regression-tested before the sole DB invocation.
No policy check or read-only guard was bypassed.

## Local changes and verification

Added operator-only scripts, not imported by application handlers or automatic
deployment:

- `scripts/operations/tu-preflight/reader.js`: bounded fixed read-only handler.
- `scripts/operations/tu-preflight/operator.mjs`: scoped build/create/invoke/
  ownership-aware cleanup with baseline drift checks and explicit approval flag.
- `scripts/operations/tu-preflight/compare.mjs`: local metadata/history comparison;
  no AWS or database connection.
- `tests/tu-preflight.test.mjs` and `tests/tu-preflight-db.test.mjs`.

Final focused run: **30 passed, 0 failed, 0 skipped**. This includes package
boundaries, input/context/expiry guards, timeout/no-late-reads, safe errors,
parameterized optional identity, exact IAM/endpoint policies, lineage comparison,
and a real isolated PostgreSQL read-only transaction rejecting synthetic INSERT
with SQLSTATE `25006` while preserving the synthetic row fingerprint.

Command (the URL is a disposable local synthetic credential, never production):

```powershell
$env:NODE_ENV='test'
$env:COED_PREFLIGHT_DISPOSABLE_CONTAINER='true'
$env:COED_PREFLIGHT_TEST_URL='postgres://postgres:coed-preflight-local-only@127.0.0.1:55440/coed'
node --test --test-concurrency=1 tests/tu-preflight.test.mjs tests/tu-preflight-db.test.mjs
```

The explicitly identified task-owned Docker containers and their anonymous data
volumes were removed after testing; only synthetic data was deleted and can be
recreated from these tests. Other databases/containers and source checkpoints were
preserved. No dependencies were installed, no existing application source was
changed, and no Git commit/push was made.

Final additional checks passed:

- `npm.cmd run lint`: 257 JavaScript modules.
- `npm.cmd run test:docs`: 9 tests, 49 reachable documents, no broken local links.
- Explicit offline check of this evidence and both updated plan files: 3 documents,
  no errors. Plan artifact completeness check passed.
- `git diff --check`: no errors in tracked diff; no existing tracked application
  file changed. The new diagnostic files/evidence remain untracked, not committed.

PowerShell initially blocked the `npm.ps1` launcher; using the standard `npm.cmd`
launcher succeeded without changing the machine's execution policy. The whole app
release gate was not rerun for this operator-only addition; its previous results
at `480e1cc` are not represented as a new run here.

## D6 conclusion and separately gated next work

The deployed schema/ACL and old handlers are **not aligned with the newest local
design**. These checks do not identify the exact original `/tu-login` 500
exception and do not demonstrate a successful online login. The production issue
has not been fixed by diagnostics.

Recommended next phase is local compatibility work, before another AWS request:

1. Obtain and hash-verify the original production 014 handoff and 015 audit SQL
   above, including dependencies of `upsert_tu_student_identity`. Preserve all
   recorded history. If originals cannot be obtained, explicitly scope another
   read-only inspection of definitions; do not fabricate historical SQL.
2. Build a faithful disposable fixture for that exact production lineage. Design
   a **new forward-only upgrade**, rather than applying local 014/017 blindly:
   add the two missing delivery/link-audit structures, needed receipt guards,
   and exact runtime column grants while retaining production audit immutability.
   Never backfill historical submissions as if delivery had been proven.
3. Test Student submission/receipt/Coordinator queue and failure/concurrency cases
   against both reviewed local and production lineages. Dependency-review the
   elevated routine and prepare targeted EXECUTE/ACL removal plus a dedicated
   SELECT-only `coed_tu_login` proposal. This is not an authorized DB grant change.
4. Present exact reviewed SQL, schema/ACL preconditions, backup/maintenance plan,
   resource/permission/secret diff, cost and rollback for separate approval.
   Proposed broker/private issuer/compatible API topology is unchanged. No NAT,
   public RDS or new endpoint. Existing price examples remain estimates, not a
   guarantee of the bill or an approved deployment.
5. Only after deployment approval and candidate gates, obtain fresh secure test
   input, verify owner identity, then test Login -> `/me` -> owner's read-only
   data. Do not submit/relink/confirm or reuse earlier pasted credentials.
   On failure use a tested strict rollback or TU-only 503 maintenance, not the old
   arbitrary-account/provisioning fallback; preserve Cognito/Coordinator.

The production-specific executable SQL and final ACL revoke list are deliberately
not invented while the two original migration sources remain unavailable.
