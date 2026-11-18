# B2b isolated test data — scope and evidence

Date: 2026-11-18 (Asia/Bangkok). Source is uncommitted work on
`chore/loadtest-rds-preparation`, base `791ed1e32b96384843847f92c3b8b35959b5d41f`.
This is not a main/API deployment. See [B2a](loadtest-b2a-bootstrap.md) for the
retained schema/runtime setup and [preparation runbook](loadtest-rds-preparation.md)
for workload and monitoring.

## Approved requirement

Only `coed-loadtest-db` / `coed_loadtest`, existing test owner/app Secrets and test
SG may be used. Import Purinat PR178's exact synthetic400-company/800-position
dataset, provision10 synthetic STUDENT profiles with the privately supplied exact
Cognito issuer/subjects and one DRAFT each in a public/mock OPEN legacy cycle
with no end date. This is not Phase1 onboarding, an official academic record,
or a submitted application. No Cognito user/password/token mutations.

One temporary `coed-loadtest-import-b2b` Lambda, its role/log and an additive
exact-principal/two-test-Secrets endpoint statement may exist for at most1h,
then must be removed with residuals reported. No new RDS/Secret/SG, no permanent
grants, no API stack/traffic/load, no commit/push. The newest user instruction
excludes production DB, `coed-api` and production API: **no production GET probe**
is performed. Shared endpoint originals are preserved by metadata comparison,
not by claiming a production smoke test passed.

## Implementation and safeguards

- `scripts/loadtest/b2b-import.mjs`: retained-schema data-only commands, exact
  target/expiry/digest binding, parameterized inserts, transaction/advisory/table
  locks, complete row comparison and unchanged schema/history/ACL/trigger snapshot.
- `b2b-handler.mjs`: TLS-verified fixed test DB connections and memory-only Secret
  reads; never serialize driver errors, credentials or invocation mappings.
- `b2b-runtime-check.mjs`: existing runtime repositories/services, exact identity
  resolution, own plans, OPEN cycle, directory list/detail and ten rollback-only
  PATCH-equivalent service operations with version/receipt/audit and ownership checks.
- `b2b-operator.mjs`: explicit approval flag, fresh test resource ownership and
  exact Cognito test-account metadata checks, current endpoint backup/drift check,
  digest-bound artifact, cleanup and private username/plan-ID handoff. Not a
  scheduler: it reserves cleanup time and rejects expired invocations.
- [Pinned PR178 generator](../../scripts/loadtest/vendor/README.md): unchanged
  upstream source, no unguarded psql/upsert execution or replacement dataset.
- `identity-input.mjs`: provider subjects retain their exact UUID-shaped text
  without imposing internal UUID variant bits. Internal IDs remain separate.

No reset, trigger disable, migration replay, account re-link or foreign-row
overwrite. A changed/nonempty target fails closed. On unknown commit outcome,
retain the checkpoint/records and inspect read-only; do not blindly apply again.
After a successful commit, load-test writes must never be erased to make the
initial fixture verifier pass. The importer is not a reusable fixture reset tool.

## Local verification this turn

- Unit/security/packaging plus existing preparation/B2 regression:60/60 passed,
  zero skips. Includes loading the actual bundled CJS handler and checking the
  ZIP excludes private bindings.
- B2b disposable PostgreSQL18 suite:16/16 passed (9 unit/package,7 DB), zero skips;
  full rollback, retained-schema preservation, exact data, replay/drift refusal,
  ten runtime identities/own plans/PATCHes and denied privileged writes. The
  dedicated cluster was stopped. This is not proof of PG16.15 or real JWT auth.
- Initial restricted-sandbox native PG/esbuild attempts failed with local access
  errors; reruns used permitted local process access. A first runtime check found
  cycle-options SELECT needs `selection_cohorts`; no grant was added. The selected
  workload uses existing Draft PATCH, not the separate cycle-options endpoint.
- The peer generator's CLI top-level await cannot be bundled as CJS. The operator
  instead packages only its exported public dataset, preserving source unchanged.

Local syntax/migration/docs/regression and cloud results are appended separately
below after observation. Prior tests are not relabeled as new AWS acceptance.

Additional local results: original DB12/12 and B2aDB5/5 passed, all clusters
stopped. One original DB run failed with a connection timeout before bootstrap;
its standalone rerun passed without changing timeouts/guards (the exact host
scheduling cause is not established). Final B2b16/16 rerun also passed. Lint369
modules,17 immutable migration checksums and docs9/9 passed; docs checked85
documents/483 local links/170 external URL syntax entries with0 network requests.

## AWS execution evidence

First attempt started at `2026-11-17T21:17:11.711Z` (04:17:11 Thai). Exact ten
test-account Cognito metadata checks passed, current endpoint policy was backed
up, and only the temporary owner allowance/tool was added. Preflight returned a
sanitized `B2B_DATABASE_OR_SECRET_FAILED` before trial/Apply; no data commit was
attempted. Requested Lambda/role/log/owner endpoint cleanup verified, original
policy/SG rules preserved. The generic response did not identify a root cause.

A diagnostic-only retry adds safe stage/error-name codes (never error messages,
SQL, mappings or Secret values) and keeps the ORIGINAL one-hour window. It does
not broaden permissions or reset the deadline. That attempt did not claim success.
Private operator checkpoints bind source/package/input hashes and retain each
attempt independently; original failed evidence is not overwritten.

During cleanup, fresh metadata found teammate-created `coed-api-loadtest` using
the dedicated runtime role (modified21:02UTC) and its in-use managed ENI, alongside
the older available B2a ENI. No teammate function/role/ENI was changed or deleted,
and no API was invoked. This observed existence is not configuration/auth smoke
or proof the teammate API source equals a named commit.

