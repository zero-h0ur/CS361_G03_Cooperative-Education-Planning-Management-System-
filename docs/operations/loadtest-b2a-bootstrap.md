# Load-test B2a — isolated schema/runtime bootstrap

สถานะบันทึก **2026-11-18 Asia/Bangkok**: schema/runtime และการถอน Lambda/role/log/สิทธิ์ owner ที่ร้องขอผ่านแล้ว ตรวจซ้ำล่าสุด **03:26:25 น.** ยังมี ENI เก่าหนึ่งตัวสถานะ `available` ที่ไม่ได้ลบเอง อ่านรายการคงเหลือท้ายเอกสาร ไม่ใช่การเปิด API/Load Test

## เป้าหมายและขอบเขต

ต่อจาก [B1 infrastructure](loadtest-b1-infrastructure.md) โดยคง `coed-loadtest-db`, PostgreSQL16.15, private, DB `coed_loadtest` เพิ่มเฉพาะ reviewed fresh schema, runtime `coed_app` และ Secret `coed/loadtest/postgres/app` รหัสสุ่มเก็บใน memory/Secrets Manager ไม่พิมพ์หรือเขียนลง Git, ZIP, checkpoint หรือ configuration

Owner `coed_loadtest_owner` ใช้เฉพาะ bootstrap ไม่ส่งเป็น runtime credential ไม่อ่าน Secret หรือต่อฐาน production ไม่มี general seed/reset/migrate, ไม่ปิด constraints/triggers/audit และไม่เปลี่ยน historical SQL/checksums

**ไม่มีข้อมูลบริษัทหรือบัญชีนักศึกษาใน B2a** รอ dataset/generator ของภูริณัฐ และ issuer/10 subjects ของณัษฐภาคย์ ไม่สร้าง subjects/ข้อมูลผู้ใช้จริงขึ้นแทน ยังไม่ Deploy test API, ไม่รัน stack-up, Cognito/TU/Locust หรือส่งใบสมัคร

## เครื่องมือและการจำกัดสิทธิ์

| ไฟล์ | หน้าที่ |
| --- | --- |
| [b2-bootstrap.mjs](../../scripts/loadtest/b2-bootstrap.mjs) | Fixed target/expiry/digest, exact command envelope, empty-target guard, transaction trial/apply และตรวจ zero business rows/limited runtime |
| [b2-handler.mjs](../../scripts/loadtest/b2-handler.mjs) | TLS ตรวจ CA, fixed test host/DB, อ่านเฉพาะ owner/app Secret ใน memory, sanitized error codes |
| [b2-operator.mjs](../../scripts/loadtest/b2-operator.mjs) | Fresh metadata/account check, policy backup, additive SG/endpoint, allowlisted ZIP/hash, deadline/cleanup/checkpoint และ public production GET probe |
| [runtime-grants.sql](../../scripts/loadtest/runtime-grants.sql) | สิทธิ์เฉพาะ directory/legacy Plan workload; ไม่ใช่ grant script สำหรับ production |

เครื่องมือชั่วคราว `coed-loadtest-bootstrap-b2`/role/log ไม่มี Function URL/API ใช้ test-client SG เดิม, reserved concurrency1 และ windowไม่เกิน1ชั่วโมง เริ่มหยุดงานใหม่ที่45นาทีเพื่อเหลือเวลาถอนใน `finally` ไม่ใช่การสร้าง scheduler หรือนโยบายลบฐานอัตโนมัติ หาก process/เครื่องหยุดผิดปกติต้องตรวจ private checkpoint และ cleanup โดย operator ไม่อ้างว่ามี unattended cloud cleanup

Temporary role อ่านเฉพาะ owner/app Secret ของฐานทดสอบ ไม่อ่าน Secret production; runtime endpoint statement อนุญาตเฉพาะ role `coed-loadtest-lambda-role` อ่าน app Secret ไม่ได้สิทธิ์ owner การสร้าง runtime role/API ยังเป็นงาน stack ฝั่งปพนพัชร์

เพิ่ม TCP443 test-client SG → existing Secrets endpoint SG และ ingressคู่กัน ไม่ใช้ production Lambda SG ไม่เปิด CIDR/public/NAT ใหม่ เก็บ rules เดิมครบ ส่วน5432 test client → test DB คงเดิม

