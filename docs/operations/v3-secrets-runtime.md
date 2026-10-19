# V3 Secrets Manager runtime follow-up (#58 → #82)

## Status

Implementation is pushed at `ca71916`. Owner-provided CloudShell results confirm
the AWS secret-mode cutover on 2026-10-19: public database-backed API 200, health
200, unauthenticated V3 401, and DATABASE_URL absent from the current configuration.
After cutover, the owner confirmed both authenticated Student profile and draft
edits persist after refresh. The Secrets Manager runtime smoke is successful;
broader multi-role security and release acceptance checks remain separate.
The follow-up issue could not be created by the connector (HTTP 403); create a
tracking issue before opening the PR. Do not close #82/#83/#84 from this partial
deployment evidence; their remaining acceptance/security checks still apply.

Dependency audit on 2026-10-19 reports 19 moderate findings in the Jest development
toolchain (including js-yaml/argparse/sprintf-js), no high/critical findings. These
test dependencies are not in the Lambda ZIP. No unrelated `audit fix` was applied;
track their remediation separately rather than claiming a clean dependency audit.

PR #112 was merged before this work. The branch includes the Lambda packager
prepared during its AWS preview; this is operational work, not a change to #112.

## Runtime contract

- Node.js >=20 for the pinned AWS SDK; deployed Lambda is Node.js 22.x.
- Set `DB_SECRET_ARN` to one exact, full Secrets Manager ARN. Runtime requests only
  `GetSecretValue` with `VersionStage=AWSCURRENT`, using the execution role's default
  credential chain. No static AWS credentials or custom public proxy are needed.
- Set non-secret `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_SSL_CA_FILE`.
  Production uses `coed_app`, not `postgres`. Remove `DATABASE_URL` and accidental
  `Key`/`Value` environment entries at cutover while preserving existing auth values.
- Secret JSON fields: `engine=postgres`, `host`, `port`, `dbname`, `username`,
  `password`. Its endpoint, database, port and username must exactly match the
  reviewed non-secret configuration. Password is passed via pg's async password
  callback, never assembled into an environment URL or written to disk.
- TLS is mandatory in secret mode (`rejectUnauthorized: true`) with the packaged
  public RDS CA. Secret contents cannot disable TLS or override connection options.
- A password is cached only in process memory for at most five minutes. Concurrent
  lookups share one request. Retrieval has a 2.5-second deadline and at most two SDK
  attempts within it. Expired cache is never used after a failed refresh; a later
  connection can retry. Existing authenticated pool connections remain usable.
  Credential rotation is controlled operational work; this does not provision an
  automatic rotation Lambda. Allow up to five minutes for cached credentials to
  expire or recycle execution environments after a controlled credential update.
- Secret ARN configured but retrieval/format validation fails: no fallback to
  `DATABASE_URL` or pg environment passwords. Errors are sanitized. Idle-pool error
  objects are not logged because PostgreSQL diagnostics can contain private data.
- Without `DB_SECRET_ARN`, the legacy URL mode remains available for local use and
  staged deployment rollback. `NODE_ENV=test` always requires a distinct
  `TEST_DATABASE_URL` and never fetches a production secret.

## Least privilege and network review

- Runtime needs only `secretsmanager:GetSecretValue` on the exact application
  secret ARN. Add `kms:Decrypt` only if a customer-managed KMS key actually requires
  it, scoped to that key and Secrets Manager usage. Runtime does not call
  `ListSecrets`, `DescribeSecret`, `PutSecretValue` or rotation APIs.
- Keep the existing Secrets Manager interface endpoint private and allow HTTPS
  from the Lambda security group. Endpoint policy and identity policy both matter.
- The RDS role must have LOGIN, no SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS,
  and no privileged role membership. It must not own application tables.
- Required privileges: schema USAGE; SELECT on public directory and V3 tables;
  INSERT/UPDATE on plans; UPDATE(preferred_name,version,updated_at) on students;
  UPDATE(updated_at) on users only to permit migration 002's trigger to take a
  `SELECT FOR UPDATE` row lock during Student profile updates; INSERT on
  plan_operations/audit_events. No DELETE or mutation of roles/account status,
  identity links/assignments/scopes is allowed. Protection triggers remain.
