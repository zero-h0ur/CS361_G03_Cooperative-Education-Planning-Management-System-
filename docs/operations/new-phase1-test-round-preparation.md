# Separate Phase 1 test round — preparation only

Prepared: **2026-11-17, Asia/Bangkok**. Status: **local proposal; no new live round
has been created**. The owner chose preparation of a separate test round after
the [finalized-round diagnostic](coordinator-finalized-round-diagnostic.md) and
asked whether the existing TU account can be reused. This document does not
approve an RDS write, temporary AWS tooling, or a deployment.

## Account and application behavior

The existing TU account can be reused. TU identity linkage and the internal
Student account are independent of the application cycle. The application table
enforces `UNIQUE(student_id,cycle_id)`: the same Student can create a separate
application in another cycle, without resubmitting or moving the old application.

The Student must create a new Draft in the new round, complete/recheck its form
and acknowledgements, and attach the required files for that application. No
existing submission or document is silently copied into a successful new
submission. The original application, receipt, academic reviews, Committee
decision and audit history remain in their original round.

Reuse the assigned Cognito Coordinator and the same three Committee accounts,
through explicit assignments in the new round. No new login account or identity
link is needed. A TU login still does not certify the applicant's declared
curriculum, grades or academic eligibility.

## Proposed bounded configuration

| Item | Prepared scope |
| --- | --- |
| Display name | **CO-ED 2569/1 · ทดสอบครบกระบวนการ 17 พ.ย. 2569** |
| Cycle identity | New UUID; same academic year/semester as the existing test round |
| Coordinator / Committee | Same existing assigned Coordinator and three active Committee users |
| Intake destinations | New cohort IDs, using only the existing approved routing tuples; no additional faculty, department, program type or curriculum |
| Academic policies | New round-scoped versions copied only from the latest approved, verified source policies for 61/66 after fresh hash checks; no invented grades or criteria |
| Intake control | Initially `CLOSED`; the assigned Coordinator opens it through the existing UI |
| Review interval | Coordinator sets an interval covering the test through the existing schedule UI, then reloads the saved value |
| Committee workspace | No copied proposal, votes, selected list or finalization; the new round starts without a saved meeting decision |

Runtime16 currently runs with maintenance `off`. The source's normal-mode scope
uses actual assignments and TU routing; the pilot-mode single-round restriction
is not active in that mode. A new round with its own intake-control row can use
the existing control capability. This is not authorization to change maintenance,
the retained pilot binding, an audience setting, or any existing route. Stop and
review if fresh deployment evidence no longer matches those assumptions.

## Prerequisites before an approved live operation

1. Refresh the existing source round's assignment, latest active route and policy
   metadata and their hashes; verify the same Coordinator/Committee accounts are
   active. Limit the read to routing/round metadata, not Student documents.
2. Prepare an exact private manifest with new IDs, source-row fingerprints,
   intended row counts and a transaction containing inserts for the new round
   only. Verify the observed-schema lineage and current owner/audit constraints;
   this is metadata provisioning, not rerunning migrations.
3. Trial the transaction against the correct disposable observed-schema fixture,
   including existing-row preservation, closed intake, same-account visibility,
   a new Student application in the new cycle and an unfinalized Committee state.
4. Obtain explicit approval for the concrete RDS provisioning operation and any
   temporary AWS resource/permission needed by its reviewed executor. Runtime
   grants must not be broadened to provision the round.
5. Read back the result and old-row fingerprints. The Coordinator chooses the
   new round, opens intake and saves review dates; Student then uses the same TU
   login and selects **สร้างใบสมัคร** for the new round.

## Prepared implementation and current approval boundary

The owner requested continuation after this proposal. The automatic approval
review rejected the combined live execution: it interpreted that request as
preparation approval, without explicit approval for temporary AWS resources,
owner-Secret/RDS access and production metadata writes. The rejected process did
not start. No AWS resource or RDS row was created by that attempt.

Unaffected preparation was completed separately:

- A task-owned PostgreSQL16 tmpfs container on `127.0.0.1:55445`, database
  `coed_intake_test`, exercised the actual observed-schema fixture through024.
  Six checks passed with zero skips: unsafe manifest/Apply rejection, complete
  rolled-back trial, atomic failed postcondition, idempotent Apply/replay,
  same-account visibility with closed intake, and the same TU Student creating
  a second-cycle Draft after the assigned Coordinator opens intake. Existing
  application and finalized Committee rows remained unchanged. The container
  was stopped and removed afterward.
- Seven handler/policy checks passed with zero skips: TTL, exact command,
  numeric version, explicit scope, inventory/trial gates, plan integrity,
  restricted Secret/endpoint policy and credential-safe failures.
- Read-only AWS metadata preflight confirmed the existing API16/TU5/issuer4
  baseline and captured the exact configuration/alias/Gateway/Amplify hashes.
  No RDS inventory was performed by this preflight.
- Local owner ZIP SHA-256:
  `1cfb412fef40fc8dfad30310036a5e0766f5bcce5d00d8a78692703428b21aaf`.
  It contains only `owner.js`, a private fixed plan and the public CA. The
  metadata-provisioner source hash is
  `f43b19a0bb5dcd59602c72b7a9555aa6801a8d83ea51a50b02cda06d494e8f13`.
  Runtime source remains committed `38d5cd7`; existing documentation changes
  are recorded separately, not represented as a clean application release.

The prepared live operation needs one temporary Lambda
`coed-test-round-owner-20261117`, one corresponding execution role/log group and
one temporary owner-Secret endpoint statement. It uses the existing subnet,
security group, endpoint and Secret. Its only database mutation is an
INSERT-only transaction adding one private round, copies of the existing
assigned cohorts/latest approved routes/two verified policies, one CLOSED
control and one SYSTEM audit event. It rejects source/schema drift, requires a
fresh live inventory plus a rolled-back live trial before Apply, and compares
all pre-existing row fingerprints. It does not execute migration SQL or modify
runtime grants, identity links, application/history rows or the existing
Committee decision. Cleanup removes the temporary function/versions,
role/policy/log group and endpoint statement and verifies the standing baseline.

The private plan, source/tests and prepared checkpoint remain ignored/local-only
under `tmp/release-candidates/new-round-20261117/`; they are not a supported team
deployment command and may not exist in another clone. Explicit approval for
these AWS/database writes remains pending. No live transaction trial or
provisioning has run, and the new round does not exist yet. If any new
applications are later created, retain their rows/history rather than deleting
the round as a cleanup or recovery shortcut.

Before Committee finalization in the new test, forward all intended applications
and verify the roster. Then test Committee agreement/finalization and the
Coordinator results dashboard; Committee finalization remains distinct from
publication of results to Students.
