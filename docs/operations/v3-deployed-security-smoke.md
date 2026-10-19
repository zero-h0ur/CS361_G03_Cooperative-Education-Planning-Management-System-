# V3-T05 — Deployed regression and security smoke (#83)

## Status

**Live smoke complete with disclosed expiry waiver; new PR CI pending.** This is
not overall release acceptance. Dependency #82 is closed after PR #123
merged as `d13868d47d9ec7fc7ce26b67b131f97191817df5`. Work is on
`test/83-deployed-security-smoke`; no commit, push or manual deployment was made
while preparing the first live test batch.

The owner authorized one synthetic Advisor identity, a limited assignment and
isolated cross-scope fixtures. Existing Student/Staff roles and demo plans must
not be changed. Cognito identity creation alone does not establish the DB role,
active identity link or assignment. Provision those explicitly before claiming an
Advisor journey works; never add a mock role/token or relax production policies.

| Acceptance area | Current evidence |
| --- | --- |
| V2 critical public regression | PASS: 10 deployed checks |
| Public Directory remains anonymous and read-only | PASS for tested routes/methods; no public write route exposed |
| Anonymous Student/Plan access denied | PASS: tested registered read paths and mutation denial paths |
| Malformed bearer / CORS / visible error checks | PASS in the first deployed batch |
| Student ownership boundary against another existing fixture | PASS: GET matrix 11/11 and other-owner mutation denial 4/4; original DB checkpoint unchanged |
| Staff in-scope versus out-of-scope existing fixtures | PASS: GET matrix 15/15 and supplemental command policy 403 checks 3/3; original DB checkpoint unchanged |
| Advisor assigned reads and unassigned denial | PASS: owner-run deployed GET matrix 17/17; exact three assigned Students and existing unassigned resources denied |
| Advisor UI assigned read-only journey on main | Owner PASS: exactly three fixture Students, readable details and no mutation buttons; direct API evidence recorded separately |
| Advisor mutation denial on all registered write surfaces | PASS: owner-run 14/14 (8 policy 403s + 6 unsupported-method 405s), followed by unchanged DB verification |
| Before/after database equality | PASS after all three roles' probes: all 11 tables and four fixture summaries match the original baseline |
| Current-release login/logout | Owner PASS for Student/Staff/Advisor on main; reopening app requires Login and does not show prior account data |
| Genuine token/session expiry | SKIPPED at the owner's explicit request; not claimed as PASS |
| Sampled CloudWatch logs contain no token/private fields | PASS: 352 sampled Lambda events, zero configured-pattern findings; Gateway access logs disabled, no coverage claimed for them |

Do not close #83 from the first batch or from mock/CI tests alone. Overall release
acceptance is tracked separately in #84.

## Tested environment and source binding

- Frontend: `https://main.d1d9qrqnsi5nl6.amplifyapp.com`
- API: `https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com`
- Region: `us-east-1`; account: `676101350279`
- Application checkout: `d13868d47d9ec7fc7ce26b67b131f97191817df5`
- Test harness was a working-tree change at execution; pin its hashes below
  rather than pretending those new test files were already in that commit.
- Node.js 20.20.2 / npm 10.8.2
- Live V3 test window: 2026-10-20 02:43:44–02:43:59 Asia/Bangkok
  (`2026-10-19T19:43:44.288Z`–`2026-10-19T19:43:58.814Z`)

Hosted protected assets returned HTTP 200 and matched the production build of
the checkout above. This compares real bytes, not Amplify `HEAD` metadata:

| Artifact | SHA-256 |
| --- | --- |
| assets/authenticated-shell.js | a0f8fb667edd69249951bf14a93440f831a026e295b0347fcc2847daa14b038d |
| assets/authenticated-shell.css | 8c0808e1c5f2da718f82e8290e2c060a38112e19dda6231c38a8af98d9f35483 |

This is a later artifact than Job 51. Its JS hash also differs from the interim
PR #120-only local build recorded by #82 because PR #122 changed navbar/routing.
Neither older hash is silently substituted for this deployed source.

## First live batch — passed

Command: `npm run test:deployed-security`. The TAP report contains 52 passing
Node test entries: 10 V2 checks + 40 V3 checks + two parent containers. It is not
52 independent security scenarios.

Full output: [v3-t05-public-20261020.txt](evidence/v3-t05-public-20261020.txt).

