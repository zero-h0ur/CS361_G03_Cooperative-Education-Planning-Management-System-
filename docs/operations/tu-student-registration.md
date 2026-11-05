# TU first-login registration

New, genuinely TU-verified students without any existing Student row or TU link
receive a registration-only ticket lasting five minutes. This is not an access
token. The student confirms regular/special track and admission year, explicitly
self-reported and pending review. Identity fields from TU are immutable. Only
normal TU enrollment (`ปกติ`, without known contradictory graduated status40)
can start new registration. Existing users are not rewritten or automatically
relinked. Coordinator authentication remains Cognito.

Migration019 follows the observed018 lineage only. It does not reconstruct or
replace missing historical migration files. One transaction creates the explicit
TU-backed profile model, immutable provenance/receipt tables, bounded NOLOGIN
function owner and an EXECUTE-only registration role. It preserves legacy profile
completeness constraints, existing records and migration history. New real Student
records are marked `to_validate`, never `mock`. Canonical academic scope remains
NULL, not inferred from the Student ID or TU labels. No academic-verification row
is fabricated; existing Phase1 submission readiness guards remain in effect.

## Approval and deployment

O1–O6 and the concrete O7 scope were approved on November5,2026. O7 permits one
registration Secret, narrow DB capability, temporary owner tooling with verified
cleanup, forward019 and existing Lambda/API/Frontend updates. It does not permit
deleting data, relinking old accounts or resuming global writes before real-owner
verification. Estimated new Secret storage is US$0.40/month plus usage; actual
billing depends on region, usage and credits. See [AWS pricing](https://aws.amazon.com/secrets-manager/pricing/).

Reviewed source:

- [Forward019 SQL](../../src/db/upgrades/019_tu_student_registration.sql)
- [Owner-only trial/apply gate](../../scripts/operations/tu-registration-upgrade.mjs)
- [Fixed temporary handler](../../scripts/operations/tu-registration/handler.mjs)
- [Checkpointed operator](../../scripts/operations/tu-registration/operator.mjs)
- [Issuer verification environment guard](../../scripts/operations/tu-registration/environment.mjs)

The operator packages committed clean source. `prepare` checks exact live versions,
maintenance, integrations, role/Secret absence and the existing encrypted approved
backup. That retained backup predates018, is not a new019 restore point and has
not been restore-tested. Do not restore it over the live database as a routine
rollback. Trial/apply are atomic; no old business data is rewritten.

Run each approved phase against the returned state path, inspecting its result
before proceeding: `package`, `prepare`, `owner-trial-enable`, `trial`,
`owner-apply-enable`, `apply`, `credential`, `cleanup`, `stage`, `activate`,
`frontend`, `status`. Every CLI invocation requires `--approved-o7` as the third
argument after mode and state path (for package use a placeholder state argument).
The CA bundle path comes from `COED_RDS_CA_FILE`, containing public certificates
only. Never paste credentials into command arguments or state files.

On errors, inspect the checkpoint; do not rerun `prepare` or create duplicates.
Secret endpoint policy propagation may take time. A failed trial Secret read
does not justify extra permissions. Retry only the same qualified trial after
checking state, with a bounded five-minute propagation window. Clean the exact
task-owned tool/role/log group/endpoint statements even after a failed trial.
Do not remove the standing issuer registration permission during normal cleanup.

The private tool is operator-only, qualified-version-only, expires after two hours
and can only trial/apply019 or initialize the dedicated registration credential.
It never registers a Student or accepts SQL, usernames or passwords. The credential
is generated inside the VPC and stored directly in Secrets Manager. The old
`coed_tu_login` remains SELECT-only. The separate runtime credential has no direct
table reads/writes and can execute only the fixed provisioning function.

## Verification and rollback

Use fresh credentials entered privately by the owner; never reuse passwords from
chat history. Complete the two-field registration in the real UI. A real access
session must resolve the same owner on `/me` and `/students/me`. TU success alone,
configuration readiness or a restricted registration ticket is not a passed smoke.
The operator does not record a successful owner smoke on its own.

Keep API `COED_API_MAINTENANCE=verify` until this check passes. Normal application
writes remain unavailable during verification. On application failure, pause TU
registration and restore each `live` alias to the version in `state.baseline`
using revision guards. Keep019 and any genuine registered accounts; do not drop
tables or delete users to roll back a UI/API release. Revert the dedicated public
registration route only after checking its exact target and ID. Temporary owner
cleanup is independent of application rollback and is always required.

Local tests cover restricted ticket rejection, enrollment policy, exact provider
proof, owner mismatch, replay/races, audit rollback, role capabilities, migration
trial/apply/replay and actual SELECT-only session → `/me` → own profile on a
disposable PostgreSQL database. Production acceptance requires separate live
evidence; local pass is not a claim that a real Login succeeded.

## First-registration confirmation returns503

Distinguish reaching the immutable TU identity form from completing registration.
Do not navigate to Student, invent a profile or mark acceptance passed while
`POST /api/v3/auth/tu-register` fails. Read only fixed error code/stage/status/
Lambda-version fields and configuration metadata; never copy raw credentials,
registration tickets, provider profiles, complete environments or Secret values.

`TU_SIGNING_UNAVAILABLE` can occur before the provisioning connection is opened
when the issuer lacks `TU_AUTH_PUBLIC_KEY`. The broker has its own public key,
so its successful TU verification/registration-begin path does not prove issuer
completion readiness. Check the issuer's published **live** version rather than
only `$LATEST`. Match RSA public-key fingerprints, issuer, client ID and key ID
against the existing broker/API. Never copy private keys or add Secret access to
work around a missing public verification setting.

For a confirmed configuration-only defect, preserve every existing issuer value
and all other resources; publish the same issuer code with the matching public
verification configuration, then revision-guard only its live alias. Record the
old/new versions and hashes, verify maintenance stays `verify`, and retain an
alias-only rollback. This does not require a new migration or owner tool. Do not
rerun the historical deployment controller against already-applied019.

After configuration checks, the owner must freshly Login (registration tickets
expire after five minutes), enter the actual admission year rather than birth
year, and confirm the form. Student navigation is expected only after server
registration/session and canonical `/me` owner validation succeed. Independent
hidden-input Login smoke may then verify `/me` and own profile. Keep success
pending until genuine completion is observed; do not reuse chat passwords.

November5 follow-up: live issuer4 corrects the missing public verification
configuration from issuer3 with identical executable code. Only the issuer's
public key/key ID changed; API3/broker5 and verify-only maintenance did not.
The precise hotfix rollback is revision-guarding `coed-tu-session-issuer:live`
from4 back to3 after checking the current alias, code hash and checkpoint
`registrationKeyHotfix`. Do not use this incident to replay019 or restore the
database. This rollback would restore the known registration503, so use only
for an observed regression and keep genuine accounts/data intact. See the
[rollout evidence](../evidence/tu-student-registration-rollout.md).

## Forward020: configured issuer alignment

The next real-owner confirmation exposed409:019 used the default TU issuer in
both registration routines, while the deployed token issuer is account-scoped.
Do not change the configured issuer/client, relink accounts, replay019 or treat
this error as proof of a duplicate account. Forward020 changes only the exact
issuer literal in the registration function and its deferred provenance guard.

O8 was explicitly approved on November5,2026. Reviewed files:

- [Fixed020 SQL](../../src/db/upgrades/020_tu_registration_issuer_alignment.sql)
- [Atomic baseline/preservation guard](../../scripts/operations/tu-registration-issuer-upgrade.mjs)
- [Expiring fixed owner handler](../../scripts/operations/tu-registration-issuer/handler.mjs)
- [Checkpointed020 controller](../../scripts/operations/tu-registration-issuer/operator.mjs)

After local tests and commit, package with the public RDS CA bundle in
`COED_RDS_CA_FILE`. Run the new controller sequentially, not the old019 controller:

```text
node scripts/operations/tu-registration-issuer/operator.mjs package unused --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs prepare <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs trial-enable <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs inventory <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs trial <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs apply-enable <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs apply <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs inventory <state-path> --approved-o8
node scripts/operations/tu-registration-issuer/operator.mjs cleanup <state-path> --approved-o8
```

Inspect each result before continuing. Do not rerun `prepare`, use arbitrary SQL,
or run two state writers concurrently. On a failure clean the exact temporary
capabilities; cleanup does not depend on source cleanliness or a successful trial.
The tool has one-hour expiry, qualified/operator-only Invoke, existing private
network placement, reads only the existing RDS owner Secret, and cannot register
an account or rotate/read provider/signing credentials. No new standing Secret,
NAT or service is created; only temporary usage is added.

The guard verifies the exact019 catalog/history, existing table-row fingerprints,
both routine OIDs/signatures/owners/ACLs and role graph. It compares the entire
resulting catalog against the sole approved two-literal substitution, and appends
020's checksum only after all checks pass in the same transaction. The temporary
postgres function-owner membership is revoked before commit. Inventory/replay
uses rollback-only transactions. Prior migrations and business rows stay intact.

Keep API3/broker5/issuer4 and verification-only business maintenance unchanged.
Trial/apply failures before commit roll back automatically. After a post-commit
regression, pause only new onboarding with the existing broker flag, preserve
020/history/accounts, and review a forward correction. Do not restore an old
snapshot over live data or delete migration history. Actual Student acceptance
still needs fresh owner Login and confirmation; local/negative gates alone do
not establish success.

Execution evidence:020 was applied on November5 after inventory/trial passed;
post-catalog hash is `89966e31c60134499d3bb7d60df92dbb51c161d0fb941517eca308817c479b91`.
The task checkpoint is `tmp/tu-production/production-xg3NUI/state.json`, status
`SCHEMA020_APPLIED_CLEANUP_VERIFIED`. Temporary capabilities are removed and were
independently checked absent. Do **not** rerun prepare/apply from the example
sequence for this completed run. Read the checkpoint and rollout evidence first.
API3/broker5/issuer4 and verify-only maintenance are unchanged. The owner later
confirmed successful registration/form completion and Student navigation; this
is UI acceptance, not independent CLI smoke or application-submission acceptance.

In `verify` mode even GET application-options/applications returns503
`COED_MAINTENANCE`; only reviewed session/profile reads pass the gate. Do not
diagnose those known maintenance responses as a new TU Login failure or switch
the mode to `off` merely to remove Console errors. Review read/write scope and
remaining academic/storage/delivery readiness before changing the gate. Google
Fonts connection failures are a separate external asset issue with CSS fallbacks,
not an authentication result. See the updated rollout evidence for the confirmed
post-registration diagnostics and remaining boundaries.
