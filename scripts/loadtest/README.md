# Load test stack (CS361 Module 10 Auto Scaling)

ระบบทดสอบแยกจากของจริง: Lambda `coed-api-loadtest` + HTTP API `coed-loadtest-api` + dashboard `coed-loadtest`
ใช้โค้ดและค่าตั้งค่าเดียวกับ `coed-api:live` แต่ต่อฐานข้อมูลทดสอบ `coed-loadtest-db` เท่านั้น

- **ผลการทดสอบในคาบ (18 พ.ย. 2569):** [issue #181](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/181)
- **สถานะ:** ลบชุดทดสอบครบแล้ว (18–20 พ.ย. 2569) ดูเช็กลิสต์ท้ายไฟล์ ถ้าจะทดสอบใหม่ต้องสร้าง RDS ทดสอบ, secret และผู้ใช้ Cognito ใหม่ก่อน

## ค่าของระบบจริง (17 พ.ย. 2569)

| รายการ | ค่า |
| --- | --- |
| `coed-api:live` | เวอร์ชัน 16, nodejs22.x, 256 MB, timeout 28 s, x86_64 |
| reserved concurrency ของ `coed-api` | 30 |
| connection pool ต่อ Lambda 1 instance | `DB_POOL_MAX=1` (1 instance = 1 DB connection) |
| โควตา Lambda ทั้งบัญชี | 400 (unreserved 368) |
| RDS จริง | `database-coed-postgres`, db.t4g.micro, PostgreSQL 16.15, single-AZ, subnet group `coed-v4-db-private` |
| Lambda subnet / security group | `subnet-0fb8a4985d4e48f03` / `sg-01157dbde4cba48ab` |

## RDS ทดสอบ (รณกฤต)

- instance id `coed-loadtest-db`, db.t4g.micro, PostgreSQL 16.15, single-AZ, subnet group `coed-v4-db-private`, ไม่เปิด public
- `max_connections` = 79 (วัดจริง 18 พ.ย.: สงวนไว้ 5 ช่อง และ `rdsadmin` ใช้ 3)
- Lambda ทดสอบใช้ security group แยก (`TEST_LAMBDA_SG`) และ security group ของ RDS ทดสอบเปิด inbound TCP 5432 จาก security group นั้น
- เตรียมฐาน, schema และข้อมูลด้วยเครื่องมือ `b2-*` / `b2b-*` ดู [runbook](../../docs/operations/loadtest-rds-preparation.md)
- secret ใน Secrets Manager ต้องเป็น JSON แบบนี้ และค่าต้องตรงกับ env ทุกตัว ไม่อย่างนั้นโค้ดจะไม่ยอมต่อ:

```json
{"engine":"postgres","host":"<endpoint ของ RDS ทดสอบ>","dbname":"<ชื่อฐาน>","username":"coed_app","port":5432,"password":"<รหัสของ coed_app>"}
```

- user ต้องไม่ใช่ `postgres` (โค้ดปฏิเสธ) ใช้ `coed_app` ตาม `src/db/operations/v3-runtime-grants.sql`

## สร้าง / ลบ

```bash
aws login --profile coed-v4 --region ap-southeast-2
TEST_DB_HOST=<endpoint> TEST_DB_SECRET_ARN=<arn> TEST_DB_NAME=<ชื่อฐาน> TEST_LAMBDA_SG=<sg ของ Lambda ทดสอบ> \
  bash scripts/loadtest/stack-up.sh
bash scripts/loadtest/stack-down.sh
```

- ค่าเพิ่มเติมที่ตั้งได้: `TEST_DB_USER` (ค่าเริ่มต้น `coed_app`), `TEST_DB_PORT` (5432), `TEST_RESERVED_CONCURRENCY` (ค่าเริ่มต้นเท่ากับ `coed-api` ตัวจริง)
- `stack-up.sh` ไม่ยอมรันถ้า host หรือ secret ตรงกับระบบจริง และ `stack-down.sh` ต้องพิมพ์ `yes` ยืนยันก่อนลบ
- ไฟล์ชั่วคราว (state) อยู่ใน `tmp/loadtest/` ซึ่งไม่เข้า git

## Token ของบัญชีทดสอบ

- บัญชีทดสอบ 10 บัญชี `loadtest01`–`loadtest10` สร้างด้วย `cognito-users.sh` และเก็บ token ด้วย `capture-tokens.py` (PR #177 ของณัษฐภาคย์)
- token ต้องมี scope `coed-api/access` ซึ่งได้จาก Hosted UI เท่านั้น
- พิมพ์รหัสผ่านบัญชีทดสอบในช่องที่สคริปต์ถามเท่านั้น ห้ามวางในแชทหรือใส่ไว้ใน shell history
- locustfile หาไฟล์ token ตามลำดับ: `$LOADTEST_TOKENS` → `scripts/loadtest/tokens.json` → `tmp/loadtest/tokens.json` รูปแบบดู `tokens.example.json`
- `tokens.json` อยู่ใน `.gitignore` ห้าม commit และลบทิ้งหลังเรียน
- access token ขอใหม่จาก refresh token อัตโนมัติ refresh token อายุ 480 นาที ถ้าหมดต้องเก็บใหม่

## Locust

```bash
pip install locust && locust --version

# 1) baseline: 2 users นาน 3 นาที (ปิดขั้นบันได)
LOADTEST_STEPS=off locust -f scripts/loadtest/locustfile.py --host <API_URL> --headless -u 2 -r 1 -t 3m

# 2) step test: เปิด http://localhost:8089 แล้วกด Start
locust -f scripts/loadtest/locustfile.py --host <API_URL>
```

- **ขั้นบันได (`StepLoad`):** 10 → 20 → 40 users ขั้นละ 2 นาที แล้ว 80 users อีก 6 นาที รวม 12 นาที หยุดเอง ตามกฎของคาบ (สูงสุด 80 users)
- **สัดส่วน list : detail : write = 4 : 4 : 2:** เขียน 20% คือ `PATCH /api/v3/plans/{id}` บันทึกร่างแผนของบัญชีทดสอบ
- **409 จากบัญชีซ้ำ:** virtual user วนใช้ 10 บัญชี จึงแสดงเป็นแถว `write 409 (บัญชีซ้ำ)` และไม่นับเป็น error
- **`write: read plan`:** การอ่านแผนเพื่อเอา version ล่าสุด เกิดตอนเริ่มและหลัง 409
- **กันยิงผิดเป้า:** สคริปต์ปฏิเสธ host ของ API ตัวจริง
- **เก็บผล:** แท็บ Download Data → Download Report (HTML) ก่อนปิด Locust พร้อมแคป CloudWatch dashboard `coed-loadtest` ช่วงเวลาที่ยิง (ตั้งเป็น Local timezone)

## หลังเรียน

- [x] `bash scripts/loadtest/stack-down.sh` (Lambda, API, dashboard, log group, IAM role)
- [x] ลบ `scripts/loadtest/tokens.json`
- [x] ลบ RDS `coed-loadtest-db` แบบไม่มี final snapshot, owner secret, security group 2 ตัว และ ENI 3 ตัว และถอนเฉพาะสิทธิ์ Load Test ออกจาก VPC endpoint ที่ใช้ร่วมกับ production (รณกฤต)
- [x] app secret ตั้งลบถาวรวันที่ 26 พ.ย. 2569 (ช่วงกู้คืน 7 วัน)
- [x] ลบผู้ใช้ Cognito `loadtest01`–`loadtest10` และยืนยันด้วย `admin-get-user` ว่าเป็น NOT_FOUND ครบ (ณัษฐภาคย์)
- [x] ลบ log group `/aws/lambda/coed-loadtest-maxconn` (Lambda ชั่วคราวที่ใช้อ่าน `max_connections`) และตรวจแล้วว่าไม่เหลือ Lambda, log group, API, dashboard, RDS หรือ IAM role ของ loadtest (20 พ.ย.)
- [ ] เช็ก Billing ของบัญชีกลุ่มหลัง 26 พ.ย.