| Evidence / harness | SHA-256 |
| --- | --- |
| TAP report | 5b76ef2e42d4ec10aa2b8e9353a173b3f36ddb1525ac502c322e4819a3059485 |
| tests/deployed-v2.test.mjs | fec27ca42ea4fda44929411abc661d710c3ed3cc7c2805dda983f38beabaaf38 |
| tests/deployed-v3-anonymous.test.mjs | 7c83d6ddbcdcaad33ed98096f15602b9da209c9ba704ebf4a37d55f5a4899922 |

### V2 checks (10)

Health; public Company/Position list and details; company-name/position-title
search; exact location filter; non-duplicate pagination; safe validation errors;
empty result; legacy Student/Plan namespace exclusion; exact-origin CORS/public
frontend configuration; and exact deployed public-file matching.

Expected files now come from `dist/` (or explicitly configured
`V2_EXPECTED_FRONTEND_DIR`), not the unconfigured source runtime stub. V3 deploys
a generated runtime config with public Cognito values. This change retains exact
byte comparison rather than dropping the runtime-config check. Build for the
target origin first; an old/stale local build must fail source matching.

### V3 checks (40)

- 15 registered protected read paths, including Student, Staff and Advisor, return
  401 without a token.
- 9 mutation-denial probes return 401 before body parsing. They use malformed JSON
  and a reserved synthetic UUID, not a valid authenticated write or a demo plan.
- 4 malformed-bearer checks return 401 without echoing the canary token.
- 2 legacy public Student/Plan paths return 404 without a data envelope.
- 8 unsupported public mutation probes are denied (POST/PATCH/PUT/DELETE against
  Company and Position paths). No valid write payload is sent.
- Main protected preflight returns 204, exact origin, Authorization support and no
  application data/credentialed CORS grant.
- An unapproved origin receives no allow-origin header. The public health request
  still returns 200: CORS is a browser policy, not API authentication.

Error checks inspect the response in memory and fail without printing the body
if it contains the request canary, a JWT-looking value, DB credential URL, private
key, private identity/profile field names or stack detail. These checks do not
prove every error path is free of PII and do not inspect CloudWatch logs.

## Reproduce the unauthenticated batch

Build on the exact intended source, using only public client configuration:

```sh
CO_ED_COGNITO_USER_POOL_ID=us-east-1_WzzG10dCP \
CO_ED_COGNITO_CLIENT_ID=3r7a2qjn98v31r1f6vee8ag8e5 \
CO_ED_COGNITO_DOMAIN=us-east-1wzzg10dcp.auth.us-east-1.amazoncognito.com \
CO_ED_APP_ORIGIN=https://main.d1d9qrqnsi5nl6.amplifyapp.com \
CO_ED_API_BASE_URL=https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com \
CO_ED_REQUIRE_AUTH_CONFIG=1 NODE_ENV=production npm run build

npm run test:deployed-security
```

This is an explicit live command, not part of `npm test`. Do not make normal CI
depend on live AWS access. The operator-helper unit tests added to CI use fake
clients only, without AWS credentials or network calls:

```sh
python3 -m unittest discover -s tests/operations -p 'test_*.py'
```

## Cognito Advisor creation — owner verified

Reviewed helper: `scripts/operations/create-smoke83-advisor.py`.
CloudShell upload copy: `coed-create-advisor83.py`.
SHA-256: `ef6d37ab050af26ee776f94a900a985d0a53bb20b79b4de52b71a1628c067299`.

Run only in an interactive normal CloudShell terminal in the expected account.
The helper creates `advisor-preview-83@advisor.example.com`, with invitation
suppressed and a fixed synthetic marker, then sets a password through the SDK.
It can resume/reset only that exact marked identity; it refuses an unexpected or
disabled account. Password mismatch/policy failure happens before account writes.
It does not touch existing Student/Staff accounts, DB roles, groups, assignments,
API/client configuration, networking or deployments.

Password input is hidden and is never put in shell arguments, output or files.
The private `coed-advisor83-identity.json` mapping contains the synthetic subject
but no password/token, is created mode 0600 without overwriting another file,
and is ignored by Git. Keep it in the operator environment; do not paste its
contents or upload it as a public PR attachment. Status output contains only its
path/hash and the non-secret test login email.

The owner ran the hash-verified helper in CloudShell and reported CONFIRMED for
`advisor-preview-83@advisor.example.com`. The first password confirmation failed
before any account write; the next attempt succeeded. Private identity metadata
SHA-256 is `13cd5694a56ba081fe1591bd6310494a9fa9cb7ca61dc69bf35798c5f1e66519`.
Its subject/password were not posted or added to this repository. Cognito success
alone must not be reported as an active internal Advisor.

