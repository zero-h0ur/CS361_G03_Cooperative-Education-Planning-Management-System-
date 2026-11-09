# Committee integration: local verification

Recorded **2026-11-09** on `feature/committee-handoff-integration`, an uncommitted merge of main `426f5320627e57e82e6ebd8136f6390d38d15942` (PR #171) and PR #172 head `a7747b6c3c6dda027c017855ea58ba6912e3d87b`. This report concerns local source integration. It does not refresh the dated [deployment snapshot](current-deployment.md) or establish that AWS runs this integrated source. No AWS writes, RDS queries/migrations, real account linking, commit, push or deployment were performed in this integration run.

## Integrated behavior

- Retain PR #172's all-assigned Committee roster, curriculum/program labels, combined capacity, Coordinator round memory, account-menu layering and Committee navigation changes.
- Preserve PR #171's separately saved, immutable six-check academic review and note. A one-checkbox `confirm_academic_review` command cannot substitute for that record. Pending academics require a complete latest verified policy and computed PASS before forwarding.
- Preserve mandatory review opening/closing boundaries, even when intake is manually open. Future or absent review windows block forwarding after a valid academic review has been saved.
- Preserve original submission ID/checksum, reviewed assessment and original assessment separately. Committee handoff remains read-only when the backend returns `can_decide=false`.
- A new capacity command uses integer `total` from 1 to 999. Complete legacy `normal`/`special` commands remain compatible; malformed or conflicting totals fail validation. Retained legacy fields on new receipts are compatibility fields, not newly assigned track quotas.
- Capacity and cutoff apply across the assigned panel. Curriculum/program/search filters change visibility only; tied cutoff applicants remain included. Filtered roster ranks and tie markers retain the panel-wide position. Remembered Coordinator rounds must still appear in server-returned assigned options.

No historical migration SQL/checksums were edited. The confirmed department criteria and academic-review requirements remain as documented in the [academic contract](../api/v4-academic-review.md) and [confirmed criteria](../api/v4-confirmed-academic-criteria.md); CO-ED does not add a retake-after-C check.

## Environment and commands

Node.js **22.23.4**, `npm ci --offline --no-audit --no-fund`, and a fresh task-owned PostgreSQL **16-alpine** tmpfs container. Its ports were bound only to **127.0.0.1:54349** and **127.0.0.1:55440**. Databases `coed_v3_test`, `coed_selection_test`, `coed_intake_test`, `coed_present_test` and the owner-tool fixture `coed` were disposable local fixtures. None was RDS or a retained development database.

Use the dedicated variables/reset guards from [verification setup](student-intake-verification.md) and the [CI workflow](../../.github/workflows/v4-verification.yml), substituting an explicitly disposable loopback cluster. In particular:

- `NODE_ENV=test`, `ALLOW_DB_RESET=true`; `DATABASE_URL` points at unused `coed_unused`.
- `TEST_DATABASE_URL`, `CO_ED_WORKFLOW_TEST_DATABASE_URL`, `CO_ED_APPLICATION_TEST_DATABASE_URL`, `COORDINATOR_TEST_DATABASE_URL`, `TU_DELIVERY_TEST_DATABASE_URL` point at `coed_v3_test`; `CO_ED_SELECTION_TEST_DATABASE_URL` points at `coed_selection_test`.
- `STUDENT_INTAKE_TEST_DATABASE_URL` points at `coed_intake_test` with `INTAKE_DISPOSABLE=true`.
- Explicitly set `COMMITTEE_TEST_DATABASE_URL` to the disposable `coed_v3_test`; otherwise its optional DB check skips.
- Observed checks use the separate `coed_present_test` with `PRESENT_SCHEMA_DISPOSABLE=true` and `PRESENT_SCHEMA_TEST_DATABASE_URL`, on loopback 55440.

| Check run in this integration | Result |
| --- | --- |
| Focused Committee/Coordinator/shell Jest suites after final source and tests | 119 tests across 6 suites passed |
| `npm run test:coordinator` before the final two round-memory cases | 40 DOM/API + 8 DB passed, zero skipped |
| `npm run test:committee` before final rank/tie assertions | 23 DOM/unit + 1 DB passed, zero skipped |
| `npm run test:student-intake` including future/missing review-window DB assertions | 51 Node + 7 DOM passed, zero skipped |
| `npm run test:phase1-schedule` | 20 Node + 24 DOM/API passed, zero skipped |
| `npm run test:ui-preview` | 48 DOM + 2 local-server passed, zero skipped |
| `npm run test:observed-upgrade` | 33 passed, zero skipped |
| `npm run build:v4` | Passed; local build only |
| `npm run verify:migrations` | 16 pinned SQL files unchanged |
| `npm run lint`, `npm run test:docs`, `git diff --check` | Passed |

Counts overlap between commands and must not be added as unique coverage. The final focused run follows small UI rank/tie and assigned-round test additions; the entire full command was not repeated after those additions.

## Rendered checks and limits

Local UI Preview used synthetic fixtures only. Committee rendered at **1280×900** and **390×844** without document-level horizontal overflow. All-assigned defaults, native select options, program filtering, combined capacity display and lower-ranked filtered applicants outside the combined cutoff were checked. The empty scenario rendered its empty roster. The handoff scenario showed the read-only stage and disabled accept/reject/propose controls. The final panel-wide rank/tie-marker correction was subsequently covered by DOM regression, not another rendered session.

At **390×844**, Coordinator required six checks and a note, showed a review confirmation, retained the saved checks/note read-only, then enabled Forward. The separate Forward confirmation contained no legacy academic checkbox. Confirming it showed the forwarded state. These actions changed only in-memory synthetic Preview data, not live education decisions or AWS records.

Strict changed-workspace static UI audit passed with zero findings. Whole-project strict audit separately reported the existing TU-onboarding dynamic `href='#'+controls[key].id` as `affordance.empty-href`; source inspection shows an actual field-error anchor. That unrelated source was not changed to suppress the result. Design-context lint had **0 errors, 6 orphaned-token warnings**. Neither static audit nor DOM tests substitute for rendered QA or genuine authentication.

`npm test` passed its preceding suites, including frontend, application and intake, then stopped in `test:release`: **32 passed, 1 failed, zero skipped**. The failure was the existing macOS Unicode ZIP round-trip case: external `unzip` damaged a Thai filename and the archive guard rejected it as `Unsafe archive entry name`. ZIP code/tests were not weakened. Thus **full regression did not pass**, and its final Committee command did not run; Committee was run separately above. Recheck release packaging on the intended platform and in CI before release.

## Next release boundary

The merge remains for the owner to commit and push, followed by independent review and CI. A clean-main release candidate prepared before this merge does **not** contain this integrated source and must not be presented as its artifact. Build/package source, configuration and hashes again after the final commit. Before any live release, inspect current AWS/schema drift, review compatibility/rollback and the forward-only 023/policy prerequisites, then obtain explicit approval for each SQL/AWS/deployment operation. Both backend and frontend need the approved integrated release. Genuine TU/Cognito, S3 acceptance and production Coordinator → Committee delivery remain unverified by this local run.
