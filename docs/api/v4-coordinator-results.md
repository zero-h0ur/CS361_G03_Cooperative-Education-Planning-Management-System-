# Coordinator Committee-results dashboard

Status: local source extension, 2026-11-10. Builds on PR #173 and the uncommitted independent review-window work. It adds read-only results to the existing tracking route, not a new decision, publication or deployment operation.

## Read contract

`GET /api/v4/coordinator/tracking` keeps the existing role/assignment, maintenance/pilot, filter and `Cache-Control: no-store` contract. The existing `applications`, `total`, `counts`, `page`, `pageSize` fields describe the filtered/paginated forwarded Phase 1 list. New `dashboard` and per-meeting `result` describe the complete assigned panel(s) for `cycle_id`; search, curriculum, program, sort and pagination do not alter those results.

Each meeting retains `state` for existing readers and adds `cohort_id`, `cycle_name` and `result`:

- `status`: `PENDING`, `CONFIRMED`, `INCOMPLETE` or `SCOPE_LIMITED`.
- `capacity`, `proposal_status`, `forwarded`, `selected`, `not_selected`, `finalized_at`.
- `applicants`: only for `CONFIRMED`; minimal retained identity, version, curriculum/program, `source` and `outcome` (`SELECTED`/`NOT_SELECTED`). No contact details, grades, document bodies or new file access.

Only a finalized saved decision with accepted capacity, a unique applicant/version set matching the authorized Committee roster, and a unique selected subset produces outcomes. No GPA sorting, cutoff suggestion, checkbox draft or current page infers a result. Missing/changed/foreign/duplicate applicants produce `INCOMPLETE`, null outcome counts and no result roster. Missing finalization produces `PENDING`, never zero successful/rejected applicants. A missing timestamp stays absent.

Aggregate `dashboard` has `panels`, `confirmed_panels`, `forwarded`, `capacity`, `selected`, `not_selected`. Capacity requires accepted valid proposals in every readable panel. Outcome totals require every panel confirmed. Partial/out-of-scope aggregates stay null rather than treating a hidden panel as zero. Results may exceed capacity when the Committee explicitly selected additional tied applicants; the dashboard reads that decision rather than enforcing a new algorithm.

## Scope, consistency and domain separation

The active internal Coordinator must remain assigned to the round/cohort. Any shared panel with an active cohort assigned to another Coordinator returns `SCOPE_LIMITED` without raw state, names, counts or roster lookup. Existing restricted stage, flags and private cycle/Coordinator binding are unchanged. The entire tracking read uses a read-only repeatable-read transaction so counts, assignments, retained submissions and decision state share one database snapshot. It writes no business record or audit event.

Phase 1 identities come from the forwarded immutable submission, identified by the saved submission/application version. In the normal stage, existing legacy plan receipts are read separately and labeled `LEGACY_PLAN`; they remain plans and do not become Phase 1 submissions. Restricted intake stages exclude legacy records. Counts use **รายการ**, not a claim of deduplicated people across historical domains. Legacy rows do not open the Phase 1 detail action.

## UI and release boundary

The existing Coordinator tracking page contains a round-wide four-count summary, one panel section per Committee, saved confirmation time and outcome roster with All/Selected/Not-selected buttons and ten rows per page. Those buttons/page are local transient view state, separate from the forwarded-list filters below. Native buttons, existing table/card responsive behavior, badges, feedback and document/detail dialog are reused. Refresh loads current results; failure removes the stale dashboard and offers retry. Permission expiry and aborted/superseded reads keep their existing shell behavior.

The dashboard cannot propose capacity, vote, finalize, change a selected ID or publish results to Students. “Committee confirmed” remains separate from publication. No new table, migration, runtime grant, route, Gateway setting or feature gate is added for this dashboard. The pending 024 migration belongs to review-window configuration, not results display. A future application release still needs the reviewed commit/CI/artifact evidence and explicit AWS deployment approval. See [local verification](../operations/coordinator-results-verification.md).
