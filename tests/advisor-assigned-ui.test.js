/** @jest-environment jsdom */

const {
  ADVISOR_ERROR_CODES,
  ADVISOR_PLAN_STATUSES,
  createAdvisorClient
} = require('../tmp/frontend-test-modules/advisor/advisor-client.cjs');
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');

const API = 'https://api.example.com';
const ORIGIN = 'https://app.example.com';
const STUDENT_A = '40000000-0000-4000-8000-000000000101';
const STUDENT_B = '40000000-0000-4000-8000-000000000102';
const OUTSIDE_STUDENT = '40000000-0000-4000-8000-000000000199';
const PLAN_A = '50000000-0000-4000-8000-000000000101';
const OUTSIDE_PLAN = '50000000-0000-4000-8000-000000000199';

// Row shapes follow src/api/services/advisor-read-serializers.js plus fields that must never
// reach the UI even if a future API leaks them.
function studentRow(overrides = {}) {
  return {
    id: STUDENT_A,
    student_number: 'TEST000001',
    full_name: 'สมชาย ใจดี',
    preferred_name: 'ชาย',
    department: 'Computer Science',
    program: 'B.Sc.',
    major: 'Computer Science',
    academic_year: 2569,
    enrollment_status: 'ACTIVE',
    institutional_email: 'leak-student@example.ac.th',
    ...overrides
  };
}

function planRow(overrides = {}) {
  return {
    id: PLAN_A,
    cycle_id: '30000000-0000-4000-8000-000000000101',
    company: { id: '10000000-0000-4000-8000-000000000001', name: 'Example Tech Co.' },
    position: { id: '20000000-0000-4000-8000-000000000001', title: 'Software Engineer Intern' },
    status: 'UNDER_REVIEW',
    updated_at: '2026-10-04T13:00:00.000Z',
    notes: 'สนใจงานพัฒนาเว็บ',
    version: 3,
    created_at: '2026-10-01T10:00:00.000Z',
    review_notes: 'leak-review-comment',
    operation_id: 'leak-operation-id',
    ...overrides
  };
}

function json(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

const forbidden = () => json(403, { error: { code: 'FORBIDDEN', message: 'Access denied.' } });

/**
 * In-memory Advisor read API (#68): assigned scope only, generic 403 for anything outside it,
 * 405 for any non-GET method, and pagination metadata.
 */
function createFakeBackend({
  students = [studentRow(), studentRow({ id: STUDENT_B, student_number: 'TEST000002', full_name: 'สมหญิง เรียนดี', preferred_name: null })],
  plansByStudent = { [STUDENT_A]: [planRow()], [STUDENT_B]: [] },
  override
} = {}) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method || 'GET';
    calls.push({ method, pathname, query: Object.fromEntries(searchParams), auth: init.headers?.Authorization || null });

    const overridden = override?.({ method, pathname, searchParams });
    if (overridden) return overridden;
    if (method !== 'GET') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'x' } });

    const page = Number(searchParams.get('page') || 1);
    const pageSize = Number(searchParams.get('pageSize') || 10);
    const paginate = (items) => json(200, {
      data: items.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total: items.length, totalPages: items.length === 0 ? 0 : Math.ceil(items.length / pageSize) }
    });

    if (pathname === '/api/v3/advisor/students') return paginate(students);
    let match = pathname.match(/^\/api\/v3\/advisor\/students\/([^/]+)\/plans$/);
    if (match) return plansByStudent[match[1]] ? paginate(plansByStudent[match[1]]) : forbidden();
    match = pathname.match(/^\/api\/v3\/advisor\/students\/([^/]+)$/);
    if (match) {
      const student = students.find((row) => row.id === match[1]);
      return student ? json(200, { data: student }) : forbidden();
    }
    match = pathname.match(/^\/api\/v3\/advisor\/plans\/([^/]+)$/);
    if (match) {
      const plan = Object.values(plansByStudent).flat().find((row) => row.id === match[1]);
      return plan ? json(200, { data: plan }) : forbidden();
    }
    return json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'x' } });
  });
  return { fetchImpl, calls };
}

