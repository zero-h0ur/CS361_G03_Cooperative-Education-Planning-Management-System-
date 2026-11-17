# คู่มือปฏิบัติงาน Load Test & Auto Scaling — ส่วนของภูริณัฐ (ข้อ 3, 4, 5)

เอกสารนี้สรุปคำสั่งใช้งาน สคริปต์ บทพูดนำเสนออาจารย์ ตารางจดผลในคาบ และเช็กลิสต์ลบระบบหลังเรียน สำหรับงาน Load Test ของกลุ่ม CS361 G03 (แนวทาง A: ระบบทดสอบแยก `coed-api-loadtest` + `coed-loadtest-db`)

> **คำเตือนสำคัญ:** ห้ามชี้ `smoke.mjs`, `generate-companies.mjs`, หรือ Locust ไปที่ระบบจริง (`yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com` หรือ RDS ตัวจริง) เด็ดขาด และห้าม commit ไฟล์ `tokens.json` หรือ access token

---

## 1. สิ่งที่สร้างและวิธีรัน

### 1.1 สร้างข้อมูลบริษัทสังเคราะห์ 300–500 แถว (ส่งให้รณกฤตภายใน 22:30 น.)

- สคริปต์สร้าง SQL: [generate-companies.mjs](./generate-companies.mjs)
- ไฟล์ SQL ที่สร้างไว้แล้ว (400 บริษัท `LOADTEST...` + 800 ตำแหน่งงาน): [companies-seed.sql](./companies-seed.sql)

คำสั่งกรณีรณกฤตต้องการรันไฟล์ SQL ลงฐานทดสอบ (`coed-loadtest-db` เท่านั้น):

```bash
psql "$LOADTEST_DB_URL" -f scripts/loadtest/companies-seed.sql
```

หากต้องการปรับจำนวนบริษัทระหว่าง 300–500 แถว (สร้างเป็น UTF-8 พร้อมใช้บน Windows และ Linux):

```bash
node scripts/loadtest/generate-companies.mjs --count 400 --out scripts/loadtest/companies-seed.sql
```

ตรวจดูสัดส่วน `location` (อ้างอิงสัดส่วนจาก [data/companies.json](../../data/companies.json)):

```bash
node scripts/loadtest/generate-companies.mjs --stats
```

รายละเอียดสำคัญของชุดข้อมูลสังเคราะห์:
- ชื่อบริษัททุกแถวขึ้นต้นด้วย `LOADTEST` และมีคีย์เวิร์ดด้านไอทีหลากหลาย (`Cloud`, `Data`, `AI`, `Software`, `FinTech`, `Cyber`, `Web`, `Mobile`, `DevOps`, `Network`)
- รหัสบริษัท `LT0001`–`LT0400` และ UUID ช่วง `50000000-0000-4000-8000-...` ไม่ชนกับข้อมูลจริงหรือ fixtures เดิม
- ตั้ง `catalog_key = 'loadtest-synthetic-2569'` เพื่อให้ query ของ `DirectoryRepository` (`CATALOG`) แสดงทั้ง 400 แถวครบถ้วน โดยยังคงบริษัทอ้างอิงของแผนร่าง (`DRAFT` plans) ใช้งานได้ตามปกติ

---

### 1.2 สคริปต์ Smoke Test 3 การกระทำ (ตรวจระบบทดสอบคืนนี้ 23:30 น. และเช้าพรุ่งนี้)

- สคริปต์: [smoke.mjs](./smoke.mjs)

คำสั่งรันตรวจสอบระบบทดสอบ (ใส่ URL ของ `coed-loadtest-api` และ access token ของบัญชีทดสอบ 1 บัญชี):

```bash
node scripts/loadtest/smoke.mjs --url "https://<loadtest-api-id>.execute-api.ap-southeast-2.amazonaws.com" --token "<ACCESS_TOKEN>"
```