สำรอง endpoint policy ก่อนแก้ เพิ่มเฉพาะ statement ที่มี Sid ของ B2a และ exact role/Secret ตรวจ drift ก่อนเขียน/ตรวจ preservation หลังเขียน เมื่อถอน owner statement จะอ่าน policy ล่าสุดแล้วลบเฉพาะ statement ที่ตนเป็นเจ้าของ ไม่เอา backup เก่าทับการแก้ของเพื่อน

## การทดสอบก่อน AWS

Node22.12.0 บน Windows; คำสั่งที่รันรอบนี้:

- `node --test tests/loadtest-b2.test.mjs`: **10/10 ก่อน AWS**,0 skips รวมเป้าหมาย/อายุ/SQL hash/Secret shape/injection/redaction, SG grouping, policy preservation และ ZIP allowlist; หลังเพิ่ม cleanup hardening รันซ้ำ **11/11**,0 skips รวมถอน Secret access แต่คง ENI cleanup permissions
- `LOADTEST_PG_BIN=<installed PG18 bin> node scripts/loadtest/test-local.mjs --b2`: **5/5**,0 skips; rollback-only trial, foreign-target refusal, DDL rollback, empty schema/limited role และ denied DDL; clusterใหม่หยุดยืนยันแล้ว
- `node --test tests/loadtest-preparation.test.mjs`: **40/40**,0 skips; local-only guard เดิมยังอยู่
- `LOADTEST_PG_BIN=<installed PG18 bin> node scripts/loadtest/test-local.mjs`: **12/12**,0 skips; regression full synthetic list/detail/own-Draft/PATCH/receipt/audit/race ในฐานใหม่ที่หยุดแล้ว ไม่ใช่ genuine Cognito acceptance
- `npm.cmd run lint`: ผ่าน (syntax check ไม่ใช่ security proof)
- `npm.cmd run verify:migrations`: reviewed17 files ไม่เปลี่ยน; source-only ไม่ใช่ Apply
- `npm.cmd run test:release`: **14 passed / 1 skipped / 0 failed**; release/import DB test ไม่มี dedicated local URL จึง skip ไม่รวมเป็น passed และไม่ใช้ RDS แทน

Sandbox แรกปฏิเสธ esbuild ที่อ่าน parent directory; รัน packaging test ด้วย local-process permission แล้วผ่าน ไม่แก้ guard หรือข้าม test Local PostgreSQL18 ไม่ใช่ RDS16.15 compatibility proof: ต้อง trial/rollback บน isolated approved RDS16.15 ก่อน Apply จริง

## Checkpoint และห้ามรันซ้ำโดยไม่ตรวจ

`tmp/loadtest/b2a-XNiXQH/` เป็น ignored/private-local ประกอบด้วย `endpoint-before.json`, `security-groups-before.json`, `state.json`, ZIP/config/SQL payload ที่ไม่มีรหัสผ่าน และ `handoff.json` เมื่อจบ ไฟล์เหล่านี้ไม่อยู่ใน clone ของเพื่อน ส่งเฉพาะ metadata handoff ผ่านช่องทางทีม

`node scripts/loadtest/b2-operator.mjs --approved-b2a` ไม่ใช่คำสั่งทั่วไปที่เพื่อนควรรันซ้ำ เครื่องมือปฏิเสธ Secret/resource ชื่อเดิมและไม่ reset retained schema การมี flag ไม่แทนการอนุมัติ AWS ครั้งใหม่ ตรวจ checkpoint/ผล commit/cleanup ก่อนวางแผน recovery

หลังมี app Secret แล้ว ห้ามใช้ B1 owner Secret ARN แทน ค่า stack ที่ต้องส่งตรง Secret คือ `TEST_DB_NAME=coed_loadtest`, `TEST_DB_USER=coed_app`, test-client SG จาก handoff ไม่ใช่ค่าเริ่มต้น DB `coed`/production SG ใน README ฝั่ง stack

## ผลตรวจรับ AWS และ cleanup

หลักฐานรอบ Apply: baseline public production directory **200** เวลา `2026-11-17T18:29:20.149Z`; หลังเพิ่ม endpoint **200** เวลา `2026-11-17T18:29:51.245Z` Policy hash จาก compact parsed JSON (ไม่ใช่ bytes ของ pretty-printed backup) `7c64663bd9599918f997c90cfb662f7b18383f4dec5a1007a63761aefadaac22`; SQL/grants payload hash `7a829f6a8d575d329076b4b9d8e607b910ca92f8d09b809280f691f29cc2154c`

