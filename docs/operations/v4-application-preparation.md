# Phase 1 application preparation — #141

> Historical preparation-stage handoff. Newer verified TU onboarding, pending-academic intake, existing S3 use and Coordinator controls extend this baseline. Read [V4 architecture](../architecture/G03-V4-architecture.md), [current deployment](current-deployment.md) and [verification](student-intake-verification.md) for the released pilot. Do not interpret old storage/policy blockers here as current blanket status.

## What is delivered

The Student entry is `#/student/application`, with UUID details beneath it.
Application records are separate from legacy `plans`. A Student owns one Draft
per cycle; an existing application's cycle cannot be changed. Incomplete Drafts
may be saved, including while academic policy is awaiting team confirmation.
The four private attachment types are Resume, Transcript, conduct certificate
and applicant photo. First submission freezes declared/official values, policy,
cycle window and document metadata in an immutable snapshot.

Read the [API contract](../api/v4-application-preparation.md) and
[verification evidence](../evidence/v4-141-application-preparation.md).

## Handoff, not a completed review system

- #142 should consume `phase1_applications` and `phase1_submissions`, using the
  application UUID, cycle/student IDs, application version, submitted timestamp,
  policy and immutable document IDs. Do not fabricate a legacy Plan UUID.
- `GET /api/v4/applications/:id` and document download permit the currently
  scoped Coordinator only for submitted applications. Current `selection_cohorts`
  supplies cycle/department/program scope. Student Drafts are not visible.
- The V3 Coordinator queue, three-opinion process, selection tracking and Advisor
  screens still use V3 Plan contracts. They do **not** automatically list these
  new submissions. Review/return/resubmission, queue integration, announcement,
  ranking and rights confirmation must be coordinated with their issue owners.
