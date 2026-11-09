# Repository map — แต่ละโฟลเดอร์มีไว้ทำอะไร

แผนที่ source ที่ติดตามใน Git และไฟล์ local ที่อาจสร้างขึ้นระหว่างทำงาน อ่านคู่กับ [README](../README.md), [คู่มือ AI](../AGENTS.md) และ [สารบัญเอกสาร](README.md) แผนที่นี้ช่วยหาไฟล์ ไม่ได้บอกว่าทุกฟีเจอร์เปิดบน AWS แล้ว ดู [V4 architecture](architecture/G03-V4-architecture.md) สำหรับ data flow และ [Current deployment](operations/current-deployment.md) สำหรับสถานะที่เคยตรวจยืนยัน

## 1. ไฟล์ระดับ root และโฟลเดอร์หลัก

หน้าเว็บ public ยังมี source อยู่ที่ root **ไม่ได้ย้ายทุกอย่างเข้า `src/frontend/`** และไฟล์ชื่อ V2/V3 บางส่วนยังใช้เพื่อ compatibility จึงไม่ควรย้าย/ลบเพียงเพราะดูเป็นรุ่นเก่า

| ตำแหน่ง | เก็บอะไร / ใช้ทำอะไร |
| --- | --- |
| [README.md](../README.md) | ภาพรวมระบบ เริ่มพัฒนา tree ย่อ และลิงก์รายละเอียด |
| [AGENTS.md](../AGENTS.md) | กติกาสำหรับ AI, read order, safety boundaries และเลือก tests ตามงาน ไม่ใช่ที่เก็บรายละเอียดทุกโมดูล |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | การตั้ง branch/commit, เปิด PR, review และ merge |
| `index.html`, `requirements.html`, `company-directory.html`, `faq.html` | Source หน้า public: หน้าแรก ข้อกำหนด บริษัท และคำถามที่พบบ่อย |
| [app.html](../app.html) | Entry HTML ของพื้นที่ผู้ใช้; logic หน้าจอหลักอยู่ใน `src/frontend/` |
| `style.css`, `company-directory.js`, `company-directory-helpers.js`, `navbar-auth.js`, `runtime-config.js` | Styles/logic/config ระดับ root ที่เกี่ยวกับหน้า public และการเข้าสู่พื้นที่ผู้ใช้; อ่าน build script ก่อนเปลี่ยน เพราะบางไฟล์ถูก copy/bundle และ runtime config ใน `dist/` ถูกสร้างใหม่ |
| [package.json](../package.json), `package-lock.json`, `.nvmrc`, `jest.config.cjs` | คำสั่ง npm, dependency lock, Node version และ Jest configuration |
| [compose.dev.yml](../compose.dev.yml) | PostgreSQL จำลองเฉพาะ loopback สำหรับ local development/test ไม่ใช่ RDS deployment |
| [amplify.yml](../amplify.yml) | สูตร CI build ของ Amplify ถ้ามีการเรียกใช้ ไม่ใช่หลักฐานว่า auto-build เปิดอยู่หรือว่ารุ่นใด Deploy แล้ว |
| `.env.example`, `.gitignore`, `.gitattributes` | ตัวอย่างชื่อ config, กติกาไม่เก็บไฟล์ local/private และกติกา line endings; ห้ามใส่ค่าลับจริงในตัวอย่าง |
| `DESIGN.md`, `UX-CONTRACT.md` | แนวทางออกแบบ/UX ประกอบงาน อ่านร่วมกับข้อกำหนด/source รุ่นที่ทำ ไม่ใช้แทน authorization หรือ deployment evidence |
| `.github/` | Workflow ตรวจ PR/main และ PR template; [V4 verification](../.github/workflows/v4-verification.yml) ระบุ tests และฐาน disposable ของ CI |
| `config/` | Public deployment target เช่น [v4-public.json](../config/v4-public.json); `config/iam/` เป็น IAM policy/trust templates ไม่ใช่ credentials หรือรายการสิทธิ์จริงที่ตรวจสด |
| `data/` | ชุดข้อมูลบริษัท/โลโก้และ synthetic fixtures V2/V3 ไม่ใช่ไฟล์ dump ของบัญชีหรือเอกสารนักศึกษาจริง |
| `resources/images/` | โลโก้ ภาพบริษัท/banner/ภาพประกอบ; `company-logos/` เป็น assets ที่ใช้ใน directory ไม่ใช่เอกสารแนบใบสมัคร |

