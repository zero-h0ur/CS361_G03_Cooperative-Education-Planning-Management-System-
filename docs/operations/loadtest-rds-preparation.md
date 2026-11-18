# เตรียมฐาน Load Test — งานของรณกฤต

สถานะล่าสุด 2026-11-18: **B1/B2a/B2b ฐานทดสอบ/schema/runtime/ข้อมูลผ่านและถอนเครื่องมือชั่วคราวแล้ว** ดู [B2b acceptance และข้อจำกัด](loadtest-b2b-data.md) แยกจากหัวข้อ local/ข้อเสนอเดิมด้านล่าง เอกสารไม่ใช่การอนุมัติให้รันซ้ำ ลบ AWS หรือยิงโหลด เริ่มจาก [architecture](../architecture/G03-V4-architecture.md), [repository map](../repository-map.md) และ [ขอบเขตการทดสอบ local](student-intake-verification.md) ก่อนใช้งาน

อัปเดต B1, 2026-11-17: เจ้าของอนุมัติ **สร้างโครงสร้างฐานว่างแยกก่อนเท่านั้น** ดู [B1 infrastructure snapshot](loadtest-b1-infrastructure.md) ไม่ครอบคลุม SQL/runtime role/data/API/Locust และไม่ทำให้ CLI local รันกับ RDS ได้ หัวข้อ AWS ด้านล่างยังเป็นข้อเสนอของขั้นที่ไม่อนุมัติ

อัปเดต B2a, 2026-11-18: เจ้าของอนุมัติเพิ่มเฉพาะ isolated schema/runtime/app Secret ด้วยเครื่องมือชั่วคราวและ additive endpoint changes ดู [B2a scope/evidence](loadtest-b2a-bootstrap.md) แยกจาก CLI local เดิม บริษัท/10บัญชี/API/load และการลบหลังคาบยังต้องรับ inputs/ขอบเขตต่อ ไม่ใช้ข้อเสนอด้านล่างเป็นคำสั่ง Apply ทุกขั้น

## 1. ทำอะไร และไม่ทำอะไร

แผนทีมเลือกแยกระบบทดสอบ: API Gateway/Lambda ทดสอบใช้ RDS ทดสอบอีก instance หนึ่ง ข้อมูลทั้งหมดเป็น synthetic ไม่ clone ฐานจริง ไม่ใช้ข้อมูลนักศึกษา/เอกสารจริง และไม่ยิง TU API ใน Locust รณกฤตรับผิดชอบฐาน โครงสร้างตาราง การผูกบัญชีจำลอง การนำข้อมูลบริษัทเข้า การอ่านตัวเลข DB และขั้นล้างทรัพยากรหลังคาบ

| ผู้รับผิดชอบ | งาน / สิ่งที่ต้องส่งต่อ |
| --- | --- |
| รณกฤต | Test DB/schema/runtime identity, ตรวจ JSON บริษัท, bind บัญชีทดสอบ, ตรวจ counts/API compatibility, DB monitoring/cleanup |
| ปพนพัชร์ | Test Lambda/API, networking/IAM ที่เกี่ยวกับ runtime, dashboard, quota/credits, Locust และ stack lifecycle |
| ณัษฐภาคย์ | บัญชี Cognito ทดสอบและ Hosted UI tokens; ส่ง issuer/subjects แบบส่วนตัว ไม่ส่ง passwords/token เข้า Git |
| ภูริณัฐ | Generator บริษัท 300–500 รายการ, smoke/API scenario และคำอธิบายสถาปัตยกรรม |

เครื่องมือเดิม `database.mjs`/`prepare-db.mjs` **ไม่มี AWS SDK/คำสั่ง remote Apply/Delete** และยังจำกัด loopback ส่วน `b2-*`/`b2b-*` เป็นเครื่องมือ AWS ตามอนุมัติแต่ละรอบแยก มี guard/expiry/cleanup ไม่ใช่ general seed หรือคำสั่งรันซ้ำบนฐานที่มีข้อมูล ไม่สร้าง Cognito users ไม่รับรหัสผ่านผู้ใช้ ไม่เปลี่ยน production Lambda/maintenance และไม่ใช่ Locust runner ส่วน lab Autoscaling ใน AWS Academy ต้องทำรายบุคคล; การทดสอบนี้ไม่ถือว่าทำ lab แล้ว

## 2. ไฟล์และคำสั่ง

