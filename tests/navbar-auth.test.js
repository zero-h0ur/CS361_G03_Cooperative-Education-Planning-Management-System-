/** @jest-environment jsdom */

function createFakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.fake-signature`;
}

describe('public navbar authentication state (navbar-auth.js)', () => {
  beforeEach(() => {
    window.__TEST_RELOAD_HOOK__ = jest.fn();
    window.sessionStorage.clear();
    document.body.innerHTML = `
      <header class="header">
        <div class="auth-buttons">
          <a href="app.html" class="btn-login"><span>เข้าสู่ระบบ</span></a>
        </div>
      </header>
    `;
  });

  afterEach(() => {
    jest.resetModules();
  });

  function loadNavbarAuth() {
    jest.isolateModules(() => {
      require('../navbar-auth.js');
    });
  }

  test('leaves login button untouched when visitor is anonymous', () => {
    loadNavbarAuth();

    const authContainer = document.querySelector('.auth-buttons');
    expect(authContainer.querySelector('.btn-login')).not.toBeNull();
    expect(authContainer.querySelector('.user-nav-dropdown-wrapper')).toBeNull();
  });

  test('renders user avatar and dropdown menu when student session is present in sessionStorage', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createFakeJwt({
      name: 'สมชาย ใจดี',
      email: 'somchai@dome.tu.ac.th',
      'custom:role': 'STUDENT',
      exp: futureExp
    });
    window.sessionStorage.setItem('CognitoIdentityServiceProvider.test-client.somchai.idToken', token);

    loadNavbarAuth();

    const authContainer = document.querySelector('.auth-buttons');
    expect(authContainer.querySelector('.btn-login')).toBeNull();

    const wrapper = authContainer.querySelector('.user-nav-dropdown-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper.textContent).toContain('สมชาย ใจดี');
    expect(wrapper.textContent).toContain('นักศึกษา');

    const avatarBtn = authContainer.querySelector('#userNavAvatarBtn');
    expect(avatarBtn.getAttribute('aria-expanded')).toBe('false');

    // Click to open dropdown
    avatarBtn.click();
    expect(wrapper.classList.contains('is-open')).toBe(true);
    expect(avatarBtn.getAttribute('aria-expanded')).toBe('true');

    // Check dropdown contents
    const dashboardLink = authContainer.querySelector('a[href="app.html#/student/profile"]');
    expect(dashboardLink).not.toBeNull();
    expect(dashboardLink.textContent).toContain('ไปยังแดชบอร์ดหลัก');

    const planLink = authContainer.querySelector('a[href="app.html#/student/plan"]');
    expect(planLink).not.toBeNull();
    expect(planLink.textContent).toContain('แผนสหกิจของฉัน');

    // Click outside to close
    document.body.click();
    expect(wrapper.classList.contains('is-open')).toBe(false);
  });

  test('clears session and reloads page on logout click', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createFakeJwt({
      name: 'อาจารย์ ผู้ดูแล',
      email: 'advisor@dome.tu.ac.th',
      'custom:role': 'ADVISOR',
      exp: futureExp
    });
    window.sessionStorage.setItem('CognitoIdentityServiceProvider.test-client.advisor.idToken', token);

    loadNavbarAuth();

    const logoutBtn = document.querySelector('#navLogoutBtn');
    expect(logoutBtn).not.toBeNull();

    logoutBtn.click();

    expect(window.sessionStorage.length).toBe(0);
    expect(window.__TEST_RELOAD_HOOK__).toHaveBeenCalledTimes(1);
  });
});
