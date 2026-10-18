/** @jest-environment jsdom */

const {
  MAX_REVIEW_NOTES_LENGTH,
  PLAN_STATUSES,
  REVIEW_COMMANDS,
  STAFF_REVIEW_ERROR_CODES,
  createStaffReviewClient,
  getAvailableReviewCommands,
  validateReviewNotes
} = require('../tmp/frontend-test-modules/staff/staff-review-client.cjs');
const { createAdvisorClient } = require('../tmp/frontend-test-modules/advisor/advisor-client.cjs');
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');

const API = 'https://api.example.com';
const ORIGIN = 'https://app.example.com';
const PLAN_ID = '50000000-0000-4000-8000-000000000102';
const OTHER_PLAN_ID = '50000000-0000-4000-8000-000000000104';
const OUTSIDE_PLAN_ID = '50000000-0000-4000-8000-000000000199';

// Shapes follow contract sections 3.6 (queue item) and 3.12 (detail adds notes)
function planRow(overrides = {}) {
  return {
    id: PLAN_ID,
    status: PLAN_STATUSES.SUBMITTED,
    version: 2,
    created_at: '2026-10-02T10:00:00.000Z',
    updated_at: '2026-10-03T11:00:00.000Z',
    cycle: { id: '30000000-0000-4000-8000-000000000101', name: 'รอบที่ 1 ภาคเรียนที่ 1/2569', academic_year: 2569, semester: 1, status: 'OPEN' },
    company: { id: '10000000-0000-4000-8000-000000000002', name: 'Mock Analytics Lab' },
    position: { id: '20000000-0000-4000-8000-000000000003', title: 'นักวิเคราะห์ข้อมูล' },
    student: {
      id: '40000000-0000-4000-8000-000000000102',
      student_number: 'TEST000002',
      full_name: 'วิภา จำลอง',
      preferred_name: 'วิภา',
      department: 'CPE',
      program: 'ISNE',
      academic_year: 2569
    },
    notes: 'สนใจงานวิเคราะห์ข้อมูล',
    ...overrides
  };
}

function json(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

const TRANSITIONS = Object.freeze({
  'start-review': { from: 'SUBMITTED', to: 'UNDER_REVIEW', action: 'PLAN_REVIEW_STARTED' },
  return: { from: 'UNDER_REVIEW', to: 'NEEDS_REVISION', action: 'PLAN_RETURNED' },
  approve: { from: 'UNDER_REVIEW', to: 'APPROVED', action: 'PLAN_APPROVED' }
});

/**
 * In-memory Staff API following #67, #70 and #77: scoped reads, version check,
 * operation_id replay, required return reason and server-side history.
 */
function createFakeBackend({ plans = [planRow()], history = {}, override } = {}) {
  const state = {
    plans: new Map(plans.map((plan) => [plan.id, { ...plan }])),
    history: new Map(plans.map((plan) => [plan.id, [...(history[plan.id] || [])]])),
    operations: new Map()
  };
  const calls = [];

  const fetchImpl = jest.fn(async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, pathname, query: Object.fromEntries(searchParams), body, auth: init.headers?.Authorization || null });

    const overridden = override?.({ method, pathname, body, state });
    if (overridden) return overridden;

    if (method === 'GET' && pathname === '/api/v3/staff/review-queue') {
      const items = [...state.plans.values()]
        .filter((plan) => ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION'].includes(plan.status))
        .filter((plan) => !searchParams.get('status') || plan.status === searchParams.get('status'))
        // Queue items never carry Plan notes (#50)
        .map(({ notes, ...item }) => item);
      return json(200, { data: items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 } });
    }

    let match = pathname.match(/^\/api\/v3\/staff\/plans\/([^/]+)(\/history)?$/);
    if (method === 'GET' && match) {
      const plan = state.plans.get(match[1]);
      if (!plan) return json(403, { error: { code: 'FORBIDDEN', message: 'Access denied.' } });
      return match[2] ? json(200, { data: state.history.get(plan.id) }) : json(200, { data: plan });
    }

    match = pathname.match(/^\/api\/v3\/plans\/([^/]+)\/(start-review|return|approve)$/);
    if (method === 'POST' && match) {
      const [, planId, command] = match;
      const plan = state.plans.get(planId);
      if (!plan) return json(403, { error: { code: 'FORBIDDEN', message: 'x' } });
      const fingerprint = JSON.stringify([planId, command, body.review_notes ?? null]);
      const previous = state.operations.get(body.operation_id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return json(409, { error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'x' } });
        return json(200, { data: { ...previous.result, idempotent_replay: true } });
      }
      if (command === 'return' && !(body.review_notes || '').trim()) {
        return json(400, { error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ field: 'review_notes' }] } });
      }
      if (body.expected_version !== plan.version) {
        return json(409, { error: { code: 'STALE_RECORD_CONFLICT', message: 'x', details: { expectedVersion: body.expected_version, currentVersion: plan.version } } });
      }
      const transition = TRANSITIONS[command];
      if (plan.status !== transition.from) {
        return json(422, { error: { code: 'INVALID_STATE_TRANSITION', message: 'x' } });
      }
      plan.status = transition.to;
      plan.version += 1;
      state.history.get(planId).push({
        event_id: `91000000-0000-4000-8000-${String(state.operations.size + 1).padStart(12, '0')}`,
        action: transition.action,
        from_state: transition.from,
        to_state: transition.to,
        actor_role: 'STAFF',
        review_notes: body.review_notes ?? null,
        created_at: '2026-10-05T09:00:00.000Z'
      });
      const result = { id: planId, status: plan.status, version: plan.version, idempotent_replay: false };
      state.operations.set(body.operation_id, { fingerprint, result });
      return json(200, { data: result });
    }
    return json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'x' } });
  });

  return { fetchImpl, calls, state };
}