| ไฟล์ | หน้าที่ |
| --- | --- |
| [database.mjs](../../scripts/loadtest/database.mjs) | Validate input/target, checksum แหล่ง source และ fresh migrations, prepare/verify เฉพาะ loopback |
| [prepare-db.mjs](../../scripts/loadtest/prepare-db.mjs) | CLI `plan`, `trial`, `apply`, `check`; output เป็น counts/hash/code ไม่พิมพ์ bindings |
| [runtime-grants.sql](../../scripts/loadtest/runtime-grants.sql) | สิทธิ์ขั้นต่ำสำหรับ directory + legacy Draft Plans ในฐานจำลองใหม่เท่านั้น ไม่ใช่ replacement ของ grants production |
| [manifest.example.json](../../scripts/loadtest/manifest.example.json) | ตัวอย่างทั้งหมดเป็นค่าจำลอง ไม่มีบัญชี Cognito ใช้งานจริง |
| [test-local.mjs](../../scripts/loadtest/test-local.mjs) | สร้าง PostgreSQL cluster ใหม่ใน `tmp/loadtest/`, bind loopback, รัน DB tests แล้วหยุด cluster; ไม่ reset DB เดิม |

ใช้ Node.js 22 และ dependencies จาก `npm ci` ตาม [Team Dev/Test](team-dev-test.md) หาก dependencies ติดตั้งอยู่แล้วไม่จำเป็นต้อง reinstall เพื่อรันทุกครั้ง

```powershell
npm.cmd run test:loadtest

# ติดตั้ง PostgreSQL อยู่แล้ว; ปรับ path ให้ตรงเครื่อง ไม่ได้ download/install ให้
$env:LOADTEST_PG_BIN='C:\Program Files\PostgreSQL\18\bin'
npm.cmd run test:loadtest:local

# B2a schema/runtime และ B2b data/PATCH rollback: cluster ใหม่คนละ invocation
npm.cmd run test:loadtest:local -- --b2
npm.cmd run test:loadtest:local -- --b2b
```

ตัว runner เลือก port ว่างบน `127.0.0.1` สร้าง `coed_loadtest_test` ใน cluster ใหม่ของ invocation นั้น และใช้ local trust authentication **เฉพาะ fixture cluster นี้** ไม่ใช้กับ cloud เปิดทิ้ง หรือข้อมูลจริง หลังทดสอบจะตรวจว่าหยุดแล้ว ไฟล์ cluster/log ถูกเก็บไว้ใน ignored `tmp/loadtest/` เพื่อวิเคราะห์ ไม่ลบแบบ recursive อัตโนมัติ ถ้าเริ่ม/หยุด/ยืนยันสถานะไม่ได้จะออก nonzero ไม่รายงานว่า cleanup ผ่าน

หาก sandbox ปฏิเสธ restricted token ของ `initdb`/`pg_ctl` ให้ใช้การอนุญาตรัน local process ของเครื่อง ไม่เปลี่ยน database guard ไม่เปิด RDS public และไม่รัน suite กับฐานอื่นแทน แต่ละรอบต้องใช้ cluster ใหม่: suite เจตนาปฏิเสธฐานหรือ `coed_app` ที่มีอยู่ก่อน ไม่ล้างของเดิมเพื่อให้ผ่าน

### CI และการแยกฐานทดสอบ

`npm run test:loadtest` ครอบคลุม unit/security/package ของ preparation เดิม, B2a,
B2b, generator/smoke แบบ mock ของ PR #178 และ CI wiring โดยไม่เรียก AWS operators
หรือ smoke API จริง ส่วน [V4 workflow](../../.github/workflows/v4-verification.yml)
เพิ่ม `loadtest-database` matrix สาม job: `local`, `b2a`, `b2b` แต่ละ job มี
PostgreSQL16 container ใหม่ของตัวเอง ไม่ใช้คลัสเตอร์ของ regression/observed upgrade
และตรวจ major version ก่อนรัน ชุดทดสอบสร้าง cluster role `coed_app` จึงแยกแค่
database ในคลัสเตอร์เดียวกันไม่พอ และห้ามรันสามคำสั่งต่อกันบนฐาน/คลัสเตอร์เดิม

| Job | คำสั่ง DB ระดับล่าง |
| --- | --- |
| `local` | `npm run test:loadtest:db` |
| `b2a` | `npm run test:loadtest:b2a:db` |
| `b2b` | `npm run test:loadtest:b2b:db` |

