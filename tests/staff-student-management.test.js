/** @jest-environment jsdom */
const { createStaffClient } = require('../tmp/frontend-test-modules/staff/staff-client.cjs');
const { normalizeStaffFilters, parseStaffRouteState, serializeStaffRouteState } = require('../tmp/frontend-test-modules/staff/staff-route-state.cjs');
const { renderStaffStudentManagementView } = require('../tmp/frontend-test-modules/staff/staff-student-management-view.cjs');
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');
const { getRoute, canRoleAccessRoute } = require('../tmp/frontend-test-modules/routes.cjs');

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let controllers = [];
function fakeClient(overrides = {}) {
  return { searchStudents: jest.fn(async ({ page: p, pageSize }) => page([student], { page: p, pageSize })),
    searchPlans: jest.fn(async ({ page: p, pageSize }) => page([plan], { page: p, pageSize })), ...overrides };
}
async function mount({ mode = 'students', initialFilters = {}, ...overrides } = {}) {
  document.body.replaceChildren();
  const controller = new AbortController(); controllers.push(controller);
  const client = fakeClient(overrides);
  const hooks = { onSessionExpired: jest.fn(), onAccessDenied: jest.fn(), onRouteStateChange: jest.fn() };
  const root = renderStaffStudentManagementView({ mode, initialFilters, staffClient: client, signal: controller.signal, ...hooks });
  document.body.append(root); await flush();
  return { root, client, hooks, controller };
}
function value(root, name, text) { root.querySelector(`[name="${name}"]`).value = text; }
function submit(root) { root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
function click(root, label) { [...root.querySelectorAll('button')].find((item) => item.textContent === label).click(); }
afterEach(() => { controllers.forEach((item) => item.abort()); controllers = []; });

describe('Issue #74 Staff list UI', () => {
  test('submits keyword/year filters with page 1 and keeps keyword out of route and storage', async () => {
    const { root, client, hooks } = await mount();
    window.localStorage.clear(); window.sessionStorage.clear();
    value(root, 'q', 'PRIVATE STUDENT'); value(root, 'academic_year', '2569'); submit(root); await flush();
    expect(client.searchStudents).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'PRIVATE STUDENT', academic_year: '2569', page: 1 }));
    expect(hooks.onRouteStateChange.mock.calls.at(-1)[0]).toBe('#/staff/students?academic_year=2569');
    expect(window.localStorage.length).toBe(0); expect(window.sessionStorage.length).toBe(0);
    expect(root.querySelector('[data-role="staff-result-summary"]').textContent).toContain('1 รายการ');
    expect(root.textContent).not.toContain('hidden@student');
  });
  test('Plan sort/filter changes reset page 1; page controls retain the applied filters', async () => {
    const searchPlans = jest.fn(async ({ page: p, pageSize }) => page([plan], { page: p, pageSize, total: 21, totalPages: 2 }));
    const { root } = await mount({ mode: 'plans', initialFilters: { page: 2 }, searchPlans });
    value(root, 'status', 'SUBMITTED'); value(root, 'sort', 'created_at');
    root.querySelector('[name="sort"]').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(searchPlans).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUBMITTED', sort: 'created_at', page: 1 }));
    click(root, 'หน้าถัดไป'); await flush();
    expect(searchPlans).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUBMITTED', sort: 'created_at', page: 2 }));
    click(root, 'หน้าก่อนหน้า'); await flush();
    expect(searchPlans.mock.calls.at(-1)[0].page).toBe(1);
  });
  test('page size and clearing controls use API pagination, without client sorting', async () => {
    const { root, client } = await mount({ mode: 'plans' });
    value(root, 'pageSize', '50');
    root.querySelector('[name="pageSize"]').dispatchEvent(new Event('change', { bubbles: true })); await flush();
    expect(client.searchPlans).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }));
    value(root, 'q', 'discard'); click(root, 'ล้างตัวกรอง'); await flush();
    expect(client.searchPlans).toHaveBeenLastCalledWith(expect.objectContaining({ q: '', pageSize: 20, status: '', page: 1 }));
    expect(root.querySelector('[name="q"]').value).toBe('');
  });
  test('invalid BE year displays an associated error and focuses the field without a request', async () => {
    const { root, client } = await mount();
    value(root, 'academic_year', '2026'); submit(root);
    const input = root.querySelector('[name="academic_year"]');
    expect(client.searchStudents).toHaveBeenCalledTimes(1);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toContain('พ.ศ.');
    for (const field of root.querySelectorAll('input, select')) expect(root.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
  });
  test('ignores a superseded result and 403 even when the old request ignores abort', async () => {
    let rejectOld;
    const searchStudents = jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValue(page([{ ...student, full_name: 'ผลล่าสุด' }]));
    const { root, hooks } = await mount({ searchStudents });
    expect(root.getAttribute('aria-busy')).toBe('true');
    value(root, 'q', 'new'); submit(root); await flush();
    rejectOld({ code: 'ACCESS_DENIED' }); await flush();
    expect(root.textContent).toContain('ผลล่าสุด'); expect(hooks.onAccessDenied).not.toHaveBeenCalled();
    expect(root.getAttribute('aria-busy')).toBe('false');
  });
  test.each([['SESSION_EXPIRED', 'onSessionExpired'], ['ACCESS_DENIED', 'onAccessDenied']])
    ('clears previous private summaries on %s', async (code, hook) => {
      const searchStudents = jest.fn().mockResolvedValueOnce(page([student])).mockRejectedValueOnce({ code });
      const { root, hooks } = await mount({ searchStudents });
      submit(root); await flush();
      expect(root.textContent).not.toContain(student.full_name);
      expect(hooks[hook]).toHaveBeenCalledTimes(1);
      expect(root.querySelector('[data-role="staff-result-summary"]').textContent).toBe('');
    });
  test('shows empty and recoverable unavailable states without keeping stale records', async () => {
    const searchStudents = jest.fn().mockResolvedValueOnce(page([])).mockRejectedValueOnce({ code: 'SERVICE_UNAVAILABLE' })
      .mockResolvedValueOnce(page([student]));
    const { root } = await mount({ searchStudents });
    expect(root.textContent).toContain('ไม่พบข้อมูลตามตัวกรอง');
    submit(root); await flush(); expect(root.querySelector('[role="alert"]').textContent).toContain('โหลดข้อมูลไม่สำเร็จ');
    click(root, 'ลองอีกครั้ง'); await flush(); expect(root.textContent).toContain(student.full_name);
  });
  test('server 400 links safe field errors and preserves form text', async () => {
    const { root } = await mount({ searchStudents: jest.fn(async () => { throw { code: 'VALIDATION_ERROR', details: [{ field: 'academic_year', issue: 'ตรวจสอบปีการศึกษา' }] }; }) });
    expect(root.querySelector('[name="academic_year"]').getAttribute('aria-invalid')).toBe('true');
    expect(root.textContent).toContain('ตัวกรองไม่ถูกต้อง');
  });
  test('Plan summary links the guarded #77 handoff and never renders mutation controls or protected fields', async () => {
    const malicious = { ...plan, student: { ...student, full_name: '<img src=x onerror=alert(1)>' } };
    const { root } = await mount({ mode: 'plans', searchPlans: jest.fn(async () => page([malicious])) });
    expect(root.querySelector(`a[href="#/staff/review/${PLAN_ID}"]`)).not.toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img');
    expect(root.textContent).toContain('ไม่เปิดเผยชื่อสถานประกอบการ');
    expect(root.textContent).not.toContain('private notes');
    expect(root.textContent).not.toContain('private review');
    expect([...root.querySelectorAll('button')].some((item) => ['อนุมัติ', 'เริ่มตรวจ', 'ส่งกลับแก้ไข'].includes(item.textContent))).toBe(false);
  });
  test('abort on route exit prevents late results from changing the disposed view', async () => {
    let resolve;
    const { root, controller } = await mount({ searchStudents: jest.fn(() => new Promise((done) => { resolve = done; })) });
    controller.abort(); resolve(page([student])); await flush();
    expect(root.textContent).not.toContain(student.full_name);
  });
});

