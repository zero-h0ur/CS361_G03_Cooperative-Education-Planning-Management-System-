# Confirmed academic criteria: local verification

Recorded 2026-11-08, uncommitted working source on `cdfdf7d4dfa9dbbc399d991361fcc250de8ca129`. This run follows the owner's explicit department-criteria confirmation. [Criteria contract](../api/v4-confirmed-academic-criteria.md), [handoff contract](../api/v4-academic-review.md), [prior local evidence](academic-review-verification.md).

## Later owner clarification: registration rules stay outside CO-ED

The owner clarified that the university registration system already prevents retakes after C. CO-ED now neither rejects retained attempts based on that chronology nor requires Coordinator to recheck it. Student help/acknowledgement and the Coordinator checklist no longer request that check; highest-grade selection, C minima, GPAX/group thresholds, program courses and Transcript grade comparison remain. `retake_after_pass` was removed from policy/snapshot metadata and the new uncommitted 023 guard; both 023 copies and their pins were updated together. Historical migration bytes and submitted records were not changed.

The earlier results below describe the preceding implementation, including the now-removed chronology test. The clarification is covered by the focused correction run: academic-review tests assert highest-grade selection without a chronology rejection, and Student/Coordinator UI tests assert the removed obligation is absent. No AWS writes, commit or deployment were performed for this correction.

Correction-run evidence: **51 Node + 7 DOM intake checks passed** with zero skips against a fresh ephemeral PostgreSQL 16 database `coed_intake_test` on loopback **54349**; focused Student/Coordinator UI **68 passed**. The intake run includes the **9 academic-review tests**, not 9 additional unique checks. Lint passed **344 modules**, the **16** migration working hashes verified, production build passed, docs passed **9 tests / 75 documents / 416 local links**, and `git diff --check` passed. Student wording was rendered at **390px**, with no document-level horizontal overflow and no no-retake-after-C instruction. The full regression/release command was not rerun for this correction; its earlier release limitations below remain separate.

## Changes and authority

The owner confirmed the existing 2568 / 1/69 minimums, 3 credits per course, highest grade after prior failures, C per counted course, no retake after C, regular/CIS CS213 versus special/ACS CS216, and enrolled additional courses counting toward the existing groups. This is the source authority; no unprovided university document or extra credit/rule was invented.

`src/shared/faculty-criteria.js` owns version `TU_CS_2568_CONFIRMED_2026_11_08`, policy data preparation, pinned criteria and program resolution. Current Draft readiness/Submit uses this contract; new snapshots pin it. Academic review requires a matching latest verified policy and recomputes under these rules. The still-uncommitted fresh/observed 023 guards/hashes were updated together. No historical SQL was rewritten.

The Student form shows the fixed program course and one highest-grade input; old Draft attempt lists require an explicit edit to use the highest result and reset the course acknowledgement. Old submitted statements/attempt displays are retained. Current required-course acknowledgement stores the criteria version, preventing an old true boolean from being displayed as agreement to a stronger statement. The full Transcript remains the Coordinator's evidence for undisclosed attempts and no retake after C; a single highest-grade input cannot prove the complete history.

## Environment and checks

Node **22.23.4**, `npm ci --offline --no-audit --no-fund`, fresh ephemeral PostgreSQL **16-alpine** container with tmpfs storage on loopback **54339**, dedicated `coed_v3_test`, `coed_selection_test`, `coed_intake_test`. DB variables and disposable guards followed [intake verification](student-intake-verification.md). No RDS, AWS calls/writes, real Student records, policy publication, migration Apply on AWS, deployment, commit or push were used.

| Check | Result |
| --- | --- |
| `npm run test:application` | **18 Node + 61 DOM/API passed**, zero skipped |
| `npm run test:student-intake` | **51 Node + 7 DOM passed**, zero skipped; includes 9 academic-review/criteria tests |
| `npm run test:coordinator` | **38 DOM/API + 8 DB passed**, zero skipped |
| `npm run test:committee` | **10 DOM/unit + 1 DB passed**, zero skipped |
| `npm run test:ui-preview` | **48 DOM + 2 server passed**, zero skipped |
| `npm run lint` | **344 JavaScript modules passed** |
| `npm run verify:migrations` | **16 pinned working-source LF files verified**, database untouched |
| `npm run build:v4` | Passed locally; does not establish a published artifact or deployment |
| `npm run test:docs` / `git diff --check` | **9 doc tests passed; 75 documents / 416 local links, zero failures**, no network requests; diff whitespace check passed |