- Apply `src/db/operations/v3-runtime-grants.sql` as table owner, not the runtime
  role. It resets only this role's grants on the twelve named application tables,
  checks dangerous effective privileges and rolls back on failure. It does not
  revoke PUBLIC privileges, use CASCADE, change passwords or touch table data.
- Learner Lab's shared LabRole may prevent attaching a dedicated least-privilege
  policy. Record the real limitation; do not claim the whole role is least-privilege
  just because the application's SDK request uses one ARN. Do not widen endpoint
  or role policies merely to bypass an AccessDenied error.

## Packaging and verification

Download the public CA only from the AWS trust store, outside the checkout:

```sh
curl -fSsL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /absolute/temporary/path/global-bundle.pem
COED_RDS_CA_FILE=/absolute/temporary/path/global-bundle.pem npm run package:lambda
npm run test:lambda
npm run test:runtime-grants # requires the isolated PostgreSQL test environment
npm run build
```

The packager validates that the CA input contains only public CA certificates. The
ZIP allowlist is `src/` plus `global-bundle.pem` at its root. Migrations and their
verification SQL are copied byte-for-byte; no .env, checkout, fixtures, test payloads
or credentials are included. It bundles the AWS SDK so the deployment does not
depend on the runtime's SDK version. Hash and inspect the artifact before upload.

Run the full regression against a newly created isolated PostgreSQL test database,
never against RDS. Before cutting over, verify the existing secret credential can
connect as `coed_app` without exposing its value, and check effective privileges.

## Deployment and rollback gate

1. Record an available RDS snapshot and the current healthy Lambda code/config.
   Record a rollback version of the **current healthy V3 runtime**, not just the
   original pre-V3 version. Keep credential-containing backups private.
2. Confirm artifact hash, CA contents, secret schema, database login, IAM and
   endpoint connectivity. Do not seed/reset/rotate existing credentials to test.
3. Deploy code while retaining the working URL-mode configuration; verify public
   API behavior. Then set the secret ARN/non-secret DB options and remove plaintext
   URL credentials in one configuration update, with a RevisionId guard.
4. Set DB connection timeout longer than the secret-fetch deadline (e.g. 8 seconds)
   and Lambda timeout sufficiently long (e.g. 15 seconds). Keep pool limits small.
5. Verify health 200, public companies 200, unauthenticated V3 401, hostile-origin
   CORS rejection, and real Cognito Student profile/create/edit/conflict behavior.
   Verify function configuration contains the ARN but no DATABASE_URL/password.
6. If cutover fails, preserve sanitized evidence and restore the previous reviewed
   V3 configuration/code from the rollback version. Do not grant broad IAM rights,
   disable TLS, return to master DB credentials as a permanent fix or undo schema.
7. Immutable rollback versions retain their historical credential-containing
   configuration. Restrict access and plan their retirement after acceptance;
   absence of DATABASE_URL in the current configuration is not a claim that all
   historical versions/backups are credential-free. Do not delete checkpoints
   before the owner approves their retirement.

## Existing AWS preview evidence (2026-10-19)

- RDS snapshot `coed-before-v3-20261019` was available before migration.
- Migration 002 and all 12 verification checks passed. V2 counts were preserved:
  companies 12, positions 18, rounds 3, document_metadata 8, students 5, plans 7.
- Subsequently added one explicitly synthetic linked Student and one public mock
  OPEN preview round, with provisioning audit events; no legacy rounds reopened.
- Healthy CA-inclusive V3 preview artifact SHA256:
  `b8d9db5f293e2f86f1991210e8aa27219814c319b810040bc4a97590cee08604`.
- Public companies 200; unauthenticated V3 401; preview-origin preflight 204 with
  exact CORS origin/method/header values. Original public GET route preserved.
- Student login, profile, create/edit draft, persistence, dependent selectors,
  two-tab conflict/reload and responsive correction were reviewed for PR #112.
- Previous limitation before this cutover: Lambda used a plaintext
  DATABASE_URL with master `postgres` credentials. The existing application secret
  has the expected PostgreSQL fields and username `coed_app`. After the owner
  explicitly authorized credential repair, the DB account password was aligned
  with the unchanged existing secret through psql `\password`; verified TLS login
  succeeded. The role has no elevated flags, memberships or table ownership.
  The check exposed DELETE on audit_events; the reviewed ACL correction was then
  applied successfully. Effective checks returned read-identity=true,
  insert-and-update-plan=true, append-audit=true, delete-audit=false,
  change-role=false. No table data or secret version was changed by that ACL step.
  This credential repair did not change the existing secret version.