### Committed data and runtime acceptance (third attempt)

The second attempt identified `owner-secret / AccessDeniedException`; both early
attempts cleaned up without trying to commit data. The third attempt started at
`2026-11-17T21:28:08.196Z` within the original window ending22:17:11UTC (05:17:11Thai).
Fresh IAM policy matched exactly and had no permissions boundary. The denied
preflight response identified `VPC_ENDPOINT_POLICY`. Three bounded read-only
preflight retries were followed by success **without changing permissions**;
then trial/rollback, empty-baseline recheck, Apply and Verify all passed on actual
PostgreSQL16.15. Apply ran once, with no automatic retry.

This supports policy propagation timing as the cause of the early denial, rather
than missing grants. [AWS documents delayed endpoint-policy effectiveness](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html).
The fix waits/retries ONLY preflight denied before the DB connection, not SQL,
Apply, unknown commits, SCP/boundary/KMS denials or permanent policy drift.

Verified committed records:400 public/mock catalog companies,800 public/mock
positions,10 ACTIVE STUDENT users,10 complete synthetic Student profiles,10
exact supplied Cognito identity links,one OPEN public/mock legacy cycle with
null end date and10 DRAFT/version1 Plans. Full expected row comparison and the
catalog/history/applied-at/ACL/trigger snapshot stayed unchanged; no migration,
password, role/grant, constraint or trigger changes were applied.

Actual `coed_app` TLS login and existing directory repositories returned400
companies and valid details/positions. Existing identity resolver and Plan service
resolved all10 exact subjects/own Drafts; each PATCH-equivalent service execution
produced version2 plus one matching operation receipt and audit event inside its
transaction, then rolled back. All10 persisted Plans remain DRAFT/version1 with
zero retained smoke operations/audit rows. Cross-Student access and privileged
writes were denied. This is direct service/DB acceptance, **not genuine JWT/Gateway
authentication or a test API HTTP request**. No production API was invoked.

Deployed temporary ZIP SHA256:
`40c51ec49793dcc7eb044f813a9c40155c2ed78794e769e9c76fcfba78d20e0e`.
Public dataset/history payload SHA256:
`50a748d8f12a7612dfc98d9b9591c286378ae059bc67bd6aa515b75a2210d95d`.
Canonical pre-existing endpoint policy SHA256:
`193a58622fcb38c7fd43cac757b143cbb8c30b872f3c2a8437180273b5bb8269`.
These bind uncommitted source/artifact evidence, not a new Git commit. Exact source
hashes, private input hash and original failed attempts are retained separately
under ignored `tmp/loadtest/`; no raw private mappings are published here.

Additional unit/security/package run after retry hardening:62/62 passed,0 skips
(B2b11 + B2a11 + existing preparation40). Earlier B2b DB16/16 remains separately
dated local evidence; it is not relabeled as18 tests after adding2 unit cases.
### Cleanup completed and independently rechecked

`B2B_COMPLETE` at **`2026-11-17T21:32:59.102Z`** (18Nov **04:32:59Thai**),
**947seconds /15m47s** from the ORIGINAL first-attempt window start, not a reset
counter for the successful retry. The operator verified removal of the temporary
Lambda, IAM role/inline policy, log group and owner endpoint statement; it denied
all Secret reads on the role before deleting it. All original endpoint statements
and SG rules were preserved. No new RDS/Secret/SG or permanent grant was added.

A separate read-only metadata verification snapshot at21:33:28UTC confirmed all
four requested removals, original policy/SG preservation, private available test
RDS, retained app Secret and correct10-row private Plan map. It read no Secret
values, ran no SQL, invoked no API and changed no AWS resource.

Intentionally retained: test RDS/schema/synthetic data/limited `coed_app`, B1's
two SGs, RDS-managed test owner Secret, test app Secret, B2a's two HTTPS SG rules
and app-only runtime endpoint statement. These continue to incur normal usage
costs until approved teardown; a review tag is not an automatic deletion timer.

Residual network inventory (not deleted): an older B2a managed ENI was
**available**; another ENI named for teammate `coed-api-loadtest` was **in-use**.
The teammate's function/runtime role/API and any other teammate stack resources
were not deployed/changed/deleted by this task. No force-detach or shared endpoint,
VPC/pool deletion. Capability cleanup does not claim every ENI has disappeared.

Private handoff directory: `tmp/loadtest/b2b-buYqsM/` contains `handoff.json`,
`username-plan-map.csv`/JSON, `state.json`, original endpoint backup and independent
`resumption-verification.json`. These are ignored/local-only and must be shared
explicitly through the team channel, not assumed to exist in a teammate clone.
Historical failed attempts remain separately under ignored checkpoints.

No commit/push or production deployment snapshot update. Final syntax lint369
modules and docs9/9 passed again; immutable17 migrations were verified unchanged.

## Handoff and remaining stages

Private `username-plan-map.csv`/JSON is generated only after committed data and
runtime verification. Share through the team channel, not Git/PR evidence. It
contains username, Plan UUID, cycle UUID, DRAFT status and version, not subjects
or credentials. Keep the Secret ARN/DB/SG metadata handoff alongside it.
Status/version in this file describe initial preparation only. Before PATCH,
GET the account's own Plan and use its current `expected_version` with a fresh
operation UUID; never keep reusing version1 or count409 as a committed write.

Still separate: teammate test API deployment/maintenance configuration, genuine
Cognito JWT smoke, Locust measured write/conflict ratio and bounded load, CloudWatch
and credits checks, individual Academy lab, and approved exact-target end-of-class
cleanup. The selected three-endpoint grants do not include cycle-options queries
through `selection_cohorts`; no extra endpoint acceptance is claimed.