## Scoped fixture/link gate — owner verified on RDS

The owner authorized the following isolated fixture scope. Scripts live under
`scripts/operations/`, outside the Lambda package source tree; this adds no API
route, application-role bypass or automatic deployment step.

| New rows (first successful run only) | Limit |
| --- | --- |
| Internal Users | 1 Advisor + 4 non-login synthetic Student users; no existing role update |
| External identity links | 1 exact hash-pinned Advisor subject to the reserved new Advisor user |
| Students / Plans | 4 private mock Students and 4 private Plans, all explicitly tagged |
| Advisor assignments | 3 exact fixture Students, finite 7-day period; no demo Student assignment |
| Round | 1 clearly labeled public/mock OPEN test round, expiring after 7 days |
| Audit | Append provisioning events as an existing non-login SYSTEM actor |

The in-scope fixtures are `SMOKE830001` (DRAFT), `SMOKE830002` (SUBMITTED) and
`SMOKE830003` (UNDER_REVIEW), within the existing CPE / ISNE / 2569 partition.
`SMOKE830004` is in `SMOKE83_OUTSIDE`, with no assignment and outside the Staff
test partition. The active Staff scope itself is not modified. Seeded Plan
statuses are explicitly audited as fixture creation, not falsely represented as
executed Student/Staff workflow transitions.

SQL: `scripts/operations/provision-smoke83-fixtures.sql`, SHA-256
`87b7c110b253a936bb557b05017633fb4a57ed3801ec5d2779e929071ef795da`.
VPC operator: `scripts/operations/run-smoke83-provision.py`, SHA-256
`91ad67b563ae36b3d7c553ebf0f7583b9dac21bb249d2a618d83df592655489c`.

Normal CloudShell transfers the SQL/operator files and the private identity
mapping to the existing private release bucket under `release/smoke83/`, with
SSE AES256. Verify all three file hashes and all four bucket Public Access Block
settings before upload. No password or token is part of this transfer. The
mapping is sensitive operator metadata, not a public PR attachment.

In VPC CloudShell `coed-db-viewer`, the operator downloads only hash-pinned inputs
with the expected bucket owner, validates the mapping without printing it, and
checks RDS readiness before asking for the hidden postgres password. RDS uses
TLS verify-full with the pinned CA. Password goes only in the child process
environment; the validated subject is substituted into SQL in memory and passed
over stdin, not shell arguments/files. Raw SQL errors/identity values are not
printed: only an error class/SQLSTATE or a validated synthetic summary is output.

All inserts and postconditions run in one SERIALIZABLE transaction with bounded
lock/statement timeouts. Complete row fingerprints outside the exact reserved
fixture IDs must remain unchanged, including original roles/scopes/demo plans.
ID/role/link collisions or unexpected assignments abort rather than overwrite.
Reruns do not duplicate rows, reset Plan state/version, reactivate disabled users
or extend expired assignments. If the connection is lost at COMMIT, do not assume
rollback or manually reset data; the same helper can safely verify/reuse its
marked fixtures on retry. Cleanup/expiry review is separate; no hard delete is
performed.

Local verification: 20 fake-client operator unit cases plus 12 real PostgreSQL
cases in a newly created `--network none`, no-published-port, tmpfs-only container.
The image's temporary init server was excluded from readiness by checking final
TCP readiness inside the container. The final combined suite passed 32/32.
Cases include idempotence, collision rollback, mismatch/disabled-account refusal,
no assignment renewal, no extra demo assignment, preservation of later fixture
state/version, rejection of the wrong SQL operator, and detecting/rolling back an
injected test-only trigger side effect on the original demo Plan without a
version bump. The pre-existing `pg-v2` container was not started or modified.

Final combined output: [operator/SQL tests](evidence/v3-t05-operator-tests-20261020.txt),
SHA-256 `86de7f11f5b2e2cefa0fee9724480622abc415cd3f3d1a5fce913368f798153a`.
Temporary labeled test containers were stopped/auto-removed after the run.

Reported SQLSTATEs are deliberately value-free: P8301 database/operator; P8302
subject format; P8303 migration/SYSTEM actor; P8304 original test partition/scope;
P8305 user collision/role/status; P8306 identity binding; P8307 round/public refs;
P8308 Student fixture; P8309 Plan fixture; P8310 assignment; P8311 non-fixture row
fingerprint changed. Stop and review those conditions instead of bypassing a
guard, resetting a fixture or granting broader permissions.

