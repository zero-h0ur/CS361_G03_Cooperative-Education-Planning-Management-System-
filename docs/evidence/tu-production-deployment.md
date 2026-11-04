# TU production deployment evidence

Date:5November2026, Asia/Bangkok. Scope: approved P0-P6.
Status: local preparation complete; production maintenance/backup/SQL/cutover
not yet started at this checkpoint. This file will be extended with actual
execution, not treat approved steps or local tests as production success.

## Local proof

- Observed-schema upgrade and actual local Student->Coordinator HTTP suite:
  31passed,0failed,0skipped.
- New production tooling, isolated owner/API/maintenance ZIP loading, mocked
  maintenance/integration/snapshot lifecycle, smoke privacy, actual local SCRAM
  credential/SELECT-only/retry/failure behavior:18passed,0failed,0skipped.
- Full npm test with explicit owned localhost databases: exit0, including actual
  Committee PostgreSQL test. Existing release gate32passed,0skipped. Counts
  overlap; do not sum as unique coverage.
- Separate Coordinator27Jest+8PG, schedule24Jest+20node/PG, Auth127Jest+24node
  passed. Runtime Lambda defaults remain normal when maintenance flag is absent.
- Lint and documentation gates passed. No browser visual QA or new UI work.
- Historical15migration bytes/checksums unchanged; new018 is an upgrade-only
  path, not a rewrite or alias of missing original external SQL.
- Schema upgrade commit: bfdb584, local only, not pushed.

## Read-only AWS readiness

Expected account/session confirmed. Provider Secret JSON shape verified in
memory under the user-supplied ARN; no real TU request or upstream key-validity
claim. The user confirmed the unseen replacement key; metadata alone is not
rotation-provenance evidence.

Existing RSA2048 signing pair verifies and matches the API public key/issuer/client,
fingerprint948706ef031812b73af8fdc7002a7ee06cfdbc89b431d1720526ae249abc3958.
Owner Secret metadata is RDS-managed, has no custom KMS key and is not scheduled
for deletion. No owner password was read in this readiness phase.

## Pending live evidence

Record exact committed source/artifact hashes, maintenance times and qualified
versions, snapshot ARN/available state/retention review, trial/Apply proof and
history/preservation, effective SELECT-only login, candidate/IAM denials,
controlled user Login->me->own-profile outcome, cleanup and monitoring.
Keep credentials, token/profile/business data out of this evidence.

Use the [operator runbook](../operations/tu-production-operator.md).
