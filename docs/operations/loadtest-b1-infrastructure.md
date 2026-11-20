# Load-test B1 — ฐานว่างแยกจากระบบจริง

เริ่มสร้าง: **2026-11-17, Asia/Bangkok**; ตรวจรับครั้งสุดท้าย **2026-11-18 00:04:23 น. เวลาไทย** (`2026-11-17T17:04:23.056Z`) ได้สถานะ **available** นี่คือ snapshot ของ **โครงสร้างทดสอบ** ไม่ใช่การ Deploy backend/frontend หรือการเปิดรับสมัครจริง

## ขอบเขตและทรัพยากร

Region `ap-southeast-2`, branch `chore/loadtest-rds-preparation`; ไม่มี commit/push ในรอบนี้

| รายการ | ค่าที่สร้าง / ตรวจจาก metadata |
| --- | --- |
| RDS | `coed-loadtest-db` แยก instance ไม่ restore/snapshot/copy production |
| Engine / class | PostgreSQL **16.15 / db.t4g.micro** ตรงกับ metadata ฐานจริงก่อนเริ่ม |
| Storage | **gp3 20 GiB**, encrypted; ไม่ตั้ง storage autoscaling expansion |
| Availability / network | Single-AZ, IPv4, private, subnet group เดิม `coed-v4-db-private` |
| Database / owner | ฐานใหม่ `coed_loadtest`, owner `coed_loadtest_owner` ไม่ใช่ runtime account |
| DB SG | `coed-loadtest-db-sg`: inbound TCP5432 จาก test-client SG ใหม่เท่านั้น, egress ว่าง |
| Test-client SG | `coed-loadtest-lambda-sg`: ingress ว่าง, egress TCP5432 ไป DB SG ใหม่เท่านั้น; ยังไม่ผูก Lambda |
| Owner credentials | **1 RDS-managed master Secret**, metadata-only ไม่อ่านรหัสผ่าน |
| Storage / Secret KMS | ทั้งสอง key ตรวจได้ `KeyManager=AWS`, enabled; ไม่สร้าง customer-managed KMS key |
| Lifecycle | ปิด deletion protection เฉพาะฐานทดสอบ, backup retention0; review **18 พ.ย. 2569 23:45 น. เวลาไทย** |
| Monitoring | enhanced monitoring0, Performance Insights ปิด, ไม่เปิด SQL log exports; มี RDS metrics มาตรฐาน |

Review tag **ไม่ใช่ scheduler หรือ spending cap** ไม่มีหยุด/ลบอัตโนมัติ หากเปิดค้างยังมีค่าใช้จ่าย ต้องยืนยัน exact targets หลังคาบก่อน cleanup ค่าใช้จ่ายพื้นฐานที่เสนอราว US$0.70 ต่อ24ชั่วโมงก่อนเครดิต/ภาษีและค่าตามใช้งาน ไม่ใช่ราคาเหมา

RDS-managed master Secret ไม่ใช่ application Secret `coed_app` และไม่ใช่ TU API key ห้ามนำ owner ไปตั้งเป็น runtime credential ของ Lambda

## สิ่งที่ยังไม่ทำ

- ไม่เชื่อม SQL, ไม่ลง application tables/migrations/fixtures/บริษัท/นักศึกษา ไม่เรียก seed/reset/migrate กับ RDS
- ยังไม่สร้าง `coed_app`/runtime Secret, bootstrap Lambda/role หรือ endpoint allowance
- ไม่สร้าง Cognito users/token capture, test API/Lambda หรือ Locust รอเจ้าของงานแต่ละส่วนส่งมอบ
- ไม่เปลี่ยน production RDS/SG/Secret/endpoint policy, API/Amplify/maintenance หรือข้อมูลจริง
- ไม่อ้างว่า SQL/API/auth ใช้งานได้เพียงเพราะ RDS available หรือ engine ตรงรุ่น

Local suite ก่อน B1 ใช้ PostgreSQL18/modeled Gateway claims ตาม [ผล local](loadtest-preparation-verification.md) ไม่ใช่การตรวจ SQL บน RDS16.15 ขั้น bootstrap/compatibility ยังต้องมี scope อนุมัติแยก

## หลักฐานและ handoff

Checkpoint/request/ตัวตรวจ `verify.mjs` และ `handoff.json` อยู่ใน ignored `tmp/loadtest/b1-lt-20261117-45b10a7e/` **ไม่ได้อยู่ใน clone ของเพื่อน** เจ้าของต้องส่ง metadata handoff ให้ปพนพัชร์ผ่านช่องทางทีมที่เหมาะสม ไม่แนบรหัสผ่านหรือค่า Secret

Handoff มี host/port/DB name, SG IDs, owner Secret ARN/status และข้อจำกัด B1 โดย owner Secret ARN ใช้สำหรับผู้ดูแล bootstrap ที่อนุมัติ ไม่ใช่มอบสิทธิ์ owner ให้ runtime ผู้ทำ API ต้องรอ runtime role/Secret และ private Secrets access ในขั้นถัดไป

ใช้ `describe-db-instances`, `describe-security-groups`, `describe-secret` และ `kms describe-key` ด้วย profile `coed-v4`, region `ap-southeast-2`, query เฉพาะ metadata ไม่ใช้ `get-secret-value` การสร้างใช้ API field `VpcSecurityGroupIds` และ omit `MaxAllocatedStorage` เพื่อไม่เปิด autoscaling: attempts แรกที่ถูก validation ปฏิเสธยังไม่มี instance สำเร็จ ห้ามเพิ่ม storage เพื่อให้ผ่านโดยไม่อนุมัติ

## ผลตรวจรับ

ตัวตรวจ Node แบบ read-only ผ่าน **26/26 metadata assertions** ณ เวลาข้างต้น: account/instance ตรงเป้าหมาย, RDS `available`, engine/class/storage/network/lifecycle ตามตาราง, SG ใหม่ทั้งสองมีกฎตรงกันและไม่มี client ENI ผูกอยู่, run tags ตรง, RDS-managed Secret `active` และ key ทั้งสองเป็น AWS-managed ไม่มีการอ่าน Secret value หรือเชื่อม SQL

Production metadata หลักที่อ่านซ้ำ (engine/class/storage/private/SG/deletion protection=true) ยังตรงก่อนเริ่ม งานนี้ไม่มีคำสั่งเปลี่ยน production ไม่ใช่การ audit ทุกบริการหรือการเปลี่ยนจากผู้ใช้อื่น เอกสาร deployment ของบริการหลักไม่ได้ปรับวันใหม่

สถานะ B1 จบเฉพาะ infrastructure; ไม่มีหลักฐาน connection/schema/runtime/API/auth/load test จากรอบนี้ ผล local ก่อนหน้าไม่ใช่การยืนยัน RDS

ตรวจเอกสารในรอบ B1: `npm.cmd run test:docs` ผ่าน9 tests, ไม่ skip; link checker ตรวจ82 documents/470 local links ไม่มี failures (ลิงก์ภายนอกตรวจ syntax เท่านั้น ไม่เรียก network), `git diff --check` และ plan artifact check ผ่าน ไม่รัน full regression ซ้ำสำหรับการสร้าง infrastructure/บันทึกเอกสารนี้

ขั้นต่อไปดู [runbook](loadtest-rds-preparation.md) แยกการอนุมัติโครงสร้างออกจาก schema/runtime/data/API/การยิงโหลด อย่าใช้ snapshot นี้เป็นคำสั่งลบหรือสร้างทรัพยากรซ้ำ
