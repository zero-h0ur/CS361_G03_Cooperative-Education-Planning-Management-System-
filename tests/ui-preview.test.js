/** @jest-environment jsdom */
const { createPreviewClients, SCENARIOS } = require('../tmp/frontend-test-modules/preview-fixtures.cjs');
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
let app;
beforeEach(() => { document.body.replaceChildren(); global.fetch = jest.fn(() => { throw new Error('No network allowed'); }); });
afterEach(() => { app?.destroy(); app = null; delete global.fetch; });

async function mount(scenario, hash = '#/student/plan') {
  const root = document.createElement('div'); document.body.append(root);
  const clients = createPreviewClients({ scenario, delayMs: 0 });
  app = createShellApp({ ...clients, root, location: { pathname: '/app.html', search: '', hash },
    eventTarget: new EventTarget(), storage: null, startLogin: async () => {}, restartLogin: async () => {}, logout: async () => {} });
  await app.start(); await flush(); await flush();
  return { root, clients };
}

test('mounts real profile UI and saves only in memory without any fetch', async () => {
  const { root, clients } = await mount('draft', '#/student/profile');
  expect(root.textContent).toContain('นักศึกษา ตัวอย่าง');
  expect(root.querySelector('.student-profile-workspace')).not.toBeNull();
  const profile = await clients.studentProfileClient.getOwnProfile();
  await clients.studentProfileClient.updateOwnProfile({ preferredName: 'ทดลอง', version: profile.version });
  expect((await clients.studentProfileClient.getOwnProfile()).preferred_name).toBe('ทดลอง');
  expect((await createPreviewClients({ delayMs: 0 }).studentProfileClient.getOwnProfile()).preferred_name).toBe('นักศึกษาทดลอง');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('mounts real Plan editor, saves then submits and refreshes simulated history', async () => {
  const { root, clients } = await mount('draft');
  expect(root.querySelector('.plan-editor')).not.toBeNull();
  expect(root.querySelector('#plan-notes')).not.toBeNull();
  const { plan } = await clients.studentPlanClient.getOwnPlan();
  const content = { cycle_id: plan.cycle_id, company_id: plan.company_id, position_id: plan.position_id, notes: 'บันทึกจำลอง' };
  const saved = await clients.studentPlanClient.saveDraft({ planId: plan.id, expectedVersion: plan.version, content });
  expect(saved.version).toBe(plan.version + 1);
  await clients.studentPlanClient.submitPlan({ planId: saved.id, expectedVersion: saved.version });
  const result = await clients.studentPlanClient.getOwnPlan();
  expect(result.plan.status).toBe('SUBMITTED');
  expect(result.statusHistory.at(-1).action).toBe('PLAN_SUBMITTED');
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['submitted', 'review', 'approved', 'cancelled'])('%s renders real read-only UI', async (scenario) => {
  const { root } = await mount(scenario);
  expect(root.querySelector('.plan-editor')).toBeNull();
  expect(root.querySelector('[data-role="submit-plan-button"]').disabled).toBe(true);
});

test('conflict preserves typed content in the real editor and disables further saving', async () => {
  const { root } = await mount('conflict');
  const notes = root.querySelector('#plan-notes');
  notes.value = 'ข้อความที่ต้องเก็บไว้'; notes.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('.plan-editor form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(notes.value).toBe('ข้อความที่ต้องเก็บไว้');
  expect(root.querySelector('[data-role="save-plan-button"]').disabled).toBe(true);
  expect(root.textContent).toContain('โหลดแผนล่าสุด');
});

test.each(Object.keys(SCENARIOS))('scenario %s mounts without a network request', async (scenario) => {
  const { root } = await mount(scenario);
  expect(root.textContent.trim().length).toBeGreaterThan(0);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('empty scenario can create a draft and rejects duplicate active Cycle', async () => {
  const { studentPlanClient: client } = createPreviewClients({ scenario: 'empty', delayMs: 0 });
  const cycles = await client.listCycles();
  const content = { cycle_id: cycles[0].id, company_id: null, position_id: null, notes: null };
  const saved = await client.saveDraft({ content });
  expect(saved.status).toBe('DRAFT'); expect(saved.version).toBe(1);
  await expect(client.saveDraft({ content })).rejects.toMatchObject({ code: 'PLAN_ALREADY_EXISTS_FOR_CYCLE' });
  await expect(client.saveDraft({ planId: saved.id, expectedVersion: 99, content })).rejects.toMatchObject({ code: 'STALE_RECORD_CONFLICT' });
});
