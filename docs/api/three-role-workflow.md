# Student / Staff / Advisor workflow

This extends the [V3 contract](v3-shared-contract.md). Cognito authentication and
database-backed role/ownership/scope checks remain mandatory. `ADMIN` receives no
new business workflow endpoints. Documents are **external references only**;
CO-ED does not upload, download, inspect, or change sharing permissions of those files.

## Eligibility and placement are separate

Eligibility uses `DRAFT -> SUBMITTED -> UNDER_REVIEW` and then `APPROVED`,
`NEEDS_REVISION`, or `REJECTED`. A returned plan may be edited and resubmitted.
`REJECTED` prohibits editing, resubmitting, cancelling or creating another active
plan in that cycle; another application cycle requires a new eligibility review.
Student cancellation is soft cancellation from `DRAFT`/`NEEDS_REVISION` only.

`APPROVED` means eligible for cooperative education, **not company acceptance**.
Students may specify an interested company/position/project before company acceptance.
After approval and an actual company/student agreement, a separate placement form
records the actual company, position and project without rewriting the eligibility
submission. Company applications, CV/Resume, interviews, forms and emails stay external.

Placement states are `DRAFT -> SUBMITTED -> AWAITING_COMPANY -> CONFIRMED`.
Staff may return submitted/awaiting placement to `NEEDS_REVISION` with a reason.
Only Staff records dispatch and verifies externally returned evidence. The system
compares the submitted company name and official student number with Staff's entered
return-form data; this is a human attestation, not independent company authentication.

## Endpoints

All paths below begin with `/api/v3`. Private successful responses use `Cache-Control:
no-store` and the standard `{ data: ... }` envelope.

| Method | Path | Authorized actor / behavior |
| --- | --- | --- |
| GET | `/students/me` | Own Student; now includes `contact_address`, `contact_phone` |
| PATCH | `/students/me` | Own contact fields, `version`, `operation_id`; TU fields rejected |
| GET | `/plans/:id/workflow` | Owner / scoped Staff / currently assigned Advisor |
| PATCH | `/plans/:id/workflow` | Student owner, editable plan only; project and reference metadata |
| POST | `/plans/:id/submit` | Existing Student submission, now atomically snapshots policy/references |
| POST | `/plans/:id/cancel` | Student owner, editable states only; audit history retained |
| POST | `/plans/:id/reject` | Scoped Staff, OPEN cycle, UNDER_REVIEW; required `review_notes` |
| GET | `/staff/workflow` | Scoped Staff: own scopes, cycles, Advisor occupancy, policy versions and recent assignment history |
| GET | `/staff/advisors` | Scoped Staff; active Advisor IDs/names and global current counts, no out-of-scope Student names |
| GET | `/staff/assignments` | Scoped Staff; current assignments, `page`, `pageSize` (1-100), optional `advisor_id` |
| POST | `/staff/document-policies` | Staff within supplied cycle/department/program scope; append a published version |
| POST | `/staff/assignments` | Scoped Staff; approved plan and active Advisor; rejects overlap/capacity conflicts |
| POST | `/staff/assignments/:id/revoke` | Scoped Staff; reason/version required; release capacity |
| POST | `/staff/assignments/:id/reassign` | Scoped Staff; revoke and replace atomically with reason |
| GET | `/plans/:id/placement` | Same read scope as workflow; nullable placement |
| PATCH | `/plans/:id/placement` | Student owner after eligibility approval; editable placement only |
| POST | `/plans/:id/placement/submit` | Student owner; lock the saved company acceptance form |
| POST | `/plans/:id/placement/mark-sent` | Scoped Staff; record external form dispatch reference |
| POST | `/plans/:id/placement/return` | Scoped Staff; return company form with reason |
| POST | `/plans/:id/placement/confirm` | Scoped Staff; compare company/Student and retain external evidence reference |

Existing start-review, return-for-revision, approve, history and Advisor read endpoints
remain canonical. Existing preferred-name data/API compatibility is retained; no
preferred-name editor is restored in the UI.

## Write contracts

New commands use `operation_id` UUID and `expected_version`. Identical retries replay
the stored safe result after reauthorization; different payload/resource/actor reuse
conflicts. Version `0` denotes first policy publication or an uncreated placement.
Contact PATCH retains the existing profile field name `version` instead of
`expected_version`, and accepts only contact fields plus its operation UUID.

| Command | Additional writable fields |
| --- | --- |
| Save workflow | `project_title` (1-300), `policy_id`, `references` |
| Publish policy | `cycle_id`, `department`, `program` (empty = department-wide), `requirements` |
| Create assignment | `plan_id`, `advisor_id`, `effective_to`; expected version belongs to plan |
| Revoke assignment | `reason`; expected version belongs to assignment |
| Reassign | `advisor_id`, `effective_to`, `reason`; expected version belongs to old assignment |
| Save placement | `company_id` (optional existing ID), `company_name`, `position_title`, `project_title`, `accepted: true` |
| Mark placement sent | `reference` |
| Return placement | `reason` |
| Confirm placement | `company_name`, `student_number`, `reference` and/or `url` |

Placement commands use the placement version, not the eligibility-plan version.
Confirmation names compare trimmed NFC-normalized text exactly against the submitted
placement, not the originally interested company. Student number comes from the
official database record, not editable Student input.

Requirements are at most 30 entries, each with unique simple `id`, `title`, boolean
`required`, optional extension `format` and optional literal `filename_pattern`.
Only `{student_number}` substitution is supported; no Staff-controlled regex runs.
An empty published set explicitly means no required documents. A missing set blocks
new submission; the system does not invent department requirements or GPA thresholds.

References are at most 30 entries, each with `requirement_id`, stated `filename`,
stated `format`, optional `reference` and optional `url`; at least reference or URL is
required for each supplied entry. Only HTTPS without embedded credentials is accepted.
These fields describe an external file; checking declared filename/extension does
not inspect the actual file or prove its format. Staff remains responsible for review.

## Immutable submissions and compatibility

The first post-migration submission pins the published requirement set and snapshots
plan/company/position/project/notes/reference metadata in the same transaction.
Before first submission, a changed policy requires refresh and another save. A plan
already submitted keeps its pinned version on returned revisions; new plans use the
current policy. Legacy submissions are explicitly marked as lacking a historical
snapshot, never backfilled with invented evidence. Old linked plans remain readable.

Advisor capacity is **five distinct simultaneously supervised Students across all
years/terms**, not five per term and not an API pagination limit. Half-open effective
intervals and database row locking protect future overlaps and concurrent writes.
Only Staff assigns after eligibility approval; company confirmation is independent.
Reassignment/revocation/expiry removes old Advisor access on subsequent requests.
External links already copied cannot be revoked by CO-ED; original storage permissions
must be managed separately. Assignment history and submitted snapshots are retained.

See the [rollout and verification notes](../operations/three-role-workflow.md) before deployment.
