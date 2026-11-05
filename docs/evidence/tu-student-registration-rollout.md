# TU Student registration rollout — November5,2026

## Outcome

Forward019 was applied to the actual observed018 production lineage after a
successful rollback-only trial. The owner tool verified preservation of existing
rows and migration history. No Student account, identity link, academic profile,
application or mock record was created by the operator. Genuine account creation
requires a fresh TU verification and the owner's first-login form.

Deployment remains **verification-only**. A subsequent owner clarification
supersedes the earlier UI acceptance interpretation: TU verification reaches the
first-registration form, but confirming it returns503. Completed registration,
Student workspace access and an independent owner smoke are **not yet verified**.

| Resource | Live result |
| --- | --- |
| API Lambda | `coed-api:live` → version3 |
| External TU broker | `coed-tu-auth:live` → version5 |
| Private issuer | `coed-tu-session-issuer:live` → version3 |
| New HTTP route | `POST /api/v3/auth/tu-register`, existing broker integration |
| Frontend | Amplify job29 `SUCCEED`; published JS exactly matches packaged bytes |
| Runtime capability | Separate registration Secret and EXECUTE-only role; login role remains SELECT-only |
| Temporary owner tool | Lambda, role, log group and endpoint statements removed; cleanup verified |
| Business writes | Still blocked with `COED_API_MAINTENANCE=verify` |

Release source is local commit `b6a55e8`. No push was performed. Runtime artifacts
were packaged from clean committed source. SQL019 SHA256:
`321f90ece54cca0d98f137b50813ca0dea4ba58f36b6166f0088475eae655f85`.
Post-catalog SHA256:
`ea3ff238c1c10aaa5d32253b894c0541246ef1e04c775effffcd15ad1d0889d1`.

Checkpoint: ignored local `tmp/tu-production/production-o9DZU6/state.json`. It
contains resource/artifact metadata, not provider/signing/database credentials,
passwords, access tokens or Student profiles. Do not manually rerun `prepare`.

## Issues found and resolved during trial

- Initial trial rolled back on postcondition mismatch. A local public-schema
  reproduction exposed an overly broad schema-name normalizer that rewrote
  `public_url`/`visibility='public'`. Normalization now handles only actual schema
  qualifiers/search_path. The pinned expected post-fingerprint did not change.
- RDS default ACLs automatically gave `coed_app` SELECT/INSERT/UPDATE/DELETE on
  new tables. Exact metadata and an isolated reproduction matched. SQL019 now
  removes these grants only on its two newly created registration tables and
  grants only reviewed read columns. Existing/default ACLs were not changed.
- Temporary Lambda concurrency updates advanced its revision. Refresh now reads
  the new revision after pausing concurrency; no revision guard was bypassed.
- A concurrent exact-route permission checkpoint overwrote staging metadata.
  Live aliases remained unchanged. Unique published artifact hashes and runtime
  flags were checked before restoring the checkpoint and activating. Do not run
  two mutating controllers against the same state file concurrently.
- Old broker permissions covered only Login/status. The registration endpoint
  received a separate exact-route, exact-account Lambda permission, not a broader
  wildcard. This is now included in the activation controller.

## Verification

- Auth/security/identity/profile targeted Jest:178 passed.
- TU regression:127 Jest tests and24 Node/actual PostgreSQL checks passed,0 skipped.
- Registration SQL/security/operations after reproducing RDS defaults:18 passed,
  0 skipped. Includes trial rollback, apply/replay, concurrent subjects, exact
  idempotency, audit failure rollback, denied direct writes, preserved legacy
  completeness and actual SELECT-only session → `/me` → own profile.
- UI/session/profile regressions:114 passed. Restricted tickets stay out of DOM,
  URL and persistent storage; field errors, expiry, retry idempotency and explicit
  canonical-owner checks are covered.
- Release gate with disposable PostgreSQL:32 passed,0 skipped.
- Dedicated broker/issuer packaging isolation and extracted owner ZIP load passed.
- Lint and documentation checks passed before rollout; final checks are rerun
  after this evidence update.
- Automated visual browser inspection could not start: both available UI runtimes
  reported a missing runtime path. DOM/interaction tests passed; actual Desktop/
  Mobile visual acceptance is not claimed. Frontend uses existing CO-ED tokens,
  dark text, labelled read-only TU identity and a responsive two-field form,
  guided by frontend-design and ui-ux-pro-max.

