# Main alignment and TU authentication compatibility — local evidence

Date: 4 November 2026 (Asia/Bangkok).
Status: local source integration verified; not a production-login fix or deployable release approval.

This is the historical integration/pre-commit record. The later authorized local
commits and release-gate rerun are recorded in
[post-commit verification](tu-post-commit-release-gate.md); they do not authorize AWS changes.

## Source and preservation

- Branch: `fix/tu-phase1-coordinator-delivery`; existing HEAD `9ba453b`.
- Fetched/reviewed main: `a0ef1deca83e5e905bd849bbc61be883e418e2b9`.
- Verified checkpoint of 40 pending source files is retained locally in
  `tmp/main-alignment/source-checkpoint-H5lrsB` with a SHA-256 inventory.
  It excludes environment files, credentials and generated release/dependency files.
- Git rejected the no-commit merge because pending Auth/registry changes overlap.
  Reviewed main deltas were integrated into the working tree explicitly instead.
  This is **not** a merge commit, and HEAD/ancestry have not advanced. Nothing was
  staged, committed or pushed. User-owned pending changes were preserved.
- The existing candidate ZIP pair was not overwritten or repackaged. It does not
  represent the newly integrated source and must not be presented as this release.

## What was reconciled

- Main schedule/confirmation routes, evaluator, selection UI, Preview and tests
  coexist with the previously approved Student delivery/recovery work.
- Strict TU provider verification, exact DB identity ownership and no synthetic
  browser-success fallback remain. Main's shared-key fallback and arbitrary-active-
  Student substitution were deliberately not restored.
- The TU transport permits only named Student-owned status, schedule-read,
  decision/confirmation and notification endpoints. Schedule writes, announcements,
  Coordinator, Committee and Admin actions cannot use this bridge.
- The selection-status list includes owned Phase 1 applications without creating
  legacy Plans. Corrections link to the actual application editor; Ranking is not
  represented as applicant voting or fabricated opinion counts.
- Coordinator schedule APIs and main share a cycle lock. New writes synchronize
  confirmation timestamps atomically, validate the existing consideration period,
  increment versions and reject stale competing writers. Old pre-014 dates remain
  readable without backfilling historical records. Conflicting populated sources
  return `SCHEDULE_SOURCE_CONFLICT`, rather than silently choosing one.
- Main's round-wide confirmation reads/writes require complete Coordinator
  assignment. Student decisions/notifications use the DB owner, not a submitted
  student ID. Runtime cannot insert/change selection outcomes or rewrite audit.
- Fixed the PostgreSQL placeholder gap in lazy expiry, returned committed version,
  announcement retry handling and `unread_only=false` parsing.
- UI/UX Pro Max guidance informed visible recoverable errors, live status and
  mutually disabled confirmation actions. Not-yet-open is not auto-waived; only an
  explicit server expiry code is shown as such. Teams links require valid configured
  `PHASE1_TEAMS_JOIN_URL`; no fictitious group/default link is manufactured.

## Immutable migrations

Migration files were not rewritten or renumbered:

- Main014 `014_phase1_schedules_and_confirmations.sql`:
  `91466678848777ebe71759f178eaa35b7d51ccc9bff5367dd52159f5ad573396`.
- Existing017 `017_tu_phase1_delivery.sql`:
  `1aa9a90ae9e91b8a01f8ef8c29e81301e03f2e8339db4266a44f2988dd0b7c5c`.

The reviewed registry includes both. Local tests cover fresh migration, upgrade
from001–013 and adding014 to an existing001–013+017 history. Concurrent/repeated
runners retain recorded checksums, users and the pre-014 Coordinator schedule.
Runtime grants are separately restricted; no production ACLs or SQL were applied.

## Verification

Tests used only task-owned PostgreSQL16 bound to localhost and synthetic fixtures.
No real TU credentials, AWS login attempt, Student records or production DB calls.
The verified task-owned container and its disposable volumes were removed after
testing; source checkpoints and logs were retained.
Counts below overlap and must not be added into one total.

- `npm run verify:migrations`: all15 reviewed migration files match exact LF hashes.
- `npm run test:phase1-schedule`: 20 Node/PG tests and24 Jest tests passed.
- `npm run test:tu-auth`: 65 Jest and11 actual HTTP/PG tests passed, including
  TU status/decision transport and Cognito Coordinator reading the same submission.
- `npm run test:coordinator`: 27 Jest and8 PostgreSQL tests passed.
- `npm run test:selection`: 12 existing Node/PG and35 UI/API tests passed, plus
  the separately listed schedule integration suite (now wired into this script).
- `npm run test:application`: 18 Node/PG and56 UI/API tests passed.
- `npm run test:committee`: 9 Jest and1 actual PostgreSQL test passed. An earlier
  run skipped the DB case; final rerun set its dedicated local-test URL.
- `npm run test:frontend`: 372 passed; `test:migration`: 30 passed;
  `test:runtime-grants`: 3 passed; `test:ui-preview`: 48 Jest and2 server tests passed.
