import { subscribeToLogout } from './auth/auth-storage.js';

const MENU = Object.freeze({
  STUDENT: { label: 'นักศึกษา', badge: 'badge-student', dashboard: '#/student/profile',
    secondary: { label: 'แผนสหกิจของฉัน', hash: '#/student/plan', icon: 'fa-clipboard-list' } },
  STAFF: { label: 'เจ้าหน้าที่', badge: 'badge-staff', dashboard: '#/staff/students',
    secondary: { label: 'ค้นหาแผนสหกิจ', hash: '#/staff/plans', icon: 'fa-list-check' } },
  ADVISOR: { label: 'อาจารย์ที่ปรึกษา', badge: 'badge-advisor', dashboard: '#/advisor/students' }
});
function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function icon(name) {
  const result = node('i', `fa-solid ${name}`); result.setAttribute('aria-hidden', 'true'); return result;
}

/** Role comes only from the verified /me client, never JWT claims or browser mocks. */
export function createPublicNavbar({ container, authClient, sessionClient, eventTarget = window } = {}) {
  let request = null;
  let sequence = 0;
  let destroyed = false;
  let signingOut = false;
  let toggle = () => {};
  let trigger = null;

  function anonymous(message = '') {
    toggle = () => {}; trigger = null;
    const link = node('a', 'btn-login', 'เข้าสู่ระบบ'); link.href = 'app.html';
    container.replaceChildren(link);
    if (message) {
      const status = node('span', 'navbar-auth-status', message);
      status.setAttribute('role', 'status'); container.append(status);
    }
  }

  function invalidate() {
    sequence += 1; request?.abort();
    anonymous();
    Promise.resolve(authClient.invalidateLocalSession?.()).catch(() => {});
  }

  async function signOut() {
    if (signingOut) return;
    signingOut = true; sequence += 1; request?.abort();
    anonymous('กำลังออกจากระบบ');
    container.querySelector('a').removeAttribute('href');
    try { await authClient.logout(); }
    catch {
      anonymous('ยังยืนยันการออกจาก Cognito ไม่สำเร็จ กรุณาลองอีกครั้ง');
      const retry = node('button', 'btn-login', 'ลองออกจากระบบอีกครั้ง');
      retry.type = 'button'; retry.addEventListener('click', signOut); container.append(retry);
    } finally { signingOut = false; }
  }

  function render(role, identity) {
    const config = MENU[role];
    if (!config) { anonymous(); return; }
    const name = typeof identity?.name === 'string' ? identity.name : 'ผู้ใช้งาน';
    const email = typeof identity?.email === 'string' ? identity.email : '';
    const initial = [...name][0]?.toUpperCase() || 'U';
    const wrapper = node('div', 'user-nav-dropdown-wrapper');
    wrapper.id = 'userNavDropdownWrapper';
    trigger = node('button', 'user-nav-avatar-btn'); trigger.id = 'userNavAvatarBtn'; trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', 'userNavDropdownMenu');
    trigger.setAttribute('aria-label', 'เมนูผู้ใช้งาน'); trigger.setAttribute('aria-haspopup', 'menu');
    const avatar = node('span', 'user-avatar-circle');
    avatar.append(node('span', 'user-avatar-initials', initial));
    const dot = node('span', 'user-status-indicator'); dot.setAttribute('aria-hidden', 'true'); avatar.append(dot);
    const summary = node('span', 'user-nav-summary');
    summary.append(node('span', 'user-nav-name', name), node('span', `user-nav-badge ${config.badge}`, config.label));
    trigger.append(avatar, summary, icon('fa-chevron-down user-chevron'));
    const menu = node('div', 'user-nav-dropdown-menu'); menu.id = 'userNavDropdownMenu';
    menu.setAttribute('role', 'menu'); menu.hidden = true;
    menu.setAttribute('aria-label', `เมนู${config.label}`);
    const header = node('div', 'dropdown-header');
    const details = node('div', 'dropdown-user-info');
    details.append(node('p', 'dropdown-user-name', name));
    if (email) details.append(node('p', 'dropdown-user-email', email));
    details.append(node('span', `user-nav-badge ${config.badge}`, config.label));
    header.append(node('div', 'dropdown-avatar-large', initial), details);
    const links = node('div', 'dropdown-links');
    for (const entry of [{ label: 'ไปยังแดชบอร์ดหลัก', hash: config.dashboard, icon: 'fa-gauge-high' }, config.secondary].filter(Boolean)) {
      const link = node('a', 'dropdown-item'); link.href = `app.html${entry.hash}`;
      link.setAttribute('role', 'menuitem'); link.append(icon(entry.icon), node('span', '', entry.label)); links.append(link);
    }
    const logout = node('button', 'dropdown-item dropdown-logout-btn'); logout.type = 'button'; logout.id = 'navLogoutBtn';
    logout.setAttribute('role', 'menuitem'); logout.append(icon('fa-right-from-bracket'), node('span', '', 'ออกจากระบบ'));
    logout.addEventListener('click', signOut);
    menu.append(header, node('div', 'dropdown-divider'), links, node('div', 'dropdown-divider'), logout);
    wrapper.append(trigger, menu); container.replaceChildren(wrapper);
    toggle = (open, focus = false) => {
      wrapper.classList.toggle('is-open', open); menu.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (focus) menu.querySelector('[role="menuitem"]')?.focus();
    };
    trigger.addEventListener('click', () => toggle(menu.hidden));
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); toggle(true, true);
        if (event.key === 'ArrowUp') [...menu.querySelectorAll('[role="menuitem"]')].at(-1).focus();
      }
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    });
    wrapper.addEventListener('focusout', (event) => { if (!wrapper.contains(event.relatedTarget)) toggle(false); });
  }

  async function start() {
    if (destroyed) return;
    const current = ++sequence;
    request?.abort(); request = new AbortController();
    anonymous();
    try {
      const session = await sessionClient.loadSession({ signal: request.signal });
      if (destroyed || current !== sequence || !Object.hasOwn(MENU, session?.role)) return;
      const identity = await Promise.resolve(authClient.getDisplayIdentity?.()).catch(() => null);
      if (destroyed || current !== sequence) return;
      render(session.role, identity);
    } catch (error) {
      if (!destroyed && current === sequence) {
        anonymous();
        if (error?.code === 'SESSION_EXPIRED') {
          Promise.resolve(authClient.invalidateLocalSession?.()).catch(() => {});
        }
      }
    }
  }
  const outside = (event) => { if (!container.contains(event.target)) toggle(false); };
  const escape = (event) => { if (event.key === 'Escape' && trigger?.getAttribute('aria-expanded') === 'true') {
    toggle(false); trigger.focus();
  } };
  const hide = () => { sequence += 1; request?.abort(); anonymous(); };
  const show = (event) => { if (event.persisted) start(); };
  document.addEventListener('click', outside); document.addEventListener('keydown', escape);
  eventTarget.addEventListener('pagehide', hide); eventTarget.addEventListener('pageshow', show);
  const unsubscribe = subscribeToLogout(invalidate, eventTarget);
  return { start, signOut, destroy() {
    destroyed = true; hide(); unsubscribe();
    document.removeEventListener('click', outside); document.removeEventListener('keydown', escape);
    eventTarget.removeEventListener('pagehide', hide); eventTarget.removeEventListener('pageshow', show);
  } };
}
