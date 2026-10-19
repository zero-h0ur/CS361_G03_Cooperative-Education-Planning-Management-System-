# My Plan editor — Issue #73

หน้า `app.html#/student/plan` ให้ Student สร้าง เปิด และแก้ไขแผนของตนเอง
ผ่าน API จริง ใช้รูปแบบหน้าจอและสีของ authenticated shell ล่าสุด
และทำงานร่วมกับ Submit/Status History ของ #76

## API ที่ใช้

| งาน | API |
| --- | --- |
| เลือกรอบสมัคร | `GET /api/v3/plan-options/cycles` (เพิ่มใน #73) |
| เปิดรายการแผนของตนเอง | `GET /api/v3/plans?pageSize=100` (ตาม Pagination จนครบ) |
| เปิด Plan detail กรณีไม่อยู่ในรายการที่อ่านมา | `GET /api/v3/plans/:planId` |
| สร้าง Draft | `POST /api/v3/plans` |
| แก้ไข Draft/แผนที่ส่งกลับแก้ไข | `PATCH /api/v3/plans/:planId` |
| ค้นหาบริษัท/ตำแหน่ง | `GET /api/companies?q=...&page=...&pageSize=10` |
| เลือกตำแหน่งในบริษัท | `GET /api/companies/:companyId/positions` |

Cycle options ต้อง Deploy พร้อม Backend ก่อนเปิดใช้ Frontend ใหม่นี้ หาก API
Gateway ใช้รายชื่อ Route แบบแยก Path ต้องเพิ่ม GET Route นี้ภายใต้ JWT Authorizer
เดียวกับ Protected V3 API เดิม ค่าที่ API คืนมีเฉพาะ `id`, `name`,
`academic_year`, `semester`, `status` ของรอบที่เป็น Public และเรียงลำดับแน่นอน
เฉพาะ Student ที่ Active และ Linked เท่านั้นอ่านได้ รอบ CLOSED ใช้เก็บ Draft
ได้ แต่ Submit ยังต้องผ่านการตรวจว่าเป็น OPEN ที่ Server

## พฤติกรรมของ Editor

- สร้าง Draft ต้องเลือก Cycle ส่วน Company/Position และ notes ยังว่างได้
- แก้ได้เฉพาะ DRAFT และ NEEDS_REVISION; NEEDS_REVISION ต้องมี Company/Position
- รอบเดียวกันมีแผนที่ไม่ CANCELLED ได้ไม่เกินหนึ่งรายการตาม Backend contract
- ค้นหา Company หน่วง 300ms, ยกเลิกและข้าม Response เก่า, มีปุ่มอ่านหน้าถัดไป
- เปลี่ยน Company แล้วล้าง Position ทันที และอ่าน Position ของ Company ใหม่
- ไม่สร้าง Company/Position ใหม่ และไม่ใช้ชื่อที่พิมพ์เป็น Foreign Key
- notes เป็น Plain text, Trim, ค่าว่างเป็น null, สูงสุด 2,000 ตัวอักษร
- เมื่อมีข้อมูลยังไม่บันทึกจะปิดปุ่ม Submit, เปลี่ยนแผน และ Refresh ภายในหน้า
  มีปุ่มโหลดข้อมูลล่าสุดและทิ้งการแก้ไขให้ผู้ใช้เลือกเอง
- ทุก Save ส่ง operation_id; PATCH ส่ง expected_version ที่อ่านมาล่าสุด
- ระหว่าง Save ปิดการส่งซ้ำ หาก Network ล้มเหลวจะ Retry ด้วย Payload/Key เดิม
  ผู้ใช้ต้อง Retry หรือโหลดข้อมูลล่าสุดก่อนแก้ Payload เพิ่ม
- Conflict ไม่ Retry อัตโนมัติ เก็บบันทึกที่กรอกไว้ให้คัดลอก และปิด Save
  จนกว่าจะโหลดข้อมูลล่าสุดและตรวจสอบใหม่
- บันทึกสำเร็จแล้วอ่าน Plan/History ล่าสุดจาก Server ก่อนให้ Submit ต่อ
- ใช้ Label ที่ผูกกับ Native input/select, aria-invalid และข้อความ Field error
  พร้อมเลื่อน Focus ไปช่องผิดตัวแรก; ข้อความ Directory แสดงผ่าน textContent
- ไม่มีการเก็บ notes หรือ Plan payload ใน Browser storage หรือ Application log

## Automated verification

รันจาก Repository root หลังติดตั้ง Dependencies ตาม Lockfile:

```sh
npm run test:plan
npm run test:contract
npm run test:frontend
npm run build
git diff --check
```

ผลวันที่ 2026-10-19:

- Own Plan/Cycle options: 24 tests ผ่าน (รวม Cycle options ใหม่ 7 tests)
- Shared API contract: 24 tests ผ่าน
- Frontend: 122 tests ผ่าน (รวม Editor/client ใหม่ 24 tests)
- Public API: 17, Authorization: 30, Lambda: 6 tests ผ่าน
- Frontend build ผ่าน

Tests ใช้ Synthetic responses ผ่าน Dependency injection ใน Test process
ครอบคลุม create/update payload, required/optional fields, Version, idempotent
retry, conflict recovery, invalid references, stale search/Position responses,
Company pagination, historical Plan selection, route abort, locked states,
session errors, validation focus และการแสดงข้อความที่มี HTML เป็นข้อความธรรมดา

## Manual review ก่อน Merge

ยังไม่ได้ตรวจ Browser จริงใน Session นี้ เพราะ Computer Use ไม่มี Browser
ที่เชื่อมต่ออยู่ รายการด้านล่างจึงยังไม่ถือว่าผ่าน Automated tests ข้างต้น

ใช้ Environment ที่ตั้งค่า Cognito/API ตาม
[authenticated shell guide](v3-authenticated-shell.md) และบัญชี Student สังเคราะห์
ที่ Linked กับฐานทดสอบ:

1. เปิด `app.html#/student/plan` หลัง Login ตรวจ Loading และ No Plan state
2. เลือก Cycle แล้วสร้าง Draft โดยยังไม่เลือก Company/Position ตรวจ Version 1
3. ค้นหา Company, เลือก Position, บันทึก notes และตรวจชื่อ/Version ที่อ่านกลับมา
4. เปลี่ยน Company ตรวจว่า Position เดิมถูกล้าง และเลือกได้เฉพาะบริษัทใหม่
5. เปิดหลายแผน รวม CANCELLED และตรวจว่าฟอร์มแก้ไขไม่มีในสถานะที่ล็อก
6. เปิดแผนเดียวกันสอง Tab; Save Tab แรกแล้ว Save Tab ที่สอง ตรวจ Conflict,
   ข้อความที่ยังอยู่ และปุ่มโหลดข้อมูลล่าสุด โดยไม่มีการเขียนทับอัตโนมัติ
7. ทดสอบ Validation ก่อน Save/จาก Server และ Network error โดยไม่เปิดเผย Token
   หรือ notes ใน Console แล้วตรวจว่า Retry ไม่สร้างข้อมูลซ้ำ
8. ใช้ Tab, Shift+Tab, ลูกศรเลือก Options และ Enter ตลอด Flow ตรวจ Focus ring,
   Label, Field error และ Focus หลัง Save/Validation
9. ตรวจความกว้าง 320px, 768px และ Desktop: ไม่มีแนวนอนล้น ฟอร์มเรียงอ่านได้
   Dropdown/ปุ่มไม่ถูกตัด และยังเข้าถึง Save/Retry ได้
10. บันทึกข้อมูลให้ครบแล้วใช้ Submit/History เดิม ตรวจว่าไม่มี Regression

การ Refresh ทั้ง Browser หรือออกจาก Route จะทิ้งข้อมูลที่ยังไม่บันทึก; Editor
ไม่เก็บ Protected draft ใน Local/Session storage
