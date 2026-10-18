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

Protected route ทุกตัวต้องลงทะเบียนผ่าน `registerProtectedRoute()` เท่านั้น ซึ่งจะต่อ Authentication (#61) และ Centralized Authorization (#62) เป็น route-scoped middleware ให้อัตโนมัติ ห้ามใช้ `router.use()` เพราะจะบังคับ Login กับ Public routes และห้ามใส่ auth middleware เองโดยตรงเพราะจะข้าม Authorization

```javascript
// src/api/routes/v3-routes.js
function registerV3Routes(router, options = {}) {
  registerProtectedRoute(router, {
    method: 'GET',
    pattern: /^\/api\/v3\/plans\/([^/]+)$/,
    action: ACTIONS.PLAN_LIST_READ,
    // ส่งเฉพาะ identifier จาก path; policy อ่าน owner, round และ status ของ Plan จาก DB เอง
    resolveResource: (req, { params }) => ({ planId: params[0] }),
    authOptions: options.authOptions,
    handler: async (req, res, { authContext, authzDecision }) => {
      // authContext = Trusted Identity จาก RDS, authzDecision = ผลการตัดสินสิทธิ์
      sendSuccess(res, await planService.getPlan(authzDecision.planId));
    }
  });
}
```

`resolveResource` ต้องคืนเฉพาะ identifier ของ resource เป้าหมาย (`studentId`, `planId`) จาก path ห้ามส่งข้อมูลที่ใช้ตัดสินสิทธิ์ เช่น owner หรือ status ของ Plan เพราะ policy จะอ่านค่าเหล่านี้จาก database ทุกครั้ง

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

### 3.4 Session Bootstrap: `GET /api/v3/me` (#64)

Frontend (#57) เรียก endpoint นี้หลัง Login เพื่ออ่าน Identity, Role และ Capability ที่ Server resolve จาก RDS แล้ว ใช้แสดง Navigation/Controls เท่านั้น Backend ยังตรวจสิทธิ์ซ้ำทุก action (#49)

- Path เดียวคือ `/api/v3/me` ต้องติด API Gateway JWT Authorizer และไม่มี alias อื่น
- ไม่รับ Query parameter ใดๆ หากส่งมาจะได้ `400 VALIDATION_ERROR`
- Response ไม่มี token, `iss`, `sub`, identity link ID, ชื่อ หรือ Email

```json
{
  "data": {
    "user": { "id": "<user-uuid>", "role": "STUDENT", "accountStatus": "ACTIVE" },
    "role": "STUDENT",
    "studentId": "<student-uuid>",
    "profile": {
      "studentId": "<student-uuid>",
      "department": "Computer Science",
      "program": "B.Sc.",
      "major": "Computer Science",
      "academicYear": 2567,
      "enrollmentStatus": "ACTIVE"
    },
    "capabilities": {
      "role": "STUDENT",
      "scopeMode": "OWN",
      "canMutateStudentProfile": true,
      "canMutatePlanContent": true,
      "canSubmitPlan": true,
      "canReviewPlan": false,
      "isReadOnly": false,
      "allowedActions": ["session:read_me", "plan:create", "..."],
      "permissions": { "session:read_me": "AUTHENTICATED", "plan:create": "OWN" },
      "navigation": {
        "canAccessStudentDashboard": true,
        "canAccessMyProfile": true,
        "canAccessMyPlan": true,
        "canAccessAdvisorStudents": false,
        "canAccessStaffStudentManagement": false,
        "canAccessStaffReviewQueue": false
      }
    },
    "scope": {
      "mode": "OWN",
      "studentId": "<student-uuid>",
      "operationalScopes": [],
      "assignedStudents": [],
      "assignedStudentCount": 0
    }
  }
}
```

| Field | ค่าตาม Role |
|---|---|
| `studentId`, `profile` | มีค่าเฉพาะ `STUDENT` นอกนั้นเป็น `null` |
| `scope.mode` | `STUDENT` = `OWN`, `ADVISOR` = `ASSIGNED`, `STAFF` = `SCOPED`, `ADMIN` = `DENY` |
| `scope.operationalScopes` | เฉพาะ `STAFF`: `[{ department, program, academicYear }]` จาก `staff_scopes` ที่ `ACTIVE` |
| `scope.assignedStudents` | เฉพาะ `ADVISOR`: `[{ studentId, academicYear, semester }]` ที่ assignment มีผล ณ เวลาที่ร้องขอ |

Error: ไม่มี/ผิด/หมดอายุ token → `401`, ไม่พบ link/disabled/provisioning ไม่ครบ → `403`, Method อื่นนอกจาก `GET` → `405`

### 3.5 Student Self-Profile: `/api/v3/students/me` (#65)

ใช้ได้เฉพาะ Role `STUDENT` เจ้าของ Profile มาจาก Trusted Identity Context เสมอ ไม่มี Endpoint ที่รับ `studentId` เพื่อเลือกเจ้าของข้อมูล (`/api/v3/students/:studentId` สงวนไว้สำหรับ Staff/Advisor ใน #67 และ #68)

| Method | หน้าที่ |
|---|---|
| `GET` | อ่าน Profile ของตนเอง |
| `PATCH`, `PUT` | แก้ `preferred_name` ของตนเอง (ทั้งสอง Method ทำงานเหมือนกัน) |

Response (`GET` และผลของการ Update) ส่งเฉพาะ Field ใน Allowlist ตาม #50/#51:

```json
{
  "data": {
    "id": "<student-uuid>",
    "student_number": "6509610001",
    "full_name": "<ชื่อทางการ>",
    "preferred_name": "Chai",
    "institutional_email": "<email>@dome.tu.ac.th",
    "department": "Computer Science",
    "program": "B.Sc. Computer Science",
    "major": "Software Engineering",
    "academic_year": 2566,
    "enrollment_status": "ACTIVE",
    "created_at": "2026-01-10T08:00:00.000Z",
    "updated_at": "2026-02-15T10:30:00.000Z",
    "version": 3
  }
}
```

Update payload:

```json
{ "preferred_name": "Chai", "version": 3 }
```

- `preferred_name` จำเป็นต้องส่ง: เป็น String หรือ `null`, ระบบ Trim ให้, String ว่างจะถูกเก็บเป็น `null`, ยาวไม่เกิน 100 ตัวอักษร และห้ามมี Control character
- `version` เป็น Optional แต่ **Frontend ควรส่งค่าที่อ่านมาล่าสุดเสมอ** ถ้าไม่ส่งจะเป็น Last-write-wins
- ถ้ามี Field อื่นใน Payload (Field ทางการ, Immutable หรือไม่รู้จัก) ระบบจะปฏิเสธทั้ง Request โดยไม่แก้ข้อมูลบางส่วน
- ไม่รับ Query parameter ใดๆ

| กรณี | Response |
|---|---|
| Payload ผิด/มี Field ที่ไม่อนุญาต/Query parameter | `400 VALIDATION_ERROR` พร้อม `details: [{ field, issue }]` |
| ไม่มี/ผิด/หมดอายุ token | `401 UNAUTHORIZED` |
| ไม่ใช่ Role `STUDENT` | `403 FORBIDDEN` |
| ไม่พบ Profile ที่ Link กับบัญชี | `404 RECORD_NOT_FOUND` |
| `version` ไม่ตรงกับข้อมูลปัจจุบัน | `409 STALE_RECORD_CONFLICT` พร้อม `details: { expectedVersion, currentVersion }` |
| Database ไม่พร้อมใช้งาน | `503 SERVICE_UNAVAILABLE` |

### 3.6 Staff Search และ Review Queue: `/api/v3/staff/*` (#67)

Read-only API สำหรับ Role `STAFF` ที่มี `staff_scopes` สถานะ `ACTIVE` อย่างน้อย 1 รายการ คำสั่ง `start-review`, `return` และ `approve` อยู่ใน #70 (`POST /api/v3/plans/:id/...`)

| Endpoint | หน้าที่ | ลำดับเริ่มต้น |
|---|---|---|
| `GET /api/v3/staff/students` | ค้นหา Student ที่ Link กับ V3 Identity ภายใน Scope | `student_number ASC, id ASC` |
| `GET /api/v3/staff/plans` | ค้นหา Plan ทุกสถานะภายใน Scope | `updated_at DESC, id DESC` |
| `GET /api/v3/staff/review-queue` | Plan สถานะ `SUBMITTED`, `UNDER_REVIEW`, `NEEDS_REVISION` ในรอบที่ `OPEN` | `updated_at ASC, id ASC` (รอนานที่สุดก่อน) |

**Scope (#53 ข้อ 3.2):** กรองใน SQL ด้วย Predicate เดียวกับ `is_in_staff_scope` คือ `department` ตรงกัน, `program` ตรงกันหรือ Scope เป็น `null` และ `academic_year` ของ Scope เป็น `null` หรือตรงกับปีของ Round (สำหรับ Plan) / ปีของ Student (สำหรับ Student) ค่า `pagination.total` นับเฉพาะ Record ใน Scope และ Client ขยาย Scope ผ่าน Query ไม่ได้ (Parameter อื่นนอก Allowlist ได้ `400`)

**Query parameters** (ค่าว่างถือว่าไม่ได้ส่ง, ส่งซ้ำได้ `400`):

| Parameter | ใช้กับ | รูปแบบ |
|---|---|---|
| `page`, `pageSize` | ทุก Endpoint | Integer ≥ 1, `pageSize` ไม่เกิน 100 (ค่าเริ่มต้น `1`, `20`) |
| `q` | ทุก Endpoint | ค้นหา `student_number`, `full_name`, `preferred_name` แบบ Case-insensitive ไม่เกิน 100 ตัวอักษร (ห้าม Log ค่านี้ตาม #50) |
| `academic_year` | ทุก Endpoint | ปี พ.ศ. เช่น `2569` (ปี ค.ศ. ได้ `400`) |
| `advisor_id` | ทุก Endpoint | UUID ของ Advisor ที่มี Assignment `ACTIVE` ณ เวลาที่ร้องขอ |
| `round_id`, `company_id` | `plans`, `review-queue` | UUID |
| `status` | `plans`, `review-queue` | สถานะตาม #54 (`review-queue` รับเฉพาะ `SUBMITTED`, `UNDER_REVIEW`, `NEEDS_REVISION`) |
| `sort`, `order` | `plans`, `review-queue` | `sort` = `updated_at` / `created_at` / `student_number`, `order` = `asc` / `desc` (ใช้ `id` เป็น Tiebreaker เสมอ) |

**Response:** `{ data: [...], pagination: { page, pageSize, total, totalPages } }` ส่งเฉพาะ Field ใน Allowlist ตาม #50 ไม่มี `institutional_email`, Plan `notes`, Review comment, `user_id` หรือ Legacy columns

```json
{
  "data": [
    {
      "id": "<plan-uuid>",
      "status": "UNDER_REVIEW",
      "version": 2,
      "created_at": "2026-10-02T10:00:00.000Z",
      "updated_at": "2026-10-03T11:00:00.000Z",
      "cycle": { "id": "<round-uuid>", "name": "รอบที่ 1 ภาคเรียนที่ 1/2569", "academic_year": 2569, "semester": 1, "status": "OPEN" },
      "company": { "id": "<company-uuid>", "name": "Mock Analytics Lab" },
      "position": { "id": "<position-uuid>", "title": "นักวิเคราะห์ข้อมูล" },
      "student": {
        "id": "<student-uuid>", "student_number": "TEST000002", "full_name": "วิภา จำลอง",
        "preferred_name": "วิภา", "department": "CPE", "program": "ISNE", "academic_year": 2569
      }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

`/api/v3/staff/students` คืน `{ id, student_number, full_name, preferred_name, department, program, major, academic_year, enrollment_status }` ส่วน `company.name` / `position.title` เป็น `null` ถ้า Record นั้นไม่ใช่ `public` (#49: ห้ามอ่าน Private Company)

| กรณี | Response |
|---|---|
| Filter ผิดรูปแบบ, Parameter ที่ไม่รองรับ หรือส่งซ้ำ | `400 VALIDATION_ERROR` พร้อม `details: [{ field, issue }]` |
| ไม่มี/ผิด/หมดอายุ token | `401 UNAUTHORIZED` |
| ไม่ใช่ `STAFF` หรือไม่มี Scope ที่ `ACTIVE` | `403 FORBIDDEN` |
| Method อื่นนอกจาก `GET` | `405 METHOD_NOT_ALLOWED` |
| Database ไม่พร้อมใช้งาน | `503 SERVICE_UNAVAILABLE` |

Query ใช้ Index จาก Migration 002 ได้แก่ `idx_students_staff_scope`, `idx_staff_scopes_active_lookup`, `uq_plans_active_student_cycle` / `idx_plans_cycle_status` และ Primary keys ของ `rounds`, `companies`, `positions` (ตรวจด้วย `EXPLAIN` บน Fixture ของ #60)

### 3.7 Student Own Plan: `/api/v3/plans` (#66)

ใช้ได้เฉพาะ Role `STUDENT` เจ้าของ Plan มาจาก Trusted Identity Context เสมอ (#52 ข้อ 1)

> **Path ownership:** `/api/v3/plans` และ `/api/v3/plans/:planId` เป็นของ Student เท่านั้น Staff ใช้ `/api/v3/staff/*` (#67) และ Advisor ต้องใช้ `/api/v3/advisor/*` (#68) ส่วนคำสั่ง Workflow อยู่ที่ `POST /api/v3/plans/:planId/{submit,start-review,return,approve}` (#69, #70)

| Method | Path | หน้าที่ | Success |
|---|---|---|---|
| `POST` | `/api/v3/plans` | สร้าง Plan สถานะ `DRAFT` (`create_draft`) | `201` |
| `GET` | `/api/v3/plans` | รายการ Plan ของตนเอง รวม `CANCELLED` (Query: `page`, `pageSize` ค่าเริ่มต้น 10 สูงสุด 100, `cycle_id`, `status`) | `200` + `pagination` |
| `GET` | `/api/v3/plans/:planId` | รายละเอียด Plan ของตนเอง | `200` |
| `PATCH` | `/api/v3/plans/:planId` | แก้ Content เฉพาะสถานะ `DRAFT` / `NEEDS_REVISION` (`update_draft`) | `200` |

Request body:

```json
// POST /api/v3/plans
{ "cycle_id": "<uuid>", "company_id": "<uuid|null>", "position_id": "<uuid|null>", "notes": "ข้อความ", "operation_id": "<uuid>", "correlation_id": "<uuid>" }

// PATCH /api/v3/plans/:planId  (ต้องมี Content field อย่างน้อย 1 ตัว)
{ "notes": "ข้อความใหม่", "expected_version": 3, "operation_id": "<uuid>" }
```

- `operation_id` จำเป็นทุก Mutation และต้องใช้ค่าเดิมเมื่อ Retry (#52 ข้อ 9) ส่วน `correlation_id` เป็น Optional
- `expected_version` จำเป็นสำหรับ `PATCH` ให้ใช้ `version` ล่าสุดที่อ่านมา
- `notes`: Plain text, Trim, สูงสุด 2,000 ตัวอักษร, ค่าว่างเก็บเป็น `null`
- ถ้าส่ง `company_id` ต้องส่ง `position_id` มาใน Request เดียวกัน Company/Position ต้องเป็น `public` และ Position ต้องอยู่ภายใต้ Company นั้น
- Field อื่น (`status`, `version`, `student_id`, timestamps ฯลฯ) ได้ `400` ทั้ง Request

Response (`data`): `{ id, cycle_id, company_id, position_id, notes, status, version, created_at, updated_at }`

| กรณี | Response |
|---|---|
| Body/Query ผิด, Field ที่ไม่อนุญาต, `planId` ไม่ใช่ UUID, Reference ไม่ถูกต้อง | `400 VALIDATION_ERROR` |
| ไม่มี/ผิด/หมดอายุ token | `401 UNAUTHORIZED` |
| ไม่ใช่ `STUDENT` หรือ Plan ของคนอื่น | `403 FORBIDDEN` |
| ไม่พบ Plan | `404 RECORD_NOT_FOUND` |
| `expected_version` เก่า | `409 STALE_RECORD_CONFLICT` |
| ใช้ `operation_id` เดิมกับ Payload อื่น | `409 IDEMPOTENCY_KEY_REUSED` |
| มี Plan ที่ไม่ใช่ `CANCELLED` ใน Cycle เดียวกันอยู่แล้ว | `409 PLAN_ALREADY_EXISTS_FOR_CYCLE` |
| แก้ Plan ในสถานะที่ไม่อนุญาต (`SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `CANCELLED`) | `422 INVALID_STATE_TRANSITION` |
| Database ไม่พร้อมใช้งาน | `503 SERVICE_UNAVAILABLE` |

Retry ด้วย `operation_id` เดิมและ Payload เดิมคืนผลสำเร็จเดิมโดยไม่เพิ่ม `version` และไม่สร้าง Audit ซ้ำ ส่วน Company/Position ที่ใช้เลือกให้อ่านจาก Public Directory เดิม (`GET /api/companies`, `GET /api/companies/:id/positions`)

### 3.8 Staff Review Commands: `POST /api/v3/plans/:planId/{start-review,return,approve}` (#70)

ใช้ได้เฉพาะ Role `STAFF` ที่ Plan อยู่ใน Visibility Scope และรอบของ Plan เป็น `OPEN` (#53 ข้อ 3.2) Advisor เป็น Read-only ทุกคำสั่งได้ `403` ทุกคำสั่งผ่าน `WorkflowService` (#63) ซึ่งเปลี่ยนสถานะ เพิ่ม `version` และบันทึก `plan_operations` + `audit_events` ใน Transaction เดียวกัน

| Path | Transition (#54) | `review_notes` | Audit action |
|---|---|---|---|
| `/start-review` | `SUBMITTED` → `UNDER_REVIEW` | ไม่ใช้ | `PLAN_REVIEW_STARTED` |
| `/return` | `UNDER_REVIEW` → `NEEDS_REVISION` | **จำเป็น** (ไม่ว่าง) | `PLAN_RETURNED` |
| `/approve` | `UNDER_REVIEW` → `APPROVED` | Optional | `PLAN_APPROVED` |

Request body:

```json
{ "expected_version": 3, "operation_id": "<uuid>", "review_notes": "กรุณาแนบที่อยู่บริษัท", "correlation_id": "<uuid>" }
```

- `expected_version` และ `operation_id` จำเป็นทุกคำสั่ง ใช้ `operation_id` เดิมเมื่อ Retry (#52 ข้อ 8–9)
- `review_notes`: Plain text ไม่เกิน 2,000 ตัวอักษร เก็บใน `notes` ของ Audit event เท่านั้น ไม่เขียนทับ `plans.notes` ของ Student (#52)
- Body ห้ามมี `actor`, `action`, `plan_id`, `student_id`, `status` หรือ Field อื่นนอก Contract (`400`)
- ไม่มี Alias อื่น เช่น `/return-for-revision` (แต่ละ Path ต้องติด API Gateway JWT Authorizer)

Response (`data`): `{ id, student_id, cycle_id, company_id, position_id, notes, status, version, created_at, updated_at, operation_id, idempotent_replay, audit_reference: { event_id, action, from_state, to_state, notes, operation_id, correlation_id, created_at } }`

| กรณี | Response |
|---|---|
| Body ผิด, ไม่มี `review_notes` ตอน `/return`, `planId` ไม่ใช่ UUID | `400 VALIDATION_ERROR` |
| ไม่มี/ผิด/หมดอายุ token | `401 UNAUTHORIZED` |
| ไม่ใช่ `STAFF`, นอก Scope หรือรอบ `CLOSED` | `403 FORBIDDEN` |
| ไม่พบ Plan | `404 RECORD_NOT_FOUND` |
| `expected_version` เก่า หรือมี Reviewer อื่นทำก่อน | `409 STALE_RECORD_CONFLICT` พร้อม `details: { expectedVersion, currentVersion }` |
| ใช้ `operation_id` เดิมกับคำสั่งหรือ Payload อื่น | `409 IDEMPOTENCY_KEY_REUSED` |
| สถานะปัจจุบันไม่อนุญาตคำสั่งนี้ (เช่น `/approve` จาก `SUBMITTED`) | `422 INVALID_STATE_TRANSITION` |
| Database ไม่พร้อมใช้งาน | `503 SERVICE_UNAVAILABLE` |

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

Feature Issue ที่เพิ่ม endpoint ให้สร้างไฟล์ route ใหม่ใน `src/api/routes/` แล้วลงทะเบียนผ่าน `registerProtectedRoute()` จาก `registerV3Routes()` ภายใน `src/api/routes/v3-routes.js`

### 4.2 Compatibility Notes

- Request ที่ไม่ใช่ `GET` ไปยัง path ที่ไม่มี route จะได้ `405 METHOD_NOT_ALLOWED` พร้อม `Allow: GET` ตามพฤติกรรม V2 ส่วน `GET` ไปยัง path ที่ไม่มีจะได้ `404 ROUTE_NOT_FOUND`
- `DALError` ที่มี code `UNIQUE_VIOLATION` (PostgreSQL `23505`) จะถูก map เป็น `409 CONFLICT` ส่วน constraint violation อื่นยังเป็น `500 INTERNAL_ERROR` เพราะควรถูกดักด้วย validation ใน Service ก่อนถึง database
