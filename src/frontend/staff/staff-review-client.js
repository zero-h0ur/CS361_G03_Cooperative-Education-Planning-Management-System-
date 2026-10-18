/**
 * Staff review workspace client for CO-ED V3 (#77).
 * Uses the backend contracts in docs/api/v3-shared-contract.md:
 * - GET  /api/v3/staff/review-queue                       review queue (#67, section 3.6)
 * - GET  /api/v3/staff/plans/:planId                      one scoped Plan (#77, section 3.12)
 * - GET  /api/v3/staff/plans/:planId/history              audit-derived history (#77, section 3.12)
 * - POST /api/v3/plans/:planId/{start-review,return,approve}
 *        { expected_version, operation_id, review_notes? } (#70, section 3.8)
 */

export const STAFF_REVIEW_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  // 403 on a read: outside the Staff scope. 404: the Plan does not exist.
  NOT_IN_SCOPE: 'NOT_IN_SCOPE',
  NOT_FOUND: 'NOT_FOUND',
  // 403 on a command: out of scope or the Round is no longer OPEN
  COMMAND_FORBIDDEN: 'COMMAND_FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  STALE_RECORD_CONFLICT: 'STALE_RECORD_CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
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

export const REVIEW_COMMANDS = Object.freeze({
  START_REVIEW: 'start-review',
  RETURN: 'return',
  APPROVE: 'approve'
});

// Transitions from #54 / contract section 3.8
const COMMANDS_BY_STATUS = Object.freeze({
  [PLAN_STATUSES.SUBMITTED]: Object.freeze([REVIEW_COMMANDS.START_REVIEW]),
  [PLAN_STATUSES.UNDER_REVIEW]: Object.freeze([REVIEW_COMMANDS.APPROVE, REVIEW_COMMANDS.RETURN])
});

export const MAX_REVIEW_NOTES_LENGTH = 2000;
export const REVIEW_QUEUE_STATUSES = Object.freeze([
  PLAN_STATUSES.SUBMITTED,
  PLAN_STATUSES.UNDER_REVIEW,
  PLAN_STATUSES.NEEDS_REVISION
]);
export const DEFAULT_QUEUE_PAGE_SIZE = 20;

const VALID_STATUS_SET = new Set(Object.values(PLAN_STATUSES));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_KEYWORD_LENGTH = 100;

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

