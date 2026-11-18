# Load-test DB preparation — local evidence

บันทึกนี้เป็นผล **local ก่อน B1** ข้อความไม่มีการสร้าง AWS ด้านล่างหมายถึง session local นั้นเท่านั้น สถานะ AWS ที่อนุมัติภายหลังอยู่ใน [B1 infrastructure snapshot](loadtest-b1-infrastructure.md) ไม่เปลี่ยนผล local เก่าให้กลายเป็นผล AWS

Recorded: **2026-11-17, Asia/Bangkok**. Scope: Ronnakrit's local preparation only. Source baseline `791ed1e32b96384843847f92c3b8b35959b5d41f` plus the uncommitted loadtest-tool changes described in [the runbook](loadtest-rds-preparation.md). This is not a named released commit, genuine Cognito acceptance, AWS deployment snapshot or benchmark result.

## Main integration and CI follow-up — 2026-11-18

The current branch `chore/loadtest-rds-preparation` was fast-forwarded from
`791ed1e` to fetched `origin/main` **`03876b681968d3b732d8438c0f5405c7702c07ba`**.
The uncommitted preparation/B2a/B2b source was reapplied from a recovery stash.
Three text conflicts (`.gitignore`, docs index and architecture) were resolved
by retaining upstream release evidence and the isolated loadtest additions.
No runtime source or historical SQL was changed by this integration. The stash
is retained locally for recovery, not a branch commit or a published artifact.

