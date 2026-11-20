# Application UI ownership

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Shell/navigation | shell-app.js, Student workspace presentation | role allowlist in routes.js | role-scoped workspace | authenticated-shell tests |
| Select/Listbox | native select | option value and server cohort scope | native | committee-ui tests, browser Preview |
| Table Selection | Committee workspace selected Set | server validates accepted applicant ids | decision stage only; handoff is read-only | committee-ui, committee-workspace DB tests |
| Form | Coordinator components.field/dialog; native labeled controls and command adapter | academic-review-domain.js and committee-workspace-domain.js | Coordinator evidence checks; Committee proposal | domain, coordinator API/UI and intake DB tests |
| Date | stored timestamps, Thai presentation | server UTC timestamps | read-only review timestamp; existing schedule input | Bangkok formatting and schedule tests |
| Scrollbar | authenticated shell, Committee stylesheet boundary | CSS styles.js and Coordinator workspace.css | existing responsive document scroll | narrow viewport check |
| Toast | workspace live status and components.feedback | awaited server response | status / validation error / uncertain retry | retry UI test |
| CRUD | scoped API service + operation receipt | PostgreSQL transaction, version, scope, operation id | evidence confirmation / read-only handoff / existing decisions | coordinator and student-intake DB tests |


Committee: any member proposes; exactly one pending proposal; proposer cannot vote; both other members accept; rejection permits a new proposal. An accepted capacity enables explicit finalization. Coordinator owns publication. Preserve a failed command's operation id when retrying an uncertain network result. Refresh on conflict; do not silently overwrite. Synthetic data stays in scripts/ui-preview.

The proposal has one combined capacity for the assigned panel. The roster initially shows every assigned curriculum/program; filtering does not allocate new quotas or recalculate a separate cutoff. Ranking suggestions include ties at the combined cutoff. The server rejects contradictory combined/legacy counts; retained legacy normal/special records are displayed using their sum. Coordinator remembers the selected round only when it is still in the server-returned assigned options. A remembered round never grants scope. These UI consequences follow the integrated [Committee contract](docs/design/committee-workspace.md) and existing server panel/operation invariants.


## Coordinator academic evidence and Committee handoff

Current Student academic entry follows [owner-confirmed criteria](docs/api/v4-confirmed-academic-criteria.md): reuse the existing Student field/feedback/stepper owners, show one highest-grade select and fixed program course, and keep credits noneditable. Existing Draft attempt lists remain visible until an explicit highest-grade edit; historical submitted displays are unchanged. The stronger required-course acknowledgement is explicitly versioned, so an older true checkbox is not automatically shown as agreement to the new statement. Coordinator checks highest grades and GPAX against Transcript. The university registration system owns no-retake-after-C enforcement; CO-ED adds no extra gate, checklist or Student declaration for it.

Business authority: the owner selected **verified complete curriculum policy before forwarding** on 2026-11-08; see [academic review contract](docs/api/v4-academic-review.md). Submitted evidence and its original assessment remain immutable. Manual checks do not supply credits, repeated-course rules or a missing university policy.

The six checkboxes in `src/shared/academic-review.js` and a review note are entered explicitly by the Coordinator. No checkbox is preselected on a new review. Saving requires a review dialog naming the applicant, submitted version and policy version. Retained confirmation displays its actual checks/note read-only. Focus returns to that saved result. The forward action stays disabled until the server confirms the current submission, current policy and current assigned reviewer. A policy change or corrected submission requires a new review.

On an uncertain save, retain the same operation ID and typed note/checks; on conflict, preserve them while directing the user to reload. The workspace's existing leave guard covers unsaved review input and pending commands. A successful confirmation refreshes the same detail without losing the list/filter context. Handoff-only Committee access allows reading forwarded records/documents and disables proposals, votes and finalization on both server and UI.

## Independent Coordinator review window

Owner decision [D11](docs/decisions/v4-tu-intake-boundaries.md#d11-coordinator-configures-the-review-interval-independently) permits the whole-round Coordinator to configure the review interval before confirmation dates exist. `src/frontend/coordinator/workspace.js` retains the original three-window schedule form as its canonical owner. The owner clarified on 2026-11-10 that review is the existing “ช่วงพิจารณาใบสมัคร”; remove the initially separate form. Keep all twelve labeled date/time inputs visible. In restricted review-edit mode only the four review inputs are editable, submitting exactly two explicit Bangkok timestamps, expected schedule version and retry operation ID. Full-edit mode keeps the original complete schedule command. Shared reload/cancel dialogs protect unsaved values in the same form. Missing schema/role/stage is read-only; invalid/missing/reversed dates get associated text errors and focused correction. An uncertain save/conflict keeps values and retry ID, disables concurrent intake/save controls, and offers reload through the shared discard dialog. API/DB tests verify untouched intake/confirmation, optimistic concurrency, audit rollback, scope and observed-upgrade preservation. Existing shell navigation uses the pre-existing synchronous leave guard; this change does not replace that application-wide contract.

## Coordinator Committee-results read model

[Results contract](docs/api/v4-coordinator-results.md) owns data behavior. `coordinator/results-dashboard.js` owns presentation and composes `coordinator/components.js` table, badges, button, note and detail-dialog callback with existing CSS tokens. Counts/outcomes come from `meetings[].result`/`dashboard`, never from a filtered page or a ranking heuristic. The local pressed outcome buttons and ten-row pagination are transient read-only view state; changing forwarded-list filters does not change totals or reset the chosen outcome filter. Incomplete, not-yet-confirmed, shared-scope, empty, loading/error/retry and aborted reads have explicit states. Normal-stage legacy rows are labeled and do not use the Phase 1 detail action. This dashboard does not expose new decision or publication controls. API/domain tests and real Committee-finalize→Coordinator DB tests cover data scope/versions; DOM and rendered Desktop/Mobile QA cover interaction and layout.
