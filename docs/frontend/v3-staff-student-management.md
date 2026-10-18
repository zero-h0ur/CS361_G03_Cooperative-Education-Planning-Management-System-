# Staff Student/Plan search — Issue #74

หน้า Staff ใช้ Read-only API ของ #67 เพื่อค้นหา Student/Plan ภายใน Scope
ที่ Backend อนุญาตทุก Request หน้า List ไม่มี Workflow mutation

## Routes และงานที่รับผิดชอบ

| Route | หน้าที่ |
| --- | --- |
| `app.html#/staff/students` | ค้นหานักศึกษา |
| `app.html#/staff/plans` | ค้นหาแผนทุกสถานะใน Scope |
| `app.html#/staff/review/:planId` | ส่งต่อแผนที่เลือกให้ Review workspace ของ #77 |
| `app.html#/staff/review` | Route คิวตรวจเดิม รอ #77 |

ทุก Route ตรวจ Session และ Role `STAFF` ก่อนแสดงข้อมูล ผู้ใช้ Student/Advisor
ไม่เห็นเมนูและเข้า Route โดยตรงไม่ได้ Backend ยังคงตรวจ Role/Active scope
ด้วยตัวเอง การซ่อนเมนูไม่ใช่ Authorization เพียงชั้นเดียว

ตามข้อตกลงของ #74 หน้า `#/staff/review/:planId` ตรวจรูปแบบ UUID และแสดงว่า
รอ #77 เท่านั้น ไม่มีการเรียก Detail API หรือแสดงปุ่ม Start review/Return/Approve
ทีม #77 สามารถรับ `route.params.planId` ที่ Route นี้เพื่อเพิ่ม workspace ภายหลัง
ต้องตรวจ Scope และอ่านข้อมูลจาก Backend อีกครั้งก่อนแสดง Detail/Action

## API และ controls

| หน้า | API | ตัวกรองใน UI |
| --- | --- | --- |
| นักศึกษา | `GET /api/v3/staff/students` | `q`, `academic_year`, `page`, `pageSize` |
| แผน | `GET /api/v3/staff/plans` | ตัวกรองข้างต้น และ `status`, `sort`, `order` |

- `q` ค้นหาชื่อ ชื่อที่ใช้เรียก หรือรหัสนักศึกษา ไม่เกิน 100 ตัวอักษร
- ปีการศึกษารับปี พ.ศ. 2500–2700 ตาม #67
- ค่าเริ่มต้น 20 รายการต่อหน้า; UI มี 20/50/100 และรองรับค่าจาก URL 1–100
- Student API เรียง `student_number ASC, id ASC` แบบตายตัว จึงไม่มี Sort ที่
  Backend ไม่รองรับบนหน้านักศึกษา
- Plan sort คือ `updated_at`, `created_at`, `student_number`, ลำดับ asc/desc
- Backend เป็นผู้เรียง/กรอง/นับ Total และใช้ ID เป็น Tiebreaker
- เปลี่ยน Filter/Sort/Page size จะกลับหน้า 1; Page ถัดไปคงตัวกรองที่ Apply แล้ว
- ค้นหาด้วย Form submit; เปลี่ยน Dropdown จะ Apply ด้วยค่าฟอร์มปัจจุบัน
- ยกเลิก Request เก่าและข้าม Response ที่ล้าสมัย แม้ Fetch ไม่ยอม Abort
- `advisor_id`, `round_id`, `company_id` เป็น Optional filters ของ API #67
  แต่ยังไม่มี Lookup contract สำหรับ Staff UI จึงไม่ได้เพิ่มเป็น Controls ใน #74
  ไม่สร้างตัวเลือกปลอม หรือให้ผู้ใช้กรอก UUID ภายในระบบ

## ข้อมูลที่แสดงและ URL state

Student summary แสดงเฉพาะ Fields ที่ #67 อนุญาต เช่น รหัส ชื่อ ภาควิชา
หลักสูตร สาขา ปี และสถานะการศึกษา Plan summary มีสถานะ รอบ บริษัท/ตำแหน่ง
ข้อมูล Student summary และเวลาอัปเดต

Client สร้าง Object ตาม Allowlist ใหม่ทั้งระดับบนและ Nested objects ไม่มี
Institutional email, Identity/User ID, notes หรือ Review comments ค้างในผลลัพธ์
ชื่อ Company/Position ที่ API ปิดบังเป็น null แสดงข้อความว่าไม่เปิดเผย
ข้อมูลข้อความทั้งหมดแสดงผ่าน textContent