The owner ran the hash-pinned provisioner in VPC CloudShell on 2026-10-20
(Asia/Bangkok; exact execution timestamp was not supplied). All three transfer
hashes and all four release-bucket Public Access Block settings passed. The
transaction committed and reported an ACTIVE ADVISOR identity, three limited
assignments, four private fixture Students and four private fixture Plans. The
initial states were DRAFT, SUBMITTED, UNDER_REVIEW and DRAFT, all version 1;
assignment duration was seven days. `ExistingRowsUnchanged` was true and
`DemoPlansTouched` was false. No subject, password or token was posted.

This verifies live provisioning only. The subsequent authenticated read evidence
is recorded below; mutation boundaries remain a separate gate.

On 2026-10-20 the owner additionally confirmed the real Advisor main UI login:
only SMOKE830001–SMOKE830003 were visible, Student/Plan details were readable,
and no edit/submit/approve controls were present. This is owner-reported UI
evidence, not proof that direct API mutations are rejected.

## GET-only authenticated operator — all three roles passed

`scripts/operations/read-smoke83-roles.py` uses Python standard library only.
CloudShell copy: `coed-read83.py`, SHA-256
`55e7e655a31f7471998fa88bb146d77ef04a6ed42a925a082dbd882e91bf2a18`.
Run in an interactive normal CloudShell (not the private VPC shell). It accepts
`--role ADVISOR`, `--role STAFF` or `--role STUDENT` and prompts with hidden input
for that synthetic account's current MAIN OAuth **Access Token**, not an ID token,
refresh token, password or AWS credential. Never put tokens in chat, screenshots,
command arguments, files or PR attachments. In browser DevTools, use Application
→ Session Storage → main origin, filter `accessToken`, and copy only the value of
the current synthetic user's matching entry. Clear the clipboard afterward.

The operator keeps the token in process memory only; it does not promise secure
Python memory zeroization. Unverified JWT claims only guard the expected issuer,
client, access scope and freshness; the actual deployed API verifies the token
and `/api/v3/me` supplies the trusted active role before fixture reads. Advisor
also must match the reserved internal synthetic Advisor ID. No app client flow,
scope, role or Gateway setting is changed to obtain test access.

All requests are GET, HTTPS and pinned to the exact API origin, with normal TLS
verification, a 15-second per-request timeout and a 512 KiB response limit. Proxy
environment settings and redirects are refused. Bodies/claims/private identifiers
are withheld; expected 403s require the exact generic error contract. The script
stops on an unexpected HTTP status, role or response postcondition. No data is
written, even if a security defect unexpectedly allows a read.

The prepared matrix has 17 Advisor, 15 Staff and 11 Student checks. It compares
the exact fixture IDs in assigned/in-scope lists, reads assigned/in-scope details,
checks own Student Plan/history reads, and requires 403 for existing unassigned,
out-of-scope or other-owner resources and inappropriate role namespaces. Student
positive reads may inspect existing own demo Plans but never mutate them.

Local fake-HTTP/unit tests passed 12/12, including all three role matrices,
fail-before-network token guards, wrong trusted role/Advisor target, redirect and
non-TTY refusal, pinned GET transport, bounded bodies, privacy withholding and
stop-on-unexpected-access. These tests do not establish deployed authorization.
Owner-run output for all three roles is recorded below. Mutation probes and
before/after DB comparison remain a separate phase after these read gates.

### Live Advisor read matrix — owner-run PASS 17/17

The owner ran the hash-verified `coed-read83.py --role ADVISOR` against the exact
deployed API using the real MAIN OAuth session. Window:
`2026-10-19T20:27:47.341776+00:00`–`2026-10-19T20:27:48.662840+00:00`
(2026-10-20 03:27:47–03:27:48 Asia/Bangkok).

- Trusted API session returned the expected active synthetic Advisor role/ID.
- Assigned list contained exactly the three expected fixture Students.
- Each assigned Student, its Plan list and its Plan detail returned HTTP 200.
- The existing unassigned Student, its Plan list and its Plan returned HTTP 403.
- Staff Student search, Staff Plan detail and Student self-profile namespaces
  returned HTTP 403 for this Advisor.
- Every expected 403 passed the operator's exact generic error-contract check;
  no response values, subject or token were included in the posted output.

All 17 checks passed; all requests were GET and no data was changed. This proves
the tested live read/role boundaries only, not Advisor mutation denial, real
token expiry, log privacy or final release acceptance. No redeploy was needed.

### Live Staff read matrix — owner-run PASS 15/15

