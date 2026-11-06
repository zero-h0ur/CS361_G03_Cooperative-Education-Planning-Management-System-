# Student intake verification

Updated: 2026-11-06 (Asia/Bangkok). Source branch: `fix/student-application-intake`, latest tested CI fix `c63b238`. This file records prior checks and genuine owner confirmations; the documentation update itself reruns only documentation validation. AWS versions/feature gates are in [current deployment](current-deployment.md), not inferred from the latest source commit.

## Evidence matrix

| Layer | Verified result | Limits |
| --- | --- | --- |
| Local observed-schema PostgreSQL | Draft → actual local file bytes/finalization → Submit → same retained Coordinator snapshot/checksum; rollback, concurrency, intake control and capability tests passed | TU provider and Gateway claims are synthetic; local files are not S3 |
| CI on `c63b238` | `regression` and `observed-schema-upgrade` both succeeded | Does not authenticate a real TU/Cognito user or authorize another Deploy |
| Live owner browser | Coordinator Cognito manual open; TU Student create/save; four files attached/opened; Submit; Coordinator saw same application/documents | Restricted pilot, not all accounts/rounds/roles |
| Live filename follow-up | Owner confirmed named Download returned original filename and extension after frontend job 32 | Separate Download action; not every browser PDF toolbar behavior |
| Operator IAM GET-only probe | One queued pilot application/four documents; retained submission checksum matched; filename metadata had extensions; review stayed disabled | Modeled Gateway claims, **not genuine Cognito authentication**, no file-content acceptance claim |
| UI tests | DOM/interaction assertions passed | No comprehensive rendered Desktop/Mobile visual QA recorded |

Do not publish the owner's identities, document names/contents, tokens or signed URLs as evidence.

## Latest CI and focused results