- Application events contain IDs/action/version/time, not guardian data or file
  contents. Operation receipts contain protected result data but no signed URLs.
  History (#145) can consume these immutable events without copying PII into logs.
- Deadline administration (#144) should version `phase1_cycle_windows` and use
  owner-controlled metadata writes; an absent window blocks submission, not Draft
  preparation. Closed windows block changes/uploads while saved content remains
  readable. The Backend rechecks deadlines on every command and after storage I/O.

These are checked-in integration contracts, not evidence that another issue's
owner has reviewed them or that its feature has shipped.

## Academic metadata gate

No real credits or repeat rules were supplied, so Migration 010 deliberately
does not seed verified policies or infer academic identity from a student number.
Real submission remains blocked until the team provides trusted metadata.

An owner-controlled import, not the application runtime role, must populate:

1. `phase1_academic_profiles`: Student UUID, confirmed curriculum `61`/`66`, entry
   year, institution `TU_CS`, provenance, verifier UUID and verification time.
2. `phase1_policies`: cycle/curriculum, new immutable version, source year `2568`,
   source, `verified=true`, `synthetic=false` only after review. `data.credits`
   maps CS course codes to verified credit decimals. `repeat_rule` must be agreed
   (`LATEST` or `HIGHEST` supported; `SELECTED` with multiple attempts fails
   closed pending review), and `alternative_rule=STUDENT_SELECTED` must be agreed.
   No default retake rule or credit value is implied by Preview fixtures.
3. `phase1_cycle_windows`: confirmed opening/closing timestamps and version,
   matched to the correct existing cycle. Do not use Preview dates for intake.

Students cannot write these tables. Policies are append-only; publish a new
version instead of changing a version that may already have been submitted.
Metadata publication is serialized against submission with narrow advisory locks
and owner-side triggers, without granting runtime policy/profile UPDATE rights.
The 2568 baseline/entry-year cutoff applies to the approved 1/69 requirement; a
different intake's criteria must be reviewed before enabling it, not assumed.

The weighted comparison uses exact scaled arithmetic before rounding the display.
Eligibility is preliminary, not a committee decision. A course grade of zero is
not silently omitted from the required group. CS301/302 is a future obligation
acknowledgement, not a course required to have been passed when applying.

## Private storage configuration

Configuration examples are in [`.env.example`](../../.env.example). No storage
provider is enabled by default. Missing configuration is an error, never a mock
success. Do not put bucket credentials, documents or signed URLs in frontend
configuration, localStorage/sessionStorage, logs or screenshots.

For explicitly local development/test only:

```text
NODE_ENV=development
CO_ED_APPLICATION_STORAGE=local
CO_ED_APPLICATION_LOCAL_DIR=<private-local-directory>
```

The API serves authenticated PUT/GET binary endpoints for this adapter. They
explicitly refuse production and Lambda, even if a local adapter is injected.
Generated paths cannot traverse outside the private root; final keys are
write-once. The server is not an unauthenticated static document server.

For the approved production target, configure an existing private S3 bucket:

```text
CO_ED_APPLICATION_STORAGE=s3
CO_ED_APPLICATION_BUCKET=<reviewed-private-bucket>
CO_ED_APPLICATION_REGION=<bucket-region>
```

Before deployment the owner must review/provision these separately:

- Block Public Access, disabled public ACL/policy access, encryption, private
  object ownership, and least-privilege IAM for staging reads/uploads and final
  writes/downloads. Final writes require `If-None-Match: *` and AES256 encryption.
- CORS for the **actual** frontend origin: S3 POST uploads and GET downloads;
  CSP `connect-src` must permit only the configured API/storage origins. Do not
  add a broad wildcard. Fetching a signed download as a Blob also needs CORS.
- Lambda's private-network path to S3, region/bucket consistency, request/time
  limits and API Gateway JWT-protected `/api/v4` routes. Never expose local binary
  endpoints as a production substitute for private S3.
- Retention, orphan/staging cleanup, rate/cost limits and malware-scanning policy.
  Content signatures are not malware scanning or proof of a certificate signature.
  No automatic deletion or live bucket/IAM/network change is included here.

Staging POST targets expire after five minutes; final downloads after one minute.
A signed target remains a bearer capability until expiry, not instantly revoked
by application logout. Finalization copies verified bytes into a fresh final key
that was never signed for upload. Reusing staging credentials cannot overwrite
the frozen document. S3 reads/writes are bounded and timed out. A failed DB commit
may leave an unreferenced private final object; it must not erase the old pointer.

## Safe verification

Use Node 20+, PostgreSQL on loopback and a separately created disposable database
named `coed_v4_application_test` (or the CI target `coed_v3_test`). Never use RDS
or load a real `.env` target as a fallback. The new integration suite uses random
schemas/roles and a private temporary directory and removes only its own fixtures.
It requires `CO_ED_APPLICATION_TEST_DATABASE_URL`; CI intentionally fails when
this target is missing rather than silently skipping the integration test.

```powershell
$env:NODE_ENV='test'
$env:CO_ED_APPLICATION_TEST_DATABASE_URL='postgresql://<test-user>@127.0.0.1:5432/coed_v4_application_test'
npm.cmd run test:application
npm.cmd run test:frontend
npm.cmd run test:ui-preview
npm.cmd run test:migration
npm.cmd run build:v4
```

The new feature test does not require `ALLOW_DB_RESET`. Legacy suites in `npm
test` **do** reset fixtures and require a separate `TEST_DATABASE_URL` distinct
from `DATABASE_URL`, `NODE_ENV=test` and explicit `ALLOW_DB_RESET=true`. Selection
also requires its own loopback `coed_selection_test`. See the existing
[operating guide](v3-operating-guide.md) before full regression. Do not point a
destructive suite at an application database containing data you need to keep.

On a platform with `zip`, `unzip`, working `python3`, and symlink privileges, run
the unmodified full regression and documentation suite. No tests are bypassed to
work around missing tools. Use [Local Preview](../frontend/local-ui-preview.md)
for visual/keyboard checks at 375/768/1440 widths, both motion preferences and
all six application scenarios, including `application-61`. Preview does not
perform real storage writes. Its ready/61 scenarios use clearly synthetic
credits; they are not evidence of verified production eligibility.

### Reference-form version 2 checks

The six-step form extends the existing JSON payload and immutable snapshot;
there is no additional schema migration or backfill. See the
[version 2 field contract](../api/v4-application-preparation.md#staff-reference-form-version-2).
Release matching frontend/backend artifacts together. An older backend rejects
unknown fields instead of claiming a successful save; the editor must keep the
typed data and show that failure. An older frontend cannot provide the four new
declarations, so it must not be treated as compatible for new submissions.

Verify both curricula, all seven explicit declarations, contact versus Dome
email, names marked as declared versus official, CIS/ACS, job multi-select/Other,
long skills text, guardian data and all four required uploads. Move between
steps and follow readiness errors into another step. Confirm that an incomplete
Draft saves, a failed upload preserves the old file, and old submitted forms
remain read-only version 1 without invented new declarations. The current TU
record has no separately verified prefix/English-name fields; don't label a
student-entered fallback as university-verified.

Do not copy real applicant/guardian data from reference screenshots into Preview,
test fixtures or evidence. The private file limits remain one per category,
10 MiB per PDF and 5 MiB per photo. No Google login, Google Forms sharing,
automatic response email or live intake configuration is introduced.

## Rollout and recovery

For Windows-compatible, local-only paired ZIP preparation with exact reviewed
migration bytes and an honest dirty-source manifest, use the
[local candidate guide](v4-local-release-candidate.md). It does not deploy or
authorize a database change.

This branch does not deploy. Apply Migration 010 and reviewed runtime grants only
with operational approval, after backup and pinning matching frontend/backend
artifacts. Migrations 001–009 and applied checksums must remain unchanged. The
directory importer accepts the new checksum but still executes only Migration
003; it is not an application migration runner.

Real intake stays gated until academic identity, policy, schedule, storage and
cohort scope are reviewed. Validate actual Cognito owner/Coordinator access and
anonymous/cross-owner denial on the approved environment before using real data.
Recovery should disable the new entry/write path or restore a compatible build
while retaining new application records/documents. Do not down-migrate, reset
production, rewrite checksums or delete documents to roll back this feature.
