import { AUTH_ERROR_CODES } from './auth/auth-errors.js';
import {
  canRoleAccessRoute,
  getDefaultRoute,
  getRoleLabel,
  getRoute,
  getRoutesForRole,
  isAllowlistedRoute
} from './routes.js';
import {
  renderAdvisorPlanView,
  renderAdvisorStudentDetailView,
  renderAdvisorStudentListView
} from './advisor/advisor-views.js';
import { renderStudentDashboardView } from './student/student-dashboard-view.js';
import { renderStudentPlanView } from './student/student-plan-view.js';
import { renderStaffStudentManagementView, renderStaffReviewHandoff } from './staff/staff-student-management-view.js';

const RETURN_ROUTE_KEY = 'co-ed:return-route';
const SENSITIVE_QUERY_PARAMS = Object.freeze([
  'code',
  'state',
  'session_state',
  'error',
  'error_description',
  'access_token',
  'id_token',
  'refresh_token',
  'token_type',
  'iss',
  'sub'
]);
const SENSITIVE_HASH_PATTERNS = Object.freeze([
  /(?:^|[&#?])access_token=/i,
  /(?:^|[&#?])id_token=/i,
  /(?:^|[&#?])refresh_token=/i,
  /(?:^|[&#?])code=/i,
  /(?:^|[&#?])error=/i
]);

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

function safelyClearReturnRoute(storage) {
  try {
    storage?.removeItem(RETURN_ROUTE_KEY);
  } catch {
    // Ignore blocked storage errors during logout cleanup.
  }
}

export function scrubAuthCallbackUrl(location, history = globalThis.history) {
  if (!location || typeof location !== 'object') {
    return;
  }
  // Never assign location.search/hash: in a real browser the search setter always
  // navigates (a full reload) and the hash setter leaves "#" and fires hashchange.
  // history.replaceState rewrites the address bar without either side effect.
  if (!history || typeof history.replaceState !== 'function') {
    return;
  }

  try {
    const search = typeof location.search === 'string' ? location.search : '';
    const hash = typeof location.hash === 'string' ? location.hash : '';
    const params = new URLSearchParams(search);
    let modified = false;

    for (const key of SENSITIVE_QUERY_PARAMS) {
      if (params.has(key)) {
        params.delete(key);
        modified = true;
      }
    }

    const hashHasSecrets = SENSITIVE_HASH_PATTERNS.some((pattern) => pattern.test(hash));
    if (!modified && !hashHasSecrets) {
      return;
    }

    const nextSearch = params.toString();
    const cleanSearch = nextSearch ? `?${nextSearch}` : '';
    const cleanHash = hashHasSecrets ? '' : hash;
    const pathname = typeof location.pathname === 'string' ? location.pathname : 'app.html';

    history.replaceState(null, '', `${pathname}${cleanSearch}${cleanHash}`);
  } catch {
    // Never fail closed on URL cleanup alone.
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

function createNavigation(role, activeRoute) {
  const navigation = element('nav', 'shell-nav');
  navigation.setAttribute('aria-label', 'เมนูพื้นที่ผู้ใช้งาน');

  for (const route of getRoutesForRole(role)) {
    const link = element('a', 'shell-nav__link', route.navLabel);
    link.href = route.hash;
    if (route.hash === activeRoute.hash) {
      link.classList.add('shell-nav__link--active');
      link.setAttribute('aria-current', 'page');
    } else if (route.hash === activeRoute.navHash) {
      // Detail page: highlight its parent menu entry without claiming it is the current page
      link.classList.add('shell-nav__link--active');
    }
    navigation.append(link);
  }

  return navigation;
}

function createDefaultPlaceholder(route) {
  const placeholder = element('section', 'shell-placeholder');
  placeholder.setAttribute('aria-labelledby', 'shell-placeholder-title');
  const placeholderTitle = element('h2', 'shell-placeholder__title', 'พื้นที่นี้พร้อมสำหรับการเชื่อมต่อขั้นถัดไป');
  placeholderTitle.id = 'shell-placeholder-title';
  placeholder.append(
    element('span', 'shell-placeholder__index', 'V3'),
    placeholderTitle,
    element('p', 'shell-placeholder__description', route.status)
  );
  return placeholder;
}

function createProtectedLayout({ role, route, onLogout, bodyNode }) {
  const layout = element('div', 'protected-shell');
  const sidebar = element('aside', 'shell-sidebar');
  const identity = element('div', 'shell-role');
  identity.append(
    element('span', 'shell-role__label', 'พื้นที่ผู้ใช้งาน'),
    element('strong', 'shell-role__value', getRoleLabel(role))
  );

  const publicLink = element('a', 'shell-sidebar__public-link', 'ดูรายชื่อสถานประกอบการ');
  publicLink.href = 'company-directory.html';

  sidebar.append(createBrand(), identity, createNavigation(role, route), publicLink);

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

  const contentRegion = bodyNode || createDefaultPlaceholder(route);

  const securityNote = element('aside', 'shell-security-note');
  securityNote.append(
    element('strong', null, 'ขอบเขตความปลอดภัย'),
    element('p', null, 'เมนูและ Route guard ช่วยนำทางเท่านั้น Backend ยังต้องตรวจสิทธิ์ทุก Request')
  );

  main.append(headingGroup, contentRegion, securityNote);
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
  startLogin,
  restartLogin,
  logout,
  location,
  eventTarget,
  storage,
  history = globalThis.history,
  studentProfileClient = null,
  studentPlanClient = null,
  staffClient = null,
  advisorClient = null,
  renderRouteContent
}) {
  if (
    !root ||
    typeof loadSession !== 'function' ||
    typeof startLogin !== 'function' ||
    typeof restartLogin !== 'function' ||
    typeof logout !== 'function'
  ) {
    throw new TypeError('Shell dependencies are incomplete.');
  }

  let activeController = null;
  let routeController = null;
  // Hash of the protected route currently on screen; lets handleHashChange skip the
  // hashchange event that follows our own navigation, which would render the route twice.
  let renderedHash = null;
  let currentRole = null;
  let destroyed = false;

  function abortRouteWork() {
    routeController?.abort();
    routeController = null;
    renderedHash = null;
  }

  function renderLoading(title = 'กำลังตรวจสอบ Session') {
    renderState(root, {
      eyebrow: 'SECURE SESSION',
      title,
      description: 'ระบบกำลังยืนยันสถานะการเข้าสู่ระบบก่อนแสดงพื้นที่ส่วนตัว',
      tone: 'loading',
      busy: true
    });
  }

  // First visit in this tab: ask the user to sign in explicitly. No automatic redirect,
  // so a failed or cancelled Cognito login cannot cause a redirect loop.
  function renderSignIn() {
    abortRouteWork();
    currentRole = null;
    safelyRememberReturnRoute(storage, location.hash);
    const publicDirectory = element('a', 'shell-button shell-button--secondary', 'ดูรายชื่อสถานประกอบการ');
    publicDirectory.href = 'company-directory.html';

    renderState(root, {
      eyebrow: 'SIGN IN',
      title: 'กรุณาเข้าสู่ระบบ',
      description: 'เข้าสู่ระบบด้วยบัญชีที่มหาวิทยาลัยจัดเตรียมให้ เพื่อเปิดพื้นที่ผู้ใช้งานของคุณ',
      tone: 'neutral',
      actions: [
        createActionButton('เข้าสู่ระบบ', async () => {
          safelyRememberReturnRoute(storage, location.hash);
          renderLoading('กำลังไปยังหน้าเข้าสู่ระบบ');
          try {
            await startLogin();
          } catch {
            renderUnavailable();
          }
        }),
        publicDirectory
      ]
    });
  }

  function renderExpired() {
    abortRouteWork();
    currentRole = null;
    safelyRememberReturnRoute(storage, location.hash);
    const publicDirectory = element('a', 'shell-button shell-button--secondary', 'ดูรายชื่อสถานประกอบการ');
    publicDirectory.href = 'company-directory.html';

    renderState(root, {
      eyebrow: 'SESSION EXPIRED',
      title: 'Session หมดอายุ',
      description: 'เพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่ก่อนกลับไปยังพื้นที่ของคุณ',
      tone: 'warning',
      alert: true,
      actions: [
        createActionButton('เข้าสู่ระบบอีกครั้ง', async () => {
          safelyRememberReturnRoute(storage, location.hash);
          renderLoading('กำลังไปยังหน้าเข้าสู่ระบบ');
          try {
            await restartLogin();
          } catch {
            renderUnavailable();
          }
        }),
        publicDirectory
      ]
    });
  }

  function renderForbidden(description = 'บัญชีนี้ไม่มีสิทธิ์เปิด Route ที่ร้องขอ') {
    abortRouteWork();
    const actions = [];
    const defaultRoute = getDefaultRoute(currentRole);
    if (defaultRoute) {
      actions.push(createActionButton('กลับไปหน้าที่อนุญาต', () => {
        location.hash = defaultRoute;
      }, true));
    }
    // Let a user signed in with the wrong account switch accounts
    actions.push(createActionButton('ออกจากระบบ', handleLogout, true));

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
    abortRouteWork();
    renderState(root, {
      eyebrow: 'SERVICE UNAVAILABLE',
      title: 'ตรวจสอบ Session ไม่สำเร็จ',
      description: 'ระบบยืนยันตัวตนหรือ Session API ยังไม่พร้อม กรุณาลองใหม่อีกครั้ง',
      tone: 'error',
      alert: true,
      actions: [
        createActionButton('ลองอีกครั้ง', bootstrap),
        createActionButton('ออกจากระบบ', handleLogout, true)
      ]
    });
  }

  async function handleLogout() {
    activeController?.abort();
    abortRouteWork();
    currentRole = null;
    safelyClearReturnRoute(storage);
    renderLoading('กำลังออกจากระบบ');
    try {
      await logout();
    } catch {
      renderUnavailable();
    }
  }

  function handleSessionExpired() {
    if (destroyed) {
      return;
    }
    activeController?.abort();
    renderExpired();
  }

  function navigateToAllowlistedRoute(targetHash) {
    if (!isAllowlistedRoute(targetHash)) {
      return;
    }
    const changed = location.hash !== targetHash;
    location.hash = targetHash;
    if (changed) {
      renderCurrentRoute();
    }
  }

  function resolveRouteBody({ role, route, signal }) {
    if (typeof renderRouteContent === 'function') {
      return renderRouteContent({
        role,
        route,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message),
        onNavigate: navigateToAllowlistedRoute
      });
    }

    if (role === 'STUDENT' && route.hash === '#/student/profile' && studentProfileClient) {
      return renderStudentDashboardView({
        profileClient: studentProfileClient,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message),
        onNavigate: navigateToAllowlistedRoute
      });
    }

    if (role === 'STUDENT' && route.hash === '#/student/plan' && studentPlanClient) {
      return renderStudentPlanView({
        planClient: studentPlanClient,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message)
      });
    }

    if (role === 'STAFF') {
      if (route.staffMode && staffClient) {
        return renderStaffStudentManagementView({
          mode: route.staffMode,
          initialFilters: route.filters,
          staffClient, signal,
          onSessionExpired: handleSessionExpired,
          onAccessDenied: (message) => renderForbidden(message),
          onRouteStateChange: (hash) => {
            const target = getRoute(hash);
            if (destroyed || signal.aborted || currentRole !== 'STAFF' ||
                !target || target.role !== 'STAFF' || target.staffMode !== route.staffMode) return;
            try {
              // Replace the current entry; never put q/names/student numbers in history.
              history?.replaceState(null, '', `${location.pathname || '/app.html'}${hash}`);
              renderedHash = hash;
            } catch { /* History restrictions must not block scoped search. */ }
          }
        });
      }
      if (route.params?.planId) return renderStaffReviewHandoff({ planId: route.params.planId });
    }

    if (role === 'ADVISOR' && advisorClient) {
      const advisorViewOptions = {
        advisorClient,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message)
      };
      if (route.hash === '#/advisor/students') {
        return renderAdvisorStudentListView(advisorViewOptions);
      }
      if (route.params?.studentId) {
        return renderAdvisorStudentDetailView({ ...advisorViewOptions, studentId: route.params.studentId });
      }
      if (route.params?.planId) {
        return renderAdvisorPlanView({ ...advisorViewOptions, planId: route.params.planId });
      }
    }

    return null;
  }

  function renderCurrentRoute() {
    if (!currentRole) {
      return;
    }

    abortRouteWork();
    renderedHash = location.hash;
    const route = getRoute(location.hash);
    if (!route || !canRoleAccessRoute(currentRole, location.hash)) {
      renderForbidden(route ? 'Route นี้ไม่อยู่ในสิทธิ์ของบัญชีปัจจุบัน' : 'ไม่พบ Route นี้ในรายการที่ระบบอนุญาต');
      return;
    }

    const controller = new AbortController();
    routeController = controller;

    const customBody = resolveRouteBody({
      role: currentRole,
      route,
      signal: controller.signal
    });

    const { layout, main } = createProtectedLayout({
      role: currentRole,
      route,
      onLogout: handleLogout,
      bodyNode: customBody
    });
    replaceRoot(root, layout);
    main.focus({ preventScroll: true });
  }

  function selectInitialRoute() {
    if (location.hash && isAllowlistedRoute(location.hash)) {
      safelyClearReturnRoute(storage);
      renderCurrentRoute();
      return;
    }

    if (location.hash && !isAllowlistedRoute(location.hash)) {
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
    abortRouteWork();
    const controller = new AbortController();
    activeController = controller;
    currentRole = null;
    renderLoading();

    try {
      const session = await loadSession({ signal: controller.signal });
      scrubAuthCallbackUrl(location, history);
      if (destroyed || activeController !== controller) {
        return;
      }
      currentRole = session.role;
      selectInitialRoute();
    } catch (error) {
      scrubAuthCallbackUrl(location, history);
      if (destroyed || activeController !== controller || error?.name === 'AbortError') {
        return;
      }

      if (error?.code === AUTH_ERROR_CODES.NOT_SIGNED_IN) {
        renderSignIn();
      } else if (error?.code === AUTH_ERROR_CODES.SESSION_EXPIRED) {
        renderExpired();
      } else if (error?.code === AUTH_ERROR_CODES.ACCESS_DENIED) {
        renderForbidden('Session ถูกต้อง แต่บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานพื้นที่ดังกล่าว');
      } else {
        renderUnavailable();
      }
    }
  }

  const handleHashChange = () => {
    if (location.hash === renderedHash) {
      return;
    }
    renderCurrentRoute();
  };

  return Object.freeze({
    start() {
      destroyed = false;
      eventTarget.addEventListener('hashchange', handleHashChange);
      return bootstrap();
    },
    expireSession() {
      handleSessionExpired();
    },
    destroy() {
      destroyed = true;
      activeController?.abort();
      abortRouteWork();
      eventTarget.removeEventListener('hashchange', handleHashChange);
    }
  });
}
