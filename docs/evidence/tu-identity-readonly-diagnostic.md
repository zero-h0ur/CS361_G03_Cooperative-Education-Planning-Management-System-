# TU identity read-only diagnostic evidence

Date:5November2026, Asia/Bangkok. User explicitly approved N0-N5.
Status: Agent-run fixed read completed for the one freshly authorized target.
UNLINKED_IDENTITY confirmed:0TU links and0matching student profiles. Temporary
resource cleanup verified; no account/business-row writes or successful Login.

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
  PostgreSQL suite after propagation-readiness hardening:21passed,0failed,0skipped. Includes real column-level SELECT
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

## Live diagnostic history and remaining Login proof

### Second attempt and bounded propagation readiness

The user ran production-N27S5b from clean aaa0ee9; private version2 returned
DIAG_SECRET_DENIED. Cleanup was verified at2026-11-05 09:11:55 Bangkok with all
owned flags false and unchanged baselines, no database query/write. This narrows
the failure to authorization/decryption, not the target's canonical account.
Metadata confirms aws/secretsmanager encryption and a non-deleted login Secret;
no Secret value was read locally. Sanitized CloudTrail lookup did not identify
the denying layer; no permissions were broadened based on this absence.

AWS documents endpoint-policy changes may take a few minutes. The controller
previously invoked shortly after a new grant; propagation is a hypothesis, not a
confirmed cause. It now records a fixed5minute grace before one Invoke, reports
progress each<=30seconds, rejects expired/malformed readiness and cleans up on
interruption. It also maps known denial-policy phrases to fixed categories,
without retaining/logging raw SDK text. Exact IAM/endpoint grants are unchanged.

The latest user explicitly authorizes the agent to test the one newly supplied
Student ID. This supersedes the earlier user-only input requirement for that
one target; identifier remains in hidden input/memory/private Invoke, not these
documents, source, arguments, checkpoint or logs. No password/legacy credential
reuse or identity repair is authorized. The next subsection records the live
result obtained under that explicit target authorization.

### Agent-run fixed read and confirmed account condition

From clean local commit777eec5, the agent ran the reviewed operator with the
freshly authorized target through hidden stdin. State:
`tmp/tu-production/production-7rkUnZ/state.json`; published version3, one Invoke.
No password, provider call, JWT, fabricated TU proof or account repair was used.

The endpoint grant was updated at2026-11-05 09:25:00 Bangkok and the fixed grace
ended09:30:00. During the wait, read-only checks confirmed the exact reviewed
execution policy and endpoint grant, expected role ARN and no permissions
boundary. No additional right, wildcard resource, KMS grant or new Secret was
introduced. After the grace the same scoped Secret read and real PostgreSQL
read-only transaction succeeded. This is consistent with propagation delay in
the earlier runs; it does not independently prove the historical denial layer.

The fixed snapshot returned ok=true, reason=UNLINKED_IDENTITY, tu_links=0,
matching_students=0, candidate_users=0 and canonical_students=0. No active link
was found among this target's candidates. False account/profile flags here are
the consequence of absent canonical records, NOT evidence that an account was
disabled, a student failed eligibility, or another person's identity should be
chosen. Existing users under unrelated keys were not searched or matched by
name/email. The exact current TU issuer/subject has no link, and no student row
has the selected student_number. This is enough for the existing strict issuer
to reject this target before session issuance.

The final operator result was IDENTITY_DIAGNOSTIC_COMPLETE, cleanupVerified=true,
noDatabaseWrites=true. All owned flags are false; function/versions, role/policy,
log group and the exact additive endpoint grant were removed and application/
Gateway/endpoint baselines verified unchanged. The target raw value was not
written to source, argv, artifact, checkpoint, logs or this evidence.

This is a completed identity diagnostic, NOT successful TU Login->me->own-profile.
There is still no owner-smoke attestation. Maintenance remains verification-only.
No provisioning/relink/profile repair, public deployment, write resume or push.
The next separate decision is verified new-student onboarding/provisioning versus
administrator-reviewed single-account provisioning. Neither is authorized by
the current SELECT-only scope, and neither may fabricate required profile data.

The [interactive operator](../operations/tu-identity-readonly-diagnostic.md) is now
complete for the authorized target; do not rerun repeatedly or treat the missing
link as permission to create one. Any provisioning/onboarding implementation must
have a separately approved scope, fresh genuine TU verification, trusted required
student fields and preserved existing data. Successful owner smoke is still
required before any write resume. No historical password reuse or Git push.