สิ่งที่สคริปต์ตรวจให้โดยอัตโนมัติ:
1. **Safety Guard**: บล็อก URL ของระบบจริง (`config/v4-public.json` และโดเมน API/Amplify จริงทั้งหมด) ก่อนส่ง request ใด ๆ
2. **List Companies (`50%`)**: `GET /api/directory/companies?q=&location=&page=1&pageSize=20` ต้องได้ `200`, มีรายการบริษัท, แสดงจำนวนรวม (`total`) และเวลาตอบ (ms)
3. **Company Detail (`30%`)**: `GET /api/directory/companies/{id}` โดยใช้ `id` จริงจากข้อ 1 ต้องได้ `200` และคืน `id` ตรงกัน พร้อมเวลาตอบ (ms)
4. **Plan Read + Patch (`20%`)**: `GET /api/v3/plans` ต้องได้ `200`, หาแผนสถานะ `DRAFT`/`NEEDS_REVISION`, จากนั้น `PATCH /api/v3/plans/{id}` ด้วย `{ notes, expected_version, operation_id }` ต้องได้ `200` และ `version` เพิ่มขึ้น `1`

> หาก `PATCH /api/v3/plans/{id}` ตอบ `503 [COED_MAINTENANCE]` ให้แจ้งปพนพัชร์ตรวจ env บน Lambda ทดสอบว่าตั้ง `COED_API_MAINTENANCE=off` แล้ว (เพราะ stage `intake-pilot` บล็อกเส้นทางแผน V3)

---

## 2. บทพูดนำเสนออาจารย์ (ซ้อมให้จบใน 2–3 นาที)

### ช่วงที่ 1: ประโยคเปิด & แผนภาพสถาปัตยกรรม (30 วินาที)
- **ประโยคเปิด**: *"กลุ่ม G03 เลือกแนวทาง A คือไม่ยิงโหลดใส่ระบบจริงของโปรเจกต์ครับ เพราะข้อมูลทดสอบที่เขียนลงไปจะลบออกจากฐานจริงไม่ได้ และระบบจริงมีผู้ใช้รอบทดลองอยู่ เราจึงสร้างสำเนาระบบทดสอบแยกที่ใช้โค้ด Lambda เวอร์ชัน 15 ตัวเดียวกับของจริง Memory/Timeout/VPC เท่ากัน และ RDS PostgreSQL Instance Class เดียวกัน ใส่ข้อมูลสังเคราะห์ทั้งหมด แล้วยิง Locust ใส่ระบบทดสอบแทน จากนั้นลบทิ้งทั้งชุดหลังเรียนครับ"*
- **ชี้แผนภาพประกอบ**:
  - แถวบน = ระบบจริง (`API Gateway` ➔ `Lambda coed-api` ➔ `RDS จริง`) **ไม่ถูกแตะเลย**
  - แถวล่าง = ระบบทดสอบ (`Locust` ➔ `HTTP API coed-loadtest-api` ➔ `Lambda coed-api-loadtest` ➔ `RDS coed-loadtest-db`)
  - ตรงกลาง = **2 ส่วนที่ใช้ร่วมกัน**: Cognito User Pool (สร้าง 10 บัญชีทดสอบแยก ไม่มีสิทธิ์ในฐานจริง) และโควตา Lambda Concurrent Executions ระดับบัญชี

### ช่วงที่ 2: เหตุผลที่ไม่ยิงระบบจริง 4 ข้อ (45 วินาที)
1. **ข้อมูลทดสอบลบไม่ได้จริง**: การ Write 20% ผ่าน `PATCH /api/v3/plans/{id}` บันทึก Log แบบ Append-only ลง `plan_operations` และ `audit_events` ซึ่งมี DB triggers (`trg_plan_operations_immutable`, `trg_audit_events_immutable`) ห้าม `UPDATE/DELETE` ส่วนตาราง `plans` ก็มี `trg_plans_no_delete` ห้าม Hard Delete การปิด Trigger เพื่อลบจะทำลายความสมบูรณ์ของ Audit Log
2. **มีผู้ใช้จริงในรอบทดลอง (Pilot)**: ไม่ให้ข้อมูลสังเคราะห์ปะปนและไม่ทำให้ระบบของนักศึกษา/ผู้ประสานงานช้าลง
3. **ผลทดสอบใช้สรุปคอขวดแทนของจริงได้**: ใช้โค้ด Lambda ชุดเดียวกับที่ Deploy จริง, Runtime/Memory/Timeout/VPC เหมือนกัน, RDS Class เท่ากัน และผ่าน API Gateway JWT Authorizer เหมือนกัน
4. **ทำความสะอาดได้ 100% หลังเรียน**: ลบ RDS, Lambda, HTTP API ทดสอบ และบัญชี Cognito loadtest01–10 ทิ้งได้หมด

