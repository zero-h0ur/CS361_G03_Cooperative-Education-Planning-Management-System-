# Committee workspace (#142 / #143)

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
