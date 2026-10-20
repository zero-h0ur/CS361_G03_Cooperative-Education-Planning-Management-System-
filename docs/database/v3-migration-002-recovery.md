# V3 migration 002 deployment and recovery

This runbook covers `002_v3_identity_student_plan_assignment_audit.sql` from
Issue #56. The migration is forward-only: do not edit an applied migration and
do not reset or delete V1/V2 data to recover from a deployment failure.

## Preconditions

- Take an RDS snapshot or confirm the approved restore point before deployment.
- Confirm the deployment role can run `CREATE EXTENSION IF NOT EXISTS
  btree_gist`. The migration deliberately fails closed if this extension is not
  available.
- Confirm the decisions in Issues #48-#54 are accepted and published. In
  particular, `students.department` is a distinct Admin/Ops-owned field and V3
  uses `plans.cycle_id` while retaining `round_id` only for V2 compatibility.
- Use the same immutable migration files that were reviewed. The runner checks
  each applied file with SHA-256 and stops if it detects drift.
- Do not run the destructive development/test seed against a deployed database.

## Deployment

Run the migration through the repository migration runner:

```bash
npm run migrate
```

The runner starts one transaction, obtains a PostgreSQL transaction-level
advisory lock, validates/backfills the legacy `001` checksum, applies pending
migrations, records their checksums, and commits. Concurrent runners wait for
the same lock and re-read the committed migration state.

After it commits, run the read-only verification script:

```bash
psql 'host=<approved-rds-host> port=5432 dbname=<approved-database> user=<migration-user> sslmode=verify-full sslrootcert=<absolute-rds-ca-path> connect_timeout=10' \
  -X -W -v ON_ERROR_STOP=1 -P pager=off \
  -f src/db/verification/002_v3_forward_only_verification.sql
```

Replace the non-secret placeholders with the reviewed target and public CA path.
Enter the database password at the hidden prompt rather than passing a
credential-bearing DATABASE_URL as a command argument.
See the [operating guide](../operations/v3-operating-guide.md) for environment
configuration and migration-account requirements.

Every verification row must return `passed = true`. The script reports only
object metadata and aggregate counts; it does not print identity or Student
profile values.

## Automatic rollback before commit

Any SQL, extension, constraint, checksum, or verification-of-baseline error
during `npm run migrate` causes the transaction to roll back. After identifying
the prerequisite or configuration problem, rerun the unchanged migration.

Do not manually insert a `schema_migrations` row and do not disable checksum
validation.

## Recovery after commit

There is no down migration. If a defect is found after commit:

1. Stop the affected deployment path while keeping public V2 reads available
   when safe.
2. Record the failure and the database restore point without copying private
   values into an Issue, PR, or application log.
3. Prefer a new numbered forward-fix migration that preserves existing IDs,
   rows, relationships, and audit history.
4. Review and approve the forward-fix before deployment, then run the same
   verification process.
5. Restore the approved snapshot only for a severe failure where a forward-fix
   cannot safely recover service. Coordinate the restore through the authorized
   operational process and rerun all committed migrations afterward.

Never modify `001` or `002` after they have been applied. A checksum mismatch is
an incident to investigate, not a condition to bypass.

## Immutable audit correction

`audit_events` has a database trigger that rejects every `UPDATE` and `DELETE`.
The application has no bypass flag. If an exceptional correction is legally and
operationally approved, implement it as a new reviewed forward-fix migration
that explicitly handles the trigger and records the reason. Do not expose an
API, session variable, or ordinary database operation that bypasses the trigger.

## Legacy compatibility

- Existing Student rows remain unlinked; V3 identity/profile columns stay
  `NULL`. No identity or official profile value is inferred.
- A linked V3 Student must reference an Internal User whose role is `STUDENT`.
  Database triggers also reject changing that linked User to another role.
- Existing Plans retain their IDs and relationships, use `status = DRAFT` and
  `version = 1`, and backfill `cycle_id` only from a non-null `round_id`.
- An existing Plan without a round keeps `cycle_id = NULL` and is marked
  `legacy_compatibility = TRUE`. It cannot become a valid submitted V3 Plan
  until Cycle, Company, and Position satisfy the accepted Plan contract.
- Normal inserts cannot set `legacy_compatibility = TRUE`, and a V3 Plan cannot
  be converted into a legacy-compatible Plan. Hard deletion is rejected; use
  the `CANCELLED` workflow state so Plan and audit history remain available.
- Existing rounds are backfilled to `CLOSED` because V2 did not contain an
  approved operational state. An authorized operator must validate a round
  before explicitly opening it.
- Issue #60 owns deterministic V3 synthetic fixtures; this migration creates no
  fixture identity, Student profile, assignment, or audit data.
