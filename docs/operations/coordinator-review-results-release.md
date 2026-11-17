# PR #175 — Coordinator review and results release

Release date: **2026-11-11, Asia/Bangkok**. Final application readback: `2026-11-11T07:11:49.979Z`. Status: **deployed, operational smoke verified, authenticated owner acceptance pending**. This report records completed operations; it is not approval or an executable rollout plan for another release.

## Requirement and code

The owner requested Coordinator academic review/forwarding and a dashboard reading the Committee's saved results. Source is merged main commit `791ed1e32b96384843847f92c3b8b35959b5d41f` (PR #175). The owner explicitly chose to retain existing Committee decision/finalization behavior for this release.

The existing three-section schedule form remains: application intake, application consideration, and Student confirmation. The assigned Coordinator chooses the review interval there. The results dashboard reads saved Committee outcomes; it does not recompute selection, finalize decisions, or publish results to Students. Missing policy/evidence is not a passing academic result.

[CI run 42676201558](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/actions/runs/42676201558) completed successfully for this main commit, including `regression` and `observed-schema-upgrade`. This does not establish that every optional database suite ran, or that real authentication and role workflows passed.

## Separate schema and policy operation — Nov 10

The separately approved owner operation was verified at `2026-11-10T09:56:54.685Z`. It completed a rolled-back trial, applied the exact observed-schema upgrades, and verified preservation and the retained result. No fresh RDS query was made during the Nov 11 application deployment.

| Observed upgrade | Applied SHA-256 |
| --- | --- |
| 023 | `68b8f3d9f4ad257868933e9e5371a256a78bd08efedf692b343bd10c1e117b9d` |
| 024 | `c6cc6904edf0dfa4df9eab09c45bcecca9ba4529cc15204f30026d29fd3b88fa` |

Confirmed policies for curricula **61 and 66, version 1**, were published only for the existing bound **2569/1 test round**, with criteria ID `TU_CS_2568_CONFIRMED_2026_11_08`. Original business-row fingerprints, submissions/history, schedules, assignments and migration records were preserved. No Student academic certification or Committee decision was fabricated. Review dates were absent at that inspection and were not set by the owner operation.

Post-operation catalog hash: `35ab5e31aaad3c66241d44fae6542fccae79401d0c893f2d1c518a8c5acc684f`. Backup snapshot `coed-pr175-preupgrade-77894d95cdc5` was available before Apply and is retained. Temporary owner Lambda/versions, role/policy, endpoint grant and temporary logs were removed; cleanup was verified. That operation left application versions at API13/frontend37.

The preparation's 16 unit checks and 8 disposable PostgreSQL checks are **prior evidence**, not tests rerun during the Nov 11 application release. See [confirmed criteria](../api/v4-confirmed-academic-criteria.md) for the academic contract.

## Application deployment — Nov 11

| Target | Verified outcome |
| --- | --- |
| AWS account / Region | `130165494095` / `ap-southeast-2` |
| `coed-api:live` | **15**, code hash base64 `2qYyNNj5j3IZNS6Dsm+gOsmwAMB+ueivJsaXDapV8Vk=` |
| Compatible recovery version | **14**, same code with browse-only gates; never routed live |
| Amplify app / branch | `d1bpmj87vmjb96` / `main` |
| Amplify manual job | **38**, `SUCCEED`; auto-build remains disabled |
| TU broker / private issuer | **5 / 4**, unchanged |

The prior live baseline was API13/frontend37. API15 preserves API13's environment exactly, including pre-existing `COED_API_MAINTENANCE=off`, routed-TU audience and controls settings. The earlier proposed restricted `intake-pilot`/read-only cutover was not executed, following the explicit Committee decision above. Retained pilot variables do not make pilot-only restrictions globally active in normal mode. Normal identity, role, ownership, scope, state and schedule checks still apply.

Gateway routes, integrations and CORS, and TU configurations/aliases matched their baselines. Gateway integrations retain qualified `coed-api:live` and `coed-tu-auth:live` targets. No RDS, IAM, account binding, network or storage change was made by this application deployment.

### Artifact binding

