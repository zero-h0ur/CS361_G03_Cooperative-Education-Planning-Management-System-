/** @jest-environment jsdom */
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');

const mounted = [];
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
