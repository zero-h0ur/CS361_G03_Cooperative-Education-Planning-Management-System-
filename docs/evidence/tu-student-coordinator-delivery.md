# TU Student → Cognito Coordinator: local verification

Date: 2026-11-04 (Asia/Bangkok). Branch: `fix/tu-phase1-coordinator-delivery`.
Source base: integration branch `9ba453b`. The implementation snapshot below
predates local commit approval. See [post-commit verification](tu-post-commit-release-gate.md)
for the later authorized commits and release-gate result. No push/deployment.

## Scope and result

Implemented the [identity and delivery decision](../architecture/tu-student-identity-and-delivery.md).
The local HTTP test verifies TU-credential adapter → exact internal Student → four
real byte uploads → PostgreSQL Submit transaction → separate Cognito-authorizer
Coordinator session listing/opening the same application/submission/document checksums.
Provider responses, identities, academic records and files are synthetic local test
data. This is not a live TU/Gateway/Cognito/RDS acceptance test.

The test database is a disposable PostgreSQL 16 container bound only to loopback,
with no host data mount. Tests use owned random schemas and a separate runtime
role with the checked-in least-privilege ACL. No real applicants or passwords are
used. New migration017 applies only to this branch's workspace013 lineage.
The owned disposable container and its synthetic databases were removed after
verification; no existing user database/container or host files were deleted.

## Verification

- `npm run test:tu-auth`: 65 Jest tests and the latest 10 HTTP/PostgreSQL tests pass
  without skips, including concurrent assignment changes and safe same-operation retry.
- Application UI/API tests: 39 UI and 17 API tests pass; absent/mismatched receipt
  never produces production submission success, and Draft fields remain available.
- `tests/application.test.mjs`: 18 tests pass with PostgreSQL and real private bytes,
  including upload/Submit concurrency, rollback, immutable snapshots and runtime ACL.
- `npm run test:coordinator`: 27 domain/API/UI and 8 PostgreSQL tests pass, including
  retained corrections, review deadline, resubmission and Committee bridge.
- The full npm chain passes all functional stages through `test:application`,
  including 372 frontend, 30 migration and 3 runtime ACL tests. It then stops at
  `test:release`: 30 pass, 1 fails solely because017 is not in HEAD. Committee is
  tested separately because it occurs after the release gate in the npm chain.
- `lint`, `test:docs` (9 tests; 45 linked documents), `test:v4-build` and `build:v4`
  pass. Counts overlap; do not sum them as a unique total.
- Committee was rerun with its test URL set: 9 UI/domain tests and 1 PostgreSQL
  test pass without skips.
- Final Auth boundaries: 31 + 110 tests pass; migration:30 and runtime ACL:3
  pass. Runtime ACL was rerun on a fresh disposable test database after the earlier
  development database correctly rejected changed uncommitted017 bytes; no stored
  checksum was edited to bypass that rejection. Preview:48 UI +2 server tests pass.
- An additional Python operations check on Windows ran 78 tests: 55 pass, 3 fail,
  5 error, 15 skip. These unchanged operator tests depend on Unix0600 permissions,
  `os.O_NOFOLLOW` or symlink privileges unavailable in this Windows run. They are
  not counted as passed and their safety checks were not weakened. The Linux CI
  operator stage remains a required check after commit; no AWS calls were made.

The retired deployment script is not executed. Historical migrations001–013 were
not modified; the checksum-verified set adds017 only. New017 SHA-256:
`1aa9a90ae9e91b8a01f8ef8c29e81301e03f2e8339db4266a44f2988dd0b7c5c`.

## Release gate and remaining acceptance

At the original implementation snapshot, `test:release` failed its exact-HEAD
migration guard while017 was uncommitted. The guard was unchanged; passing local
SQL tests was not release approval. Local commits were authorized later, separately
from this implementation turn; the linked post-commit record supersedes this
historical release blocker. Push and deployment still require separate approval.

Before a production release, separately authorize and verify current database
lineage/backup/upgrade, roster and active coordinator assignments, controlled identity
relinks, TU credential lifecycle, protected signing key/rotation, global rate limits,
Gateway authorizers/bridge routes/CORS and compatible backend/frontend deployment.
No production claims, real identity transitions or legacy server backfills were made.

No native-browser Desktop/Mobile visual acceptance was performed during this pass;
UI coverage is automated DOM tests. Existing theme is retained. Recovery is opt-in,
validates owner consistency, compares Draft fields, clears all declarations and
retains its browser source; it cannot recover old file bytes or prove an old send.

## Reproduction

Use a dedicated loopback database ending `_test`, distinct from `DATABASE_URL`.
Set `NODE_ENV=test` and `TU_DELIVERY_TEST_DATABASE_URL` to that test database, then
run `npm run test:tu-auth`. Set `COORDINATOR_TEST_DATABASE_URL` for coordinator DB
coverage. Existing application/release DB suites require their documented
`CO_ED_APPLICATION_TEST_DATABASE_URL` naming (`coed_v3_test` or `coed_v4_application_test`).
CI now supplies the dedicated TU test URL and executes `test:tu-auth` via `npm test`;
missing TU database configuration in CI fails rather than silently skipping.
