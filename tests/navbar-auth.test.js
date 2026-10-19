/** @jest-environment jsdom */
const { createPublicNavbar } = require('../tmp/frontend-test-modules/public-navbar.cjs');
const { createSessionClient } = require('../tmp/frontend-test-modules/auth/session-client.cjs');
const { AUTH_LOGOUT_EVENT_KEY } = require('../tmp/frontend-test-modules/auth/auth-storage.cjs');
const fs = require('node:fs'); const path = require('node:path');
let navbar;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(role = 'STUDENT', identity = { name: 'ผู้ใช้ทดสอบ', email: 'demo@example.invalid' }, loadSession) {
  const container = document.querySelector('.auth-buttons');
  const authClient = { logout: jest.fn().mockResolvedValue(), invalidateLocalSession: jest.fn().mockResolvedValue(),
    getDisplayIdentity: jest.fn().mockResolvedValue(identity) };
  const sessionClient = { loadSession: loadSession || jest.fn().mockResolvedValue({ role }) };
  navbar = createPublicNavbar({ container, authClient, sessionClient });
  return { container, authClient, sessionClient };
}
beforeEach(() => {
  document.body.innerHTML = '<div class="auth-buttons"><a class="btn-login" href="app.html">เข้าสู่ระบบ</a></div>';
  sessionStorage.clear(); localStorage.clear();
});
afterEach(() => { navbar?.destroy(); navbar = null; });

test.each([
  ['STUDENT', 'นักศึกษา', '#/student/profile', '#/student/plan'],
  ['STAFF', 'เจ้าหน้าที่', '#/staff/students', '#/staff/plans'],
  ['ADVISOR', 'อาจารย์ที่ปรึกษา', '#/advisor/students', null]
])('uses verified %s role and only the matching links', async (role, label, home, secondary) => {
  const { container } = setup(role); await navbar.start();
  expect(container.querySelector('.user-nav-badge').textContent).toBe(label);
  expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href')))
    .toEqual([`app.html${home}`, ...(secondary ? [`app.html${secondary}`] : [])]);
});

test.each(['ADMIN', 'unknown', 'student', undefined, 'toString'])('unknown role %s never falls back to STUDENT', async (role) => {
  const { container } = setup(role, {}, async () => ({ role })); await navbar.start();
  expect(container.querySelector('.btn-login')).not.toBeNull();
  expect(container.querySelector('.user-nav-dropdown-wrapper')).toBeNull();
});

test.each([401, 403, 503])('HTTP %s leaves Public readable and never displays stale mock identity', async (status) => {
  sessionStorage.setItem('co-ed:session', JSON.stringify({ role: 'STUDENT', name: 'fake' }));
  sessionStorage.setItem('CognitoIdentityServiceProvider.fake.idToken', 'fake');
  const sessionClient = createSessionClient({ apiBaseUrl: 'https://api.example.invalid', currentOrigin: 'http://localhost',
    getAccessToken: async () => 'access', fetchImpl: async () => ({ ok: false, status }) });
  const { container } = setup('STAFF', {}, sessionClient.loadSession); await navbar.start();
  expect(container.querySelector('.user-nav-badge')).toBeNull(); expect(container.textContent).not.toContain('fake');
});

test('untrusted names/email remain plain text and never execute as HTML', async () => {
  const { container } = setup('STAFF', { name: '<img src=x onerror=alert(1)>', email: '<svg/onload=alert(1)>' });
  await navbar.start();
  expect(container.querySelector('img,svg,script')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
});

test('keyboard opens menu, moves focus, Escape closes and restores trigger focus', async () => {
  const { container } = setup(); await navbar.start();
  const trigger = container.querySelector('#userNavAvatarBtn'); trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement.getAttribute('role')).toBe('menuitem');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(document.activeElement.id).toBe('navLogoutBtn');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(container.querySelector('#userNavDropdownMenu').hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

test('logout clears private UI immediately and invokes shared auth logout', async () => {
  let finish; const { container, authClient } = setup('STAFF'); await navbar.start();
  authClient.logout.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  container.querySelector('#navLogoutBtn').click();
  expect(container.textContent).not.toContain('ผู้ใช้ทดสอบ'); expect(container.querySelectorAll('a[href]')).toHaveLength(0);
  expect(authClient.logout).toHaveBeenCalledTimes(1); finish(); await flush();
});

test('late verification cannot recreate the profile after cross-tab logout', async () => {
  let finish; const { container } = setup('STAFF', {}, () => new Promise((resolve) => { finish = resolve; }));
  const pending = navbar.start(); window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT_KEY));
  finish({ role: 'STAFF' }); await pending;
  expect(container.querySelector('.user-nav-badge')).toBeNull();
});

test('bfcache hides stale identity and re-verifies on restore', async () => {
  const { container, sessionClient } = setup('STAFF'); await navbar.start();
  window.dispatchEvent(new Event('pagehide')); expect(container.querySelector('.user-nav-badge')).toBeNull();
  const show = new Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true });
  sessionClient.loadSession.mockRejectedValue({ code: 'NOT_SIGNED_IN' }); window.dispatchEvent(show); await flush();
  expect(container.querySelector('.user-nav-badge')).toBeNull(); expect(sessionClient.loadSession).toHaveBeenCalledTimes(2);
});

test('all Public pages load runtime configuration before the bundled Navbar', () => {
  for (const name of ['index.html', 'requirements.html', 'faq.html', 'company-directory.html']) {
    const html = fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
    expect(html.indexOf('src="runtime-config.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="runtime-config.js"')).toBeLessThan(html.indexOf('src="navbar-auth.js"'));
  }
});