async function shell({ role = 'STAFF', hash = '#/staff/students', loadSession, client = fakeClient() } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app');
  const history = { replaceState: jest.fn() };
  const app = createShellApp({ root, loadSession: loadSession || (async () => ({ role })), startLogin: jest.fn(), restartLogin: jest.fn(),
    logout: jest.fn(), location: { pathname: '/app.html', hash }, eventTarget: new EventTarget(), storage: window.sessionStorage,
    history, staffClient: client });
  await app.start(); await flush();
  return { root, app, history, client };
}
describe('Issue #74 protected route integration', () => {
  test.each(['STUDENT', 'ADVISOR', 'ADMIN'])('denies %s before making any Staff request', async (role) => {
    const { root, app, client } = await shell({ role });
    expect(root.textContent).toContain('ไม่มีสิทธิ์เข้าถึง');
    expect(client.searchStudents).not.toHaveBeenCalled(); app.destroy();
  });
  test('waits for session check before rendering Student records or calling Staff API', async () => {
    let resolve;
    const deferred = new Promise((done) => { resolve = done; });
    const client = fakeClient();
    const pending = shell({ loadSession: () => deferred, client });
    expect(document.body.textContent).toContain('กำลังตรวจสอบ Session');
    expect(client.searchStudents).not.toHaveBeenCalled();
    resolve({ role: 'STAFF' }); const { app } = await pending;
    expect(client.searchStudents).toHaveBeenCalledTimes(1); app.destroy();
  });
  test('restores safe URL filters and rewrites history without Student search text', async () => {
    const { root, app, client, history } = await shell({ hash: '#/staff/plans?academic_year=2569&status=SUBMITTED&sort=created_at&order=asc' });
    expect(client.searchPlans).toHaveBeenCalledWith(expect.objectContaining({ academic_year: '2569', status: 'SUBMITTED', sort: 'created_at', order: 'asc' }));
    value(root, 'q', 'PRIVATE NAME'); submit(root); await flush();
    expect(JSON.stringify(history.replaceState.mock.calls)).not.toContain('PRIVATE');
    expect(root.querySelector('.shell-nav__link--active').getAttribute('href')).toBe('#/staff/plans'); app.destroy();
  });
  test('validates review UUID, keeps handoff Staff-only and performs no detail/mutation request', async () => {
    const { root, client, app } = await shell({ hash: `#/staff/review/${PLAN_ID}` });
    expect(root.textContent).toContain('Issue #77');
    expect(root.querySelector('[data-role="staff-review-handoff"]')).not.toBeNull();
    expect(client.searchPlans).not.toHaveBeenCalled();
    expect(root.querySelector('.staff-review-handoff button')).toBeNull();
    expect(canRoleAccessRoute('ADVISOR', `#/staff/review/${PLAN_ID}`)).toBe(false);
    expect(getRoute('#/staff/review/not-a-uuid')).toBeNull(); app.destroy();
  });
  test.each(['#/staff/students?q=PRIVATE', '#/staff/plans?status=UNKNOWN', '#/staff/students?page=1&page=2', '#/staff/plans?access_token=secret'])
    ('rejects unsupported route state: %s', (hash) => { expect(getRoute(hash)).toBeNull(); });
});
