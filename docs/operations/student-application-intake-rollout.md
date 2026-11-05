# Student intake: local implementation and proposed AWS rollout

## Approval boundary

The fixed48hour plan below is **superseded for the next rollout** by
[Coordinator intake controls](coordinator-intake-controls-rollout.md). The user
now wants scheduled or manual-until-closed opening, still limited to the same
pilot audience. Do not execute the old T+48hours metadata proposal.

L1-L6 + A0 only were approved November5,2026. Local implementation commit
`286c64c` builds on A0 tool commit `9e92bf6`. Nothing in this document authorizes
push, production SQL/data publication, main-service deployment or intake activation.
The live application remains browse-only. A1-A4 below are a **proposal**, not an
Apply record. Do not run the general fresh-schema migrator against observed RDS.

## Completed A0 and remaining real-data decisions

The fixed read-only diagnostic completed successfully. Its ignored checkpoint is
`tmp/tu-production/production-uIGevQ/state.json`: `status=CLEANED_UP`,
`result.ok=true`, `cleanup.verified=true`, `failedParts=[]`. Temporary Lambda,
role, log group and exact Secrets endpoint statement were removed and verified;
standing services remained unchanged. It used the existing app credential inside
a verified READ ONLY transaction, not a newly granted SELECT-only database role.
No business rows were written. See [diagnostic scope](student-intake-readiness.md).

A0 found no confirmed production-ready intake:

| Observed round | Readiness |
| --- | --- |
| Internal test1/2570 | Closed; no intake window or cohort |
| CO-ED361 mock round | OPEN status but actual window already expired; one active cohort with linked Coordinator and three Committee members |
| AWS V3 Preview PR73 | No intake window or assigned cohort |
| Security Smoke83 | Explicitly synthetic; no intake window or assigned cohort |
| Preparation1/2569 and2/2569 | Closed; no intake window or assigned cohort |

There were no published Phase1 policies. A linked Coordinator in a mock cohort
is not evidence of a real assignment. Do not extend mock dates, choose its owner,
infer regular/special from CS/ACS or publish sample academic data.

Owner initially selected an **isolated test round for48hours**, later replaced
by Coordinator-controlled scheduled/manual opening. It is limited to this Student and the privately
specified Cognito Coordinator. Do not persist the supplied account password or
use TU login for that Coordinator. This decision does not approve deployment.
The earlier T-to-T+48hours metadata is no longer proposed. Provision the new
intake control CLOSED; the verified assigned Coordinator chooses explicit dates
or MANUAL_OPEN. Missing dates alone must never imply an open round.

Before A1 approval verify test round/year/semester labeling, timezone-
explicit activation/open/close dates, pilot Student identity, assigned Cognito Coordinator,
existing cohort or approved new assignment, and the trusted TU faculty/department
classification mapped to each curriculum/program type. Student supplies curriculum
and major according to Transcript; staff checks these later. The server owns the
destination. Do not record passwords, access tokens or private student details here.
Resolve the supplied Cognito account to the existing ACTIVE internal identity and
assigned cohort by exact verified sub/link, not its email string alone. If a
new cohort/three-member assignment is needed, propose its exact values separately;
do not copy the mock cohort or create staff accounts silently. Label this round
as testing so its rows cannot be mistaken for an actual admission cycle.

## Implemented contract

- TU identity and canonical academic scope remain separate. Registration program
  type/year and declared curriculum/major are marked self-reported/pending.
- New submissions use contract2: UNKNOWN assessment, manual review required,
  exact versioned intake route and nullable policy only under the new SQL guard.
  No dummy policy or academic profile is inserted. Contract1 retains its policy
  requirement and canonical scope. Existing snapshots/history are not rewritten.
- Complete fields, seven independent declarations, actual finalized attachments,
  known numerical rules, deadline and one active destination are still hard gates.
  Missing verified credits/retake rules produce UNKNOWN, never fabricated PASS.
- Snapshot, checksum, delivery receipt, status, event and operation receipt commit
  together. Concurrent identical Submit replays one result. Coordinator reads the
  same submission/checksum, not unsubmitted Student edits.
- Newly pending records cannot forward to Committee without a later separately
  implemented audited verification flow. This release does not implement that flow.
- Existing UI/theme is retained. Disabled stages explain what is not open; readiness
  is distinct from permission to submit, and pending-review confirmation makes no
  selection claim. Server checks remain authoritative, including direct service calls.