- `npm run lint`, `npm run test:docs`, `npm run build:v4`: passed.
- Full `npm test` functional suites passed up to the release gate. `test:release`
  had31 passes and1 failure: the committed-LF-history check cannot `git show HEAD`
  the newly integrated014 (and017 also remains uncommitted). This is an expected
  unfinished **release prerequisite**, not a waived check. No gate was disabled.
- Subsequent schedule-reader compatibility changes were rerun successfully through
  the affected schedule, TU HTTP, Coordinator, Committee and build checks.

Logs and the local test runner are under ignored `tmp/main-alignment/`:
`full-regression.log` and `verified-final.log`. Native Desktop/Mobile visual,
keyboard and reduced-motion browser QA was not performed in this integration pass.

## Production boundary and remaining work

Earlier read-only inspection established that deployed Frontend and `coed-api`
match candidate4CSorG, while `/tu-login` and `/tu-status` target a separate older
`coed-tu-auth`. That function is outside the VPC, has TU configuration but no DB
configuration; `coed-api` is inside the VPC. The current strict local login requires
DB identity verification. Uploading the generic API ZIP to the TU function or
repointing login is **not** an approved or verified correction.

The actual production500 exception remains unconfirmed: available logs contained
no exception detail and API access logging was not configured. This local change
does not prove that online login works. Split-auth topology, provider egress,
signing configuration, actual migration lineage and controlled identity links
need a separate reviewed deployment plan. No AWS mutations occurred in this pass.

Selection outcomes must come from an approved authoritative decision workflow or
operator; this integration does not infer results from three votes, generate
mock production outcomes or convert Committee history automatically.

Before any release: review/commit the preserved source, rerun release gates on
that HEAD, verify actual migration checksums and runtime grants, and obtain
separate approval for deployment/configuration/data changes.

## TU provider contract follow-up

The user subsequently supplied TU contract screenshots and authorized an
Application-Key for TU requests. The key was used only in memory for one POST
to the supplied `/api/v1/auth/Ad/verify` endpoint, with JSON `{}` and no account
name/password. TU returned HTTP400, `status:false`, with request-body rejection.
Only safe status/category metadata was retained; neither the key nor the raw
response was written into application code, configuration, fixtures or logs.
This proves endpoint reachability, **not** key validity or a successful login:
the provider may validate body syntax before application authorization.

Local contract changes:

- Backend sends exact `Content-Type: application/json` and `Application-Key`
  headers, and JSON fields `UserName`/`PassWord`.
- Allow only the exact documented `/verify` and `/verify2` URLs. `/verify` stays
  the default; no automatic fallback/retry or arbitrary credential destination.
- TU401/403 become sanitized503 `TU_API_ACCESS_DENIED`, not a Student-password
  error. TU429 becomes429 `TU_API_RATE_LIMIT`; upstream5xx/network failures and
  malformed JSON remain unavailable, without issuing tokens or querying identities.
- Documented invalid credentials remain401. Request-body read failure is a
  provider-contract503. Employee responses cannot authenticate a Student.
- `.env.example` documents backend-runtime/Secrets Manager configuration using
  placeholders only. The actual supplied key was not installed on AWS or stored
  in a local secret file. Rotate the shared key before production use.

Follow-up validation uses synthetic contract/security fixtures; the PostgreSQL
integration results above are from the preceding alignment pass, not a new
real-provider login. The API key alone does not resolve the split-Lambda/DB
topology prerequisite described above.

Final follow-up verification: all80 focused auth tests across3 suites passed,
along with lint (236 JavaScript modules), all9 documentation tests and
`git diff --check`. No additional TU requests, AWS changes or release ZIPs were
made. The complete regression/release-gate caveats above still apply.

## Authorized real TU verification

The user explicitly authorized a real authentication check with their own
credentials. No credential values, Student identifier, provider profile, signing
key or access token are included in this evidence or test fixtures.

The sandbox denied the initial network attempt before any TU response. After
network approval, one request through the current local `TuAuthService` adapter
to the documented default endpoint returned:

- HTTP200, provider success, Student response type and exact subject echo match.
- Local provider-proof validation passed.
- No DB query, identity provisioning/relink, application session or token issued.

Secret input was passed in memory through a terminal with echo disabled; this
was first checked using synthetic input. The verifier received credentials
through terminal input, not command arguments. No credential files were created,
and the final source scan returned no credential matches. The successful check
establishes that the supplied
credentials/key and current adapter worked with TU for this request, not that
the deployed environment contains the same configuration or that application
identity ownership is ready. No additional provider-contract code change was
necessary based on this result.

Read-only AWS metadata was rechecked: login/status still target `coed-tu-auth`
through integration `sr47ns9`; application routes target `coed-api` through
`ip14y62`. TU Lambda still has the previously recorded CodeSha256, modified time
and TU/signing environment variable names, without DB configuration names. No
environment values were printed or compared. The exact online500 exception
remains unconfirmed; no production login or AWS mutation was performed.

All80 focused auth tests across3 suites, lint and documentation checks passed
again. Full PostgreSQL/regression/release tests were not rerun in this follow-up;
their earlier results and release prerequisites still apply. Fixing the deployed
split-auth/configuration path requires a separately reviewed and authorized AWS
change, rather than uploading the generic API ZIP to the TU Lambda.
