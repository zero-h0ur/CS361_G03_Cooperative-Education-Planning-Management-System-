# CO-ED — ระบบข้อมูลและวางแผนสหกิจศึกษา

V3 พัฒนาต่อจากหน้าให้ข้อมูลและค้นหาสถานประกอบการของ V1/V2 โดยเพิ่มการเข้าสู่ระบบ แผนสหกิจของนักศึกษา การตรวจแผนของเจ้าหน้าที่ และการดูข้อมูลของอาจารย์ที่ปรึกษา

- [เว็บไซต์](https://main.d1d9qrqnsi5nl6.amplifyapp.com/)
- [ค้นหาสถานประกอบการ](https://main.d1d9qrqnsi5nl6.amplifyapp.com/company-directory.html) — ไม่ต้องเข้าสู่ระบบ
- [พื้นที่ Student / Staff / Advisor](https://main.d1d9qrqnsi5nl6.amplifyapp.com/app.html) — ต้องเข้าสู่ระบบ

ระบบนี้ใช้ข้อมูลจำลองสำหรับการเรียนและสาธิต ยังไม่รองรับการนำข้อมูลนักศึกษาจริงมาใช้งาน ผลตรวจรับ V3 วันที่ 20 ต.ค. 2569 อยู่ใน [Issue #84](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/84#issuecomment-6293912895)

## สิ่งที่ทำได้ใน V3

| ผู้ใช้ | การใช้งาน |
| --- | --- |
| Public | อ่านข้อมูล ค้นหาบริษัทและตำแหน่ง กรองสถานที่ และโหลดหน้าถัดไป ไม่มีสิทธิ์เข้าถึงข้อมูลนักศึกษาหรือแผน |
| Student | ดูข้อมูลของตน แก้ชื่อที่ใช้แสดง สร้างและแก้ร่างแผน ส่งแผน และดูสถานะกับประวัติ ข้อมูลทะเบียนไม่สามารถแก้จากหน้านี้ได้ |
| Staff | ค้นหานักศึกษาและแผนในขอบเขตภาควิชา/หลักสูตร/ปีการศึกษาที่รับผิดชอบ เริ่มตรวจ ส่งกลับแก้ไขพร้อมเหตุผล และอนุมัติ |
| Advisor | อ่านข้อมูลนักศึกษาและแผนเฉพาะรายที่ได้รับมอบหมาย ไม่มีสิทธิ์แก้ไข ส่งแผน หรือตรวจอนุมัติ ทั้งหน้าเว็บและ API |

บัญชีต้องเชื่อมกับผู้ใช้และสิทธิ์ในฐานข้อมูล ไม่ได้ใช้เพียง role จากหน้าเว็บหรือ token และยังไม่มีหน้าจัดการบัญชีสำหรับ Admin

## ขั้นตอนการใช้แผน

นักศึกษาเข้าสู่ระบบ ตรวจข้อมูลของตน เลือกรอบสมัคร บริษัทและตำแหน่ง แล้วบันทึกหรือส่งแผน เจ้าหน้าที่ในขอบเขตที่รับผิดชอบจึงเปิดตรวจได้ หากส่งกลับ นักศึกษาจะแก้ไขและส่งใหม่ ส่วนอาจารย์ที่ปรึกษาเปิดอ่านได้เท่านั้น

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED
            ↑            |
            └── NEEDS_REVISION
```

Backend ตรวจสิทธิ์ สถานะ และเวอร์ชันก่อนเปลี่ยนข้อมูล พร้อมบันทึกประวัติใน transaction เดียวกัน เจ้าหน้าที่ไม่แก้เนื้อหาแผนแทนนักศึกษา ส่วน `CANCELLED` มีใน service contract แต่ยังไม่มีปุ่มหรือ HTTP endpoint สำหรับยกเลิกแผน

## โครงสร้างระบบ

Frontend อยู่บน Amplify Hosting และเข้าสู่ระบบผ่าน Cognito แบบ Authorization Code + PKCE ส่วน API ใช้ API Gateway, Lambda และ RDS PostgreSQL ที่ไม่เปิด public access เส้นทางข้อมูลนักศึกษาและแผนต้องผ่าน JWT authorizer และการตรวจ role/ownership/scope ใน backend อีกชั้นหนึ่ง

Lambda อ่านรหัสผ่านฐานข้อมูลจาก Secrets Manager เชื่อม RDS ผ่าน TLS และใช้บัญชี runtime ที่จำกัดสิทธิ์ Browser ไม่เชื่อมฐานข้อมูลโดยตรง ส่วน Company Directory ยังคงเป็น public read-only และมี static fallback เมื่อ API ใช้งานไม่ได้

- [Architecture และเหตุผลการออกแบบ](docs/architecture/G03-V3-architecture.md)
- [API contract](docs/api/v3-shared-contract.md)
- [คู่มือพัฒนา ดูแลระบบ และงานต่อ V4](docs/operations/v3-operating-guide.md)
- [สรุปงาน Issue / PR และผลทดสอบ](docs/evidence/v3-delivery-index.md)

## เริ่มพัฒนา

ใช้ Node.js 20+ และ npm:

```bash
npm ci
npm run dev:ui
```

เปิด [Local UI](http://localhost:8081/app.html#/student/plan) เพื่อดูหน้าจอด้วยข้อมูลจำลองใน memory ไม่ต้องใช้ AWS หรือฐานข้อมูล Preview นี้ไม่ทดสอบสิทธิ์จริง ดูรายละเอียดใน [Local UI Preview](docs/frontend/local-ui-preview.md)

หากต้องใช้ API หรือ PostgreSQL ให้ตั้งฐานข้อมูล development และ test คนละตัวตาม [คู่มือพัฒนา](docs/operations/v3-operating-guide.md) ห้ามใช้ RDS เป็นฐานข้อมูลทดสอบ

```bash
NODE_ENV=test ALLOW_DB_RESET=true npm test
npm run test:frontend
npm run test:ui-preview
npm run test:docs
```

`npm start` เปิด local API แต่ไม่ได้จำลอง trusted claims ของ API Gateway ส่วน frontend ที่ build แล้วอยู่ใน `dist/` การ build ต้องรับค่า `CO_ED_*` ที่เป็น public configuration เท่านั้น ไม่ส่งรหัสผ่านหรือ AWS credentials ไปยัง Browser

## สิ่งที่ต้องทำต่อ

V3 ยังไม่มีระบบแจ้งเตือน อัปโหลดไฟล์ จัดการสถานประกอบการผ่าน Admin จัดการปฏิทิน/ติดตามการฝึกงานเต็มรูปแบบ หรือเชื่อมระบบภายนอก งานด้าน session, logging และ deployment ที่ควรปรับก่อนขยายการใช้งานอยู่ท้าย [คู่มือส่งต่อ](docs/operations/v3-operating-guide.md#งานต่อ-v4)

## การส่งงานและรุ่น

ตั้งชื่อ Branch ตามประเภทงาน ได้แก่ `feature/`, `fix/`, `docs/` และ `chore/` ตาม [CONTRIBUTING](CONTRIBUTING.md) จากนั้นเปิด PR เข้า `main` และใส่ `Closes #<issue-number>` เมื่องานครบตาม Issue

| รุ่น | เนื้อหา |
| --- | --- |
| [V1](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/tree/v1.0.0) | เว็บไซต์ข้อมูลแบบ static |
| [V2](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/tree/v2.0.0) | Company Directory ที่ดึงข้อมูลผ่าน API และ RDS |
| V3 | Student/Staff workflow และ Advisor read-only; งาน release tag ติดตามใน [#86](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/86) |

เอกสาร V2: [Backend setup](docs/v2-backend-setup.md), [ชุดข้อมูล](docs/data/v2-mock-data.md), [Decisions](docs/decisions/issue-30-decisions.md), [ผลตรวจ](docs/issue-32-manual-verification.md)

## สมาชิก

- นายปพนพัชร์ มีวน 6709650458
- นายภูริณัฐ วรรธนะธัญญา 6709650565
- นายรณกฤต วรลักษณ์ภักดี 6709650607
- นายณัษฐภาคย์ ไกรวิชญ์ชนาพร 6709650334
