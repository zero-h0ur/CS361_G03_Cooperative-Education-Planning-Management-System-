# One-target TU identity diagnostic

This operator is approved only for N0-N5, account130165494095/Sydney, while the
parent rollout is WAITING_OWNER_SMOKE. It cannot provision/relink/enable accounts,
fix profiles, issue a JWT, or resume writes. It does not call TU or request a
password. Do not use a Student ID from historical chat.

## Before execution

Run the reviewed local tests, including actual disposable PostgreSQL with
NODE_ENV=test, PRESENT_SCHEMA_DISPOSABLE=true and IDENTITY_DIAG_TEST_DATABASE_URL
pointing only to the task-owned127.0.0.1:55440/coed. The DB test requires an empty
public schema and absent coed_tu_login role, creates synthetic fixtures only and
removes them. A skipped DB test is not equivalent to this validation.

    npm.cmd run test:tu-identity-diagnostic
    node scripts/operations/tu-identity-diagnostic/operator.mjs preflight

Preflight is read-only and checks the existing parent checkpoint, exact live
versions/code/TU issuer, verification-only maintenance, Gateway/CORS, absent
diagnostic resource names/endpoint Sid and existing login Secret metadata. It
does not read a Secret value, query RDS or create any AWS resource.

## Owner selects the target locally

From a clean committed worktree, run:

    node scripts/operations/tu-identity-diagnostic/operator.mjs run --approved-n0-n5

Enter only the10digit Student ID at the hidden prompt. No password, token or
credentials in arguments or chat. The operator processes the ID only in memory
and transmits it in the direct private Invoke payload, never in CLI arguments,
stdout, ZIP, state or logs. State stores a per-operation salted digest for target
binding; this is pseudonymous metadata, not a claim of irreversible anonymization.

The script builds a hash-pinned two-entry ZIP, then creates the exact task-tagged
private Lambda/role/log group and one additive endpoint grant. The role can read
only the existing dedicated SELECT-only login Secret and write its own logs; it
has necessary ENI control-plane rights with code-source Deny. No owner, signing,
app or provider Secret access. No Gateway/URL/event source, new DB/endpoint/Secret,
NAT/EC2 or shared-role modification. Node22/256MB/timeout10/concurrency1.

Only a numeric published version with correct run ID, bound target, account,
region, fixed database/Secret and expiry<=30minutes may query. The operator
checkpoint caps invocations at3 and the default workflow invokes once, without
retry; a warm-handler counter adds a local guard but is not a durable global
counter across cold starts. Operator IAM permits no other caller. No extra
persistent store is introduced for counting.

The private tool uses one client as coed_tu_login, requires an explicit read-only
transaction and exact session user/database, and performs only one fixed
parameterized lookup of already-granted columns in users/students/identity links.
Statement timeout2seconds, lock500ms. It returns only capped counts, booleans and
a finite reason code. It rolls back/closes the transaction; never runs DML/DDL,
calls the normal issuer, fabricates TU proof or signs a token.

## Result and cleanup

Let the command finish. Creation, query and cleanup may take a few minutes. The
finally block removes only the owned function/all its versions, role/inline
policy, log group and endpoint Sid, and compares unchanged application, Gateway
and endpoint baselines. On failure it still attempts independent cleanup parts.
Unexpected ownership/policy changes are not overwritten/deleted.

Share only the final JSON result (reason/flags, cleanupVerified and state path).
It contains no Student ID/name/email/token/password/profile. A completed
diagnostic is not a successful Login or authority to repair anything.

If cleanupVerified=false, the command is interrupted/killed, or a permission/
session failure prevents cleanup, keep the printed state path and report it.
Do not rerun with another target or delete shared resources. The operator can
retry exact owned cleanup without the Student ID:

    node scripts/operations/tu-identity-diagnostic/operator.mjs cleanup <exact-state.json-path> --approved-n0-n5

Expiry is not deletion. Cleanup must be verified. Never use broad recursive
deletion or remove shared ENIs/SGs/network, parent rollout artifacts, login role,
existing Secrets, snapshots or original endpoint grants.

## Follow-up boundaries

UNLINKED_IDENTITY with a matching student/Cognito link is evidence for planning a
verified migration, not permission to do it. Disabled/revoked/ambiguous records
are explicit stops. Preserve all application/history data. Ask for separate
ownership-verified repair scope if needed, and require a new successful owner
Login->me->own-profile smoke before ending verification maintenance.

Only normal Lambda/Secrets reads/log usage is incurred. No new paid resource type,
standing diagnostic capability, notification destination or Git push is added.