function createClient(backend) {
  return createStaffReviewClient({ apiBaseUrl: API, currentOrigin: ORIGIN, getAccessToken: async () => 'staff-token', fetchImpl: backend.fetchImpl });
}

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mountStaff(backend, { hash = `#/staff/plans/${PLAN_ID}`, role = 'STAFF', canReviewPlan = true, advisorClient = null } = {}) {
  document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
  window.sessionStorage.clear();
  const root = document.getElementById('authenticatedApp');
  const location = { pathname: '/app.html', search: '', hash };
  const app = createShellApp({
    root,
    loadSession: jest.fn().mockResolvedValue({ role, canReviewPlan }),
    startLogin: jest.fn(),
    restartLogin: jest.fn(),
    logout: jest.fn(),
    location,
    eventTarget: new EventTarget(),
    storage: window.sessionStorage,
    staffReviewClient: createClient(backend),
    advisorClient
  });
  await app.start();
  await flush(10);
  return { app, root, location };
}

const commandButton = (root, command) => root.querySelector(`[data-role="review-commands"] [data-command="${command}"]`);
const commandNames = (root) => [...root.querySelectorAll('[data-role="review-commands"] button')].map((control) => control.dataset.command);
const posts = (backend) => backend.calls.filter((call) => call.method === 'POST');
const confirmPanel = (root) => root.querySelector('[data-role="review-confirm"]');

async function confirm(root, notes) {
  const panel = confirmPanel(root);
  const textarea = panel.querySelector('textarea');
  if (textarea && notes !== undefined) {
    textarea.value = notes;
    textarea.dispatchEvent(new Event('input'));
  }
  panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush(20);
}

// The shell's own createOperationId default uses crypto.randomUUID; jsdom provides it via Node
beforeAll(() => {
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = require('node:crypto').webcrypto;
  }
});

