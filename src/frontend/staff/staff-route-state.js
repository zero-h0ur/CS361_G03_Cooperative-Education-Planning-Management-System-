/** #74: the #67 search contract; only non-keyword state belongs in browser URLs. */
export const STAFF_PLAN_STATES = Object.freeze([
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'APPROVED', 'CANCELLED'
]);
const COMMON = ['page', 'pageSize', 'academic_year'];
const PLAN_ONLY = ['status', 'sort', 'order'];

export class StaffFilterError extends Error {
  constructor(field, issue) {
    super('กรุณาตรวจสอบตัวกรอง');
    this.name = 'StaffFilterError';
    this.code = 'VALIDATION_ERROR';
    this.details = [{ field, issue }];
  }
}

function integer(value, field, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value);
  const result = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new StaffFilterError(field, `ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง ${maximum}`);
  }
  return result;
}

export function normalizeStaffFilters(mode, raw = {}) {
  if (!['students', 'plans'].includes(mode)) throw new StaffFilterError('mode', 'ไม่พบหน้าค้นหานี้');
  const allowed = new Set([...COMMON, 'q', ...(mode === 'plans' ? PLAN_ONLY : [])]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new StaffFilterError(key, 'ไม่รองรับตัวกรองนี้');
  }
  const pageSize = integer(raw.pageSize, 'pageSize', 20, 100);
  const page = integer(raw.page, 'page', 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize));
  if (raw.q != null && typeof raw.q !== 'string') throw new StaffFilterError('q', 'คำค้นต้องเป็นข้อความ');
  const q = (raw.q || '').trim();
  if (q.length > 100) throw new StaffFilterError('q', 'คำค้นต้องไม่เกิน 100 ตัวอักษร');
  const academicYear = raw.academic_year == null ? '' : String(raw.academic_year).trim();
  if (academicYear && (!/^\d{4}$/.test(academicYear) || Number(academicYear) < 2500 || Number(academicYear) > 2700)) {
    throw new StaffFilterError('academic_year', 'กรุณาระบุปี พ.ศ. ระหว่าง 2500 ถึง 2700');
  }
  const result = { page, pageSize, q, academic_year: academicYear };
  if (mode === 'plans') {
    const status = raw.status || '';
    const sort = raw.sort || 'updated_at';
    const order = raw.order || 'desc';
    if (status && !STAFF_PLAN_STATES.includes(status)) throw new StaffFilterError('status', 'สถานะแผนไม่ถูกต้อง');
    if (!['updated_at', 'created_at', 'student_number'].includes(sort)) throw new StaffFilterError('sort', 'ไม่รองรับการเรียงนี้');
    if (!['asc', 'desc'].includes(order)) throw new StaffFilterError('order', 'ลำดับไม่ถูกต้อง');
    Object.assign(result, { status, sort, order });
  }
  return Object.freeze(result);
}

export function parseStaffRouteState(mode, search = '') {
  const params = new URLSearchParams(search);
  const allowed = new Set([...COMMON, ...(mode === 'plans' ? PLAN_ONLY : [])]);
  const raw = {};
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      throw new StaffFilterError(key, 'พารามิเตอร์ไม่รองรับหรือซ้ำกัน');
    }
    raw[key] = params.get(key);
  }
  return normalizeStaffFilters(mode, raw);
}

export function serializeStaffRouteState(mode, filters) {
  const state = normalizeStaffFilters(mode, filters);
  const params = new URLSearchParams();
  // Keyword results cannot be reconstructed without the keyword. Their URL
  // points to page 1 instead of persisting an unrelated later page after reload.
  if (!state.q && state.page !== 1) params.set('page', String(state.page));
  if (state.pageSize !== 20) params.set('pageSize', String(state.pageSize));
  if (state.academic_year) params.set('academic_year', state.academic_year);
  if (mode === 'plans') {
    if (state.status) params.set('status', state.status);
    if (state.sort !== 'updated_at') params.set('sort', state.sort);
    if (state.order !== 'desc') params.set('order', state.order);
  }
  return `#/staff/${mode}${params.size ? `?${params}` : ''}`;
}
