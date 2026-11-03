# Coordinator schema alignment — local evidence

Date: 2026-11-04 (Asia/Bangkok). Branch: `feature/coordinator-workspace-redesign`.

Local implementation only. No AWS connection, production SQL/grants, deployment,
Git branch/stage/commit/push, or real student data was used in this implementation.
The live 500 is **not** claimed fixed until a separately approved coupled rollout.

## Why another migration is necessary

The workspace has `013_coordinator_workspace.sql`. The inspected external database
instead records `013_phase1_schedules_and_confirmations.sql`,
`014_phase1_review_handoff.sql`, and `015_phase1_schedule_audit_integrity.sql`.
Its review columns and schedule model differ, not just its table names.

- Historical SQL bytes, names and stored checksums remain unchanged.
- Default fresh install: reviewed workspace 001–013, then
  [016_coordinator_schema_alignment.sql](../../src/db/migrations/016_coordinator_schema_alignment.sql).
- External upgrade: exact recorded 001–015 history/catalog, then **only 016**, using
  [the explicit upgrade library](../../scripts/operations/coordinator-schema-upgrade.mjs).
  The default migrator continues to reject that external history.
- The authentic external 013 fixture has SHA-256
  `91466678848777ebe71759f178eaa35b7d51ccc9bff5367dd52159f5ad573396`.
  Original 014/015 SQL is still unavailable. The external fixture reconstructs the
  inspected catalog, **not** those original migrations. Local tests do not resolve
  that production provenance/release gate.
- The recorded schema-only inspection artifact is pinned by SHA-256
  `5d899a8afc6cb28423aabe29e25b9d008eb65f13c6062aa511a8068a66a61830`.
  Committed contracts contain catalog metadata, not student rows or credentials.

## Implemented contract

- New `coordinator_reviews` is the only mutable review source. `phase1_reviews`
  and any old `coordinator_round_schedules` remain intact/read-only archives.
  Imported reviews retain all raw source fields in immutable `source_provenance`.
- External `RECEIVED` maps to `FORWARDED`, not acceptance or a vote. Its new
  canonical counter starts at 1 and is explicitly labeled as a new counter.
  Workspace counters are preserved. A verified newer student resubmission can
  recover an old RETURNED review to PENDING; ambiguity aborts the transaction.
- `phase1_cycle_windows` is authoritative for all six schedule instants and one
  version, returned in both existing API version fields. Workspace dates are
  copied only after consistency checks. External missing review dates remain NULL
  until the assigned Coordinator configures real dates.
- Published periods and announcement metadata are protected. Only returned
  applications can correct/resubmit until the exclusive consideration cutoff;
  ordinary Drafts/new applications do not reopen. New submissions retain earlier
  snapshots/documents/checksums. Coordinator never sees an unsent correction.
- Coordinator, Student correction and Committee document/student queries move
  together. Three Committee members, ranking and existing scope rules remain.
  No synthetic academic scores, legacy Plans, selections or notifications are
  manufactured by the repair.
- Generic `coordinator_operations` receipts remain separate from application-bound
  `phase1_operations`; replay preserves actor/request binding and rechecks scope.
- [Schema readiness](../../src/db/coordinator-schema-contract.js) fails closed with
  a safe `COORDINATOR_SCHEMA_UPGRADE_REQUIRED` 503, without DDL or mock fallback.
- [Scoped ACL delta](../../src/db/operations/016-coordinator-runtime-grants.sql)
  revokes archive writes and grants only required new operations/columns. It
  preserves unrelated external result/notification grants. Effective inherited
  privileges are checked; unsafe grants cause rollback, not broad cleanup.
  The inspected external ACL also allowed UPDATE/DELETE on already-immutable
  Committee audit events. The delta removes those specific table/column mutation
  rights, preserving SELECT/INSERT and every existing event/trigger.
- The upgrade library requires explicit profile/mode and a supplied connection;
  no ambient database URL, CLI Apply, bootstrap of missing 014/015, or AWS action.
  It uses migration lock `563003056`, bounded lock/statement timeouts, exact
  history/catalog/owner checks, atomic SQL+optional ACL+016 history insertion,
  rollback-only trial, and verified replay. It never updates old checksum rows.
