/**
 * Advisor assigned-scope, read-only client for CO-ED V3 (#75).
 * Uses only the GET routes of the Advisor read API (#68, contract section 3.11):
 * - GET /api/v3/advisor/students                    assigned Students (paginated)
 * - GET /api/v3/advisor/students/:studentId         one assigned Student
 * - GET /api/v3/advisor/students/:studentId/plans   that Student's Plans (paginated)
 * - GET /api/v3/advisor/plans/:planId               one Plan in assigned scope
 * The client has no method that sends a mutation; the backend also rejects them (#62).
 */

export const ADVISOR_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  // 403 and 404 both mean "not in your scope": the API never reveals whether it exists (#68)
  NOT_IN_SCOPE: 'NOT_IN_SCOPE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
});

// Workflow states from #54
export const ADVISOR_PLAN_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'APPROVED',
  'CANCELLED', 'REJECTED'
]);

// Response allowlists mirror src/api/services/advisor-read-serializers.js (#53, #68)
export const ADVISOR_STUDENT_FIELDS = Object.freeze([
  'id',
  'student_number',
  'full_name',
  'preferred_name',
  'department',
  'program',
  'major',
  'academic_year',
  'enrollment_status'
]);

export const ADVISOR_PLAN_SUMMARY_FIELDS = Object.freeze([
  'id',
  'cycle_id',
  'company',
  'position',
  'status',
  'updated_at'
]);

export const ADVISOR_PLAN_DETAIL_FIELDS = Object.freeze([
  ...ADVISOR_PLAN_SUMMARY_FIELDS,
  'notes',
  'version',
  'created_at'
]);

export const DEFAULT_ADVISOR_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN_STATUS_SET = new Set(ADVISOR_PLAN_STATUSES);

export class AdvisorClientError extends Error {
  constructor(code, message = 'Advisor request failed.') {
    super(message);
    this.name = 'AdvisorClientError';
    this.code = code;
  }
}

function invalidResponse() {
  return new AdvisorClientError(ADVISOR_ERROR_CODES.INVALID_RESPONSE);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pickPublicReference(value, labelField) {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }
  const label = textOrNull(value[labelField]);
  return label ? Object.freeze({ id: value.id, [labelField]: label }) : null;
}

export function sanitizeAdvisorStudent(raw) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !UUID_PATTERN.test(raw.id)) {
    throw invalidResponse();
  }
  const student = {};
  for (const field of ADVISOR_STUDENT_FIELDS) {
    student[field] = raw[field] === undefined ? null : raw[field];
  }
  return Object.freeze(student);
}

function sanitizePlanCommon(raw) {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    !UUID_PATTERN.test(raw.id) ||
    !PLAN_STATUS_SET.has(raw.status)
  ) {
    throw invalidResponse();
  }
  return {
    id: raw.id,
    cycle_id: textOrNull(raw.cycle_id),
    company: pickPublicReference(raw.company, 'name'),
    position: pickPublicReference(raw.position, 'title'),
    status: raw.status,
    updated_at: textOrNull(raw.updated_at)
  };
}

export function sanitizeAdvisorPlanSummary(raw) {
  return Object.freeze(sanitizePlanCommon(raw));
}