ผล cloud commands ทั้ง5รายการผ่าน: preflight empty → trial (rollback,17 migrations/zero business rows) → preflight empty → apply committed → verify; apply/verify เชื่อม `coed_app` จริงผ่าน TLS และตรวจสิทธิ์ผ่าน ตัวดำเนินงานเดิมทำงานต่อจนถอน Lambda/role/log/owner endpoint statement ครบเมื่อ `2026-11-17T18:47:45.706Z` (18 พ.ย. **01:47:45 น. เวลาไทย**) ใช้ **1,106 วินาที** ภายใน1ชั่วโมง แม้ช่วงนั้นการตอบแชตหยุดลง ไม่รัน Apply ใหม่เพื่อทำซ้ำ

ระหว่างรอ ENI ใช้ scoped cleanup helper ถอน Allow อ่าน Secret และตั้ง explicit Deny GetSecretValue ทั้งหมดบน **temporary role ของ run นี้เท่านั้น** สำเร็จ `2026-11-17T18:41:52.078Z`; สิทธิ์ network/log cleanup คงไว้จนลบ role การดำเนินการนี้ทำแยกระหว่าง operator รุ่นแรกกำลังรอ และเพิ่ม helper ไว้ใน operator สำหรับการใช้งานครั้งถัดไปที่ได้รับอนุมัติ ไม่เปลี่ยน live Lambda ZIP ที่ Apply ไปแล้ว

อ่าน inline policy จริงยืนยัน scope owner/app ของ test เท่านั้นก่อนถอน ไม่เรียก GetSecretValue กับ Secret production ส่วน IAM simulator ให้ resource ARN ไม่ตรงรายการที่ร้องขอ จึงไม่ใช้ผลนั้นเป็นหลักฐาน acceptance หรืออ้างว่าจำลองทุก resource ผ่าน

### ตรวจซ้ำหลังกลับมาทำต่อ

`2026-11-17T20:26:25.126Z` (18 พ.ย. **03:26:25 น. เวลาไทย**) ตรวจ metadata และ public GET แบบ read-only: Lambda/role/log ไม่พบ, owner statement ไม่เหลือ, original endpoint statements/SG rules อยู่ครบ, app-only runtime statement ยังตรงเดิม, test RDS available/private และ app Secret ไม่อยู่ระหว่างลบ; public production directory **200** ไม่อ่าน Secret value ไม่รัน SQL ไม่เปลี่ยน AWS หรือสร้างเครื่องมือใหม่

Checkpoint ปิดงานเดิมบันทึก ENI เป็น `in-use`; ผลสดพบ ENI เดิม `available`, type `interface` จึงไม่แก้ประวัติเก่าให้เหมือนตรวจ ENI หายแล้ว **ยังไม่ได้ลบ ENI นี้ด้วยตนเอง** ไม่อ้างว่า temporary infrastructure ทุกชิ้นหายหมด `cleanupVerified` ใน checkpoint หมายถึง Lambda/role/log/owner capability ตามรายการตรวจ ไม่รวม ENI

รายการคงเหลือโดยตั้งใจ: test RDS/schema/`coed_app`, DB/client SG ของ B1, RDS-managed owner Secret, app Secret, test HTTPS SG rules2รายการ และ runtime endpoint statement1รายการ นอกจากนี้มี ENI เดิม1ตัวที่กล่าวข้างต้น ยังไม่สร้างข้อมูลบริษัท/ผูก10บัญชี/Deploy test API หรือยิงโหลดในงานนี้ ส่ง exact metadata ผ่าน `tmp/loadtest/b2a-XNiXQH/handoff-current.json`; คู่กับ `resumption-verification.json` ส่วน `state.json`/`handoff.json` เดิมเก็บไว้เป็นประวัติ

ตรวจเอกสาร/plan/whitespace ในรอบกลับมานี้แยกจาก unit/DB/release tests ของรอบ Apply ไม่ได้นับ tests เดิมว่าเพิ่งรันซ้ำ

เอกสาร production current-deployment ไม่ปรับวันใหม่เพราะไม่มีการ Deploy บริการหลัก B1/B2a ยังคงคิดเงินจน cleanup หลังคาบที่ได้รับอนุมัติแยก Review tag ไม่ใช่การหยุด/ลบอัตโนมัติ