describe('Issue #77: Staff review client (contract #67, #70)', () => {
  it.each([
    [PLAN_STATUSES.SUBMITTED, [REVIEW_COMMANDS.START_REVIEW]],
    [PLAN_STATUSES.UNDER_REVIEW, [REVIEW_COMMANDS.APPROVE, REVIEW_COMMANDS.RETURN]],
    [PLAN_STATUSES.DRAFT, []],
    [PLAN_STATUSES.NEEDS_REVISION, []],
    [PLAN_STATUSES.APPROVED, []],
    [PLAN_STATUSES.CANCELLED, []]
  ])('offers commands for %s that match #54', (status, expected) => {
    expect(getAvailableReviewCommands(planRow({ status }), { canReviewPlan: true })).toEqual(expected);
  });

  it('offers nothing without the review capability or when the Round is not OPEN', () => {
    const plan = planRow({ status: PLAN_STATUSES.UNDER_REVIEW });
    expect(getAvailableReviewCommands(plan, { canReviewPlan: false })).toEqual([]);
    expect(getAvailableReviewCommands({ ...plan, cycle: { ...plan.cycle, status: 'CLOSED' } }, { canReviewPlan: true })).toEqual([]);
  });

  it('requires a return reason and limits notes to 2,000 characters', () => {
    expect(validateReviewNotes(REVIEW_COMMANDS.RETURN, '   ')).toContain('กรุณาระบุเหตุผล');
    expect(validateReviewNotes(REVIEW_COMMANDS.APPROVE, '')).toBeNull();
    expect(validateReviewNotes(REVIEW_COMMANDS.APPROVE, 'x'.repeat(MAX_REVIEW_NOTES_LENGTH + 1))).toContain('2,000');
  });

  it('reads the queue with filters and a Bearer token, and never keeps notes on queue items', async () => {
    const backend = createFakeBackend();
    const result = await createClient(backend).getReviewQueue({ status: 'SUBMITTED', keyword: ' TEST0000 ' });

    expect(backend.calls[0]).toMatchObject({
      method: 'GET',
      pathname: '/api/v3/staff/review-queue',
      query: { page: '1', pageSize: '20', status: 'SUBMITTED', q: 'TEST0000' },
      auth: 'Bearer staff-token'
    });
    expect(result.items[0]).not.toHaveProperty('notes');
  });

  it.each([
    [REVIEW_COMMANDS.START_REVIEW, '  ignored  ', { expected_version: 2, operation_id: 'op-x' }],
    [REVIEW_COMMANDS.RETURN, '  แนบหนังสือตอบรับ  ', { expected_version: 2, operation_id: 'op-x', review_notes: 'แนบหนังสือตอบรับ' }],
    [REVIEW_COMMANDS.APPROVE, '', { expected_version: 2, operation_id: 'op-x' }]
  ])('sends the %s body from section 3.8', async (command, reviewNotes, expectedBody) => {
    const backend = createFakeBackend({ override: () => json(200, { data: { status: 'X', version: 3 } }) });
    await createClient(backend).runReviewCommand({ planId: PLAN_ID, command, expectedVersion: 2, operationId: 'op-x', reviewNotes });
    expect(posts(backend)[0]).toMatchObject({ pathname: `/api/v3/plans/${PLAN_ID}/${command}`, body: expectedBody });
  });

  it('refuses an empty return reason without sending anything', async () => {
    const backend = createFakeBackend();
    await expect(createClient(backend).runReviewCommand({
      planId: PLAN_ID, command: REVIEW_COMMANDS.RETURN, expectedVersion: 2, operationId: 'op-x', reviewNotes: ' '
    })).rejects.toMatchObject({ code: STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR });
    expect(backend.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'X', STAFF_REVIEW_ERROR_CODES.SESSION_EXPIRED],
    [403, 'FORBIDDEN', STAFF_REVIEW_ERROR_CODES.COMMAND_FORBIDDEN],
    [404, 'RECORD_NOT_FOUND', STAFF_REVIEW_ERROR_CODES.NOT_FOUND],
    [409, 'STALE_RECORD_CONFLICT', STAFF_REVIEW_ERROR_CODES.STALE_RECORD_CONFLICT],
    [409, 'IDEMPOTENCY_KEY_REUSED', STAFF_REVIEW_ERROR_CODES.IDEMPOTENCY_KEY_REUSED],
    [422, 'INVALID_STATE_TRANSITION', STAFF_REVIEW_ERROR_CODES.INVALID_STATE_TRANSITION],
    [400, 'VALIDATION_ERROR', STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR],
    [503, 'SERVICE_UNAVAILABLE', STAFF_REVIEW_ERROR_CODES.SERVICE_UNAVAILABLE]
  ])('maps a command %i %s to %s', async (status, code, expected) => {
    const backend = createFakeBackend({ override: () => json(status, { error: { code, message: 'x' } }) });
    await expect(createClient(backend).runReviewCommand({
      planId: PLAN_ID, command: REVIEW_COMMANDS.START_REVIEW, expectedVersion: 2, operationId: 'op-x'
    })).rejects.toMatchObject({ code: expected });
  });

  it('maps a 403 on a read to NOT_IN_SCOPE', async () => {
    await expect(createClient(createFakeBackend()).getPlanWithHistory(OUTSIDE_PLAN_ID))
      .rejects.toMatchObject({ code: STAFF_REVIEW_ERROR_CODES.NOT_IN_SCOPE });
  });
});

