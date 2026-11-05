# Coordinator intake controls: local verification and next AWS boundary

## Current authority and status

C1-C6 local implementation/testing/commits were approved November5,2026; no push.
The user also requests deployment and approved C7 after reviewing this scope.
Read-only STS/alias, Cognito identity and owner Secret metadata checks passed;
no production SQL or main-service deployment has yet been executed for this feature.
This document is the concrete extension to the earlier
[intake rollout proposal](student-application-intake-rollout.md), not an Apply record.
The old48hour lifetime is superseded; the pilot audience is not expanded.

## Implemented behavior

- SCHEDULED uses explicit timezone-aware opening/closing instants, start inclusive
  and close exclusive. Calendar/offset/order validation runs server-side.
- MANUAL_OPEN records the actual server timestamp with a NULL closing instant,
  remaining open until an assigned Coordinator changes it. No invented end date.
- CLOSED denies ordinary Draft create/save/new upload/finalization/Submit. Existing
  data and submitted evidence remain readable under existing owner/staff permissions.
- A real returned correction retains its own recorded review deadline/cohort.
  Opening intake cannot extend it; closing ordinary intake does not cancel it.
- All mode changes serialize with Student mutations on the existing cycle advisory
  lock. A transaction already admitted may commit before Close; once Close commits,
  later mutations fail. Already issued S3 URLs expire normally, not immediately.
- Active Cognito Coordinator, whole-round assignment, exact three-UUID pilot scope,
  round OPEN and no published results are required. TU staff bridging is not added.
- Optimistic versions and immutable operation receipts prevent stale overwrites and
  duplicate commands. Mode audit and state/receipt commit or rollback together.
- New snapshots retain the control mode/version/timestamps and correction exception;
  a database guard rejects stale/closed forged submissions. Old snapshots are untouched.
- The schedule screen has an independent confirmed intake command, current saved
  status and recent history. Old six-date saves remain closed in the pilot. Student
  screens show real server state; request failure retains browser inputs.

## Exact SQL and standing database capabilities proposed

First apply the separately reviewed021 only if its current history/catalog gate
matches. Its unchanged SHA256 is
`e7beab8e04c60434649339a79dc857295ad4cc15d651ba5dd95f2fe30fd70442`;
see its existing full ACL proposal, including the guarded cohort lock-only column.

Then apply [022_coordinator_intake_controls.sql](../../src/db/upgrades/022_coordinator_intake_controls.sql)
with SHA256 `40ea01888fdfac3ea7892e08b0f6bc043ecc16b28271e74b6a318ae461c42d97`.
The [review-only reader](../../scripts/operations/intake-controls-contract.mjs) pins
LF bytes and has no connection/AWS capability. C7 inventory confirmed021/022 are
vacant;022 is now assigned with the same reviewed SQL bytes. The proposal copy
remains a review artifact, not a separate migration. Do not edit021 or historical checksums.

This proposal creates only:

1. `phase1_intake_controls`, initially owner-provisioned CLOSED/version1 per selected
   cycle. Runtime cannot INSERT/DELETE controls or edit their cycle ID.
2. `phase1_intake_control_events`, immutable auto-triggered change history.
3. Guard/audit functions and triggers, including controlled submission provenance.
4. coed_app SELECT on both tables; column UPDATE only on mode/open/close/version/
   updated_by/updated_at/operation_id; INSERT on events plus USAGE/SELECT on their
   identity sequence. Event guard rejects direct forged inserts. PUBLIC has no
   table access. No new login or SECURITY DEFINER identity capability.

Initial CLOSED provisioning is an owner metadata action, not a Coordinator mode
change; the metadata execution checkpoint must record it. Subsequent changes have
database audit events. Server-generated timestamps use millisecond precision to
preserve exact JSON/JavaScript provenance through actual Submit.

## C7 proposal: temporary capability and staged deployment

