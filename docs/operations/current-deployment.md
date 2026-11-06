# Current deployment — last verified snapshot

Snapshot consolidated: **2026-11-06, Asia/Bangkok**. Evidence is from the completed TU/onboarding/C7 pilot operations and owner confirmations described below. The documentation update itself made **no new AWS calls or deployments**. Treat this as last verified state, not a realtime monitor or authorization to repeat an operation.

## Released versions

Region: `ap-southeast-2`. Existing Amplify main site: [public home](https://main.d1bpmj87vmjb96.amplifyapp.com/), [user workspace](https://main.d1bpmj87vmjb96.amplifyapp.com/app.html), [company directory](https://main.d1bpmj87vmjb96.amplifyapp.com/company-directory.html).

| Resource | Last verified version | Source/evidence |
| --- | --- | --- |
| `coed-api:live` | Lambda version **8** | Runtime source `204adc089d366d26662f7a236b673deaf4b750ea`; compatible intake-pilot backend |
| `coed-tu-auth:live` | Lambda version **5** | TU broker; unchanged by C7 intake/filename rollout |
| `coed-tu-session-issuer:live` | Lambda version **4** | Private issuer/onboarding; unchanged by C7 |
| Amplify main | Manual deployment job **32**, `SUCCEED` | Frontend source `f3a765280d65ad7f9e8b15cea6cebd0c064ffbb8`; named document Download fix |
| Observed RDS upgrades | Through **022** | 019 registration/020 issuer alignment retained; 021/022 applied together with isolated CLOSED test-round metadata |

The newer source commits `c9d8b32` (operator probe distinction) and `c63b238` (CI dedicated intake DB configuration) are **not additional AWS deployments**. Runtime and frontend sources above intentionally differ: the latter rollout was frontend-only and verified the backend stayed at 8.

Known release mode is manual Amplify deployment and versioned Lambda aliases. PR Merge/Push does not by itself establish live parity. This document does not claim a fresh audit of Amplify auto-build settings.

## Enabled audience and stage

- `COED_API_MAINTENANCE=intake-pilot` — not `off`.
- `COED_INTAKE_CONTROLS_REQUIRED=true`.
- `COED_INTAKE_PILOT` is a strict three-UUID binding (`student_user_id`, `coordinator_user_id`, `cycle_id`). Values are private and deliberately omitted.
- One approved TU Student, one assigned Cognito Coordinator and one separate test round **2569/1**. This is not general enrollment for all Students/rounds.
- Round label: “รอบทดสอบรับสมัคร CO-ED 2569/1 · เฉพาะบัญชีที่อนุมัติ”. It was provisioned CLOSED; the owner confirmed that the Coordinator then selected manual open. **Last confirmed mode: `MANUAL_OPEN`**, not a promise it is still open now. Read the saved server status before testing.
- The assigned Coordinator/three Committee accounts were explicitly copied to the separate test cohort. CPE/CS codes are **test routing only**, not an official certification of the Student's curriculum or major. Committee actions are still disabled.

Coordinator may choose scheduled open/close or manual-until-closed for that round. The previously proposed 48-hour cap was superseded. Neither manual opening nor changing dates widens the pilot audience or bypasses the deployment stage.

| Feature | Current released boundary |
| --- | --- |
| TU login / first registration / own profile | Enabled under verified identity/onboarding rules |
| Draft create/save | Enabled only for the bound Student/round when intake permits |
| Four real files, authorized preview/download | Enabled for the scoped workflow |
| Explicit Submit / immutable destination receipt | Enabled for the scoped pilot; owner confirmed genuine use |
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

Local ignored checkpoints used for this summary:

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