| Artifact | Bytes / entries | SHA-256 |
| --- | --- | --- |
| Backend ZIP | 789,771 / 21 | `daa63234d8f98f7219352e83b26fa03ac9b000c07eb9e8af26c6970daa55f159` |
| Frontend ZIP | 4,624,311 / 99 | `017663db45d1bc7b2a8c37f9d0da49c1bd912aa8c6fcae3fb3f25628c5fd96c4` |

Candidate input hash: `ebcdc7caf8e826da49f96e4f491d3fb9ce991734bc3ef28c36764b609b1fbda9`. The public CA bundle matched the prior bundle. Additional packaged TU artifacts were not deployed.

The website served these exact candidate hashes after deployment:

| Asset | SHA-256 |
| --- | --- |
| `runtime-config.js` | `12dc27be782d5a338f69ad06cb18466034712f7c819005e8ea6c6a2f65ab95e2` |
| `assets/authenticated-shell.js` | `bf2bc8e05db441692ec833844d18f73a82b3523bba7699caf458cdcf7fca8e8c` |
| `assets/authenticated-shell.css` | `e6a565bb3102b9aa9b8769cc0a791201523042441484b1da34173178f65bd09e` |

### Guarded staging stop and recovery

The first staging attempt published browse-only version14 and passed its eight probes. It then stopped with `PreconditionFailedException` before changing the live alias or frontend: publishing a version changed `$LATEST`'s revision, while the one-off operator still held the pre-publication revision. Live remained API13/frontend37.

The operator was corrected to refresh the revision only after asserting the exact owned code, environment and immutable configuration. Its mock now advances revisions on publication. Recovery checked the original live alias, frozen version14 and successful probe evidence, source/artifact hashes, unchanged TU/Gateway state, and the exact stopped configuration before continuing with a fresh revision. It published/probed version15, conditionally switched the alias, deployed job38 and verified final state. No concurrency guard was disabled and no additional permission was added.

## Verification during the application release

- Node.js 22 dependencies were installed with `npm ci --offline`. The corrected one-off deployment/recovery operator passed **8/8** local tests.
- Both numeric API versions passed **8 probes each**: public directory read; unauthenticated direct and TU-proxy session reads; Coordinator options/tracking reads; and unauthenticated review, application-submit and Committee commands using a synthetic nonexistent ID. Normal15 returned 401 for protected requests; browse14 returned 503 for the gated requests. These probes did not authenticate users or create business data.
- Through the actual Gateway, public directory returned 200; direct session, TU-proxy session and Coordinator options returned 401; TU-proxy preflight returned 204 with the exact allowed Amplify origin. This five-request smoke was repeated during final verification.
- Live alias/code/environment, Amplify job status, three served assets, and unchanged TU/Gateway configuration were read back successfully.

These are deployment and transport checks. They **do not** prove genuine TU login, Cognito authentication, academic certification, forwarding, Committee finalization, private-document access or Student acceptance. No fabricated authenticated claims were used. Earlier local preview screenshots use synthetic fixtures and remain separate evidence.

## Owner browser acceptance still needed

