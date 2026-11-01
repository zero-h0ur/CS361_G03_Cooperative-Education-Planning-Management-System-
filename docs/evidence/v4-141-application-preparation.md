# #141 — Phase 1 preparation verification

Date: 2026-11-01, Windows / Node 22.12 / local PostgreSQL 18.
Branch: `feature/141-phase1-application-preparation`.
Base: latest `main` at `5a57637` after `git pull --ff-only origin main`.
No push, PR creation, production migration, AWS write or deployment was performed.

## Delivered source

- [Migration 010](../../src/db/migrations/010_phase1_applications_documents.sql):
  separate applications, policy/academic/window metadata, private document
  pointers, immutable snapshots, receipts/events and database guards.
- [Application service](../../src/api/services/application-service.js),
  [policy checks](../../src/api/services/application-policy.js),
  [protected routes](../../src/api/routes/application-routes.js) and
  [storage adapters](../../src/storage/application-document-store.js).
- [Student workspace](../../src/frontend/student/application-view.js),
  [editor](../../src/frontend/student/application-editor-view.js) and
  [API client](../../src/frontend/student/application-client.js).
- [API handoff](../api/v4-application-preparation.md) and
  [operating/rollout guide](../operations/v4-application-preparation.md).

The two requested design skills informed the UI: existing CO-ED tokens are reused,
official data is visibly read-only, editable fields have stronger borders and
labels, failed saves retain values, linked error summaries focus the relevant
field, uploads announce actual phases rather than invented percentages, and
hover/scroll/route motion respects Reduced motion. Visual approval is still
pending the Browser checks below; jsdom does not establish visual quality.

## Automated results

| Command / boundary | Result |
| --- | --- |
| `npm run test:application` with explicit disposable target | 14 Node tests + 36 UI/API tests passed; no integration skipped |
| `npm run test:frontend` | 14 suites, 342 tests passed |
| `npm run test:ui-preview` | 48 UI tests + 2 server/dependency-graph tests passed |
| `npm run test:migration` | 30 tests passed, including legacy preservation and concurrent migration runners |
| `npm run test:runtime-grants` | 3 tests passed; new feature also exercised with the checked-in least-privilege policy |
| `npm run test:directory-db` | 16 tests passed; 001–010 checksums accepted, altered/unknown history rejected |
| `npm run test:dal` | Passed on disposable local database |
| `npm run test:selection` | 10 PostgreSQL/policy tests + 21 UI/API tests passed |
| `npm run test:workflow-ui` | 24 tests passed |
| `npm run test:v4-build`, `npm run build:v4` | Passed; build only, no deployment |
| `npm run lint`, `git diff --check` | Passed |
| `node scripts/verify-doc-links.mjs` | Passed; no network requests |

The full `npm test` was attempted using explicitly separate local test targets.
It passed dataset/fixtures/API/directory/contracts/auth/authz/workflow/session/
profile/plan/staff/review/history/advisor/auth-boundary/PostgreSQL transition
suites and Lambda unit tests, then stopped at packaging: `spawnSync zip ENOENT`.
`zip`/`unzip` are unavailable on this Windows machine. Remaining suites were run
separately as above; this is **not** recorded as a passing full `npm test`.

`test:three-role` passed its database/service subtests but its Python operator
subtest failed because it invokes `python3`, which resolves to the Microsoft
Store alias. Installed `python` works, but the existing suite's tool name was not
changed or bypassed. `npm run test:docs` passed eight checks and failed the
symlink-escape test with Windows `EPERM`; the actual repository-link verifier
passed independently. These suites still need a supported CI environment.

Dependency audit reported 19 findings (16 moderate, 3 low) in the Jest/tooling
dependency tree; the newly added S3 packages were not listed among findings.
No `npm audit fix`, forced upgrade/downgrade or unrelated dependency repair was
performed. The audit is evidence at this date, not a future security guarantee.

## What the new tests prove

The [integration tests](../../tests/application.test.mjs) create their own random
schema/role and private temporary directory, with synthetic applicants only.
They prove:

- One application per owner/cycle; separate cycles keep separate data; guessing
  another owner's UUID or document ID does not grant access.
- Incomplete Drafts and real files work while criteria are pending; unverified
  or synthetic policies cannot unblock real submission.
- Exact weighted comparisons at 2.50, curricula with six versus seven groups,
  alternative choice, repeat handling, GPAX and trusted entry-year gates.
- Real private byte persistence and authenticated HTTP upload/download, no-store,
  attachment/nosniff handling, anonymous denial and current-scope downloads.
- PDF/PNG/JPEG signatures, checksum/type/name checks, size boundaries, expired or
  unfinished uploads and production/Lambda refusal of local storage.
- Failed file replacement/DB commit keeps the old attachment and application
  values; a replay commits once. An unreferenced private object may remain, as
  documented, rather than deleting a valid file to clean up automatically.
- Deadline/policy changes produce visible failures; submission failure rolls back
  state, snapshot, receipt and event together.
- Concurrent Draft writes and finalize-versus-submit races allow one versioned
  command only; a submitted document snapshot cannot change underneath review.
- First submission freezes policy/effective criteria, schedule, official values,
  declared values and document IDs/checksums. Publishing a later policy does not
  change the submitted view. Direct submitted edits/deletes are rejected.
- Runtime can execute the feature but cannot publish verified policies, modify
  official academic metadata or overwrite/delete immutable records.

[UI tests](../../tests/application-ui.test.js) cover dirty-value preservation,
upload changes retaining other unsaved fields, stale/failed saves, explicit
confirmation/cancellation, read-only submitted/closed Drafts, pending criteria,
Reduced motion, route ownership, unsafe storage targets and no Bearer token sent
to S3. An uncertain completion retries the same receipt instead of uploading a
second file. Session expiry still removes protected content despite a dirty form.

[API tests](../../tests/application-api.test.js) cover trusted identity, role
spoofing denial, no-store, no object key leakage, anonymous malformed-body denial
and production local-binary refusal. All twelve new routes are also registered
in the existing auth-boundary matrix.

## Not yet verified / rollout gates

- Browser automation inventory reported `The browser access host is unavailable`.
  Windows Computer Use selection then timed out awaiting app approval. No visual
  screenshots or responsive/keyboard/manual Browser pass is claimed.
- Review 375/768/1440 widths, actual font/layout, keyboard/focus, smooth motion and
  Reduced motion, five Preview scenarios, round changes and error recovery.
  Local Preview serves synthetic state only; it does not store real file bytes.
- Actual Cognito → API Gateway → Lambda → RDS/private S3 CORS/IAM/VPC integration
  has not been deployed or tested. Academic identity/credits/retake rules and
  real schedule remain unconfigured, so real first submission must stay blocked.
- Coordinator read handoff is present; the existing V3 queue is not converted.
  #142 must wire the new submitted application domain into its review workflow.
- Retention/orphan cleanup, malware scanning/certificate authenticity, ranking,
  announcements, rights confirmation and company/Advisor flows are not delivered
  by this issue. See the operating guide before considering a live intake.

Migration 001–009 contents and stored checksums were not changed. New Migration
010 was iterated only during development; tests used fresh disposable schemas
and a fresh legacy-regression database after edits, never checksum rewrites.
No real student documents or personal data were used as fixtures or evidence.