CI source now runs all offline loadtest units/package checks in regression and
three independent PostgreSQL16 service-container jobs for local/B2a/B2b DB
tests. Each creates its own `coed_app`; these must not share a cluster. Service
ports bind host loopback, with explicit disposable guards and a major-version
check. No AWS operator, Secret/token input or private artifact upload is used.
See [reproducible commands and CI boundaries](loadtest-rds-preparation.md#ci-และการแยกฐานทดสอบ).

This turn used Node **22.12.0**, `npm ci --no-audit --no-fund` and installed local
PostgreSQL **18.3**, not PostgreSQL16. Dependencies match the unchanged lockfile.
The working changes are not committed; this is not a hosted CI result.

| Check actually run in this follow-up | Result / limit |
| --- | --- |
| `npm run test:loadtest`, repeated after `npm ci` | **71 passed, 0 skipped**: preparation40 + B2a11 + B2b11 + teammate generator/mock smoke5 + CI contract4. Initial run failed on CRLF-sensitive exact-byte inputs and one new test's variable-name matcher; corrected LF attributes/formatting and matcher, without changing pinned content or relaxing target guards. |
| `npm run test:loadtest:local` | **12 passed, 0 skipped**, fresh local PG18 cluster stopped/verified. |
| `npm run test:loadtest:local -- --b2` | **5 passed, 0 skipped**, separate fresh local PG18 cluster stopped/verified. |
| `npm run test:loadtest:local -- --b2b` | **7 passed, 0 skipped**, separate fresh local PG18 cluster stopped/verified. Unit fixtures moved to a helper so this DB suite no longer imports/reruns unit tests; this does not reduce the 11 separately run B2b units. |
| Full `npm test` with workflow DB variables on fresh local PG18 | **Exit 1**, not a full pass: intake-controls-upgrade and student-intake observed-schema tests fail with `PREFLIGHT_CATALOG_LIMIT`. Application suite completed **19 Node + 61 UI/API checks**, no skips. Later release/Committee stages were not reached by this failed full run. Cluster stop verified; no guard was changed to hide failure. |
| Follow-up synthetic observed-catalog probe, new PG18 cluster | The fixture has **565 constraints**, including **288 NOT NULL (`contype=n`)** rows; the retained baseline has **277**, none of that type. The unchanged catalog query returns its capped **501** rows, correctly exceeding the **500** guard. This explains this local version mismatch; it is not evidence that hosted PG16 has passed. |
| `npm run test:application`, fresh focused PG18 cluster after `npm ci` | **19 Node + 61 UI/API passed, 0 skipped**. Includes the main Draft-curriculum fix. |
| `npm run test:release`, same focused disposable cluster | **34 passed, 0 skipped**, including its actual DB check. This separately run pass does not turn the earlier full `npm test` failure into success. |
| `npm run test:coordinator`, same focused disposable cluster | **17 Node/DB + 60 UI/API passed, 0 skipped**; cluster stopped/verified after all focused commands. |
| Syntax lint / migration verification | **374 modules**, **17 immutable migration checksums**, both passed. No SQL Apply. |
| Workflow YAML parse | Parsed successfully; matrix has three distinct jobs and PostgreSQL16 service configuration. Parsing/source assertions are not hosted Actions execution. |
| Documentation check | **9 passed, 0 skipped**, offline link traversal passed; no external network verification. |
| Git/privacy checks | No unmerged paths or staged files. Exact ten private provider subjects were scanned in memory against potential Git files with no matches; ignored mappings/checkpoints/ZIPs excluded. No subject values printed. |

The three loadtest DB runs and focused source tests do not establish full
PostgreSQL16 regression, AWS deployment parity, genuine JWT or load acceptance.
The new hosted PostgreSQL16 jobs remain **unrun until a later authorized push/PR**.
No AWS call, deployment, account/data modification, commit or push was performed
in this follow-up. Earlier AWS evidence remains separately dated in B1/B2a/B2b.

## Results from the original local implementation session

Environment: Node.js **22.12.0**, installed PostgreSQL **18**, new native loopback-only task-owned clusters. The AWS RDS engine has not been refreshed/matched; repeat on the observed engine before claiming AWS compatibility. Existing npm dependencies were used, not reinstalled this session. Docker daemon was unavailable; no Docker/production environment was used as a fallback.

| Command / environment | Result | Meaning / limits |
| --- | --- | --- |
| `npm run test:loadtest` | 40 checks passed, 0 skipped in the final run | Manifest/dataset validation (5–10 accounts), duplicate/injection rejection, offline fingerprint, target/deployment guards, CLI output redaction and local-runner fail-closed checks. No cloud connectivity. |
| `LOADTEST_PG_BIN=<installed-bin> npm run test:loadtest:local` | 12 checks passed, 0 skipped; cluster stop verified | Real PostgreSQL fresh reviewed schema + 400 synthetic companies + 10 exact identity links/Students/Drafts. API adapter uses modeled Gateway claims, not actual authorizer/Cognito. |
| `node node_modules/jest/bin/jest.js --runInBand tests/student-plan.test.js tests/plan-cycle-options.test.js tests/rds-secret.test.js` | 55 tests passed across 3 suites | Existing Plan/API and Secret pinning/cache/error contracts. SDK/repository boundaries in these suites are mocked, not actual AWS acceptance. |
| `npm run lint` | Passed, 356 JavaScript modules | Syntax validation, not static security analysis or full runtime regression. |
| `npm run test:docs` | 9 checks passed; reachable docs/links have 0 failures | Offline local/fragment checks; external URLs checked for syntax, not availability. New runbooks also explicitly passed `checkDocuments` as entry points. |
| `npm run verify:migrations` | All 17 reviewed fresh SQL files match immutable LF checksums | Reads source only; no migration Apply or observed-RDS validation. |
| `git diff --check` and whitespace scan of new files | Passed | No staging/commit/push. |
| Initial direct disposable DB run | 9 checks passed, 0 skipped before hardening additions | Superseded by the fresh automatic-runner result above, not added to the final suite total. Manual task cluster also stopped and verified. |
| Existing Student Plan/cycle-options and RDS Secret unit suites (3 Jest suites) | 55 checks passed, 0 skipped | Existing behavior/credential pinning with mocks. Not a real Secret read, DB TLS or cloud identity test. |
| `npm run verify:migrations` | 17 reviewed fresh migrations verified; no formatting or DB changes | Historical SQL bytes/checksums unchanged; not approval to migrate RDS. |

The automatic runner creates a fresh cluster on each run, never resets another database, and retains ignored diagnostic files under `tmp/loadtest/`. Windows sandbox prevented native restricted-token startup initially; a scoped local process approval enabled this task-owned loopback cluster. No AWS elevation or access was involved.

Final DB run also exercised transaction-enforced read-only `check`. The runner removes inherited cloud credentials, PostgreSQL defaults and auth/database runtime settings from its child environment before starting fixtures. Both automatic-run clusters and the initial manually started task cluster were confirmed stopped; their synthetic diagnostic files remain ignored/local-only, not published evidence.

## What the DB checks exercised

- Reject an existing foreign table and a pre-existing cluster runtime role without altering them.
- Trial applies actual immutable reviewed fresh SQL, fixtures and grants, then rolls back completely, including the new runtime role.
- Commit and idempotent replay retain one round, ten complete synthetic Student links and ten Drafts; all 400 synthetic companies are public/queryable.
- Changed binding/input fails closed against the preparation fingerprint. Broadened privileges/role membership and foreign populated tables are detected, not silently repaired/deleted.
- Runtime cannot create tables, insert/re-role users, rebind identity, modify migration history or delete audit/operation receipts.
- Public list and detail return fixture companies; all ten modeled Students read exactly their own Draft. Missing/unknown identity fails authentication/authorization.
- PATCH commits content/version/operation receipt/audit together. Same operation replay is idempotent; stale versions and foreign ownership are rejected.
- Concurrent writes yield one success and one conflict. An intentionally failing local audit trigger rolls back content, version and receipt; retained immutability triggers are not disabled.

Initial Drafts are explicitly synthetic bootstrap records, not evidence of API submission or actual TU/Phase 1 registration. The tests do not change runtime source, production grants, historical migrations or observed upgrade lineage.

## Not verified / not authorized

- No test RDS, Secret, SG, role, Lambda/API, Cognito account or cloud data was created/modified/deleted.
- No real password/token/TU API call, genuine Cognito Hosted UI flow, authorizer, Secret endpoint access, RDS TLS/credentials, deployed API or Amplify browser was tested.
- No Locust installation, thousands-of-requests load, performance result, production capacity, credits balance or live CloudWatch access is claimed.
- The company generator and actual test-account bindings owned by teammates have not been accepted; local tests use a clearly synthetic helper/example.
- Full `npm test`, disposable suites outside this operator scope, rendered Desktop/Mobile QA and CI are not claimed. No UI/runtime source changes were made.
- No Git branch switch, commit or push. The live deployment record retains its original date and evidence.

AWS follow-up requires separately approved exact resources/permissions, account/region/ownership checks, engine/source/config compatibility, bounded load and cleanup. See [the next-phase proposal](loadtest-rds-preparation.md#6-ข้อเสนอ-aws-ขั้นถัดไป--ยังไม่อนุมัติยังรันไม่ได้).
