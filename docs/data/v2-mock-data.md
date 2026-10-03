# CO-ED V2 Mock Dataset

เอกสารนี้อธิบายชุดข้อมูลมาตรฐานสำหรับ Development, Test และ Demo ของ CO-ED V2 ตาม Issue [#29](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/29) โดยปรับโครงสร้างให้ตรงกับ Minimum data model ล่าสุดใน Issue [#28](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/28)

> สถานะ: Provisional — ชุดข้อมูลนี้ใช้ได้ระหว่างพัฒนา แต่ต้องตรวจเทียบกับ #28 อีกครั้งเมื่อทีมอนุมัติ Data model ฉบับสุดท้าย

## Files

- **data/v2/mock-dataset.json** — Canonical dataset ที่ทุกคนใช้ร่วมกัน
- **scripts/validate-v2-dataset.mjs** — ตรวจ Schema, Relationship, Privacy และ Scenario coverage
- **tests/v2-dataset.test.mjs** — Automated tests สำหรับ Data quality

ชุดข้อมูลนี้แยกจากข้อมูลที่เขียนไว้ในหน้าเว็บ V1 และยังไม่ได้เชื่อมกับ Production database

## Dataset Scope

| Entity | จำนวน | Visibility | จุดประสงค์ |
| --- | ---: | --- | --- |
| companies | 12 | Public 11, Private 1 | ทดสอบรายการบริษัท, Search และ Public filtering |
| positions | 18 | Public 17, Private 1 | ทดสอบตำแหน่งงาน, Search, Location filter และ Pagination |
| rounds | 3 | Public 2, Private 1 | ข้อมูลรอบขั้นต่ำตาม #28 โดยยังไม่มีวันหรือสถานะเปิดรับ |
| document_metadata | 8 | Public 7, Private 1 | Metadata และ URL ของเอกสารตัวอย่าง |
| students | 5 | Private ทั้งหมด | Test-only records ที่ใช้ anonymous reference |
| plans | 7 | Private ทั้งหมด | Test-only relationship ระหว่าง Student และ Round |

ทุก record ใช้ UUID ที่กำหนดตายตัวและ updated_at ค่าเดิม เพื่อให้ผลการทดสอบซ้ำได้เหมือนกันทุกครั้ง

## Alignment with Issue #28

ความสัมพันธ์ที่รองรับในชุดข้อมูลปัจจุบัน:

- Company 1:N Position ผ่าน positions.company_id
- Student 1:N Plan ผ่าน plans.student_id
- Round 1:N Plan แบบ Optional ผ่าน plans.round_id
- Public Position ต้องอ้างถึง Public Company เท่านั้น

ทุก entity มี source, updated_at, visibility และ data_status ตาม Data governance ใน Issues #26 และ #28 โดย Canonical dataset นี้ใช้ data_status เป็น mock ทุก record ส่วน academic_year ใช้ Integer เมื่อ Entity นั้นต้องมีข้อมูลปีการศึกษา

Issue #28 เวอร์ชันล่าสุดใช้ data_status เป็นตัวระบุสถานะข้อมูล จึงไม่เพิ่ม is_mock ซ้ำในแต่ละ record เพื่อลด field ที่ไม่ได้อยู่ใน Minimum model

## Deferred Fields and Entities

รายการต่อไปนี้ยังไม่รวมใน Dataset เพราะ #28 ระบุให้รอ Requirement หรือ Verified source:

- openings และข้อมูลการเปิดรับ
- plan_choices
- Capacity, วันที่เปิด–ปิด และสถานะเปิดรับ
- Submission หรือ Approval workflow ของ Plan
- work_mode, required_skills, keywords และ field เสริมอื่นนอก Minimum model

เมื่อ Requirement ได้รับการยืนยัน ต้องเพิ่มผ่าน Issue/PR พร้อมปรับ Dataset, Validator, Tests และเอกสารชุดนี้ในครั้งเดียว

## Data Safety

- ชื่อบริษัททุกแห่งมีคำว่า Example, Mock หรือ Demo
- Domain ใช้ .example ซึ่งสงวนไว้สำหรับเอกสารและการทดสอบ
- Student ใช้เพียง UUID และ anonymous_ref
- ไม่มีชื่อจริง รหัสนักศึกษา อีเมล เบอร์โทร GPA หรือข้อมูลส่วนบุคคล
- Student และ Plan เป็น private เท่านั้น
- ข้อมูลนี้ไม่ใช่ข้อมูลเปิดรับสหกิจศึกษาจริง

ห้ามคัดลอกข้อมูล Production หรือข้อมูลส่วนบุคคลมาใส่ในไฟล์นี้ แม้ใช้เพื่อทดสอบชั่วคราว

## Covered Access Patterns

Dataset รองรับการทดสอบ Access patterns จาก Issue #25 และ #28 ดังนี้:

- แสดงรายการ Public companies และ positions
- แบ่งหน้า positions ด้วย Page size ตัวอย่าง 10 รายการ
- ค้นหาบางส่วนจากชื่อบริษัทหรือตำแหน่ง เช่น tech และ นักวิเคราะห์
- ทดสอบกรณีค้นหาไม่พบ
- กรองตำแหน่งตาม Location 6 ค่า
- เรียก record ด้วย UUID
- ตรวจว่า Private records ไม่ปะปนกับ Public response
- โหลด Student/Plan เฉพาะ Test flow

## Run and Verify

ต้องใช้ Node.js 18 หรือใหม่กว่า และไม่ต้องติดตั้ง Package เพิ่ม

~~~bash
node scripts/validate-v2-dataset.mjs
node --test tests/v2-dataset.test.mjs
~~~

Validator ตรวจอย่างน้อย:

- จำนวน Entity และจำนวน Record ที่ประกาศไว้
- UUID และ ID ที่ซ้ำ
- Required/Unsupported fields
- Foreign keys และ Public–Private relationship
- ค่า visibility, data_status, URL และปีการศึกษา
- ข้อมูลส่วนบุคคลและ Credential ที่ไม่ควรอยู่ใน Dataset
- Coverage ของ Search, Location และ Pagination

หากต้องการเริ่มทดสอบใหม่ ให้โหลด data/v2/mock-dataset.json จาก Repository อีกครั้ง ชุดข้อมูลจะกลับเป็นค่าเดิมเสมอเพราะไม่มีการสุ่มค่าและไม่ใช้เวลาปัจจุบันระหว่างสร้างข้อมูล

## Decisions After Review

รายการต่อไปนี้เป็นข้อสรุปชั่วคราวจาก #28 เวอร์ชันล่าสุด และยังต้องได้รับการยืนยันจาก Reviewer ก่อน Merge:

- Canonical format: JSON ที่ไม่ผูกกับฐานข้อมูลชนิดใด
- Entity counts: 12 Companies, 18 Positions, 3 Rounds, 8 Document metadata, 5 Students และ 7 Plans
- Naming: บริษัทใช้ Example/Mock/Demo และเอกสารระบุว่าเป็นตัวอย่าง
- Identifier: UUID v4 แบบ Stable และ Deterministic
- Metadata: source, updated_at, visibility และ data_status ตาม Minimum model
- Public/Private: มี Private fixture สำหรับทดสอบการไม่รั่วไหล และ Student/Plan เป็น Private ทั้งหมด
- Load/Reset: ใช้ไฟล์เดิมเป็น Input แบบ Idempotent; Seed loader จริงอยู่ใน Persistence issue
- Validation: ตรวจ Schema, ID, Relationship, Privacy และ Access-pattern coverage
- Data safety: Automated validation ผ่านแล้ว ส่วน Human data-safety review ยังรอ Reviewer
- Deferred: Openings, Plan choices, Recruitment fields และ Plan workflow ตาม #28

## Before Merge

- ตรวจว่า #28 ฉบับที่ทีมอนุมัติยังใช้ 6 entities และ fields ชุดนี้
- หาก #28 เปลี่ยน Identifier, Relationship หรือ Constraint ให้ปรับทุกไฟล์ในหัวข้อ Files
- รัน Validator และ Test suite ให้ผ่าน
- ตรวจ Diff ว่าไม่มีข้อมูลจริงหรือการแก้ไขหน้าเว็บ V1 ที่ไม่เกี่ยวข้อง