ทุก job ใช้ `NODE_ENV=test`, `LOADTEST_PREP_DISPOSABLE=true` และ
`LOADTEST_PREP_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55442/coed_loadtest_test`
เฉพาะ container disposable นั้น Ports bind host loopback เท่านั้น; trust authentication
ใช้กับ fixture นี้ ไม่ใช่ RDS/ข้อมูลจริง ไม่ตั้ง AWS credentials หรือใช้ Secrets ใน CI
เมื่อจบ job Actions ทิ้ง service container ส่วน native runner ตรวจว่าหยุดคลัสเตอร์แล้ว
ไม่ upload `tmp/loadtest/`, ZIP, mappings หรือ checkpoints เป็น CI artifact

`tests/helpers/loadtest-b2b-fixture.mjs` ใช้ provider keys สังเคราะห์ร่วมกันระหว่าง
unit/DB suites ไม่ import ไฟล์ `.test.mjs` ข้ามชุดเพื่อเลี่ยงรัน unit ซ้ำใน DB job
`.gitattributes` คง LF สำหรับ generator/SQL ที่เทียบ byte/hash ทั้ง Windows/Linux
การเพิ่ม workflow เป็นสถานะโค้ด ยังไม่ใช่ผล hosted CI หรือ AWS acceptance;
ดู [verification](loadtest-preparation-verification.md) สำหรับผลรอบที่รันจริง

### ใช้ CLI กับ input ของทีม

เก็บ manifest/bindings/token/checkpoint จริงภายนอก Git เช่น `tmp/loadtest/` ห้ามนำของจริงมาแทน `manifest.example.json` ใน source ค่าชื่อบัญชี/subject ที่มีรูปแบบถูกต้องไม่พิสูจน์ว่าเป็น test account; เจ้าของ Cognito ต้องยืนยันก่อน cloud binding

```powershell
# Offline: ตรวจข้อมูลและสร้าง fingerprint ไม่เปิด socket
node scripts/loadtest/prepare-db.mjs plan tmp/loadtest/manifest.json tmp/loadtest/companies.json

# สำหรับฐาน NEW/EMPTY ใน cluster disposable ที่คุณสร้างใหม่เท่านั้น
$env:NODE_ENV='test'
$env:LOADTEST_PREP_DISPOSABLE='true'
$env:LOADTEST_PREP_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:54337/coed_loadtest_test'
node scripts/loadtest/prepare-db.mjs trial tmp/loadtest/manifest.json tmp/loadtest/companies.json
node scripts/loadtest/prepare-db.mjs apply tmp/loadtest/manifest.json tmp/loadtest/companies.json
node scripts/loadtest/prepare-db.mjs check tmp/loadtest/manifest.json tmp/loadtest/companies.json
```

ตัวอย่าง port เป็นเพียงตัวอย่าง ไม่ได้แปลว่ามี server ฟังอยู่ หากใช้ automatic runner ไม่ต้องตั้ง URL เอง และฐานของ runner จะหยุดเมื่อเสร็จ `test:loadtest:db` เป็น entry ระดับล่าง ต้องจัด cluster ใหม่/flags/URL ตาม guard เอง; ใช้ `test:loadtest:local` สำหรับการรันซ้ำทั่วไป

- `trial`: ใช้ DDL/fixtures/grants จริงใน transaction แล้ว rollback ทั้งหมด รวม role ที่เพิ่งสร้าง
- `apply`: commit เฉพาะฐานใหม่ในเครื่อง; rerun input/source เดิมตรวจสอบแล้วคืน idempotent result ไม่ insert ซ้ำ
- `check`: ไม่เปลี่ยน schema/grants/data; ถ้าพบ drift ให้หยุด ไม่ซ่อม/ลบของเดิมให้เอง
- ทั้งสามคำสั่งปฏิเสธ RDS/remote URLs, database ชื่ออื่น, URL query options และ deployment environment ก่อนเปิด connection
- ถ้า input/source/migration checksum เปลี่ยน จะไม่ยอมอ้างว่าฐานเก่าตรงกัน ให้ใช้ cluster disposable ใหม่ ไม่แก้ประวัติหรือ checksum เดิม

## 3. สัญญาข้อมูลกับเพื่อน

### Manifest บัญชี — ณัษฐภาคย์ส่งให้รณกฤตแบบส่วนตัว

ใช้ shape ในตัวอย่าง: `contract=coed-loadtest-db-v1`, `run_id=lt-YYYYMMDD-xxxxxxxx`, `synthetic_only=true`, `aws_intent`, Cognito `issuer` และ `accounts` 5–10 รายการ (แผนทีมใช้ 10)