Window: `2026-10-19T20:30:25.309024+00:00`–`2026-10-19T20:30:26.724413+00:00`
(2026-10-20 03:30:25–03:30:26 Asia/Bangkok). The trusted session identified
STAFF. Exact in-scope fixture Student/Plan searches returned the three expected
records; the existing outside fixture was excluded even with the same academic
year filter. All three in-scope Plan details/histories returned 200. The existing
outside Plan detail/history, Student self-profile and Advisor namespace returned
403 and passed the generic error-contract check. GET only; no data changed.

### Live Student read matrix — owner-run PASS 11/11

Window: `2026-10-19T20:31:45.031045+00:00`–`2026-10-19T20:31:46.028401+00:00`
(2026-10-20 03:31:45–03:31:46 Asia/Bangkok). The trusted session identified
STUDENT and its own profile matched the expected synthetic account. Own Plan
list/detail/history returned 200. Both tested other-owner fixture Plan
details/histories, Staff search and Advisor namespace returned 403 and passed
the generic error-contract check. GET only; no demo content was changed.

The combined owner-run authenticated read result is **43/43** (17 Advisor,
15 Staff, 11 Student). Tokens/claims/private response bodies were withheld.
These results do not establish mutation denial, expired-token behavior or log
privacy, and are not grounds to close #83 by themselves.

## Before/after DB checkpoint — capture and all-role verification passed

Source: `scripts/operations/checkpoint-smoke83-db.py`; CloudShell copy:
`coed-db83-checkpoint.py`, SHA-256
`a474556afc2023fa818e414976661f9eba058480c02e0ebdc8bedb3f3172734d`.

Run `python3 coed-db83-checkpoint.py capture` in VPC CloudShell before denial
probes, then `python3 coed-db83-checkpoint.py verify` in the **same directory and
environment** afterward. Do not run demo edits, fixture resets or other data
writes concurrently. All three roles' probes and the final verification passed
against the same original baseline, as recorded below.

The helper retrieves only the hash-pinned public RDS CA from the private release
bucket, checks readiness before prompting for the hidden postgres password,
and connects with TLS verify-full. Credentials go only in the child process
environment, not args/output/files. SQL uses one bounded REPEATABLE READ READ ONLY
transaction with UTC serialization and ends in ROLLBACK; it has no DDL/DML.
Database/operator/migration, marked fixture rows, active Advisor/assignments and
OPEN test round must pass guards.

It captures counts plus deterministic full-row MD5 equality fingerprints of 11
application tables, including identity links, users, Students, Plans, scopes,
assignments, rounds, audit events, operations and public Company/Position data.
Fingerprints are for change detection, not cryptographic attestation. Four
synthetic Plan state/version/audit-count/operation-count summaries are included.
Initial capture requires the original v1 states, one provisioning audit event per
Plan and zero Plan operations, so earlier writes cannot silently become a new
accepted baseline.

The local baseline `coed-db83-baseline.json` is created mode 0600/O_EXCL and is
Git-ignored. It contains counts/fingerprints, not raw DB rows/passwords/tokens,
but remains private operator evidence. Never publish, edit, overwrite or recreate
it to hide a difference. Verify refuses symlinks/open permissions and leaves the
file unchanged. Any table or fixture-summary difference stops acceptance and
prints only affected table names, not private values. Unrelated concurrent writes
also cause a stop and must be investigated rather than dismissed automatically.

Local verification on 2026-10-20: 12 checkpoint unit cases passed; the expanded
operator suite passed **58/58**, including 14 real PostgreSQL cases in a newly
created no-network/no-published-port tmpfs container. New SQL cases verified that
the checkpoint is repeatable/read-only and detects a full-row demo-content
change without a version bump (local synthetic test only). The temporary test
container was stopped/auto-removed; RDS and existing containers were not changed.
These local results are separate from the owner-run live capture below.

### Live initial checkpoint — owner-run PASS

The owner ran the exact hash-pinned helper in VPC CloudShell and reported
`BASELINE CAPTURED` at `2026-10-19T20:38:11.020026+00:00`
(2026-10-20 03:38:11 Asia/Bangkok). The private mode-0600 baseline is retained at
`/home/cloudshell-user/coed-db83-baseline.json`; its contents were not posted.
All 11 table counts/fingerprints were captured. The four fixtures retained
DRAFT, SUBMITTED, UNDER_REVIEW and DRAFT respectively, all version 1, one audit
event each and zero Plan operations each. The transaction was read-only.
Retain this exact baseline for every subsequent comparison.

