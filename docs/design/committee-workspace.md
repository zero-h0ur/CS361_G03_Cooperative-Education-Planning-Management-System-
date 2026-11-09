# Committee workspace (#142 / #143)

## Current integration contract (2026-11-09)

PR #172's combined-capacity and roster improvements are integrated with PR #171's confirmed academic-review source on a local review branch; this is not a deployment claim. Committee defaults to all assigned curricula/programs and labels each row. A new proposal sends integer `total` (1–999), not two new track quotas. Legacy `normal`/`special` inputs remain supported when complete and consistent with any supplied total; conflicting/malformed values fail validation. Old records are read using the sum when `total` is absent. The combined ranking cutoff includes ties and is independent of visible roster filters. Coordinator shows the same total and remembers only a still-assigned round.

Forwarding still requires a separate retained six-check academic review, a complete latest verified policy and computed PASS where academic review is required. A legacy `confirm_academic_review` checkbox is not accepted as a substitute. Review start/end boundaries remain mandatory; manual intake opening does not create an unlimited review window. Committee handoff remains read-only when the backend denies decisions. Original submission/checksum and reviewed provenance remain separately visible. See [academic-review contract](../api/v4-academic-review.md) and [integration verification](../operations/committee-integration-verification.md).

The sections below retain the original #142/#143 implementation and its historical verification/rollout scope. Do not use their fresh migration instructions against observed RDS.

## Change
- Shared Student theme and shell, separate Committee roster/ranking, capacity proposal, voting and final review.
- Preview has 16 synthetic applicants with opposite grade priorities and a tied cutoff. No synthetic records are inserted into AWS.
- Server persists versioned proposals and final selections with immutable operation receipts, panel membership checks and serialized writes.
- Source is Coordinator-received legacy selection records. When the same student/cycle has a Phase 1 submission snapshot, its declared GPAX/core average and documents are displayed. Missing grades remain unknown. New Phase 1 applications require Coordinator receipt integration before appearing here; that integration is not silently inferred from submission alone.
- Snapshot document download reuses the configured document store. S3 signed links expire after 60 seconds. Local authenticated document-content handling remains owned by the existing application service.

## Review / rollout
1. Review migration 012 and runtime grants; preserve existing migration checksums.
2. Merge only after team review. Deploy Backend and apply migration/grants before deploying this frontend.
3. Check assigned panel membership and real Coordinator receipts; do not seed live test identities by changing this preview.
4. Coordinator publication, student confirmation/deadline and the Phase 1 receipt bridge are separate from recording Committee selections. This change does not announce results or complete those integrations.

## Local checks
`npm run test:committee`, `npm run test:selection`, `npm run build`, `npm run verify:migrations`.
For the PostgreSQL transaction test use an isolated migrated local database and set `COMMITTEE_TEST_DATABASE_URL`; it inserts synthetic fixtures and refuses non-local hosts.

## Validation for this changeset
- Committee unit/UI checks and a real PostgreSQL transaction test passed. Browser flow from capacity approval through explicit finalization passed with no console errors; 390px viewport has no horizontal overflow.
- Build, syntax lint and migration checks passed. Existing regression checks before release passed after updating migration expectations and the intentional Committee shell navigation.
- The release suite compares migration files with HEAD, so migration 012 must be committed before that check can pass. The ZIP Thai-filename test also fails on the unchanged origin/main reference in this environment; it was not modified by this feature.
