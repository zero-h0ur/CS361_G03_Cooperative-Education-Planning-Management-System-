/**
 * Student own Plan submission client for CO-ED V3 (#76).
 * Uses the backend contracts in docs/api/v3-shared-contract.md:
 * - GET  /api/v3/plans                    own Plans (#66, section 3.7)
 * - GET  /api/v3/plans/:planId/history    audit-derived history (#76, section 3.10)
 * - POST /api/v3/plans/:planId/submit     { expected_version, operation_id } (#69, section 3.9)
 * - GET  /api/companies/:id                     public company display name
 * - GET  /api/v3/directory/positions/:id         authenticated position display name
 */

export const STUDENT_PLAN_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PLAN_ALREADY_EXISTS_FOR_CYCLE: 'PLAN_ALREADY_EXISTS_FOR_CYCLE',
  STALE_RECORD_CONFLICT: 'STALE_RECORD_CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
});

// Workflow states from #54
export const PLAN_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEEDS_REVISION: 'NEEDS_REVISION',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED'
});

// Student may submit (#54) and edit content (#52 section 7) only in these states
export const SUBMITTABLE_PLAN_STATUS_SET = new Set([PLAN_STATUSES.DRAFT, PLAN_STATUSES.NEEDS_REVISION]);

export const READ_ONLY_PLAN_STATUS_SET = new Set([
  PLAN_STATUSES.SUBMITTED,
  PLAN_STATUSES.UNDER_REVIEW,
  PLAN_STATUSES.APPROVED,
  PLAN_STATUSES.CANCELLED
]);

const VALID_PLAN_STATUS_SET = new Set(Object.values(PLAN_STATUSES));

// Plan response allowlist from #66 plus public display names resolved by this client
export const ALLOWED_PLAN_FIELDS = Object.freeze([
  'id',
  'cycle_id',
  'company_id',
  'position_id',
  'notes',
  'status',
  'version',
  'created_at',
  'updated_at'
]);

// Required before submit per #52 section 3. Cycle OPEN and public Company/Position are
// re-validated by the server at submit time; the UI only checks presence.
const REQUIRED_READINESS_FIELDS = Object.freeze([
  { field: 'cycle_id', label: 'รอบการสมัคร (Cycle)' },
  { field: 'company_id', label: 'สถานประกอบการ' },
  { field: 'position_id', label: 'ตำแหน่งงาน' }
]);

export const HISTORY_ACTION_LABELS = Object.freeze({
  PLAN_CREATED: 'สร้างแผน',
  PLAN_DRAFT_UPDATED: 'แก้ไขข้อมูลแผน',
  PLAN_SUBMITTED: 'ส่งแผน',
  PLAN_REVIEW_STARTED: 'เริ่มตรวจแผน',
  PLAN_RETURNED: 'ส่งกลับให้แก้ไข',
  PLAN_APPROVED: 'อนุมัติแผน',
  PLAN_CANCELLED: 'ยกเลิกแผน'
});

const ACTOR_ROLE_LABELS = Object.freeze({
  STUDENT: 'นักศึกษา (เจ้าของแผน)',
  STAFF: 'เจ้าหน้าที่สหกิจศึกษา',
  ADVISOR: 'อาจารย์ที่ปรึกษา',
  ADMIN: 'ผู้ดูแลระบบ',
  SYSTEM: 'ระบบ CO-ED'
});

export class StudentPlanError extends Error {
  constructor(code, message = 'Student plan request failed.', details = []) {
    super(message);
    this.name = 'StudentPlanError';
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
  }
}

function isPresentValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