describe('Issue #77: Staff review queue page', () => {
  it('lists pending Plans with keyboard-reachable links', async () => {
    const backend = createFakeBackend({ plans: [planRow(), planRow({ id: OTHER_PLAN_ID, status: 'NEEDS_REVISION' }), planRow({ id: OUTSIDE_PLAN_ID, status: 'APPROVED' })] });
    const { root } = await mountStaff(backend, { hash: '#/staff/review' });

    const links = [...root.querySelectorAll('[data-role="staff-queue-list"] a')].map((anchor) => anchor.getAttribute('href'));
    expect(links).toEqual([`#/staff/plans/${PLAN_ID}`, `#/staff/plans/${OTHER_PLAN_ID}`]);
    expect(root.querySelector('[data-role="staff-queue-list"]').tabIndex).toBe(0);
    // The queue itself has no workflow controls
    expect(root.querySelector('[data-role="review-commands"]')).toBeNull();
  });

  it('applies the status filter and keyword through the API', async () => {
    const backend = createFakeBackend();
    const { root } = await mountStaff(backend, { hash: '#/staff/review' });

    root.querySelector('#staff-queue-status').value = 'UNDER_REVIEW';
    root.querySelector('#staff-queue-keyword').value = 'วิภา';
    root.querySelector('.staff-queue-filter').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(10);

    expect(backend.calls.at(-1).query).toMatchObject({ status: 'UNDER_REVIEW', q: 'วิภา' });
    expect(root.querySelector('[data-role="staff-queue-empty"]').textContent).toContain('ไม่พบแผนที่ตรงกับเงื่อนไข');
  });

  it('shows an empty queue', async () => {
    const { root } = await mountStaff(createFakeBackend({ plans: [] }), { hash: '#/staff/review' });
    expect(root.querySelector('[data-role="staff-queue-empty"]').textContent).toContain('ไม่มีแผนที่รอดำเนินการ');
  });

  it('hands a 403 queue (no active scope) to the shell forbidden state', async () => {
    const backend = createFakeBackend({ override: () => json(403, { error: { code: 'FORBIDDEN', message: 'x' } }) });
    const { root } = await mountStaff(backend, { hash: '#/staff/review' });
    expect(root.textContent).toContain('ยังไม่มีขอบเขตการตรวจแผนที่มีผล');
  });
});

