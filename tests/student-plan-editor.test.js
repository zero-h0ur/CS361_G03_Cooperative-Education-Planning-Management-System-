/** @jest-environment jsdom */
const { renderPlanEditor, validatePlanDraft } = require('../tmp/frontend-test-modules/student/plan-editor-view.cjs');
const { renderStudentPlanView } = require('../tmp/frontend-test-modules/student/student-plan-view.cjs');
const { createStudentPlanClient } = require('../tmp/frontend-test-modules/student/plan-submission-client.cjs');

const CYCLE = '30000000-0000-4000-8000-000000000101';
const COMPANY = '10000000-0000-4000-8000-000000000001';
const COMPANY2 = '10000000-0000-4000-8000-000000000002';
const POSITION = '20000000-0000-4000-8000-000000000001';
const PLAN = '50000000-0000-4000-8000-000000000101';
const OP = '60000000-0000-4000-8000-000000000101';
const cycles = [{ id: CYCLE, name: 'รอบสหกิจ 1/2569', academic_year: 2569, semester: 1, status: 'OPEN' }];
const basePlan = {
  id: PLAN, cycle_id: CYCLE, company_id: COMPANY, position_id: POSITION,
  company_name: 'บริษัทเดิม', position_title: 'นักพัฒนา', notes: 'บันทึกเดิม',
  status: 'DRAFT', version: 3, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z'
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const error = (code, details = []) => Object.assign(new Error(code), { code, details });
let controllers = [];

function client(overrides = {}) {
  return {
    listCycles: jest.fn(async () => cycles),
    searchCompanies: jest.fn(async () => ({ items: [{ id: COMPANY, name: 'บริษัทเดิม' }, { id: COMPANY2, name: 'บริษัทใหม่' }], pagination: { page: 1, totalPages: 1 } })),
    getCompanyPositions: jest.fn(async ({ companyId }) => companyId === COMPANY
      ? [{ id: POSITION, company_id: COMPANY, title: 'นักพัฒนา' }] : []),
    saveDraft: jest.fn(async () => basePlan),
    ...overrides
  };
}
async function mount(plan = null, overrides = {}) {
  const planClient = client(overrides);
  const controller = new AbortController();
  controllers.push(controller);
  const hooks = { onSaved: jest.fn(), onReload: jest.fn(), onDirtyChange: jest.fn(),
    onSessionExpired: jest.fn(), onAccessDenied: jest.fn() };
  const root = renderPlanEditor({ plan, planClient, signal: controller.signal, ...hooks, createOperationId: () => OP });
  document.body.append(root);
  await flush();
  return { root, planClient, hooks, controller };
}
function change(root, name, value, event = 'change') {
  const input = root.querySelector(`[name="${name}"]`);
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
  return input;
}
function save(root) { root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { controllers.forEach((item) => item.abort()); controllers = []; });

describe('Issue #73 Plan editor', () => {
  test('creates an incomplete Draft with a real selected Cycle and normalized optional notes', async () => {
    const { root, planClient } = await mount();
    change(root, 'cycle_id', CYCLE);
    change(root, 'notes', '   ', 'input');
    save(root);
    await flush();
    expect(planClient.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      planId: null, operationId: OP,
      content: { cycle_id: CYCLE, company_id: null, position_id: null, notes: null }
    }));
  });

  test('validates required Cycle and note length before opening a request, with linked field errors', async () => {
    const { root, planClient } = await mount();
    change(root, 'notes', 'x'.repeat(2001), 'input');
    save(root);
    expect(planClient.saveDraft).not.toHaveBeenCalled();
    expect(root.querySelector('#plan-cycle_id').getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('#plan-notes-error').textContent).toContain('2,000');
    expect(document.activeElement.id).toBe('plan-cycle_id');
    expect(validatePlanDraft({ cycle_id: CYCLE, company_id: null, position_id: null, notes: null }, 'NEEDS_REVISION'))
      .toEqual(expect.objectContaining({ company_id: expect.any(String), position_id: expect.any(String) }));
  });

  test('saves an editable Plan using its loaded version and exact allowlisted fields', async () => {
    const { root, planClient } = await mount(basePlan);
    change(root, 'notes', '  ปรับแก้  ', 'input');
    save(root);
    await flush();
    const call = planClient.saveDraft.mock.calls[0][0];
    expect(call.expectedVersion).toBe(3);
    expect(call.planId).toBe(PLAN);
    expect(call.content).toEqual({ cycle_id: CYCLE, company_id: COMPANY, position_id: POSITION, notes: 'ปรับแก้' });
    expect(call.content).not.toHaveProperty('status');
  });

  test('changing Company clears Position immediately and ignores old Company response', async () => {
    let resolveOld;
    const { root } = await mount(basePlan, {
      getCompanyPositions: jest.fn(({ companyId }) => companyId === COMPANY
        ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve([]))
    });
    change(root, 'company_id', COMPANY2);
    expect(root.querySelector('#plan-position_id').value).toBe('');
    await flush();
    resolveOld([{ id: POSITION, company_id: COMPANY, title: 'ตำแหน่งเก่า' }]);
    await flush();
    expect(root.querySelector('#plan-position_id').textContent).not.toContain('ตำแหน่งเก่า');
    expect(root.textContent).toContain('ยังไม่มีตำแหน่งงานที่เปิดเผย');
  });

  test('debounces search and ignores stale Company results even when fetch ignores abort', async () => {
    let resolveOld;
    const searchCompanies = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ items: [{ id: COMPANY2, name: 'ผลใหม่' }], pagination: { page: 1, totalPages: 1 } });
    const { root } = await mount(null, { searchCompanies });
    change(root, 'search', 'ใหม่', 'input');
    expect(searchCompanies).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 330));
    resolveOld({ items: [{ id: COMPANY, name: 'ผลเก่า' }], pagination: { page: 1, totalPages: 1 } });
    await flush();
    expect(root.querySelector('#plan-company_id').textContent).toContain('ผลใหม่');
    expect(root.querySelector('#plan-company_id').textContent).not.toContain('ผลเก่า');
  });

  test('loads additional Company pages without duplicating choices', async () => {
    const { root, planClient } = await mount(null, { searchCompanies: jest.fn()
      .mockResolvedValueOnce({ items: [{ id: COMPANY, name: 'A' }], pagination: { page: 1, totalPages: 2 } })
      .mockResolvedValueOnce({ items: [{ id: COMPANY, name: 'A' }, { id: COMPANY2, name: 'B' }], pagination: { page: 2, totalPages: 2 } }) });
    [...root.querySelectorAll('button')].find((item) => item.textContent === 'ดูสถานประกอบการเพิ่มเติม').click();
    await flush();
    expect(planClient.searchCompanies).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect([...root.querySelector('#plan-company_id').options].filter((item) => item.value === COMPANY)).toHaveLength(1);
    expect(root.querySelector(`#plan-company_id option[value="${COMPANY2}"]`)).not.toBeNull();
  });

  test('stale save keeps entered notes visible and requires explicit reload before another save', async () => {
    const { root, planClient, hooks } = await mount(basePlan, {
      saveDraft: jest.fn(async () => { throw error('STALE_RECORD_CONFLICT'); })
    });
    change(root, 'notes', 'งานที่ยังไม่บันทึก', 'input');
    save(root);
    await flush();
    expect(root.querySelector('#plan-notes').value).toBe('งานที่ยังไม่บันทึก');
    expect(root.querySelector('#plan-notes').readOnly).toBe(true);
    expect(root.querySelector('[data-role="save-plan-button"]').disabled).toBe(true);
    expect(root.querySelector('[role="alert"]').textContent).toContain('โหลดแผนล่าสุด');
    save(root);
    expect(planClient.saveDraft).toHaveBeenCalledTimes(1);
    [...root.querySelectorAll('button')].find((item) => item.textContent === 'โหลดแผนล่าสุดและทิ้งการแก้ไข').click();
    expect(hooks.onReload).toHaveBeenCalledTimes(1);
  });

  test('network retry sends exactly the original body/key and prevents duplicate in-flight writes', async () => {
    let rejectFirst;
    const saveDraft = jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(basePlan);
    const { root } = await mount(basePlan, { saveDraft });
    change(root, 'notes', 'retry this text', 'input');
    save(root); save(root);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    rejectFirst(error('SERVICE_UNAVAILABLE'));
    await flush();
    expect(root.querySelector('#plan-notes').readOnly).toBe(true);
    save(root);
    await flush();
    expect(saveDraft.mock.calls[1][0]).toEqual(saveDraft.mock.calls[0][0]);
  });

  test('server validation preserves text and points to the invalid reference', async () => {
    const { root } = await mount(basePlan, { saveDraft: jest.fn(async () => {
      throw error('VALIDATION_ERROR', [{ field: 'position_id', issue: 'invalid reference' }]);
    }) });
    change(root, 'notes', 'keep this', 'input'); save(root); await flush();
    expect(root.querySelector('#plan-position_id').getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('#plan-notes').value).toBe('keep this');
    expect(root.querySelector('#plan-notes').readOnly).toBe(false);
  });

  test('unavailable/empty Cycle options have recovery states and cannot create a Draft', async () => {
    const { root, planClient } = await mount(null, { listCycles: jest.fn()
      .mockRejectedValueOnce(error('SERVICE_UNAVAILABLE')).mockResolvedValueOnce([]) });
    expect(root.querySelector('[data-role="save-plan-button"]').disabled).toBe(true);
    [...root.querySelectorAll('button')].find((item) => item.textContent === 'โหลดรอบสมัครอีกครั้ง').click();
    await flush();
    expect(root.querySelector('#plan-cycle_id').textContent).toContain('ยังไม่มีรอบสมัคร');
    save(root);
    expect(planClient.saveDraft).not.toHaveBeenCalled();
  });

  test('CLOSED cycle remains a labelled draft-only choice; plain directory text cannot execute HTML', async () => {
    const { root } = await mount(null, {
      listCycles: jest.fn(async () => [{ ...cycles[0], status: 'CLOSED' }]),
      searchCompanies: jest.fn(async () => ({ items: [{ id: COMPANY, name: '<img src=x onerror=alert(1)>' }], pagination: { page: 1, totalPages: 1 } }))
    });
    change(root, 'cycle_id', CYCLE);
    expect(root.querySelector('#plan-cycle-hint').textContent).toContain('ยังส่งแผนไม่ได้');
    expect(root.querySelector('#plan-company_id').textContent).toContain('<img');
    expect(root.querySelector('img')).toBeNull();
  });

  test.each(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CANCELLED', 'UNKNOWN'])('does not render content editor in %s', (status) => {
    expect(renderPlanEditor({ plan: { ...basePlan, status }, planClient: client() })).toBeNull();
  });

  test.each([['SESSION_EXPIRED', 'onSessionExpired'], ['ACCESS_DENIED', 'onAccessDenied']])('%s invokes shell state and never creates a Draft', async (code, hook) => {
    const { hooks, planClient } = await mount(null, { listCycles: jest.fn(async () => { throw error(code); }) });
    expect(hooks[hook]).toHaveBeenCalled();
    expect(planClient.saveDraft).not.toHaveBeenCalled();
  });

  test('editing blocks submit and Plan switching; save refreshes selected Plan and readiness', async () => {
    const controller = new AbortController(); controllers.push(controller);
    let savedPlan = basePlan;
    const planClient = client({
      getOwnPlan: jest.fn(async () => ({ plan: savedPlan, plans: [savedPlan], statusHistory: [] })),
      saveDraft: jest.fn(async ({ content }) => { savedPlan = { ...basePlan, ...content, version: 4 }; return savedPlan; }),
      submitPlan: jest.fn()
    });
    const root = renderStudentPlanView({ planClient, signal: controller.signal, createOperationId: () => OP });
    document.body.append(root); await flush(); await flush();
    change(root, 'notes', 'แก้ไขใหม่', 'input');
    expect(root.querySelector('[data-role="submit-plan-button"]').disabled).toBe(true);
    expect(root.querySelector('#student-plan-picker').disabled).toBe(true);
    save(root); await flush(); await flush();
    expect(planClient.getOwnPlan).toHaveBeenLastCalledWith(expect.objectContaining({ planId: PLAN }));
    expect(root.querySelector('[data-role="plan-version"]').textContent).toContain('v4');
    expect(root.querySelector('[data-role="submit-plan-button"]').disabled).toBe(false);
    expect(root.querySelector('[data-role="plan-submit-feedback"]').textContent).toContain('บันทึกแผนเรียบร้อย');
    expect(planClient.submitPlan).not.toHaveBeenCalled();
  });

  test('switches to a selected historical Plan without exposing an editor for its terminal state', async () => {
    const controller = new AbortController(); controllers.push(controller);
    const old = { ...basePlan, id: '50000000-0000-4000-8000-000000000102', status: 'CANCELLED' };
    const planClient = client({
      getOwnPlan: jest.fn(async ({ planId }) => ({ plan: planId === old.id ? old : basePlan,
        plans: [basePlan, old], statusHistory: [] }))
    });
    const root = renderStudentPlanView({ planClient, signal: controller.signal });
    document.body.append(root); await flush(); await flush();
    const picker = root.querySelector('#student-plan-picker');
    picker.value = old.id;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(planClient.getOwnPlan).toHaveBeenLastCalledWith(expect.objectContaining({ planId: old.id }));
    expect(root.querySelector('[data-role="plan-current-status"]').textContent).toContain('CANCELLED');
    expect(root.querySelector('[data-role="plan-editor"]')).toBeNull();
    expect(root.querySelector('[data-role="submit-plan-button"]').disabled).toBe(true);
    [...root.querySelectorAll('button')].find((item) => item.textContent === 'สร้างแผนใหม่').click();
    await flush();
    expect(root.querySelector('[data-role="plan-editor"]')).not.toBeNull();
    expect(root.querySelector('#plan-cycle_id').value).toBe('');
  });

  test('route abort prevents a late reference response from changing the disposed editor', async () => {
    let resolveCycles;
    const { root, controller } = await mount(null, { listCycles: jest.fn(() =>
      new Promise((resolve) => { resolveCycles = resolve; })) });
    controller.abort();
    resolveCycles(cycles);
    await flush();
    expect(root.querySelector('#plan-cycle_id').textContent).not.toContain(cycles[0].name);
  });
});

