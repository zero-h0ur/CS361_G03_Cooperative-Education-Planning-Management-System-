/** @jest-environment jsdom */
const { createStaffClient } = require('../tmp/frontend-test-modules/staff/staff-client.cjs');
const { normalizeStaffFilters, parseStaffRouteState, serializeStaffRouteState } = require('../tmp/frontend-test-modules/staff/staff-route-state.cjs');

const STUDENT_ID = '40000000-0000-4000-8000-000000000101';
const PLAN_ID = '50000000-0000-4000-8000-000000000101';
const student = { id: STUDENT_ID, student_number: 'TEST000001', full_name: 'นักศึกษา ทดสอบ',
  preferred_name: 'ทดสอบ', department: 'CPE', program: 'CPE', major: 'Computer Engineering',
  academic_year: 2569, enrollment_status: 'ACTIVE', institutional_email: 'hidden@student.example.com',
  user_id: 'private', notes: 'private', external_subject: 'private' };
const plan = { id: PLAN_ID, status: 'SUBMITTED', version: 2,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
  cycle: { id: '30000000-0000-4000-8000-000000000101', name: 'รอบ 1', academic_year: 2569, semester: 1, status: 'OPEN', secret: 'hidden' },
  company: { id: '10000000-0000-4000-8000-000000000001', name: null }, position: null,
  student: { ...student }, notes: 'private notes', review_notes: 'private review', actor_id: 'private' };
const json = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
function page(items, overrides = {}) {
  return { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...overrides } };
}
function payload(items, overrides) { const result = page(items, overrides); return { data: result.items, pagination: result.pagination }; }
function api(fetchImpl, token = async () => 'ACCESS_TOKEN') {
  return createStaffClient({ apiBaseUrl: 'https://api.example.com/base', currentOrigin: 'https://app.example.com',
    getAccessToken: token, fetchImpl });
}

describe('Issue #74 Staff filter and client contracts', () => {
  test('serializes only safe filters to the hash and restores validated state', () => {
    const state = normalizeStaffFilters('plans', { q: 'PRIVATE STUDENT', academic_year: '2569', status: 'SUBMITTED',
      page: 3, pageSize: 50, sort: 'student_number', order: 'asc' });
    const hash = serializeStaffRouteState('plans', state);
    expect(hash).not.toContain('PRIVATE');
    expect(hash).not.toContain('q=');
    expect(hash).not.toContain('page=3');
    const restored = parseStaffRouteState('plans', hash.split('?')[1]);
    expect(restored).toEqual(expect.objectContaining({ q: '', page: 1, pageSize: 50, academic_year: '2569', status: 'SUBMITTED' }));
  });
  test.each(['q=name', 'student_id=abc', 'page=1&page=2', 'academic_year=2026', 'pageSize=101', 'status=UNKNOWN'])
    ('rejects unsupported or invalid URL state: %s', (query) => {
      expect(() => parseStaffRouteState('plans', query)).toThrow();
    });
  test('does not send unsupported Student sorting and validates keyword length', () => {
    expect(() => normalizeStaffFilters('students', { sort: 'full_name' })).toThrow();
    expect(() => normalizeStaffFilters('students', { q: 'x'.repeat(101) })).toThrow();
    expect(() => normalizeStaffFilters('students', { page: 'Infinity' })).toThrow();
    expect(() => normalizeStaffFilters('students', { page: 0 })).toThrow();
  });
  test('GETs scoped Student results in server order with an explicit field allowlist', async () => {
    const second = { ...student, id: '40000000-0000-4000-8000-000000000102', student_number: 'TEST000002' };
    const fetchImpl = jest.fn(async () => json(200, payload([second, student])));
    const result = await api(fetchImpl).searchStudents({ q: ' TEST ', academic_year: '2569' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(new URL(url).pathname).toBe('/base/api/v3/staff/students');
    expect(new URL(url).searchParams.get('q')).toBe('TEST');
    expect(new URL(url).searchParams.get('sort')).toBeNull();
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer ACCESS_TOKEN' } });
    expect(result.items.map((item) => item.id)).toEqual([second.id, student.id]);
    expect(Object.keys(result.items[0])).toEqual(['id', 'student_number', 'full_name', 'preferred_name', 'department', 'program', 'major', 'academic_year', 'enrollment_status']);
    expect(JSON.stringify(result)).not.toContain('hidden@student');
  });
  test('Plan filters match #67, nested summaries omit protected fields and preserve scoped total', async () => {
    const fetchImpl = jest.fn(async () => json(200, payload([plan], { total: 21, totalPages: 2 })));
    const result = await api(fetchImpl).searchPlans({ status: 'SUBMITTED', sort: 'created_at', order: 'asc' });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get('sort')).toBe('created_at');
    expect(url.searchParams.get('status')).toBe('SUBMITTED');
    expect(result.pagination.total).toBe(21);
    expect(result.items[0].company).toEqual(plan.company);
    for (const value of ['private notes', 'private review', 'hidden@student', 'external_subject']) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
    expect(Object.keys(result.items[0].student)).toEqual(['id', 'student_number', 'full_name', 'preferred_name', 'department', 'program', 'academic_year']);
  });
  test.each([[401, 'SESSION_EXPIRED'], [403, 'ACCESS_DENIED'], [503, 'SERVICE_UNAVAILABLE']])
    ('maps %i to safe %s', async (status, code) => {
      await expect(api(jest.fn(async () => json(status, { error: { message: 'DO NOT ECHO' } }))).searchStudents())
        .rejects.toMatchObject({ code });
    });
  test('token failure sends no request; 400 retains field identifiers without echoed query', async () => {
    const fetchImpl = jest.fn(async () => json(400, { error: { details: [{ field: 'academic_year', issue: 'PRIVATE STUDENT QUERY' }] } }));
    await expect(api(fetchImpl, async () => { throw new Error('token secret'); }).searchStudents()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const error = await api(fetchImpl).searchStudents().catch((value) => value);
    expect(error.details[0].field).toBe('academic_year');
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
  });
  test.each([
    { data: [], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 999 } },
    { data: [{ ...student, id: 'bad-id' }], pagination: payload([student]).pagination },
    { data: 'not a list', pagination: payload([]).pagination }
  ])('fails closed on malformed data or pagination', async (body) => {
    await expect(api(jest.fn(async () => json(200, body))).searchStudents()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  test('supports a genuinely empty scoped list and exposes no mutation method', async () => {
    const client = api(jest.fn(async () => json(200, payload([]))));
    expect(Object.keys(client)).toEqual(['searchStudents', 'searchPlans']);
    expect((await client.searchStudents()).pagination.total).toBe(0);
  });
});
