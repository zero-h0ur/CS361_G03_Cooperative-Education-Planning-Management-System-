# Team Dev/Test — V4

งาน [#140](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/140)
ใช้ฐาน V4 จาก PR #149 ทุกคนรับงานตามส่วนของระบบ และทำ UI, API, Database และ Tests ที่งานต้องใช้ได้
ไม่มีการแบ่งสมาชิกเป็น Frontend/Backend หรือบทบาทผู้ใช้ถาวร

## เริ่มจาก main

หลัง Commit งานเดิมแล้ว จึงอัปเดต main และสร้าง Branch ตาม [CONTRIBUTING](../../CONTRIBUTING.md):

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/<issue-number>-<short-description>
npm ci
```

ใช้ Node.js 22 และ Docker ที่มี `docker compose` บน macOS/Windows/Linux มี `.nvmrc` ให้ตรง CI และ Lambda runtime
Node.js 22 ยังอยู่ในรุ่น LTS ตาม [ตารางรุ่น Node.js](https://nodejs.org/en/about/previous-releases)
หาก PowerShell ไม่ให้เรียก `npm.ps1` ให้ใช้ `npm.cmd` แทน คำสั่งที่ต้องมี Docker ให้เปิด Docker Desktop ก่อน
ไม่ต้อง Login AWS สำหรับการพัฒนาในเครื่อง และไม่ต้องคัดลอก `.env` ของเจ้าของโครงการ

## 1. ออกแบบหน้าจอ

```bash
npm run dev:ui
```

เปิด <http://localhost:8081/app.html#/student/plan>
เลือก role/scenario ด้วย Preview controls ดูตัวอย่าง Student, Staff, Advisor, Admin, Coordinator และ Committee
ข้อมูลอยู่ใน memory และ CSP ปิด network ของ Preview การกดบันทึกในหน้านี้ไม่บันทึก PostgreSQL
ดู [คู่มือ Preview](../frontend/local-ui-preview.md) และใช้ local API/Tests ด้านล่างเพื่อตรวจข้อมูลจริงในเครื่อง

## 2. เตรียม PostgreSQL และข้อมูลจำลอง

```bash
npm run dev:db
npm run dev:setup
```

`dev:db` เปิด PostgreSQL 16 เฉพาะ `127.0.0.1:54329` พร้อม named volume `coed-local_local-postgres`
`dev:setup` **ล้างเฉพาะ coed_dev ในชุด local นี้** แล้วลง migrations 001–010, V2/V3 fixtures และ V4 personas
ไม่รับ `DATABASE_URL` จากภายนอกให้เปลี่ยนไป RDS และไม่สร้าง/เปลี่ยนบัญชี Cognito
รหัสใน Compose เป็นรหัสจำลองสำหรับเครื่องนี้เท่านั้น ห้ามนำไปใช้กับฐานข้อมูลที่เผยแพร่

| Database | ใช้ทำอะไร |
| --- | --- |
| `coed_dev` | พัฒนา/ลอง API มี draft และ cohort จำลอง |
| `coed_v3_test` | Full regression และ workflow integration; ข้อมูลสร้างทิ้งได้ |
| `coed_selection_test` | Selection integration แยกจาก development |

ต้องการเริ่มข้อมูล development ใหม่ให้รัน `npm run dev:setup` ซ้ำ ข้อมูลทดสอบถูก Reset ได้โดยไม่มีความหมายเป็นผลการศึกษาจริง
หากพอร์ตชน ให้ตั้ง `CO_ED_LOCAL_DB_PORT` ก่อนใช้ทั้ง Compose และคำสั่ง Node ทุก Terminal ค่าอื่นยังเป็น loopback และชื่อ DB เดิม

## 3. ทดลอง API ในเครื่อง

```bash
npm run dev:api
```

API อยู่ที่ `http://127.0.0.1:3001` และใช้ SQL role `coed_app` ตาม runtime ACL จริง
เปิดอีก Terminal แล้วเลือก persona เพื่ออ่าน local token:

```bash
npm run --silent dev:token -- student01
```

| Persona | บทบาทสำหรับทดสอบ |
| --- | --- |
| `student01` | Student ของแผนจำลอง |
| `staff01` | Staff ในขอบเขต LOCAL-CPE / LOCAL-CS |
| `advisor01` | Advisor; เริ่มโดยยังไม่ได้รับ assignment |
| `admin01` | Admin; ไม่ใช่สิทธิ์อนุมัติแผนแทน Staff |
| `coordinator01` | Coordinator ของ cohort จำลอง |
| `committee01`–`committee03` | กรรมการสามคนที่บันทึกความเห็นแยกกัน |

Token เป็น RS256 ที่เซ็นด้วย key ใหม่ใน memory เมื่อเริ่ม local API อายุหนึ่งชั่วโมงและ refresh ไฟล์ทุก 45 นาที
อ่าน token ใหม่ได้ด้วยคำสั่งเดิม ไฟล์ local session อยู่ใน `tmp/local-dev/` ที่ Git ignore และตั้งสิทธิ์ส่วนตัว
หยุด API ด้วย Ctrl+C จะลบ local session Token นี้ใช้กับ AWS/Cognito จริงไม่ได้ และไม่ใช่การทดสอบ Login จริง

ตัวอย่าง curl (macOS/Linux):

```bash
TOKEN=$(npm run --silent dev:token -- student01)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3001/api/v3/me
```

PowerShell:

```powershell
$token = npm.cmd run --silent dev:token -- student01
Invoke-RestMethod -Headers @{Authorization="Bearer $token"} -Uri http://127.0.0.1:3001/api/v3/me
```

Postman ใช้ Bearer token และ base URL เดียวกัน ห้ามนำ local session ไปแนบ Issue/PR
ไม่ต้องแก้ `src/server.js`, Lambda หรือ production configuration เพื่อข้าม Authentication
`npm start` ยังคง behavior เดิม; ใช้ `dev:api` สำหรับ signed synthetic identities ในเครื่องเท่านั้น

## 4. ตัวอย่าง Flow ที่ตรวจได้

- แผนจำลอง ID: `14000000-0000-4000-8000-000000000400` เริ่มเป็น `DRAFT`, version `1`
- Student ส่ง `POST /api/v3/plans/<plan-id>/submit` พร้อม `{ "expected_version": 1, "operation_id": "<new-UUID>" }`
- Coordinator ส่ง `POST /api/v3/coordinator/plans/<plan-id>/acknowledge` พร้อม version `2` และ operation ID ใหม่
- กรรมการแต่ละคนส่ง `POST /api/v3/committee/plans/<plan-id>/opinion` พร้อม version `2`, operation ID ใหม่, `selected` แบบ boolean และ `comment`
- Student อ่าน `GET /api/v3/plans/<plan-id>/selection` หลังครบสามคนเป็น `SELECTION_COMPLETE_PENDING_ANNOUNCEMENT` ยังไม่ใช่ผลผ่าน/ไม่ผ่าน

ข้อมูลชุดนี้ตั้ง requirements เป็น `[]` **เฉพาะรอบ local จำลอง** เพื่อให้เริ่มตรวจ Flow ได้
ไม่แก้ policy บน AWS หรือกำหนดกติกาเอกสารจริงแทนทีม รันทดสอบอัตโนมัติของ Flow นี้ได้ในหัวข้อถัดไป

## 5. ตรวจงานก่อน PR

```bash
npm run test:local
npm run test:frontend
npm run test:ui-preview
npm run lint
npm run test:docs
```

`test:local` ตั้งค่าฐานทดสอบใน Compose ให้แล้วและเรียก `npm test` ครบ รวม PostgreSQL/selection โดยไม่ล้าง `coed_dev`
อย่าใช้ DB test ร่วมกับข้อมูล development ที่ต้องเก็บ และอย่ารัน full regression หลายชุดพร้อมกันบน test DB เดียวกัน

ทดสอบการเริ่มเครื่องใหม่, local JWT/สิทธิ์, runtime ACL, Flow 3/3 และ Reset หลังมีความเห็นจริงใน DB local:

```bash
# macOS/Linux
CO_ED_LOCAL_DEV_TESTS=1 npm run test:local-dev
```

```powershell
# Windows PowerShell
$env:CO_ED_LOCAL_DEV_TESTS='1'
npm.cmd run test:local-dev
```

คำสั่งนี้ Reset `coed_dev` และไม่แตะ AWS ส่วน CI เปิด flag และตรวจชุดนี้กับ Compose แยกทุกครั้ง
หากไม่เปิด flag จะแสดง integration skipped ไม่ถือว่าตรวจ setup ครบ
Frontend build จริงใช้ `npm run build:v4` ตาม [ฐาน V4](v4-baseline.md); ไม่รวม fixtures/keys/local auth นี้ใน artifact

## 6. หยุดงานและแก้ปัญหา

```bash
npm run dev:db:stop
```

หยุด Container โดยเก็บข้อมูลไว้ เปิดต่อด้วย `npm run dev:db`
หากต้องการลบข้อมูล local ทั้งหมดจริง ๆ ใช้ `docker compose -f compose.dev.yml down -v` แล้วเริ่มใหม่
กรณี upgrade ชุด init จาก checkout เก่า ให้ตรวจชื่อ DB และ role ก่อนล้าง volume ไม่ใช้คำสั่งนี้กับ Cloud

- Docker ไม่ทำงาน: เปิด Docker Desktop แล้วลอง `dev:db` ใหม่
- Port ชน: ตรวจ 54329, 3001 และ 8081 หรือกำหนด local DB/API port ที่ทุก Terminal ใช้ตรงกัน
- Local token เก่าหลัง API restart: อ่านด้วย `dev:token` ใหม่ ไม่แก้ role header หรือปิด guard
- `Wrong database` จาก operator tests: ใช้ชื่อ `coed_v3_test` ตามที่คู่มือตั้ง ไม่ลด guard ของสคริปต์
- ต้องแก้ schema/API contract ร่วมกัน: เปิด Follow-up Issue และอ้างงานที่เกี่ยวข้อง ทุกคนรับงานได้ครบทั้ง UI/API/DB/Tests

## 7. ทดสอบบนเว็บร่วมกันและสิทธิ์ AWS

เว็บ: <https://main.d1bpmj87vmjb96.amplifyapp.com/app.html>
ใช้บัญชีทดสอบรายคนที่ได้รับจัดให้ ไม่ใช้รหัสผ่านเจ้าของ และไม่ใช้ local token ข้างต้นกับเว็บจริง
สิทธิ์ Repo/AWS และบทบาทผู้ใช้ในแอปเป็นคนละอย่าง ดู [แผนสิทธิ์ทีม](team-access.md)
ต้องให้เพื่อนลองตามคู่มือนี้จากเครื่องของตนและยืนยันการ Login จริงก่อนปิด #140

ผลตรวจ setup และสถานะสิทธิ์อยู่ใน [หลักฐาน Dev/Test](../evidence/v4-team-dev-test.md)
