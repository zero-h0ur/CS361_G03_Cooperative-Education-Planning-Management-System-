/** @jest-environment jsdom */

const { AUTH_ERROR_CODES } = require('../tmp/frontend-test-modules/auth/auth-errors.cjs');
const {
  createShellApp,
  scrubAuthCallbackUrl
} = require('../tmp/frontend-test-modules/shell-app.cjs');

function createHarness({
  hash = '',
  search = '',
  pathname = '/app.html',
  session = { role: 'STUDENT' },
  error = null,
  renderRouteContent
} = {}) {
  document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
  window.sessionStorage.clear();

  const location = { pathname, search, hash };
  const history = {
    replaceState: jest.fn((_state, _title, nextUrl) => {
      const parsed = new URL(nextUrl, 'https://app.example.com');
      location.pathname = parsed.pathname;
      location.search = parsed.search;
      location.hash = parsed.hash;
    })
  };
  const eventTarget = new EventTarget();
  const loadSession = error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue(session);
  const startLogin = jest.fn().mockResolvedValue(undefined);
  const restartLogin = jest.fn().mockResolvedValue(undefined);
  const logout = jest.fn().mockResolvedValue(undefined);
  const root = document.getElementById('authenticatedApp');

  const app = createShellApp({
    root,
    loadSession,
    startLogin,
    restartLogin,
    logout,
    location,
    eventTarget,
    storage: window.sessionStorage,
    history,
    renderRouteContent
  });

  return {
    app,
    root,
    location,
    history,
    eventTarget,
    loadSession,
    startLogin,
    restartLogin,
    logout
  };
}

describe('Issue #71: Login, Logout and expired-session UX', () => {
  it('restores a remembered allowlisted return route after login callback completes', async () => {
    const firstVisit = createHarness({
      hash: '#/student/plan',
      error: { code: AUTH_ERROR_CODES.NOT_SIGNED_IN }
    });

    await firstVisit.app.start();
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBe('#/student/plan');
    firstVisit.app.destroy();

    // Simulate Cognito redirect back to app.html?code=...&state=... with empty hash
    const callbackLocation = {
      pathname: '/app.html',
      search: '?code=oauth-auth-code&state=csrf-state-token',
      hash: ''
    };
    const history = {
      replaceState: jest.fn()
    };
    const root = document.getElementById('authenticatedApp');
    const callbackApp = createShellApp({
      root,
      loadSession: jest.fn().mockResolvedValue({ role: 'STUDENT' }),
      startLogin: jest.fn(),
      restartLogin: jest.fn(),
      logout: jest.fn(),
      location: callbackLocation,
      eventTarget: new EventTarget(),
      storage: window.sessionStorage,
      history
    });

    await callbackApp.start();

    expect(callbackLocation.hash).toBe('#/student/plan');
    expect(callbackLocation.search).toBe('');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/app.html');
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBeNull();
    expect(root.querySelector('h1').textContent).toBe('แผนสหกิจของฉัน');
    expect(root.textContent).not.toContain('oauth-auth-code');
  });

  it('ignores a remembered return route owned by another role and falls back to the signed-in role default route', async () => {
    window.sessionStorage.setItem('co-ed:return-route', '#/staff/review');
    const location = { pathname: '/app.html', search: '', hash: '' };
    const root = document.getElementById('authenticatedApp');
    document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
    const mountedRoot = document.getElementById('authenticatedApp');

    const app = createShellApp({
      root: mountedRoot,
      loadSession: jest.fn().mockResolvedValue({ role: 'STUDENT' }),
      startLogin: jest.fn(),
      restartLogin: jest.fn(),
      logout: jest.fn(),
      location,
      eventTarget: new EventTarget(),
      storage: window.sessionStorage
    });

    await app.start();

    expect(location.hash).toBe('#/student/profile');
    expect(mountedRoot.querySelector('h1').textContent).toBe('ข้อมูลนักศึกษา');
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBeNull();
  });

  it('scrubs OAuth codes, errors, tokens, iss, and sub from query string and hash fragments', () => {
    const location = {
      pathname: '/app.html',
      search: '?code=secret-code&state=opaque&iss=https%3A%2F%2Fcognito&sub=user-sub-123&view=compact',
      hash: '#access_token=raw-jwt-token&id_token=raw-id-token'
    };
    const history = { replaceState: jest.fn() };

    scrubAuthCallbackUrl(location, history);

    expect(location.hash).toBe('');
    expect(location.search).toBe('?view=compact');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/app.html?view=compact');
  });

  it('clears stored return route, aborts route work, and removes private content immediately on logout', async () => {
    let routeSignal = null;
    let resolveLogout;
    const pendingLogout = new Promise((resolve) => {
      resolveLogout = resolve;
    });

    const harness = createHarness({
      hash: '#/student/profile',
      session: { role: 'STUDENT' },
      renderRouteContent: ({ signal }) => {
        routeSignal = signal;
        const privateSection = document.createElement('section');
        privateSection.textContent = 'ข้อมูลส่วนตัวของนักศึกษา 65010001';
        return privateSection;
      }
    });
    harness.logout.mockReturnValue(pendingLogout);
    window.sessionStorage.setItem('co-ed:return-route', '#/student/plan');

    await harness.app.start();
    expect(harness.root.textContent).toContain('ข้อมูลส่วนตัวของนักศึกษา 65010001');

    const logoutButton = [...harness.root.querySelectorAll('button')]
      .find((button) => button.textContent === 'ออกจากระบบ');
    logoutButton.click();

    // Immediately upon clicking logout (before provider logout resolves):
    expect(routeSignal.aborted).toBe(true);
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBeNull();
    expect(harness.root.textContent).not.toContain('ข้อมูลส่วนตัวของนักศึกษา 65010001');
    expect(harness.root.textContent).toContain('กำลังออกจากระบบ');

    resolveLogout();
    await Promise.resolve();
    expect(harness.logout).toHaveBeenCalledTimes(1);
  });

  it('immediately clears private UI and shows accessible expired-session alert when a route reports mid-session 401 expiry', async () => {
    let triggerRouteExpiry = null;
    let routeSignal = null;

    const harness = createHarness({
      hash: '#/student/profile',
      session: { role: 'STUDENT' },
      renderRouteContent: ({ signal, onSessionExpired }) => {
        routeSignal = signal;
        triggerRouteExpiry = onSessionExpired;
        const privateNode = document.createElement('div');
        privateNode.textContent = 'รหัสนักศึกษา 65010099 · ข้อมูลเฉพาะตัว';
        return privateNode;
      }
    });

    await harness.app.start();
    expect(harness.root.textContent).toContain('รหัสนักศึกษา 65010099 · ข้อมูลเฉพาะตัว');

    // Simulate a protected API call inside the route receiving HTTP 401
    triggerRouteExpiry();

    expect(routeSignal.aborted).toBe(true);
    expect(harness.root.textContent).not.toContain('รหัสนักศึกษา 65010099 · ข้อมูลเฉพาะตัว');
    expect(harness.root.querySelector('[role="alert"]')).not.toBeNull();
    expect(harness.root.textContent).toContain('Session หมดอายุ');
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBe('#/student/profile');

    const reloginButton = [...harness.root.querySelectorAll('button')]
      .find((button) => button.textContent === 'เข้าสู่ระบบอีกครั้ง');
    expect(reloginButton).toBeDefined();
    reloginButton.click();
    await Promise.resolve();

    expect(harness.restartLogin).toHaveBeenCalledTimes(1);
  });
});
