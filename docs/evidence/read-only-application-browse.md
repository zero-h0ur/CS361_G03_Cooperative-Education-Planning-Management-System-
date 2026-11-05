# Read-only application and directory recovery

Date: November5,2026. Approval: restore actual reads, retain all business-write
blocks. No mock records, account repair, academic guesses or production SQL.

## Cause and reviewed scope

Both public directory and TU application GETs returned503 COED_MAINTENANCE. Live
API3 and latest shared the same executable hash and verify mode. Profile's public
directory URL and the Student logo-to-home URL were already correct. Retrying a
blocked endpoint cannot restore companies; the link itself did not break the data.

The new browse mode admits only existing profile/session GETs, exact TU owner
application options/list/detail GETs and public company list/detail GETs. Public
filters and UUID paths are bounded. Authorization, owner queries, public privacy
projection and unknown academic values are unchanged. Readiness, document bytes/
download tickets, write methods and administrative/selection endpoints stay503.

API capabilities and availability report read-only access. The existing theme is
retained; ui-ux-pro-max Disabled States guidance informs explicit notices and
unavailable actions rather than enabled-looking failing CTAs. The six-step editor
retains saved values without claiming a round expired, submission succeeded or a
curriculum was verified. No new page, external asset or visual redesign is added.

## Local verification

- New maintenance/operations Node checks:9 passed; read-only UI:4 passed.
- Application, Student workspace, directory API/UI regression:86 passed.
- Real synthetic PostgreSQL TU delivery suite:12 passed,0 skipped, including owner
  options/list/detail, other-owner404, anonymous401, write/readiness503 and unchanged
  application/operation rows during browsing.
- Observed019/020 synthetic owner flow:10 passed,0 skipped, including a genuine
  registration session reading empty applications/options while department/program
  remain null and academic_verified stays false. No application is auto-created.
- Initial added-test failures were corrected: explicit profile-view build entry
  was absent, and one synthetic login passed positional rather than object args.
  No production credential or safety assertion was changed to resolve them.
- Full regression and committed-source release results are recorded at rollout.
- Native Desktop/Mobile visual acceptance and a real-owner read are not claimed.

## Deployment boundary

The [bounded runbook](../operations/read-only-application-browse.md) defines a
numeric Lambda candidate, revision-guarded alias activation, matching paired
frontend, actual public reads and anonymous/write denials. Existing API IAM,
network, Secrets, Gateway/CORS, broker5 and issuer4 must remain unchanged. Retain
API3 and byte-verified prior frontend for rollback. Runtime application writes do
not resume. The owner's current private session is required for final positive
acceptance; old chat credentials must not be reused.

Status at this source checkpoint: local validation in progress; no production
resource has changed for this read-only task. Later execution evidence supersedes
this checkpoint only when explicit observed results are appended below.
