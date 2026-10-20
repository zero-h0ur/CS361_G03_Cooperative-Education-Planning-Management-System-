/** @jest-environment jsdom */
const { createPreviewClients, SCENARIOS, ADVISOR_SCENARIOS } = require('../tmp/frontend-test-modules/preview-fixtures.cjs');
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
let app;
beforeEach(() => { document.body.replaceChildren(); global.fetch = jest.fn(() => { throw new Error('No network allowed'); }); });
afterEach(() => { app?.destroy(); app = null; delete global.fetch; });

async function mount(scenario, hash = '#/student/plan', role = 'STUDENT') {
  const root = document.createElement('div'); document.body.append(root);
  const clients = createPreviewClients({ scenario, role, delayMs: 0 });
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

test('matches the reference overview order and opens the complete editor explicitly', async () => {
  const { root } = await mount('draft');
  const workspace = root.querySelector('.student-plan-workspace');
  expect([...workspace.children].filter((node) => node.matches('.student-card')).map((node) =>
    [...node.classList].find((name) => ['student-plan-status', 'student-plan-readiness', 'student-plan-submit', 'student-plan-history'].includes(name))
  )).toEqual(['student-plan-status', 'student-plan-readiness', 'student-plan-submit', 'student-plan-history']);
  const tools = workspace.querySelector('.student-plan-tools');
  expect(tools.open).toBe(false);
  workspace.querySelector('.student-plan-status__manage').click();
  expect(tools.open).toBe(true);
  expect(document.activeElement).toBe(tools.querySelector('summary'));
  expect(root.querySelector('[data-plan-field="cycle_id"]').textContent).toContain('รอบที่ 1');
});

test('uses the real decorative campus asset on both Student routes', async () => {
  const { root } = await mount('draft', '#/student/profile');
  const backdrop = root.querySelector('.student-campus-backdrop');
  expect(backdrop.getAttribute('src')).toBe('resources/images/student-campus-banner.png');
  expect(backdrop.alt).toBe('');
  expect(backdrop.getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.shell-brand__name').textContent).toBe('CO-ED');
});

test('Staff preview renders real read-only search with the same campus shell and no network', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const clients = createPreviewClients({ role: 'STAFF', delayMs: 0 });
  app = createShellApp({ ...clients, root, location: { pathname: '/app.html', search: '', hash: '#/staff/students' },
    eventTarget: new EventTarget(), storage: null, startLogin: async () => {}, restartLogin: async () => {}, logout: async () => {} });
  await app.start(); await flush();
  expect(root.querySelector('.protected-shell--staff.protected-shell--campus')).not.toBeNull();
  expect(root.querySelector('.student-campus-backdrop')).not.toBeNull();
  expect(root.querySelector('.staff-management')).not.toBeNull();
  expect(root.textContent).toContain('นักศึกษา ตัวอย่าง');
  expect(root.querySelector('a[href="#/student/profile"]')).toBeNull();
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

const ADVISOR_STUDENT = '40000000-0000-4000-8000-000000000101';
const ADVISOR_PLAN = '50000000-0000-4000-8000-000000000101';

test.each([
  ['#/advisor/students', '[data-role="advisor-student-list"]'],
  [`#/advisor/students/${ADVISOR_STUDENT}`, '[data-role="advisor-plan-list"]'],
  [`#/advisor/plans/${ADVISOR_PLAN}`, '[data-field="company"]']
])('Advisor preview mounts the real read-only view %s using the shared campus theme', async (hash, selector) => {
  const { root, clients } = await mount('assigned', hash, 'ADVISOR');
  expect(root.querySelector(selector)).not.toBeNull();
  expect(root.querySelector('.protected-shell--advisor.protected-shell--campus')).not.toBeNull();
  expect(root.querySelector('.student-campus-backdrop')).not.toBeNull();
  expect(root.querySelector('.shell-content form, .shell-content input, .shell-content textarea')).toBeNull();
  expect(root.querySelector('.shell-nav a[href*="staff"], .shell-nav a[href*="student/profile"]')).toBeNull();
  expect(Object.keys(clients.advisorClient).sort()).toEqual(['getPlan', 'getStudent', 'listStudentPlans', 'listStudents']);
  expect(clients.studentPlanClient).toBeUndefined();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(Object.keys(ADVISOR_SCENARIOS))('Advisor scenario %s uses synthetic read-only data without fetch', async (scenario) => {
  const { root } = await mount(scenario, '#/advisor/students', 'ADVISOR');
  expect(root.textContent.trim()).not.toBe('');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('Advisor empty and no-plan fixtures explain the actual next step without mutation actions', async () => {
  const { root } = await mount('unassigned', '#/advisor/students', 'ADVISOR');
  expect(root.querySelector('[data-role="advisor-no-assignment"]').textContent).toContain('เมื่อเจ้าหน้าที่มอบหมาย');
  const clients = createPreviewClients({ role: 'ADVISOR', scenario: 'no-plans', delayMs: 0 });
  expect((await clients.advisorClient.listStudents()).items).toHaveLength(3);
  expect((await clients.advisorClient.listStudentPlans(ADVISOR_STUDENT)).items).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('Advisor revoked fixture gives the generic scope denial instead of private detail', async () => {
  const { root } = await mount('revoked', `#/advisor/plans/${ADVISOR_PLAN}`, 'ADVISOR');
  expect(root.querySelector('[data-role="advisor-not-in-scope"]')).not.toBeNull();
  expect(root.querySelector('[data-field="notes"]')).toBeNull();
  const clients = createPreviewClients({ role: 'ADVISOR', delayMs: 0 });
  await expect(clients.advisorClient.getStudent('unknown')).rejects.toMatchObject({ code: 'NOT_IN_SCOPE' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('Advisor preview Student and Plan data use only existing safe API allowlists', async () => {
  const clients = createPreviewClients({ role: 'ADVISOR', delayMs: 0 });
  const student = await clients.advisorClient.getStudent(ADVISOR_STUDENT);
  const plan = await clients.advisorClient.getPlan(ADVISOR_PLAN);
  expect(student.institutional_email).toBeUndefined();
  expect(student.external_subject).toBeUndefined();
  expect(plan.review_notes).toBeUndefined();
  expect(plan.project).toBeUndefined();
  expect(plan.status).toBe('APPROVED');
  expect(global.fetch).not.toHaveBeenCalled();
});
