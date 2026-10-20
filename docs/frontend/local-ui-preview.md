# Local UI Preview (ไม่ใช้ AWS)

ใช้ตรวจ UI ของ Student Profile, My Plan, หน้ารายการ Staff และ Advisor ทั้งสามหน้า โดยใช้ shell, components และ CSS จริง
แต่ฉีด clients ที่ใช้ข้อมูลจำลองในหน่วยความจำจาก entry point แยกเท่านั้น
ไม่ต้องมี Learner Lab, ฐานข้อมูล, Cognito configuration, token หรือ AWS credentials

## เปิดใช้งาน

```powershell
npm.cmd ci
npm.cmd run dev:ui
```

- แผนสหกิจ: http://localhost:8081/app.html#/student/plan
- ข้อมูลของฉัน: http://localhost:8081/app.html#/student/profile
- Staff: http://localhost:8081/app.html?role=STAFF#/staff/students
- Advisor: http://localhost:8081/app.html?role=ADVISOR#/advisor/students

ใช้พอร์ต 8081 แยกจากเว็บจริงที่อาจเปิดอยู่บน 8080 ไม่ต้องรัน `npm run build`
เลือกพื้นที่ Student/Staff/Advisor จากแถบด้านบน Staff มีข้อมูลค้นหาแบบอ่านอย่างเดียวเท่านั้น
ไม่มี Review command service หรือการจำลองสิทธิ์ Backend หน้า Detail/Review ที่ไม่ได้เตรียม Fixture
จะแสดง Placeholder ไม่ใช่ผลการทดสอบการเชื่อมต่อจริง
Advisor มีหน้ารายชื่อ รายละเอียดนักศึกษา/รายการแผน และรายละเอียดแผนจริง แต่ใช้เฉพาะข้อมูลสมมติ
เลือกสถานการณ์มีนักศึกษา, ยังไม่ได้รับมอบหมาย, ไม่มีแผน, ชื่อยาว และถูกถอนการมอบหมายได้
รายละเอียดขั้นตอนอยู่ใน [Advisor workspace](v3-advisor-workspace.md)
เลือกสถานการณ์จำลองจากแถบสีเหลืองด้านบน เปลี่ยน scenario/refresh จะรีเซ็ตข้อมูล
กด Ctrl+C ใน Terminal เพื่อหยุด Server หลังแก้ source ให้หยุดและเปิดคำสั่งใหม่

## สิ่งที่ตรวจได้

- Logo CO-ED, สี, ระยะห่าง และข้อความของหน้าจริง
- Responsive ที่ 320 / 768 / 1366px, ไม่มี horizontal overflow
- Tab / Shift+Tab, focus, Enter, labels และการใช้ dropdown ด้วย keyboard
- ตรวจข้อมูลทางการแบบอ่านอย่างเดียว, รีเฟรชข้อมูล และเปิด/ปิดคู่มือ Flow
- สร้าง Draft, ค้นหา Company, เลือก Position และบันทึก
- Submit จำลอง, หน้าสถานะอ่านอย่างเดียว, ประวัติ, validation และ unsaved changes
- กรณีข้อมูลไม่ครบ, ไม่มีแผน, loading, error, expired, forbidden และ stale conflict

Conflict scenario จะคืน conflict เมื่อกดบันทึกหรือส่งแผน ไม่ใช่การจำลอง concurrent database
Loading scenario ค้างไว้ให้ตรวจหน้ารอโหลด เปลี่ยน scenario เมื่อต้องการออก
ลิงก์ไปหน้า Public ไม่อยู่ใน server นี้ ให้เปิดเว็บ Public ตามวิธีปกติแยกต่างหาก

## Student Profile

หน้า Profile ใช้ชื่อ-นามสกุลทางการ ไม่มีฟอร์มตั้งชื่อแสดงผล และไม่เรียก PATCH
ข้อมูลสมมติใช้ชื่อ ณัฐวดี ศิริกุล รหัสรูปแบบ 10 หลัก และอีเมล `example.invalid`
ทั้งหมดสร้างขึ้นเพื่อ Preview ไม่ใช่ข้อมูลนักศึกษาจริงหรือการรับรองว่ารหัสผ่าน TU API
แถบด้านบนระบุว่าเป็นข้อมูลจำลองเสมอ ข้อมูลเดียวกันอาจแสดงใน Staff Preview ด้วย

