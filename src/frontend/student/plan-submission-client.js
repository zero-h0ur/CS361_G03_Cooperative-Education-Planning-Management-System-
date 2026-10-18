export const STUDENT_PLAN_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  INCOMPLETE_PLAN: 'INCOMPLETE_PLAN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  STALE_RECORD_CONFLICT: 'STALE_RECORD_CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
});

export const PLAN_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RETURNED_FOR_REVISION: 'RETURNED_FOR_REVISION',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED'
});

export const SUBMITTABLE_PLAN_STATUS_SET = new Set([
  PLAN_STATUSES.DRAFT,
  PLAN_STATUSES.RETURNED_FOR_REVISION
]);

export const READ_ONLY_PLAN_STATUS_SET = new Set([
  PLAN_STATUSES.SUBMITTED,
  PLAN_STATUSES.UNDER_REVIEW,
  PLAN_STATUSES.APPROVED,
  PLAN_STATUSES.CANCELLED
]);

const VALID_PLAN_STATUS_SET = new Set(Object.values(PLAN_STATUSES));

export const ALLOWED_PLAN_FIELDS = Object.freeze([
  'id',
  'student_id',
  'company_id',
  'company_name',
  'academic_year',
  'semester',
  'position_title',
  'job_description',
  'start_date',
  'end_date',
  'status',
  'return_reason',
  'submitted_at',
  'reviewed_at',
  'approved_at',
  'cancelled_at',
  'created_at',
  'updated_at',
  'version'
]);

const REQUIRED_READINESS_FIELDS = Object.freeze([
  { field: 'academic_year', label: 'ปีการศึกษา' },
  { field: 'semester', label: 'ภาคการศึกษา' },
  { field: 'company_id', label: 'สถานประกอบการ' },
  { field: 'position_title', label: 'ตำแหน่งงานสหกิจ' },
  { field: 'job_description', label: 'รายละเอียดงานโดยสังเขป' },
  { field: 'start_date', label: 'วันเริ่มปฏิบัติงาน' },
  { field: 'end_date', label: 'วันสิ้นสุดการปฏิบัติงาน' }
]);

const MAX_SUBMIT_NOTE_LENGTH = 500;
const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;

export class StudentPlanError extends Error {
  constructor(code, message = 'Student plan request failed.', details = []) {
    super(message);
    this.name = 'StudentPlanError';
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
  }
}

function isPresentValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return true;
}

export function evaluatePlanReadiness(plan) {
  if (!plan || typeof plan !== 'object') {
    return Object.freeze({
      isSubmittableStatus: false,
      isComplete: false,
      canSubmit: false,
      isReadOnly: true,
      missingFields: REQUIRED_READINESS_FIELDS.map((item) => ({
        field: item.field,
        label: item.label,
        issue: `ยังไม่ได้ระบุ${item.label}`
      }))
    });
  }

  const isSubmittableStatus = SUBMITTABLE_PLAN_STATUS_SET.has(plan.status);
  const isReadOnly = READ_ONLY_PLAN_STATUS_SET.has(plan.status);
  const missingFields = [];

  for (const item of REQUIRED_READINESS_FIELDS) {
    if (!isPresentValue(plan[item.field])) {
      missingFields.push({
        field: item.field,
        label: item.label,
        issue: `ยังไม่ได้ระบุ${item.label}`
      });
    }
  }

  if (isPresentValue(plan.start_date) && isPresentValue(plan.end_date)) {
    const startMs = Date.parse(String(plan.start_date));
    const endMs = Date.parse(String(plan.end_date));
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
      missingFields.push({
        field: 'end_date',
        label: 'ช่วงเวลาปฏิบัติงาน',
        issue: 'วันสิ้นสุดการปฏิบัติงานต้องไม่ก่อนวันเริ่มปฏิบัติงาน'
      });
    }
  }

  const isComplete = missingFields.length === 0;
  return Object.freeze({
    isSubmittableStatus,
    isComplete,
    canSubmit: isSubmittableStatus && isComplete,
    isReadOnly,
    missingFields: Object.freeze(missingFields)
  });
}