C7 is approved. Its **first implemented gate is inventory-only**, using the fixed
[reader](../../scripts/operations/intake-controls-owner/reader.js) and
[controller](../../scripts/operations/intake-controls-owner/operator.mjs).
It uses the single proposed temporary function/role below, the same exact owner
Secret and a mandatory repeatable-read READ ONLY transaction. No Apply mode exists
in this first artifact. Only the given Student number and verified Cognito subject
are parameter bindings; no SQL/password/body override is accepted. They stay in
the private Lambda environment, never committed source. Results omit profile values
and credentials. Cleanup must finish before changing/rebuilding any owner capability.

This gate verifies the unresolved assignment **before** creating a write-capable
artifact or applying migrations. An absent assignment requires the user decision
already specified in C7; deployment approval is not permission to invent one.

Before execution, finish and review a **new** fixed inventory/trial/apply controller,
its allowlisted SQL/dependency ZIP/hash and private metadata manifest. Do not reuse
old owner tools, revive A0 or run a general migrator against observed RDS.

- Account130165494095, ap-southeast-2. One-hour expiry; reserved concurrency1;
  operator-only immutable function version; no public URL or Gateway integration.
- Proposed Lambda `coed-intake-controls-owner-20261105`, role
  `coed-intake-controls-owner-role-20261105`, log
  `/aws/lambda/coed-intake-controls-owner-20261105` with3day retention. Tag/run-ID
  ownership and drift-checked cleanup on success/failure.
- Exact owner Secret proposal:
  `arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx`.
  Verify metadata first; never export credential values to the client/logs.
- Existing subnet `subnet-0fb8a4985d4e48f03`, SG `sg-01157dbde4cba48ab` only. Temporary
  role reads only that Secret, emits only its own logs and performs required ENI
  infrastructure setup, denied to function-code calls via SourceFunctionArn.
  One exact Secrets endpoint statement may be added and fully removed, preserving
  unrelated policy entries. No S3 access from this owner tool.
- Inventory fixed catalog/history/ACL and exact privately verified Student identity,
  Coordinator Cognito sub/link and intended assignment. Trial rolls back. Apply
  schema/history together only after drift and preserved-data checks. Fixed metadata
  command provisions an approved isolated test cycle/routes/control, never arbitrary SQL.

**Still unresolved:** actual internal identity/cohort bindings and approved new
round metadata. Do not copy the expired mock cohort/three Committee assignments,
invent staff accounts, infer academic scope or execute placeholder INSERTs. If
the named Coordinator has no usable whole-round assignment, ask the user which
real scope to assign before publishing destination metadata.

Resolved during C7: the approved Student/TU link and Cognito Coordinator are ACTIVE;
the Coordinator owns the single expired/mock source cohort with three active
Committee accounts. Inventory completed READ ONLY and cleanup verified at
`tmp/tu-production/production-UBeKNV/state.json`. The user explicitly approved a
**new separate2569/1 test round**, copying that exact Coordinator/three-member
assignment and CPE/CS destination code for test routing only. No account creation,
old-round update, official academic certification or Committee workflow activation.

The fixed [upgrade library](../../scripts/operations/intake-controls-upgrade.mjs)
and [new artifact controller](../../scripts/operations/intake-controls-owner/upgrade-operator.mjs)
bind the approved private metadata in a checksum-pinned ZIP. Source cohort IDs,
members, active identity links and schema/history are checked again inside the
transaction. Trial rolls back all SQL/metadata; Apply must reproduce its post-catalog
hash. Existing business rows are fingerprinted and preserved; migration history
only appends021/022. The tool has no arbitrary SQL, account-link or legacy-date mode.

Cutover refinement: apply additive SQL and CLOSED test metadata while the existing
API4 remains browse-only; no contract2 submissions can be created at this stage.
Then publish the compatible new API/Frontend in browse mode **before** enabling
any new writes. This preserves the temporary controller's verified unchanged-service
baseline and still ensures old API4 never reads newly created contract2 evidence.
After any such evidence exists, rollback must use the compatible new browse code.

