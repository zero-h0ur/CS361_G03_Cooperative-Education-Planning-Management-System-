# TU production deployment evidence

> Historical P0-P6 stage evidence. The WAITING_OWNER_SMOKE and paused-write statements below describe that stage, not the latest result. Later onboarding/issuer fixes and the restricted intake pilot are summarized in [current deployment](../operations/current-deployment.md) and [verification](../operations/student-intake-verification.md). Do not repeat an old repair or Deploy from this evidence alone.

Date:5November2026, Asia/Bangkok. Scope: approved P0-P6.
Status: WAITING_OWNER_SMOKE. P0-P4 complete; verification-only live routing passed.
Owner/probe temporary capabilities removed. Writes/other API reads remain paused.
First real owner smoke failed; broker public-key config repaired, new smoke pending.
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
  application command has been performed.

## Actual P4 candidate/IAM and privileged cleanup proof

- Existing signing pair was migrated in memory to the dedicated signing Secret;
  fingerprint continuity was checked against the API. Broker now has only provider
  Secret and qualified issuer Invoke access; it has no private key or DB Secret
  in its new environment. No credential value was written to local artifacts.
- Created private coed-tu-session-issuer with exact SELECT-only login/signing
  Secret reads, existing subnet/SG,8second timeout,256MB and reserved concurrency2.
  Read-only inspection found zero Function URLs and zero event source mappings.
  No NAT/new endpoint/EC2/RDS/frontend deploy was introduced.
- Candidate issuer rejected the invalid envelope403. Candidate broker correctly
  returned maintenance503; API rejected anonymous /me401 and blocked a write503.
- Controlled role with identity Invoke permission was AccessDenied for issuer
  unqualified, candidate alias and candidate version1 at2026-11-05T02:35:16+07:00.
  DryRun only, no function execution. Probe role cleanup verified absent.
- Both scoped runtime-error alarms were configured without notification actions.
  They do not detect handled HTTP auth failures; safe-log review remains required.
- Removed exact task-owned owner function/all its versions, role/inline policy,
  log group and its two endpoint statements. Cleanup verifies function/role
  absence; intentional issuer and original endpoint entries remain intact.
- Verification routing succeeded: coed-api:live->2, coed-tu-auth:live->3,
  coed-tu-session-issuer:live->2. Broker malformed-body request400 and issuer
  invalid envelope403 passed before public cutover. Public canonical /me rejects
  anonymous401; TU-proxy application write remains maintenance503.
- Retired only task-created coed-tu-auth maintenance version1 after confirming
  no integration/alias references and clean current broker environment. This
  removed its inherited old sensitive environment. The static safe503 artifact
  remains retained. API maintenance version1 remains non-live; no pre-existing
  historical version was deleted. The owner/probe AWS resources removed above
  cannot be recovered as-is; recreate only through the reviewed source workflow.
- Final read-only report: all three functions Active/Successful, routes and CORS
  unchanged, snapshot available and owner tool removed. Endpoint has its original
  statement plus the exact intentional issuer Secret statement; no owner grants.
  Broker/issuer Lambda runtime Errors0 and safe handled5xx categories empty in
  this observation. This includes maintenance/test traffic and log/metric delay;
  it is NOT proof that real TU Login works or30minute post-resume monitoring.
- Fresh owner-run Login->me->own-profile smoke is required before commands are
  resumed. No real user credentials were requested from chat, reused or tested.
  No ownerSmoke attestation is recorded. API allows only the exact verification
  GETs under normal authentication; other reads and writes remain503.
- Snapshot retention review remains12November2026 at02:05:34 Bangkok, no automatic
  deletion. No frontend deployment or Git push. Final post-smoke monitoring and
  next-usage review remain pending.

## Owner smoke failure and bounded public-verifier repair

- User independently ran the hidden-input smoke and reported HTTP503
  TU_SIGNING_UNAVAILABLE. This was NOT an accepted owner-smoke attestation.