### ช่วงที่ 3: เหตุผลที่เลือก 3 Endpoints ในสัดส่วน 50 / 30 / 20 (ข้อ 5) (30 วินาที)
1. **50% List Companies (`GET /api/directory/companies?q=&location=&page=&pageSize=20`)**: เป็นจุดเข้าหลักที่นักศึกษาเปิดค้นหาสถานประกอบการมากที่สุด วัด Query ค้นหา `ILIKE`, กรองจังหวัด, `COUNT(*)`, Pagination (response ตั้ง `Cache-Control: no-store` จึงลง RDS ทุก request)
2. **30% Company Detail (`GET /api/directory/companies/{id}`)**: จำลองการคลิกดูรายละเอียดบริษัทหลังค้นหา วัด Primary Key Lookup
3. **20% Draft Plan Update (`GET /api/v3/plans` + `PATCH /api/v3/plans/{id}`)**: จำลองการบันทึกข้อมูลที่มี JWT Auth, DB Transaction, Row Lock (`FOR UPDATE`), Optimistic Locking (`expected_version`), Idempotency (`plan_operations`), และการเขียน Audit (`audit_events`)

### ช่วงที่ 4: ข้อจำกัดที่แจ้งอาจารย์อย่างตรงไปตรงมา (30 วินาที)
- **โควตา Lambda Concurrency ใช้ร่วมกันทั้ง AWS Account**: เราจึงต้องเฝ้ากราฟ `Throttles` บน Dashboard ตลอด และหยุดยิงทันทีก่อนชนเพดานเพื่อไม่ให้กระทบระบบจริง
- **ใช้ Cognito Pool เดียวกัน**: เมื่อ Users เกิน 10 จะใช้ 10 บัญชีทดสอบวนซ้ำ ทำให้เกิด HTTP `409 Conflict` จาก `expected_version` ชนกันได้ ซึ่งไม่ใช่ Error ของระบบและเรานับแยกออกจาก Error % จริง
- **ใช้การแก้ร่างแผน V3 แทนใบสมัคร Phase 1**: เพราะ Phase 1 ผูกกับการล็อกอิน TU REST API ของมหาวิทยาลัยและอัปโหลดไฟล์ลง S3 ซึ่งไม่สามารถสร้างบัญชี TU ปลอมมายิงได้
- **ข้อมูลเป็นชุดสังเคราะห์**: ขนาด Distribution อาจต่างจาก Production และสร้างจาก Fresh migrations (ยืนยันแล้วว่าคอลัมน์ของทั้ง 3 Endpoint ตรงกัน)

---

## 3. ตารางบันทึกผลในคาบ (ค้างขั้นละ ~3 นาที)

**เป้าหมายก่อนยิง (SLO)**: `p95 <= 1,000 ms` และ `Error % <= 1%` *(ไม่นับ `409` ที่เกิดจากการวนใช้ 10 บัญชีซ้ำ)*  
**Baseline ที่สำรวจไว้ (17 พ.ย. 69)**: list `~300–370 ms`, detail `~270 ms` *(Latency ฐานส่วนใหญ่มาจากระยะทางกรุงเทพฯ–Sydney `ap-southeast-2`)*

| Users | RPS | p95 (ms) | Error % (ไม่รวม 409) | 409 Count | Lambda Concurrent | Throttles | RDS CPU % | DB Connections | สิ่งที่เห็น / อาการ |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **5** | | | | | | | | | |
| **20** | | | | | | | | | |
| **50** | | | | | | | | | |
| **100** | | | | | | | | | |
| **เพิ่ม (ถ้ายังไหว)** | | | | | | | | | |

**สรุปท้ายคาบ (เติมในห้องเรียน):**
> ระบบรับได้ `_____` users ก่อนเกินเป้า (`p95 = _____ ms`, `Error = _____%`)  
> คอขวดที่ชนเพดานก่อนคือ `________________` เพราะสังเกตเห็นอาการ `________________`  
> ควร Scale โดย `________________________________________________`

