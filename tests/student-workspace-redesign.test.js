/** @jest-environment jsdom */
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');

const mounted = [];
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const draft={id:'14100000-0000-4000-8000-000000000001',cycle_id:'cycle-a',status:'DRAFT',updated_at:'2026-11-02T01:00:00Z'};
const submitted={id:'14100000-0000-4000-8000-000000000002',cycle_id:'cycle-b',status:'SUBMITTED',submitted_at:'2026-10-01T01:00:00Z'};
const cycles=[{id:'cycle-a',name:'รอบปัจจุบัน',status:'OPEN'},{id:'cycle-b',name:'รอบก่อน',status:'CLOSED'}];
async function mount({ role = 'STUDENT', hash = '#/student/profile', ...clients } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const location = { hash };
  const events = new EventTarget();
  const logout = jest.fn();
  const app = createShellApp({ root, location, eventTarget: events, storage: null,
    loadSession: async () => ({ role }), startLogin: async () => {}, restartLogin: async () => {}, logout,
    ...clients });
  mounted.push(app);
  await app.start();
  return { root, app, location, events, logout };
}
afterEach(() => { mounted.splice(0).forEach(app => app.destroy()); document.body.replaceChildren(); });

test('Student gets the approved horizontal header, three labelled destinations and no debugging note', async () => {
  const { root } = await mount();
  expect(root.querySelector('.student-portal')).not.toBeNull();
  expect(root.querySelector('.shell-sidebar')).toBeNull();
  expect([...root.querySelectorAll('.shell-nav a')].map(a => a.textContent))
    .toEqual(['ข้อมูลของฉัน', 'ใบสมัครสหกิจ', 'สถานประกอบการ']);
  expect(root.querySelector('.shell-nav [aria-current=page]').getAttribute('href')).toBe('#/student/profile');
  expect(root.querySelector('.shell-security-note')).toBeNull();
  expect(root.querySelector('.student-page-header__art').getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.student-page-header__art').alt).toBe('');
  expect(root.querySelectorAll('h1')).toHaveLength(1);
  expect(root.querySelector('.student-portal__footer').textContent).toContain('ผู้ประสานงาน');
});

test('account disclosure supports Escape and skip link still focuses the persistent main', async () => {
  const { root } = await mount();
  const account = root.querySelector('.student-account');
  account.open = true;
  account.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(account.open).toBe(false);
  expect(document.activeElement).toBe(account.querySelector('summary'));
  root.querySelector('.shell-skip-link').click();
  expect(document.activeElement).toBe(root.querySelector('main'));
});

test.each([
  ['STAFF', '#/staff/review'], ['ADVISOR', '#/advisor/students'],
  ['COORDINATOR', '#/coordinator/applications'], ['COMMITTEE', '#/committee/applications'], ['ADMIN', '#/admin/operations']
])('%s retains its previous shell and role-scoped navigation', async (role, hash) => {
  const { root } = await mount({ role, hash });
  expect(root.querySelector('.student-portal')).toBeNull();
  expect(root.querySelector('.shell-sidebar')).not.toBeNull();
  expect(root.querySelector('.shell-nav [href="#/student/application"]')).toBeNull();
});

test('bare live list summaries render once, with one prominent draft action and historical read-only action',async()=>{
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles}),list:async()=>[draft,submitted]}});
  await flush();await flush();
  expect(root.querySelectorAll('h1')).toHaveLength(1);
  expect(root.querySelector('.student-feature-action').textContent).toBe('กรอกใบสมัครต่อ');
  expect(root.querySelectorAll('.student-application-table tbody tr')).toHaveLength(1);
  expect(root.querySelector('.student-application-table').textContent).not.toContain('รอบปัจจุบัน');
  expect(root.querySelector('.student-application-table').textContent).toContain('ดูใบสมัคร');
  expect(root.textContent).not.toMatch(/ขั้นที่ 1|100%|ข้อมูลผู้สมัคร · ขั้น/);
  expect(root.querySelectorAll('.student-feature-sections span')).toHaveLength(6);
});

test('additional drafts stay accessible and never get labelled read-only',async()=>{
  const second={...draft,id:'14100000-0000-4000-8000-000000000003',cycle_id:'cycle-c',updated_at:'2026-10-02T01:00:00Z'};
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles}),list:async()=>[draft,second,submitted]}});
  await flush();await flush();
  expect(root.querySelector('.student-application-history h2').textContent).toBe('ใบสมัครอื่น · 2 รายการ');
  const rows=[...root.querySelectorAll('tbody tr')];
  expect(rows[0].textContent).toContain('กรอกต่อ');expect(rows[0].textContent).not.toContain('เปิดดูฉบับที่ส่ง');
});

test('cycle lookup failure does not hide existing applications; empty list has a clear starting action',async()=>{
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>{throw new Error('lookup unavailable');},list:async()=>[draft]}});
  await flush();await flush();
  expect(root.querySelector('.student-feature-action')).not.toBeNull();
  expect(root.textContent).toContain('โหลดข้อมูลรอบสมัครไม่สำเร็จ');
  const empty=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles}),list:async()=>[]}});
  await flush();await flush();
  expect(empty.root.querySelector('.student-cycle-picker summary').textContent).toBe('เลือกรอบสมัครใหม่');
  expect(empty.root.querySelector('.student-empty-state').textContent).toContain('ยังไม่มีใบสมัคร');
});
