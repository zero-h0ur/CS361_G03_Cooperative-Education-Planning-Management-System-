# Coordinator workspace — local implementation and verification

Date: 2026-11-03 (Asia/Bangkok). Branch: `feature/coordinator-workspace-redesign`, based on `41f3a80`.

This is local source/test evidence, not deployment or production acceptance evidence. No AWS writes, production migrations, real student data, Issue/PR creation or push were performed.

## Approved design and latest refinements

The three approved screens use horizontal Coordinator navigation, the existing campus artwork, readable dark Prompt/Inter text, restrained cream panels and crimson actions. The `frontend-design` and `ui-ux-pro-max` skills guided scoped tokens, text-plus-color status indicators, keyboard tab semantics, dialogs and failure-state retention. Generic marketing/portfolio design-system suggestions were not adopted. No new font dependency or generated asset was added.

- The main canvas is now gray-white `#f3f5f7`; warm panels and the approved campus hero remain. All changes are scoped to `.coordinator-portal`.
- The seven submitted self-certifications retain disabled, semantically checked/unchecked checkboxes. Green SVG checkmarks make checked answers visible even when browsers gray native disabled controls. An unchecked answer remains unchecked and explicitly labeled. Green does **not** mean the application passed an automated eligibility check.
- The academic table has four columns: course, semester, study status and grade. Enrolled is yellow, not studied red and studied green, always with text labels. The present form does not store semesters per course: these cells show `—`, not the GPAX reporting semester. A grade is shown only for a single submitted attempt on a studied course; absent or ambiguous grades remain `—`.
- Forward confirmation highlights the applicant's submitted name and student number in a separate crimson-accented block. The question says “ให้กรรมการพิจารณาหรือไม่?” without “3 คน”. The committee still has three members overall.
- Five review tabs keep the page manageable. Skills remain the student's original multiline free text, not automatically classified tags. Attached documents are green, missing documents red; attached is not the same as verified content.

## Workflow and data boundaries

- Real Phase 1 applications are reviewed directly. Forwarding does not manufacture a legacy Plan, company, position or academic score.
- List/count/filter/sort operations are evaluated over the authorized dataset before pagination. Status shortcuts and the status selector stay synchronized. Search, curriculum, programme type and ordering remain available.
- Return/forward commands are versioned, transactional, idempotent and audited against the exact submitted snapshot. A forwarded application cannot be returned through this workflow.
- After the original deadline, only a previously submitted, explicitly returned application can be edited and resubmitted until the end of consideration. New applications and ordinary Drafts stay closed. Deadline comparisons use server time and half-open windows.
- Prior submitted payloads, documents and checksums remain immutable. Coordinator reads never reveal unsent corrections. Resubmission creates another immutable submission and returns it to pending review. The audit retains prior reasons even after the current review is reset.
- Tracking uses real core-course averages and GPAX, nulls last, and plain row positions rather than tied-rank badges or applicant votes. Missing/unverified academic data is unknown, not zero or an invented pass.
- The existing three-member Committee capacity-proposal/ratification and explicit meeting finalization remain separate from applicant ranking. Coordinator has no meeting-result mutation or publication action. Shared meeting state outside a partially assigned Coordinator's scope is withheld and explicitly explained.
- Schedule writes reuse the authoritative application window, add consideration/confirmation windows, require assignment across the whole round and reject stale versions. UTC instants are edited/displayed in Bangkok time. Invalid calendar dates, missing offsets and overlapping/reversed phases are rejected.

## Schema and runtime ACL

Migration `013_coordinator_workspace.sql` is additive/forward-only and registered with its reviewed SHA-256. Historical migrations and stored checksums were not rewritten. It adds schedule/review/operation records and supports multiple immutable submissions per application.

Runtime ACL permits the needed scoped writes while denying role/assignment/panel changes, official academic mutation, submission/document mutation and operation deletion. PostgreSQL row locks require UPDATE on at least one column: `selection_cohorts.created_at` is the sole lock-enabling column; coordinator, committee, programme and status columns are not granted. The isolated integration test runs the services under this actual limited role rather than the table owner.

Before any separately approved rollout: review/apply Migration 013 and the updated runtime grants, then release the compatible Backend and Frontend together. Do not deploy this Frontend alone against an older Backend/schema. Confirmation settings do not implement student confirmation, automatic relinquishment, publication or notifications.

## Automated verification

Results below are local and overlap; do not sum them as unique tests.

| Check | Result |
| --- | --- |
| `npm run test:coordinator` | 27 Jest tests passed; 8 PostgreSQL tests including the parent passed, none skipped |
| Focused Coordinator/Student/Application/shell UI run | 120 tests passed before the additional whitespace-search and meeting-scope regressions; those additional tests pass in the Coordinator run above |
| `npm test` | Full command passed using disposable local PostgreSQL, including 372 frontend tests, migration/authorization/runtime ACL, application, workflow, selection and release checks; its optional Committee DB test was skipped and then explicitly run below |
| `npm run test:committee` with its isolated DB URL | 9 Jest tests and 1 PostgreSQL integration test passed, none skipped |
| `npm run test:ui-preview` | 48 Jest tests and 2 loopback/build-isolation tests passed |
| `npm run lint` | Passed: 214 JavaScript modules at the time of the check |
| `npm run test:docs` | Passed; rerun after this evidence and Preview links were added |
| `npm run build:v4` | Passed; local output only, not uploaded |

The full regression uncovered two old hardcoded migration-list/count assertions. They now compare against `readReviewedMigrations()` (including checksums for packaged artifacts), rather than substituting another fixed count. The authorization endpoint matrix includes all new Coordinator routes. CI runs the Coordinator UI/API/isolated-DB suite explicitly.

Database tests used a disposable PostgreSQL 16 Docker container bound only to `127.0.0.1:55436`, with synthetic fixtures. No host data directory was mounted, and no production/AWS database was connected. Newly generated test schemas/roles are removed by the integration test. The detailed local regression log is retained under the ignored `docs/verification/` directory, not committed.

## Preview and remaining manual QA

Run `npm.cmd run dev:ui` and open the Coordinator links in the [Local UI Preview guide](../frontend/local-ui-preview.md). The normal port is 8081. For this implementation session a separate server was started on 8082, leaving the user's 8081 server untouched. The Preview builds in memory; restart it after editing source, then reload the browser.

Desktop/Mobile screenshots, a 375px overflow check, actual keyboard focus/scroll behavior, forced colors and reduced-motion browser checks are **not complete**. Earlier screen-control work was canceled by the user; this refinement used code/tests only and did not resume computer control. DOM/stylesheet tests and supplied reference screenshots do not replace real browser visual QA. Complete these checks before Merge/acceptance; no screenshot or pixel-perfect match is claimed.
