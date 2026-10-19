/** @jest-environment jsdom */

const {
  PLAN_STATUSES,
  STUDENT_PLAN_ERROR_CODES,
  createStudentPlanClient,
  evaluatePlanReadiness
} = require('../tmp/frontend-test-modules/student/plan-submission-client.cjs');
const {
  createShellApp
} = require('../tmp/frontend-test-modules/shell-app.cjs');

const API = 'https://api.example.com';
const ORIGIN = 'https://app.example.com';
const CYCLE_ID = '30000000-0000-4000-8000-000000000101';
const COMPANY_ID = '10000000-0000-4000-8000-000000000001';
const POSITION_ID = '20000000-0000-4000-8000-000000000001';
const PLAN_ID = '50000000-0000-4000-8000-000000000105';

// Plan shape returned by GET /api/v3/plans (#66, contract section 3.7)
function planRow(overrides = {}) {
  return {
    id: PLAN_ID,
    cycle_id: CYCLE_ID,
    company_id: COMPANY_ID,
    position_id: POSITION_ID,
    notes: 'สนใจงานพัฒนาเว็บ',
    status: PLAN_STATUSES.DRAFT,
    version: 1,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...overrides
  };
}

function historyRow(overrides = {}) {
  return {
    event_id: '91000000-0000-4000-8000-000000000001',
    action: 'PLAN_CREATED',
    from_state: null,
    to_state: PLAN_STATUSES.DRAFT,
    actor_role: 'STUDENT',
    review_notes: null,
    created_at: '2026-10-01T10:00:00.000Z',
    ...overrides
  };
}

function json(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/**
 * In-memory backend that follows the V3 contracts (sections 3.7, 3.9, 3.10):
 * version check, idempotent operation_id replay and server-side history.
 */
function createFakeBackend({ plans = [planRow()], history = [historyRow()], submitOverride } = {}) {
  const state = { plans: plans.map((plan) => ({ ...plan })), history: [...history], operations: new Map() };
  const calls = [];

  const fetchImpl = jest.fn(async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, pathname, body, auth: init.headers?.Authorization || null, query: searchParams.toString() });

    if (method === 'GET' && pathname === '/api/v3/plans') {
      return json(200, { data: state.plans, pagination: { page: 1, pageSize: 100, total: state.plans.length, totalPages: 1 } });
    }
    const historyMatch = pathname.match(/^\/api\/v3\/plans\/([^/]+)\/history$/);
    if (method === 'GET' && historyMatch) {
      return json(200, { data: state.history.filter(() => true) });
    }
    // Public V2 directory: company detail has no positions; positions have their own route
    if (method === 'GET' && pathname === `/api/companies/${COMPANY_ID}`) {
      return json(200, { data: { id: COMPANY_ID, name: 'Mock Analytics Lab' } });
    }
    if (method === 'GET' && pathname === `/api/positions/${POSITION_ID}`) {
      return json(200, { data: { id: POSITION_ID, company_id: COMPANY_ID, title: 'นักพัฒนาเว็บ' } });
    }
    const submitMatch = pathname.match(/^\/api\/v3\/plans\/([^/]+)\/submit$/);
    if (method === 'POST' && submitMatch) {
      if (submitOverride) return submitOverride(body, state);
      const plan = state.plans.find((item) => item.id === submitMatch[1]);
      const prior = state.operations.get(body.operation_id);
      if (prior) return json(200, { data: { ...prior, idempotent_replay: true } });
      if (!['DRAFT', 'NEEDS_REVISION'].includes(plan.status)) {
        return json(422, { error: { code: 'INVALID_STATE_TRANSITION', message: 'x' } });
      }
      if (plan.version !== body.expected_version) {
        return json(409, { error: { code: 'STALE_RECORD_CONFLICT', message: 'x', details: { expectedVersion: body.expected_version, currentVersion: plan.version } } });
      }
      const from = plan.status;
      Object.assign(plan, { status: PLAN_STATUSES.SUBMITTED, version: plan.version + 1, updated_at: '2026-10-02T10:00:00.000Z' });
      state.history.push(historyRow({
        event_id: `91000000-0000-4000-8000-00000000000${state.history.length + 1}`,
        action: 'PLAN_SUBMITTED',
        from_state: from,
        to_state: PLAN_STATUSES.SUBMITTED,
        created_at: '2026-10-02T10:00:00.000Z'
      }));
      const result = { id: plan.id, status: plan.status, version: plan.version, idempotent_replay: false };
      state.operations.set(body.operation_id, result);
      return json(200, { data: result });
    }
    return json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' } });
  });

  return { fetchImpl, calls, state };
}