- Pre-cutover owner-provided AWS checks: IAM simulation for LabRole permits
  `secretsmanager:GetSecretValue` on the exact application secret. DescribeSecret
  returned no custom KmsKeyId. Interface endpoint `vpce-09a6326385357ca65` is
  available with private DNS enabled; its policy permits GetSecretValue and
  DescribeSecret only for the application secret ARN. Its security group is
  `sg-0ae66580f58e02866`. Owner-provided SG results confirm inbound TCP 443 from
  Lambda SG `sg-0da316295f533eeef`; Lambda outbound traffic is permitted. IAM
  simulation does not prove least-privilege of the entire shared LabRole.
- Prepared artifact from pushed commit `ca7191652ca964c6f7959699fdec21e13c1151b2`:
  SHA256 `8f0e8aa2eb66a5ade4bdf61422be67406d1b4d0c376e97e421a94207cfbf38a2`,
  636575 bytes, including the root RDS CA. Package inspection, 38 focused tests
  and frontend build passed.
- Stage 1 owner-provided output: published healthy V3 rollback version **2**,
  deployed the new code with unchanged URL-mode settings, verified AWS code hash
  `jw6Koutmpa3kvfYUIr5nQG0bTQw3bpfkIalCB8+/OKI=`, and received health/public/
  unauthenticated protected responses 200/200/401.
- Stage 2 owner-provided output: configuration update completed; exact expected
  environment and code hash checks passed. DB user is `coed_app`, secret ARN is
  configured, TLS uses the packaged CA, DB connect timeout is 8000 ms and Lambda
  timeout is 15 s. DATABASE_URL and accidental Key/Value entries were removed from
  the current environment. The first post-update database-backed request returned
  200, providing live retrieval/login evidence; health and unauthenticated V3 were
  200/401. No automatic rollback was needed. The script did not rotate credentials
  or change database data.
- Post-cutover authenticated browser smoke: owner confirmed both requested checks
  passed using the synthetic PR73 Student. Preferred Name save/refresh and existing
  DRAFT note edit/save/refresh both persisted. This exercises the restricted
  students/users-trigger row-lock privileges and plan/audit write path under
  `coed_app`. No Plan submission was requested or inferred from these checks.
- Local verification after adding the ACL integration regression: full `npm test`
  passed 786 tests; frontend build and `git diff --check` passed. The ACL integration
  also verifies that profile edits still work with the users row-lock trigger,
  and that audit deletion, role changes and official-profile writes are denied.

## Independent post-cutover HTTP checks

Executed against `https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com` on
2026-10-19, approximately 20:35 Asia/Bangkok, with the `ca71916` artifact above.
These nine checks passed without credentials or database mutations:

| Check | Result |
| --- | --- |
| GET /api/health | 200 |
| GET /api/companies?pageSize=1 | 200 |
| GET /api/companies?page=0 | 400 |
| Anonymous GET /api/v3/me | 401 |
| Anonymous GET /api/v3/students/me | 401 |
| Anonymous GET /api/v3/plans | 401 |
| Preview-origin PATCH preflight | 204; exact allowed origin; PATCH, authorization and content-type permitted |
| Untrusted-origin PATCH preflight | 204; no Access-Control-Allow-Origin |
| Untrusted-origin public companies request | 200; no Access-Control-Allow-Origin |

A 204 without Access-Control-Allow-Origin rejects browser cross-origin access;
it is not an authentication failure. Public directory HTTP 200 remains intended.
These checks do not substitute for deployed Staff/Advisor/ownership smoke, sampled
log review, main-frontend configuration, or final acceptance under #82–#84.
GitHub still lists #74 and #81 open; #82's documented dependency gate remains.
The branch push alone does not trigger this repository's V3 workflow: it runs on
pull requests, main pushes or manual dispatch. Open the follow-up PR and verify CI
on its exact head before merging; local tests are not a substitute for that run.

## References

- [node-postgres dynamic passwords](https://node-postgres.com/features/connecting)
- [AWS secret JSON structure](https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_secret_json_structure.html)
- [AWS JavaScript GetSecretValue](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/secrets-manager/command/GetSecretValueCommand/)
- [Lambda RDS TLS requirements](https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html)