export function evaluatePlanReadiness(plan) {
  const missingFields = REQUIRED_READINESS_FIELDS
    .filter((item) => !plan || !isPresentValue(plan[item.field]))
    .map((item) => ({ field: item.field, label: item.label, issue: `ยังไม่ได้ระบุ${item.label}` }));

  const isSubmittableStatus = Boolean(plan) && SUBMITTABLE_PLAN_STATUS_SET.has(plan.status);
  const isComplete = missingFields.length === 0;
  return Object.freeze({
    isSubmittableStatus,
    isComplete,
    canSubmit: isSubmittableStatus && isComplete,
    isReadOnly: !plan || READ_ONLY_PLAN_STATUS_SET.has(plan.status),
    missingFields: Object.freeze(missingFields)
  });
}

/**
 * Allowlists one history entry from GET /api/v3/plans/:planId/history (#50):
 * no actor ids, operation ids or correlation ids reach the UI.
 */
export function sanitizeStatusHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.action !== 'string') {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }
  const state = (value) => (typeof value === 'string' && VALID_PLAN_STATUS_SET.has(value) ? value : null);
  const role = typeof entry.actor_role === 'string' ? entry.actor_role.toUpperCase() : '';

  return Object.freeze({
    id: typeof entry.event_id === 'string' ? entry.event_id : null,
    action: entry.action,
    action_label: HISTORY_ACTION_LABELS[entry.action] || entry.action,
    from_status: state(entry.from_state),
    to_status: state(entry.to_state),
    actor_label: ACTOR_ROLE_LABELS[role] || 'ระบบ CO-ED',
    reason: typeof entry.review_notes === 'string' && entry.review_notes.trim() !== ''
      ? entry.review_notes.trim()
      : null,
    created_at: typeof entry.created_at === 'string' ? entry.created_at : null
  });
}

export function sanitizeStatusHistory(entries) {
  if (!Array.isArray(entries)) {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
  }
  return Object.freeze(entries.map(sanitizeStatusHistoryEntry));
}

/** Review comment of the latest return, shown while the Plan is NEEDS_REVISION. */
export function findLatestReturnReason(statusHistory) {
  for (let index = statusHistory.length - 1; index >= 0; index -= 1) {
    if (statusHistory[index].action === 'PLAN_RETURNED') {
      return statusHistory[index].reason;
    }
  }
  return null;
}

export function sanitizePlanRecord(rawPlan, display = {}) {
  if (
    !rawPlan ||
    typeof rawPlan !== 'object' ||
    Array.isArray(rawPlan) ||
    typeof rawPlan.id !== 'string' ||
    rawPlan.id.trim() === '' ||
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
  sanitized.company_name = display.companyName ?? null;
  sanitized.position_title = display.positionTitle ?? null;
  return Object.freeze(sanitized);
}

/** The Plan to work on: newest non-cancelled one (GET /api/v3/plans is newest first). */
export function selectCurrentPlan(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return null;
  }
  return plans.find((plan) => plan?.status !== PLAN_STATUSES.CANCELLED) || plans[0];
}

function buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix, query = '') {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.CONFIGURATION);
  }
  try {
    const baseUrl = new URL(apiBaseUrl, currentOrigin);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${pathSuffix}`;
    baseUrl.search = query;
    baseUrl.hash = '';
    return baseUrl.href;
  } catch {
    throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.CONFIGURATION);
  }
}

/** Maps the shared error contract (#55, sections 3.7–3.10) to UI error codes. */
async function parsePlanErrorResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const errorCode = payload?.error?.code;
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];

  switch (response.status) {
    case 401:
      return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED);
    case 403:
      return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED);
    case 404:
      return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.NOT_FOUND);
    case 409:
      if (errorCode === 'PLAN_ALREADY_EXISTS_FOR_CYCLE') {
        return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.PLAN_ALREADY_EXISTS_FOR_CYCLE,
          'มีแผนในรอบนี้แล้ว กรุณาเปิดแผนเดิมหรือเลือกรอบอื่น', details);
      }
      // STALE_RECORD_CONFLICT or IDEMPOTENCY_KEY_REUSED: either way the UI must reload
      return new StudentPlanError(
        STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT,
        errorCode === 'IDEMPOTENCY_KEY_REUSED'
          ? 'คำขอส่งแผนนี้ถูกใช้ไปแล้ว กรุณาโหลดข้อมูลแผนล่าสุดก่อนดำเนินการใหม่'
          : 'ข้อมูลแผนสหกิจถูกอัปเดตจากหน้าต่างหรือคำสั่งอื่น กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการใหม่',
        details
      );
    case 422:
      return new StudentPlanError(
        STUDENT_PLAN_ERROR_CODES.INVALID_STATE_TRANSITION,
        'สถานะของแผนสหกิจในปัจจุบันไม่อนุญาตให้ส่งแผน กรุณาโหลดข้อมูลแผนล่าสุด',
        details
      );
    case 400:
      return new StudentPlanError(
        STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR,
        'ข้อมูลแผนสหกิจยังไม่ผ่านเงื่อนไขการส่งแผน (ต้องมีรอบที่เปิดรับ สถานประกอบการ และตำแหน่งงานที่เปิดเผย)',
        details
      );
    default:
      return new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE);
  }
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
  // Fail fast on a bad configuration
  buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/plans');

  async function requestToken() {
    try {
      const token = await getAccessToken();
      if (typeof token !== 'string' || token.trim() === '') {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED);
      }
      return token;
    } catch (error) {
      if (error instanceof StudentPlanError) throw error;
      throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED);
    }
  }

  async function requestJson(url, { method = 'GET', body, signal, authenticated = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (authenticated) headers.Authorization = `Bearer ${await requestToken()}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE);
    }
    if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
      throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
    }
    if (!response.ok) {
      throw await parsePlanErrorResponse(response);
    }
    try {
      return await response.json();
    } catch {
      throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
    }
  }

  // Display names are optional; a failed lookup must not block the Plan view.
  async function fetchPublicName(pathSuffix, field, signal) {
    try {
      const payload = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix), {
        signal,
        authenticated: pathSuffix.startsWith('/api/v3/')
      });
      return typeof payload?.data?.[field] === 'string' ? payload.data[field] : null;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return null;
    }
  }

  async function resolveDisplayNames(plan, signal) {
    const [companyName, positionTitle] = await Promise.all([
      plan.company_id
        ? fetchPublicName(`/api/companies/${encodeURIComponent(plan.company_id)}`, 'name', signal)
        : null,
      plan.position_id
        ? fetchPublicName(`/api/v3/directory/positions/${encodeURIComponent(plan.position_id)}`, 'title', signal)
        : null
    ]);
    return { companyName, positionTitle };
  }

  return Object.freeze({
    async listCycles({ signal } = {}) {
      const payload = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/plan-options/cycles'), { signal });
      if (!Array.isArray(payload?.data) || payload.data.some((row) =>
        !row || typeof row.id !== 'string' || typeof row.name !== 'string' || !['OPEN', 'CLOSED'].includes(row.status))) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }
      return payload.data.map(({ id, name, academic_year, semester, status }) =>
        Object.freeze({ id, name, academic_year, semester, status }));
    },

    async searchCompanies({ q = '', page = 1, signal } = {}) {
      const query = new URLSearchParams({ q: q.trim(), page: String(page), pageSize: '10' });
      const payload = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin, '/api/directory/companies', query.toString()), {
        signal, authenticated: false
      });
      if (!Array.isArray(payload?.data) || payload.data.some((row) => !row || typeof row.id !== 'string' || typeof row.name !== 'string') ||
          !Number.isInteger(payload?.pagination?.totalPages) || payload.pagination.totalPages < 0) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }
      return { items: payload.data.map(({ id, name }) => ({ id, name })), pagination: payload.pagination };
    },

    async getCompanyPositions({ companyId, signal } = {}) {
      const payload = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin,
        `/api/v3/directory/companies/${encodeURIComponent(companyId)}/positions`), { signal });
      if (!Array.isArray(payload?.data) || payload.data.some((row) =>
        !row || typeof row.id !== 'string' || typeof row.title !== 'string' || row.company_id !== companyId)) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }
      return payload.data.map(({ id, company_id, title }) => ({ id, company_id, title }));
    },

    async saveDraft({ planId = null, content, expectedVersion, operationId, signal } = {}) {
      const body = { cycle_id: content.cycle_id, company_id: content.company_id,
        position_id: content.position_id, notes: content.notes, operation_id: operationId };
      if (planId) body.expected_version = expectedVersion;
      const payload = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin,
        planId ? `/api/v3/plans/${encodeURIComponent(planId)}` : '/api/v3/plans'), {
        method: planId ? 'PATCH' : 'POST', body, signal
      });
      return sanitizePlanRecord(payload?.data);
    },

    /**
     * Loads the current own Plan and its history from the server.
     * Resolves { plan: null, statusHistory: [] } when the Student has no Plan yet.
     */
    async getOwnPlan({ signal, planId = null } = {}) {
      const list = await requestJson(
        buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/plans', '?pageSize=100'),
        { signal }
      );
      if (!Array.isArray(list?.data)) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }
      const plans = [...list.data];
      // Preserve access to older cycles even when the Student has over 100 Plans.
      const totalPages = list.pagination?.totalPages ?? 1;
      if (!Number.isSafeInteger(totalPages) || totalPages < 0) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }
      for (let page = 2; page <= totalPages; page += 1) {
        const next = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/plans',
          `?pageSize=100&page=${page}`), { signal });
        if (!Array.isArray(next?.data)) throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
        plans.push(...next.data);
      }
      let current = selectCurrentPlan(plans);
      if (planId) {
        current = plans.find((item) => item.id === planId);
        if (!current) {
          const detail = await requestJson(buildApiUrl(apiBaseUrl, currentOrigin,
            `/api/v3/plans/${encodeURIComponent(planId)}`), { signal });
          current = detail?.data;
        }
        if (!current) throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.INVALID_RESPONSE);
      }
      if (!current) {
        return Object.freeze({ plan: null, plans: Object.freeze([]), statusHistory: Object.freeze([]) });
      }

      const [historyPayload, display] = await Promise.all([
        requestJson(
          buildApiUrl(apiBaseUrl, currentOrigin, `/api/v3/plans/${encodeURIComponent(current.id)}/history`),
          { signal }
        ),
        resolveDisplayNames(current, signal)
      ]);

      return Object.freeze({
        plan: sanitizePlanRecord(current, display),
        plans: Object.freeze(plans.map((row) => sanitizePlanRecord(row))),
        statusHistory: sanitizeStatusHistory(historyPayload?.data)
      });
    },

    /**
     * Submits a Plan. The caller owns operationId and must reuse it when retrying the
     * same click after a network failure (#52 section 9) so the server deduplicates it.
     */
    async submitPlan({ planId, expectedVersion, operationId, signal } = {}) {
      if (typeof planId !== 'string' || planId.trim() === '') {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR, 'ไม่พบรหัสแผนสหกิจศึกษา');
      }
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR, 'ไม่พบเลขเวอร์ชันของแผนสหกิจศึกษา');
      }
      if (typeof operationId !== 'string' || operationId.trim() === '') {
        throw new StudentPlanError(STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR, 'ไม่พบรหัสคำขอส่งแผน');
      }

      const payload = await requestJson(
        buildApiUrl(apiBaseUrl, currentOrigin, `/api/v3/plans/${encodeURIComponent(planId.trim())}/submit`),
        {
          method: 'POST',
          body: { expected_version: expectedVersion, operation_id: operationId },
          signal
        }
      );
      return Object.freeze({
        status: payload?.data?.status ?? null,
        version: payload?.data?.version ?? null,
        idempotentReplay: Boolean(payload?.data?.idempotent_replay)
      });
    }
  });
}
