# Read-only application and directory recovery

> Historical browse-only recovery stage. C7 later enabled scoped Draft/files/Submit for a restricted test round, not all accounts. See [current deployment](../operations/current-deployment.md) and [verification](../operations/student-intake-verification.md) before interpreting the old write blocks below.

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

## Completed read-only rollout

Source commit `c24cbd8` (implementation1456e64 plus an exact generated-checkpoint
ignore rule) was clean for packaging. Candidate `candidate-DYUwSN` API ZIP SHA256:
`4d2ba60b6751327a09416a8a5509a15b83ae6b58705add85c99e6225b939d100`;
frontend ZIP SHA256:
`ccf7d060a5e277bc028c2c2f735da534b8672f82036f5bd845e0daf3abbaeb09`.
The implementation full `npm test` chain passed, including release32 checks,
TU policy/package/HTTP/PostgreSQL25 checks, main schedule20 Node/24 Jest and Committee DB coverage.
The committed1456e64 release gate also passed32,0 skipped. Lint309 modules,
docs9 and immutable migration verification passed. Counts overlap.

Before production writes, preflight twice stopped safely: a similarly named
retained frontend ZIP did not match the current published JS, and the newly
generated checkpoint directory was not yet explicitly ignored. Neither attempt
changed AWS. The actual rollout checkpoint referenced the current job29 artifact
under `production-t7Il83`; its retained hash and all three live asset hashes matched.
Only the generated browse directory was ignored; the source guard was not weakened,
the old checkpoint/source binding was not rewritten, and fresh artifacts/preflight
were produced after the local packaging correction.

Final checkpoint: ignored `tmp/read-only-browse/release-wQJy43/state.json`.

- Numeric API4 passed actual public directory/detail reads, public privacy,
  anonymous owner-read denials and business-write/readiness/download denials before
  live routing. An independent comparison confirmed unchanged API role/network/
  runtime and all environment entries except verify -> browse.
- API `coed-api:live` now points to4, code SHA256/base64
  `TSumC2dRMnoJQWqKVQmhW4Oua1hwWt2FyZ5iJbk50QA=`, maintenance browse.
  Old version3 is retained as the exact alias rollback target.
- After alias activation, the local HTTP probe failed before sending its readiness
  GET because it incorrectly included a synthetic `{}` body. Numeric Lambda invokes
  had accepted that event shape. Actual Fetch Request construction now has a direct
  regression test and omits GET/HEAD bodies. No application/API runtime defect or
  successful business mutation occurred.
- Recovery read the actual alias4/checkpoint, independently passed the same full
  HTTP probe using valid GET requests, then advanced only the local phase marker
  from LIVE_READONLY_CHECKS_PENDING to LIVE_READONLY_FRONTEND_PENDING. It did not
  replay activation or modify source, artifact, approval or rollback bindings.
  The operator-only correction is recorded in the following local commit and
  does not change the API/frontend artifacts already reviewed and deployed.
- Amplify main manual deployment job30 SUCCEED; published runtime config/JS/CSS
  matched the paired ZIP bytes. Corrected status/probe subsequently passed and
  checkpoint status is READONLY_ROLLOUT_VERIFIED_OWNER_PENDING, writesResumed false.
- A normal public page query returned200,12 companies, total103 over9 pages.
  Every row was public-only; no recruitment positions or representative contacts
  were returned. This verifies the actual request shape used by the directory UI.
- Broker5/issuer4 configuration hashes, qualified integrations, Gateway routes
  and CORS remained unchanged. No SQL, IAM/Secret/network/permission expansion,
  account relink or mock production record was applied.
- Actual browser QA was attempted, but the browser access host was unavailable.
  No Desktop/Mobile visual acceptance is claimed. DOM interaction, actual HTTP
  and byte-verified deployment checks are the evidence available here.

The owner was asked to privately refresh the directory and Student application
page, reporting only success/error codes without credentials/profile screenshots.
Positive real-owner application acceptance remains pending. The 103-company
public read is independently verified; it is not a claim about private ownership,
admission eligibility, confirmed curriculum, document transfer or submission.

Rollback assets remain at the checkpoint's retained paths with verified hashes.
Do not delete old API3 or rerun prepare against this completed live release. The
new source branch is local only; no Git push or PR merge was performed this turn.
