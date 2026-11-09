# Coordinator academic review and Committee handoff

Status: local source extension, 2026-11-08. Not deployed. The last observed AWS release remains [version 9](../operations/current-deployment.md). This document does not authorize AWS writes, SQL Apply, policy publication or rollout changes.

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

The round must be `OPEN` and server time must fall within the configured review interval (start inclusive, end exclusive). The existing `coordinator_round_schedules` review dates take precedence over legacy `phase1_cycle_windows` dates. A manual intake opening alone does not create a review window. Schedule changes remain outside this restricted stage and require their existing authorized process.

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

The existing maintenance mode, routed Student audience and controls remain. Staff do not use the TU proxy. Panels shared with a Coordinator outside the bound scope fail closed to avoid exposing partial/out-of-scope queues. Committee receives `can_decide=false`; both API and UI block decisions. These flags do not open other stages or provision staff/panels.

## Database and future release

Fresh/workspace migration: [023](../../src/db/migrations/023_phase1_academic_review.sql), appended to the reviewed fresh lineage. Observed-RDS upgrade: [023](../../src/db/upgrades/023_phase1_academic_review.sql), separately gated to database `coed`, owner `postgres`, public schema, the pinned recorded 022 and explicit `coed.academic_review_upgrade=observed022-to023`. They share the new additive body but are not interchangeable entry points. [Contract hashes](../../scripts/operations/academic-review-contract.mjs) bind both files. Historical SQL/checksums remain unchanged.

The new append-only table has submission/policy/cohort/actor references, optimistic sequence, operation uniqueness, deferred audit matching and database forward guards. Runtime grants are only `SELECT, INSERT` on the new table, with no update/delete/truncate or policy-publishing rights.

A future release needs reviewed commit/artifact hashes, current observed catalog/compatibility checks, rollback trial and explicit owner approval for observed 023 Apply, backend release/configuration and frontend Amplify deployment. The UI changed in this feature, so backend-only deployment is insufficient. Verify the real policy, staff/panel and review dates before activating flags; then perform separately approved real Coordinator/Committee acceptance. Disabling these flags closes the restricted review/handoff paths while retaining submissions and evidence; do not roll back the database or blindly restore an incompatible old backend.

For current local evidence and limitations, see [verification](../operations/academic-review-verification.md). Preview data, modeled auth and local document storage do not establish live TU/Cognito/S3 acceptance.
