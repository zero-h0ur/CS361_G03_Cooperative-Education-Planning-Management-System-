# Local UI Preview (ไม่ใช้ AWS)

ใช้ตรวจ UI ของ Student Profile และ My Plan โดยใช้ shell, components และ CSS จริง
แต่ฉีด clients ที่ใช้ข้อมูลจำลองในหน่วยความจำจาก entry point แยกเท่านั้น
ไม่ต้องมี Learner Lab, ฐานข้อมูล, Cognito configuration, token หรือ AWS credentials

## เปิดใช้งาน

```powershell
npm.cmd ci
npm.cmd run dev:ui
```

- แผนสหกิจ: http://localhost:8081/app.html#/student/plan
- ข้อมูลของฉัน: http://localhost:8081/app.html#/student/profile

ใช้พอร์ต 8081 แยกจากเว็บจริงที่อาจเปิดอยู่บน 8080 ไม่ต้องรัน `npm run build`
เลือกสถานการณ์จำลองจากแถบสีเหลืองด้านบน เปลี่ยน scenario/refresh จะรีเซ็ตข้อมูล
กด Ctrl+C ใน Terminal เพื่อหยุด Server หลังแก้ source ให้หยุดและเปิดคำสั่งใหม่

## สิ่งที่ตรวจได้

- Logo CO-ED, สี, ระยะห่าง และข้อความของสองหน้าจริง
- Responsive ที่ 320 / 768 / 1366px, ไม่มี horizontal overflow
- Tab / Shift+Tab, focus, Enter, labels และการใช้ dropdown ด้วย keyboard
- แก้ชื่อที่ต้องการให้แสดง, สร้าง Draft, ค้นหา Company, เลือก Position และบันทึก
- Submit จำลอง, หน้าสถานะอ่านอย่างเดียว, ประวัติ, validation และ unsaved changes
- กรณีข้อมูลไม่ครบ, ไม่มีแผน, loading, error, expired, forbidden และ stale conflict

Conflict scenario จะคืน conflict เมื่อกดบันทึกหรือส่งแผน ไม่ใช่การจำลอง concurrent database
Loading scenario ค้างไว้ให้ตรวจหน้ารอโหลด เปลี่ยน scenario เมื่อต้องการออก
ลิงก์ไปหน้า Public ไม่อยู่ใน server นี้ ให้เปิดเว็บ Public ตามวิธีปกติแยกต่างหาก

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
