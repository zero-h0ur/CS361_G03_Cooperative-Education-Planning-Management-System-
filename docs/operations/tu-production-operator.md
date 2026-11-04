# TU production operator

This is an explicit operator workflow, not an automatic deploy on checkout/CI.
The owner approved P0-P6 on5November2026. Target only account130165494095,
ap-southeast-2. Preserve old migration history, application rows, snapshots and
identity links. Never run the normal fresh migrator against the observed external
history. See [observed upgrade](tu-observed-upgrade-rollout.md).

## Local checks and artifacts

The test:production-tooling command exercises the fixed owner envelope, safe503,
additive endpoint/IAM boundaries, isolated ZIP loading, mocked routing/checkpoints,
and the privacy-safe Login smoke. Its real PostgreSQL credential test requires
explicit NODE_ENV=test, PRESENT_SCHEMA_DISPOSABLE=true and
OWNER_TOOL_TEST_DATABASE_URL pointing only to127.0.0.1:55440/coed in an empty,
task-owned disposable server. It creates only synthetic fixture tables/role,
tests actual SCRAM login/SELECT-only denial and cleans them. A skipped DB test is
not equivalent to this proof.

Candidate checks must include GET TU status returning configured=true, not just
negative login/envelope tests. Broker needs TU_AUTH_PUBLIC_KEY (public verifier),
never private signing/DB capabilities. The shared broker environment builder
copies only that public key and approved broker settings from the checked API.

Build with:

    node scripts/operations/tu-production/deploy.mjs build

The output identifies a unique ignored state file under tmp/tu-production. Owner,
API, broker, issuer, CA and maintenance artifact hashes are pinned there. Only
the observed owner package contains018/ACL and reviewed login-role SQL. No
credential values enter Git, ZIPs, CLI arguments or the state file. Maintenance
is not started by build. Live maintain requires unchanged committed HEAD and a
clean worktree, then exact original app/network/integration baselines.

## Execution order

Use the same generated state path for each command:

    $taskState = '<exact state.json path returned by build>'
    node scripts/operations/tu-production/deploy.mjs maintain $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs snapshot $taskState --approved-p0-p6

Announce maintenance first. Static maintenance code returns503/no-store/retry
before application execution. Both integrations are pinned to published
maintenance versions so subsequent candidate updates cannot receive live traffic.
Do not continue on drift or a partially completed routing step without inspecting
the state. Snapshot can briefly pause DB I/O, including ordinary reads. Repeat
only the snapshot status command while it is creating; it does not create a
second snapshot. Proceed only when available. Snapshot review is at least7days;
there is no automatic deletion or tested restore claim.

    node scripts/operations/tu-production/deploy.mjs login-secret $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-deploy $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-activate $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-trial $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-enable-apply $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-apply $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-login $taskState --approved-p0-p6

The owner tool is a separate temporary capability, not the read-only diagnostic.
It has fixed modes only, immutable published versions, bounded expiry/deadlines,
operator-only resource Deny, one connection and exact Secrets/ENI/log permissions.
Only the fixed existing RDS-managed owner Secret and dedicated login Secret are
accessible. A failed trial must not authorize Apply.018 checks live catalog/history,
preserves old rows internally and commits its DDL/ACL/history atomically.
Credential generation stores a random password only in AWS/in memory and sends a
SCRAM verifier, not plaintext, in ALTER ROLE. Failed Secret creation cannot enable
a login; retry uses the same operation-owned version without rotating an existing
enabled credential. No account/profile/link is provisioned or repaired.

    node scripts/operations/tu-production/deploy.mjs stage-applications $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs candidate-checks $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs iam-negative $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs alarms $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs owner-cleanup $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs route-verification $taskState --approved-p0-p6
    node scripts/operations/tu-production/deploy.mjs retire-tu-maintenance $taskState --approved-p0-p6

Signing continuity is checked before its private material is migrated in memory
to a separate Secret. Broker gets no DB/signing capability; the private issuer
gets no TU credentials or public endpoint. The probe role is operator-assumed
only in memory and attempts only DryRun, never real function execution. Its
identity policy allows this issuer, so AccessDenied establishes the resource
Deny rather than merely demonstrating missing identity permission. Probe rights
are removed in finally; owner cleanup preserves the issuer's intentional endpoint
entry and all original entries.

The exact task-created TU maintenance version inherited its old environment
before signing migration. After routing to the clean live broker, verify it has
no alias/integration references and retire only that version. This removes the
task-created copy of old sensitive configuration; no pre-existing version is
deleted. The clean static503 artifact remains available for a new safe maintenance
version. This is not a blanket claim about historical versions owned by others.

## Owner Login checkpoint and resume

After routing verification, commands remain paused. Only exact GET /api/v3/me,
/api/v3/students/me and corresponding TU-proxy forms are allowed; queries,
mutating methods, other paths and lazy-write GETs remain503. Authentication and
ownership checks still run on those reads.

The user can run locally:

    node scripts/operations/tu-production/smoke.mjs

Both inputs are hidden and cannot be passed as command-line arguments. It uses
the fixed HTTPS API origin, POST Login and two owner-only GETs; no write/confirm/
relink, token, profile or identifier output/file. Share only the resulting status
and safe error code. A missing/disabled/ambiguous canonical link stops rollout;
do not bypass it, invent another student or use passwords from old chat.

If the owner smoke reports TU_SIGNING_UNAVAILABLE at broker stage=request and
inspection proves only TU_AUTH_PUBLIC_KEY was omitted, the bounded configuration
repair is:

    node scripts/operations/tu-production/deploy.mjs repair-broker-public-key $taskState --approved-p0-p6

It requires committed clean controller source, pinned API/broker code, the same
public-key fingerprint, existing live integrations and verification maintenance.
Only broker environment and its candidate/live aliases change. It verifies
configured status in the candidate before moving live, then checks public status
and continued write503. It does not change Secrets/IAM/DB/network/API code, test
any Student credentials or attest success. A new owner smoke is still required.

Only after a fresh owner report of OWNER_SMOKE_PASSED:

    $env:COED_OWNER_SMOKE_ATTESTED = 'true'
    node scripts/operations/tu-production/deploy.mjs resume-after-owner-smoke $taskState --approved-p0-p6
    Remove-Item Env:COED_OWNER_SMOKE_ATTESTED
    node scripts/operations/tu-production/deploy.mjs report $taskState --approved-p0-p6

This is a recorded human attestation, not an independently automated credential
test. Restore commands only after that proof. Monitor for30minutes and the next
usage period. The two Lambda Errors alarms cover runtime failures, not handled
HTTP auth503s; those require safe broker/issuer JSON log review alongside latency,
throttling and DB connections. No notifications or new public destinations are
configured. Do not describe absence of Lambda Errors as proof all Logins succeed.
Safe handled-failure collection parses both raw JSON and Lambda Text-prefixed
console JSON in memory, returning only known error-code counts; JSON-only server
filters must not silently exclude prefixed Text logs.

## Stop and cleanup

All failures stop without automatic application/data rollback. Before018 commit,
its transaction rolls back. After commit keep tables/audit/history and use a strict
compatible app or maintenance; never restore unsafe provisioning or drop018.
Snapshot restore is a separate incident decision because later writes can be lost.

Cleanup only exact task-tagged resources/owned policy statements, not shared SGs,
ENIs, VPC, app DB Secret, original log groups or unrelated rights. Record any
cleanup that could not be completed. Do not publish credentials in diagnostics.
No push or Amplify/frontend deployment is performed by this workflow.
