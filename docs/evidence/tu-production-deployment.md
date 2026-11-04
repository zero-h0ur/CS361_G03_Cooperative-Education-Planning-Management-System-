# TU production deployment evidence

Date:5November2026, Asia/Bangkok. Scope: approved P0-P6.
Status: P0-P3 complete; production maintenance active and snapshot available.
Renewed AWS operator session verified; P4 candidate preparation in progress.
This is not a claim of successful production Login or completed cutover.

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

## Actual maintenance and backup checkpoint

- Runtime artifact source: clean committed44777e8c622ece77250740b8156218dda18d8a9d.
  Local-only source commits also include bfdb584,7892697,7d19ece,b4f3fc0.
  Controller-only fixes958ab2a/76a51e1 retain those exact runtime artifacts. No push.
- Ignored checkpoint: tmp/tu-production/production-ehWrZm/state.json.
- SHA256: owner558edaf03f1772dbe6e867886072a1e4a79fd6e93dae2f8d582b5878595b3d21;
  APIc05d0f727e946677d990f45d407a3acc04e23997bc0583fe4c7a383431cd0939;
  maintenanceb4689ccaf920a306edffc9776f3d6b846b82e2fa86124dabf0a4d73d25c3b29c;
  broker31dc71e528ad1d60da146c7cf0d05e7449b0257e264457503e8818ed2dd59dbb;
  issuer8917b2cbf110422b6e8c06c5a53b40ea78afbeca944b510802caf563b20b0c1a.
- Maintenance started5November2026 at02:01:48 Bangkok. Both coed-api and
  coed-tu-auth have task-created maintenance version1. Integrations ip14y62 and
  sr47ns9 target those qualified versions; TU integration timeout25seconds.
- Initial anonymous canonical /api/v3/me check stopped at expected Gateway401.
  No authorizer was changed. The corrected controller confirms503 plus
  COED_MAINTENANCE on the existing TU-proxy /me and TU status paths. Ordinary
  Cognito Gateway authorization remains unchanged.
- One private encrypted manual snapshot is available:
  arn:aws:rds:ap-southeast-2:130165494095:snapshot:coed-pre-tu-018-20261105-f2ca1f7a.
  Retention review after12November2026 at02:05:34 Bangkok. No automatic expiration,
  snapshot deletion or actual restore test is claimed.
- The first login-secret command returned AWS ExpiredToken from the operator
  session. Checkpoint proves no login Secret created, owned resources empty,
  owner invocation count0, ownerApplied=false, loginReady=false. No owner
  password read, owner tool/role/logs/endpoint grant, SQL, credential provisioning
  or historical/identity/application row change occurred in P3.
- The user subsequently renewed coed-v4. Correct account/operator, qualified
  maintenance integrations/503s and the same available snapshot were reverified;
  no duplicate snapshot was created. API/TU maintenance remains ACTIVE.

## Actual P3 upgrade and credential proof

- Created the task-owned temporary owner function/role/log group and two exact
  additive endpoint grants. Initial creation stopped before invocation because
  AWS serialized a singleton condition list as a scalar. Live policy inspection
  confirmed identical values. Controller-only fix cad4849 accepts scalar/list
  equivalence only in the three expected IAM string-list fields and still rejects
  added principals, wildcards, changed conditions/effect and extra statements.
  Regression/package/smoke tests14passed,0failed,0skipped; lint278passed.
  See [IAM policy grammar](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_grammar.html).
  Frozen runtime artifact hashes/source were not changed by this controller fix.
- Owner published trial version1 passed the actual observed schema/history,
  postconditions and preservation checks; all trial changes were rolled back.
- Owner published Apply version2 committed only018 and reviewed targeted ACL.
  applied=true, preservationVerified=true; post-catalog SHA256
  d916231f32114e668fb5b7720e8739833716f5d21c3653001974a60e39e63b0a.
  Historical migration entries and old business/identity rows were preserved.
- The dedicated coed_tu_login contract was verified on the actual database and
  loginConnectionVerified=true. Random password was generated only inside the
  private tool, stored in the dedicated Secret; only its SCRAM verifier was sent
  to PostgreSQL. No credential value was printed or written to local artifacts.
- No user TU Login, identity repair/relink, historical receipt backfill or
  application command has been performed. P4/P5 and owner-tool cleanup pending.

Use the [operator runbook](../operations/tu-production-operator.md).