function createClient(backend, getAccessToken = async () => 'advisor-token') {
  return createAdvisorClient({ apiBaseUrl: API, currentOrigin: ORIGIN, getAccessToken, fetchImpl: backend.fetchImpl });
}

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mountAdvisorPage(backend, { hash = '#/advisor/students', role = 'ADVISOR' } = {}) {
  document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
  window.sessionStorage.clear();
  const root = document.getElementById('authenticatedApp');
  const location = { pathname: '/app.html', search: '', hash };
  const eventTarget = new EventTarget();
  const app = createShellApp({
    root,
    loadSession: jest.fn().mockResolvedValue({ role }),
    startLogin: jest.fn(),
    restartLogin: jest.fn(),
    logout: jest.fn(),
    location,
    eventTarget,
    storage: window.sessionStorage,
    advisorClient: createClient(backend)
  });
  await app.start();
  await flush(10);

  async function navigate(nextHash) {
    location.hash = nextHash;
    eventTarget.dispatchEvent(new Event('hashchange'));
    await flush(10);
  }
  return { app, root, location, navigate };
}

const MUTATION_LABEL_PATTERN = /ส่งแผน|อนุมัติ|ส่งกลับ|เริ่มตรวจ|แก้ไข|บันทึก|ลบ|approve|return|submit|start review|edit|save|delete/i;

function expectNoMutationControls(root) {
  expect(root.querySelector('form, input, textarea, select, [contenteditable="true"]')).toBeNull();
  for (const control of root.querySelectorAll('.shell-content button')) {
    expect(control.textContent).not.toMatch(MUTATION_LABEL_PATTERN);
  }
}