### Live post-Advisor checkpoint — owner-run PASS

At `2026-10-19T20:46:47.387139+00:00` (2026-10-20 03:46:47 Asia/Bangkok),
the owner ran `verify` against the original 20:38:11 UTC baseline. It reported
`DATABASE UNCHANGED VERIFIED`: all 11 table counts/full-row fingerprints and
four fixture summaries matched. States remained DRAFT, SUBMITTED, UNDER_REVIEW,
DRAFT; all four remained v1 with one audit event and zero Plan operations each.
No existing/demo/fixture application-table difference was detected in this
bounded window. This is evidence after Advisor probes only, not after later
Student/Staff commands or of no attempted writes in CloudWatch logs.

### Live final all-role checkpoint — owner-run PASS

At `2026-10-19T20:50:17.189888+00:00` (2026-10-20 03:50:17 Asia/Bangkok),
the owner ran `verify` after Student and Staff probes. All 11 table
counts/full-row fingerprints and four fixture summaries still matched the
original `2026-10-19T20:38:11.020026+00:00` baseline. All four Plans retained
their original states and v1, one audit event each and zero operations each.
No application-table difference, including original/demo data, was detected in
this test window. The baseline was not reset or recaptured.

## Fixed-target mutation-denial operator — all three roles passed

Source: `scripts/operations/deny-smoke83-mutations.py`; CloudShell copy:
`coed-deny83.py`, SHA-256
`484261fd02b86247a34ff707f1011008d8f3845bb76cbd8c53a8efda9bd3d1ee`.
It requires the exact hash-pinned `coed-read83.py` in the same directory and an
interactive hidden MAIN OAuth Access Token prompt. The explicit
`--baseline-captured` flag is the owner's acknowledgment of the recorded live
capture, not cryptographic proof of a DB baseline.

The trusted active API role and relevant fixture reads must pass before arming
any probe. Advisor additionally must match the exact synthetic internal ID,
three assignments and original v1 DRAFT/SUBMITTED/UNDER_REVIEW Plan states in
the isolated OPEN round. Student must match the original synthetic Student,
not a fixture Student, and both targeted foreign fixture reads must return 403.
Staff must see the outside fixture excluded from search and detail denied.

| Role | Negative probes | Required result |
| --- | --- | --- |
| Advisor | Self-profile PATCH/PUT, Plan create, DRAFT content PATCH/submit, SUBMITTED start-review, UNDER_REVIEW return/approve | 8 exact generic HTTP 403s |
| Advisor | POST/PATCH/PUT/DELETE on the assigned Advisor Plan detail path; PUT/DELETE on canonical fixture Plan detail | 6 exact generic HTTP 405s |
| Student | Content PATCH/submit on existing foreign DRAFT fixtures 1 and 4 only | 4 exact generic HTTP 403s |
| Staff | Start-review/return/approve against existing outside fixture 4 | 3 exact generic HTTP 403s before state validation |

Registered Advisor commands use valid JSON, fresh UUID operation/correlation
IDs, expected version 1, public Company/Position references where applicable,
nonempty feedback and a correct source state for each transition. This avoids
counting validation, not-found or state failures as role-denial evidence.
The outside Staff fixture is DRAFT, so its supplemental review probes establish
policy 403 before state validation, **not valid-state Staff review acceptance**;
a 422 is a failure, not an acceptable denial substitute. No fixture state is
rewritten just to make that supplemental test easier.

Only fixed isolated Plan IDs and reviewed method/path/body tuples may be armed.
No Student own-profile update, Student Plan create, demo Plan write, fixture
reset, positive Staff transition or backend deployment is performed. Advisor
self-profile routes have no linked Student and must be role-denied. All 2xx,
unexpected 4xx/5xx, redirects, unsafe errors or timeouts stop immediately without
automatic retry; an unexpected successful request could change an isolated
fixture, so no unconditional "no data changed" claim is made. Tokens/response
values stay in memory and are withheld. Advisor detail reads are also compared
before/after probes; full DB equality still requires the original VPC checkpoint.

Run Advisor first and verify the original DB baseline afterward even if a probe
stops. Do not run later probes after STOP, reset data, recapture a baseline or
retry a possibly applied request. Local negative-operator tests cover all role
matrices, reviewed targets/payloads/states, baseline acknowledgment, preflight
fail-closed, wrong role, unexpected success/timeout without retry, response
privacy, pinned helper hash and actual urllib HTTPError handling. All three
roles' live results are recorded below.

