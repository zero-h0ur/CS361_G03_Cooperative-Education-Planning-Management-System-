# Academic review → Committee: local verification

Recorded 2026-11-08 against the uncommitted working extension on base `cdfdf7d4dfa9dbbc399d991361fcc250de8ca129`. Scope and prerequisites: [contract](../api/v4-academic-review.md). No AWS calls/writes, RDS migration, real Student submission, deployment, commit or push were performed for this extension. Earlier version-9 release evidence is separate in [current deployment](current-deployment.md).

This evidence snapshot precedes the owner's subsequent explicit credits/retake/program-course confirmation. The working source and new, still-uncommitted 023 were then refined; use [confirmed-criteria verification](confirmed-criteria-verification.md) for that later run. Earlier counts and policy assumptions below are retained as historical local evidence, not the latest results.

## CI compatibility follow-up (2026-11-09)

[CI run 42501577043](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/42501577043) tested committed source `6ca9f6f05bfe013f783732d94e8d12b5e9d92b4d`: `regression` passed, but `observed-schema-upgrade` failed because the observed018 HTTP fixture applied the current runtime ACL script, which unconditionally referenced the later `phase1_academic_reviews` table. The same missing-relation failure was reproduced locally before this fix.

The runtime ACL script now applies its academic-review grant/check only when that table exists. All existing delivery, audit, identity and scope ACL checks remain active. It does not create the table or apply 023; a pre023 pending-academic submission still cannot be forwarded without the required review schema. Fresh023 still grants only SELECT/INSERT for academic reviews. An inherited mutation grant causes the complete ACL transaction to roll back. Historical SQL/checksums, observed catalog fingerprints and CI checks were not changed.

Local verification of this fix uses Node.js **22.23.4**, `npm ci`, and a new task-owned PostgreSQL **16-alpine** tmpfs container at **127.0.0.1:55440**, with separate empty `coed_present_test`, `coed_v3_test` and `coed` fixture databases. The `coed` database here is a disposable local owner-tool fixture required by the test guard, not RDS. Reproduce observed checks with `NODE_ENV=test`, `PRESENT_SCHEMA_DISPOSABLE=true`, `PRESENT_SCHEMA_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55440/coed_present_test` and `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55440/coed_unused`; then run `npm run test:observed-upgrade`. The second CI step uses `OWNER_TOOL_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55440/coed` and `npm run test:production-tooling`.

- Observed upgrade preservation/rollback and Student-to-Coordinator HTTP: **33 passed, zero failed/skipped**.
- Production tooling offline and real SELECT-only local credential: **23 passed, zero failed/skipped**. AWS transports are mocked; this is not live AWS verification.
- Fresh-schema Student delivery: **13 passed, zero failed/skipped**, using `TU_DELIVERY_TEST_DATABASE_URL` pointing to the separate loopback `coed_v3_test` and no observed-baseline override.
- Runtime ACL integration: **4 passed**, including repeat application, removal of excess direct review privileges, rollback on inherited review mutation rights and denied identity/audit writes. Uses the same disposable `coed_v3_test`, `TEST_DATABASE_URL`, `ALLOW_DB_RESET=true` and `NODE_ENV=test`.
- Syntax lint: **344 modules**; migration verification: **16 unchanged pinned SQL files**; documentation: **9 tests, 75 documents / 416 local links**, no failures. `git diff --check` passed.

These are local results on the fix, not a new GitHub CI success or live deployment. No AWS changes, RDS queries/migrations, commit or push were performed. Earlier feature evidence and full-regression limitations below retain their original dates.

## Environment and reproducible checks

Node.js **22.23.4**, `npm ci --offline --no-audit --no-fund`, PostgreSQL **16-alpine** in a fresh ephemeral Docker container with tmpfs storage, loopback **54339**. Only `coed_v3_test`, `coed_selection_test` and `coed_intake_test` in this disposable container were used; no existing local retained database or RDS was reset.

Follow the dedicated variables in [intake verification](student-intake-verification.md) and the [CI workflow](../../.github/workflows/v4-verification.yml), substituting only an explicitly disposable loopback cluster. Intake requires `STUDENT_INTAKE_TEST_DATABASE_URL` with database name `coed_intake_test`, `NODE_ENV=test` and `INTAKE_DISPOSABLE=true`. Other DB suites require their own variables; `DATABASE_URL` pointed to unused `coed_unused`. Committee was explicitly supplied `COMMITTEE_TEST_DATABASE_URL`; a missing variable is a skip, not evidence.

| Command | Latest result for this extension |
| --- | --- |
| `npm run test:student-intake` | **46 Node + 7 DOM passed**, zero skipped |
| `npm run test:coordinator` | **38 DOM/API + 8 DB passed**, zero skipped |
| `npm run test:committee` | **10 DOM/unit + 1 DB passed**, zero skipped |
| `npm run test:ui-preview` | **48 DOM + 2 local-server passed**, zero skipped |
| `npm run lint` | **343 modules passed** |
| `npm run verify:migrations` | **16 working-source files match pinned LF hashes**; database untouched |
| `npm run build:v4` | Local production build passed; this is not deployment |
| `npm run test:docs` and `git diff --check` | Passed: **9 document tests, 73 documents / 402 local links**, zero link failures; no network requests |

