# Student intake readiness: approved A0 only

This is a temporary operator diagnostic, not a migration or application deployer.
L1-L6 and A0 were approved November5,2026. No push, main-service deployment,
production SQL/data change or business-write reopening is included.

`scripts/operations/intake-readiness/operator.mjs` binds account130165494095,
ap-southeast-2, API live4/broker5/issuer4 and browse maintenance. It refuses a
dirty/uncommitted source, unexpected live baseline or resource-name collision.
Its reviewed ZIP contains only a fixed reader and public RDS certificate bundle.

The temporary private Lambda has a numeric-version/operator-only invocation,
one-hour entry expiry and reserved concurrency1. Its temporary role can read only
the existing app DB Secret, emit its own sanitized log and perform infrastructure
ENI setup (denied to function code). The existing Secrets endpoint receives one
exact principal/Secret allow statement, with propagation time and drift checks.
No provider/signing/registration/owner Secret, public URL, event source, S3 access,
new database grant or new standing service is used.

The existing coed_app credential is NOT a SELECT-only role. The tool constrains
it with fixed SELECT/catalog queries and a verified READ ONLY repeatable-read
transaction, startup read-only defaults and timeouts. It returns schema metadata,
rounds/windows and cohort/policy readiness, not student/guardian/grade/file rows,
staff names, identities or credentials. Coordinator link presence is not proof
of live Cognito Login, a real assignment or approval to use a mock round.

## Local verification

Use only a disposable localhost PostgreSQL16 instance on15440 with database
`coed`, `NODE_ENV=test`, `INTAKE_DISPOSABLE=true` and
`INTAKE_READINESS_TEST_DATABASE_URL` pointing at that instance. The DB test adapts
fixed schema names into its random owned schema and removes only that schema.
Never supply RDS or a real application database. Run:

```text
npm.cmd run test:intake-readiness
npm.cmd run lint
```

Initial local result:11 checks passed, including actual PostgreSQL read-only
inventory and denied INSERT; no skips. An unavailable secondary Windows port was
not bypassed by changing the firewall or using production. Test-fixture checksum
field naming was corrected before the passing run; historical SQL was unchanged.

## Approved operator use

After committing/reviewing the tool and checking the ZIP dependency manifest:

```text
node scripts/operations/intake-readiness/operator.mjs run <public-ca-bundle-path> --approved-a0
```

Checkpoints and sanitized catalog results stay in the ignored
`tmp/tu-production/production-*/state.json`. No credentials are persisted. The
controller always attempts cleanup, then verifies its function/role/log/endpoint
statement are absent and standing services/configuration are unchanged. A Ctrl+C
request is handled at command boundaries and enters cleanup. After interruption
or cleanup failure, inspect the checkpoint first and resume only cleanup:

```text
node scripts/operations/intake-readiness/operator.mjs cleanup <state-path> --approved-a0
```

Do not run an old migration/provisioning tool or recreate capabilities to recover
results. A failed read is a stop, not permission to widen Secret/database grants.
Live schema changes, approved real cycle/recipient routing, pilot activation and
paired main-service deployment require a subsequent exact SQL/cost/rollback
proposal. A completed diagnostic is not a successful Student submission.