function createClient(backend) {
  return createStudentPlanClient({
    apiBaseUrl: API,
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
    fetchImpl: backend.fetchImpl,
    currentOrigin: ORIGIN
  });
}

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mountPlanPage(backend) {
  document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
  window.sessionStorage.clear();
  const root = document.getElementById('authenticatedApp');
  const app = createShellApp({
    root,
    loadSession: jest.fn().mockResolvedValue({ role: 'STUDENT' }),
    startLogin: jest.fn(),
    restartLogin: jest.fn(),
    logout: jest.fn(),
    location: { pathname: '/app.html', search: '', hash: '#/student/plan' },
    eventTarget: new EventTarget(),
    storage: window.sessionStorage,
    studentPlanClient: createClient(backend)
  });
  await app.start();
  await flush(10);
  return { app, root };
}

const submitButton = (root) => root.querySelector('[data-role="submit-plan-button"]');
const submitCalls = (backend) => backend.calls.filter((call) => call.method === 'POST');

describe('Issue #76: Student Plan submission client (contract)', () => {
  it('evaluates readiness from cycle/company/position and submittable states (#52, #54)', () => {
    expect(evaluatePlanReadiness(planRow()).canSubmit).toBe(true);
    expect(evaluatePlanReadiness(planRow({ status: PLAN_STATUSES.NEEDS_REVISION })).canSubmit).toBe(true);

    const missing = evaluatePlanReadiness(planRow({ position_id: null }));
    expect(missing.canSubmit).toBe(false);
    expect(missing.missingFields.map((field) => field.field)).toEqual(['position_id']);

    for (const status of [PLAN_STATUSES.SUBMITTED, PLAN_STATUSES.UNDER_REVIEW, PLAN_STATUSES.APPROVED, PLAN_STATUSES.CANCELLED]) {
      const readiness = evaluatePlanReadiness(planRow({ status }));
      expect(readiness.canSubmit).toBe(false);
      expect(readiness.isReadOnly).toBe(true);
    }
  });

  it('loads the newest non-cancelled own Plan, its history and public display names', async () => {
    const backend = createFakeBackend({
      plans: [planRow({ id: '50000000-0000-4000-8000-000000000999', status: 'CANCELLED' }), planRow()],
      history: [historyRow({ actor_id: 'must-not-leak', operation_id: 'must-not-leak' })]
    });

    const bundle = await createClient(backend).getOwnPlan();

    expect(bundle.plan.id).toBe(PLAN_ID);
    expect(bundle.plan.company_name).toBe('Mock Analytics Lab');
    expect(bundle.plan.position_title).toBe('นักพัฒนาเว็บ');
    expect(JSON.stringify(bundle.statusHistory)).not.toContain('must-not-leak');
    expect(backend.calls.map((call) => `${call.method} ${call.pathname}`)).toEqual(expect.arrayContaining([
      'GET /api/v3/plans',
      `GET /api/v3/plans/${PLAN_ID}/history`,
      `GET /api/companies/${COMPANY_ID}`,
      `GET /api/positions/${POSITION_ID}`
    ]));
    // Protected endpoints carry the Access Token; the public directory does not
    expect(backend.calls.find((call) => call.pathname === '/api/v3/plans').auth).toBe('Bearer access-token');
    expect(backend.calls.find((call) => call.pathname.startsWith('/api/companies')).auth).toBeNull();
  });

  it('resolves no Plan when the Student has none yet', async () => {
    const bundle = await createClient(createFakeBackend({ plans: [] })).getOwnPlan();
    expect(bundle.plan).toBeNull();
  });

  it('submits with { expected_version, operation_id } only (#69 contract)', async () => {
    const backend = createFakeBackend();
    const result = await createClient(backend).submitPlan({
      planId: PLAN_ID, expectedVersion: 1, operationId: '92000000-0000-4000-8000-000000000001'
    });
    expect(result.status).toBe(PLAN_STATUSES.SUBMITTED);
    expect(submitCalls(backend)[0].body).toEqual({
      expected_version: 1,
      operation_id: '92000000-0000-4000-8000-000000000001'
    });
  });

  it.each([
    [422, 'INVALID_STATE_TRANSITION', STUDENT_PLAN_ERROR_CODES.INVALID_STATE_TRANSITION],
    [409, 'STALE_RECORD_CONFLICT', STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT],
    [409, 'IDEMPOTENCY_KEY_REUSED', STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT],
    [400, 'VALIDATION_ERROR', STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR],
    [401, 'UNAUTHORIZED', STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED],
    [403, 'FORBIDDEN', STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED],
    [503, 'SERVICE_UNAVAILABLE', STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE]
  ])('maps HTTP %i %s to %s', async (status, code, expected) => {
    const backend = createFakeBackend({ submitOverride: () => json(status, { error: { code, message: 'x' } }) });
    await expect(createClient(backend).submitPlan({
      planId: PLAN_ID, expectedVersion: 1, operationId: '92000000-0000-4000-8000-000000000001'
    })).rejects.toMatchObject({ code: expected });
  });
});

