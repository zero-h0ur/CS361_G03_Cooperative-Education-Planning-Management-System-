# Coordinator blocked after Committee finalization — 2026-11-17

Observed at `2026-11-17T15:47:48.449Z` (**22:47, Asia/Bangkok**).
Runtime: `coed-api:live` **16**, source `38d5cd7f74d5dc937f83277598f9db52c6c335c2`.
This is a read-only diagnostic record, not approval to change a round or a decision.

## Finding

The owner reported that the Student completed readiness and submitted, then the
Coordinator could read the application but could not certify or forward it.
Changing the review interval did not enable those actions. The owner subsequently
confirmed that the same round displayed **ยืนยันรายชื่อแล้ว · รอประกาศผล**.

Fresh API reads of the existing bound test round showed:

| Condition | Observed result |
| --- | --- |
| Assigned Coordinator | Exact internal identity matched the retained binding |
| Round | `OPEN` |
| Saved review interval, Thailand time | **17 Nov 2026 00:00 → 18 Nov 2026 23:59**, schedule version **5** |
| Review schedule capability | Schema ready, `can_edit_review=true`; operator time inside the interval |
| Latest pending submission | Persisted at **17 Nov 2026 22:36:45**, `PENDING`, round `OPEN` |
| Academic assessment | Schema ready, `can_confirm=true`, no assessment blockers |
| Coordinator actions | `can_review=false`, `can_confirm_academics=false`, `can_forward=false`, access `read_only=false` |
| Existing Committee workspace | Version **5**, `finalized=true`, result `CONFIRMED`, one forwarded application |
| Existing finalization time | **9 Nov 2026 00:41:29**, before the new submission |

The saved review interval is valid. The blocking condition is the retained
Committee finalization, not the Draft policy-save fix, a missing academic policy,
or the Coordinator maintenance stage. There were two pending applications in the
assigned round at inspection; no pending application was reviewed by the operator.

## Code behavior

`CoordinatorWorkspaceService.present()` allows review only for a pending,
submitted application in an open round, inside the review interval, before the
canonical Committee workspace is finalized. The return/forward command also
checks the Committee state under its transaction lock and rejects changes after
finalization. Changing dates does not reopen that decision.

The Committee transition currently rejects mutations after `finalized=true`;
there is no implemented reopen action. The Coordinator UI's generic closed-round
message does not distinguish this cause from other `can_review=false` conditions.
No authorization or finalization guard was removed to enable this test.

## Method and limits

The operator used AWS IAM invocation of version16 with a modeled Gateway envelope
for the existing assigned test Coordinator. The runtime resolved the exact
issuer/subject to an internal Coordinator; its internal identity and round were
checked against the retained private binding before further reads. This is
**not genuine Cognito authentication** and does not replace the owner's browser
acceptance.

Only GET session/options/schedule/application/tracking paths were invoked. The
latest scoped application details and Committee state were reduced to the
status/boolean/timestamp summary above; raw identity claims, Student profiles,
private IDs, document data and credentials are not included in this record.
No business writes, SQL migration, account/assignment correction, environment
change, new AWS resource, or deployment was performed. No code or database tests
were rerun for this inspection; the relevant guards were read in source.

## Next decision

Use a separately prepared test round to continue the full workflow while keeping
the finalized round and its submission/decision history intact. Creating a new
round also needs reviewed assignments, policy/routing configuration and any
necessary deployment binding changes; it is not authorized by this diagnostic.
The [new-round preparation](new-phase1-test-round-preparation.md) records the
same-account behavior and bounded proposal; no new live round has been created.

Reopening the existing round would instead require an explicit, versioned and
audited review/reopen design that retains the earlier decision. Directly resetting
`finalized`, deleting the Committee workspace or moving a submitted application
to another round is not a supported recovery step.

See [the Backend16 release](application-policy-save-release.md),
[current deployment](current-deployment.md) and
[intake verification](student-intake-verification.md).
