# V4 decisions: TU identity and controlled intake

Recorded: 2026-11-06 (Asia/Bangkok). Status: existing approved decisions, consolidated for handoff. This record adds no new operational approval. See [architecture](../architecture/G03-V4-architecture.md) for code and [deployment](../operations/current-deployment.md) for what was released.

## D1. Split TU broker and private session issuer

**Context:** TU verification needs internet access; the database and signing capability stay private. TU login success alone does not mean an internal CO-ED identity exists.

**Decision:** the broker outside the VPC verifies TU, then invokes the qualified private issuer. The issuer resolves identity/controlled registration, reads RDS and signs the CO-ED session. Staff continue with Cognito. Both resolve to internal user IDs.

**Why:** preserve private RDS/signing boundaries without adding a NAT for the API. Do not fix connectivity by exposing RDS, moving DB credentials to the browser/broker, or accepting frontend-only authentication.

**Tradeoffs:** more Lambda/configuration contracts, narrow Invoke permission, timeout and signing/issuer alignment checks. No NAT was added; this is not a claim that the entire design has zero cost. Local tests cannot prove actual provider credentials or VPC connectivity.

## D2. Verified onboarding, not guessed account linking

**Context:** a verified TU Student may have no internal profile. TU returns identity/status but not all academic fields.

**Decision:** permit first registration only after real TU verification of a Student with normal status. Retain provider name/number/email/faculty/department/status read-only. Ask for track and entry year as self-reported data. Existing-account relinking requires a separate confirmed owner operation.

**Why:** making up academic data or linking by a matching email/name could attach another person's records. Refusing every new verified Student forever also prevents legitimate first use.

**Tradeoffs:** registration challenges, dedicated execute-only DB capability, replay/expiry/idempotency checks and audit are additional contracts. Creating an account does not certify eligibility. Unsupported/unknown TU status must stop new registration, not manufacture “กำลังศึกษา”. This supersedes the blanket no-provisioning boundary in the earlier [TU decision](../architecture/tu-student-identity-and-delivery.md), not its ownership checks.

## D3. Complete evidence may enter review with UNKNOWN academic assessment

**Context:** TU does not provide the full curriculum/major or verified credits/repeated-course rules used for subject-group calculation.

**Decision:** allow required self-reported curriculum/major/grades plus actual documents to reach the configured Coordinator as **pending review**. Missing verified calculation metadata stays `UNKNOWN`, not automatic `PASS`. Missing required fields/files or a known blocking result still prevents Submit.

**Why:** separate evidence completeness from certified qualification. Do not seed invented policies/credits, infer an official major from a test routing code, or claim that a queued application passed selection.

**Tradeoffs:** manual review is required and provenance must survive in immutable submission snapshots. This is an explicitly versioned pending-academic path, not a general bypass of every existing eligibility rule.

## D4. Submission and destination evidence commit together

**Context:** a browser “sent” message or legacy local draft does not establish delivery to a Coordinator who uses a different login provider.

**Decision:** atomically persist application state, immutable snapshot/checksum, assigned destination receipt, operation result and audit. Coordinator reads the retained submission. Retries reuse operation IDs; recoverable browser text can become a reviewed Draft only, never a historical successful submission or fake file.

**Why:** delivery is a domain/database relationship, not TU-to-Cognito token forwarding. Missing/inactive destination must fail, not silently discard the application.

**Tradeoffs:** stronger database constraints, concurrency/idempotency logic and more evidence to preserve. Database rollback cannot erase an already-uploaded S3 object; uploads therefore have their own staged/finalized lifecycle.

## D5. Coordinator controls intake, deployment still controls rollout

**Context:** the owner rejected a fixed 48-hour trial lifetime in favor of Coordinator-controlled opening, while keeping the restricted pilot audience.

**Decision:** support scheduled dates, manual open until closed, and closed. Only the assigned active Cognito Coordinator with whole-round authority controls the provisioned round. Close stops all ordinary Draft mutations, retains reads, and does not redefine a returned application's existing correction deadline.

**Why:** avoid arbitrary far-future closing dates and make every change explicit/audited. Do not open every round/account or disable global maintenance to satisfy a single test.

**Tradeoffs:** a manual round can remain open indefinitely; the Coordinator must monitor/close it. Cycle locking and version checks serialize Close with in-flight mutations. Already-issued signed URLs expire normally, so Close is not instant revocation of every URL. Deployment stage, account scope, round control and business readiness must all allow an operation.

## D6. Observed-schema upgrades instead of rewriting missing migration history

**Context:** live RDS history used original 014/015 SQL unavailable in the repository; the fresh/workspace schema had diverged. Re-running a same-numbered local migration was unsafe.

**Decision:** preserve observed history and rows. Create checksum-pinned additive upgrades against a read-only catalog baseline, trial rollback, compare catalogs/ACLs/business fingerprints, then apply only the reviewed change with a temporary constrained tool and verified cleanup.

**Why:** code parity must not be achieved by deleting data, replacing checksums or pretending the missing originals were recovered.

**Tradeoffs:** fresh and observed lineages remain separate; future releases must identify their baseline. An observed catalog cannot prove everything a missing historical SQL ever did. Tests include real PostgreSQL for the observed path; a successful fresh migration alone is insufficient.

## D7. Named download is separate from document preview

**Context:** signed private S3 object keys may be UUIDs; opening a PDF viewer does not reliably preserve the uploaded filename when saving from its toolbar.

**Decision:** expose separate Open and Download actions. Use the authorized metadata filename including extension for Download, and safe PDF/JPEG/PNG MIME handling for previews; unknown types remain download-only.

**Tradeoffs:** authorized byte fetching/CORS and Blob lifecycle need testing. The named Download button is the supported filename guarantee, not a promise about every browser PDF toolbar. Private signed links remain short-lived bearer capabilities and must not be logged/shared.

## D8. Explicit routed TU audience within the existing intake boundary

Recorded: 2026-11-08. Scope: requested source implementation, not AWS activation.

**Context:** the owner requested that other TU Students in the round's department/curriculum be able to submit, instead of adding individual Student UUIDs indefinitely.

**Decision:** retain the single-account default and add backend-only `COED_INTAKE_AUDIENCE=routed-tu-students`. Resolve eligibility from the Student's own active TU identity link, completed onboarding and the latest active approved intake route to the configured Coordinator/round. Check membership on the server for Draft creation/save, readiness, uploads/finalization, Submit/retries and document access. Do not use public visibility or browser role/department as permission. Retain staged maintenance, whole-round controls, ownership and immutable submission contracts.

**Tradeoffs:** the round and Coordinator remain explicitly bound; this is not opening every round or adding other Coordinators. Program type/curriculum are pending declarations, so routing is admission to review, not academic certification. Students without complete TU onboarding or an approved matching route stay blocked. Existing schema 019–022 supports the feature; adding actual audience routes is a separate reviewed data operation. Deployment requires reviewed backend release/configuration and actual multi-account browser acceptance; source tests alone do not activate AWS.