---

## 4. โพยวิเคราะห์คอขวดและวิธี Scale (ข้อ 4)

| อาการที่เห็น (Locust + Dashboard) | คอขวด | วิธี Scale ที่เหมาะสม | ต้นทุนและข้อแลกเปลี่ยน |
| :--- | :--- | :--- | :--- |
| `Throttles > 0`, API ตอบ `5xx`, `ConcurrentExecutions` แบนติดเพดาน | **โควตา Lambda Concurrency ระดับบัญชี** | ขอเพิ่ม Service Quota; ตั้ง Reserved Concurrency กันพื้นที่ให้ `coed-api` ตัวจริง | ไม่มีค่าใช้จ่ายเพิ่ม แต่การขอเพิ่มโควตาต้องรอ AWS อนุมัติ |
| `DatabaseConnections` พุ่งใกล้ `max_connections`, log ต่อ DB ไม่ได้ แต่ `RDS CPU` ยังต่ำ | **จำนวน DB Connections ของ RDS** | ใส่ RDS Proxy; คุม `DB_POOL_MAX=1`; จำกัด Reserved Concurrency ไม่ให้เกินที่ DB รับไหว | RDS Proxy มีค่าใช้จ่ายรายชั่วโมง; จำกัด Concurrency ทำให้ส่วนเกินถูก throttle |
| `RDS CPU` สูงค้าง (>80%), `p95` ขึ้นทุก endpoint, `Lambda Duration` สูงตาม | **CPU ของ RDS PostgreSQL** | Scale up Instance Class; เพิ่ม Read Replica สำหรับ Read 80%; ใส่ Cache ให้ Directory List | ปรับ Class มี downtime สั้น ๆ; Replica ต้องปรับโค้ดแยก Read/Write |
| `Lambda Duration` สูงตอนเพิ่ม users แล้วค่อยลง ขณะที่ `RDS CPU` และ connections ต่ำ | **CPU ของ Lambda หรือ Cold Start** | เพิ่ม Memory ให้ Lambda (ได้ vCPU เพิ่มตาม); เปิด Provisioned Concurrency | ค่า Compute ต่อ ms สูงขึ้น; Provisioned คิดเงินตลอดเวลา |
| เฉพาะ `list` ช้ากว่า `detail` ชัดเจน | **Query `ILIKE` / Pagination บน `companies`** | เพิ่ม Trigram Index (`pg_trgm`) หรือ Short-TTL Cache หน้า Directory (`Cache-Control`) | Cache ทำให้ข้อมูลบริษัทใหม่โผล่ช้าลงตาม TTL |
| `409` เพิ่มขึ้นตาม Users ในขณะที่ตัวชี้วัดอื่นปกติ | **ไม่ใช่คอขวด** | เกิดจาก Locust วนใช้ 10 บัญชีซ้ำจน `expected_version` ชนกัน | นับแยก ไม่นำมาคำนวณ Error Rate |

---

## 5. เช็กลิสต์ติดตามหลังเรียน (ภูริณัฐตามเช็กในกลุ่มจนครบ)

- [ ] **ปพนพัชร์**: รัน `scripts/loadtest/stack-down.sh` ลบ `coed-api-loadtest`, `coed-loadtest-api`, IAM Role ทดสอบ และ Dashboard `coed-loadtest` เรียบร้อย
- [ ] **รณกฤต**: ลบ RDS `coed-loadtest-db` (แบบไม่เก็บ Final Snapshot), Secrets Manager ทดสอบ และ Security Group ทดสอบ เรียบร้อย
- [ ] **ณัษฐภาคย์**: ลบผู้ใช้ Cognito `loadtest01`–`loadtest10` ออกจาก Pool `ap-southeast-2_Um6nksXa1` ครบทั้ง 10 บัญชี และลบไฟล์ `tokens.json` ในเครื่อง
- [ ] **ปพนพัชร์**: เช็ก AWS Billing / Cost Explorer ว่าไม่มีทรัพยากรทดสอบค้างคิดเงินรายชั่วโมง