URL เก็บเฉพาะ `academic_year`, `status`, `sort`, `order`, `page`, `pageSize`
ที่ถูกต้องตามชนิดของหน้า Unknown/duplicate parameters และ UUID ผิดรูปแบบ
ถูกปฏิเสธ คำค้น `q` ซึ่งอาจมีชื่อ/รหัสนักศึกษาอยู่ใน Memory ของ View เท่านั้น
ไม่เขียน URL, Browser history state หรือ Local/Session storage เมื่อ Refresh
หรือกลับเข้าหน้าต้องกรอกคำค้นใหม่ และหน้าค้นหาที่มี Keyword จะไม่เก็บเลขหน้า
ที่ขึ้นกับ Keyword นั้นใน URL

## Loading และ Error

- Loading ล้างรายการเดิมและกำหนด aria-busy
- ไม่มีผลลัพธ์แสดงข้อความให้เปลี่ยนคำค้น/ล้าง Filter
- Page ไม่มีข้อมูลมีปุ่มกลับหน้า 1
- 400 แสดง Field error ที่ผูกกับ Label/Input พร้อม Focus
- 401 ส่งต่อ Session expired ของ Shell
- 403 ล้างผลลัพธ์และส่งต่อ Access denied ของ Shell
- Network/503 หรือ Response ผิดรูปแบบแสดง Unavailable พร้อม Retry

## วิธีรันและผล Automated tests

จาก Repository root หลังติดตั้ง Dependencies:

```sh
npm run test:staff-ui
npm run test:frontend
npm run test:authz
npm run test:contract
npm run build
git diff --check
```

`test:staff-ui` และชุด Frontend ใช้ Synthetic responses ไม่ต้องมี Docker,
Cognito หรือ Login จริง ไม่มี Mock role ถูกเพิ่มใน Production entry point

ผลวันที่ 2026-10-19:

- Staff UI/client/filter/role tests: 39 ผ่าน (รวมอยู่ใน Frontend)
- Frontend regression: 169 ผ่าน
- Staff API (#67): 33 ผ่าน รวม PostgreSQL integration 5 tests
- Authorization: 30 ผ่าน
- Shared API contract: 24 ผ่าน
- รวมชุดที่เกี่ยวข้อง 256 tests ผ่าน; Build และ diff check ผ่าน

`npm run test:staff` ต้องมี `TEST_DATABASE_URL` ที่ชี้ฐานทดสอบแยกเท่านั้น
Test harness ของ #67 จะ Seed/reset ข้อมูล Synthetic ในฐานนั้น ขณะตรวจ #74
ใช้ Container ชั่วคราว `coed-issue74-test` พอร์ต 55474 ไม่ใช่ฐานหลักหรือ Production

## Manual review ที่ยังต้องทำ

Session นี้เครื่องมือไม่มี Browser ที่เชื่อมต่อ จึงยังไม่ได้ตรวจภาพจริงหรือ
พฤติกรรม Keyboard บน Browser ไม่ถือว่ารายการต่อไปนี้ผ่านจาก Unit tests อย่างเดียว

ใช้ Cognito/API configuration ตาม [shell guide](v3-authenticated-shell.md)
และบัญชี Staff ทดสอบที่มี Active scope:

1. เปิด `/app.html#/staff/students` ตรวจ Loading ก่อน Session พร้อม และรายการ
   ที่ได้ตรงกับ Department/Program/Year ของ Staff
2. ค้นหาชื่อ/รหัส กรองปี พ.ศ. เปลี่ยน Page size และเดินหน้าถัดไป/ก่อนหน้า
   ตรวจว่าเปลี่ยน Filter แล้วกลับหน้า 1 และ Total นับเฉพาะ Scope
3. เปิด `/app.html#/staff/plans` ลองทุกสถานะและ Sort/Order เทียบกับ API
4. กด “เปิดตรวจแผน” ตรวจ Route มี Plan UUID และแสดงข้อความรอ #77
   ไม่ควรมีปุ่มเปลี่ยนสถานะ หรือเรียกคำสั่ง POST/PATCH/DELETE
5. ใช้บัญชี Student/Advisor เปิด Staff URL โดยตรง ต้องถูกปฏิเสธ
6. ลองปี ค.ศ., ผลลัพธ์ว่าง, Network error, 401 และ 403; ต้องไม่มีรายการเก่า
   ค้างให้เห็นหลังระบบปฏิเสธสิทธิ์
7. ใช้ Tab/Shift+Tab, ลูกศรใน Select และ Enter ส่งฟอร์ม ตรวจ Focus ring,
   Label, Field error และ Focus ไปผลลัพธ์หลังค้นหา
8. ตรวจจอ 320px, 768px และ Desktop: ไม่มีแนวนอนล้น ข้อความ/ปุ่มอ่านและกดได้
9. ตรวจ URL/Browser storage ว่าไม่มีชื่อ รหัสนักศึกษา หรือคำค้นที่พิมพ์
10. แนบผล/ภาพ Manual review ใน PR ก่อนติ๊ก Acceptance Criteria ครบ
