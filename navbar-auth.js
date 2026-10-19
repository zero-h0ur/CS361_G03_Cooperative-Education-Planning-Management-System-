/**
 * CO-ED Public Navbar Authentication Handler
 * Dynamically switches the login button to a user profile avatar dropdown
 * when an authenticated session is detected in sessionStorage.
 */
(function initNavbarAuth() {
  function parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  function getSessionInfo() {
    try {
      // 1. Search for Amplify Cognito idToken in sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.endsWith('.idToken') || key.includes('.idToken'))) {
          const rawToken = sessionStorage.getItem(key);
          if (!rawToken) continue;
          const payload = parseJwt(rawToken);
          if (!payload) continue;

          // Check token expiry
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            return null;
          }

          const rawRole = (
            payload['custom:role'] ||
            (Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'][0] : '') ||
            'STUDENT'
          ).toUpperCase();

          const role = ['STUDENT', 'STAFF', 'ADVISOR'].includes(rawRole) ? rawRole : 'STUDENT';
          const email = payload.email || payload['cognito:username'] || '';
          const name = payload.name || payload.given_name || email.split('@')[0] || 'ผู้ใช้งาน';

          return { name, email, role };
        }
      }

      // 2. Check for custom session mock or token if present
      const customSession = sessionStorage.getItem('co-ed:session');
      if (customSession) {
        const parsed = JSON.parse(customSession);
        if (parsed && parsed.role) {
          return {
            name: parsed.name || 'ผู้ใช้งาน',
            email: parsed.email || '',
            role: parsed.role.toUpperCase()
          };
        }
      }
    } catch (e) {
      console.warn('[NavbarAuth] Unable to parse session:', e);
    }
    return null;
  }

  const ROLE_CONFIG = {
    STUDENT: {
      label: 'นักศึกษา',
      badgeClass: 'badge-student',
      dashboardHref: 'app.html#/student/profile',
      secondary: {
        label: 'แผนสหกิจของฉัน',
        icon: 'fa-clipboard-list',
        href: 'app.html#/student/plan'
      }
    },
    STAFF: {
      label: 'เจ้าหน้าที่',
      badgeClass: 'badge-staff',
      dashboardHref: 'app.html#/staff/review',
      secondary: {
        label: 'คิวตรวจแผนสหกิจ',
        icon: 'fa-list-check',
        href: 'app.html#/staff/review'
      }
    },
    ADVISOR: {
      label: 'อาจารย์ที่ปรึกษา',
      badgeClass: 'badge-advisor',
      dashboardHref: 'app.html#/advisor/students',
      secondary: null
    }
  };

  function renderUserProfile(container, session) {
    const config = ROLE_CONFIG[session.role] || ROLE_CONFIG.STUDENT;
    const initial = (session.name || 'U').charAt(0).toUpperCase();

    container.innerHTML = `
      <div class="user-nav-dropdown-wrapper" id="userNavDropdownWrapper">
        <button type="button" class="user-nav-avatar-btn" id="userNavAvatarBtn" aria-expanded="false" aria-haspopup="true" aria-label="เมนูผู้ใช้งาน">
          <span class="user-avatar-circle">
            <span class="user-avatar-initials">${initial}</span>
            <span class="user-status-indicator" aria-hidden="true"></span>
          </span>
          <span class="user-nav-summary">
            <span class="user-nav-name">${session.name}</span>
            <span class="user-nav-badge ${config.badgeClass}">${config.label}</span>
          </span>
          <i class="fa-solid fa-chevron-down user-chevron" aria-hidden="true"></i>
        </button>

        <div class="user-nav-dropdown-menu" id="userNavDropdownMenu" role="menu" aria-hidden="true">
          <div class="dropdown-header">
            <div class="dropdown-avatar-large">
              <span>${initial}</span>
            </div>
            <div class="dropdown-user-info">
              <p class="dropdown-user-name">${session.name}</p>
              ${session.email ? `<p class="dropdown-user-email">${session.email}</p>` : ''}
              <span class="user-nav-badge ${config.badgeClass}">${config.label}</span>
            </div>
          </div>

          <div class="dropdown-divider"></div>

          <div class="dropdown-links">
            <a href="${config.dashboardHref}" class="dropdown-item" role="menuitem">
              <i class="fa-solid fa-gauge-high"></i>
              <span>ไปยังแดชบอร์ดหลัก</span>
            </a>
            ${
              config.secondary
                ? `
            <a href="${config.secondary.href}" class="dropdown-item" role="menuitem">
              <i class="fa-solid ${config.secondary.icon}"></i>
              <span>${config.secondary.label}</span>
            </a>`
                : ''
            }
          </div>

          <div class="dropdown-divider"></div>

          <div class="dropdown-actions">
            <button type="button" class="dropdown-item dropdown-logout-btn" id="navLogoutBtn" role="menuitem">
              <i class="fa-solid fa-right-from-bracket"></i>
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const wrapper = container.querySelector('#userNavDropdownWrapper');
    const avatarBtn = container.querySelector('#userNavAvatarBtn');
    const menu = container.querySelector('#userNavDropdownMenu');
    const logoutBtn = container.querySelector('#navLogoutBtn');

    if (!wrapper || !avatarBtn || !menu) return;

    function toggleMenu(isOpen) {
      const state = typeof isOpen === 'boolean' ? isOpen : !wrapper.classList.contains('is-open');
      wrapper.classList.toggle('is-open', state);
      avatarBtn.setAttribute('aria-expanded', String(state));
      menu.setAttribute('aria-hidden', String(!state));
    }

    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrapper.classList.contains('is-open')) {
        toggleMenu(false);
        avatarBtn.focus();
      }
    });

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        // Clear all session storage tokens
        sessionStorage.clear();
        if (typeof window.__TEST_RELOAD_HOOK__ === 'function') {
          window.__TEST_RELOAD_HOOK__();
          return;
        }
        try {
          window.location.reload();
        } catch {
          window.location.href = 'index.html';
        }
      });
    }
  }

  function setup() {
    const authContainer = document.querySelector('.auth-buttons');
    if (!authContainer) return;

    const session = getSessionInfo();
    if (session) {
      renderUserProfile(authContainer, session);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