The fresh/observed 023 contract compares both pinned hashes and the common SQL body. Observed tests adapt the database/schema identifiers only inside the disposable fixture, verify owner-setting denial, trial rollback, successful local Apply and retained history. This is not a current production catalog inspection or proof that the observed live 022 catalog is compatible with 023.

## Behavior verified

- Incomplete/unverified/synthetic criteria, missing credits/repeat rule/source, inconsistent track/major, missing files, known failing grades and ambiguous selected repeats cannot be certified. The original pending snapshot is unchanged by the preview calculation.
- Flags retain the intended maintenance paths and block other stages, TU staff calls, Committee mutations and schedule writes. Role/token permission-matrix coverage includes the new academic-review route. DB scope checks use modeled Cognito context, not a genuine Cognito login.
- Real PostgreSQL tests exercise required manual checks, rejected browser-supplied assessment, wrong actor, stale submission/version, atomic audit-failure rollback, same-operation concurrent replay and policy change invalidation.
- Return/correction/resubmission preserves original evidence and requires a fresh review. Forwarded records cannot receive a new review through the service or direct SQL insertion. Runtime update/delete/truncate of academic reviews is denied; even owner update is rejected by the immutable-row guard.
- Coordinator Forward creates the existing durable queue relationship. Committee sees the same submission ID/checksum and four retained document references, the reviewed `PASS`, and the original `UNKNOWN`. Unassigned document access and Committee decisions in this stage are denied. Local storage targets do not establish S3 acceptance.
- A shared Committee panel that includes a different Coordinator outside the configured binding cannot receive a forward or expose a partial queue. The failed forward leaves its operation retryable; removing the synthetic out-of-scope assignment permits the original operation to complete once.

## Rendered UI and audit

Local Preview only, synthetic fixtures, no AWS. At **1280px desktop** and **390px mobile**, Coordinator review rendered without document-level horizontal overflow. Six checks and note were entered deliberately, the review dialog confirmed, saved checks/note became read-only, and Forward became available. Keyboard focus returned to the saved result; Tab reached the next action. Forward confirmation produced the explicit forwarded state. The missing-policy scenario kept confirmation/Forward disabled and explained the missing criterion.

The final focused DOM regression also checks that canceling a filter change preserves unsaved academic notes and restores the displayed filter without issuing a reload. Approving discard allows the new filter. This later interaction fix was DOM-tested; the rendered session above preceded that final guard change.

Committee's handoff scenario displayed its read-only stage, disabled proposal/vote controls, and the separately labeled reviewed grades/source. The mobile detail drawer rendered without document-level horizontal overflow. Preview can validate layout/interaction, not persisted delivery or real identity permissions; those are separately covered only to the stated local DB/model boundaries.

Strict product-admin UI audit of the changed Coordinator/Committee source passed with zero findings. Whole-project audit separately reported an existing TU-onboarding dynamic `href='#'+controls[key].id` as a placeholder; source inspection shows a real field-error anchor with focus behavior. That unrelated file was not changed to suppress the audit. This is not a claim that the whole-project strict audit passed.

## Full regression limits and release gates

The configured `npm test` passed its preceding suites, including auth, frontend, application and intake, then stopped in `test:release`: **31 passed, 2 failed, zero skipped** in that release run. Therefore **the full command did not pass** and did not reach its final Committee command; Committee was run separately as recorded above.

1. The committed-byte release test runs `git show HEAD:src/db/migrations/023_phase1_academic_review.sql`. New 023 is intentionally uncommitted until owner review, so this gate fails. The working bytes match the pinned hashes. No historical checksum was changed, no Git commit was created and the gate was not weakened. Rerun after the owner commits the new SQL/source.
2. The existing macOS Unicode ZIP round-trip test fails after `unzip` damages the Thai filename (`Unsafe archive entry name`). The previous routed-intake task also recorded this failure on unchanged ZIP code. The same platform limitation reproduced here; it was not hidden by changing the test. Build success is not evidence that this release check passed.

Later small changes (saved-review UI/test fixture, post-forward denial assertions and documentation) were checked by the focused suites recorded above. The entire full command was not rerun after those changes. A first focused DB attempt was blocked by the shell sandbox's loopback `EPERM`; the approved loopback-only rerun passed. A new Committee DOM test initially used unavailable `structuredClone` in jsdom; the fixture was corrected to the suite's JSON-clone convention and passed. Neither issue was resolved by relaxing runtime guards.

Before any release: review/commit the change, obtain independent review/CI, resolve/recheck release gates on the intended packaging platform, inspect the current observed schema, review/trial the forward-only 023 upgrade, confirm approved real policy/staff/review dates, and obtain explicit approval for each AWS/SQL/deployment operation. This extension needs **both backend and frontend** release; flags alone are insufficient. Genuine Coordinator → Committee browser acceptance and production rollback compatibility remain unverified.
