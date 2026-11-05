# TU Student registration rollout — November5,2026

## Outcome

Forward019 was applied to the actual observed018 production lineage after a
successful rollback-only trial. The owner tool verified preservation of existing
rows and migration history. No Student account, identity link, academic profile,
application or mock record was created by the operator. Genuine account creation
requires a fresh TU verification and the owner's first-login form.

Deployment remains **verification-only**. A subsequent owner clarification
supersedes the earlier UI acceptance interpretation: TU verification reaches the
first-registration form, but confirming it returned503. The confirmed missing
issuer public-key configuration is now corrected; live configuration/negative
checks passed. The subsequent409 issuer mismatch has also been corrected by
forward020 after a successful live rollback-only trial. Post-catalog verification
and independent temporary-capability cleanup passed. The owner subsequently
confirmed successful first-registration and Student workspace navigation. This
is **owner-reported UI acceptance**, not independent CLI smoke or successful
application access/submission. Application routes remain maintenance-blocked.

| Resource | Live result |
| --- | --- |
| API Lambda | `coed-api:live` → version3 |
| External TU broker | `coed-tu-auth:live` → version5 |
| Private issuer | `coed-tu-session-issuer:live` → version4 (configuration-only follow-up; initially3) |
| New HTTP route | `POST /api/v3/auth/tu-register`, existing broker integration |
| Frontend | Amplify job29 `SUCCEED`; published JS exactly matches packaged bytes |
| Runtime capability | Separate registration Secret and EXECUTE-only role; login role remains SELECT-only |
| Database follow-up | Forward020 applied; only the two registration issuer literals changed |
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

### Configuration-only hotfix completed

Source commit `45a663d` contains the environment guard and regression tests. A
preflight pinned API3/broker5/issuer3 code hashes, verified issuer `$LATEST`
matched live3, matched broker/API verification configuration and the reviewed
public-key fingerprint, and verified the existing private Invoke restriction.
Only `TU_AUTH_PUBLIC_KEY` and `TU_AUTH_KEY_ID` were added to the existing issuer
environment. Revision guards were used for the configuration and alias updates.

Issuer version4 was published with **unchanged executable code**, SHA256/base64:
`QlOfuYdpBjVhuOEIpQYeXZljVSfjH7HQwF590fvuV28=`. Live now points to4; version3 is
retained as the exact alias-only rollback target. API3, broker5, frontend job29,
SQL019, database contents, IAM/endpoint policies, Secrets and business maintenance
were not changed by the operator. No new standing service or permission was added.
Checkpoint details are under `registrationKeyHotfix` in the existing ignored
`production-o9DZU6/state.json`; it records only hashes/versions and safe metadata.

Post-change checks passed:

- Direct IAM-only issuer4 **completion** request with an intentionally invalid
  ticket returns403 `TU_REGISTRATION_REJECTED`, not signing503, with no session or
  database write. This exercises the missing-key path the public broker's own
  early invalid-ticket rejection would otherwise hide. No genuine proof was
  fabricated and no credentials/signing Secret were read by the operator.
- The seven public status/invalid-input/anonymous/maintenance checks in the table
  above passed again unchanged. Unauthorized access still fails closed.
- Live metadata confirms issuer4 has the reviewed public-key fingerprint and the
  same code hash; API3/broker5 remain unchanged, API maintenance remains `verify`.

The owner was asked to freshly Login and confirm the two-field form, then report
only Student workspace success or a fixed error code. Their old ticket expires
after five minutes. The admission-year field means year of entering university,
not birth year. **Genuine completion remains pending**; negative checks alone do
not prove registration/session/database success. No global write resume is implied.

## Subsequent409 and approved O8 forward020

The owner subsequently reported409 on genuine first-registration confirmation.
Read-only Lambda metadata showed issuer4/broker5 `TU_REGISTRATION_CONFLICT`.
Existing RDS PostgreSQL error metadata identified `Registration rejected` in
`complete_tu_registration`, line10, before any account insert. No raw SQL parameter,
identity, credential or profile values were returned by the diagnostic.

The actual configured issuer is account-scoped, while019 hard-coded the default
issuer in both `complete_tu_registration` and `guard_tu_registration_profile`.
This was a migration/configuration defect, not proof of duplicate identity or an
incorrect password. Earlier tests used the default issuer and missed the mismatch.
Fixing only the first routine would still fail the deferred provenance guard.

The owner explicitly approved O8: fixed forward020, production-shaped local tests,
temporary private owner trial/apply tooling with cleanup, no old-row repair,
standing privilege expansion, new Secret, global write resume or push. The plan
and approval transcript/outcome remain local under `docs/plans` and ignored
`tmp/grill-me` respectively. No production mutation has occurred at this checkpoint.

Local validation for020:

- Disposable PostgreSQL16:10 checks passed,0 skipped. Includes exact old failure,
  inventory, rollback-only trial, atomic apply/replay, unchanged019 history and
  no account created by the migration.
- Full real-database synthetic owner flow uses the account-scoped issuer and a
  non-default client: registration ticket, private issuer completion, normal
  SELECT-only session, broker validation, API `/me` and exact own profile.
- Wrong/default issuer, invalid status/overrides, exact idempotency/conflicting
  retry, races, disabled/revoked identities, audit rollback, direct-write denials,
  legacy completeness and schema-drift rejection remain covered.
