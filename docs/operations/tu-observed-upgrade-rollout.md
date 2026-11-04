# Observed018 and split TU auth: next-stage proposal

Status: proposal after read-only capture/local implementation; NOT executed.
Use with [local evidence and hashes](../evidence/tu-present-schema-upgrade.md) and
the existing [split-auth resource/cost runbook](tu-split-auth-rollout.md).
The user grants CO-ED AWS repair access but explicitly requires asking before
uncertain data/identity/downtime actions. The latest baseline choice authorizes
schema capture and local testing, not an unannounced live maintenance window.

## Live changes that still need a coordinated decision

1. Choose a maintenance window for TU login **and application write actions**
   (Student saves/submissions, Coordinator returns/forwards/schedule changes and
   related Committee writes).018 takes short write-blocking locks over the39
   observed tables; do not promise no impact on Coordinator commands. Ordinary
   reads generally remain possible, but lazily mutating GETs are excluded from
   smoke. Establish safe503/maintenance behavior before cutover.
2. Revalidate account/code/schema/history/ACL hashes and capture a manual RDS
   snapshot; wait until available and verify the restoration procedure. Current
   automated backup retention is1day, not a deployment-specific restore proof.
   A snapshot can incur storage cost; agree retention/cleanup before creation.
3. Exact owner credential metadata is available without rotating the password:
   database `database-coed-postgres`, owner `postgres`, existing RDS-managed secret
   `arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx`.
   Only metadata was read. **No secret value read, master reset or credential
   rotation was performed.** Future owner use must be in memory in a reviewed
   private operator tool, not terminal arguments/files/Git or the app runtime.
4. Prepare a separately reviewed temporary owner migration tool/role/log group
   in the existing private subnet/SG. Exact owner-secret GetSecretValue and exact
   additive Secrets endpoint access only; no provider/signing secret access,
   arbitrary SQL, public route, app identity impersonation or general DB console.
   The deleted read-only reader must not silently become a master/writer tool.
   Publish/hash-pin it and restrict invocation to the managed operator role.
5. Run guarded018 rollback trial, then approved atomic schema+ACL Apply once.
   Strict current16-entry history/catalog, source hashes, ownership, effective
   runtime capabilities and preservation checks must pass. On any drift/lock/
   timeout failure rollback and inspect; do not relax gates or rewrite history.
   Only018 is appended; local014/017 and old016 are NOT replayed. No legacy
   submission/identity/grade/eligibility mock data or backfill.
6. Targeted revocation of PUBLIC/`coed_app` EXECUTE on the exact legacy9-text-
   argument provisioning function affects old TU callers. Dependency metadata
   cannot prove the absence of external callers. Coordinate it with replacing
   the old broker/API, not as an isolated grant change during normal use.
7. Provision the reviewed SELECT-only `coed_tu_login` initially NOLOGIN, validate
   all effective privileges, then configure its credential securely for the
   private issuer. No automatic account creation/relink. Owner-link checks use a
   fresh securely supplied test identifier; if absent/ambiguous/disabled, stop
   for a separately reviewed identity decision instead of repairing arbitrary rows.
8. Supply a rotated TU provider key through a secure secret path and decide signing
   key continuity after private/public matching. Do not recover the old exposed key
   or password from chat. Existing code expects matching public metadata. Any
   signing-key change may require Student re-login; Cognito remains a distinct
   authorizer, but write maintenance still applies during DB changes.
9. Create the private issuer/role, exact login/signing/provider secret references,
   scoped endpoint/IAM grants, candidate/live aliases, logs/limits/alarms per the
   split-auth proposal. Update only reviewed API/TU artifacts and the TU Gateway
   integration to the qualified broker alias, timeout15s->25s. Preserve normal
   Cognito authorizer/CORS/storage boundaries. Verify cold/warm/negative IAM and
   fail-closed candidate behavior before public routing.
10. With fresh secure test consent/input, test Login -> `/me` -> owner's read-only
    data. No real submit/return/forward/confirm/relink as smoke. No JWT, password,
    profile or raw provider/SQL exception logs. Monitor controlled5xx/timeouts,
    throttles, DB connections and latency, then the next ordinary usage window.
11. Remove temporary owner tool/version/role/policy/log group and only its endpoint
    statement; verify no other resource drift. Retain approved backup/evidence,
    not master credentials. No Git push or deployment is implicit in local tests.

## Rollback boundary

- Before018 commit: any failed trial/precondition/SQL/ACL/postcondition rolls back
  the whole upgrade and appended history. Lock timeout is a safe stop, not retry
  with wider permissions or a longer production lock without review.
- After commit: keep new tables/audit/history and old unchanged rows; do not drop
  receipt tables, reverse018, restore elevated auto-provisioning or rewrite checksums.
  Roll the app only to an audited strict compatible version, otherwise keep TU
  maintenance. Database restore to a snapshot is a separate incident decision
  with potential loss of post-snapshot writes, not automatic rollback.
- New login-role credentials/secrets/functions may be disabled only after checking
  active dependencies. Preserve the rest of the system and recorded identities.

## Cost and credential prerequisites

No NAT, public RDS, new endpoint, EC2 or provisioned concurrency. Existing
Lambda/Secrets/Logs/alarms estimates in the split-auth runbook are illustrative,
not a spending cap. Recheck regional pricing, snapshot storage/retention, actual
load and exact resolved ARNs at deployment approval. Reuse of the existing managed
owner secret does not require a password reset, but its read/use is still a
privileged separate deployment operation. Never request real passwords in chat.
