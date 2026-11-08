# Current deployment — last verified snapshot

Snapshot updated: **2026-11-08, Asia/Bangkok**. The explicitly owner-approved routed-TU audience cutover was verified at **20:09**. Lambda/Gateway/Amplify reads and deployment checks below are fresh evidence; RDS rows and genuine multi-account browser acceptance were not refreshed. Earlier C7/schema/owner evidence retains its original date. Treat this as last verified state, not a realtime monitor or standing operational approval.

## Released versions

Region: `ap-southeast-2`. Existing Amplify main site: [public home](https://main.d1bpmj87vmjb96.amplifyapp.com/), [user workspace](https://main.d1bpmj87vmjb96.amplifyapp.com/app.html), [company directory](https://main.d1bpmj87vmjb96.amplifyapp.com/company-directory.html).

| Resource | Last verified version | Source/evidence |
| --- | --- | --- |
| `coed-api:live` | Lambda version **9** | Runtime source `cdfdf7d4dfa9dbbc399d991361fcc250de8ca129`; routed TU audience, same intake stage |
| `coed-tu-auth:live` | Lambda version **5** | TU broker; alias/configuration unchanged by the Nov 8 cutover |
| `coed-tu-session-issuer:live` | Lambda version **4** | Private issuer/onboarding; alias/configuration unchanged by the Nov 8 cutover |
| Amplify main | Manual deployment job **32**, `SUCCEED` | Last recorded frontend source `f3a765280d65ad7f9e8b15cea6cebd0c064ffbb8`; fresh job-32 status read and before/after asset hashes; no frontend deployment |
| Observed RDS upgrades | Through **022** | Last verified C7 schema evidence from Nov 6; no SQL/DB write or fresh catalog inventory in the Nov 8 cutover |

Runtime and frontend source commits above intentionally differ. The Nov 8 release was backend-only; it preserved the existing Gateway integrations, TU functions and public frontend asset hashes. API version 8 remains the pre-cutover rollback target; no rollback was needed.

Known release mode is manual Amplify deployment and versioned Lambda aliases. PR Merge/Push does not by itself establish live parity. This document does not claim a fresh audit of Amplify auto-build settings.

## Nov 8 cutover evidence and limits

- Main CI [run 42482561212](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/42482561212) completed successfully for `cdfdf7d` before deployment.
- Exact backend ZIP: **778,841 bytes**, **19 allowlisted entries**, SHA-256 `4fa9657de8b480ea32b8eef425e376ff94d0134f250525108169d202dbc45249`. Published and live Lambda code hashes matched the artifact. No migration runner was invoked.
- Preflight pinned account, clean source, artifact, version-8 alias/latest revisions, original environment hash and qualified Gateway integration. Updated `$LATEST`, changed only the audience environment key, published version 9, checked the numeric candidate, then conditionally moved `live` from 8 to 9.
- Candidate checks: unauthenticated own-session/options/create/Submit returned 401; forward, legacy writes and a role-query attempt remained 503; public directory returned 200. These denied synthetic requests created no application or submission.
- Post-cutover Gateway checks: unauthenticated session/options and Cognito-protected forward returned 401; directory returned 200; exact-origin preflight returned 204. Gateway rejection is distinct from the candidate's maintenance rejection. Directory success exercises a real read path, not intake acceptance.
- Original round/Coordinator binding, maintenance stage, required controls and other environment values were preserved. Gateway routing, TU function configuration/aliases and frontend hashes were unchanged. No SQL, data correction, new resource, IAM, Gateway or frontend write was performed.
- **Still pending:** actual TU Student #2 login, its matching approved RDS route, current intake open/close state, four real S3 files and Submit-to-Coordinator browser acceptance. No genuine TU/Cognito credentials or tokens were fabricated, requested in chat or read for deployment tests.

## Enabled audience and stage

- `COED_API_MAINTENANCE=intake-pilot` — not `off`.
- `COED_INTAKE_CONTROLS_REQUIRED=true`.
- `COED_INTAKE_AUDIENCE=routed-tu-students` — active exact TU linkage/onboarding and approved route membership replace the single Student UUID audience check.
- `COED_INTAKE_PILOT` retains its strict three-UUID binding (`student_user_id`, `coordinator_user_id`, `cycle_id`). Round and Coordinator remain enforced; the Student UUID is retained for compatible single-account fallback. Values are private and deliberately omitted.
- Other TU-onboarded Students may operate only when their own verified faculty/department and declared program type/curriculum match an active latest route in the existing bound round to the bound active Coordinator. The last documented round is **2569/1**; its data/labels were not changed or freshly queried. This is not opening every Student/round/curriculum.
- Last documented round label (Nov 6): “รอบทดสอบรับสมัคร CO-ED 2569/1 · เฉพาะบัญชีที่อนุมัติ”. It was provisioned CLOSED; the owner confirmed that the Coordinator then selected manual open. **Last confirmed mode: `MANUAL_OPEN`**, not a promise it is still open now. Read the saved server status before testing.
- The assigned Coordinator/three Committee accounts were explicitly copied to the separate test cohort. CPE/CS codes are **test routing only**, not an official certification of the Student's curriculum or major. Committee actions are still disabled.

Coordinator may choose scheduled open/close or manual-until-closed for that round. The previously proposed 48-hour cap was superseded. Neither manual opening nor changing dates widens the pilot audience or bypasses the deployment stage.

| Feature | Current released boundary |
| --- | --- |
| TU login / first registration / own profile | Enabled under verified identity/onboarding rules |
| Draft create/save | Enabled for routed TU membership within the bound round when intake permits |
| Four real files, authorized preview/download | Enabled for the scoped workflow |
| Explicit Submit / immutable destination receipt | Enabled for routed membership; genuine use confirmed only for the earlier single-account pilot, new-account acceptance pending |
| Coordinator read of same submission / named document Download | Enabled for assigned Coordinator; owner confirmed filename/extension fix |
| Coordinator intake open/close control | Enabled for assigned whole-round Coordinator |
| Public company directory | Names/locations/logos available; positions/details require login |
| Review, return, accept/forward to Committee | **Disabled** by current maintenance boundary |
| Committee decisions, results publication, confirmation and unrelated legacy mutations | **Disabled** in this pilot; code presence is not live acceptance |

This trial uses owner-authorized real account information/documents. Do not describe every live record as mock data. Repository fixtures and published evidence must still contain no private profiles, documents or credentials. The system is **not generally launched or fully accepted**.

## Storage, migration and cleanup evidence

Existing private S3/network/Secrets were reused; public-access blocks remained enabled. Browser file-transfer CORS is scoped to the exact Amplify origin with reviewed POST/GET/HEAD methods. No NAT, new bucket, new permanent service/Secret or permanent AWS IAM expansion was added by C7. Usage-dependent storage/requests/log costs still exist; no fixed total or unlimited spending authorization is implied.

The constrained C7 tool verified source assignments, trialed the exact 021/022 transaction with rollback, reproduced the post-catalog hash on Apply, appended migration history, provisioned CLOSED test metadata and preserved existing business rows/history. Temporary Lambda/version, role, log group and endpoint statement cleanup were verified. [Detailed historical Apply record](coordinator-intake-controls-rollout.md) retains the original checks and SQL references.

An S3 signed URL issued before Close can remain usable until normal expiry; attachment finalization still checks the current gate. No immediate URL revocation, malware-scanner rollout, automatic retention deletion or general cleanup of Student records is claimed.

## Evidence provenance and handoff limits

The Nov 8 sanitized release/deployment manifest is local-only at `tmp/release-candidates/routed-tu-cdfdf7d/release-manifest.json`, status `DEPLOYED_SMOKE_VERIFIED_OWNER_ACCEPTANCE_PENDING`; its matching ZIP and one-off guarded controller are not tracked team release tools. Source/artifact/target/probe/rollback evidence is summarized above so the handoff does not rely on possessing that directory.

Earlier local ignored checkpoints used for the Nov 6 evidence:

- `tmp/tu-production/production-mW7iTn/state.json`: trial, Apply and verified temporary-tool cleanup.
- `tmp/tu-production/production-nSRr3Y/state.json`: staged API rollout to 8 and genuine owner Draft/file confirmations. Its status was still awaiting final Submit acceptance; the later owner confirmation supplements it, rather than pretending the old checkpoint changed.
- `tmp/tu-production/production-0PNoK1/state.json`: frontend-only job 32 `VERIFIED`, backend remained 8.

These files are **not committed and may not exist in a teammate's clone**. Do not expose raw contents, recreate private bindings from examples, or treat their paths as reproducible team commands. The one-off ignored `coordinator-filename-fix.mjs` controller is not a supported tracked deployment entry point. Future operators need a freshly reviewed source/config/artifact manifest and rollback checkpoint; stale guards and earlier API4 preparation scripts are not reusable instructions.

[Verification](student-intake-verification.md) distinguishes user browser confirmations, modeled IAM probes and CI. New claims about live aliases/configuration/data require a new scoped inspection. If evidence is unavailable or drift is found, record that uncertainty instead of guessing.

## Next release / rollback constraints

This is a handoff checklist, **not approval to execute**:

1. Confirm approved target, current aliases/configuration, exact account/round assignment, observed migration history and compatible artifact/source hashes. Stop on drift.
2. Preserve existing rows, uploaded files, immutable submissions/receipts and migration history. Do not run fresh `migrate`, `seed` or reset on RDS.
3. Obtain approval for any schema/data/permission/resource change, audience expansion or workflow activation. Test locally against the correct lineage first.
4. Release through reviewed staged gates; actual Student and Cognito Coordinator acceptance is separate from synthetic/local tests.
5. If rollback is needed after contract-2 evidence exists, use the **compatible current browse code/configuration**, disabling writes while retaining reads. Do not blindly repoint to old API4 or restore a DB backup over new submissions. Frontend-only rollback must use a verified compatible bundle and retain the backend snapshot.

See [architecture](../architecture/G03-V4-architecture.md), [decisions](../decisions/README.md) and [historical rollout](coordinator-intake-controls-rollout.md) for context before proposing another operation.