## A1: exact forward SQL proposal, not executed

Source: [021_phase1_pending_intake.sql](../../src/db/upgrades/021_phase1_pending_intake.sql).
LF SHA256: `e7beab8e04c60434649339a79dc857295ad4cc15d651ba5dd95f2fe30fd70442`.
The [review-only reader](../../scripts/operations/student-intake-contract.mjs)
pins those bytes and has no connection/Apply/AWS capability.

Precondition: observed020 history with checksum
`3ea3a1fc31ea7a839fff1d8fb94d3d8732d26042edc9dd4a03dbc62610082790`,
database owner and explicit `coed.pending_intake_upgrade=observed020-to021` within
the reviewed transaction. Recheck the full A0 catalog/history/ACL, including live
`guard_phase1_delivery` definition MD5 `5c0a55b76b4c622ae8329d97679780c2` and
`require_phase1_delivery` MD5 `3e17c5f1d4b7ec2e9c2eabda0d3cfcee`. These hashes describe
the observed baseline, not recovered historical SQL. Stop on drift or occupied021.

The SQL performs only these schema/capability changes:

1. Create append-version `phase1_intake_routes` and its immutable-route trigger;
   revoke PUBLIC/runtime writes, grant coed_app SELECT only. No mappings are seeded.
2. Add submissions.contract_version default1; allow nullable policy only for guarded
   contract2 UNKNOWN snapshots. Add the pending-snapshot identity/route/policy guard.
3. Replace only the delivery guard to retain contract1 checks and add route-bound
   contract2 checks. Immutable receipts and owner/submission binding remain.
4. Add the missing **column-only UPDATE(created_at)** on selection_cohorts to
   coed_app because PostgreSQL FOR SHARE needs UPDATE on at least one column.
   Add a trigger rejecting actual runtime timestamp changes. No grant on assignments,
   status, roles, profiles or academic-policy writes. This new standing DB capability
   requires explicit approval; A0 did NOT add it.

No018/019/020 edit, checksum rewrite, user/profile relink, business-row deletion or
standing DB-owner grant. SQL intentionally does not register its own history row:
the future guarded runner must record021/checksum only after all postconditions in
the **same transaction**. Bare SQL execution is not a completed production migration.

A separately reviewed temporary migration controller is still required before A1:
fixed account/region/private subnet and SG, one-hour expiry, concurrency1, exact
immutable version/operator-only invocation, fixed inventory/trial/apply commands,
reviewed SQL/dependency allowlist and drift-checked cleanup. Owner Secret access
must be named by exact ARN in that controller's manifest; no credential export,
wildcard Secrets access, new DB login or reuse of an old active owner tool.
Proposed fixed resources (must be reviewed with the new controller, not reused
from an old operation): Lambda `coed-intake021-owner-20261105`, role
`coed-intake021-owner-role-20261105`, log group
`/aws/lambda/coed-intake021-owner-20261105` with3day retention; tag/run-ID ownership
and verified deletion even on failure. Exact owner Secret proposal:
`arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx`.
Validate its current metadata without exposing the value before any creation.
Operator principal is the managed AccountFullAccessRole in account130165494095.
Subnet `subnet-0fb8a4985d4e48f03`, SG `sg-01157dbde4cba48ab`; do not modify either.

Its temporary role may only read that owner Secret, emit its own short-retention
log and perform necessary infrastructure ENI setup denied to function code. One
exact Secrets endpoint allow entry may be added then removed, preserving unrelated
entries. ENI infrastructure actions are CreateNetworkInterface,
DescribeNetworkInterfaces, DescribeSubnets, DeleteNetworkInterface,
AssignPrivateIpAddresses and UnassignPrivateIpAddresses on required AWS-supported
resources; deny those actions to calls carrying this function's SourceFunctionArn.
Log actions are CreateLogStream/PutLogEvents on its exact log group, not account-wide.
Reuse existing VPC/subnet/SG. No Gateway route/public URL/S3 access.
Do not create this capability under A0 authority. Trial must rollback fully;
Apply must verify preserved rows/history/ACL and remove all temporary capabilities.

Round/window/routing publication is a **separate reviewed metadata transaction**
after the real values above are confirmed. It is not included in021. Exact SQL and
row IDs must be approved before execution; no placeholder INSERT should be run.

## A2-A3: bounded existing-service deployment proposal