Use the [deployed workspace](https://main.d1bpmj87vmjb96.amplifyapp.com/app.html) with the assigned accounts:

1. Coordinator opens **กำหนดการและช่วงเวลายืนยันสิทธิ์** and sets **ช่วงพิจารณาใบสมัคร** through the existing form. Dates must satisfy the server's ordering and round rules.
2. Student submits a complete application; Coordinator verifies the latest evidence and academic criteria before forwarding. Incomplete/unknown evidence must remain blocked.
3. Committee uses its existing capacity/selection/finalization flow.
4. Coordinator opens **ติดตามการพิจารณา**. Verify confirmed totals and both outcome lists, and verify pending results remain unknown. Committee confirmation is distinct from Student publication.

Do not count these steps as passed until performed and recorded with genuine sessions. Application deployment did not choose dates or alter assignments for the owner.

### ขั้นตอนทดสอบผ่านหน้าเว็บ

ใช้รอบ 2569/1 และบัญชีที่ได้รับมอบหมาย ตรวจชื่อรอบบนแต่ละหน้าก่อนทำรายการ เวลาในฟอร์มเป็นเวลาประเทศไทย

| ลำดับ | ผู้ทดสอบทำอะไร | ผลที่ต้องตรวจ |
| --- | --- | --- |
| 1 | Coordinator เปิดหน้ากำหนดการ โหลดค่าล่าสุด และดูสถานะรับสมัครจากแผงด้านบน | รอบที่เลือกอยู่ในขอบเขตที่รับผิดชอบและเปิดรับในเวลาที่จะให้ Student ส่ง |
| 2 | Coordinator กำหนดเริ่ม/สิ้นสุดช่วงพิจารณาตามเวลาที่ต้องการ บันทึก แล้วโหลดกำหนดการล่าสุดอีกครั้ง | วันเวลาตรงกับที่บันทึก วันสิ้นสุดอยู่หลังวันเริ่ม และไม่เกินวันเริ่มยืนยันสิทธิ์ที่มีอยู่ |
| 3 | Student เข้าด้วย TU เลือกรอบ กรอกใบสมัคร ยืนยันคำรับรองและเกณฑ์ล่าสุด แนบ Resume/CV, Transcript, รูปนักศึกษา และใบรับรองความประพฤติ แล้วกดส่ง | มีสถานะส่งเข้าคิวผู้ประสานงาน พร้อมหลักฐานการส่งจาก server |
| 4 | Coordinator เปิดใบสมัครนั้น ตรวจข้อมูลและดาวน์โหลดเอกสารเทียบกับที่ Student ส่ง | เห็นฉบับและเอกสารตรงกัน ถ้าต้องแก้ให้ส่งกลับ ระบุเหตุผล แล้วให้ Student แก้และส่งฉบับใหม่ภายในกำหนด |
| 5 | Coordinator ตรวจหลักฐานทั้งหกหมวด บันทึกหมายเหตุและผลรับรอง แล้วกดรับเรื่องและส่งต่อกรรมการ | รับรองได้เมื่อเกณฑ์และหลักฐานครบ ส่งต่อได้ภายในช่วงพิจารณา และมีสถานะส่งต่อสำเร็จ |
| 6 | Committee ที่ได้รับมอบหมายเปิดรายชื่อ ตรวจใบสมัครและเอกสาร ใช้ขั้นเสนอจำนวนรับ/ลงมติและยืนยันรายชื่อตาม flow ที่มีอยู่ | เห็นฉบับที่ Coordinator ส่งต่อ และมีผลยืนยันรายชื่อที่บันทึกแล้ว |
| 7 | Coordinator เปิดติดตามการพิจารณา กดโหลดผลล่าสุด และตรวจทั้งรายชื่อที่ได้รับ/ไม่ได้รับคัดเลือก | ยอดและรายชื่อตรงกับผล Committee ที่ยืนยัน ก่อนยืนยันผล Dashboard ต้องแสดงว่ายังรอมติ |

หากขั้นใดถูกปิด ให้เก็บข้อความหรือรหัสข้อผิดพลาดกับบทบาทและชื่อขั้นตอนเพื่อตรวจต่อ การผ่านแต่ละขั้นให้บันทึกวันเวลาและผลโดยละข้อมูลส่วนตัว เอกสาร รหัสผ่าน และ token ออกจากหลักฐานใน Git

## Recovery and handoff

Version14 is the same-code browse-only recovery option if mutations need to be closed. Retain schema/history; do not blindly restore the database or repoint an old writable API over newer submissions/reviews. Any recovery write needs its own approved operation.

The actual prior API13 artifact has SHA-256 `01e45d0d878dacdfe6773729874d1d00c2a70938b2bcc8628acc8706ff1b5bce`; the retained actual frontend37 artifact has SHA-256 `9d887edf0957bf357abc22a16281a6d058bfbf8a8ab7dc96638c7a866e312e7e`. These are historical artifact identities, not instructions to roll back now.

Private manifests/configuration, signed upload URLs and operator checkpoints remain ignored/local-only under the release-candidate workspace. The one-off staging/recovery tools are not a tracked reusable deployment interface and are not guaranteed to exist in a teammate's clone. This sanitized report records the source, artifact and AWS target bindings without exposing credentials, private UUID bindings or Student records. Use [current deployment](current-deployment.md) for the current snapshot and [intake verification](student-intake-verification.md) for earlier dated evidence.