describe('Issue #73 client wire contract', () => {
  const json = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
  test('uses real reference URLs, sends no token to public API, and writes POST/PATCH allowlists', async () => {
    const fetchImpl = jest.fn(async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/cycles')) return json(200, { data: cycles });
      if (path.endsWith('/positions')) return json(200, { data: [{ id: POSITION, company_id: COMPANY, title: 'Developer' }] });
      if (path === '/api/companies') return json(200, { data: [{ id: COMPANY, name: 'A' }], pagination: { totalPages: 1 } });
      return json(init.method === 'POST' ? 201 : 200, { data: basePlan });
    });
    const api = createStudentPlanClient({ apiBaseUrl: 'https://api.example.com', currentOrigin: 'https://app.example.com',
      getAccessToken: async () => 'TOKEN', fetchImpl });
    await api.listCycles(); await api.searchCompanies({ q: 'เว็บ', page: 2 }); await api.getCompanyPositions({ companyId: COMPANY });
    const content = { cycle_id: CYCLE, company_id: COMPANY, position_id: POSITION, notes: 'ข้อความ', student_id: 'SPOOF', status: 'APPROVED' };
    await api.saveDraft({ content, operationId: OP });
    await api.saveDraft({ planId: PLAN, content, operationId: OP, expectedVersion: 3 });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer TOKEN');
    for (const index of [1, 2]) expect(fetchImpl.mock.calls[index][1].headers.Authorization).toBeUndefined();
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('page')).toBe('2');
    expect(fetchImpl.mock.calls[3][1].method).toBe('POST');
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toEqual({
      cycle_id: CYCLE, company_id: COMPANY, position_id: POSITION, notes: 'ข้อความ', operation_id: OP, expected_version: 3
    });
  });

  test('rejects mismatched public Position and distinguishes duplicate-Cycle conflict', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(200, { data: [{ id: POSITION, company_id: COMPANY2, title: 'wrong' }] }))
      .mockResolvedValueOnce(json(409, { error: { code: 'PLAN_ALREADY_EXISTS_FOR_CYCLE' } }));
    const api = createStudentPlanClient({ apiBaseUrl: 'https://api.example.com', getAccessToken: async () => 'TOKEN', fetchImpl });
    await expect(api.getCompanyPositions({ companyId: COMPANY })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(api.saveDraft({ content: {}, operationId: OP })).rejects.toMatchObject({ code: 'PLAN_ALREADY_EXISTS_FOR_CYCLE' });
  });

  test('loads all own Plan pages and preserves selection of an older cycle', async () => {
    const old = { ...basePlan, id: '50000000-0000-4000-8000-000000000102', company_id: null, position_id: null };
    const fetchImpl = jest.fn(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/history')) return json(200, { data: [] });
      return json(200, { data: parsed.searchParams.get('page') === '2' ? [old] : [basePlan],
        pagination: { totalPages: 2 } });
    });
    const api = createStudentPlanClient({ apiBaseUrl: 'https://api.example.com', getAccessToken: async () => 'TOKEN', fetchImpl });
    const bundle = await api.getOwnPlan({ planId: old.id });
    expect(bundle.plan.id).toBe(old.id);
    expect(bundle.plans).toHaveLength(2);
    expect(fetchImpl.mock.calls.some(([url]) => new URL(url).searchParams.get('page') === '2')).toBe(true);
  });
});
