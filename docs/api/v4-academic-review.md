# Coordinator academic review and Committee handoff

Status: introduced locally on 2026-11-08, with independent review-window setup added on Nov 10. Observed 023/024 and policies for curricula 61/66 in round 2569/1 were applied on Nov 10. Source `791ed1e` was deployed as API15/Amplify38 on Nov 11. Genuine Coordinator/Committee browser acceptance remains pending. See [release evidence](../operations/coordinator-review-results-release.md).

## Approved requirement

The owner requires complete verified curriculum criteria before Coordinator forwards a pending-academic Phase 1 application to Committee. Student submission may retain `UNKNOWN`; forwarding may not treat it as `PASS`. This workflow is separate from legacy company/Project plans and Committee selection decisions.

## Flow and retained evidence

1. Student submits through the existing TU intake. The committed snapshot/checksum, document references, pending assessment and destination receipt remain immutable.
2. The assigned active Cognito Coordinator opens the retained application. A preview calculates readiness from its payload/documents and the latest matching `phase1_policies` entry. It is explicitly unconfirmed.
3. The Coordinator checks curriculum/major, program type, entry year, highest grades/GPAX against Transcript, all four document types, and declarations/supporting evidence. All six checks and an evidence note are required; nothing is checked automatically. Registration eligibility for retaking after C belongs to the university registration system and is not rechecked by CO-ED or Coordinator.
4. The server revalidates scope, current submission, policy, review window, operation/version and computed `PASS`. It atomically appends a `phase1_academic_reviews` record and matching `coordinator_operations` audit/receipt. It does not update the submitted snapshot or global Student academic profile.
5. Forwarding rechecks the latest policy, review actor/cohort, submission/checksum, deadlines, active three-member panel and existing meeting locks. The existing forwarding transaction records the handoff and updates the Committee queue.
6. Assigned Committee members read that forwarded submission and its authorized original documents, with a separate reviewed assessment. The original pending assessment is retained for provenance. In the restricted handoff stage they cannot propose capacity, vote, select or finalize.

Changing the policy invalidates the old review for a future forward; a corrected/resubmitted application requires a new review for its new submission ID. Old records remain. After forwarding, no additional academic review can be appended to that application. A subsequent policy version does not rewrite evidence already forwarded under the prior criteria.

## Policy and scheduling prerequisites

Criteria were explicitly confirmed by the owner on 2026-11-08: every counted course 3 credits, highest grade, C minimum per course, and CS213 for regular/CIS versus CS216 for special/ACS. The owner clarified that the university registration system owns the no-retake-after-C rule; it is not an application gate here. See the [confirmed criteria contract](v4-confirmed-academic-criteria.md). Certification still requires a matching latest versioned `phase1_policies` record, verified and non-synthetic for the exact cycle/curriculum with source reference and `source_year=2568`. Old or contradictory metadata cannot certify; knowing the source criteria is not policy publication.

The confirmed source values are prepared in the shared helper. An authorized owner must separately approve and publish a new policy version through the reviewed owner process; this change performs no RDS writes and grants no policy writes to the runtime. If payload/academic declarations differ from evidence, use Return and the existing correction deadline; do not repair the immutable submission in place.

The round must be `OPEN` and server time must fall within the configured review interval (start inclusive, end exclusive). The existing `coordinator_round_schedules` review dates take precedence over legacy `phase1_cycle_windows` dates. A manual intake opening alone does not create a review window. The new review-only command below can configure this interval within the restricted stage after separately approved 024 and application rollout. The legacy all-window command remains blocked there.

## API contract

`POST /api/v4/coordinator/applications/:id/academic-review` accepts only:

```json
{
  "operation_id": "<UUID retained for retries>",
  "expected_version": 0,
  "submission_id": "<current retained submission UUID>",
  "expected_policy_id": "<latest matching verified policy UUID>",
  "checks": {
    "curriculum": true,
    "program_type": true,
    "entry_year": true,
    "grades": true,
    "documents": true,
    "declarations": true
  },
  "note": "<evidence and review note, 1–2000 characters>"
}
```

The response identifies the review, submission, policy and version with `eligibility=PASS`. It is an academic review receipt, not a successful forward or selection. A browser cannot submit its own calculated assessment. Same-operation retries return the prior receipt after scope checks; stale submission/policy/review versions conflict. Missing schema fails closed. Detail returns `academic_review` (preview, retained record, version and confirmation state), `can_confirm_academics` and `can_forward`. Forward uses the existing separate review version and operation contract.

## Stage boundaries

Backend-only flags default to disabled:

- `COED_COORDINATOR_REVIEW_ENABLED=true` admits the scoped academic review, Return/Forward and tracking paths within `intake-pilot`.
- `COED_COMMITTEE_HANDOFF_ENABLED=true`, together with the first flag and valid private `COED_INTAKE_PILOT` binding, admits assigned Cognito Committee reads/document access for the bound cycle/Coordinator only.

Within this restricted handoff stage, the routed Student audience and controls still apply. Staff use Cognito. Panels shared with a Coordinator outside the bound scope fail closed to avoid exposing partial/out-of-scope queues. Committee receives `can_decide=false`; both API and UI block decisions. The Nov 11 release retained normal mode with existing Committee decision/finalization behavior, as recorded in [D13](../decisions/v4-tu-intake-boundaries.md#d13-preserve-existing-committee-decisions-in-the-pr175-application-release).

## Database and release evidence

Fresh/workspace migration: [023](../../src/db/migrations/023_phase1_academic_review.sql), appended to the reviewed fresh lineage. Observed-RDS upgrade: [023](../../src/db/upgrades/023_phase1_academic_review.sql), separately gated to database `coed`, owner `postgres`, public schema, the pinned recorded 022 and explicit `coed.academic_review_upgrade=observed022-to023`. They share the new additive body but are not interchangeable entry points. [Contract hashes](../../scripts/operations/academic-review-contract.mjs) bind both files. Historical SQL/checksums remain unchanged.

The new append-only table has submission/policy/cohort/actor references, optimistic sequence, operation uniqueness, deferred audit matching and database forward guards. Runtime grants are only `SELECT, INSERT` on the new table, with no update/delete/truncate or policy-publishing rights.

The Nov 10 owner operation trialed and applied observed 023/024, published the bound-round policies, and verified preservation and temporary-access cleanup. The Nov 11 application release deployed the backend and frontend. Review dates were absent at the DB inspection and were not set by either operation. The assigned Coordinator must configure them before genuine review/forward acceptance. Later schema, policy, gate or application releases require their own reviewed compatibility/rollback evidence and approval. See [release evidence](../operations/coordinator-review-results-release.md).

For current local evidence and limitations, see [verification](../operations/academic-review-verification.md). Preview data, modeled auth and local document storage do not establish live TU/Cognito/S3 acceptance.


## Independent review-window setup (local source, 2026-11-10)

`POST /api/v4/coordinator/schedules/:cycleId/review` accepts only `operation_id`, `expected_version`, `review_opens_at` and `review_closes_at`. The timestamps require an explicit timezone and opening must precede closing. Receipt: `cycle_id`, normalized UTC timestamps and incremented `version`. Reuse the operation ID only for the same payload after an uncertain response; stale versions or reused IDs with a different payload conflict.

The active assigned Cognito Coordinator must own every active cohort in the `OPEN` round. In `intake-pilot`, review must be enabled and the exact private round/Coordinator scope must match. Other restricted stages, query parameters, Student/Committee callers and the full schedule-write path remain denied. This command does not modify `phase1_cycle_windows`, intake controls, confirmation dates, academic policies or submissions. Existing confirmation opening (from compatible schedule sources) remains an upper bound; conflicting sources fail closed.

Fresh [024](../../src/db/migrations/024_coordinator_review_window.sql) and separately gated observed [024](../../src/db/upgrades/024_coordinator_review_window.sql) allow both future confirmation dates to be null together. They retain all original review/order constraints, add a confirmation-pair check and preserve existing dates/versions/audit/grants. Observed Apply requires pinned observed 023, owner `postgres`, database `coed`, public schema and transaction-local `coed.review_schedule_upgrade=observed023-to024`. [Pinned contract](../../scripts/operations/review-schedule-contract.mjs) checks exact bytes. No new runtime grant is required. Missing capability returns `REVIEW_SCHEDULE_UPGRADE_REQUIRED`; schedule reads expose `review_schema_ready` and `can_edit_review`.

Following the owner’s UI correction on 2026-11-10, the Coordinator schedule page retains the existing three sections (intake, application review, confirmation) and the original save action. It does not render an additional review form. When only review editing is permitted, only the four existing review date/time inputs are editable; intake/confirmation remain visible as reference. Full-edit mode retains the original six-timestamp command. Bangkok-time preview, retained retry values, scoped readonly/missing-upgrade state and shared reload/cancel dialogs use this same form. This form is included in API15/Amplify38. See [review-window verification](../operations/review-window-verification.md) for the Nov 10 local checks and [release evidence](../operations/coordinator-review-results-release.md) for deployment and remaining browser acceptance.
