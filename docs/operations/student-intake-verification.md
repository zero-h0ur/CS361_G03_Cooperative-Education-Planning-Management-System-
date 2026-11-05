# Student intake local verification

Branch: `fix/student-application-intake`. Local implementation `286c64c`, schedule/
browse-rollback hardening `f3b074b`, Coordinator capability polish `ad703f0`, A0 tool
`9e92bf6`. No push or main-service deployment is authorized. Runtime/SQL changes
and genuine-live acceptance boundaries are in the
[rollout proposal](student-application-intake-rollout.md).

## Safe local targets

All DB tests use a task-owned PostgreSQL16-alpine container with tmpfs data,
loopback127.0.0.1:15440 and synthetic fixtures only. Never supply an RDS URL.
`NODE_ENV=test`, `INTAKE_DISPOSABLE=true` are required for new intake fixtures.
Database `coed_intake_test` is the new suite; `coed_v3_test` is the existing
destructive regression target; other random-schema suites use separate named
local databases ending `_test`. Existing database-name/reset safety guards stay.
Historical migration LF bytes and checksums remain unchanged.

## Results

- `test:intake-readiness`:11 checks passed, zero skips, including actual read-only
  PostgreSQL inventory/denied writes. A0 ran once; cleanup verified, not repeated.
- `test:student-intake`:15 Node +4 DOM checks passed, zero skips. Includes
  UNKNOWN/manual review, real four-kind file finalization,
  rollback, concurrency and same submission/checksum on Coordinator reads.
- `test:application`:18 Node +56 Jest checks passed, zero DB skips.
- `test:coordinator`:27 Jest +8 database checks passed, zero DB skips.
- `test:tu-auth`:127 Jest +25 Node checks passed, including actual local PostgreSQL
  and HTTP ownership. Network provider and trusted Gateway claims are synthetic.
- `test:phase1-schedule`:20 Node +24 Jest checks passed, zero skips after setting
  the actual `COORDINATOR_TEST_DATABASE_URL` variable.
- `test:read-only-browse`:10 Node +4 Jest checks passed.
- `test:frontend`:372 checks passed across16 suites.
- `lint`:319 modules passed.
- `verify:migrations`:all15 reviewed root migration files match immutable LF bytes;
  no database touched.021 is a separately gated observed upgrade, not auto-applied.

`test:release`:32 checks passed, zero skips, including the DB history/tamper checks
and source-paired ZIP packaging tests. `test:committee`:9 Jest +1 database checks
passed, zero skips when its explicit database variable was supplied.

The first full regression attempt stopped at an existing database-name safety
check because its workflow URL named `coed_regression_test` instead of required
`coed_v3_test`. The execution environment was corrected; no code/safety guard was
weakened. The next full regression exited0 but skipped Committee DB because its
separate variable was absent; that test was then run successfully with the correct
variable. Running again in that reused fixture hit a pre-existing seed dependency:
Committee's synthetic immutable workspace rows remain and block cohort deletion.
No production seed/constraint was altered; the final full run uses a fresh task-
owned tmpfs container and all explicit DB variables. The final `npm.cmd test` on
f3b074b **exited0, with zero skipped DB checks**, including Committee. The later
ad703f0 delta only exposes/disables Coordinator capabilities and adds its DOM
entry/test: `test:student-intake` and `test:coordinator` were rerun and passed.
A skipped DB test is not counted as passed.

The paired candidate is built only after a clean local commit, using
`npm.cmd run package:v4-candidate` with the already verified **public** RDS CA file
in COED_RDS_CA_FILE. Its ignored manifest binds source commit/input hash, frontend
and Lambda ZIP hashes and public target config.021 is deliberately not included
in the general fresh-migration allowlist/package or auto-applied by an API deploy.
Its separately pinned SQL needs the future reviewed observed-upgrade controller.
No artifact upload or main-service change is performed by this command.

The user's later choice is an isolated48hour test round and the privately named
Cognito Coordinator, not all times/accounts/rounds. That choice only specifies the
future pilot; it does not authorize deployment or password persistence.

## Honest limits

DOM interaction tests are not a rendered Desktop/Mobile visual check. No claim
of live TU-password, S3/browser upload or Cognito staff acceptance is made. No
student passwords/tokens/real document contents were used in local tests.