[GitHub Actions run 42157086974](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/42157086974) tested exact commit `c63b23881498f360cf1c5a8375697b17688d7606` for [PR #168](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/168). Recorded jobs: regression SUCCESS (2m20s), observed-schema-upgrade SUCCESS (38s). Successful checks do not replace independent PR review or imply Merge/Deploy.

Prior local verification of the same CI configuration used a fresh task-owned PostgreSQL 16 tmpfs container, loopback port 15441 rather than CI's 5432. `npm test` exited 0. Additional Preview, Coordinator, schedule and strict V4 build checks passed. The task-owned container was removed afterward; no retained development/RDS database was reset.

Focused recorded results around the latest deltas:

- Intake: 38 Node checks including subtests, zero skips, plus 7 UI checks with the dedicated DB configured.
- Filename-related targeted suites: 103 checks across 7 suites; Coordinator UI 21 checks.
- Deployment-safety probes: 5 checks. Lint: 336 modules.
- Release gate: 32 checks at the earlier operations hardening stage.
- Prior documentation baseline: 9 unit tests and 56 reachable Markdown documents before this handoff update. New documentation-check output must be reported separately.

These counts overlap and come from different focused runs; do not add them as unique coverage. The workflow does **not** set `COMMITTEE_TEST_DATABASE_URL`, so its optional Committee DB test is skipped. A separate earlier explicit local run passed that test. Do not describe the latest full CI run as “zero skipped DB tests”.

### Why the previous regression failed

The new intake PostgreSQL tests intentionally require their dedicated DB in CI. Before `c63b238`, the workflow had not created `coed_intake_test` or set `STUDENT_INTAKE_TEST_DATABASE_URL`/`INTAKE_DISPOSABLE`. Two integration tests failed rather than silently skipping. The fix added the isolated DB and required environment; it did not weaken validation, skip tests or change the application to hide failure. [Workflow source](../../.github/workflows/v4-verification.yml) is the reproducible configuration.

## Safe local setup

Use Node.js 22, PostgreSQL 16 and synthetic fixtures only. Never supply an RDS URL. DB suites may reset/seed fixtures: keep development data and separate test targets apart; do not run full regressions concurrently on the same test databases.

| Variable | Dedicated CI loopback database |
| --- | --- |
| `TEST_DATABASE_URL`, `CO_ED_WORKFLOW_TEST_DATABASE_URL`, `CO_ED_APPLICATION_TEST_DATABASE_URL`, `COORDINATOR_TEST_DATABASE_URL`, `TU_DELIVERY_TEST_DATABASE_URL` | `coed_v3_test` |
| `CO_ED_SELECTION_TEST_DATABASE_URL` | `coed_selection_test` |
| `STUDENT_INTAKE_TEST_DATABASE_URL` | `coed_intake_test` |
| `PRESENT_SCHEMA_TEST_DATABASE_URL` | `coed_present_test`, separate observed-schema job |
| `DATABASE_URL` | CI intentionally points at `coed_unused`, not a business database |

Intake also requires `NODE_ENV=test`, `INTAKE_DISPOSABLE=true` and host exactly `127.0.0.1`. Full regression needs its other explicit reset flags/variables from the workflow. Observed-schema tests use their own `PRESENT_SCHEMA_DISPOSABLE=true` gate. Do not rename databases or disable guards to make a run pass.

The existing [Team Dev/Test](team-dev-test.md) Compose setup creates `coed_dev`, `coed_v3_test` and `coed_selection_test`, **not `coed_intake_test`**. Its `test:local` wrapper does not supply every later suite's URL. An unconfigured local suite can skip; that is not integration acceptance. Use the full workflow as the reference for full regression.

For **focused intake only**, on the disposable local Compose cluster from that guide, first confirm it contains no retained data and create the extra empty test DB once:

```bash
docker compose -f compose.dev.yml exec -T db psql -U postgres -d postgres -c "CREATE DATABASE coed_intake_test;"
```

If the database already exists, inspect its use rather than dropping/resetting it blindly. In a separate test PowerShell terminal (the password below is the published local-only Compose fixture, not AWS credentials):

```powershell
$env:NODE_ENV='test'
$env:INTAKE_DISPOSABLE='true'
$env:STUDENT_INTAKE_TEST_DATABASE_URL='postgres://postgres:coed_local_only@127.0.0.1:54329/coed_intake_test'
npm.cmd run test:student-intake
```

Use the configured loopback port if the Compose port was changed. This example configures only the focused suite, **not all `npm test` dependencies**. It applies observed-schema fixtures in isolated test schemas; it does not migrate the development database or AWS. For shell-independent environment setup, mirror the named variables in CI.

Checks to select by change (see [AGENTS](../../AGENTS.md)):

```bash
npm run test:student-intake
npm run test:application
npm run test:coordinator
npm run test:phase1-schedule
npm run verify:migrations
npm run test:release
npm run lint
npm run test:docs
```

Some listed commands need additional dedicated DB variables; do not treat the example above as their complete setup. `verify:migrations` reads the 15 reviewed fresh/workspace files and does not connect to a DB. Observed 018–022 are separately gated upgrades, never implicitly applied by general packaging or API Deploy.

## Historical stages and lessons retained

- A0 inventory (`9e92bf6`): 11 checks including READ ONLY transaction and denied writes; live temporary-tool cleanup verified. It found no ready real round, so no mock dates/recipient were silently extended.
- Initial local intake (`286c64c`, `f3b074b`, `ad703f0`): 15 Node + 4 DOM intake checks at that time, followed by application/auth/Coordinator/release regressions. Later controls expanded coverage; these old counts are not the current total.
- Earlier full-regression attempts exposed an incorrect test DB name and a seed dependency in reused synthetic Committee rows. The environment/fresh disposable cluster was corrected; production seeds/constraints were not relaxed. An explicit earlier run with Committee DB configured passed; that does not change the latest CI's skip caveat.
- The fixed 48-hour proposal was superseded by audited scheduled/manual/closed controls. C7 subsequently applied 021/022 and deployed in stages; the [initial proposal](student-application-intake-rollout.md) is not current authority. [Controls rollout](coordinator-intake-controls-rollout.md) retains the dated proposal/Apply record.
- Candidate ZIPs bind source/configuration/input and artifact hashes. Packaging does not upload/apply SQL. Ignored private manifests/checkpoints are not guaranteed to exist in another clone; see [deployment handoff](current-deployment.md).

## Still not established

General launch, every role/round/account, all live scheduled/close race and denial cases, comprehensive mobile/rendered QA, live review/return/forward/Committee/results/confirmation, and instant revocation of existing signed URLs are **not** proven by the confirmed pilot path. Local concurrency/authorization tests provide specific evidence, not a substitute for all genuine browser scenarios. Do not create another real submission or use an owner's password merely to refresh this document.