- Unit/configuration/owner safety regressions:21 passed,0 skipped. Temporary
  execution policy reads only the existing RDS owner Secret and cannot rotate it
  or read provider/signing Secrets; request contract has no SQL/account mode.
- Initial database test started before the disposable server was ready; after
  checking `pg_isready`, the same test passed. No production connection was used.

At the pre-deployment checkpoint, production trial/apply and real-owner acceptance
were pending. The020 source
checksum is `3ea3a1fc31ea7a839fff1d8fb94d3d8732d26042edc9dd4a03dbc62610082790`.

### O8 production execution completed — real-owner acceptance pending

Source commit `7c1a2c0` was clean when packaging. The isolated owner artifact
SHA256 is `481af35219efc67dee5f722734ceaa6214d1b4018091f70a93595aa54b2b506b`.
The extracted ten-entry package loaded, verified the pinned SQL, and rejected an
invalid request without reading a credential. Auth/split regression64 also passed;
combined with the31 Node/database checks above,95 targeted checks passed with no
skips. Syntax lint passed304 modules; docs and historical migration checks passed.

Checkpoint: ignored `tmp/tu-production/production-xg3NUI/state.json` and four fixed
safe result files. The checkpoint contains versions/hashes/ownership flags and
safe operation results only, never credentials, provider identities or tickets.

Execution sequence and evidence:

1. Read-only standing-release preflight pinned API3/broker5/issuer4, the same
   configured issuer/client/public key and API maintenance `verify`.
2. Temporary owner capability was created disabled, then activated only through
   a qualified/operator-only published version with one-hour expiry. Its role
   could read only the existing RDS owner Secret, not provider/signing Secrets,
   rotate a password or call an account-provisioning mode.
3. Live inventory matched019's exact catalog hash
   `ea3ff238c1c10aaa5d32253b894c0541246ef1e04c775effffcd15ad1d0889d1`.
4. Live020 trial passed and rolled back. Preservation checks confirmed that only
   the two fixed issuer literals changed and all row fingerprints, history,
   routine OIDs/owners/ACLs and role attributes/memberships were preserved.
5. Apply passed in one atomic transaction, appending only020's history/checksum
   entry. No account, identity link, academic profile or application was created
   or repaired by the operator. Runtime grants and old migration records stayed
   unchanged. Temporary function-owner membership was revoked before commit.
6. Subsequent inventory verified exact idempotent replay and post-catalog hash
   `89966e31c60134499d3bb7d60df92dbb51c161d0fb941517eca308817c479b91`.
7. Cleanup removed the task Lambda/all versions, IAM role/inline policy, log group
   and exact endpoint statement. An independent AWS read confirmed all four were
   absent and standing Lambda configurations/aliases still matched the baseline.
   No new standing Secret, NAT, service or permission remains.
8. Seven public configured/invalid-input/anonymous/maintenance probes passed again
   with no credential use or database write. Invalid registration proof still
   returns403; anonymous owner reads return401; application writes remain503
   `COED_MAINTENANCE`. These are negative gates, not completed signup evidence.

The initial audit process output was lost when the client session was interrupted;
continuation first checked the completed checkpoint, then reran only the read-only
independent cleanup audit and public probes. It did not replay020, invoke the
deleted owner tool or recreate resources. The disposable synthetic database and
its anonymous test volume were removed; pre-existing containers were untouched.

The owner has been asked to freshly Login TU, confirm the actual admission year
and report Student workspace success or a fixed error code. Registration tickets
from before the interruption are expired. Real-owner completion and optional
hidden-input Login -> `/me` -> own-profile smoke remain pending. No stored chat
credential was reused, no positive production proof/account was fabricated and
no business write resume or push was performed.

### Owner confirms registration; remaining application503 is maintenance

After fresh Login/form confirmation, the owner explicitly reported successful
registration and entering Student. Unlike the earlier ambiguous TU identity-card
report, this answer specifically confirms completion and Student navigation.
No password, token or personal-profile screenshot was requested or received.

The owner also reported Google Fonts `ERR_CONNECTION_CLOSED` and503 from GET
`/api/tu-proxy/api/v4/application-options` and `/api/tu-proxy/api/v4/applications`.
Read-only verification confirmed API3 still has maintenance `verify`; both exact
paths return503 `COED_MAINTENANCE`, Retry-After120. The source gate permits only
session/profile GETs in this mode, before routing/authentication, so even those
application **reads** are intentionally blocked. Five local gate checks reproduced
the two blocked GETs, two allowed profile/session paths and a blocked write.
This is not another registration/issuer failure and is not evidence of a DB500.

The CSS has an external Google Fonts import and system-font fallbacks. The
owner's connection-closure report establishes a failed font fetch, not whether
Google, a proxy, network filter or the browser caused it. No claim is made that
the exact user's network path was independently tested. It can affect typography;
it is separate from TU authentication and the maintenance response.

No AWS setting, database record, UI/font file or maintenance gate was changed in
this acceptance/diagnostic turn. A separate reviewed read-only application mode
with honest disabled write controls is a possible next step; it must not silently
enable account writes, uploads/submission or fabricate verified academic data.
Self-hosting reviewed font assets can remove that runtime external dependency,
but has not been implemented here. Independent owner CLI smoke and any reviewed
business resume remain separate. The finalized acceptance transcript/outcome are
under ignored `tmp/grill-me`, basename ending `20261105-172031`.