- Old-column row fingerprints are compared inside the locked migration transaction;
  only metadata/counts/receipts leave the operator. Fixture data is synthetic.
- API/SQL checks use the current schema explicitly, avoiding `public` fallback
  when testing or upgrading multiple schemas in the same database.

## Verification

Counts overlap; do not sum them as unique tests. All database verification uses
an owned disposable PostgreSQL 16 container on `127.0.0.1:55439`, no host mounts.
The database URL is explicitly supplied, ends in `_test`, and differs from the
unused production-style URL. Never copy these settings onto a real database.

| Check | Local result |
| --- | --- |
| `npm.cmd run verify:migrations` | All 14 workspace files match registered LF hashes; 001–013 unchanged |
| `npm.cmd run test:coordinator` with explicit local DB URL | 29 Jest tests and 38 Node/PostgreSQL assertions passed, none skipped |
| `npm.cmd run test:application` with explicit local DB URL | 18 Node/PostgreSQL and 54 Jest tests passed, none skipped |
| `npm.cmd run test:committee` with explicit local DB URL | 9 Jest tests and 1 PostgreSQL test passed; test now owns/cleans its schema |
| `npm.cmd run test:runtime-grants` | 3 PostgreSQL tests passed |
| `npm.cmd run test:frontend` | 372 tests passed |
| `npm.cmd run test:migration` | 30 tests passed |
| `npm.cmd run test:ui-preview` | 48 Jest and 2 Node tests passed |
| `npm.cmd run test:docs` | 9 tests and linked-document verification passed |
| `npm.cmd run lint`, `test:v4-build`, `build:v4` | Passed; local output only |
| `test:lambda` packaging | 37 Jest and 2 self-contained ZIP tests passed, no upload |
| `npm.cmd test` / `test:release` | Full chain reaches release checks; release has 30 passed, 1 failed, none skipped. The sole failure is 016 intentionally not in HEAD until the user authorizes commit; no gate was bypassed. Committee is run separately because the full chain stops at release |

Alignment tests cover both populated source layouts, exact raw provenance and
snapshot preservation, trial rollback, concurrent runners, changed checksums,
partial/unknown schemas, disabled/changed guards, RLS drift, failed effective ACL
rollback, mapped legacy handoff visibility, and unchanged old timestamps/history.
Workflow tests run under limited runtime roles on both layouts and cover returned
corrections after initial close, deadline equality, resubmission/forwarding,
stale/reused operations, concurrent schedule saves, published-period protection,
cross-Coordinator denial and preserved unrelated grants.

The first broad regression attempts exposed schema-fallback checks and fixture
updates that did not increment schedule versions; those were corrected and rerun.
The Committee integration test previously left records in the shared test schema;
it now creates and removes a random schema rather than polluting later resets.
No historical SQL or integrity guard was weakened to make fixtures pass.

Browser visual QA remains unperformed/not authorized in this step. UI changes are
text-only explanations for missing review configuration and published schedules;
the approved theme/layout stays unchanged.

Cleanup verified: the exact owned `coed-alignment-local-20261104` container was
stopped/auto-removed after checking ID, image, loopback-only port and no host bind
mounts. Its synthetic fixture databases were disposable; no real database or
pre-existing container was removed. No temporary AWS resources were created.

## Release boundary

Do not deploy a frontend/backend ZIP alone or apply workspace 013 to the external
database. Candidate manifests declare `recorded015-upgrade-only`, missing authentic
014/015 provenance and `deploymentApproved: false`. Production needs a separate
review/approval of the recorded baseline, clean reviewed source, current account,
code/hash/history/catalog, runtime ACL, backup/PITR, locks/workload and maintenance
cutover. Unknown/contradictory real records or dates block Apply. An old ZIP is not
assumed compatible after 016; post-commit recovery is forward-only or separately
approved restoration. No production dates or mock applicants should be seeded.
