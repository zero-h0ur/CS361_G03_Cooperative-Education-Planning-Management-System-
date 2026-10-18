import { AUTH_ERROR_CODES } from './auth/auth-errors.js';
import {
  canRoleAccessRoute,
  getDefaultRoute,
  getRoleLabel,
  getRoute,
  getRoutesForRole,
  isAllowlistedRoute
} from './routes.js';

const RETURN_ROUTE_KEY = 'co-ed:return-route';

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (typeof text === 'string') {
    node.textContent = text;
  }
  return node;
}

function replaceRoot(root, content, busy = false) {
  root.setAttribute('aria-busy', String(busy));
  root.replaceChildren(content);
}

function createActionButton(label, onClick, secondary = false) {
  const button = element('button', secondary ? 'shell-button shell-button--secondary' : 'shell-button', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function renderState(root, {
  eyebrow,
  title,
  description,
  tone = 'neutral',
  busy = false,
  alert = false,
  actions = []
}) {
  const main = element('main', `shell-state shell-state--${tone}`);
  main.setAttribute('aria-busy', String(busy));
  if (alert) {
    main.setAttribute('role', 'alert');
  } else if (busy) {
    main.setAttribute('role', 'status');
  }

  const mark = element('div', 'shell-state__mark', 'CO');
  mark.setAttribute('aria-hidden', 'true');
  const copy = element('div', 'shell-state__copy');
  copy.append(
    element('p', 'shell-state__eyebrow', eyebrow),
    element('h1', 'shell-state__title', title),
    element('p', 'shell-state__description', description)
  );

  if (actions.length > 0) {
    const actionGroup = element('div', 'shell-state__actions');
    actionGroup.append(...actions);
    copy.append(actionGroup);
  }

  main.append(mark, copy);
  replaceRoot(root, main, busy);
}

function safelyReadReturnRoute(storage) {
  try {
    const stored = storage.getItem(RETURN_ROUTE_KEY);
    storage.removeItem(RETURN_ROUTE_KEY);
    return isAllowlistedRoute(stored) ? stored : null;
  } catch {
    return null;
  }
}

function safelyRememberReturnRoute(storage, hash) {
  if (!isAllowlistedRoute(hash)) {
    return;
  }

  try {
    storage.setItem(RETURN_ROUTE_KEY, hash);
  } catch {
    // A blocked storage API must not weaken route checks or stop login.
  }
}

function createBrand() {
  const brand = element('a', 'shell-brand');
  brand.href = 'index.html';
  brand.setAttribute('aria-label', 'CO-ED หน้าแรก');

  const mark = element('span', 'shell-brand__mark', 'CO');
  mark.setAttribute('aria-hidden', 'true');
  brand.append(mark, element('span', 'shell-brand__name', 'CO-ED'));
  return brand;
}

function createNavigation(role, activeHash) {
  const navigation = element('nav', 'shell-nav');
  navigation.setAttribute('aria-label', 'เมนูพื้นที่ผู้ใช้งาน');

  for (const route of getRoutesForRole(role)) {
    const link = element('a', 'shell-nav__link', route.navLabel);
    link.href = route.hash;
    if (route.hash === activeHash) {
      link.classList.add('shell-nav__link--active');
      link.setAttribute('aria-current', 'page');
    }
    navigation.append(link);
  }

  return navigation;
}

function createProtectedLayout({ role, route, onLogout }) {
  const layout = element('div', 'protected-shell');
  const sidebar = element('aside', 'shell-sidebar');
  const identity = element('div', 'shell-role');
  identity.append(
    element('span', 'shell-role__label', 'พื้นที่ผู้ใช้งาน'),
    element('strong', 'shell-role__value', getRoleLabel(role))
  );

  const publicLink = element('a', 'shell-sidebar__public-link', 'ดูรายชื่อสถานประกอบการ');
  publicLink.href = 'company-directory.html';

  sidebar.append(createBrand(), identity, createNavigation(role, route.hash), publicLink);

  const mainColumn = element('div', 'shell-main-column');
  const topbar = element('header', 'shell-topbar');
  const context = element('div', 'shell-context');
  const contextDot = element('span', 'shell-context__dot');
  contextDot.setAttribute('aria-hidden', 'true');
  context.append(contextDot, element('span', null, `Session พร้อมใช้งาน · ${getRoleLabel(role)}`));
  topbar.append(context, createActionButton('ออกจากระบบ', onLogout, true));

  const main = element('main', 'shell-content');
  main.tabIndex = -1;
  const headingGroup = element('div', 'shell-content__heading');
  headingGroup.append(
    element('p', 'shell-content__eyebrow', route.eyebrow),
    element('h1', 'shell-content__title', route.title),
    element('p', 'shell-content__description', route.description)
  );

  const placeholder = element('section', 'shell-placeholder');
  placeholder.setAttribute('aria-labelledby', 'shell-placeholder-title');
  const placeholderTitle = element('h2', 'shell-placeholder__title', 'พื้นที่นี้พร้อมสำหรับการเชื่อมต่อขั้นถัดไป');
  placeholderTitle.id = 'shell-placeholder-title';
  placeholder.append(
    element('span', 'shell-placeholder__index', 'V3'),
    placeholderTitle,
    element('p', 'shell-placeholder__description', route.status)
  );

  const securityNote = element('aside', 'shell-security-note');
  securityNote.append(
    element('strong', null, 'ขอบเขตความปลอดภัย'),
    element('p', null, 'เมนูและ Route guard ช่วยนำทางเท่านั้น Backend ยังต้องตรวจสิทธิ์ทุก Request')
  );

  main.append(headingGroup, placeholder, securityNote);
  mainColumn.append(topbar, main);
  layout.append(sidebar, mainColumn);
  return { layout, main };
}

export function renderStartupFailure(root) {
  const publicDirectory = element('a', 'shell-button shell-button--secondary', 'เปิดรายชื่อสถานประกอบการ');
  publicDirectory.href = 'company-directory.html';

  renderState(root, {
    eyebrow: 'CONFIGURATION REQUIRED',
    title: 'ยังเปิดพื้นที่ผู้ใช้งานไม่ได้',
    description: 'การตั้งค่าระบบยืนยันตัวตนยังไม่ครบ กรุณาติดต่อผู้ดูแลระบบ ส่วนข้อมูลสาธารณะยังเปิดอ่านได้ตามปกติ',
    tone: 'error',
    alert: true,
    actions: [publicDirectory]
  });
}

export function createShellApp({
  root,
  loadSession,
  restartLogin,
  logout,
  location,
  eventTarget,
  storage
}) {
  if (!root || typeof loadSession !== 'function' || typeof restartLogin !== 'function' || typeof logout !== 'function') {
    throw new TypeError('Shell dependencies are incomplete.');
  }

  let activeController = null;
  let currentRole = null;
  let destroyed = false;

  function renderLoading(title = 'กำลังตรวจสอบ Session') {
    renderState(root, {
      eyebrow: 'SECURE SESSION',
      title,
      description: 'ระบบกำลังยืนยันสถานะการเข้าสู่ระบบก่อนแสดงพื้นที่ส่วนตัว',
      tone: 'loading',
      busy: true
    });
  }

  function renderExpired() {
    safelyRememberReturnRoute(storage, location.hash);
    renderState(root, {
      eyebrow: 'SESSION EXPIRED',
      title: 'Session หมดอายุ',
      description: 'เพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่ก่อนกลับไปยังพื้นที่ของคุณ',
      tone: 'warning',
      alert: true,
      actions: [createActionButton('เข้าสู่ระบบอีกครั้ง', async () => {
        safelyRememberReturnRoute(storage, location.hash);
        renderLoading('กำลังไปยังหน้าเข้าสู่ระบบ');
        try {
          await restartLogin();
        } catch {
          renderUnavailable();
        }
      })]
    });
  }

  function renderForbidden(description = 'บัญชีนี้ไม่มีสิทธิ์เปิด Route ที่ร้องขอ') {
    const actions = [];
    const defaultRoute = getDefaultRoute(currentRole);
    if (defaultRoute) {
      actions.push(createActionButton('กลับไปหน้าที่อนุญาต', () => {
        location.hash = defaultRoute;
      }, true));
    }

    renderState(root, {
      eyebrow: 'ACCESS DENIED',
      title: 'ไม่มีสิทธิ์เข้าถึง',
      description,
      tone: 'forbidden',
      alert: true,
      actions
    });
  }

  function renderUnavailable() {
    renderState(root, {
      eyebrow: 'SERVICE UNAVAILABLE',
      title: 'ตรวจสอบ Session ไม่สำเร็จ',
      description: 'ระบบยืนยันตัวตนหรือ Session API ยังไม่พร้อม กรุณาลองใหม่อีกครั้ง',
      tone: 'error',
      alert: true,
      actions: [createActionButton('ลองอีกครั้ง', bootstrap)]
    });
  }

  async function handleLogout() {
    renderLoading('กำลังออกจากระบบ');
    currentRole = null;
    try {
      await logout();
    } catch {
      renderUnavailable();
    }
  }

  function renderCurrentRoute() {
    if (!currentRole) {
      return;
    }

    const route = getRoute(location.hash);
    if (!route || !canRoleAccessRoute(currentRole, location.hash)) {
      renderForbidden(route ? 'Route นี้ไม่อยู่ในสิทธิ์ของบัญชีปัจจุบัน' : 'ไม่พบ Route นี้ในรายการที่ระบบอนุญาต');
      return;
    }

    const { layout, main } = createProtectedLayout({ role: currentRole, route, onLogout: handleLogout });
    replaceRoot(root, layout);
    main.focus({ preventScroll: true });
  }

  function selectInitialRoute() {
    if (location.hash) {
      renderCurrentRoute();
      return;
    }

    const storedRoute = safelyReadReturnRoute(storage);
    const selectedRoute = canRoleAccessRoute(currentRole, storedRoute)
      ? storedRoute
      : getDefaultRoute(currentRole);

    if (!selectedRoute) {
      renderForbidden();
      return;
    }

    location.hash = selectedRoute;
    renderCurrentRoute();
  }

  async function bootstrap() {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    currentRole = null;
    renderLoading();

    try {
      const session = await loadSession({ signal: controller.signal });
      if (destroyed || activeController !== controller) {
        return;
      }
      currentRole = session.role;
      selectInitialRoute();
    } catch (error) {
      if (destroyed || activeController !== controller || error?.name === 'AbortError') {
        return;
      }

      if (error?.code === AUTH_ERROR_CODES.SESSION_EXPIRED) {
        renderExpired();
      } else if (error?.code === AUTH_ERROR_CODES.ACCESS_DENIED) {
        renderForbidden('Session ถูกต้อง แต่บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานพื้นที่ดังกล่าว');
      } else {
        renderUnavailable();
      }
    }
  }

  const handleHashChange = () => renderCurrentRoute();

  return Object.freeze({
    start() {
      destroyed = false;
      eventTarget.addEventListener('hashchange', handleHashChange);
      return bootstrap();
    },
    destroy() {
      destroyed = true;
      activeController?.abort();
      eventTarget.removeEventListener('hashchange', handleHashChange);
    }
  });
}
