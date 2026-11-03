# V4 local release candidates (Windows / macOS / Linux)

This workflow prepares local files only. It does not upload to AWS, deploy,
connect to an application database, invoke a migration, configure credentials,
commit or push. The current target remains AWS Free Tier account `130165494095`,
Sydney `ap-southeast-2`; historical Learner Lab tooling is not used.

## Coordinator schema cutover

The current candidate requires Backend + Migration 016 + compatible runtime grants.
Fresh workspace installs use 001–013 + 016. The external 013–015 lineage must use
the separately reviewed **upgrade-only** path, never workspace 013 or the default
bootstrap migrator. Missing authentic 014/015 source remains a production approval
gate. Candidate manifests state this explicitly and do not grant deployment
authority. See [local alignment evidence](../evidence/coordinator-schema-alignment.md).

## Exact migration bytes

Migration checksums cover bytes, not SQL meaning. The reviewed Git versions of
001–010 use LF. A Windows checkout converted to CRLF has different checksums.
`.gitattributes` now pins these migration paths to LF, and the release, importer
and packaging preflights share the reviewed filenames and SHA-256 values in
`scripts/operations/reviewed-migrations.mjs`.

```powershell
npm.cmd run verify:migrations
```

For an existing CRLF checkout, explicitly restore **only** reviewed LF formatting:

```powershell
npm.cmd run format:migration-eol
npm.cmd run verify:migrations
```

The formatter validates all ten files against their reviewed hashes before
writing any. It rejects changed SQL, BOMs, missing or unknown migrations. It
does not contact a database or change stored checksums. The ordinary packager
does not silently format or accept CRLF. Never use formatting as a reason to
rewrite applied database checksums, bypass the checksum guard or edit historical
migrations; investigate a mismatch with the operator. Future schema changes
require a new reviewed migration and an explicit allowlist update.

The directory importer still executes **only Migration 003**. Later migrations
are accepted solely to verify existing history; import is not schema rollout.

## Prepare a matching candidate pair

Use Node.js 22 and the project's installed dependencies. Windows uses built-in
PowerShell/.NET ZIP APIs; no global zip/unzip installation is required. macOS and
Linux retain the existing zip/unzip requirement. Archive entry names are checked
for traversal, ambiguous paths, duplicates, symlinks/junctions and root escapes.

Obtain the public RDS CA bundle from the link in the
[AWS RDS TLS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
Do not use a private key or copy an `.env` file. Set the path in the current
terminal only:

```powershell
$env:COED_RDS_CA_FILE = 'C:\path\to\verified\global-bundle.pem'
npm.cmd run test:release
npm.cmd run package:v4-candidate
```

The command prints a unique directory under ignored `tmp/release-candidates/`:

- `coed-v4-frontend.zip`: the **contents** of `dist/`, not a wrapping `dist/`
  folder. Runtime configuration is pinned by `build:v4` to the current target.
- `coed-v4-lambda.zip`: bundled API/runner, exact reviewed SQL 001–010, the
  allowlisted verification SQL and the public CA. No checkout, credentials,
  identity maps, Preview data or `node_modules` directory is copied.
- `candidate-manifest.json`: artifact hashes/entries, critical frontend asset
  hashes, raw migration hashes, public CA hash, toolchain, source commit/branch,
  dirty state and a digest of the actual build inputs.

The pair is built from one input snapshot. Source changes during packaging,
missing new form/API markers, an unexpected archive file, a wrong public target
or changed migration bytes fail validation. The manifest is written last.
Tests also execute the newly built Lambda outside the checkout: health is 200,
while anonymous access to V3 session and V4 applications/options is 401, not 404.
This test does not use AWS or an application database.

Candidates are always marked `LOCAL_CANDIDATE_NOT_DEPLOYED` and
`deploymentApproved: false`. A dirty candidate honestly records the base commit
and uncommitted input digest; it is **not** a clean final release. The strict
`prepare-workflow-release.mjs` gate still requires reviewed, committed source and
an external output directory, including on Windows. It defaults generated SQL
to rollback. Nothing here authorizes executing that SQL.

## Verification and cloud handoff

```powershell
npm.cmd run test:lambda
npm.cmd run test:release
npm.cmd run test:dataset
npm.cmd run test:profile
npm.cmd run test:v4-build
npm.cmd run lint
```

The full regression includes `test:release`. Application/PostgreSQL tests must
use only an explicitly isolated loopback test database; do not point tests or
reset scripts at production. Candidate tests use synthetic public CA fixtures,
not production credentials. Only the final operator-prepared candidate should
use the verified AWS CA bundle.

For the PostgreSQL release/import sub-suite, set `NODE_ENV=test` and
`CO_ED_APPLICATION_TEST_DATABASE_URL` to an isolated loopback
`coed_v4_application_test` or `coed_v3_test` database. It creates and removes only
a uniquely named test schema, not a database reset. Without that URL the local
DB sub-suite is explicitly skipped; CI requires the configured target. Do not
report a skipped DB sub-suite as integration evidence.

Before a separately approved cloud release, verify the live migration history,
raw checksums, runtime grants, API integration/alias, private document storage,
actual authenticated Profile error, backup and rollback artifacts. The missing
V4 API in an older Lambda package explains feature unavailability, not every
Profile failure. Do not deploy just the frontend and assume its backend/schema
is ready. Real eligibility remains gated until authoritative academic metadata
and policy are available; Preview success is not a live eligibility decision.

See [Phase 1 rollout](v4-application-preparation.md#rollout-and-recovery) and the
[V4 account baseline](v4-baseline.md). The
[Windows verification record](../evidence/v4-windows-release-packaging.md)
documents executed tests, artifact hashes and remaining live-release gates.