export class StaffReviewError extends Error {
  constructor(code, message = 'Staff review request failed.', details = []) {
    super(message);
    this.name = 'StaffReviewError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Commands the UI may offer for a Plan. Capability, state and an OPEN Round all have to
 * agree; the backend enforces the same rules again on every command (#49, #53, #54).
 */
export function getAvailableReviewCommands(plan, { canReviewPlan = false } = {}) {
  if (!canReviewPlan || !plan || plan.cycle?.status !== 'OPEN') {
    return Object.freeze([]);
  }
  return COMMANDS_BY_STATUS[plan.status] || Object.freeze([]);
}

/** Client-side check mirroring section 3.8; the server validates again. */
export function validateReviewNotes(command, rawNotes) {
  const notes = typeof rawNotes === 'string' ? rawNotes.trim() : '';
  if (command === REVIEW_COMMANDS.RETURN && notes === '') {
    return 'กรุณาระบุเหตุผลที่ส่งกลับให้นักศึกษาแก้ไข';
  }
  if (notes.length > MAX_REVIEW_NOTES_LENGTH) {
    return `ความเห็นต้องไม่เกิน ${MAX_REVIEW_NOTES_LENGTH.toLocaleString('th-TH')} ตัวอักษร`;
  }
  return null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sanitizeStudent(raw) {
  if (!isRecord(raw)) return null;
  return Object.freeze({
    id: textOrNull(raw.id),
    student_number: textOrNull(raw.student_number),
    full_name: textOrNull(raw.full_name),
    preferred_name: textOrNull(raw.preferred_name),
    department: textOrNull(raw.department),
    program: textOrNull(raw.program),
    academic_year: Number.isInteger(raw.academic_year) ? raw.academic_year : null
  });
}

function sanitizeCycle(raw) {
  if (!isRecord(raw)) return null;
  return Object.freeze({
    id: textOrNull(raw.id),
    name: textOrNull(raw.name),
    academic_year: Number.isInteger(raw.academic_year) ? raw.academic_year : null,
    semester: Number.isInteger(raw.semester) ? raw.semester : null,
    status: textOrNull(raw.status)
  });
}

function sanitizeReference(raw, labelField) {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return Object.freeze({ id: raw.id, [labelField]: textOrNull(raw[labelField]) });
}

/** Allowlists a queue item or a Plan detail (#50). Review comments never live on the Plan. */
export function sanitizeStaffPlan(raw, { includeNotes = false } = {}) {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    !UUID_PATTERN.test(raw.id) ||
    !VALID_STATUS_SET.has(raw.status) ||
    !Number.isInteger(raw.version) ||
    raw.version < 1
  ) {
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_RESPONSE);
  }
  const plan = {
    id: raw.id,
    status: raw.status,
    version: raw.version,
    created_at: textOrNull(raw.created_at),
    updated_at: textOrNull(raw.updated_at),
    cycle: sanitizeCycle(raw.cycle),
    company: sanitizeReference(raw.company, 'name'),
    position: sanitizeReference(raw.position, 'title'),
    student: sanitizeStudent(raw.student)
  };
  if (includeNotes) {
    plan.notes = textOrNull(raw.notes);
  }
  return Object.freeze(plan);
}

export function sanitizeHistoryEntry(entry) {
  if (!isRecord(entry) || typeof entry.action !== 'string') {
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_RESPONSE);
  }
  const state = (value) => (typeof value === 'string' && VALID_STATUS_SET.has(value) ? value : null);
  const role = typeof entry.actor_role === 'string' ? entry.actor_role.toUpperCase() : '';
  return Object.freeze({
    id: textOrNull(entry.event_id),
    action: entry.action,
    action_label: HISTORY_ACTION_LABELS[entry.action] || entry.action,
    from_status: state(entry.from_state),
    to_status: state(entry.to_state),
    actor_label: ACTOR_ROLE_LABELS[role] || 'ระบบ CO-ED',
    review_notes: textOrNull(entry.review_notes),
    created_at: textOrNull(entry.created_at)
  });
}

function sanitizePagination(raw, fallbackPage, fallbackPageSize, itemCount) {
  const integer = (value, fallback) => (Number.isInteger(value) && value >= 0 ? value : fallback);
  const page = integer(raw?.page, fallbackPage);
  const pageSize = integer(raw?.pageSize, fallbackPageSize);
  const total = integer(raw?.total, itemCount);
  const totalPages = integer(raw?.totalPages, total === 0 ? 0 : Math.ceil(total / Math.max(pageSize, 1)));
  return Object.freeze({ page, pageSize, total, totalPages });
}

function buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix, query) {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.CONFIGURATION);
  }
  try {
    const baseUrl = new URL(apiBaseUrl, currentOrigin);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${pathSuffix}`;
    baseUrl.search = query ? new URLSearchParams(query).toString() : '';
    baseUrl.hash = '';
    return baseUrl.href;
  } catch {
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.CONFIGURATION);
  }
}

function assertPlanId(planId) {
  if (typeof planId !== 'string' || !UUID_PATTERN.test(planId)) {
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.NOT_FOUND);
  }
  return planId.toLowerCase();
}

/** Maps the shared error contract (#55, sections 3.6 and 3.8) to UI error codes. */
async function parseErrorResponse(response, { isCommand }) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const errorCode = payload?.error?.code;
  const rawDetails = payload?.error?.details;
  const details = Array.isArray(rawDetails) ? rawDetails : isRecord(rawDetails) ? [rawDetails] : [];

  switch (response.status) {
    case 401:
      return new StaffReviewError(STAFF_REVIEW_ERROR_CODES.SESSION_EXPIRED);
    case 403:
      return new StaffReviewError(
        isCommand ? STAFF_REVIEW_ERROR_CODES.COMMAND_FORBIDDEN : STAFF_REVIEW_ERROR_CODES.NOT_IN_SCOPE
      );
    case 404:
      return new StaffReviewError(STAFF_REVIEW_ERROR_CODES.NOT_FOUND);
    case 409:
      return new StaffReviewError(
        errorCode === 'IDEMPOTENCY_KEY_REUSED'
          ? STAFF_REVIEW_ERROR_CODES.IDEMPOTENCY_KEY_REUSED
          : STAFF_REVIEW_ERROR_CODES.STALE_RECORD_CONFLICT,
        'Conflict.',
        details
      );
    case 422:
      return new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_STATE_TRANSITION, 'Invalid transition.', details);
    case 400:
      return new StaffReviewError(STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', details);
    default:
      return new StaffReviewError(STAFF_REVIEW_ERROR_CODES.SERVICE_UNAVAILABLE);
  }
}

export function createStaffReviewClient({
  apiBaseUrl,
  getAccessToken,
  fetchImpl = window.fetch.bind(window),
  currentOrigin = window.location.origin
} = {}) {
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.CONFIGURATION);
  }
  // Fail fast on a bad configuration
  buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/staff/review-queue');

  async function requestToken() {
    try {
      const token = await getAccessToken();
      if (typeof token === 'string' && token.trim() !== '') {
        return token;
      }
    } catch {
      // Fall through to the same session-expired outcome
    }
    throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.SESSION_EXPIRED);
  }

  async function requestJson(pathSuffix, { method = 'GET', query, body, signal } = {}) {
    const url = buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix, query);
    const headers = { Accept: 'application/json', Authorization: `Bearer ${await requestToken()}` };
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
      throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.SERVICE_UNAVAILABLE);
    }
    if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
      throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_RESPONSE);
    }
    if (!response.ok) {
      throw await parseErrorResponse(response, { isCommand: method !== 'GET' });
    }
    try {
      return await response.json();
    } catch {
      throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_RESPONSE);
    }
  }

  return Object.freeze({
    async getReviewQueue({ page = 1, pageSize = DEFAULT_QUEUE_PAGE_SIZE, status = null, keyword = '', signal } = {}) {
      const query = {
        page: String(Number.isInteger(page) && page >= 1 ? page : 1),
        pageSize: String(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : DEFAULT_QUEUE_PAGE_SIZE)
      };
      if (status && REVIEW_QUEUE_STATUSES.includes(status)) query.status = status;
      const trimmed = typeof keyword === 'string' ? keyword.trim().slice(0, MAX_KEYWORD_LENGTH) : '';
      if (trimmed) query.q = trimmed;

      const payload = await requestJson('/api/v3/staff/review-queue', { query, signal });
      if (!Array.isArray(payload?.data)) {
        throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_RESPONSE);
      }
      const items = Object.freeze(payload.data.map((item) => sanitizeStaffPlan(item)));
      return Object.freeze({
        items,
        pagination: sanitizePagination(payload.pagination, Number(query.page), Number(query.pageSize), items.length)
      });
    },

    /** Loads the Plan and its history together so the page always shows one consistent version. */
    async getPlanWithHistory(planId, { signal } = {}) {
      const id = encodeURIComponent(assertPlanId(planId));
      const [planPayload, historyPayload] = await Promise.all([
        requestJson(`/api/v3/staff/plans/${id}`, { signal }),
        requestJson(`/api/v3/staff/plans/${id}/history`, { signal })
      ]);
      if (!Array.isArray(historyPayload?.data)) {
        throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.INVALID_RESPONSE);
      }
      return Object.freeze({
        plan: sanitizeStaffPlan(planPayload?.data, { includeNotes: true }),
        history: Object.freeze(historyPayload.data.map(sanitizeHistoryEntry))
      });
    },

    /**
     * Sends one review command. The caller owns operationId and must reuse it when retrying
     * the same command with the same notes after a network failure (#52 section 9).
     */
    async runReviewCommand({ planId, command, expectedVersion, operationId, reviewNotes, signal } = {}) {
      if (!Object.values(REVIEW_COMMANDS).includes(command)) {
        throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR, 'Unknown review command.');
      }
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR, 'Missing Plan version.');
      }
      if (typeof operationId !== 'string' || operationId.trim() === '') {
        throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR, 'Missing operation id.');
      }
      const notesError = validateReviewNotes(command, reviewNotes);
      if (notesError) {
        throw new StaffReviewError(STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR, notesError, [{ field: 'review_notes' }]);
      }

      const body = { expected_version: expectedVersion, operation_id: operationId };
      const notes = typeof reviewNotes === 'string' ? reviewNotes.trim() : '';
      // start-review takes no notes; approve notes are optional (section 3.8)
      if (command !== REVIEW_COMMANDS.START_REVIEW && notes !== '') {
        body.review_notes = notes;
      }

      const payload = await requestJson(
        `/api/v3/plans/${encodeURIComponent(assertPlanId(planId))}/${command}`,
        { method: 'POST', body, signal }
      );
      return Object.freeze({
        status: payload?.data?.status ?? null,
        version: payload?.data?.version ?? null,
        idempotentReplay: Boolean(payload?.data?.idempotent_replay)
      });
    }
  });
}
