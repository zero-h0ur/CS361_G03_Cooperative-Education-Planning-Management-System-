# V3 Modular API and Shared Response/Error Contract

เอกสารข้อกำหนดมาตรฐานการสื่อสาร (Response/Error Contract) และสถาปัตยกรรม Modular API สำหรับ CO-ED Version 3 เพื่อใช้เป็นบรรทัดฐานกลางสำหรับ Feature Issues ถัดไป (#61–#70)

---

## 1. Response Envelope Conventions

### 1.1 Success Response (`200 OK`, `201 Created`)

ทุก Response ที่ทำงานสำเร็จ ต้องส่งข้อมูลในฟิลด์ `data`:

```json
{
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "status": "DRAFT",
    "company_id": "22222222-2222-4222-8222-222222222222",
    "version": 1
  }
}
```

สำหรับ Endpoint ที่มีการแบ่งหน้า (Pagination) เช่น รายการค้นหาหรือคิวตรวจ:

```json
{
  "data": [
    { "id": "..." }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 45,
    "totalPages": 5
  }
}
```

### 1.2 Error Response Envelope

ทุก Error ต้องส่งในฟิลด์ `error` พร้อม `code` และ `message` ที่ชัดเจนเสมอ:

```json
{
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "คำอธิบายความผิดพลาดที่ปลอดภัยสำหรับ Client",
    "details": [
      {
        "field": "cycle_id",
        "issue": "Required field is missing"
      }
    ]
  }
}
```

*หมายเหตุ: ฟิลด์ `details` เป็น Optional (มีเฉพาะเมื่อมีข้อมูลรายละเอียดเพิ่มเติม เช่น ฟิลด์ที่ validation ไม่ผ่าน)*

---

## 2. Standard HTTP Status & Error Codes

| HTTP Status | Code มาตรฐาน | คำอธิบาย | ตัวอย่างการใช้งาน |
|---|---|---|---|
| **400 Bad Request** | `VALIDATION_ERROR`<br>`INVALID_INPUT` | ข้อมูล input ไม่ถูกต้อง หรือขาด required field | ส่ง query parameter ที่ไม่อนุญาต, field ไม่ครบตาม schema #52 |
| **401 Unauthorized** | `UNAUTHORIZED` | ไม่พบ Access Token หรือ Token หมดอายุ/ผิดรูปแบบ | เรียก protected endpoint โดยไม่แนบ Bearer token (#61) |
| **403 Forbidden** | `FORBIDDEN` | Token ถูกต้องแต่ไม่มีสิทธิ์ใน Resource หรือ Role ไม่อนุญาต | Advisor พยายาม mutation, Student A พยายามอ่าน Plan ของ Student B (#62) |
| **404 Not Found** | `RECORD_NOT_FOUND`<br>`ROUTE_NOT_FOUND` | ไม่พบข้อมูลที่ต้องการในขอบเขตสิทธิ์ของผู้ใช้ หรือไม่พบ route | ระบุ Plan ID ที่ไม่มีอยู่จริง |
| **405 Method Not Allowed** | `METHOD_NOT_ALLOWED` | เรียก HTTP Method ที่ Endpoint นั้นไม่รองรับ | ส่ง POST ไปที่ endpoint สาธารณะที่เป็น GET-only (มี header `Allow`) |
| **409 Conflict** | `CONFLICT`<br>`STALE_RECORD_CONFLICT` | ข้อมูลถูกแก้ไขโดยคำขออื่นไปแล้ว (Version Mismatch) | ส่ง version ไม่ตรงกับฐานข้อมูลตอน submit หรือ update Plan |
| **422 Unprocessable Entity** | `INVALID_STATE_TRANSITION` | ข้อมูลถูกรูปแบบแต่สถานะปัจจุบันของ Workflow ไม่อนุญาต | พยายาม Approve แผนที่ยังอยู่ในสถานะ DRAFT (#54) |
| **500 Internal Server Error** | `INTERNAL_ERROR` | เกิดข้อผิดพลาดที่ไม่คาดคิดในระบบ Backend | ซ่อน stack trace และ internal details ไม่ให้หลุดไปยัง Client |
| **503 Service Unavailable** | `CONNECTION_ERROR`<br>`SERVICE_UNAVAILABLE` | Database หรือ Dependency ภายนอกไม่พร้อมให้บริการ | Database pool เต็ม หรือไม่สามารถเชื่อมต่อ RDS ได้ |

---

## 3. Code Examples สำหรับ Downstream Issues

### 3.1 การ Throw Error ใน Service หรือ Controller Layer

```javascript
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InvalidStateTransitionError
} = require('./errors');

// ตัวอย่างใน Validation (#52)
if (!plan.company_id) {
  throw new ValidationError('Company is required to submit a Plan.', [
    { field: 'company_id', issue: 'must not be empty' }
  ]);
}

// ตัวอย่างใน Authorization Guard (#62)
if (requestContext.role === 'ADVISOR' && isMutation) {
  throw new ForbiddenError('Advisors have read-only access and cannot perform workflow mutations.');
}

// ตัวอย่างใน Concurrency Check (#54, #69)
if (currentPlan.version !== expectedVersion) {
  throw new ConflictError('Plan has been updated by another transaction. Please reload and retry.');
}

// ตัวอย่างใน Workflow State Machine (#54, #63)
if (currentPlan.status !== 'DRAFT' && currentPlan.status !== 'NEEDS_REVISION') {
  throw new InvalidStateTransitionError(`Cannot submit Plan from status: ${currentPlan.status}`);
}
```

### 3.2 การส่ง Response ใน Route Handler

```javascript
const { sendSuccess, sendError } = require('./response');

// ส่งข้อมูลสำเร็จ
router.get('/api/me', async (req, res, { dal }) => {
  const profile = await getOwnProfile(req);
  sendSuccess(res, profile);
});

// ส่ง Error ผ่าน try/catch (Router จะช่วย mapError ให้อัตโนมัติด้วย)
router.post('/api/plans', async (req, res, { dal }) => {
  try {
    const created = await createDraftPlan(req);
    sendSuccess(res, created, 201);
  } catch (err) {
    sendError(res, err);
  }
});
```

### 3.3 การดึง Auth Context จาก Request (#61, #62)

Protected route ต้องใส่ `authenticate` เป็น route-scoped middleware ใน `registerV3Routes()` ห้ามใช้ `router.use()` เพราะจะบังคับ Login กับ Public routes ด้วย

```javascript
// src/api/routes/v3-routes.js
const { getRequestContext } = require('../context');
const { sendSuccess } = require('../response');

function registerV3Routes(router, { authenticate = createAuthMiddleware() } = {}) {
  router.get('/api/v3/me', authenticate, async (req, res) => {
    // อ่าน Trusted Identity ที่ middleware resolve จาก RDS แล้วเท่านั้น
    const { userId, role, studentId } = getRequestContext(req);
    sendSuccess(res, { userId, role, studentId });
  });
}
```

ข้อกำหนด:

- Handler และ Service ห้าม parse token หรืออ่าน `Authorization` header เอง (#61 coordination note)
- ห้ามเชื่อ `role`, `userId`, `studentId` จาก body, query หรือ header ที่ client ส่งมา
- Production รับ identity จาก `requestContext.authorizer.jwt.claims` ของ API Gateway JWT Authorizer เท่านั้น (#48) การตรวจ Bearer token ใน Lambda (`allowBearerFallback: true`) ใช้ได้เฉพาะ local development และ test
- Middleware ต้องตั้งค่า `AUTH_ISSUER` และ `AUTH_AUDIENCE` (#58) ถ้าไม่ตั้ง ทุก request จะได้ `401`
- Role `SYSTEM` ไม่สามารถ authenticate ผ่าน token ได้

| กรณี | Response |
|---|---|
| ไม่มี token, token ผิด, หมดอายุ, scope ไม่ครบ | `401 UNAUTHORIZED` |
| ไม่พบ identity link, link ถูก revoke, account disabled, duplicate link, provisioning ไม่ครบ | `403 FORBIDDEN` (message เดียวกันทุกกรณี) |
| Database ไม่พร้อมใช้งานระหว่าง resolve identity | `503 SERVICE_UNAVAILABLE` |

---

## 4. Architectural Boundaries

```
[Client / API Gateway]
         │ (HTTP Event)
         ▼
[src/lambda.js / src/server.js]
         │
         ▼
[src/api/app.js (createRequestHandler)]
         │
    ┌────┴─────────────────────────────┐
    ▼                                  ▼
[Router & Middlewares]         [Shared Error / Response]
(src/api/router.js)            (src/api/errors.js, response.js)
    │
    ├─► /api/companies (Public Routes) ──► src/db/dal.js
    ├─► /api/health (Health Route)
    └─► /api/v3/* (Protected Routes)   ──► Context / Services / Workflows
```

### 4.1 Layer Responsibilities

| Layer | ตำแหน่ง | หน้าที่ | ห้ามทำ |
|---|---|---|---|
| Route / Controller | `src/api/routes/*-routes.js` | ลงทะเบียน path กับ Router, ตรวจ query/path parameter, อ่าน Request Context, เรียก Service และส่ง Response ผ่าน `sendSuccess()` | ห้าม query database โดยตรง และห้ามสร้าง response shape เอง |
| Service | `src/api/services/*-service.js` | Business rule, การตรวจสิทธิ์ตาม Scope (#62) และ Workflow transition (#63) โดย throw Error class จาก `src/api/errors.js` | ห้ามอ่าน/เขียน HTTP request หรือ response |
| Repository (DAL) | `src/db/dal.js` หรือ `src/db/repositories/*.js` | SQL query, transaction และแปลง PostgreSQL error เป็น `DALError` | ห้ามรู้จัก HTTP status หรือ Role ของผู้ใช้ |

ทิศทางการ import ต้องเป็นทางเดียวเสมอ: `app` → `routes` → `services` → `repositories` และทุกชั้นใช้ `errors` / `response` / `context` ร่วมกันได้ ห้าม import ย้อนทิศเพื่อป้องกัน circular dependency

Feature Issue ที่เพิ่ม endpoint ให้สร้างไฟล์ route ใหม่ใน `src/api/routes/` แล้วลงทะเบียนใน `registerV3Routes()` ภายใน `src/api/routes/v3-routes.js`

### 4.2 Compatibility Notes

- Request ที่ไม่ใช่ `GET` ไปยัง path ที่ไม่มี route จะได้ `405 METHOD_NOT_ALLOWED` พร้อม `Allow: GET` ตามพฤติกรรม V2 ส่วน `GET` ไปยัง path ที่ไม่มีจะได้ `404 ROUTE_NOT_FOUND`
- `DALError` ที่มี code `UNIQUE_VIOLATION` (PostgreSQL `23505`) จะถูก map เป็น `409 CONFLICT` ส่วน constraint violation อื่นยังเป็น `500 INTERNAL_ERROR` เพราะควรถูกดักด้วย validation ใน Service ก่อนถึง database