export function sanitizeAdvisorPlanDetail(raw) {
  const plan = sanitizePlanCommon(raw);
  return Object.freeze({
    ...plan,
    notes: textOrNull(raw.notes),
    version: Number.isInteger(raw.version) ? raw.version : null,
    created_at: textOrNull(raw.created_at)
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

function normalizePage(value) {
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function normalizePageSize(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE ? value : DEFAULT_ADVISOR_PAGE_SIZE;
}

function assertUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    // Same outcome as an out-of-scope id: nothing is requested and nothing is revealed
    throw new AdvisorClientError(ADVISOR_ERROR_CODES.NOT_IN_SCOPE);
  }
  return value.toLowerCase();
}

function buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix, query) {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new AdvisorClientError(ADVISOR_ERROR_CODES.CONFIGURATION);
  }
  try {
    const baseUrl = new URL(apiBaseUrl, currentOrigin);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${pathSuffix}`;
    baseUrl.search = query ? new URLSearchParams(query).toString() : '';
    baseUrl.hash = '';
    return baseUrl.href;
  } catch {
    throw new AdvisorClientError(ADVISOR_ERROR_CODES.CONFIGURATION);
  }
}

/** Maps the shared error contract (#55) to UI error codes. */
function mapErrorStatus(status) {
  switch (status) {
    case 401:
      return new AdvisorClientError(ADVISOR_ERROR_CODES.SESSION_EXPIRED);
    case 403:
    case 404:
      return new AdvisorClientError(ADVISOR_ERROR_CODES.NOT_IN_SCOPE);
    case 400:
      return new AdvisorClientError(ADVISOR_ERROR_CODES.VALIDATION_ERROR);
    default:
      return new AdvisorClientError(ADVISOR_ERROR_CODES.SERVICE_UNAVAILABLE);
  }
}

export function createAdvisorClient({
  apiBaseUrl,
  getAccessToken,
  fetchImpl = window.fetch.bind(window),
  currentOrigin = window.location.origin
} = {}) {
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new AdvisorClientError(ADVISOR_ERROR_CODES.CONFIGURATION);
  }
  // Fail fast on a bad configuration
  buildApiUrl(apiBaseUrl, currentOrigin, '/api/v3/advisor/students');

  async function requestToken() {
    try {
      const token = await getAccessToken();
      if (typeof token === 'string' && token.trim() !== '') {
        return token;
      }
    } catch {
      // Fall through to the same session-expired outcome
    }
    throw new AdvisorClientError(ADVISOR_ERROR_CODES.SESSION_EXPIRED);
  }

  // GET only: this client cannot express a mutation
  async function getJson(pathSuffix, { query, signal } = {}) {
    const url = buildApiUrl(apiBaseUrl, currentOrigin, pathSuffix, query);
    const headers = { Accept: 'application/json', Authorization: `Bearer ${await requestToken()}` };

    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', headers, signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new AdvisorClientError(ADVISOR_ERROR_CODES.SERVICE_UNAVAILABLE);
    }
    if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
      throw invalidResponse();
    }
    if (!response.ok) {
      throw mapErrorStatus(response.status);
    }
    try {
      return await response.json();
    } catch {
      throw invalidResponse();
    }
  }

  async function getList(pathSuffix, sanitizeItem, { page, pageSize, signal } = {}) {
    const requestedPage = normalizePage(page);
    const requestedPageSize = normalizePageSize(pageSize);
    const payload = await getJson(pathSuffix, {
      query: { page: String(requestedPage), pageSize: String(requestedPageSize) },
      signal
    });
    if (!Array.isArray(payload?.data)) {
      throw invalidResponse();
    }
    const items = Object.freeze(payload.data.map(sanitizeItem));
    return Object.freeze({
      items,
      pagination: sanitizePagination(payload.pagination, requestedPage, requestedPageSize, items.length)
    });
  }

  return Object.freeze({
    listStudents({ page, pageSize, signal } = {}) {
      return getList('/api/v3/advisor/students', sanitizeAdvisorStudent, { page, pageSize, signal });
    },

    async getStudent(studentId, { signal } = {}) {
      const id = assertUuid(studentId);
      const payload = await getJson(`/api/v3/advisor/students/${encodeURIComponent(id)}`, { signal });
      return sanitizeAdvisorStudent(payload?.data);
    },

    async listStudentPlans(studentId, { page, pageSize, signal } = {}) {
      const id = assertUuid(studentId);
      return getList(`/api/v3/advisor/students/${encodeURIComponent(id)}/plans`, sanitizeAdvisorPlanSummary, {
        page,
        pageSize,
        signal
      });
    },

    async getPlan(planId, { signal } = {}) {
      const id = assertUuid(planId);
      const payload = await getJson(`/api/v3/advisor/plans/${encodeURIComponent(id)}`, { signal });
      return sanitizeAdvisorPlanDetail(payload?.data);
    }
  });
}
