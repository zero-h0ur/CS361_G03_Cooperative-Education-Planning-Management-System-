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

`amplify.yml` เปิด Strict build ด้วย `CO_ED_REQUIRE_AUTH_CONFIG=1` ถ้าค่าที่จำเป็น
ไม่ครบ Build ต้องล้มเหลวแทนการ Deploy หน้า Login ที่ตั้งค่าผิด

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
| ไม่มี Session หรือ API ตอบ `401` | “Session หมดอายุ”; Redirect ไป Login เมื่อผู้ใช้กดปุ่มเท่านั้น |
| API ตอบ `403` | “ไม่มีสิทธิ์เข้าถึง”; ไม่ Redirect ไป Login |
| API/Network ไม่พร้อม หรือ Response ผิดรูปแบบ | Safe unavailable state พร้อม Retry |
| Role/Route ไม่อยู่ใน Allowlist | Access denied โดยไม่แสดง Protected content |
| Auth configuration ไม่ครบ | Configuration required พร้อม Link กลับ Public Directory |

ก่อนเปิด PR ให้ตรวจ `npm run build`, `npm run test:frontend`, Browser console,
Keyboard navigation และหน้าจอ Mobile/Tablet/Desktop พร้อมยืนยันว่า Public Company
Directory ยังเปิดแบบ Anonymous ได้
