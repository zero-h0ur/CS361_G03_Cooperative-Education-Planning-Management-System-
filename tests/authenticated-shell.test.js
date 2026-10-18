/** @jest-environment jsdom */

const { AUTH_ERROR_CODES } = require('../tmp/frontend-test-modules/auth/auth-errors.cjs');
const {
  createShellApp,
  renderStartupFailure
} = require('../tmp/frontend-test-modules/shell-app.cjs');

function setup({ hash = '', session = { role: 'STUDENT' }, error } = {}) {
  document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
  window.sessionStorage.clear();

  const location = { hash };
  const eventTarget = new EventTarget();
  const loadSession = error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue(session);
  const restartLogin = jest.fn().mockResolvedValue(undefined);
  const logout = jest.fn().mockResolvedValue(undefined);
  const root = document.getElementById('authenticatedApp');
  const app = createShellApp({
    root,
    loadSession,
    restartLogin,
    logout,
    location,
    eventTarget,
    storage: window.sessionStorage
  });

  return { app, root, location, eventTarget, loadSession, restartLogin, logout };
}

describe('authenticated V3 shell and route guards', () => {
  it('renders an accessible loading state before session bootstrap completes', () => {
    let resolveSession;
    const pendingSession = new Promise((resolve) => {
      resolveSession = resolve;
    });
    const context = setup();
    context.loadSession.mockReturnValue(pendingSession);

    const startPromise = context.app.start();

    expect(context.root.getAttribute('aria-busy')).toBe('true');
    expect(context.root.querySelector('[role="status"]')).not.toBeNull();
    expect(context.root.textContent).toContain('กำลังตรวจสอบ Session');

    resolveSession({ role: 'STUDENT' });
    return startPromise;
  });

  it.each([
    ['STUDENT', '#/student/profile', ['ข้อมูลของฉัน', 'แผนสหกิจ'], 'ข้อมูลนักศึกษา'],
    ['STAFF', '#/staff/review', ['คิวตรวจแผน'], 'คิวตรวจแผนสหกิจ'],
    ['ADVISOR', '#/advisor/students', ['นักศึกษาที่ดูแล'], 'นักศึกษาที่ได้รับมอบหมาย']
  ])('renders only %s navigation from the trusted session role', async (role, expectedHash, navLabels, title) => {
    const context = setup({ session: { role } });

    await context.app.start();

    expect(context.location.hash).toBe(expectedHash);
    expect([...context.root.querySelectorAll('.shell-nav__link')].map((link) => link.textContent)).toEqual(navLabels);
    expect(context.root.querySelector('h1').textContent).toBe(title);
    expect(context.root.textContent).toContain('Backend ยังต้องตรวจสิทธิ์ทุก Request');
  });

  it('denies a known route owned by another role', async () => {
    const context = setup({ hash: '#/staff/review', session: { role: 'STUDENT' } });

    await context.app.start();

    expect(context.root.textContent).toContain('ไม่มีสิทธิ์เข้าถึง');
    expect(context.root.textContent).not.toContain('คิวตรวจแผนสหกิจ');
  });

  it('denies an unknown route instead of falling back silently', async () => {
    const context = setup({ hash: '#/admin/all-users', session: { role: 'STUDENT' } });

    await context.app.start();

    expect(context.root.textContent).toContain('ไม่พบ Route นี้ในรายการที่ระบบอนุญาต');
  });

  it('updates the Student view only after an allowlisted hash change', async () => {
    const context = setup({ hash: '#/student/profile' });
    await context.app.start();

    context.location.hash = '#/student/plan';
    context.eventTarget.dispatchEvent(new Event('hashchange'));

    expect(context.root.querySelector('h1').textContent).toBe('แผนสหกิจของฉัน');
    expect(context.root.querySelector('[aria-current="page"]').getAttribute('href')).toBe('#/student/plan');
  });

  it('shows an expired state without an automatic redirect and remembers only an allowlisted route', async () => {
    const context = setup({
      hash: '#/student/plan',
      error: { code: AUTH_ERROR_CODES.SESSION_EXPIRED }
    });

    await context.app.start();

    expect(context.restartLogin).not.toHaveBeenCalled();
    expect(context.root.textContent).toContain('Session หมดอายุ');
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBe('#/student/plan');

    context.root.querySelector('button').click();
    await Promise.resolve();
    expect(context.restartLogin).toHaveBeenCalledTimes(1);
  });

  it('does not preserve an unknown route before login', async () => {
    const context = setup({
      hash: '#/not-allowed',
      error: { code: AUTH_ERROR_CODES.SESSION_EXPIRED }
    });

    await context.app.start();

    expect(window.sessionStorage.getItem('co-ed:return-route')).toBeNull();
  });

  it('shows 403 as access denied without starting login', async () => {
    const context = setup({ error: { code: AUTH_ERROR_CODES.ACCESS_DENIED } });

    await context.app.start();

    expect(context.root.textContent).toContain('ไม่มีสิทธิ์เข้าถึง');
    expect(context.restartLogin).not.toHaveBeenCalled();
  });

  it('renders a recoverable unavailable state for malformed or network failures', async () => {
    const context = setup({ error: { code: AUTH_ERROR_CODES.INVALID_RESPONSE } });

    await context.app.start();

    expect(context.root.textContent).toContain('ตรวจสอบ Session ไม่สำเร็จ');
    expect(context.root.querySelector('button').textContent).toBe('ลองอีกครั้ง');
  });

  it('invokes logout from the protected shell without trusting the UI for authorization', async () => {
    const context = setup();
    await context.app.start();

    const logoutButton = [...context.root.querySelectorAll('button')]
      .find((button) => button.textContent === 'ออกจากระบบ');
    logoutButton.click();
    await Promise.resolve();

    expect(context.logout).toHaveBeenCalledTimes(1);
    expect(context.root.textContent).toContain('กำลังออกจากระบบ');
  });

  it('keeps the public directory available when auth configuration is missing', () => {
    document.body.innerHTML = '<div id="authenticatedApp"></div>';
    const root = document.getElementById('authenticatedApp');

    renderStartupFailure(root);

    const link = root.querySelector('a');
    expect(root.textContent).toContain('การตั้งค่าระบบยืนยันตัวตนยังไม่ครบ');
    expect(link.getAttribute('href')).toBe('company-directory.html');
  });
});