Deployment order after those checks/approvals:

1. Pin aliases/config/source and rollback checkpoint; publish source-matched current
   API/Frontend in browse mode, preserving Login, own profile and public directory.
2. Verify/apply021 and the new forward migration with transactional history entries;
   provision exact approved test metadata and CLOSED control. Remove the temporary
   Lambda/version/role/policy/log/endpoint grant and verify no residual capability.
3. Set `COED_INTAKE_CONTROLS_REQUIRED=true` for the exact controlled pilot cycle,
   strict COED_INTAKE_PILOT UUIDs, and staged intake-draft → intake-upload → intake-pilot.
   Coordinator can control the cycle but cannot bypass the higher deployment stage.
4. Reuse existing private S3/network/Secrets/broker/issuer and JWT Gateway routes.
   Keep existing architecture/memory; proposed API timeout15s→28s stays under30s
   Gateway, preserving24s application budget/3s SQL/1s locks/20s storage upper bound.
5. Real owner and separately authenticated Cognito Coordinator test: open, create,
   save, real four-file upload, Submit, same receipt/checksum, Close denies Draft
   writes, read retains evidence. Test scheduled/manual modes and genuine browser
   CORS/access denials. No credentials in evidence. Do not claim this from local mocks.

No push, global maintenance=off, audience widening, review/forward/Committee/results/
confirmation activation, broker/issuer changes, new standing service/Secret/bucket/
NAT or permanent AWS IAM expansion. Database ACL additions above are explicit.

## Costs, rollback and stop conditions

S3/requests/transfer, API/Lambda/Amplify and logs remain usage-dependent; temporary
controller invocation also incurs usage. Reuse existing storage/network and do not
claim a fixed total. See [Lambda pricing](https://aws.amazon.com/lambda/pricing/),
[S3 pricing](https://aws.amazon.com/s3/pricing/) before live approval. Indefinite
intake is not an unlimited audience or spending approval. No automatic file deletion,
malware scanner, lifecycle or retention change is included.

Rollback uses this compatible API/Frontend in browse mode, preserving tables,
history, snapshots, receipts and documents. Never restore a DB backup over new
submissions or point blindly to old API4. Signed upload300s/download60s URLs may
remain usable until expiry; attachment finalization still checks the current gate.
Stop on history/catalog/config drift, failed owner binding, missing destination,
audit failure, wrong-scope access, timeout or failed real file/Coordinator acceptance.

## Local evidence and outstanding gates

Local feature commits: `3e5c92a` backend/SQL proposal, `826662e` UI, `ae63b75`
authorization matrix/regression entry. Feature tests use a disposable observed
database plus genuine019/020/021 SQL, local files and HTTP/Lambda adapters; TU
provider and Gateway/Cognito transport remain synthetic.

- Final intake/inventory mode/input/SQL/HTTP/file/correction tests:29 passed, no skips;
  includes no-legacy-window manual intake, actual in-flight finalization/Submit
  versus Close, and a READ ONLY owner inventory transaction with DML denial.
- Targeted UI/schedule/application suites:62 passed (includes3 new control DOM tests).
- Auth boundary matrix:123 passed; maintenance/browse:10 Node+4 DOM passed.
- Full `npm test` passed on isolated loopback databases with the required DB
  variables enabled, including32 release checks. Additional Coordinator suite:
  27 DOM/domain/API+8 actual DB checks. Preview:48 DOM+2 server checks.
  An earlier full run stopped at the intentionally
  strict route inventory test, which now includes both protected control routes.

Outstanding: source-paired candidate rebuild, actual rendered Desktop/Mobile QA,
write-capable temporary controller and live metadata,
live migration/Deploy and genuine Student/Cognito/S3 acceptance. None is implied
by a successful local unit or DOM test.

Browser automation host was unavailable; no rendered inspection is claimed.
The synthetic localhost preview has an intake-controls scenario for later review.