- `aws_intent` มี account ID/region และชื่อที่เสนอ `coed-loadtest-db`, `coed/loadtest/postgres/app` เท่านั้น เป็น **เจตนาการตั้งชื่อ ไม่ใช่ inventory, tag ownership หรือ approval**
- แต่ละบัญชีมีเฉพาะ `alias=loadtest01..loadtest10` และ UUID `subject`; ไม่รับ password/token/email/role ที่ browser เลือกมา
- บัญชีภายในถูกสร้างเป็น STUDENT/ACTIVE พร้อม synthetic profile ที่ครบและ Draft 1 ฉบับในรอบ OPEN จำลองเดียวกัน ใช้ email `example.invalid` และเลขนักศึกษาจำลองขึ้นต้น 99
- UUID fixture ภายใน derive จาก run ID + alias อย่าง deterministic; ไม่ auto-link บัญชีเดิมตามชื่อหรืออีเมล ไม่แก้ policy Student/TU ของ production
- Fresh fixtures เป็นข้อมูลตั้งต้น ไม่อ้างว่าเกิดจากการกด Submit หรือเป็นใบสมัคร Phase 1 ที่ส่งสำเร็จ

### JSON บริษัท — ภูริณัฐส่งให้รณกฤตตรวจ/นำเข้า

```json
{
  "contract": "coed-loadtest-companies-v1",
  "run_id": "lt-20261118-aaaaaaaa",
  "synthetic_only": true,
  "companies": [
    {"id":"99000000-0000-4000-8000-000000000101","name":"LOADTEST-Company 0001","location":"Bangkok"}
  ]
}
```

แถวเดียวด้านบนเป็นตัวอย่าง shape เท่านั้น; input ที่ใช้งานต้องมี **300–500 แถว** ID/name ไม่ซ้ำ, name ขึ้นต้น `LOADTEST-` ตาม validator และ location อยู่ใน Bangkok/Pathum Thani/Nonthaburi/Remote ห้ามส่ง SQL อิสระ รายชื่อจริง เบอร์ติดต่อ อีเมล หรือ free-form fields เพิ่ม ระบบ insert ด้วย parameters และตั้ง source ของ run, visibility public, data_status mock เอง ไม่ใช้ `seed.js` และไม่ disable constraints/triggers/audit

บริษัทชุดนี้ไม่มี `catalog_key` ทั้งชุด เพื่อไม่ให้ถูก catalog preference ซ่อนโดยไม่ตั้งใจ ตำแหน่งงานไม่จำเป็นสำหรับ scenario นี้ เพราะ Draft ยอมให้ company/position เป็น null; ถ้าทีมต้องทดสอบตำแหน่งหรือ Submit ต้องเสนอ scenario/fixture เพิ่ม ไม่ข้าม validation เดิม

Local tests ใช้ [synthetic fixture helper](../../tests/helpers/loadtest-fixture.mjs) 400 บริษัท เพื่อพิสูจน์ contract ไม่ใช่การรับรอง output ของ generator ภูริณัฐที่ยังไม่ได้ส่งมา

## 4. API ที่เลือก และสิ่งที่ต้องบอกปพนพัชร์

| ประเภท | API | เงื่อนไข |
| --- | --- | --- |
| List | `GET /api/directory/companies?q=&location=&page=1&pageSize=20` | Public; ใช้ ID จากผลลัพธ์ |
| Detail | `GET /api/directory/companies/{id}` | Public company detail ไม่ใช่ private positions |
| Write | `PATCH /api/v3/plans/{id}` | Own editable Draft; `notes`, current `expected_version`, UUID `operation_id` ใหม่ |

อ่าน `GET /api/v3/plans` เพื่อรู้ plan/version ของบัญชีตัวเอง อย่าส่ง Student ID/role มาทดแทน identity ตัวอย่าง body: `{"notes":"LOADTEST write","expected_version":1,"operation_id":"<new UUID>"}` ความสำเร็จต้องมี version เพิ่มพร้อม operation receipt/audit ใน transaction เดียว; 409 ต้องนับแยกจาก successful writes

**สำคัญ:** นี่คือ legacy company/Plan workload ที่เอกสารทีมเลือก ไม่ใช่การ benchmark สมัคร Phase 1, แนบไฟล์ S3, TU login หรือ Committee workflow ทั้งระบบ

