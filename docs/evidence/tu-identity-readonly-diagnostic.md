# TU identity read-only diagnostic evidence

Date:5November2026, Asia/Bangkok. User explicitly approved N0-N5.
Status: First live attempt failed before DB connection/query; temporary-resource
cleanup verified. Diagnostic error reporting hardened locally and tested; a fresh
hidden-target run is still required to establish the account condition.

## Confirmed incident boundary

After broker public-verifier repair, correct-credential attempts reach private
issuer2 and stop at identity403 TU_ACCOUNT_UNAVAILABLE; intentionally wrong
credentials stop at broker4/provider401 INVALID_CREDENTIALS. These stages were
read from sanitized paginated logs, without subject/password/token/profile output.
The exact identity condition is not established by those public safe errors.
There is no successful owner-smoke attestation; writes remain paused.

## Local implementation

- Separate fixed private handler, not a broker/issuer/API route or SQL console.
  Exact account/region/host/DB/user/login Secret, bound target digest, run ID,
  immutable numeric Invoke context and<=30minute expiry checked before Secret read.
- Only existing dedicated coed_tu_login credential is read inside the private
  tool. No owner/app/signing/provider Secret capability or database write grants.
  One parameterized read-only transaction/query returns safe flags/capped counts
  and one finite reason, no IDs/names/emails/credential/profile data.
- Interactive operator accepts no target/password/token arguments; hidden local
  Student ID is processed only in memory/private Invoke, never copied from chat.
  Salted digest/checkpoint is ignored pseudonymous metadata. Default one Invoke,
  checkpoint maximum3, additional warm-handler counter; no durable cross-cold-
  start global counter is claimed or additional state service introduced.
- Exact additive Secrets endpoint grant, own role/function/logs and operator-only
  Invoke policy. No NAT/EC2/RDS/new Secret/endpoint/public route. Finally cleanup
  verifies absence/baselines, refuses foreign resources/changed policies and
  attempts independent owned cleanup after partial failure. Explicit recovery
  command is available without the target if interrupted/session expires.

## Validation

- Combined diagnostic unit/package/privacy/IAM/cleanup and actual disposable
  PostgreSQL suite after hardening:19passed,0failed,0skipped. Includes real column-level SELECT
  role/read-only transaction, Cognito-only/missing/revoked/ambiguous links,
  disabled/wrong-role accounts, incomplete/Unicode-padded profiles, ownership
  mismatch and invalid version. Old synthetic rows compared before/after lookup.
- Independent ZIP extraction/import rejects an untrusted envelope without AWS/
  DB access. CLI rejects command-line target/credential arguments without echo.
- Mocked cleanup verifies exact owned removal, no deletion of foreign resources,
  and continued endpoint/log cleanup after a function-deletion failure.
- Secret failures now distinguish fixed permission, timeout, missing-secret,
  credential-provider, network and invalid-value codes; unknown errors remain
  generic. No raw SDK message, subject, credential or SDK metadata is returned.
  A loopback-only real AWS SDK client with synthetic credentials tests denial,
  malformed Secret JSON, request timeout and hard abort; each failure has one
  request only. Failure stops before any DB connection. Secret HTTP deadlines
  are1000/2500ms with a3000ms abort, maxAttempts1, still Lambda timeout10seconds.
  This timeout adjustment is not evidence of the original failure's cause.
- Syntax lint285modules passed; docs9passed,56reachable documents/199local links
  with0failures. No browser/UI change or auth bypass.
- AWS read-only preflight passed: expected caller/parent versions/maintenance,
  routes/CORS/integrations, absent diagnostic names/Sid and dedicated login Secret
  metadata. No Secret value or production business row was read in preflight.
- Repeated read-only AWS preflight after the failed attempt passed. It verifies
  no diagnostic names/Sid remain and the application/maintenance/routes match
  the frozen parent checkpoint. No AWS writes were performed during hardening.
- Initial DB rerun could not connect to the old stopped disposable container:
  Windows reserves55345-55444, including55440. A separate task-labelled,
  auto-remove PostgreSQL16 container on127.0.0.1:15440 ran the complete suite.
  Test cleanup left0public tables and0coed_tu_login roles; old container/data were
  left intact. The new exact auto-remove test container was stopped and its
  absence verified after validation. This was a local test-environment issue,
  not production evidence.

## First live attempt

The user ran the interactive operator and supplied the target locally. State:
`tmp/tu-production/production-ux5UIQ/state.json`. Published private version1 was
invoked once and returned DIAG_SECRET_UNAVAILABLE. The original catch merged SDK
transport/authorization errors and malformed Secret values, so it cannot identify
the exact category retrospectively. No DB connection or identity query followed.

The original process completed cleanup at2026-11-05 04:09:55 Asia/Bangkok:
status=CLEANED_UP, cleanup.verified=true, failedParts=[], all owned flags=false.
Owned Lambda/versions, role/policy, log group and the one endpoint grant were
removed; application/Gateway/endpoint baselines were verified unchanged.
No database writes or account repair occurred.

Sanitized CloudTrail lookups for that role/time found no GetSecretValue event;
absence is not proof of a specific failure. The dedicated login Secret has no
resource policy, and the existing Secrets endpoint is available/private-DNS
enabled. No Secret value was read locally, no credential was rotated, and no
permission was widened. Do not infer UNLINKED_IDENTITY from this tool failure.

## Pending live proof

User must rerun the updated [interactive operator](../operations/tu-identity-readonly-diagnostic.md)
from the reviewed committed worktree, entering only their own10digit target
Student ID in the hidden prompt. Prior raw input was not retained and must not
be reconstructed from chat. New N1 resources/N2 lookup/N3 cleanup will be a new
bounded run; the previous run's cleanup is already verified. No confirmed account
cause or successful Login is claimed. Repair/provisioning/relink and write resume
remain separately gated. No push or frontend deploy.
