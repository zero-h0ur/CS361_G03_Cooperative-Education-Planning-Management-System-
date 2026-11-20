# Independent Coordinator review-window verification

Date: 2026-11-10. Local uncommitted changes on `feature/coordinator-review-window`, based on merged main `2f6b90b630da4af3e38b75113d47fbb6449ae6cb` (PR #173). This report does not claim a new GitHub commit, CI run, SQL Apply or AWS deployment.

## Requirement and source

Owner answers: use for testing; Coordinator configures dates in the system; retain the existing scoped round/accounts and Committee read-only handoff. See [D11](../decisions/v4-tu-intake-boundaries.md#d11-coordinator-configures-the-review-interval-independently) and [API contract](../api/v4-academic-review.md#independent-review-window-setup-local-source-2026-11-10).

The new review-only POST preserves intake/confirmation values and uses the existing runtime role, schedule version, locks and atomic operation audit. Fresh/observed 024 permits a not-yet-scheduled confirmation pair without changing recorded review dates or old SQL. Missing 024 is read-only/fails closed. A new interval is not a policy, academic certification, forward receipt or selection decision.

## This turn's environment and evidence

Node.js 22.23.4, `npm ci --offline`, PostgreSQL 16 Alpine in a task-owned `--rm` tmpfs container. Loopback 15449: dedicated `coed_v3_test`, `coed_selection_test`, `coed_intake_test`; loopback 55440: `coed_present_test`. CI's named variables/reset guards were supplied, including `NODE_ENV=test`, `INTAKE_DISPOSABLE=true`, `PRESENT_SCHEMA_DISPOSABLE=true`. `DATABASE_URL` pointed at unused `coed_unused`, never RDS. Synthetic fixtures only.

| Check | This turn's result | Boundary |
| --- | --- | --- |
| Coordinator focused | 49 API/domain/DOM checks and 16 Node checks including DB subtests passed, zero skips | Trusted claims modeled; actual least-privilege PostgreSQL role used for DB commands |
| Student intake | 51 Node checks + 7 DOM checks passed, zero skips | Includes real observed023→024 gate denial, transaction rollback trial, exact retained schedule preservation, audited review-window save/replay and unchanged intake; no live S3/TU acceptance |
| Application | 18 Node + 61 API/DOM checks passed, zero skips | Disposable local storage/DB |
| Committee | 23 unit/DOM + 1 DB test passed, zero skips | Run after regression established its fixture schema; decisions in synthetic normal mode do not enable live decisions |
| Schedule compatibility | 20 Node + 24 API/DOM checks passed, zero skips | Existing full schedule behavior retained |
| Shared frontend / Preview | 372 frontend checks; 48 Preview + 2 server checks passed | DOM checks supplemented by rendered QA below |
| Observed-schema runner | 33 Node checks passed, zero skips | Dedicated localhost55440; old observed preservation/delivery checks, not an RDS Apply |
| SQL hashes | `npm run verify:migrations` passed: 17 fresh files | Historical 16 pins unchanged; separate observed024 hash verified |
| Syntax / strict production build | `npm run lint`, `npm run build:v4` passed | No upload/deployment |
| Documentation | `npm run test:docs`, `git diff --check` passed | Local files/links only |

`npm test` on the fresh disposable cluster passed its runtime/auth/application/intake checks through `test:student-intake`, then failed at `test:release`: **32 passed, 2 failed**. One is the intended exact-committed-byte guard: new 024 exists in the working tree but not `HEAD`; rerun after the owner commits. The other reproduces the pre-existing macOS ZIP Unicode filename corruption (`Unsafe archive entry name`). No historical checksum, archive safety check or release assertion was weakened. Committee was run separately because the shell chain stops at release. Do not describe the full regression as passing.

Earlier local attempts exposed fixture-order issues: simultaneous first-time extension creation between two Coordinator DB files, and a second full run after standalone Committee fixtures. Coordinator DB files now run sequentially; the definitive full run used a newly created disposable cluster. No retained database was reset and no product constraints were changed for those fixture issues.

## Rendered UI and static design checks

Synthetic `npm run dev:ui`, Coordinator `review-window`, `review-window-conflict` and `review-window-upgrade`. Rendered at desktop 1280×720 and phone 390×844. Verified four labeled fields, Thai/Bangkok preview, successful save feedback, unchanged dates after simulated conflict, shared reload/discard dialog with cancel retaining input, and disabled missing-upgrade fields/button. Document scroll width equals viewport width at both sizes. DOM suites additionally cover invalid input focus, busy/duplicate prevention, retained operation ID, readonly and abort fencing.

Official `designmd lint DESIGN.md`: zero errors, six pre-existing orphan-token warnings. Premium strict static audit: one pre-existing false positive in `tu-onboarding-view.js:45`, where a dynamic `'#'+controls[key].id` error-summary link has a real destination. No finding in the changed review-window UI. Existing application-wide synchronous navigation guard remains; the new reload uses the maintained app-owned dialog. Native OS date/time popups are intentional per DESIGN.md.

Local logs/screenshots are ignored under `tmp/release-candidates/review-window-verification/`; they are not deployment evidence and are not guaranteed to exist in another clone. The temporary browser tab/viewport override, Preview server and DB container were cleaned up after checks.

## Deployment remains separate

No AWS call, cloud write, policy publication or application deploy occurred for this code change. The earlier approved read-only RDS inspection (2026-11-09 23:53 Bangkok) found history only through 022, no bound-round 61/66 policies and no review dates; that prior observation does not establish current state. The PR #173 candidate artifacts predate this change. Future rollout needs the reviewed new commit/CI/artifact hashes, fresh compatibility evidence and separate approval for observed 023/024, policy publication, backend/config and Amplify release, followed by genuine assigned Coordinator/Committee acceptance.

## Owner UI correction — 2026-11-10 (current presentation)

The owner confirmed that “ช่วงตรวจรับ” is the teammate's existing **ช่วงพิจารณาใบสมัคร**, not a new workflow, and asked to preserve the existing design. The earlier four-input separate-form screenshots above are superseded for UI presentation; their historical test results are retained, not promoted to proof of this correction.

Removed the uncommitted separate renderer. `coordinator/workspace.js` now uses the original three-section form (intake, application review, confirmation), original section labels/overview and “บันทึกกำหนดการ” action in every scenario. Full-edit mode keeps all twelve inputs and the existing complete command. Restricted review-edit mode enables only the four existing review inputs and uses the already-reviewed narrow server capability; other sections remain reference-only. No dates, intake controls, criteria or database schema were changed by this UI correction. Cancel/reload reuse the shared discard dialog, failed retries retain values/operation ID, and busy restoration respects previously readonly inputs. Server error wording now uses “ช่วงพิจารณาใบสมัคร”. Dashboard work remains intact.

Current-turn checks after the correction: Node.js 22.23.4 and `npm ci --offline`; Coordinator **60 API/domain/DOM** checks passed, frontend **372** checks passed, Preview **48 DOM + 2 server** checks passed, syntax lint **350 modules** and strict `build:v4` passed. The Coordinator command's two optional DB tests were **skipped this turn**; their earlier configured results above are separate evidence. This correction changes frontend behavior and error copy; no SQL/DB logic changed, and full/database regression was not rerun. Docs and whitespace checks passed.

Rendered synthetic Preview on task-owned localhost8082 at **1280×900** and **390×844**. Confirmed all three original legends and twelve inputs remain, full mode enables twelve, scoped mode enables only four review inputs, scoped save succeeds through the same form, no duplicate heading/form appears, and scroll width equals viewport width. The existing localhost8081 server was left running; the agent created/stopped only its separate8082 server. Local screenshot evidence is ignored under `tmp/release-candidates/coordinator-schedule-correction/`. Browser tab and viewport override were cleaned up. No AWS operation, RDS Apply, commit or push occurred.

Post-correction design checks: `designmd lint` again returned zero errors with the same six orphan-token warnings. Premium strict audit again found only the existing TU-onboarding dynamic-anchor false positive, no schedule-form finding.