Live public checks used **no credentials and made no database writes**:

| Request | Result |
| --- | --- |
| TU status |200, configured |
| Empty Login body |400 `VALIDATION_ERROR` |
| Invalid registration ticket |403 `TU_REGISTRATION_REJECTED` |
| Anonymous TU `/me` |401 |
| Anonymous own-profile |401 |
| Anonymous Cognito `/me` |401 |
| Application write during verification |503 `COED_MAINTENANCE` |

## Remaining acceptance

On November5,2026, the owner answered: “เข้าได้และเห็นโปรไฟล์ตัวเองแล้ว”.
No credentials or personal-profile screenshots were requested or received in this
acceptance step. A subsequent read-only AWS check confirmed API3, broker5 and
issuer3 active/updated successfully, with API maintenance still `verify`. No AWS
configuration, database record or permission was changed in this acceptance turn.

The Q&A transcript and finalized outcome are stored locally under ignored
`tmp/grill-me/session-01a03e5c-406b-7eb3-900f-f6180e4b0bb5-20261105-132653.md`
and `tmp/grill-me/outcome-01a03e5c-406b-7eb3-900f-f6180e4b0bb5-20261105-132653.md`.

The existing hidden-input owner smoke can independently verify Login → `/me` →
own profile without printing identity data. It has not been rerun by the operator
or reported as passed. Do not reuse historical chat passwords. A passing smoke
and a separately reviewed maintenance-resume step remain required before business
writes open. The owner's UI success report does not authorize resuming writes.
Missing confirmed curriculum/canonical scope can still block Phase1 submission;
registration is not academic verification or admission approval.

The retained approved encrypted backup predates018 and is not a fresh019 restore
point. No new snapshot was created and no restore was attempted. Routine rollback
is to pause registration and restore the recorded Lambda aliases while retaining
019 and genuine accounts, never to drop tables or overwrite live business data.
See the [runbook](../operations/tu-student-registration.md).

## Follow-up: first-registration confirmation503

The owner supplied a failing `POST /api/v3/auth/tu-register` with the fixed message
indicating incomplete authentication configuration. The preceding acceptance
report above is retained as history, but must not be used as successful
registration or Student workspace evidence. No identity values, credentials,
registration ticket or screenshot are copied into this report.

Local production-shaped reproduction confirms that an issuer without
`TU_AUTH_PUBLIC_KEY` throws503 `TU_SIGNING_UNAVAILABLE` **before** opening the
provisioning database connection. The original issuer deployment only needed a
private signing Secret for Login;019 staging inherited this environment without
adding the public key now needed by registration completion. Existing unit tests
injected a public key into the service and did not exercise the ambient production
configuration path.

The staging controller now assembles the issuer environment from the existing
verifier's public key, matching issuer/client/key ID and rejecting a conflicting
existing key. It validates this before any staging mutation, preserves all other
issuer fields and adds no Secret permissions. New regression tests exercise the
old503, valid completion without an injected service key, wrong-key rejection
before provisioning, idempotent environment assembly and invalid/mismatched
configuration. Only synthetic identities and generated local test keys are used.

Local checks so far:15 Node environment/operations tests,64 registration/split
Auth Jest tests and59 onboarding/session/profile Jest tests passed,0 skipped.
Syntax lint passed299 modules; documentation checks passed. The first frontend
test build was blocked by sandbox directory access; rerunning the same build and
tests outside that filesystem restriction passed. After the owner refreshed the
expired AWS session, read-only inspection confirmed issuer3 lacks the public key.
Broker5 and API3 have the same reviewed RSA public-key fingerprint. Recent issuer3
logs contain `TU_SIGNING_UNAVAILABLE`, stage `identity`, status503, with matching
broker5 errors. This confirms the missing verification configuration, rather than
a browser-navigation defect. No AWS resource, permission, database row, live alias
or maintenance flag has been changed at this pre-hotfix checkpoint.

The approved narrow next step is to verify the cause, then restore the existing
matching **public** verification configuration on the private issuer only, publish
the unchanged code and revision-guard its live alias. Keep API/broker/frontend,
database/IAM/Secrets and verify-only maintenance unchanged. Roll back only that
alias if necessary; do not replay019 or rerun the owner migration tool. Genuine
registration completion still requires a fresh owner Login and UI confirmation.
