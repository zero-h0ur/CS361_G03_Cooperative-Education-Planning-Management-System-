# TU Student identity and Phase 1 delivery decision

Status: implemented and verified locally; production rollout is not authorized.
Date: 2026-11-04 (Asia/Bangkok).

## Identity boundary

Student uses TU credential verification; Coordinator/Committee continue using Cognito.
Both resolve to the same internal `users`/`students` UUID model. A login provider
is not a workflow destination. One ACTIVE external identity per User remains required.
This extends the original identity-link decision without allowing just-in-time
provisioning, choosing another Student, or linking by unverified email/name.

[TU's authentication documentation](https://restapi.tu.ac.th/home/documents/Authen.html)
specifies `UserName`/`PassWord`, boolean `status` and a Student/employee `type`.
It does not guarantee an echoed username or an immutable opaque Student subject.
Our application-scoped TU subject is the exact ten-digit username whose password
the server verified in that request; any contradictory optional echo is rejected.
This is a credential-request binding, not a claim that TU signs our JWT or provides
a globally immutable OIDC subject. A production roster/username-lifecycle review
and a separately approved live provider check are still required before migration.
Display fields such as faculty/department never overwrite canonical program,
normal/special track, academic profile or eligibility policy.

TU login requires real server verification and configured matching RSA keys.
There are no repository signing keys, client-supplied verification responses or
offline authentication fallbacks. JWT issuer/client/key/expiry/scope are checked
independently of Cognito. `/api/tu-proxy` permits only explicit Student endpoints;
it cannot reach Coordinator, Committee, Admin or legacy Plans. Browser TU secrets
are session-only; role comes from authenticated `/me`, not a cached profile.
The small in-process attempt limiter is not distributed abuse protection: Gateway
or equivalent global throttling and privacy-safe logging must be reviewed at release.

## Controlled existing-account transition

`src/auth/tu-identity-relink.js` is an operator library, not a login hook, public
route or executable migration CLI. It requires an explicitly supplied owner
connection, an ACTIVE internal Admin, the exact approved old Cognito link and a
fresh server-created TU proof. The proof cannot be replaced by a client object.
Default execution rolls back. A separately approved apply transaction revokes the
old link, activates the new link and appends `tu_identity_link_events` atomically.
User/Student UUIDs, applications, academic metadata and history are unchanged.
Conflicting/revoked target links are not reactivated. Runtime has no relink rights.
Existing real identities have not been moved or disabled by this work.

## Shared Phase 1 workflow

Drafts use `/api/v4/applications`; no browser-side success fallback remains.
Readiness reports missing receiver configuration separately from academic results.
Submit selects exactly one ACTIVE cohort/Coordinator for the round and canonical
department/program, locks that assignment and commits all of the following together:

- Immutable submitted snapshot, real completed document references and checksum.
- Immutable `phase1_submission_deliveries` destination/assignment-at-send record.
- Application state/version, operation receipt and audit event.

Only a committed result with a matching application/submission/version/round receipt
can display submission success. Network uncertainty keeps the same operation ID;
retry reconciles the database result rather than inventing browser state.
Queue delivery means waiting for review, not accepted, opened, forwarded or selected.

Authorization follows the current assigned Coordinator of the recorded cohort,
not the historical Coordinator-at-send. A profile edit does not reroute a submitted
application. A conflicting scope change blocks correction resubmission pending
controlled resolution. Returned corrections retain snapshots and the review-close
deadline; they do not reopen new applications. Committee ranking semantics are unchanged.

## Legacy records and recovery

Existing server submissions are read through their immutable submitted official
scope when no delivery sidecar exists. They are not rewritten/backdated; Student UI
states that the new receipt is absent instead of claiming confirmed delivery.
New sidecars require a separately validated owner-operated backfill; ambiguous
scope requires operator resolution. No automatic production backfill is included.

Old `co-ed:tu-applications` text is offered only with consistent owner UUID/number
and official identity claims. Shared-browser ambiguous records are not displayed.
This protects against accidental cross-account recovery, not malicious local-storage
tampering or proof of historical authorship. Users explicitly select validated text;
existing server Draft fields are compared and version-checked before replacement.
Submitted/returned server applications cannot be overwritten. New declarations are
all unchecked, old file metadata/IDs/status/verification flags are not imported,
and the browser source is retained. Real uploads and explicit submission are required.

## Schema and release boundary

Migration `017_tu_phase1_delivery.sql` extends **this branch's workspace013 lineage**.
It does not claim compatibility with the separately observed external013/014/015
history. Historical 001–013 bytes/checksums are untouched; there is no guessed016
upgrade. Missing delivery schema returns a configuration failure, not synthetic data.
The old hand-written `deploy-rds-v4-migrations.sql` deliberately refuses execution:
it duplicated migration history and contained unsafe synthetic academic provisioning.

Before production: inspect current schema/history and backup, review a correct
forward-only upgrade for that exact lineage, apply least-privilege grants, provision
verified roster/cohort/academic records, review protected key storage/rotation and
Gateway/CORS routes, perform controlled account relinks, and deploy compatible
backend/frontend together. No real provider credentials, AWS resources or production
database were accessed during local implementation/testing.

See [local verification evidence](../evidence/tu-student-coordinator-delivery.md).