- Read-only paginated safe-log inspection located two broker version3 failures
  at2026-11-05T03:16:02/03:16:44+07:00, stage=request,19ms/0ms. No corresponding
  issuer invocation occurred. Code tracing confirmed getTuPublicKey runs before
  provider verification. Therefore this failure did not test TU credentials,
  canonical identity, private signing Secret or database owner reads.
- Root cause was the deployment controller's broker environment omitting
  TU_AUTH_PUBLIC_KEY. Candidate negative-only tests had not detected the missing
  verifier. No secret/key rotation, identity repair or wider IAM grant was needed.
- Local controller commit d04a09f adds the existing API public verifier through a
  whitelist environment builder, configured=true readiness gates and a bounded
  configuration-only repair with code/env/fingerprint/revision/route guards.
  Actual runtime bundles remain unchanged from44777e8. It also fixes monitoring
  of Lambda Text-prefixed JSON; the earlier empty handled5xx report reflected a
  JSON-only filter limitation, not proof those failures were absent.
- Regression/tooling/smoke/readiness18passed,0failed,0skipped; actual local
  PostgreSQL credential/SELECT-only/retry5passed,0failed,0skipped. Additional
  isolated archive/readiness7passed includes executing the packaged broker's
  default configuration without AWS/credentials. These counts overlap. Lint279
  and docs9passed. Staged secret-pattern scan passed. No Git push.
- The bounded AWS repair updated only broker environment and candidate/live
  aliases to version4, same broker code hash. It copied the existing verified
  API PUBLIC key, not private material, and verified candidate/public configured
  status before/after cutover. Write503 and unchanged routes/CORS passed.
  API live2 and private issuer live2, Secrets, IAM, endpoint, network and database
  were not changed. No new resource or paid resource type was introduced.
- Broker configured=true is configuration readiness only, NOT a real successful
  TU Login or proof of provider-key validity. A new owner-run smoke is required;
  other reads/writes remain in verification maintenance until it passes.
- Post-repair read-only report confirms all functions Active/Successful and
  broker version4, routes/CORS unchanged, owner tool absent and snapshot available.
  Corrected collector sees the two historical TU_SIGNING_UNAVAILABLE events and
  one candidate maintenance event. Runtime Errors0 still does not imply Login
  success. No post-repair user credential test or write resume is recorded.

## Separate identity diagnostic checkpoint

The owner subsequently reported valid-attempt403 TU_ACCOUNT_UNAVAILABLE versus
intentional wrong-password401 INVALID_CREDENTIALS. Safe broker4/issuer2 stages
confirm accepted TU verification reaches the canonical identity check. This is
not a successful application Login or owner attestation.

Under separate N0-N5 approval, the user's hidden-target diagnostic run
production-ux5UIQ invoked private version1 once but failed reading the dedicated
SELECT-only login Secret (DIAG_SECRET_UNAVAILABLE) before a database query. Its
finally cleanup was verified at2026-11-05 04:09:55 Bangkok: no temporary function,
role/log group/endpoint grant remains; application/Gateway/endpoint baselines
unchanged and no database writes. Local tooling now classifies safe Secret error
categories; it does not prove or repair the403 cause. Fresh hidden-target lookup
and then successful owner smoke remain pending. No write resume or frontend
deployment. See [diagnostic evidence](tu-identity-readonly-diagnostic.md).

Subsequently, agent-run production-7rkUnZ/version3 after a fixed5minute endpoint
propagation grace completed a real SELECT-only PostgreSQL lookup for the one
freshly authorized target. UNLINKED_IDENTITY,0exact TU links and0matching student
profiles were confirmed; no existing account/profile was chosen or altered.
Secret read succeeded without changing the exact IAM/endpoint scope. Earlier
denials are consistent with propagation delay, not independently proven to have
that historical cause. Cleanup verified at2026-11-05 09:31:13 Bangkok, all owned
flags false, frozen application/Gateway/endpoint baselines unchanged. Post-run
read-only preflight also passed. No password/provider test, JWT or successful
Login->me->own-profile occurred; ownerSmoke is absent and maintenance still
verification-only. Separate verified onboarding/provisioning approval is needed.

Use the [operator runbook](../operations/tu-production-operator.md).