Coverage includes both curricula and both programs, program/major mismatch, counted-course mapping, C boundary versus D+/D/F, overall average and GPAX thresholds, enrolled extras, highest grade after previous failures, any later retained retake after C, contradictory/old policy metadata, explicit criteria acknowledgement, unchanged original snapshots, version/policy changes, transaction/audit rollback, replay/concurrency, correction deadlines and scoped Committee reads/documents. Canonical recognized program metadata takes precedence over a contradictory payload major; ambiguous routing labels are not invented into a track.

An initial application-only run omitted its DB variable and skipped the DB case; it is not counted as DB success. Later configured runs above passed with no skips. The initial full run exposed old synthetic `LATEST`/`STUDENT_SELECTED` fixtures, which were updated to the owner-confirmed contract without weakening runtime guards. A reused disposable cluster also exposed the pre-existing seed helper's inability to clean later Committee workspace leftovers; the task's own ephemeral cluster was recreated for the final full run instead of relaxing constraints or changing production seed behavior. PostgreSQL startup was then awaited on the final TCP listener, rather than its transient initialization socket.

## Full regression boundary

The final fresh-cluster `npm test` passed its preceding suites, including TU/auth, frontend, application (**18 + 60** at that point), intake (**51 + 7**) and schema/runtime checks, then stopped in `test:release`: **31 passed, 2 failed, zero skipped**. It did not pass overall or reach its final Committee command. The known release failures remain:

1. New 023 is uncommitted, so the unchanged committed-byte gate cannot read it with `git show HEAD:...`. Working bytes match their pins; no commit was created or gate weakened.
2. The existing macOS ZIP Unicode round-trip fails when `unzip` damages the Thai filename. ZIP code/tests were not changed to hide the failure.

Committee and Coordinator were run separately with their DB variables. A later canonical-program helper refinement, current option-template metadata and one extra highest-grade Draft UI test were covered by the final focused application/intake/Coordinator runs above; the whole full command was not repeated after those small changes. Option templates now expose the confirmed contract with `owner_confirmed=true` but remain `verified=false`; they are not real published cycle policies.

## Rendered UI and static audit

The task used its own synthetic loopback Preview on **8082**, leaving an existing server on 8081 untouched. Special/ACS rendered CS216; regular/CIS rendered CS213, with one highest-grade select and 3-credit/C help. A synthetic D+ was saved and readiness refused submission with a linked course-specific error. Changing it to C, while group GPA remained **2.8571**, produced ready status. This is Preview behavior, not a real Student submission or S3/TU/Cognito acceptance.

Desktop document width **1280** and mobile **390** had no document-level horizontal overflow. The native grade options were inspected and selected; keyboard Tab from CS100 reached CS101. Mobile controls/help were visually checked, with synthetic screenshots saved outside the source tree. DOM tests separately covered old acknowledgement booleans, explicit version storage and preservation of multiple Draft attempts until a deliberate highest-grade edit.

Whole-project strict UI audit reported the same existing false positive in `src/frontend/auth/tu-onboarding-view.js:45`: a dynamic field-error anchor was classified as an empty hash. It is a real focus link, not a placeholder, and that unrelated file was not edited to suppress the audit. Scoped strict audit of Student/Coordinator/Committee passed with **zero findings**; static checks do not replace the runtime evidence above.

## Before activation

The source criteria are complete. A reviewed new policy version for the real cycle/curriculum still must be published to RDS under a separately approved owner operation. Existing published policies are not silently replaced. Review staff/panel/dates, independent code review/CI, release gates, observed-schema compatibility/trial, explicit approval for 023 Apply and backend/frontend deployment, and genuine browser acceptance remain required. Source confirmation is not AWS release approval.