describe('Issue #76: Student Plan submission UI', () => {
  it('groups the real plan into four labelled, illustrated sections with a preliminary readiness notice', async () => {
    const backend = createFakeBackend();
    const { app, root } = await mountPlanPage(backend);
    const cards = root.querySelectorAll('.student-plan-workspace .student-card--illustrated:not(.plan-editor)');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.querySelector('.student-card__icon svg').getAttribute('aria-hidden')).toBe('true');
      expect(card.querySelector('.student-card__body h2').id).toBe(card.getAttribute('aria-labelledby'));
    }
    const notice = root.querySelector('[data-role="plan-submit-readiness"]');
    expect(notice.classList.contains('student-plan-submit__readiness--ready')).toBe(true);
    expect(notice.textContent).toContain('ข้อมูลเบื้องต้น');
    expect(notice.textContent).toContain('ตรวจสอบรอบรับสมัครและข้อมูลอีกครั้ง');
    expect(root.querySelector('[data-role="submit-plan-button"]').getAttribute('aria-describedby'))
      .toBe(root.querySelector('[data-role="plan-submit-hint"]').id);
    expect(submitCalls(backend)).toHaveLength(0);
    expect(root.querySelector('.plan-editor.student-card--illustrated')).not.toBeNull();
    app.destroy();
  });

  it.each(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CANCELLED'])('does not imply a locked %s plan is ready to submit', async (status) => {
    const backend = createFakeBackend({ plans: [planRow({ status })] });
    const { app, root } = await mountPlanPage(backend);
    const notice = root.querySelector('[data-role="plan-submit-readiness"]');
    expect(notice.classList.contains('student-plan-submit__readiness--neutral')).toBe(true);
    expect(notice.textContent).toContain('อ่านอย่างเดียว');
    expect(notice.textContent).not.toContain('พร้อมส่งตรวจ');
    expect(submitButton(root).disabled).toBe(true);
    expect(submitCalls(backend)).toHaveLength(0);
    app.destroy();
  });

  it('shows history timestamps in Thai while retaining machine-readable instants', async () => {
    const { app, root } = await mountPlanPage(createFakeBackend());
    const time = root.querySelector('.student-plan-history time');
    expect(time.getAttribute('datetime')).toBe('2026-10-01T10:00:00.000Z');
    expect(time.textContent).toContain('2569');
    expect(time.textContent).toContain('17:00');
    expect(time.textContent).not.toContain('T10:00:00');
    app.destroy();
  });

  it('renders notes and return reasons as plain text inside the redesigned cards', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { app, root } = await mountPlanPage(createFakeBackend({
      plans: [planRow({ status: 'NEEDS_REVISION', notes: payload })],
      history: [historyRow({ action: 'PLAN_RETURNED', review_notes: payload })]
    }));
    expect(root.querySelector('[data-plan-field="notes"]').textContent).toBe(payload);
    expect(root.querySelector('[data-role="plan-return-reason"]').textContent).toContain(payload);
    expect(root.querySelector('.student-plan-workspace img')).toBeNull();
    app.destroy();
  });

  it('disables submit and lists missing fields for an incomplete DRAFT', async () => {
    const backend = createFakeBackend({ plans: [planRow({ company_id: null, position_id: null })] });
    const { root } = await mountPlanPage(backend);

    expect(submitButton(root).disabled).toBe(true);
    expect(root.querySelector('[data-role="plan-missing-fields"]').textContent).toContain('สถานประกอบการ');
    expect(root.querySelector('[data-role="plan-submit-readiness"]').classList
      .contains('student-plan-submit__readiness--warning')).toBe(true);
  });

  it('submits once while in flight, then refreshes state and history from the server and locks the Plan', async () => {
    const backend = createFakeBackend();
    const { root } = await mountPlanPage(backend);

    expect(root.querySelector('[data-plan-field="company_display"]').textContent).toBe('Mock Analytics Lab');
    const form = submitButton(root).closest('form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);

    expect(submitCalls(backend)).toHaveLength(1);
    // Server state was re-read after submit (list + history requested again)
    expect(backend.calls.filter((call) => call.pathname === '/api/v3/plans')).toHaveLength(2);
    expect(root.querySelector('[data-role="plan-current-status"]').textContent).toContain('SUBMITTED');
    expect(root.querySelector('.student-plan-workspace').dataset.planReadonly).toBe('true');
    expect(submitButton(root).disabled).toBe(true);
    expect(root.querySelector('[data-role="plan-history-list"]').textContent).toContain('ส่งแผน');
  });

  it('shows the latest return reason from history on NEEDS_REVISION and allows re-submit', async () => {
    const backend = createFakeBackend({
      plans: [planRow({ status: PLAN_STATUSES.NEEDS_REVISION, version: 3 })],
      history: [historyRow({
        action: 'PLAN_RETURNED',
        from_state: 'UNDER_REVIEW',
        to_state: 'NEEDS_REVISION',
        actor_role: 'STAFF',
        review_notes: 'กรุณาแนบหนังสือตอบรับ'
      })]
    });
    const { root } = await mountPlanPage(backend);

    expect(root.querySelector('[data-role="plan-return-reason"]').textContent).toContain('กรุณาแนบหนังสือตอบรับ');
    expect(submitButton(root).disabled).toBe(false);
  });

  it('never shows a false success on 409 and reloads the latest server Plan on demand', async () => {
    const backend = createFakeBackend({
      submitOverride: () => json(409, { error: { code: 'STALE_RECORD_CONFLICT', message: 'x' } })
    });
    const { root } = await mountPlanPage(backend);

    submitButton(root).closest('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);

    const feedback = root.querySelector('[data-role="plan-submit-feedback"]');
    expect(feedback.textContent).not.toContain('เรียบร้อยแล้ว');
    expect(root.querySelector('[data-role="plan-current-status"]').textContent).toContain('DRAFT');

    feedback.querySelector('button').click();
    await flush(20);
    expect(backend.calls.filter((call) => call.pathname === '/api/v3/plans')).toHaveLength(2);
  });

  it('reuses the same operation_id when retrying after a network failure', async () => {
    let attempt = 0;
    const backend = createFakeBackend();
    const realFetch = backend.fetchImpl.getMockImplementation();
    backend.fetchImpl.mockImplementation(async (url, init = {}) => {
      if ((init.method || 'GET') === 'POST') {
        attempt += 1;
        backend.calls.push({ method: 'POST', body: JSON.parse(init.body) });
        if (attempt === 1) throw new TypeError('Failed to fetch');
        backend.calls.pop();
      }
      return realFetch(url, init);
    });
    const { root } = await mountPlanPage(backend);
    const form = submitButton(root).closest('form');

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);
    expect(root.querySelector('[data-role="plan-submit-feedback"]').textContent).toContain('ไม่สำเร็จ');

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);

    const posts = submitCalls(backend);
    expect(posts).toHaveLength(2);
    expect(posts[1].body.operation_id).toBe(posts[0].body.operation_id);
    expect(root.querySelector('[data-role="plan-current-status"]').textContent).toContain('SUBMITTED');
  });

  it('shows a state message on 422 without claiming success', async () => {
    const backend = createFakeBackend({
      submitOverride: () => json(422, { error: { code: 'INVALID_STATE_TRANSITION', message: 'x' } })
    });
    const { root } = await mountPlanPage(backend);

    submitButton(root).closest('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);

    const feedback = root.querySelector('[data-role="plan-submit-feedback"]').textContent;
    expect(feedback).toContain('สถานะของแผนสหกิจในปัจจุบันไม่อนุญาต');
    expect(feedback).not.toContain('เรียบร้อยแล้ว');
  });

  it('clears private Plan data and shows the expired-session alert when submit returns 401', async () => {
    const backend = createFakeBackend({
      submitOverride: () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })
    });
    const { root } = await mountPlanPage(backend);

    submitButton(root).closest('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);

    expect(root.textContent).toContain('Session หมดอายุ');
    expect(root.textContent).not.toContain('Mock Analytics Lab');
    expect(root.textContent).not.toContain('สนใจงานพัฒนาเว็บ');
  });

  it('shows an empty state when the Student has no Plan', async () => {
    const { root } = await mountPlanPage(createFakeBackend({ plans: [] }));
    expect(root.querySelector('[data-role="plan-empty"]').textContent).toContain('ยังไม่มีแผนสหกิจศึกษา');
  });
});