`data/companies.json` และ `data/company-logos.json` ใช้กับข้อมูลสถานประกอบการ ส่วน `data/v2/mock-dataset.json` และ `data/v3/fixtures.json` เป็นชุดจำลองสำหรับพัฒนา/ตรวจ contract การแก้ dataset ใน Git ไม่ได้เขียนข้อมูลนั้นลง RDS ทันที และการ import/seed จริงต้องมีขอบเขตแยก

## 2. src/ — โค้ดที่ระบบใช้ทำงาน

### Entry points

| ไฟล์ | หน้าที่ |
| --- | --- |
| [src/server.js](../src/server.js) | เปิด HTTP API ใน Node/local runtime ไม่ได้สร้าง trusted Gateway claims ให้อัตโนมัติ |
| [src/lambda.js](../src/lambda.js) | Adapter/entry ของ API Lambda แปลง event เข้าสู่ระบบ API และขอบเขต auth |
| [src/tu-auth-broker.js](../src/tu-auth-broker.js) | Entry ของ TU broker สำหรับ login/status/registration แยกจาก API และ private issuer |
| [src/tu-session-issuer.js](../src/tu-session-issuer.js) | Entry ของ private issuer ที่เชื่อม identity/registration กับฐานและออก session |
| [src/maintenance.js](../src/maintenance.js) | Route allowlist ตาม deployment stage ไม่ใช่สวิตช์ UI อย่างเดียว |

### API, authentication และข้อมูล

| โฟลเดอร์ | ตัวอย่างไฟล์/เนื้อหา | ใช้ทำอะไร / ขอบเขต |
| --- | --- | --- |
| `src/api/` | `app.js`, `router.js`, context/errors/response | ประกอบ HTTP API, dispatch route, request context และรูปแบบ error/response |
| `src/api/routes/` | `application-routes.js`, `coordinator-routes.js`, `student-profile-routes.js` | ผูก HTTP method/path กับ handler, parse/validate input และเรียก service ไม่ควรวาง workflow ทั้งหมดไว้ใน frontend |
| `src/api/services/` | `application-service.js`, `intake-control-service.js`, `coordinator-workspace-service.js` | กฎธุรกิจ/สิทธิ์/state/version/transaction เช่น ส่งใบสมัคร ตรวจปลายทาง และเปิด/ปิดรับ |
| `src/auth/` | `identity-resolver.js`, `tu-broker-service.js`, `tu-registration-service.js`, `tu-bridge.js` | ตรวจ TU/Cognito/session, resolve internal identity, controlled onboarding และ whitelist Student proxy; ห้ามใส่ mock login bypass เพื่อแก้ production error |
| `src/db/` | connection/migrate/seed, `phase1-delivery.js`, `phase1-intake.js`, `intake-control.js` | เชื่อม PostgreSQL และ data/locking helpers ที่ service ใช้; ไม่ใช่ให้ browser เชื่อม DB ตรง |
| `src/db/repositories/` | `application-repository.js`, `student-profile-repository.js` | SQL/data access ของแต่ละ domain แยกจาก HTTP rendering |
| `src/db/migrations/` | reviewed fresh/workspace SQL 001–014, 017 และส่วนขยายใหม่ 023 | สร้าง/พัฒนาฐานตาม lineage นี้; ไฟล์ประวัติ immutable ไม่ใช้แทน observed live 014/015 ที่หายไป; 023 ยังไม่ Deploy |
| `src/db/upgrades/` | observed-schema SQL 018–022 | Forward upgrades สำหรับ baseline RDS ที่ตรวจไว้ มี catalog/history/checksum/approval gates แยกจาก migrator ทั่วไป |
| `src/db/operations/` | `v3-runtime-grants.sql`, `018-observed-runtime-grants.sql` | SQL สำหรับสิทธิ์ runtime ของแต่ละ baseline ไม่ใช่คำสั่งให้ทุกคนรันซ้ำ |
| `src/db/proposals/` | `phase1_intake_controls.sql` | SQL copy สำหรับทบทวน proposal ไม่ใช่ migration ที่ต้อง Apply เพิ่มอีกรอบ |
| `src/db/verification/` | `002_v3_forward_only_verification.sql` | SQL assertions/verification ของงาน schema ตามรุ่น ไม่ใช่ fixtures |
| `src/shared/` | `application-form.js`, `application-access.js`, `intake-control.js`, `phase1-schedule.js` | Form/constants/evaluation ที่ frontend/backend ใช้ร่วมกัน; การตรวจฝั่ง browser ไม่แทน server authorization |
| `src/storage/` | `application-document-store.js`, `local-document-store.js`, `s3-document-store.js` | Contract/adapters สำหรับไฟล์แนบ local และ private S3; ไฟล์ผู้สมัครจริงไม่อยู่ใน `resources/` หรือ `data/` |