- ปุ่มรีเฟรชใช้ GET client เดิม มีข้อความรอโหลด/สำเร็จ ป้องกันการกดซ้ำระหว่างรอ
- คู่มือกดขยายได้ด้วย Keyboard อธิบาย Draft, ส่งตรวจ, ส่งกลับแก้ไข และ Staff มอบหมาย Advisor
- คู่มือไม่ใช่ Progress tracker ไม่ยืนยันว่าผู้ใช้ผ่านเกณฑ์หรือได้รับ Assignment แล้ว
- การสมัครบริษัท การส่งเอกสาร และการยืนยันบริษัทเป็นคำแนะนำให้ดำเนินการผ่านช่องทางที่ Staff กำหนด ไม่ใช่ฟีเจอร์ใหม่ในหน้านี้
- ที่อยู่/เบอร์โทรยังไม่มี API รองรับ จึงไม่มีฟอร์มที่บันทึกจริงไม่ได้
- ข้อมูล `preferred_name` เดิมในฐานข้อมูลและ API เดิมไม่ได้ถูกลบหรือเปลี่ยน
- Profile และ My Plan ใช้ขอบ/เงาการ์ดและข้อความรองที่เข้มขึ้น โดยไม่เปลี่ยนธีม Staff/Advisor
- ทั้งสองหน้ามีจังหวะเปิดหน้าเมื่อข้อมูลพร้อมครั้งเดียว ไม่เล่นซ้ำเมื่อ Save/Refresh
  การ์ดยกขึ้น 6px และไอคอนตอบสนองเมื่อ hover ด้วยเมาส์ ปุ่มที่ Disabled ไม่มี icon-hover effect
  ส่วน Keyboard ใช้ขอบ/เงาเน้นการ์ดที่กำลังใช้งาน โดยไม่ทำให้ทั้งการ์ดคลิกได้
- Motion ของหน้า การ์ด ไอคอน ปุ่ม และการเปิดรายละเอียดปิดเมื่อใช้ Reduced motion
- การ์ดใช้ easing แบบค่อย ๆ ชะลอและ fade เงาด้วย opacity แทนการ animate blur
  ปุ่มแก้ไขแผนย้าย focus โดยไม่กระโดดก่อน แล้วเลื่อนไปฟอร์มแบบ smooth
  เมื่อเปิด Reduced motion จะเลื่อนไปทันที ไม่มีการดัก wheel/touch หรือเปลี่ยนความเร็วการเลื่อนของอุปกรณ์
  CSS native smooth scrolling ใช้เฉพาะหน้า Student บน Browser ที่รองรับ `:has()`
  ความลื่น/เฟรมเรตจริงต้องตรวจใน Browser ไม่ใช่ผลจาก jsdom

ตรวจหน้า Profile ด้วย `?scenario=loading`, `error`, `expired` และ `forbidden`
ส่วน `conflict` ใช้ทดสอบการบันทึก/ส่งแผน ไม่ใช่การแก้ Profile อีกต่อไป

## ขอบเขตความปลอดภัยและข้อจำกัด

- Server bind เฉพาะ `127.0.0.1` และให้บริการเฉพาะ HTML/bundle/logo ที่ allowlist
- Build อยู่ในหน่วยความจำ ไม่เขียนทับ `dist` หรือ `runtime-config.js`
- ไม่โหลด Cognito SDK, ไม่เปิด API routes, ไม่อ่าน `.env` หรือ environment configuration
- CSP `connect-src 'none'` ปิด fetch/XHR/WebSocket ใน Preview และไม่อนุญาต form submit
- ฟอนต์ยังโหลดจาก Google Fonts เหมือน CSS จริง หาก offline จะใช้ fallback font
- ข้อมูลทั้งหมดสมมติ การกด Save/Submit เปลี่ยนแค่ข้อมูลใน memory ของหน้านั้น
- Production entry point/build ไม่อ้างอิง preview และไม่มี flag ข้าม Authentication
- **Preview ผ่าน ไม่ได้ยืนยันว่า Authentication/Authorization/API/AWS ผ่าน**
  ยังต้องทดสอบ Cognito, scope/ownership, CORS, DB constraints และการเชื่อมต่อบน environment จริง
- ไม่ควร Deploy server/entry point นี้เป็นเว็บจริง

## Automated verification

```powershell
npm.cmd run test:ui-preview
npm.cmd run test:frontend
npm.cmd run build
```

Preview tests ตรวจการใช้ components จริง, memory writes, read-only/conflict states,
ไม่มี network calls จาก clients, server allowlist/CSP และแยก bundle ออกจาก auth SDK
Browser visual review ต้องเปิดหน้าเว็บจริงตาม URL ด้านบน ไม่ใช่ผลจาก jsdom

### ผลตรวจ Student Profile refresh (2026-10-21)

- Frontend: 13 suites / 321 tests ผ่าน รวม read-only, GET-only จากหน้า Profile,
  refresh/retry, focus, abort, cross-role denial และ reduced-motion CSS override
- Preview: 41 component tests และ 2 server/production-isolation tests ผ่าน
- Production build และ `git diff --check` ผ่าน
- `npm run test:docs`: 8 ผ่าน / 1 ติด Windows symlink permission (`EPERM`)
  ตัวตรวจลิงก์เอกสารแบบแยกผ่าน ไม่ได้รายงานว่าชุด docs tests ผ่านทั้งหมด
- ยังไม่ได้ตรวจภาพจริงบน Browser, Responsive, Screen reader และ Reduced motion
  ใน Browser เพราะไม่มี Browser เชื่อมต่อ การตรวจ CSS ด้วย jsdom ไม่ใช่ Visual review
- ยังต้องทดสอบ Cognito/API จริงแยกต่างหาก ไม่มีการเปลี่ยน Backend หรือฐานข้อมูลในงานนี้