Baseline from A0: API coed-api:live4, broker live5, issuer live4, Amplify main job30;
API SHA256/base64 `TSumC2dRMnoJQWqKVQmhW4Oua1hwWt2FyZ5iJbk50QA=`.
Recheck aliases, source hash, environment and Gateway mappings before any change.

| Step | Proposed configuration and acceptance |
| --- | --- |
| Compatibility first | Publish the matching API/frontend candidate in browse mode; preserve Login, own profile, public directory, explicit null submitted policy and retained evidence |
| Draft pilot | COED_API_MAINTENANCE=intake-draft; exact COED_INTAKE_PILOT JSON keys student_user_id/coordinator_user_id/cycle_id bound to approved UUIDs; create/save/readiness only for that owner/cycle |
| Document pilot | intake-upload; enable only ticket/completion and protected owner/assigned-Coordinator download paths; validate real browser CORS, bytes/checksum, final-file immutability and denied anonymous/wrong-scope access |
| Submit pilot | intake-pilot only after preceding checks; real owner submits privately, actual separately authenticated Cognito Coordinator confirms same application/submission/checksum and four documents |

Keep broker/issuer, Gateway routes/integrations/authorizers, standing IAM, bucket,
CORS, endpoint routes/SG, memory256MiB and architecture unchanged. Proposed existing
API Lambda timeout: **15s to28s**, still below Gateway30s. SQL/storage work has one
24s transaction budget, storage capped at20s (and remaining transaction time),
SQL statements at most3s and locks1s; pool acquisition default2s. Test aborted/slow
storage and rollback. This config change is not applied by merging code.

Return/forward, Committee/ranking, full legacy schedule saves, selection/confirmation, contact
updates and legacy Plans stay closed. Do not set maintenance=off. Pilot widening
is not implemented by this three-UUID contract and requires A4 design/approval.
There is no new standing Lambda/Secret/bucket/NAT or permanent AWS IAM expansion.
The new proposal admits only protected GET/POST `/api/v4/coordinator/intake/:id`
and GET `/api/v4/coordinator/schedules/:id` within intake stages. Active role,
whole-round assignment and exact pilot scope are rechecked in the service.

## Cost and private-file boundary

Reuse the existing private application bucket and S3 gateway endpoint. Gateway
endpoints have no additional charge ([AWS VPC documentation](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)).
S3 storage/requests/download transfer and Lambda execution are usage-dependent
([S3 pricing](https://aws.amazon.com/s3/pricing/),
[Lambda pricing](https://aws.amazon.com/lambda/pricing/), checked November5,2026).
API/Amplify/log usage and temporary migration execution may also incur charges.
No fixed total or unlimited spending approval is implied.

One maximum four-file set is35MiB; staging plus final70MiB before retries/history.
The bucket has no lifecycle: signed-URL expiry is not file deletion. No deletion,
versioning, lifecycle, scanner or paid recurring service is included. Content
signature validation is **not malware scanning**. Stop for cost/retention/scanning
decisions before wider intake; keep the initial audience to the named owner.

## Rollback and stop conditions

- Before SQL commit: rollback the transaction and verify preservation.
- After contract2 data exists: switch the **compatible new API/frontend** back to
  browse and keep every new snapshot, receipt, attachment and event. Do not blindly
  revert to API4, which was not accepted as a contract2 decoder. No down-migration
  or restoring a DB backup over newly submitted data.
- Stop issuance/completion immediately; already signed upload300s/download60s
  capabilities remain valid until expiry. Do not use deletion as a rollback.
- Any catalog/alias/config drift, wrong owner/destination, failed genuine upload,
  incomplete audit or missing staff session stops promotion. A server/service test
  with synthetic Cognito claims is not a successful live staff Login.

## Local verification and remaining acceptance

See [verification record](student-intake-verification.md) for commands and actual
results. Local observed-schema tests exercise exact019/020 SQL adapted only to a
random disposable schema/unique fixture roles, then021 rollback and local apply.
The strict production019/020 runners and historical source bytes are unchanged.
New suite covers real bytes, route revocation, ACL denial, atomic audit failure,
duplicate Submit, explicit null policy, owner binding and actual HTTP/Lambda adapter.
TU provider and Gateway/Cognito transport are synthetic in these local tests.

Pending real acceptance: approved metadata, migration controller/manifest and A1
approval; Desktop/Mobile visual inspection; real S3/browser pipeline; real owner
and Cognito Coordinator sessions. No production intake success is claimed yet.