1. Test Lambda ต้อง pin เฉพาะ test DB host/dbname/user/port และ test runtime Secret ห้าม copy env/Secret production ทั้งชุด; TLS/RDS CA และ Secret pinning ต้องตรงกันจริง
2. Live `intake-pilot` maintenance บล็อก legacy Plans จึงต้องเลือก config workload ปกติ **เฉพาะ Lambda ทดสอบ** ไม่ปลด maintenance ของจริง และไม่เปิด mock Gateway claims/bearer fallback ใน cloud
3. Cognito ใช้ genuine Hosted UI token/scope ที่ทีมตรวจแล้ว; local claims ใน suite ไม่ใช่หลักฐาน Cognito authentication/authorizer จริง
4. Task weights 5:3:2 ไม่ใช่ 20% HTTP writes ถ้า task เขียนเรียก GET+PATCH: สัดส่วนเฉลี่ยคือ PATCH 2/12 ≈16.7% ก่อน retries จัดการ version/cache/conflicts แล้ววัดจริงจาก request counts อย่าเพิ่ม counter ให้เสมือนมี writes ที่ไม่ได้ commit [Locust task semantics](https://docs.locust.io/en/stable/writing-a-locustfile.html)
5. แชร์ 10 บัญชีกับ virtual users จำนวนมากจะเกิด version conflicts ได้ คง locking/version/idempotency เดิม ไม่เปลี่ยน API ให้รับข้อมูลชนกันโดยไม่ตรวจ
6. RDS แยกไม่ได้แยก account concurrency หรือ Cognito pool ต้องตรวจ quota/headroom และจำกัด test Lambda ก่อนยิงโหลด ไม่คัดลอกเลข default quota เป็นค่าที่บัญชีมีจริง [AWS reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)

## 5. ตัวเลขที่รณกฤตดูในคาบ

ใช้ namespace `AWS/RDS`, dimension `DBInstanceIdentifier` ของ **test instance ที่ยืนยันจริง** ไม่เลือกกราฟของ production

| Metric | ดูอะไร / แปลผลอย่างระวัง |
| --- | --- |
| CPUUtilization | CPU เพิ่มตามโหลดหรือไม่; CPU สูงอย่างเดียวไม่ระบุว่าต้อง scale เสมอไป ต้องเทียบ latency/query |
| DatabaseConnections | จำนวน connections และการเข้าใกล้ limit ที่อ่านจาก test DB จริง; CPU ต่ำแต่ connections เต็มอาจเป็น pool/connection pressure |
| FreeableMemory | memory เหลือลดต่อเนื่องหรือไม่ ใช้คู่กับ CPU/connections |
| FreeStorageSpace | พื้นที่เหลือจากข้อมูล/audit/WAL; fixture reset ไม่ใช่วิธีแก้ระหว่างรันทดสอบ |
| CPUCreditBalance/CPUSurplusCreditsCharged | ดูเมื่อ instance class แบบ burstable รองรับ อย่ามอง CPU อย่างเดียว |

อ้างอิงความหมาย [RDS metrics](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html) จดเวลาของแต่ละ load stage ให้เทียบกับ Lambda p95/Errors/Throttles/ConcurrentExecutions และ Gateway 4xx/5xx/latency ได้ การตั้ง threshold เช่น connections 80% ต้องยืนยันฐาน/limit และตกลงกับทีมก่อน ไม่ใช่ค่ารับรองของอาจารย์

Lambda มี managed scaling ภายใต้ quota; DB PostgreSQL instance ไม่ได้เพิ่ม CPU/ขนาดตัวเองทันทีเมื่อกราฟสูง Lab Autoscaling บน AWS Academy เป็นอีกงานหนึ่ง ห้ามสร้าง EC2/ASG/RDS Proxy/read replica เพิ่มเพียงเพื่อให้ชื่อเหมือน lab โดยไม่วิเคราะห์และอนุมัติ

## 6. ข้อเสนอ AWS ขั้นถัดไป — ยังไม่อนุมัติ/ยังรันไม่ได้

ตรวจ metadata ก่อน แล้วเสนอ exact IDs/ARNs/tags/engine/tier/TTL/ผู้รับผิดชอบ/ค่าใช้จ่ายก่อน Apply:

| สิ่งที่เสนอ | ขอบเขตที่ต้องอนุมัติเพิ่ม |
| --- | --- |
| Private RDS `coed-loadtest-db` | instance ใหม่ ไม่ restore production; engine/tier/storage ตาม inventory ที่ตรวจใหม่ ไม่อ้าง version ใน DOCX เป็นปัจจุบัน |
| Test DB/runtime credentials | Secret runtime แยก; owner credentials ใช้เฉพาะ RDS ทดสอบ หากใช้ RDS-managed master Secret ต้องรวม Secret/ค่าใช้จ่ายนั้นใน scope ด้วย ห้ามใช้ master Secret production |
| Test SG และ private bootstrap path | 5432 จาก test Lambda/temporary bootstrap ที่กำหนดเท่านั้น ไม่เปิด public/0.0.0.0/0; ประสานผู้สร้าง SG กับปพนพัชร์ |
| Temporary bootstrap Lambda/role/log | จำกัดคำสั่ง/target/อายุและถอนหลังตรวจ; สิทธิ์ owner ไม่ให้ runtime |
| Existing Secrets VPC endpoint | ตรวจ policy/SG ให้ exact test principals/Secrets ผ่านได้โดยคงของเดิม; ไม่สร้าง endpoint/NAT ใหม่โดยปริยาย [AWS endpoint policy](https://docs.aws.amazon.com/secretsmanager/latest/userguide/vpc-endpoint-overview.html) |
| Synthetic data/bootstrap | Exact checksum-reviewed fresh SQL บน empty owned test DB เท่านั้น ไม่ใช้ generic migrate/seed/reset กับ RDS |
| Runtime/API/Locust handoff | code/config hash, test URL, genuine auth smoke, max users/concurrency/duration, stop criteria และผู้เฝ้าก่อนโหลด |

รายการนี้ยังไม่มี fresh AWS inventory/ค่าใช้จ่ายที่อนุมัติจริง CLI research พบว่า session นั้นไม่มี profile `coed-v4`; user ยืนยันว่าเพื่อนยังไม่สร้างฐาน แต่ต้องตรวจซ้ำก่อนสร้าง ไม่อ่านค่า Secret production/ข้อมูลนักศึกษาเพื่อเตรียม fixture

### Cleanup หลังจบคาบ — แนวทาง ไม่ใช่คำสั่งลบที่อนุมัติแล้ว

- เก็บ manifest ทรัพยากรที่ **สร้างจริง**: account/region, run ID, exact ARN/ID, ownership tags, ผู้รับผิดชอบ, dependencies และเวลาหมดอายุ ชื่อมีคำว่า loadtest อย่างเดียวไม่พอ
- Preview แล้วขอยืนยัน exact targets; หยุด traffic ทดสอบก่อนถอน API/Lambda ของเพื่อนตามเจ้าของงาน
- ลบ RDS จำลองทั้ง instance เมื่ออนุมัติ skip-final-snapshot สำหรับ synthetic-only แล้ว ไม่ลบแถว/ปิด audit triggers ในฐานจริง รอ deletion สำเร็จและตรวจ backup ที่อาจเหลือ
- Secret ใช้ recoverable deletion เป็นค่าเริ่มต้น; force-delete ต้องขอแยก การถอน SG/ENI/endpoint statements ต้องทำตาม dependencies และคง statements/roles ของ production
- คืนการเปลี่ยน policy เฉพาะ statement ที่ run เป็นเจ้าของ หาก policy ถูกแก้ชนกันให้หยุดตรวจใหม่ ไม่เขียน snapshot เก่าทับเพื่อน
- บัญชี Cognito ให้เจ้าของลบเฉพาะ test accounts ที่ยืนยัน ไม่ลบ shared pool/VPC/endpoint หรือทรัพยากร production
- ถ้าค้างบางขั้น ต้องมี checkpoint/resume และผู้ตามงาน ไม่รายงานว่าค่าใช้จ่ายหยุดทั้งหมดจนตรวจ residual resources แล้ว

## 7. Verification และงานที่ยังเหลือ

ผล local ของ source ชุดนี้ดู [loadtest preparation verification](loadtest-preparation-verification.md) แยก unit checks, PostgreSQL จริง, modeled Gateway claims และข้อจำกัดออกจากกัน ไม่มีการอัปเดต [deployment snapshot](current-deployment.md) เพราะรอบนี้ไม่เปลี่ยน AWS

งานที่ยังเหลือก่อนพร้อมเข้าเรียน: generator/bindings จากเพื่อน, อนุมัติและสร้างระบบทดสอบจริง, genuine Cognito smoke, deploy/test URL, Locust บนเครื่องปพนพัชร์, CloudWatch/credits และ lab รายบุคคล การผ่าน local ไม่ทำให้รายการเหล่านี้สำเร็จอัตโนมัติ
