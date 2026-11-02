# PR #151 — Merge verification

## Source

- PR branch: `chore/140-team-dev-test-setup`, original HEAD `9143cf3949cb46765473fbb4593c58628386432a`
- Main merged: `79db1ef` (PRs through #159)
- Integration is prepared locally; the owner creates the merge commit and pushes.

## Conflict resolution

| File | Resolution |
| --- | --- |
| `.gitignore` | Keep both local session and application-document exclusions, plus main release exclusions. |
| `package.json` | Keep all main scripts/dependencies, add the seven local Dev/Test commands, retain Node 22. |
| `src/db/seed.js` | Use main exactly, including Phase 1 reset order and triggers. Main already includes selection cleanup. |
| `tests/package-lambda.test.mjs` | Keep main ZIP reader and migration 010 checks; add the local-fixture isolation assertion after extraction. |

Additional integration: set `CO_ED_APPLICATION_TEST_DATABASE_URL` in our local test wrapper so the application/release database tests run. Update the Dev/Test guide to migrations 001–010.

The `src/` tree is byte-identical to the merged main. ZIP implementation, application/UI code, migrations, and runtime grants from teammates are unchanged.

## Validation on macOS

- Full regression: 1,066 Jest and 139 Node test results passed, 0 skipped; two release checks failed as detailed below.
- Local harness: 8 passed, 0 skipped.
- UI Preview and production isolation: passed.
- Syntax lint: 188 modules passed; documentation link checks and V4 production build passed.
- All 10 migration files match main bytes and reviewed checksums exactly.

### Release checks requiring attention

1. The committed-byte test uses `git show HEAD:...010...`. Before the owner commits this merge, HEAD still precedes migration 010. Run `node --test tests/release-migrations.test.mjs` after committing and before pushing.
2. The Thai ZIP filename round-trip fails with the macOS system unzip. Reproduced from unmodified main copies of the helper and test outside the checkout, including with en_US.UTF-8. This is not a conflict-resolution change. Coordinate the fix with the release-code owner and verify CI on the pushed merge commit.

Logs are kept outside Git under `/private/tmp/pr151-*.log` on the operator machine.

## Before merge

- Owner reviews the resolution, commits, reruns the committed-byte check, and pushes.
- Check CI on the new PR HEAD and obtain a teammate review.
- Keep `Refs #140` while team onboarding/test-account acceptance remains pending.