**SQL สอง lineage ไม่ใช่ chain 001–022 ที่รันรวดเดียว** ดู [architecture: database lineages](architecture/G03-V4-architecture.md#database-lineages) ก่อนแตะ SQL ห้ามใช้ general migrate/seed/reset กับ RDS หรือแก้ประวัติ/checksum เพื่อให้ gate ผ่าน

### Frontend แยกตามพื้นที่ทำงาน

| ตำแหน่ง | เก็บอะไร / ใช้ทำอะไร |
| --- | --- |
| `src/frontend/` ระดับบน | Entry/shell/routes, authenticated styles, directory client และ shared navbar เช่น `app.js`, `shell-app.js`, `routes.js` |
| `src/frontend/auth/` | Cognito client/session/error handling และ TU onboarding view |
| `src/frontend/student/` | โปรไฟล์ ใบสมัคร Phase 1/editor/client/receipt/recovery และแผนบริษัท legacy; ระวังไม่ปน application กับ plan |
| `src/frontend/coordinator/` | คิว/รายละเอียด/เอกสาร, intake controls, ฟอร์มกำหนดการสามช่วงเดิมใน `workspace.js` และ `academic-review.js` ตรวจรับรองหลักฐานแยกจากต้นฉบับ |
| `src/frontend/committee/`, `src/frontend/selection/` | Ranking/meeting workspace และ selection views; มีโค้ดไม่เท่ากับเปิดใช้/ตรวจรับครบ |
| `src/frontend/staff/`, `src/frontend/advisor/` | หน้าจอ/clients ของ workflow แผนเดิมและการอ่านรายที่ได้รับมอบหมาย |
| `src/frontend/workflow/` | Views/client ของ workflow และ Admin operations ที่ใช้ร่วมกับพื้นที่เดิม |
| `src/frontend/ui/` | Presentation helpers ที่ใช้ร่วมกัน เช่น `workspace-presentation.js` ไม่ใช่ backend permission policy |

แก้ source แล้วทดสอบ/build ใหม่ อย่าแก้ `dist/assets/authenticated-shell.js` เพื่อให้ดูเหมือนแก้ source แล้ว การเปลี่ยน UI อย่างเดียวไม่ปลดข้อจำกัดฝั่ง API/DB/maintenance

## 3. scripts/ — เครื่องมือ ไม่ใช่ runtime ทุกไฟล์

ส่วนขยายตรวจรับรองก่อนส่ง Committee ใช้ `src/api/services/academic-review-domain.js` คำนวณ,
`src/db/academic-review.js` ตรวจผลบันทึก/เกณฑ์ล่าสุด และ `src/shared/review-access.js` จำกัด stage;
`src/shared/faculty-criteria.js` เป็นแหล่งเกณฑ์ที่เจ้าของยืนยันและข้อมูลสำหรับเตรียม policy รุ่นใหม่ โดยไม่เขียน RDS;
`scripts/operations/academic-review-contract.mjs` ตรวจ hash ของ fresh/observed 023 โดยไม่ Apply SQL
ดู [contract](api/v4-academic-review.md) และ [local evidence](operations/academic-review-verification.md) ก่อนเตรียม release

| ตำแหน่ง | เก็บอะไร / ใช้ทำอะไร |
| --- | --- |
| `scripts/` ระดับบน | Build frontend/V4, bundle test modules, package Lambda/TU/candidate ZIP, lint และตรวจ dataset/docs เช่น `build-v4.mjs`, `package-v4-candidate.mjs`, `verify-doc-links.mjs` |
| `scripts/local-dev/` | เตรียม local fixtures/Compose, API, synthetic signed tokens และ test wrapper; ไม่มีการสร้างผู้ใช้ Cognito จริง ดู [Team Dev/Test](operations/team-dev-test.md) |
| `scripts/ui-preview/` | Preview server UI/scenarios/fixtures ใน memory สำหรับออกแบบและ interaction tests ไม่บันทึก RDS/S3 หรือพิสูจน์ Login จริง |
| `scripts/operations/` | Catalog/migration readers, reviewed release gates, diagnostic/upgrade/deploy/smoke controllers และ historical ops tools; บางไฟล์เขียน AWS/DB ได้ จึงต้องอ่าน scope/guards และได้รับอนุมัติก่อน |
| `scripts/operations/baselines/` | Baseline metadata ที่เครื่องมือใช้เปรียบเทียบ schema ไม่ใช่ database backup หรือ snapshot สด |
| `scripts/operations/intake-readiness/`, `tu-preflight/`, `tu-identity-diagnostic/` | เครื่องมือตรวจ readiness/schema/identity แบบมี contract และ cleanup; แม้ตรวจ DB อ่านอย่างเดียว การสร้าง Lambda/role ชั่วคราวยังเป็น AWS write |
| `scripts/operations/intake-controls-owner/`, `tu-owner/`, `tu-registration/`, `tu-registration-issuer/` | เครื่องมือ privileged แบบจำกัดคำสั่งสำหรับงาน owner/migration ที่อนุมัติ แยกจากสิทธิ์ runtime |
| `scripts/operations/tu-production/` | Package/deploy/probe/smoke ของ TU rollout ตาม phase; ไม่ใช่ให้ teammate รันทุกไฟล์ต่อกันหรือใช้ checkpoint เก่า |

ชื่อไฟล์ `operator`, `read`, `verify` หรือการอยู่ใน repository **ไม่ใช่หลักฐานว่าคำสั่ง read-only/ปลอดภัยกับทุก target** ตรวจ source, manifest, baseline และขอบเขตล่าสุดเสมอ Packaging สร้าง artifact ในเครื่อง ไม่ Apply SQL หรือ Deploy โดยอัตโนมัติ

## 4. tests/ — ตรวจอะไรและใช้ข้อมูลไหน

- ไฟล์ `.test.js`/`.test.mjs` ระดับบนครอบคลุม unit, DOM/UI, API contract, auth boundaries, DB integration, packaging และ deployment-tool safety จึงต้องดูแต่ละ suite ไม่อนุมานจากนามสกุลไฟล์อย่างเดียว
- `tests/helpers/` เก็บ helper สร้าง observed-schema fixtures และอ่าน reviewed migrations เช่น `present-schema-fixture.mjs`; เป็นข้อมูลจำลองสำหรับฐานทดสอบ ไม่ใช่ไฟล์ repair RDS
- `tests/operations/` เก็บ Python operator/smoke safety tests รวมถึงการจำกัด target/SQL/credentials ไม่ใช่บันทึกผลจาก production
- [package.json](../package.json) กำหนดคำสั่งแต่ละชุด ส่วน [.github/workflows/v4-verification.yml](../.github/workflows/v4-verification.yml) เป็นตัวอย่าง CI ที่แยก PostgreSQL disposable

DB tests อาจ reset fixtures ต้องใช้ฐาน local ชื่อ/flags ตรงตาม guard และไม่ใช้ข้อมูลที่ต้องเก็บ `test:local` ยังไม่ได้ตั้งทุกตัวแปรของ suite ใหม่ การ skipped ไม่ใช่ผ่าน อ่าน [intake verification](operations/student-intake-verification.md) ก่อน full regression; DOM tests ไม่ใช่ rendered Desktop/Mobile QA

## 5. docs/ — แยกหน้าที่เอกสาร

| โฟลเดอร์/ไฟล์ | เก็บอะไร / ใช้ทำอะไร |
| --- | --- |
| `docs/README.md`, `repository-map.md` | สารบัญตามสถานะ และแผนที่โฟลเดอร์ที่กำลังอ่าน |
| `docs/architecture/` | โครงสร้าง/trust boundaries และภาพ V1–V4; เริ่ม `G03-V4-architecture.md` ไม่ใช่ถือว่ารูปเก่าครอบคลุม TU ล่าสุด |
| `docs/decisions/` | บริบท ทางเลือก เหตุผลและ tradeoffs พร้อมระบุสิ่งที่ถูกแทนที่ |
| `docs/api/` | API/workflow/form contracts ตามรุ่น เป็นข้อตกลง ไม่ใช่ AWS feature flag |
| `docs/operations/` | คู่มือ local/operator, ข้อเสนอ rollout, snapshot Deploy และ verification; ดูประเภท/วันที่ของแต่ละไฟล์ |
| `docs/evidence/` | หลักฐานผลตรวจ/ข้อจำกัดของ Issue/phase ณ เวลานั้น ไม่ rewrite ผลเก่าให้เหมือนสถานะใหม่ |
| `docs/data/` | ที่มา/schema/validation ของ datasets และ fixtures ไม่ใช่เอกสารส่วนตัวนักศึกษา |
| `docs/database/` | บันทึกงานฐาน/การกู้หรือแก้ migration เช่น V3 migration002; เป็นประวัติตาม baseline ไม่ใช่คำสั่งให้ Apply กับ RDS ปัจจุบันทันที |
| `docs/design/`, `docs/frontend/` | Design/interaction/frontend contracts และคู่มือ Preview/หน้าจอ เฉพาะรุ่น/ส่วนที่ระบุ |
| `docs/plans/`, `docs/verification/` | Local planning/working artifacts ที่ `.gitignore` ยกเว้นไว้ อาจไม่มีใน clone ของเพื่อน; เอกสาร handoff ที่ทีมต้องใช้ต้องอยู่ใน tracked docs |

## 6. Generated, local และ private files

รายการนี้แยกจาก source ที่ควรแก้ บางรายการไม่มีจนกว่าจะ install/build/run:

| ตำแหน่ง | ที่มา/ข้อควรระวัง |
| --- | --- |
| `node_modules/` | Dependency ที่ `npm ci` ติดตั้ง ไม่แก้แทน dependency/source และไม่ commit |
| `dist/` | ผล frontend build เช่น `assets/` bundle และ runtime config; build ใหม่ได้ ไม่ใช่หลักฐานว่า Amplify ใช้ bundle นี้ |
| `tmp/frontend-test-modules/` | Bundle/module สำหรับรัน frontend tests |
| `tmp/local-dev/`, `tmp/application-documents/` | Session/ไฟล์ local จำลองตาม tooling ไม่คัดลอกเป็น production data |
| `tmp/release-candidates/`, `tmp/release-trust/` | Candidate ZIP/manifest และ public trust material ที่ local tooling ใช้; ตรวจ source/hash/config ก่อนเสนอ release |
| `tmp/tu-production/`, `tmp/read-only-browse/` | Private checkpoints, bindings, rollback artifacts หรือ one-off tooling ของงานเก่า ไม่รับประกันว่ามีใน clone อื่น และห้ามเผยแพร่ raw contents |
| `.env`, `.env.*.local` | Local settings ที่อาจมี secrets; ไม่ commit หรือใส่ใน frontend ZIP |
| `.git/` | Git metadata/refs/index ไม่ใช่ application source; ใช้คำสั่ง Git ไม่แก้ไฟล์ข้างในเอง |
| `.agents/`, `.codex/`, Python `__pycache__/` และ tool caches ถ้ามี | ข้อมูลเฉพาะเครื่อง/เครื่องมือ ไม่ใช่ระบบที่ Deploy; ไม่เพิ่มเข้า Git โดยอัตโนมัติ |

**ไม่ใช่ทุกไฟล์ใต้ `tmp/` ถูก ignore เหมือนกัน** ตรวจ [.gitignore](../.gitignore) และ `git status` ก่อน add/commit เสมอ ไฟล์ที่ไม่ถูก ignore ก็ไม่ได้แปลว่าปลอดภัยจะเผยแพร่ ห้ามใช้ `git add .` โดยไม่ตรวจ credentials/ข้อมูลส่วนตัวก่อน

## 7. จะทำงานนี้ ควรเริ่มตรงไหน

| งาน | เริ่มจาก | ตรวจต่อ |
| --- | --- | --- |
| ปรับหน้ากรอก/สถานะใบสมัคร | `src/frontend/student/application-*.js`, `src/shared/application-form.js` | Application API/service, receipt และ focused UI/DB tests |
| แก้ TU Login/ลงทะเบียน | `src/auth/`, broker/issuer entries | Identity mapping, signing/config contracts, actual database tests; ไม่เพิ่ม fallback เลือก Student คนอื่น |
| แก้การเปิด/ปิดรับ | `src/frontend/coordinator/intake-controls.js`, `src/api/services/intake-control-service.js` | Shared time evaluator, DB locks/audit, maintenance/pilot gates และ controls tests |
| แก้แนบ/ดู/ดาวน์โหลดเอกสาร | `src/frontend/student/`, `src/frontend/coordinator/detail.js`, `src/storage/` | Authorization, retained document metadata, MIME/filename, actual-byte tests |
| เพิ่ม API/กฎธุรกิจ | `src/api/routes/` → `src/api/services/` → repositories/helpers | Auth/scope/state/version/transaction และ route inventory/contract tests |
| เปลี่ยน schema/สิทธิ์ฐาน | ระบุ lineage ใน architecture ก่อน แล้วดู `src/db/` และ release gates | Forward SQL, preservation/rollback tests และ approval แยกก่อน AWS |
| ปรับข้อมูลบริษัท/โลโก้ | Root directory UI, `data/`, `resources/images/company-logos/` | Import/dataset/API privacy tests ไม่เผยแพร่ข้อมูลผู้ติดต่อส่วนตัว |
| อัปเดตเอกสาร/ส่งต่อ | README, docs index และเอกสารที่ตอบคำถามนั้น | `npm run test:docs`, แยก code/deployed/verified และคง history |

เมื่อเพิ่ม/ย้ายโฟลเดอร์ที่มีหน้าที่ใหม่ ให้อัปเดต map นี้กับ tree ย่อใน README ตามความเหมาะสม ไม่ต้องไล่ชื่อทุกไฟล์ ไม่ทำสำเนารายละเอียดทั้งหมดไว้ทั้ง README และ AGENTS

การตั้งช่วงพิจารณาใช้ฟอร์มสามช่วงเดิมใน `src/frontend/coordinator/workspace.js`; เมื่อแก้ได้เฉพาะช่วงพิจารณาจะคงส่วนอื่นเป็นข้อมูลอ้างอิง,
`src/db/review-schedule.js` ตรวจ capability และ `scripts/operations/review-schedule-contract.mjs`
ตรวจ hash ของ fresh/observed 024 โดยไม่ Apply SQL; ดู [contract](api/v4-academic-review.md#independent-review-window-setup-local-source-2026-11-10)
และ [verification](operations/review-window-verification.md)

Dashboard ผล Committee ที่หน้า Coordinator ใช้ `src/api/services/coordinator-results.js`
ตรวจ retained applicant/version และสรุปผลแบบอ่านอย่างเดียวผ่าน tracking API เดิม;
`src/frontend/coordinator/results-dashboard.js` แสดงจำนวน/รายชื่อด้วย shared Coordinator components
ดู [contract](api/v4-coordinator-results.md) และ [verification](operations/coordinator-results-verification.md)
