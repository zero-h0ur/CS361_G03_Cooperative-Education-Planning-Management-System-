# V4 Windows release packaging — local evidence

Scope: approved offline packaging, tests and candidate artifacts only. No AWS
upload/deployment, live database access/migration, permission change, credential
configuration, commit, push or branch-history rewrite was performed.

## Diagnosis and changes

The supplied Lambda ZIP lacked the Phase 1 application API and Migration 010.
Its SQL 001–009 matched the committed Git LF bytes, while this Windows checkout
had CRLF. These are distinct issues: an old release and a platform-dependent
checksum hazard. The Profile SELECT matched the current source; an actual
authenticated Profile failure remains unverified.

The migration-path LF attribute and shared reviewed-byte preflight now fail
closed for CRLF, edited SQL, BOMs, missing/unknown migrations and nonregular
files. The explicit local formatter validates every hash before writing only
EOL formatting. All migration SQL matches committed bytes; no schema SQL or
stored history was edited. Import still executes only 003 and verifies later
versions without applying them.

Windows ZIP creation/inspection uses built-in PowerShell/.NET with paths passed
as data. Tests cover spaces, quotes, Unicode names, binary bytes, duplicates,
traversal, junction/symlink escapes and refusal to overwrite an archive. The
Lambda archive has an exact file allowlist and packages the exact public CA
bytes that were validated, not a second read of a mutable file.

The new paired-candidate command validates V4 public configuration, current form
version 2 fields, the six-step CSS, API route markers and all raw migration
hashes. It records source commit, dirty state and build-input digest, checks
source stability, and publishes the manifest last. The strict clean-source
final release gate remains, including external-directory checks on Windows.

## Verification

Executed on Windows / Node.js 22.12.0. esbuild commands required execution outside
the filesystem sandbox because the sandbox denied parent-directory resolution;
the same tests then ran without altering application code to bypass that limit.

| Command | Result |
| --- | --- |
| `npm.cmd run test:release` | 25 passed, 0 skipped, including 12 PostgreSQL subtests |
| `npm.cmd run test:lambda` | 37 Jest + 2 packaging tests passed |
| `npm.cmd run test:application` | 18 Node/PG + 48 UI/API tests passed, 0 skipped |
| `npm.cmd run test:profile` | 26 passed |
| `npm.cmd run test:dataset` | 23 passed |
| `npm.cmd run test:frontend` | 342 passed |
| `npm.cmd run test:v4-build` | 1 passed |
| `npm.cmd run lint` | Passed; 81 modules reported by the existing script |
| Explicit Node syntax checks of new packaging helpers | Passed |
| `git diff --check` | Passed |
| `npm.cmd run test:docs` | 8/9; existing Windows symlink fixture fails with EPERM |
| `node scripts/verify-doc-links.mjs` | Published documentation links pass; no network requests |

PostgreSQL verification used only the existing loopback test service on port
55439 and database `coed_v4_application_test`, with uniquely named application
and release-test schemas/roles and synthetic data. There was no database reset
or query against RDS. The new import test accepts correct 001–010 checksums,
rejects a tampered checksum for each version and rejects an unknown migration,
while checking stored history and non-empty private test rows are unchanged.

The full `npm test` chain was **not** run or claimed green: legacy reset-oriented
integration prerequisites were not enabled against an existing developer DB.
The docs symlink failure was not skipped or weakened. Linux/macOS archive
execution and a new GitHub CI run have not been verified here. No live browser,
authenticated student session or production eligibility pass is claimed.

## Prepared candidate

Created `2026-11-01T16:10:33.042Z` in ignored
`tmp/release-candidates/candidate-mRT26u/`. ZIPs are local artifacts, not files
to commit into Git.

- Status: `LOCAL_CANDIDATE_NOT_DEPLOYED`; `deploymentApproved: false`.
- Base commit: `c00f6f0e571b08aa9642524ce3cff609c8849cd9`.
- Branch: `feature/141-phase1-application-preparation`; uncommitted changes are
  honestly recorded as `dirty: true`. Its pushed history was left untouched.
- Build input SHA-256:
  `538f0655223a17fdaff9671d6528787ac2b60e649258d146dffdc6764234fd81`.
- Target: account `130165494095`, region `ap-southeast-2`, Amplify
  `d1bpmj87vmjb96` / `main`, Lambda `coed-api`.

| File | Bytes / entries | SHA-256 |
| --- | --- | --- |
| `coed-v4-frontend.zip` | 4,552,845 / 97 | `ed3eeb6efdd9f936e60a34953a753ba2efef6a54d6430a32a7411a713657f89b` |
| `coed-v4-lambda.zip` | 732,111 / 14 | `c55e10b7f1e5a1d3e99a2fba347278700b2900963fb1695050d451cc7ac2a8b6` |

`candidate-manifest.json` contains the full entry lists, per-migration hashes,
toolchain and critical asset hashes. The frontend ZIP has no `dist/` wrapper.
The runtime configuration hash remains
`12dc27be782d5a338f69ad06cb18466034712f7c819005e8ea6c6a2f65ab95e2`;
the new shell JS hash is
`22d1d308df934a2d7a6b3d5dbe0baa20716a891973bf2916a2304f5cf6f295fb`;
the new shell CSS hash is
`e9247eae3336a77c8a660d46d6e0ae340a84962de0d6769712a478b04a097387`.

The CA was fetched over HTTPS from the public AWS RDS truststore linked by
[AWS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html):
`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`.
It contains 114 public CA certificate blocks, 174,560 bytes, SHA-256
`90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b`.
It contains no private key, and no AWS login/API was used to fetch it.

A final anonymous smoke test executed **this candidate's** Lambda code outside
the checkout, with no project dependencies or application configuration:

| Request | Status |
| --- | --- |
| `/api/health` | 200 |
| `/api/v3/students/me` | 401 `UNAUTHORIZED` |
| `/api/v4/application-options` | 401 `UNAUTHORIZED` |
| `/api/v4/applications` | 401 `UNAUTHORIZED` |

This establishes route registration and anonymous denial, not successful
authenticated data access or a live deployment.

## Next operational gate

Review/commit source with the owner's permission and regenerate a clean final
release. Before any separately approved upload, verify actual live schema
history/checksums, least-privilege grants, API integration/alias, storage,
authenticated Profile error and backup/rollback artifacts. Do not deploy only
the frontend or rewrite database checksums to make a release pass.

See the [local candidate operating guide](../operations/v4-local-release-candidate.md)
and [Phase 1 rollout constraints](../operations/v4-application-preparation.md#rollout-and-recovery).