describe('Issue #77: Staff Plan review page', () => {
  it('shows state, version, notes and only the commands the state allows', async () => {
    const { root } = await mountStaff(createFakeBackend());

    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('SUBMITTED');
    expect(root.querySelector('[data-role="plan-version"]').textContent).toBe('เวอร์ชันแผน v2');
    expect(root.querySelector('[data-field="notes"]').textContent).toBe('สนใจงานวิเคราะห์ข้อมูล');
    expect(commandNames(root)).toEqual([REVIEW_COMMANDS.START_REVIEW]);
  });

  it('confirms before sending, moves focus into the panel and back on cancel or Escape', async () => {
    const backend = createFakeBackend();
    const { root } = await mountStaff(backend);
    const trigger = commandButton(root, REVIEW_COMMANDS.START_REVIEW);

    trigger.click();
    expect(confirmPanel(root)).not.toBeNull();
    expect(document.activeElement.id).toBe('staff-review-confirm-title');
    expect(trigger.disabled).toBe(true);

    root.querySelector('[data-role="review-confirm-cancel"]').click();
    expect(confirmPanel(root)).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    confirmPanel(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(confirmPanel(root)).toBeNull();
    expect(posts(backend)).toHaveLength(0);
  });

  it('starts review, reloads state and history from the server and offers the next commands', async () => {
    const backend = createFakeBackend();
    const { root } = await mountStaff(backend);

    commandButton(root, REVIEW_COMMANDS.START_REVIEW).click();
    await confirm(root);

    expect(posts(backend)).toHaveLength(1);
    expect(posts(backend)[0].body.expected_version).toBe(2);
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('UNDER_REVIEW');
    expect(root.querySelector('[data-role="plan-version"]').textContent).toBe('เวอร์ชันแผน v3');
    expect(root.querySelector('[data-role="staff-history-list"]').textContent).toContain('เริ่มตรวจแผน');
    const feedback = root.querySelector('[data-role="review-feedback"]');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.textContent).toContain('เริ่มตรวจแผนเรียบร้อยแล้ว');
    expect(document.activeElement).toBe(feedback);
    expect(commandNames(root)).toEqual([REVIEW_COMMANDS.APPROVE, REVIEW_COMMANDS.RETURN]);
  });

  it('sends a command only once when confirm is pressed twice', async () => {
    const backend = createFakeBackend();
    const { root } = await mountStaff(backend);
    commandButton(root, REVIEW_COMMANDS.START_REVIEW).click();
    const form = confirmPanel(root).querySelector('form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(20);
    expect(posts(backend)).toHaveLength(1);
  });

  it('requires a return reason in the UI, then returns the Plan with that reason', async () => {
    const backend = createFakeBackend({ plans: [planRow({ status: 'UNDER_REVIEW', version: 3 })] });
    const { root } = await mountStaff(backend);

    commandButton(root, REVIEW_COMMANDS.RETURN).click();
    const textarea = confirmPanel(root).querySelector('textarea');
    expect(textarea.getAttribute('aria-required')).toBe('true');
    expect(document.activeElement).toBe(textarea);

    await confirm(root, '   ');
    expect(posts(backend)).toHaveLength(0);
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[data-role="review-notes-error"]').textContent).toContain('กรุณาระบุเหตุผล');
    expect(document.activeElement).toBe(textarea);

    await confirm(root, 'กรุณาแนบหนังสือตอบรับ');
    expect(posts(backend)[0].body).toEqual({ expected_version: 3, operation_id: expect.any(String), review_notes: 'กรุณาแนบหนังสือตอบรับ' });
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('NEEDS_REVISION');
    expect(root.querySelector('[data-role="staff-history-list"]').textContent).toContain('ความเห็น: กรุณาแนบหนังสือตอบรับ');
    expect(root.querySelector('[data-role="review-no-actions"]')).not.toBeNull();
  });

  it('approves with an optional comment and then offers no commands', async () => {
    const backend = createFakeBackend({ plans: [planRow({ status: 'UNDER_REVIEW', version: 3 })] });
    const { root } = await mountStaff(backend);

    commandButton(root, REVIEW_COMMANDS.APPROVE).click();
    await confirm(root, '');

    expect(posts(backend)[0].body).not.toHaveProperty('review_notes');
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('APPROVED');
    expect(root.querySelector('[data-role="review-commands"]')).toBeNull();
  });

  it('on a stale version shows a conflict, keeps the old state on screen and reloads on request', async () => {
    const backend = createFakeBackend({ plans: [planRow({ status: 'UNDER_REVIEW', version: 3 })] });
    const { root } = await mountStaff(backend);
    // Another reviewer approves first
    Object.assign(backend.state.plans.get(PLAN_ID), { status: 'APPROVED', version: 4 });

    commandButton(root, REVIEW_COMMANDS.RETURN).click();
    await confirm(root, 'ขาดเอกสาร');

    const feedback = root.querySelector('[data-role="review-feedback"]');
    expect(feedback.getAttribute('role')).toBe('alert');
    expect(feedback.textContent).toContain('ยังไม่ถูกบันทึก');
    expect(feedback.textContent).not.toContain('เรียบร้อยแล้ว');
    expect(document.activeElement).toBe(feedback);
    // No optimistic update: the screen still shows what the server last confirmed
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('UNDER_REVIEW');

    feedback.querySelector('button').click();
    await flush(20);
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('APPROVED');
    expect(root.querySelector('[data-role="plan-version"]').textContent).toBe('เวอร์ชันแผน v4');
  });

  it('shows a state message on 422 without claiming success', async () => {
    const backend = createFakeBackend({
      override: ({ method }) => (method === 'POST' ? json(422, { error: { code: 'INVALID_STATE_TRANSITION', message: 'x' } }) : null)
    });
    const { root } = await mountStaff(backend);
    commandButton(root, REVIEW_COMMANDS.START_REVIEW).click();
    await confirm(root);

    const feedback = root.querySelector('[data-role="review-feedback"]').textContent;
    expect(feedback).toContain('สถานะปัจจุบันของแผนไม่อนุญาต');
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('SUBMITTED');
  });

  it('explains a 403 command (scope changed or Round closed)', async () => {
    const backend = createFakeBackend({
      override: ({ method }) => (method === 'POST' ? json(403, { error: { code: 'FORBIDDEN', message: 'x' } }) : null)
    });
    const { root } = await mountStaff(backend);
    commandButton(root, REVIEW_COMMANDS.START_REVIEW).click();
    await confirm(root);
    expect(root.querySelector('[data-role="review-feedback"]').textContent).toContain('รอบการสมัครปิดแล้ว');
  });

  it('keeps the notes and reuses the operation_id when retrying after a network failure', async () => {
    let attempts = 0;
    const backend = createFakeBackend({ plans: [planRow({ status: 'UNDER_REVIEW', version: 3 })] });
    const realFetch = backend.fetchImpl.getMockImplementation();
    backend.fetchImpl.mockImplementation(async (url, init = {}) => {
      if (init.method === 'POST' && ++attempts === 1) {
        backend.calls.push({ method: 'POST', body: JSON.parse(init.body) });
        throw new TypeError('Failed to fetch');
      }
      return realFetch(url, init);
    });
    const { root } = await mountStaff(backend);

    commandButton(root, REVIEW_COMMANDS.RETURN).click();
    await confirm(root, 'แนบหนังสือตอบรับ');
    expect(root.querySelector('[data-role="review-confirm-error"]').textContent).toContain('ระบบจะไม่บันทึกซ้ำ');
    expect(confirmPanel(root).querySelector('textarea').value).toBe('แนบหนังสือตอบรับ');

    await confirm(root);
    const [first, second] = posts(backend);
    expect(second.body.operation_id).toBe(first.body.operation_id);
    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('NEEDS_REVISION');
  });

  it('uses a new operation_id when the notes change before a retry', async () => {
    let attempts = 0;
    const backend = createFakeBackend({ plans: [planRow({ status: 'UNDER_REVIEW', version: 3 })] });
    const realFetch = backend.fetchImpl.getMockImplementation();
    backend.fetchImpl.mockImplementation(async (url, init = {}) => {
      if (init.method === 'POST' && ++attempts === 1) {
        backend.calls.push({ method: 'POST', body: JSON.parse(init.body) });
        throw new TypeError('Failed to fetch');
      }
      return realFetch(url, init);
    });
    const { root } = await mountStaff(backend);

    commandButton(root, REVIEW_COMMANDS.RETURN).click();
    await confirm(root, 'ฉบับแรก');
    await confirm(root, 'ฉบับแก้ไข');
    const [first, second] = posts(backend);
    expect(second.body.operation_id).not.toBe(first.body.operation_id);
  });

  it('clears the page and shows the expired-session alert when a command returns 401', async () => {
    const backend = createFakeBackend({
      override: ({ method }) => (method === 'POST' ? json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }) : null)
    });
    const { root } = await mountStaff(backend);
    commandButton(root, REVIEW_COMMANDS.START_REVIEW).click();
    await confirm(root);

    expect(root.textContent).toContain('Session หมดอายุ');
    expect(root.textContent).not.toContain('วิภา');
  });

  it.each([
    ['without the review capability', { canReviewPlan: false }, planRow({ status: 'UNDER_REVIEW' }), 'ไม่มีสิทธิ์ดำเนินการตรวจแผน'],
    ['in a CLOSED Round', {}, planRow({ status: 'UNDER_REVIEW', cycle: { ...planRow().cycle, status: 'CLOSED' } }), 'รอบการสมัครของแผนนี้ปิดแล้ว'],
    ['in NEEDS_REVISION', {}, planRow({ status: 'NEEDS_REVISION' }), 'ไม่มีคำสั่งตรวจที่ดำเนินการได้'],
    ['in APPROVED', {}, planRow({ status: 'APPROVED' }), 'ไม่มีคำสั่งตรวจที่ดำเนินการได้'],
    ['in CANCELLED', {}, planRow({ status: 'CANCELLED' }), 'ไม่มีคำสั่งตรวจที่ดำเนินการได้']
  ])('renders no review controls %s', async (_label, options, plan, message) => {
    const { root } = await mountStaff(createFakeBackend({ plans: [plan] }), options);
    expect(root.querySelector('[data-role="review-commands"]')).toBeNull();
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('[data-role="review-no-actions"]').textContent).toContain(message);
  });

  it('shows a safe message for a Plan outside the Staff scope', async () => {
    const { root } = await mountStaff(createFakeBackend(), { hash: `#/staff/plans/${OUTSIDE_PLAN_ID}` });
    const card = root.querySelector('[data-role="staff-plan-not-available"]');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.querySelector('a').getAttribute('href')).toBe('#/staff/review');
  });
});

