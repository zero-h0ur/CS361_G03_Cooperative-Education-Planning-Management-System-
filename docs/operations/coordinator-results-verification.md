# Coordinator Committee-results dashboard verification

Recorded 2026-11-10 on `feature/coordinator-review-window`, based on main `2f6b90b630da4af3e38b75113d47fbb6449ae6cb` (PR #173), with the preceding independent review-window work still uncommitted. This report concerns this turn's local dashboard changes, not a new commit, CI result or AWS release. Prior work was preserved.

## Implemented boundary

The existing tracking GET gains complete-panel result summaries and minimal confirmed identities. It preserves the separately filtered/paginated forwarded list. Read-only repeatable-read SQL keeps assignment, state and identity/version reads consistent. Saved Committee `applicants`/`selected` determine outcomes; no GPA/cutoff calculation or new decision/publication write is introduced. Pending, invalid/stale or partial-scope decisions remain unknown. Normal-stage legacy results stay explicitly labeled; restricted stages exclude them. See [API contract](../api/v4-coordinator-results.md) and [D12](../decisions/v4-tu-intake-boundaries.md#d12-read-the-committees-confirmed-result-without-repeating-its-decision-workflow).

## Environment and results from this turn

Node.js 22.23.4, `npm ci --offline`, PostgreSQL 16 Alpine in a new task-owned `--rm` tmpfs container. Only loopback ports 15449/55440 and dedicated `coed_v3_test`, `coed_selection_test`, `coed_intake_test`, `coed_present_test` were used. CI's explicit database variables/reset/disposable guards were supplied; `DATABASE_URL` pointed at unused `coed_unused`. No retained local database or RDS was reset.

| Command | Result this turn | Boundary |
| --- | --- | --- |
| `test:coordinator` (final) | 60 API/domain/DOM + 17 Node/DB checks passed, zero skips | Actual least-privilege runtime grants; claims synthetic |
| `test:committee` | 23 unit/DOM + 1 DB test passed, zero skips | Includes actual legacy Committee finalize → Coordinator result mapping, separate from Phase 1 |
| `test:student-intake` | 51 Node + 7 DOM checks passed, zero skips | Existing observed-schema, scope and review-window behavior retained |
| `test:frontend` (after caption fix) | 372 checks passed | DOM coverage, not genuine Cognito |
| `test:ui-preview` (final) | 48 DOM + 2 server checks passed | Isolated synthetic Preview, no AWS |
| `test:phase1-schedule` | 20 Node + 24 API/DOM passed, zero skips | Existing schedules/confirmation unaffected |
| `test:observed-upgrade` | 33 Node checks passed, zero skips | Disposable localhost55440, no real schema Apply |
| `lint`, `build:v4` | Passed; 351 JavaScript modules syntax-checked | Local build only |
| `test:docs`, `git diff --check` | Passed | Local document/link checks, no network |

Counts overlap between commands. The first unconfigured Coordinator run skipped DB suites; it is not the DB acceptance result above. Configured runs then passed with zero skips.

The new real Phase 1 integration test submits/forwards a second synthetic application, proposes capacity, has both other Committee members approve, finalizes one selected applicant, and reads Coordinator outcomes with a search yielding no forwarded-list rows and an out-of-range page. The result still contains both retained identities with correct distinct outcomes and whole-panel counts. It checks no new Committee event was written by tracking, unrelated Coordinator reads reveal no applicant, and a shared reassigned panel returns `SCOPE_LIMITED` without result names/counts. The legacy DB test separately confirms a plan is returned as `LEGACY_PLAN`, never as a Phase 1 application.

Domain tests cover absent finalization, changed/missing/foreign/duplicate applicant IDs/versions, malformed retained state, accepted combined/legacy capacity, explicit selections exceeding capacity, immutable input and mixed-panel unknown totals. UI tests cover result tabs, ten-row pagination/focus, unchanged totals across forwarded-list filters, opening the exact submitted detail, readonly/unknown states, error clearing stale results, retry and abort fencing. No POST is sent by the dashboard.

## Full regression limit

On the fresh task-owned cluster, `npm test` passed its preceding runtime/auth/frontend/application/intake suites through `test:student-intake`, then stopped at `test:release`: **32 passed, 2 failed, zero skips**. One is the exact committed-byte check because the preceding new 024 file is not yet in `HEAD`; rerun after owner commit. The other reproduces the pre-existing macOS ZIP Unicode filename corruption (`Unsafe archive entry name`). No assertion, archive guard or historical checksum was weakened. Committee/Coordinator and other focused checks ran separately after that stop. Full regression is **not** reported passing.

The shared-caption CSS adjustment was followed by Coordinator, frontend, Preview, syntax and strict production build checks. A final status/error-copy consistency adjustment was followed by Coordinator, Preview, syntax, build and docs checks. These change neither the finalization flow nor backend data behavior; the full command was not repeated solely for those presentation adjustments.

## Rendered and design verification

Synthetic Preview: `results-complete`, `results-pending`, `results-many`, at desktop 1280×720 and phone 390×844. Verified round-wide counts, selected/not-selected label and row filtering, unchanged counts when the forwarded curriculum filter is 61, pending outcomes shown as dashes with no rejection list, page 2 starting at item 11 and focused pagination summary, and no document-level horizontal overflow at either width. Phone caption layout was corrected through the shared Coordinator table style and visually rechecked at width 390; semantic captions remain available. This does not copy or merge the separate declaration-list changes proposed in PR #174.

The final phone screenshot is `tmp/release-candidates/coordinator-results-verification/mobile.jpg`; the desktop artifact precedes the caption-only correction. Browser connection stalled during optional final desktop capture; existing successful interaction/viewport evidence was retained. The viewport was reset and the task tab was closed using the documented browser API. This was not a product API error. Preview server and task-owned database container were then removed.

Official `designmd lint`: zero errors, six existing orphan-token warnings. Premium strict static audit retains one existing TU-onboarding dynamic `'#'+controls[key].id` false positive. It found no new dashboard issue. DOM/static checks do not prove full WCAG compliance or genuine live TU/Cognito/S3 behavior.

## Not deployed

No AWS inspection/write, policy publication, migration, commit, push or deployment occurred in this turn. The dashboard itself adds no migration, grant, route or feature-gate exception. The preceding review-window 024 remains a separate pending schema capability. Future release still requires review/commit/CI, artifacts bound to that commit and explicit deployment approval. A merged source change is not evidence that the live application runs it. Logs/artifacts are ignored local files, not guaranteed to exist in another clone.

Subsequent same-date owner correction retained the teammate’s original three-window schedule form and removed the separate review renderer; see [current schedule UI evidence](review-window-verification.md#owner-ui-correction--2026-11-10-current-presentation). Dashboard checks were included in the subsequent 60 Coordinator UI/API/domain checks. This does not change the results-read contract or earlier DB evidence.