On 2026-10-20 the expanded suite passed **74/74**: 60 fake-client/operator unit
cases (including 16 new negative-mutation helper cases) plus 14 real PostgreSQL
cases in a newly created no-network/no-published-port tmpfs container. The test
container was stopped/auto-removed. No live authenticated mutation was sent by
these local tests, and no RDS/existing-container/deployment change was made.

### Live Advisor mutation matrix — owner-run PASS 14/14

Window: `2026-10-19T20:45:36.653562+00:00`–`2026-10-19T20:45:38.138862+00:00`
(2026-10-20 03:45:36–03:45:38 Asia/Bangkok). The owner used the real Advisor
MAIN OAuth token with `coed-deny83.py --role ADVISOR --baseline-captured`.
The trusted active role, exact three assignments and original three fixture
state/version checks all returned 200 before any probe was armed.

All eight registered write-surface probes returned exact generic 403 errors:
self-profile PATCH/PUT, Plan create, DRAFT content PATCH, DRAFT submit,
SUBMITTED start-review and UNDER_REVIEW return/approve. All six unsupported
method probes returned exact generic 405 errors. None was accepted on the basis
of a malformed payload, missing resource or invalid workflow source state.
All three assigned Plan full-detail postchecks returned 200 and matched their
pre-probe values. No response values, token or claims were posted.

The subsequent original-baseline DB comparison passed as recorded above. The
tested Advisor mutation/read-only boundary is accepted for this deployed batch;
it does not by itself complete the other roles' checks, log sampling, future PR
CI or overall #83 acceptance.

### Live Student mutation matrix — owner-run PASS 4/4

Window: `2026-10-19T20:48:36.191184+00:00`–`2026-10-19T20:48:36.866934+00:00`
(2026-10-20 03:48:36 Asia/Bangkok). The trusted session and own synthetic
profile returned 200; reads of the two targeted foreign fixtures returned 403.
Content PATCH and submit for each existing foreign DRAFT fixture (1 and 4)
returned exact generic 403s: four denials, no success/validation/state failure
accepted. No own-profile update, Plan create or own demo Plan write was sent.

### Live Staff supplemental mutation matrix — owner-run PASS 3/3

Window: `2026-10-19T20:49:47.603261+00:00`–`2026-10-19T20:49:47.977180+00:00`
(2026-10-20 03:49:47 Asia/Bangkok). The trusted active Staff session and empty
out-of-scope search preflight returned 200; existing outside Plan detail was 403.
Start-review, return and approve against that existing outside DRAFT fixture
all returned exact generic 403s before state validation. These three outcomes
do not establish valid-state positive Staff review/approval acceptance.

The combined negative result is **21/21**: 14 Advisor, 4 Student and 3 Staff
supplemental denials. The subsequent all-table original-baseline comparison
passed, as recorded above. Role preflight/postcheck GETs are not silently added
to that negative-probe count.

## Current main Login/Logout and expiry scope

The owner explicitly confirmed on 2026-10-20 that all three current main roles
(Student, Staff and Advisor) can Logout, must Login again when reopening
`/app.html`, and do not show the prior account's data. This is owner-reported
deployed UI evidence, separate from the API role matrices and older #82 evidence.

**Genuine token/session expiry: SKIPPED by explicit owner request.** The owner
declined the wait-based real-token test and asked to skip it. No Cognito TTL,
refresh flow, Gateway policy or production clock was changed. No forged-token,
mock UI or revoked-token result is substituted as proof of genuine expiry.
This is an acknowledged coverage gap in #83's Coverage section, not PASS; expose
it in the PR/issue summary so reviewers can decide acceptance with the waiver.

## Bounded CloudWatch sampler — owner-run PASS with explicit scope limits

Source: `scripts/operations/scan-smoke83-logs.py`; CloudShell copy:
`coed-logs83.py`, SHA-256
`060d5ee5f066faa2084d01bcc6e19ac160d568acf327aa528a4cf80e4b07be6a`.
Run in normal CloudShell, without a token or password prompt. Read-only SDK
calls verify the exact account/current Lambda CodeSha256 and inspect the
existing API `$default` access-log destination. No logging setting is enabled
or changed. Lambda logs are read; API Gateway access logs are additionally read
only if already configured in the same account/region, otherwise that coverage
limitation is reported explicitly.

Samples use fixed UTC windows 2026-10-19 19:43–19:45 (public regression) and
20:27–20:51 (role reads and mutation denials). Messages are scanned in memory,
never saved or printed. Output is numerical aggregate counts by fixed categories
for JWT/bearer/credential material, private fields/claims, email-like values and
known synthetic private canaries. Patterns are conservative heuristics, not a
guarantee for every kind of PII. Mask-like records are counted and never unmasked.

