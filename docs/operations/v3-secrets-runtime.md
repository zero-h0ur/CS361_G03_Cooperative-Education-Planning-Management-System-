# V3 Secrets Manager runtime follow-up (#58 → #82)

## Status

Implementation and automated tests are prepared locally. AWS secret-mode cutover,
runtime IAM/endpoint checks and authenticated smoke evidence remain pending.
The follow-up issue could not be created by the connector (HTTP 403); create a
tracking issue before opening the PR. Do not close #82/#83/#84 based on local tests.

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
- Current limitation before this cutover: Lambda still uses a plaintext
  DATABASE_URL with master `postgres` credentials. The existing application secret
  has the expected PostgreSQL fields and username `coed_app`. After the owner
  explicitly authorized credential repair, the DB account password was aligned
  with the unchanged existing secret through psql `\password`; verified TLS login
  succeeded. The role has no elevated flags, memberships or table ownership.
  The check exposed DELETE on audit_events; the reviewed ACL correction was then
  applied successfully. Effective checks returned read-identity=true,
  insert-and-update-plan=true, append-audit=true, delete-audit=false,
  change-role=false. No table data or secret version was changed by that ACL step.
  Lambda-side retrieval/cutover still needs verification.
- Local verification after adding the ACL integration regression: full `npm test`
  passed 786 tests; frontend build and `git diff --check` passed. The ACL integration
  also verifies that profile edits still work with the users row-lock trigger,
  and that audit deletion, role changes and official-profile writes are denied.

## References

- [node-postgres dynamic passwords](https://node-postgres.com/features/connecting)
- [AWS secret JSON structure](https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_secret_json_structure.html)
- [AWS JavaScript GetSecretValue](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/secrets-manager/command/GetSecretValueCommand/)
- [Lambda RDS TLS requirements](https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html)
