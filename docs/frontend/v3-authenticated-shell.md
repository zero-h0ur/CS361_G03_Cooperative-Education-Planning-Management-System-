# V3 Authenticated Frontend Shell

เอกสารนี้อธิบายวิธี Build, ทดสอบ และ Deploy frontend shell ของ Issue #57 โดยอิง
Accepted Decisions #48, #49 และ shared response/error contract จาก #55

การแก้ Navbar Role, shared Student/Staff theme และ scoped Cognito logout ล่าสุด
อธิบายใน [workspace-role-logout.md](workspace-role-logout.md) รวมขั้นตอนทดสอบจริงก่อน Merge

## Scope และ security boundary

- หน้า Public เดิม (`index.html`, `requirements.html`, `company-directory.html`,
  `faq.html`) เปิดอ่านได้โดยไม่ต้อง Login และไม่โหลด authenticated bundle
- พื้นที่ Protected ใช้ `app.html` และ Hash routes เท่านั้น
- Frontend ใช้ Cognito Managed Login ผ่าน Authorization Code + PKCE และส่ง
  Access Token ไปยัง `GET /api/v3/me`
- Role ที่ใช้สร้างเมนูต้องมาจาก Response `{ "data": { "role": "..." } }`
  ของ Backend เท่านั้น ไม่อ่าน Role จาก URL, Token claims, DOM หรือ Browser storage
- Route guard และการซ่อนเมนูเป็นเพียง UX; Backend ต้องตรวจ authentication,
  ownership, assignment และ scope ในทุก Protected request
- ไม่มี Mock role หรือ Backend `/api/v3/me` ใน Production code ของ Issue #57
  Endpoint ดังกล่าวเป็นความรับผิดชอบของ Issue #64

## Routes

### Shared TU theme

พื้นที่หลัง Login ใช้ Theme แดง TU/ทอง พื้นครีม และโลโก้เดียวกับหน้า Public
ผ่าน `src/frontend/authenticated-shell.css` โดยไม่โหลด `style.css` ทั้งก้อนเพื่อหลีกเลี่ยง
Global selector conflicts กับ Form/Table/Nav ของ Protected workspace
Sidebar และการตรวจ Role/Route คงเดิม หัวข้อและระยะห่างกระชับขึ้นเพื่อเข้าถึงเนื้อหาเร็วขึ้น
มี Skip link ที่ย้าย Focus ไป Main โดยไม่เปลี่ยน Hash route และปรับกริดฟอร์มให้รองรับจอเล็ก

Protected brand ใช้ชื่อ **CO-ED** และไฟล์ `resources/images/logomini.png` ตามคำขอล่าสุด
หน้า ข้อมูลของฉัน และ แผนสหกิจ ใช้ไอคอน SVG แบบ Code-native ที่ซ่อนจาก Screen reader
พร้อม Section headings/Labels จริง หน้า Profile แยก Official read-only fields กับ Preferred name
หน้า Plan แยก Status, Readiness, Submit และ History ที่แสดงเวลาภาษาไทยใน Asia/Bangkok
Banner สีเขียวหมายถึงข้อมูลเบื้องต้นครบเท่านั้น Server ยังตรวจ Cycle/References เมื่อ Submit
State ที่ล็อกยังปิด Submit และไม่แสดงว่าพร้อมส่ง ไม่เพิ่ม API, Mock data หรือ Role bypass ในงาน Theme

เมื่อตรวจ Visual review ให้ครอบคลุม Student/Staff/Advisor และหน้า Login, Loading,
Expired, Forbidden, Configuration error ที่ขนาด 320px, 768px และ Desktop
ตรวจ Focus/Keyboard, ข้อความและปุ่มยาว, Semantic status colors และ Disabled states
Automated tests ตรวจ Palette parity, Brand และ Skip-link routing แต่ไม่ทดแทน Browser review