Pagination follows even empty pages with a next token, deduplicates event IDs
and rejects cycles. Global bounds are 40 requests/pages, 20,000 events and
16 MiB of message text; a cap, empty window, absent Lambda invocation evidence,
unsafe destination or candidate privacy finding stops acceptance instead of
claiming PASS. SDK errors/configuration/log values are withheld. The sampler
does not prove logging coverage for Gateway authorizer rejections if access logs
are disabled, other services or events outside these sampled windows.

Local scanner tests passed 13/13 using fake clients, including pagination,
limits/empty coverage, known privacy canaries, text/JSON runtime events, target
pinning, optional Gateway destination, masked-record reporting and no raw
message output. Owner-run live results are recorded below.

The expanded operator suite then passed **87/87** locally on 2026-10-20:
73 fake-client/operator cases plus 14 real PostgreSQL cases in a new disposable
no-network/no-published-port tmpfs container. It was stopped/auto-removed after
the run; no AWS logs/RDS/deployment or existing container was touched by tests.

### Live log sample — owner-run PASS, Lambda only

The owner ran the hash-pinned sampler and posted numerical aggregate output
only. It verified the current exact Lambda code/account. No scan execution
timestamp was supplied; the two requested event-time windows are explicit:

| Window (UTC, 2026-10-19) | Bangkok time (2026-10-20) | Pages | Events | Lambda starts |
| --- | --- | --- | --- | --- |
| 19:43–19:45 | 02:43–02:45 | 2 | 84 | 28 |
| 20:27–20:51 | 03:27–03:51 | 2 | 268 | 89 |

Total: **352 events / 31,097 message bytes / 117 Lambda starts**, with zero
mask-like records. All six configured finding categories were zero in both
windows: JWT-like, bearer value, credential material, private fields/claims,
email-like and synthetic private canaries. Pagination completed without a cap
or incomplete-window error. No raw log messages/files or credentials were
included in the posted evidence.

`APIGatewayAccessLogsConfigured` was false. Therefore this is a bounded
heuristic check of Lambda records only, not an API Gateway access/authorizer-log
review and not an all-services/all-history guarantee of no PII. No logging
configuration was enabled or changed to obtain this result.

## Full local regression — PASS; new PR CI still pending

On 2026-10-20, `npm test` completed with exit 0 under Node.js 20.20.2 /
npm 10.8.2 against a new temporary PostgreSQL 16 container. It was published
only to a random 127.0.0.1 port, used a tmpfs data directory and a distinct
`coed_v3_test` test DB; `DATABASE_URL` pointed at a separate unused local target.
AWS credential environment variables were unset. Only synthetic test databases
were reset/seeded; no RDS, demo data or deployment was accessed or changed.

Result: **808 Jest test executions across 36 suites / 22 invocations, plus 40
Node TAP test executions**, all passed, zero failed/skipped. These are execution
counts across the npm command chain, not a claim of 848 independent deployed
security scenarios. The separate 87/87 operator result is recorded above.

Full generated output: [local regression](evidence/v3-t05-full-regression-20261020.txt),
SHA-256 `2a08caee4b1b2180b05da30eca72c35231e65ebb7fb0d436dd94274822df5d8e`.
The temporary container was stopped/auto-removed. A subsequent read-only Docker
inventory confirmed no regression-only container remained and pre-existing
`pg-v2` stayed exited. Generated frontend test modules are ignored local output,
not deployment artifacts or runtime source changes.

The CI workflow now runs all operator tests without AWS credentials (including
their own no-network disposable PostgreSQL cases) and preserves their log plus
the full npm regression log as build artifacts, including on failure. This is
prepared configuration, **not evidence that the future #83 PR CI has run**.

## Handoff / remaining CI

Use isolated synthetic resources and existing exact roles. Do not change a demo
plan's state or widen the existing Staff scope merely to make a test pass.

The three roles' reads, negative probes, original DB equality and owner UI
Login/Logout gates are recorded as passed above. Real expiry was explicitly
waived by the owner and must remain visible as SKIPPED. The bounded Lambda log
sample also passed with the limitations above. Remaining work is full CI of the
new #83 PR and reviewer acceptance of the explicitly skipped expiry coverage.
Earlier PR #123 CI run 39312117386 passed, but it does not cover
new #83 test files before they are committed and run in CI.
