# V3 Authenticated Frontend Shell

เอกสารนี้อธิบายวิธี Build, ทดสอบ และ Deploy frontend shell ของ Issue #57 โดยอิง
Accepted Decisions #48, #49 และ shared response/error contract จาก #55

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

| Role | Route | สถานะใน Issue #57 |
| --- | --- | --- |
| `STUDENT` | `#/student/profile` | Shell/Placeholder สำหรับ #65 |
| `STUDENT` | `#/student/plan` | Shell/Placeholder สำหรับ #66 |
| `STAFF` | `#/staff/review` | Shell/Placeholder สำหรับ #67 |
| `ADVISOR` | `#/advisor/students` | Shell/Placeholder สำหรับ #68 |

Role หรือ Route อื่นถูกปฏิเสธโดยค่าเริ่มต้น หน้าเหล่านี้ยังไม่เรียก Student,
Plan, review หรือ assignment data จริง

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
แทนการ Deploy หน้า Login ที่ตั้งค่าผิด **ตอนนี้ปิดไว้ชั่วคราวใน `amplify.yml`** จนกว่า
รายการในหัวข้อ "สิ่งที่ต้องทำใน AWS Console" จะเสร็จ ระหว่างนี้ `app.html` แสดงสถานะ
Configuration required แบบ Fail-closed ส่วนหน้า Public ยัง Deploy ได้ตามปกติ

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

## สิ่งที่ต้องทำใน AWS Console (ค้างอยู่หลัง Merge)

PR นี้ Merge ก่อนที่รายการด้านล่างจะเสร็จ โดยปิด Strict build ไว้ชั่วคราว รายการนี้แก้ด้วยโค้ดใน
Repository ไม่ได้ ต้องให้ผู้ดูแล AWS ทำให้เสร็จ ระหว่างนี้ Login บน Production ยังใช้งานไม่ได้

สถานะ:

- [ ] 1. อัปเดต Callback และ Sign-out URL ของ Cognito App Client
- [ ] 2. ตั้ง Environment variables ใน Amplify Hosting
- [ ] 3. เปิด Strict build กลับใน `amplify.yml`
- [ ] 4. Smoke test หลัง Deploy

### 1. อัปเดต Callback และ Sign-out URL ของ Cognito App Client

ตอนนี้ Cognito App Client ที่ตั้งไว้ใน #58 Allowlist เฉพาะ
`https://main.d1d9qrqnsi5nl6.amplifyapp.com/` ทั้ง Callback และ Sign-out แต่ Shell นี้
Redirect ไปที่ `/app.html` และ `/index.html` เมื่อ URL ไม่ตรงแบบ Exact match ตาม #48
Cognito จะตอบ `redirect_mismatch` ทำให้ Login บน Production ใช้งานไม่ได้

ให้แก้ใน Cognito > User pool > App client > Login pages ดังนี้:

- Allowed callback URLs: `https://main.d1d9qrqnsi5nl6.amplifyapp.com/app.html`
- Allowed sign-out URLs: `https://main.d1d9qrqnsi5nl6.amplifyapp.com/index.html`
- ยังคงเป็น Exact URL ห้ามใช้ Wildcard และห้ามเพิ่ม Origin อื่น
- อัปเดตบันทึกค่า `AUTH_CALLBACK_URL` และ `AUTH_LOGOUT_URL` ใน #58 ให้ตรงกัน

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

แล้วลบ Comment `TEMPORARY` ออก ตรวจว่า Build บน Amplify ผ่านด้วย Env จริงก่อนปิด Checklist นี้

### 4. Smoke test หลัง Deploy

หลังจากข้อ 1–3 เสร็จ และ Deploy แล้ว ให้ทดสอบตาม Smoke procedure ของ #58 โดยใช้บัญชีทดสอบ
ที่ Link กับ Internal user ใน RDS แล้ว:

1. เปิด `index.html` แล้วกด “เข้าสู่ระบบ” ต้องเห็นหน้า “กรุณาเข้าสู่ระบบ”
2. กดเข้าสู่ระบบ ต้องไปที่ Cognito Managed Login และกลับมาที่ `/app.html` โดยไม่มี `redirect_mismatch`
3. หลัง Login ต้องเห็นเมนูตาม Role ที่ `/api/v3/me` คืนมา
4. กดออกจากระบบ ต้องกลับไปที่ `index.html` และเปิด `app.html` อีกครั้งต้องขอให้ Login ใหม่
5. เปิด Company Directory โดยไม่ Login ต้องใช้งานได้ตามปกติ
6. แนบ Screenshot ของ Desktop, Mobile และ Failure states ใน PR
