# TU identity read-only diagnostic evidence

Date:5November2026, Asia/Bangkok. User explicitly approved N0-N5.
Status: N0 local implementation/tests complete; read-only AWS preflight passed.
Awaiting the user's hidden target input before N1-N4 live inspection/cleanup.
No diagnostic AWS resource, endpoint grant or production row change yet.

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
  PostgreSQL suite:17passed,0failed,0skipped. Includes real column-level SELECT
  role/read-only transaction, Cognito-only/missing/revoked/ambiguous links,
  disabled/wrong-role accounts, incomplete/Unicode-padded profiles, ownership
  mismatch and invalid version. Old synthetic rows compared before/after lookup.
- Independent ZIP extraction/import rejects an untrusted envelope without AWS/
  DB access. CLI rejects command-line target/credential arguments without echo.
- Mocked cleanup verifies exact owned removal, no deletion of foreign resources,
  and continued endpoint/log cleanup after a function-deletion failure.
- Syntax lint285modules passed; docs9passed,55reachable documents/197local links
  with0failures. No browser/UI change or auth bypass.
- AWS read-only preflight passed: expected caller/parent versions/maintenance,
  routes/CORS/integrations, absent diagnostic names/Sid and dedicated login Secret
  metadata. No Secret value or production business row was read in preflight.

## Pending live proof

User must run the [interactive operator](../operations/tu-identity-readonly-diagnostic.md)
and enter only their target Student ID in the hidden prompt. Only then are N1
temporary resources created, N2 fixed read run and N3 cleanup verified. Do not
claim a confirmed account cause, completed live diagnostic/cleanup or successful
Login until that safe result is received and checked. Repair/provisioning/relink
and write resume remain separately gated. No push or frontend deploy.