describe('Issue #75: Advisor read-only client (contract #68)', () => {
  it('lists assigned Students with GET, a Bearer token and pagination, through the allowlist', async () => {
    const backend = createFakeBackend();
    const result = await createClient(backend).listStudents({ page: 1, pageSize: 20 });

    expect(backend.calls).toEqual([
      { method: 'GET', pathname: '/api/v3/advisor/students', query: { page: '1', pageSize: '20' }, auth: 'Bearer advisor-token' }
    ]);
    expect(result.items.map((student) => student.id)).toEqual([STUDENT_A, STUDENT_B]);
    expect(result.items[0]).not.toHaveProperty('institutional_email');
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  it('drops review comments and operation ids from Plan detail', async () => {
    const plan = await createClient(createFakeBackend()).getPlan(PLAN_A);

    expect(Object.keys(plan).sort()).toEqual(
      ['company', 'created_at', 'cycle_id', 'id', 'notes', 'position', 'status', 'updated_at', 'version'].sort()
    );
    expect(JSON.stringify(plan)).not.toContain('leak');
  });

  it('exposes read methods only', () => {
    expect(Object.keys(createClient(createFakeBackend())).sort()).toEqual(
      ['getPlan', 'getStudent', 'listStudentPlans', 'listStudents']
    );
  });

  it.each([
    [401, ADVISOR_ERROR_CODES.SESSION_EXPIRED],
    [403, ADVISOR_ERROR_CODES.NOT_IN_SCOPE],
    [404, ADVISOR_ERROR_CODES.NOT_IN_SCOPE],
    [400, ADVISOR_ERROR_CODES.VALIDATION_ERROR],
    [500, ADVISOR_ERROR_CODES.SERVICE_UNAVAILABLE],
    [503, ADVISOR_ERROR_CODES.SERVICE_UNAVAILABLE]
  ])('maps HTTP %i to %s', async (status, code) => {
    const backend = createFakeBackend({ override: () => json(status, { error: { code: 'X', message: 'x' } }) });
    await expect(createClient(backend).getStudent(STUDENT_A)).rejects.toMatchObject({ code });
  });

  it('maps a network failure to SERVICE_UNAVAILABLE and a missing token to SESSION_EXPIRED', async () => {
    const backend = createFakeBackend();
    backend.fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(createClient(backend).listStudents()).rejects.toMatchObject({ code: ADVISOR_ERROR_CODES.SERVICE_UNAVAILABLE });
    await expect(createClient(backend, async () => '').listStudents()).rejects.toMatchObject({ code: ADVISOR_ERROR_CODES.SESSION_EXPIRED });
  });

  it('rejects a malformed id without sending a request', async () => {
    const backend = createFakeBackend();
    await expect(createClient(backend).getPlan('../staff/review-queue')).rejects.toMatchObject({ code: ADVISOR_ERROR_CODES.NOT_IN_SCOPE });
    expect(backend.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Issue #75: Advisor assigned-student and Plan pages', () => {
  it('shows a loading status before the list arrives', async () => {
    let release;
    const backend = createFakeBackend();
    const realFetch = backend.fetchImpl.getMockImplementation();
    backend.fetchImpl.mockImplementationOnce((url, init) => new Promise((resolve) => {
      release = () => resolve(realFetch(url, init));
    }));
    const { root } = await mountAdvisorPage(backend);

    expect(root.querySelector('[data-role="advisor-loading"][role="status"]')).not.toBeNull();
    release();
    await flush(10);
    expect(root.querySelector('[data-role="advisor-loading"]')).toBeNull();
  });

  it('lists only the Students returned by the assigned-scope API, as keyboard-reachable links', async () => {
    const { root } = await mountAdvisorPage(createFakeBackend());

    const links = [...root.querySelectorAll('[data-role="advisor-student-list"] a')];
    expect(links.map((anchor) => anchor.getAttribute('href'))).toEqual([
      `#/advisor/students/${STUDENT_A}`,
      `#/advisor/students/${STUDENT_B}`
    ]);
    expect(links[0].textContent).toBe('สมชาย ใจดี (ชาย)');
    expect(root.querySelector('[data-role="advisor-student-list"]').tabIndex).toBe(0);
    expect(root.querySelector('[data-role="advisor-readonly-badge"]')).not.toBeNull();
    expect(root.textContent).not.toContain('leak-student@example.ac.th');
    expectNoMutationControls(root);
  });

  it('shows a no-assignment state', async () => {
    const { root } = await mountAdvisorPage(createFakeBackend({ students: [] }));
    expect(root.querySelector('[data-role="advisor-no-assignment"]').textContent).toContain('ยังไม่มีนักศึกษาที่ได้รับมอบหมาย');
  });

  it('pages through the assigned list', async () => {
    const students = Array.from({ length: 25 }, (_, index) =>
      studentRow({ id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, student_number: `TEST${String(index + 1).padStart(6, '0')}` })
    );
    const backend = createFakeBackend({ students });
    const { root } = await mountAdvisorPage(backend);

    expect(root.querySelectorAll('[data-role="advisor-student-list"] tbody tr')).toHaveLength(20);
    const next = [...root.querySelectorAll('.advisor-pager button')].find((control) => control.textContent === 'หน้าถัดไป');
    next.click();
    await flush(10);

    expect(backend.calls.at(-1).query).toEqual({ page: '2', pageSize: '20' });
    expect(root.querySelectorAll('[data-role="advisor-student-list"] tbody tr')).toHaveLength(5);
    expect(root.querySelector('.advisor-pager__status').textContent).toContain('หน้า 2 จาก 2');
  });

  it('opens a Student and their Plans from the list, keeping the parent menu highlighted', async () => {
    const { root, navigate } = await mountAdvisorPage(createFakeBackend());
    await navigate(`#/advisor/students/${STUDENT_A}`);

    expect(root.querySelector('[data-field="student_number"]').textContent).toBe('TEST000001');
    expect(root.querySelector('[data-field="academic_year"]').textContent).toBe('2569');
    const planLink = root.querySelector('[data-role="advisor-plan-list"] a');
    expect(planLink.getAttribute('href')).toBe(`#/advisor/plans/${PLAN_A}`);
    expect(root.querySelector('[data-role="advisor-plan-list"]').textContent).toContain('Example Tech Co.');

    const navLink = root.querySelector('.shell-nav__link');
    expect(navLink.classList.contains('shell-nav__link--active')).toBe(true);
    expect(navLink.hasAttribute('aria-current')).toBe(false);
    expectNoMutationControls(root);
  });

  it('shows an empty Plan state for an assigned Student without Plans', async () => {
    const { root } = await mountAdvisorPage(createFakeBackend(), { hash: `#/advisor/students/${STUDENT_B}` });
    expect(root.querySelector('[data-role="advisor-no-plans"]')).not.toBeNull();
  });

  it.each(ADVISOR_PLAN_STATUSES)('renders a %s Plan read-only with no workflow or edit controls', async (status) => {
    const backend = createFakeBackend({ plansByStudent: { [STUDENT_A]: [planRow({ status })] } });
    const { root } = await mountAdvisorPage(backend, { hash: `#/advisor/plans/${PLAN_A}` });

    expect(root.querySelector('.advisor-workspace').dataset.readonly).toBe('true');
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain(status);
    expect(root.querySelector('[data-role="advisor-readonly-notice"]')).not.toBeNull();
    expect(root.querySelector('[data-field="company"]').textContent).toBe('Example Tech Co.');
    expect(root.textContent).not.toContain('leak');
    expectNoMutationControls(root);
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it.each([
    ['an unassigned Student', `#/advisor/students/${OUTSIDE_STUDENT}`],
    ['a Plan outside the assigned scope', `#/advisor/plans/${OUTSIDE_PLAN}`]
  ])('shows the same safe message for direct navigation to %s', async (_label, hash) => {
    const { root } = await mountAdvisorPage(createFakeBackend(), { hash });

    const card = root.querySelector('[data-role="advisor-not-in-scope"]');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.textContent).toContain('ไม่อยู่ในขอบเขตนักศึกษาที่คุณได้รับมอบหมาย');
    expect(card.querySelector('a').getAttribute('href')).toBe('#/advisor/students');
    expect(root.textContent).not.toContain('สมชาย');
  });

  it('treats a 404 exactly like a 403 so existence is not revealed', async () => {
    const notFound = createFakeBackend({ override: () => json(404, { error: { code: 'RECORD_NOT_FOUND', message: 'x' } }) });
    const { root } = await mountAdvisorPage(notFound, { hash: `#/advisor/plans/${OUTSIDE_PLAN}` });
    const notFoundText = root.querySelector('[data-role="advisor-not-in-scope"]').textContent;

    const { root: forbiddenRoot } = await mountAdvisorPage(createFakeBackend(), { hash: `#/advisor/plans/${OUTSIDE_PLAN}` });
    expect(forbiddenRoot.querySelector('[data-role="advisor-not-in-scope"]').textContent).toBe(notFoundText);
  });

  it('denies a malformed detail id in the shell without calling the API', async () => {
    const backend = createFakeBackend();
    const { root } = await mountAdvisorPage(backend, { hash: '#/advisor/students/not-a-uuid' });

    expect(root.textContent).toContain('ไม่พบ Route นี้ในรายการที่ระบบอนุญาต');
    expect(backend.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['STUDENT', 'STAFF'])('denies Advisor detail routes to %s without calling the API', async (role) => {
    const backend = createFakeBackend();
    const { root } = await mountAdvisorPage(backend, { hash: `#/advisor/plans/${PLAN_A}`, role });

    expect(root.textContent).toContain('ไม่มีสิทธิ์เข้าถึง');
    expect(backend.fetchImpl).not.toHaveBeenCalled();
  });

  it('hands a 403 on the list to the shell forbidden state', async () => {
    const { root } = await mountAdvisorPage(createFakeBackend({ override: forbidden }));
    expect(root.textContent).toContain('ไม่มีสิทธิ์อ่านรายชื่อนักศึกษาในฐานะอาจารย์ที่ปรึกษา');
  });

  it('clears data and shows the expired-session alert on 401', async () => {
    const backend = createFakeBackend({
      override: ({ pathname }) => (pathname.endsWith('/plans') ? json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }) : null)
    });
    const { root } = await mountAdvisorPage(backend, { hash: `#/advisor/students/${STUDENT_A}` });

    expect(root.textContent).toContain('Session หมดอายุ');
    expect(root.textContent).not.toContain('TEST000001');
  });

  it('offers a retry after a service failure', async () => {
    let failing = true;
    const backend = createFakeBackend({
      override: () => (failing ? json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }) : null)
    });
    const { root } = await mountAdvisorPage(backend);

    const errorCard = root.querySelector('[data-role="advisor-load-error"]');
    expect(errorCard.getAttribute('role')).toBe('alert');
    failing = false;
    errorCard.querySelector('button').click();
    await flush(10);

    expect(root.querySelector('[data-role="advisor-student-list"]')).not.toBeNull();
  });
});