describe('Issue #77: Advisor never receives review controls', () => {
  function advisorBackend() {
    return {
      fetchImpl: jest.fn(async (url) => {
        const { pathname } = new URL(url);
        if (pathname === `/api/v3/advisor/plans/${PLAN_ID}`) {
          const { student, cycle, ...rest } = planRow({ status: 'UNDER_REVIEW' });
          return json(200, { data: { ...rest, cycle_id: cycle.id } });
        }
        return json(403, { error: { code: 'FORBIDDEN', message: 'x' } });
      })
    };
  }

  it('denies the Staff review route to an Advisor without calling any API', async () => {
    const staffBackend = createFakeBackend();
    const { root } = await mountStaff(staffBackend, { role: 'ADVISOR', canReviewPlan: true });
    expect(root.textContent).toContain('ไม่มีสิทธิ์เข้าถึง');
    expect(staffBackend.fetchImpl).not.toHaveBeenCalled();
  });

  it('renders the Advisor Plan page without review controls even when a Staff client and capability exist', async () => {
    const staffBackend = createFakeBackend({ plans: [planRow({ status: 'UNDER_REVIEW' })] });
    const backend = advisorBackend();
    const advisorClient = createAdvisorClient({ apiBaseUrl: API, currentOrigin: ORIGIN, getAccessToken: async () => 't', fetchImpl: backend.fetchImpl });
    const { root } = await mountStaff(staffBackend, { role: 'ADVISOR', canReviewPlan: true, advisorClient, hash: `#/advisor/plans/${PLAN_ID}` });

    expect(root.querySelector('[data-role="plan-status"]').textContent).toContain('UNDER_REVIEW');
    expect(root.querySelector('[data-role="review-commands"], [data-role="review-confirm"], form, textarea')).toBeNull();
    expect(staffBackend.fetchImpl).not.toHaveBeenCalled();
  });
});