export function validateSubmissionNote(rawNote) {
  if (rawNote === null || rawNote === undefined) {
    return Object.freeze({ valid: true, value: null, error: null });
  }

  if (typeof rawNote !== 'string') {
    return Object.freeze({
      valid: false,
      value: null,
      error: 'หมายเหตุประกอบการส่งแผนต้องเป็นข้อความ'
    });
  }

  const trimmed = rawNote.trim();
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    return Object.freeze({
      valid: false,
      value: null,
      error: 'หมายเหตุประกอบการส่งแผนต้องไม่มีอักขระควบคุม'
    });
  }

  if (trimmed.length > MAX_SUBMIT_NOTE_LENGTH) {
    return Object.freeze({
      valid: false,
      value: null,
      error: `หมายเหตุประกอบการส่งแผนต้องไม่เกิน ${MAX_SUBMIT_NOTE_LENGTH} ตัวอักษร`
    });
  }

  return Object.freeze({
    valid: true,
    value: trimmed.length === 0 ? null : trimmed,
    error: null
  });
}

function inferActorLabel(entry) {
  if (typeof entry?.actor_label === 'string' && entry.actor_label.trim() !== '') {
    return entry.actor_label.trim();
  }

  const role = String(entry?.actor_role || entry?.role || '').toUpperCase();
  if (role === 'STUDENT') {
    return 'นักศึกษา (เจ้าของแผน)';
  }
  if (role === 'STAFF') {
    return 'เจ้าหน้าที่สหกิจศึกษา';
  }
  if (role === 'ADVISOR') {
    return 'อาจารย์ที่ปรึกษา';
  }

  const toStatus = entry?.to_status;
  if (toStatus === PLAN_STATUSES.SUBMITTED || toStatus === PLAN_STATUSES.DRAFT) {
    return 'นักศึกษา (เจ้าของแผน)';
  }
  if (
    toStatus === PLAN_STATUSES.UNDER_REVIEW ||
    toStatus === PLAN_STATUSES.RETURNED_FOR_REVISION ||
    toStatus === PLAN_STATUSES.APPROVED
  ) {
    return 'เจ้าหน้าที่สหกิจศึกษา';
  }

  return 'ระบบ CO-ED';
}

export function sanitizeStatusHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }

  if (typeof entry.to_status !== 'string' || !VALID_PLAN_STATUS_SET.has(entry.to_status)) {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }

  // Deliberately omit raw actor_user_id, email, external_subject, or private metadata (#76 AC)
  return Object.freeze({
    id: typeof entry.id === 'string' ? entry.id : null,
    plan_id: typeof entry.plan_id === 'string' ? entry.plan_id : null,
    from_status:
      typeof entry.from_status === 'string' && VALID_PLAN_STATUS_SET.has(entry.from_status)
        ? entry.from_status
        : null,
    to_status: entry.to_status,
    actor_label: inferActorLabel(entry),
    reason: typeof entry.reason === 'string' && entry.reason.trim() !== '' ? entry.reason.trim() : null,
    created_at: typeof entry.created_at === 'string' ? entry.created_at : null
  });
}

export function sanitizeStatusHistory(entries) {
  if (!Array.isArray(entries)) {
    return Object.freeze([]);
  }
  return Object.freeze(entries.map((entry) => sanitizeStatusHistoryEntry(entry)));
}

export function sanitizePlanRecord(rawPlan) {
  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }

  if (
    typeof rawPlan.id !== 'string' ||
    rawPlan.id.trim() === '' ||
    typeof rawPlan.status !== 'string' ||
    !VALID_PLAN_STATUS_SET.has(rawPlan.status) ||
    !Number.isInteger(rawPlan.version) ||
    rawPlan.version < 1
  ) {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }

  const sanitized = {};
  for (const field of ALLOWED_PLAN_FIELDS) {
    sanitized[field] = rawPlan[field] === undefined ? null : rawPlan[field];
  }

  return Object.freeze(sanitized);
}

function buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix) {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.CONFIGURATION);
  }

  try {
    const baseUrl = new URL(apiBaseUrl, currentOrigin);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${pathSuffix}`;
    baseUrl.search = '';
    baseUrl.hash = '';
    return baseUrl.href;
  } catch {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.CONFIGURATION);
  }
}

async function parsePlanErrorResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const errorCode = payload?.error?.code;
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];

  if (response.status === 401) {
    return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED);
  }

  if (response.status === 403) {
    return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED);
  }

  if (response.status === 404) {
    return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.NOT_FOUND);
  }

  if (response.status === 409) {
    if (errorCode === 'INVALID_STATE_TRANSITION') {
      return new StudentPlanError(
        STUDENT_PLAN_ERROR_CODES.INVALID_STATE_TRANSITION,
        'สถานะของแผนสหกิจในปัจจุบันไม่อนุญาตให้ส่งแผนซ้ำ กรุณาโหลดข้อมูลแผนล่าสุด',
        details
      );
    }

    return new StudentPlanError(
      STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT,
      'ข้อมูลแผนสหกิจถูกอัปเดตจากหน้าต่างหรือคำสั่งอื่น กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการใหม่',
      details
    );
  }

  if (response.status === 400 || response.status === 422) {
    if (errorCode === 'INCOMPLETE_PLAN') {
      return new StudentPlanError(
        STUDENT_PLAN_ERROR_CODES.INCOMPLETE_PLAN,
        'ข้อมูลแผนสหกิจยังไม่ครบถ้วนตามเงื่อนไขการส่งแผน',
        details
      );
    }

    return new StudentPlanError(
      STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR,
      'ข้อมูลที่ส่งไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
      details
    );
  }

  return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE);
}

function normalizePlanBundle(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }

  const rawPlan = data.plan && typeof data.plan === 'object' ? data.plan : data;
  const plan = sanitizePlanRecord(rawPlan);

  let rawHistory = [];
  if (Array.isArray(data.statusHistory)) {
    rawHistory = data.statusHistory;
  } else if (Array.isArray(data.history)) {
    rawHistory = data.history;
  } else if (data.statusHistory && typeof data.statusHistory === 'object') {
    rawHistory = [data.statusHistory];
  } else if (Array.isArray(rawPlan.status_history)) {
    rawHistory = rawPlan.status_history;
  }

  const statusHistory = sanitizeStatusHistory(rawHistory);
  return Object.freeze({ plan, statusHistory });
}

export function createStudentPlanClient({
  apiBaseUrl,
  getAccessToken,
  fetchImpl = window.fetch.bind(window),
  currentOrigin = window.location.origin
} = {}) {
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.CONFIGURATION);
  }

  const ownPlanEndpoint = buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/plans/me');

  async function requestToken() {
    try {
      const token = await getAccessToken();
      if (typeof token !== 'string' || token.trim() === '') {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED);
      }
      return token;
    } catch (error) {
      if (error instanceof StudentPlanError) {
        throw error;
      }
      throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED);
    }
  }

  return Object.freeze({
    async getOwnPlan({ signal } = {}) {
      const accessToken = await requestToken();
      let response;

      try {
        response = await fetchImpl(ownPlanEndpoint, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE);
      }

      if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }

      if (!response.ok) {
        throw await parsePlanErrorResponse(response);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }

      return normalizePlanBundle(payload?.data);
    },

    async submitPlan({ planId, version, reason = null, signal } = {}) {
      if (typeof planId !== 'string' || planId.trim() === '') {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR, 'ไม่พบรหัสแผนสหกิจศึกษา');
      }

      if (!Number.isInteger(version) || version < 1) {
        throw new StudentPlanError(
          STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR,
          'ไม่พบเลขเวอร์ชันของแผนสหกิจศึกษา'
        );
      }

      const noteValidation = validateSubmissionNote(reason);
      if (!noteValidation.valid) {
        throw new StudentPlanError(
          STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR,
          noteValidation.error,
          [{ field: 'reason', issue: noteValidation.error }]
        );
      }

      const submitEndpoint = buildApiUrl(
        apiBaseUrl,
        currentOrigin,
        `/api/v3/plans/${encodeURIComponent(planId.trim())}/submit`
      );
      const accessToken = await requestToken();

      const requestBody = { version };
      if (noteValidation.value !== null) {
        requestBody.reason = noteValidation.value;
      }

      let response;
      try {
        response = await fetchImpl(submitEndpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify(requestBody),
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE);
      }

      if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }

      if (!response.ok) {
        throw await parsePlanErrorResponse(response);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }

      return normalizePlanBundle(payload?.data);
    }
  });
}
