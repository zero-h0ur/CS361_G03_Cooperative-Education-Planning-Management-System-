/** #74: scoped GET-only Staff search client. The server owns scope/order/totals. */
import { normalizeStaffFilters, STAFF_PLAN_STATES } from './staff-route-state.js';

export const STAFF_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION', SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCESS_DENIED: 'ACCESS_DENIED', VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE', SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
});
export class StaffClientError extends Error {
  constructor(code, details = []) {
    super('ไม่สามารถอ่านข้อมูล Staff ได้');
    this.name = 'StaffClientError';
    this.code = code;
    // Field names are enough for UI errors; never retain echoed search payloads.
    this.details = Array.isArray(details) ? details.filter((item) => typeof item?.field === 'string')
      .map(({ field }) => ({ field, issue: 'กรุณาตรวจสอบค่าที่ระบุ' })) : [];
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new StaffClientError(STAFF_ERROR_CODES.INVALID_RESPONSE);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
function id(value) { if (!UUID.test(value || '')) throw invalid(); return value; }
function text(value) { if (value == null) return null; if (typeof value !== 'string') throw invalid(); return value; }
function year(value) { if (!Number.isInteger(value) || value < 2500 || value > 2700) throw invalid(); return value; }
function timestamp(value) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(); return value; }
function semester(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1) throw invalid();
  return value;
}

export function sanitizeStaffStudent(raw) {
  if (!record(raw)) throw invalid();
  return Object.freeze({
    id: id(raw.id), student_number: text(raw.student_number), full_name: text(raw.full_name),
    preferred_name: text(raw.preferred_name), department: text(raw.department), program: text(raw.program),
    major: text(raw.major), academic_year: year(raw.academic_year), enrollment_status: text(raw.enrollment_status)
  });
}
function publicReference(raw, label) {
  if (raw == null) return null;
  if (!record(raw)) throw invalid();
  return Object.freeze({ id: id(raw.id), [label]: text(raw[label]) });
}
export function sanitizeStaffPlan(raw) {
  if (!record(raw) || !record(raw.student) || !record(raw.cycle) ||
      !STAFF_PLAN_STATES.includes(raw.status) || !Number.isSafeInteger(raw.version) || raw.version < 1) throw invalid();
  return Object.freeze({
    id: id(raw.id), status: raw.status, version: raw.version,
    created_at: timestamp(raw.created_at), updated_at: timestamp(raw.updated_at),
    cycle: Object.freeze({ id: id(raw.cycle.id), name: text(raw.cycle.name),
      academic_year: year(raw.cycle.academic_year), semester: semester(raw.cycle.semester),
      status: ['OPEN', 'CLOSED'].includes(raw.cycle.status) ? raw.cycle.status : (() => { throw invalid(); })() }),
    company: publicReference(raw.company, 'name'), position: publicReference(raw.position, 'title'),
    student: Object.freeze({ id: id(raw.student.id), student_number: text(raw.student.student_number),
      full_name: text(raw.student.full_name), preferred_name: text(raw.student.preferred_name),
      department: text(raw.student.department), program: text(raw.student.program),
      academic_year: year(raw.student.academic_year) })
  });
}
function pagination(raw, filters, count) {
  if (!record(raw) || raw.page !== filters.page || raw.pageSize !== filters.pageSize ||
      !Number.isSafeInteger(raw.total) || raw.total < 0 ||
      raw.totalPages !== Math.ceil(raw.total / raw.pageSize) || count > filters.pageSize || count > raw.total ||
      (filters.page > raw.totalPages && count !== 0)) throw invalid();
  return Object.freeze({ page: raw.page, pageSize: raw.pageSize, total: raw.total, totalPages: raw.totalPages });
}

export function createStaffClient({ apiBaseUrl, getAccessToken,
  fetchImpl = window.fetch.bind(window), currentOrigin = window.location.origin } = {}) {
  if (typeof apiBaseUrl !== 'string' || !apiBaseUrl.trim() ||
      typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new StaffClientError(STAFF_ERROR_CODES.CONFIGURATION);
  }
  let base;
  try { base = new URL(apiBaseUrl, currentOrigin); } catch { throw new StaffClientError(STAFF_ERROR_CODES.CONFIGURATION); }
  async function search(mode, { signal, ...raw } = {}) {
    const filters = normalizeStaffFilters(mode, raw);
    const url = new URL(base.href);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v3/staff/${mode}`;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) { if (value !== '') query.set(key, String(value)); }
    url.search = query.toString(); url.hash = '';
    let token;
    try { token = await getAccessToken(); } catch { throw new StaffClientError(STAFF_ERROR_CODES.SESSION_EXPIRED); }
    if (typeof token !== 'string' || !token.trim()) throw new StaffClientError(STAFF_ERROR_CODES.SESSION_EXPIRED);
    let response;
    try {
      response = await fetchImpl(url.href, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new StaffClientError(STAFF_ERROR_CODES.SERVICE_UNAVAILABLE);
    }
    if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) throw invalid();
    if (!response.ok) {
      if (response.status === 401) throw new StaffClientError(STAFF_ERROR_CODES.SESSION_EXPIRED);
      if (response.status === 403) throw new StaffClientError(STAFF_ERROR_CODES.ACCESS_DENIED);
      if (response.status === 400) {
        let errorPayload;
        try { errorPayload = await response.json(); } catch { /* Do not expose raw response text. */ }
        throw new StaffClientError(STAFF_ERROR_CODES.VALIDATION_ERROR, errorPayload?.error?.details);
      }
      throw new StaffClientError(STAFF_ERROR_CODES.SERVICE_UNAVAILABLE);
    }
    let payload;
    try { payload = await response.json(); } catch { throw invalid(); }
    if (!Array.isArray(payload?.data)) throw invalid();
    const items = Object.freeze(payload.data.map(mode === 'students' ? sanitizeStaffStudent : sanitizeStaffPlan));
    return Object.freeze({ items, pagination: pagination(payload.pagination, filters, items.length) });
  }
  return Object.freeze({ searchStudents: (options) => search('students', options), searchPlans: (options) => search('plans', options) });
}