การปรับ Theme ถูกนำมารวมกับ `main` ล่าสุดก่อนสร้าง Branch
`feature/student-profile-plan-ui` (Base `8805f1d`) โดยรักษา Plan editor (#73),
การล็อก Submit/Picker ขณะมี Unsaved changes และ Staff review workspace (#77)
Plan editor ใช้ Card/ไอคอนรูปแบบเดียวกับ Student workspace แต่ Payload, Version,
Idempotency และ Read-only rules ไม่เปลี่ยน

ผลตรวจวันที่ 2026-10-20:

- `npm ci` ติดตั้งตาม Lockfile ของ `main` โดยไม่แก้ Dependency versions
- `npm run test:frontend`: 10 suites / 262 tests ผ่าน รวม Editor และ Staff review regression
- `npm run build` และ `git diff --check` ผ่าน
- ยังรอ Browser visual/keyboard review ที่ 320px, 768px และ Desktop; ไม่มี Browser ที่เชื่อมต่อใน Session ที่ปรับโค้ด จึงไม่ถือว่า Automated tests แทนการตรวจนี้แล้ว

Issue #74 เพิ่มเมนู Staff ที่ `#/staff/students` และ `#/staff/plans` โดยใช้
Scoped read API ของ #67 แล้ว และส่งต่อผ่าน `#/staff/plans/:planId` ไปยัง
Review workspace ของ #77 ที่ merge แล้ว ดู Contract, URL-state privacy และวิธีทดสอบใน
[Staff Student/Plan search](v3-staff-student-management.md)

| Role | Route | สถานะปัจจุบัน |
| --- | --- | --- |
| `STUDENT` | `#/student/profile` | Dashboard และข้อมูลของฉัน (#72) |
| `STUDENT` | `#/student/plan` | Editor (#73), สถานะ/ส่งแผน/ประวัติ (#76) |
| `STAFF` | `#/staff/review` | คิวตรวจแผน (#77) |
| `STAFF` | `#/staff/plans/:planId` | รายละเอียด ประวัติ และคำสั่งตรวจแผน (#77) ไม่อยู่ในเมนู |
| `ADVISOR` | `#/advisor/students` | รายชื่อนักศึกษาที่ได้รับมอบหมาย (#75) |
| `ADVISOR` | `#/advisor/students/:studentId` | ข้อมูลนักศึกษาและรายการแผน (#75) ไม่อยู่ในเมนู |
| `ADVISOR` | `#/advisor/plans/:planId` | รายละเอียดแผนแบบอ่านอย่างเดียว (#75) ไม่อยู่ในเมนู |

Role หรือ Route อื่นถูกปฏิเสธโดยค่าเริ่มต้น Route ที่มี `:studentId` / `:planId`
ต้องเป็น UUID เท่านั้น ถ้ารูปแบบผิดจะถือว่าไม่อยู่ใน Allowlist และไม่เรียก API

### Staff review workspace (#77)

- คิวใช้ `GET /api/v3/staff/review-queue` (contract หัวข้อ 3.6) กรองด้วยสถานะและคำค้นได้ ส่วนหน้าแผนใช้ `GET /api/v3/staff/plans/:planId` และ `/history` (หัวข้อ 3.12)
- ปุ่ม Start review / Approve / Return แสดงเมื่อเงื่อนไขครบทั้งสามข้อ: `capabilities.canReviewPlan` ของ Session, สถานะของแผน (`SUBMITTED` → Start review, `UNDER_REVIEW` → Approve / Return) และรอบเป็น `OPEN` ส่วน Backend ตรวจซ้ำทุกคำสั่ง (หัวข้อ 3.8)
- ทุกคำสั่งต้องยืนยันใน Panel ก่อน Focus จะย้ายเข้า Panel และกลับมาที่ปุ่มเดิมเมื่อกดยกเลิกหรือ Escape การ Return บังคับให้ใส่เหตุผล (ไม่เกิน 2,000 ตัวอักษร) ส่วนความเห็นตอน Approve ไม่บังคับ
- ไม่ทำ Optimistic update หลังสำเร็จจะโหลด State และ History ใหม่จาก Server ถ้าเจอ `409` / `422` / `403` จะแจ้งว่าคำสั่งยังไม่ถูกบันทึก และมีปุ่มโหลดข้อมูลล่าสุด
- ถ้า Network ล้มเหลว Panel และความเห็นที่พิมพ์ไว้ยังอยู่ กดยืนยันอีกครั้งจะใช้ `operation_id` เดิม แต่ถ้าแก้ความเห็นจะใช้ `operation_id` ใหม่
- Advisor view ไม่ Import Module นี้ และ Route ของ Staff ปฏิเสธ Role อื่นตั้งแต่ Shell

### Advisor pages (#75)

- ใช้เฉพาะ `GET /api/v3/advisor/*` (#68, contract หัวข้อ 3.11) Client ไม่มี Method
  ที่ส่ง Mutation และ Backend ปฏิเสธ Mutation ของ Advisor อยู่แล้ว (`405` / `403`)
- ไม่ Render Form, Input หรือปุ่ม Start review / Return / Approve / แก้ไข ทุกหน้ามี
  Badge และข้อความแจ้งว่าเป็น Read-only
- `403` และ `404` ของ Resource รายตัวแสดงข้อความเดียวกันว่า "ไม่พบหรือไม่อยู่ในขอบเขต"
  เพื่อไม่เปิดเผยว่า Record มีอยู่จริงหรือไม่ ส่วน `403` ของรายการ (ไม่มี id) ส่งให้ Shell
  แสดงหน้า Access denied
- รองรับ Loading, No assignment, ไม่มีแผน, Session หมดอายุ และ Service unavailable
  (มีปุ่มลองใหม่) ตารางอยู่ใน Region ที่ Focus ได้เพื่อเลื่อนด้วยคีย์บอร์ดบนจอเล็ก
- ไม่แสดงประวัติ/Review comment ของแผน เพราะ Advisor read API (#68) ไม่เปิดข้อมูลนี้

## Public build configuration

กำหนด Environment variables ต่อไปนี้ใน Amplify Hosting ก่อน Deploy:

| Variable | ตัวอย่าง/ความหมาย |
| --- | --- |
| `CO_ED_API_BASE_URL` | Base URL ของ API Gateway โดยไม่ลงท้ายด้วย `/api/v3/me` |
| `CO_ED_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `CO_ED_COGNITO_CLIENT_ID` | Public App Client ID ที่ไม่มี Client secret |
| `CO_ED_COGNITO_DOMAIN` | Cognito domain แบบ Host name ไม่มี `https://` และไม่มี Path |
| `CO_ED_APP_ORIGIN` | Amplify origin แบบ HTTPS เช่น `https://main.example.amplifyapp.com` |

ค่าเหล่านี้เป็น Public client configuration ไม่ใช่ Secret ห้ามเพิ่ม Client secret,
Access Token, Refresh Token หรือ Credential ใด ๆ ใน Environment ที่ถูกเขียนลง
frontend artifact

Strict build (`CO_ED_REQUIRE_AUTH_CONFIG=1`) ทำให้ Build ล้มเหลวเมื่อค่าที่จำเป็นไม่ครบ
แทนการ Deploy หน้า Login ที่ตั้งค่าผิด เปิดใช้งานใน `amplify.yml` สำหรับการ Deploy
หลัง rollout #82 โดย main และแต่ละ authenticated preview ต้องมี Public client
configuration ของ Origin ตัวเองก่อน Build ห้ามใช้ Client secret หรือ Database
credentials ใน Frontend environment การรัน Build เองโดยไม่เปิด Strict mode
ยังแสดง Configuration required แบบ Fail-closed เมื่อค่า Login ไม่ครบ

Cognito App Client ต้อง Allowlist URL ต่อไปนี้ให้ตรงกับ `CO_ED_APP_ORIGIN`:

- Callback: `<CO_ED_APP_ORIGIN>/app.html`
- Sign-out: `<CO_ED_APP_ORIGIN>/index.html`
- OAuth flow: Authorization code grant
- Scopes ขั้นต่ำ: `openid`, `email`, `coed-api/access`

## Build และ Automated tests

ติดตั้ง Dependency จาก Lockfile และสร้าง Deployable artifact:

```bash
npm ci
npm run build
```

ผลลัพธ์อยู่ใน `dist/` และไม่ Commit เข้า Repository หน้า Public ถูก Copy ตามเดิม
ส่วน `src/frontend/app.js` ถูก Bundle เป็น
`dist/assets/authenticated-shell.js`

รัน Frontend regression และ Route/Session tests:

```bash
npm run test:frontend
```

Tests ใช้ Mock response ผ่าน Dependency injection เฉพาะใน Test process ไม่มี Mock
role ถูก Bundle เข้า Production

## Local verification

`npm run build` โดยไม่กำหนด Cognito variables ใช้ตรวจ Build ได้ แต่ `app.html`
จะแสดงสถานะ Configuration required อย่างปลอดภัย ส่วน Company Directory ยังเปิดได้
ตามปกติ

การทดสอบ Session จริงต้องมีทั้งหมดต่อไปนี้:

1. Cognito Public App Client และ Domain ตาม #48
2. Callback/Sign-out URL ตรงกับ Origin ที่เปิดหน้าเว็บ
3. API Gateway/Lambda รองรับ Access Token และ scope `coed-api/access`
4. Issue #64 Deploy `GET /api/v3/me` แล้ว
5. Identity ของผู้ทดสอบ Link กับ Active internal user ใน RDS

หาก #64 ยังไม่พร้อม `/api/v3/me` จะได้ Error/Unavailable ตาม Fail-closed design
ไม่ควรเพิ่ม Static role หรือข้ามการตรวจ Session เพื่อทำให้หน้า Placeholder เปิดได้

## Expected failure behavior

| กรณี | ผลที่หน้าเว็บต้องแสดง |
| --- | --- |
| ยังไม่เคย Login ใน Tab นี้ (ไม่มี Token ใน `sessionStorage`) | “กรุณาเข้าสู่ระบบ”; Redirect ไป Login เมื่อผู้ใช้กดปุ่มเท่านั้น |
| Refresh Session ไม่สำเร็จ หรือ API ตอบ `401` | “Session หมดอายุ”; Redirect ไป Login เมื่อผู้ใช้กดปุ่มเท่านั้น |
| API ตอบ `403` หรือ Role เป็น `ADMIN` | “ไม่มีสิทธิ์เข้าถึง” พร้อมปุ่มออกจากระบบเพื่อเปลี่ยนบัญชี; ไม่ Redirect ไป Login |
| API/Network ไม่พร้อม หรือ Response ผิดรูปแบบ | Safe unavailable state พร้อม Retry และปุ่มออกจากระบบ |
| Role/Route ไม่อยู่ใน Allowlist | Access denied โดยไม่แสดง Protected content |
| Auth configuration ไม่ครบ | Configuration required พร้อม Link กลับ Public Directory |

ก่อนเปิด PR ให้ตรวจ `npm run build`, `npm run test:frontend`, Browser console,
Keyboard navigation และหน้าจอ Mobile/Tablet/Desktop พร้อมยืนยันว่า Public Company
Directory ยังเปิดแบบ Anonymous ได้

## AWS configuration และผล main rollout (#82)

PR #94 เคย Merge โดยปิด Strict build ใน `amplify.yml` ชั่วคราวเพื่อรอ AWS configuration
ใน rollout #82 ผู้ดูแลตั้งค่า Cognito และ main environment แล้ว และ Main Job 51 ผ่านครบ
BUILD/DEPLOY/VERIFY ผู้ดูแลยืนยัน Login/Logout ทั้ง Student และ Staff บน main แล้ว
รายละเอียด source/hash, screenshots, DB verification และ rollback อยู่ใน
[main rollout evidence](../operations/v3-main-rollout.md)

สถานะหลักฐาน Job 51 (ไม่ใช่การรับรอง UI ที่เปลี่ยนภายหลังโดยอัตโนมัติ):

- [x] 1. เพิ่ม exact main Callback และ Sign-out URL โดยรักษา URL เดิม/preview
- [x] 2. ตั้ง public environment variables ของ main รวม `CO_ED_REQUIRE_AUTH_CONFIG=1`
- [ ] 3. นำ Strict build guard ใน `amplify.yml` ของ branch #82 ผ่าน PR checks/review และ Merge
- [x] 4. Job 51 + public/API/CORS smoke + main Student/Staff Login/Logout

ขั้นตอนต่อไปนี้เก็บไว้เป็นแนวทางตรวจ configuration ไม่ใช่คำสั่งให้ deploy ซ้ำหรือแก้ค่า AWS
ที่ผ่านแล้ว การเปลี่ยน UI หลัง Job 51 ต้องผูกผลตรวจเข้ากับ artifact ของการเปลี่ยนนั้นแยกกัน

### 1. อัปเดต Callback และ Sign-out URL ของ Cognito App Client

ค่าเดิมใน #58 เคยใช้ main root `/` แต่ Shell Redirect ไป `/app.html` และ `/index.html`
ใน rollout #82 เพิ่ม exact URLs ด้านล่างแล้ว พร้อมรักษา main root และ preview URLs เดิม
หากตั้ง environment ใหม่ ให้ตรวจ URL ตาม #48 ไม่เช่นนั้น Cognito จะตอบ `redirect_mismatch`

ค่าที่ต้องมีใน Cognito > User pool > App client > Login pages:

- Allowed callback URLs: `https://main.d1d9qrqnsi5nl6.amplifyapp.com/app.html`
- Allowed sign-out URLs: `https://main.d1d9qrqnsi5nl6.amplifyapp.com/index.html`
- ยังคงเป็น Exact URL ห้ามใช้ Wildcard และห้ามลบ preview/URL อื่นที่ได้รับอนุญาตเดิม
- ค่า Callback/Logout ปัจจุบันถูกบันทึกใน main rollout evidence ที่ลิงก์ไว้ข้างต้น

### 2. ตั้ง Environment variables ใน Amplify Hosting

ถ้าไม่ตั้งค่าเหล่านี้ `app.html` จะใช้ Login ไม่ได้ (Configuration required) ต้องตั้งให้ครบ
**ก่อน** เปิด Strict build กลับในข้อ 3 ไม่อย่างนั้น Build ของ `main` จะล้มเหลวทุกครั้ง
รวมถึงการแก้หน้า Public ด้วย

ให้ตั้งค่าใน Amplify > App settings > Environment variables ของ Branch `main`:

| Variable | ค่า |
| --- | --- |
| `CO_ED_API_BASE_URL` | `https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com` |
| `CO_ED_COGNITO_USER_POOL_ID` | User Pool ID จาก #58 |
| `CO_ED_COGNITO_CLIENT_ID` | SPA App Client ID จาก #58 (ค่าเดียวกับ `AUTH_AUDIENCE`) |
| `CO_ED_COGNITO_DOMAIN` | Cognito domain แบบ Host name |
| `CO_ED_APP_ORIGIN` | `https://main.d1d9qrqnsi5nl6.amplifyapp.com` |

ข้อควรรู้เพิ่มเติม:

- `amplify.yml` ใน Repository จะ Override Build settings ที่ตั้งไว้ใน Amplify Console
- Artifact ที่ Deploy เปลี่ยนจาก Root ของ Repository เป็น `dist/`
- ห้ามตั้ง `NODE_ENV=production` ที่ระดับ Environment variables เพราะจะทำให้ `npm ci`
  ไม่ติดตั้ง `esbuild` และ `aws-amplify` ซึ่งเป็น `devDependencies` ใน `amplify.yml`
  กำหนด `NODE_ENV` เฉพาะขั้น Build ไว้แล้ว

### 3. เปิด Strict build กลับ

หลังข้อ 1 และ 2 เสร็จ ให้แก้บรรทัด Build ใน `amplify.yml` กลับเป็น

```yaml
        - NODE_ENV=production CO_ED_REQUIRE_AUTH_CONFIG=1 npm run build
```

branch #82 เปลี่ยนบรรทัดนี้และลบ Comment `TEMPORARY` แล้ว แต่ยังต้องผ่าน PR checks/review
และ Merge ก่อนถือว่า Guard ใน Source บน main เสร็จ ระดับ main environment ตั้ง
`CO_ED_REQUIRE_AUTH_CONFIG=1` แล้วตั้งแต่ Job 51 ไม่ต้องเริ่ม manual deploy ซ้ำ
เมื่อ Merge และ auto-build ให้ตรวจผลของ Job ใหม่โดยอ้างอิง source/artifact จริง

### 4. Smoke test หลัง Deploy

Job 51 ผ่าน public/config smoke และผู้ดูแลยืนยัน Student/Staff Login/Logout แล้ว
สำหรับ deployment ที่มีการเปลี่ยนแปลงภายหลัง ให้ทดสอบตาม procedure นี้ด้วยบัญชีทดสอบ
ที่ Link กับ Internal user ใน RDS โดยไม่อ้างผล Job 51 แทน artifact ใหม่:

1. เปิด `index.html` แล้วกด “เข้าสู่ระบบ” ต้องเห็นหน้า “กรุณาเข้าสู่ระบบ”
2. กดเข้าสู่ระบบ ต้องไปที่ Cognito Managed Login และกลับมาที่ `/app.html` โดยไม่มี `redirect_mismatch`
3. หลัง Login ต้องเห็นเมนูตาม Role ที่ `/api/v3/me` คืนมา
4. กดออกจากระบบ ต้องกลับไปที่ `index.html` และเปิด `app.html` อีกครั้งต้องขอให้ Login ใหม่
5. เปิด Company Directory โดยไม่ Login ต้องใช้งานได้ตามปกติ
6. แนบ Screenshot ของ Desktop, Mobile และ Failure states ใน PR
