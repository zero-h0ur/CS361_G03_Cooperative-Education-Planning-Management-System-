# Load test stack (CS361 สัปดาห์ Auto Scaling)

ระบบทดสอบแยกจากของจริง: Lambda `coed-api-loadtest` + HTTP API `coed-loadtest-api` + dashboard `coed-loadtest`
ใช้โค้ดและค่าตั้งค่าเดียวกับ `coed-api:live` แต่ต่อฐานข้อมูลทดสอบเท่านั้น ลบทั้งชุดหลังเรียน

## ค่าของระบบจริง (17 พ.ย. 2569)

| รายการ | ค่า |
| --- | --- |
| `coed-api:live` | เวอร์ชัน 16, nodejs22.x, 256 MB, timeout 28 s, x86_64 |
| reserved concurrency ของ `coed-api` | 30 |
| โควตา Lambda ทั้งบัญชี | 400 (unreserved 368) |
| RDS จริง | `database-coed-postgres`, db.t4g.micro, PostgreSQL 16.15, single-AZ, subnet group `coed-v4-db-private` |
| Lambda subnet / security group | `subnet-0fb8a4985d4e48f03` / `sg-01157dbde4cba48ab` |

## RDS ทดสอบ (รณกฤต)

- instance id `coed-loadtest-db`, db.t4g.micro, PostgreSQL 16.15, single-AZ, subnet group `coed-v4-db-private`, ไม่เปิด public
- security group ของ RDS ทดสอบ: inbound TCP 5432 จาก `sg-01157dbde4cba48ab` (Lambda ทดสอบใช้ security group เดียวกับของจริง)
- secret ใน Secrets Manager ต้องเป็น JSON แบบนี้ และค่าต้องตรงกับ env ทุกตัว ไม่อย่างนั้นโค้ดจะไม่ยอมต่อ:

```json
{"engine":"postgres","host":"<endpoint ของ RDS ทดสอบ>","dbname":"coed","username":"coed_app","port":5432,"password":"<รหัสของ coed_app>"}
```

- user ต้องไม่ใช่ `postgres` (โค้ดปฏิเสธ) ใช้ `coed_app` ตาม `src/db/operations/v3-runtime-grants.sql`

## สร้าง / ลบ

```bash
aws login --profile coed-v4 --region ap-southeast-2
TEST_DB_HOST=<endpoint> TEST_DB_SECRET_ARN=<arn> bash scripts/loadtest/stack-up.sh
bash scripts/loadtest/stack-down.sh
```

ไฟล์ชั่วคราว (state, token) อยู่ใน `tmp/loadtest/` ซึ่งไม่เข้า git

## Locust

```bash
pip install locust && locust --version
# token ของบัญชีทดสอบ (ไฟล์นี้ไม่เข้า git) รูปแบบดู tokens.example.json
#   tmp/loadtest/tokens.json  ถ้าไม่มี จะยิงเฉพาะ list/detail
locust -f scripts/loadtest/locustfile.py --host <API_URL ที่ stack-up พิมพ์ออกมา>
# เปิด http://localhost:8089 ใส่จำนวน users ทีละขั้น 5 → 20 → 50 → 100 ค้างขั้นละ ~3 นาที
```

- สัดส่วน: list 5 / detail 3 / write 2 (ตามน้ำหนัก task) — write คือ `PATCH /api/v3/plans/{id}` บันทึกร่างแผน
- Locust user ใช้ 10 บัญชีวนกัน 409 ที่เกิดจากบัญชีซ้ำแสดงเป็นแถว `write 409 (บัญชีซ้ำ)` และไม่นับเป็น error
- `write: read plan` คือการอ่านแผนเพื่อเอา version ล่าสุด เกิดตอนเริ่มและหลัง 409
- สคริปต์ปฏิเสธ host ของ API ตัวจริง
- access token ขอใหม่จาก refresh token อัตโนมัติก่อนหมดอายุ ถ้า refresh token หมดอายุ (480 นาที) ต้องเก็บ token ใหม่
- เก็บผลแต่ละขั้น: แท็บ Download Data → CSV หรือรันแบบ `--headless -u 20 -r 5 -t 3m --csv tmp/loadtest/run-20u`
