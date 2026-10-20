import { AUTH_ERROR_CODES } from './auth/auth-errors.js';
import { subscribeToLogout } from './auth/auth-storage.js';
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
import { renderStaffPlanReviewView, renderStaffReviewQueueView } from './staff/staff-review-views.js';
import { renderStudentDashboardView } from './student/student-dashboard-view.js';
import { renderStudentPlanView } from './student/student-plan-view.js';
import { renderStaffStudentManagementView } from './staff/staff-student-management-view.js';
import { createWorkspaceIcon } from './ui/workspace-presentation.js';
import { renderContactPanel, renderStaffWorkflow } from './workflow/workflow-views.js';

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

function createBrandMark(className) {
  const mark = element('span', className);
  mark.setAttribute('aria-hidden', 'true');
  const logo = element('img', 'shell-brand__logo');
  logo.src = 'resources/images/logomini.png';
  logo.alt = '';
  logo.width = 36;
  logo.height = 36;
  mark.append(logo);
  return mark;
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

  const mark = createBrandMark('shell-state__mark');
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

  const mark = createBrandMark('shell-brand__mark');
  const copy = element('span', 'shell-brand__copy');
  copy.append(
    element('span', 'shell-brand__name', 'CO-ED'),
    element('span', 'shell-brand__subtitle', 'ระบบข้อมูลสหกิจศึกษา')
  );
  brand.append(mark, copy);
  return brand;
}

function createNavigation(role, activeRoute) {
  const navigation = element('nav', 'shell-nav');
  navigation.setAttribute('aria-label', 'เมนูพื้นที่ผู้ใช้งาน');

  for (const route of getRoutesForRole(role)) {
    const link = element('a', 'shell-nav__link', route.navLabel);
    link.href = route.hash;
    if (['STUDENT', 'STAFF', 'ADVISOR'].includes(role)) {
      link.prepend(createWorkspaceIcon(route.hash.includes('students') || route.hash.endsWith('/profile')
        ? 'user' : route.hash.includes('review') ? 'clipboard' : 'file'));
    }
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
  if (role === 'STUDENT') layout.classList.add('protected-shell--student');
  const campusTheme = ['STUDENT', 'STAFF', 'ADVISOR'].includes(role);
  if (campusTheme) layout.classList.add('protected-shell--campus');
  if (role === 'STAFF') layout.classList.add('protected-shell--staff');
  if (role === 'ADVISOR') layout.classList.add('protected-shell--advisor');
  const skipLink = element('a', 'shell-skip-link', 'ข้ามไปยังเนื้อหาหลัก');
  skipLink.href = '#shell-main-content';
  // Do not assign a fragment: this app uses the hash for guarded routes.
  skipLink.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
  });
  const sidebar = element('aside', 'shell-sidebar');
  const identity = element('div', 'shell-role');
  identity.append(
    element('span', 'shell-role__label', 'พื้นที่ผู้ใช้งาน'),
    element('strong', 'shell-role__value', getRoleLabel(role))
  );
  if (campusTheme) identity.prepend(createWorkspaceIcon('user'));

  const publicLink = element('a', 'shell-sidebar__public-link', 'ดูรายชื่อสถานประกอบการ');
  publicLink.href = 'company-directory.html';
  if (campusTheme) publicLink.prepend(createWorkspaceIcon('building'));

  sidebar.append(createBrand(), identity, createNavigation(role, route), publicLink);

  const mainColumn = element('div', 'shell-main-column');
  if (campusTheme) {
    const backdrop = element('img', 'student-campus-backdrop');
    backdrop.src = 'resources/images/student-campus-banner.png';
    backdrop.alt = '';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.decoding = 'async';
    backdrop.width = 2172;
    backdrop.height = 724;
    mainColumn.append(backdrop);
  }
  const topbar = element('header', 'shell-topbar');
  const context = element('div', 'shell-context');
  const contextDot = element('span', 'shell-context__dot');
  contextDot.setAttribute('aria-hidden', 'true');
  context.append(contextDot, element('span', null, `Session พร้อมใช้งาน · ${getRoleLabel(role)}`));
  topbar.append(context, createActionButton('ออกจากระบบ', onLogout, true));

  const main = element('main', 'shell-content');
  main.id = 'shell-main-content';
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
  layout.append(skipLink, sidebar, mainColumn);
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
  invalidateLocalSession = async () => {},
  location,
  eventTarget,
  storage,
  history = globalThis.history,
  studentProfileClient = null,
  studentPlanClient = null,
  staffClient = null,
  advisorClient = null,
  staffReviewClient = null,
  workflowClient = null,
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
  // UI-only review capability from /api/v3/me; the backend re-checks every command
  let currentCanReviewPlan = false;
  let destroyed = false;
  let unsubscribeLogout = null;
  let studentRouteTransition = null;

  function cancelStudentRouteTransition() {
    const pending = studentRouteTransition;
    studentRouteTransition = null;
    try { pending?.skipTransition(); } catch { /* Rendering must never depend on motion. */ }
    root.ownerDocument.documentElement.classList.remove('student-route-transition');
  }

  function abortRouteWork() {
    cancelStudentRouteTransition();
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
  function renderSignIn({ rememberRoute = true } = {}) {
    abortRouteWork();
    currentRole = null;
    currentCanReviewPlan = false;
    if (rememberRoute) safelyRememberReturnRoute(storage, location.hash);
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
    currentCanReviewPlan = false;
    Promise.resolve(invalidateLocalSession()).catch(() => {});
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
    currentCanReviewPlan = false;
    safelyClearReturnRoute(storage);
    renderLoading('กำลังออกจากระบบ');
    try {
      await logout();
    } catch {
      renderState(root, {
        eyebrow: 'LOGOUT INCOMPLETE', title: 'ยังยืนยันการออกจาก Cognito ไม่สำเร็จ',
        description: 'ข้อมูล Session ในหน้านี้ถูกปิดแล้ว กรุณาลองออกจากระบบอีกครั้งเพื่อปิด Session ที่ Cognito',
        tone: 'error', alert: true,
        actions: [createActionButton('ลองออกจากระบบอีกครั้ง', handleLogout)]
      });
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
      const profile = renderStudentDashboardView({
        profileClient: studentProfileClient,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message),
        onNavigate: navigateToAllowlistedRoute
      });
      if (!workflowClient) return profile;
      const wrapper=element('div','workflow-stack');
      wrapper.append(profile,renderContactPanel({client:workflowClient,signal,onSessionExpired:handleSessionExpired,onAccessDenied:message=>renderForbidden(message)}));
      return wrapper;
    }

    if (role === 'STUDENT' && route.hash === '#/student/plan' && studentPlanClient) {
      return renderStudentPlanView({
        workflowClient,
        planClient: studentPlanClient,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message)
      });
    }

    if (role === 'STAFF') {
      if (route.hash === '#/staff/workflow' && workflowClient) return renderStaffWorkflow({client:workflowClient,signal,onSessionExpired:handleSessionExpired,onAccessDenied:message=>renderForbidden(message)});
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
    }
    if (role === 'STAFF' && staffReviewClient) {
      const staffViewOptions = {
        workflowClient,
        staffReviewClient,
        signal,
        onSessionExpired: handleSessionExpired,
        onAccessDenied: (message) => renderForbidden(message)
      };
      if (route.hash === '#/staff/review') {
        return renderStaffReviewQueueView(staffViewOptions);
      }
      if (route.params?.planId) {
        return renderStaffPlanReviewView({
          ...staffViewOptions,
          planId: route.params.planId,
          canReviewPlan: currentCanReviewPlan
        });
      }
    }

    if (role === 'ADVISOR' && advisorClient) {
      const advisorViewOptions = {
        workflowClient,
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

  function isRootOrEmptyHash(hash) {
    if (!hash || typeof hash !== 'string') return true;
    const trimmed = hash.trim();
    return trimmed === '' || trimmed === '#' || trimmed === '#/';
  }

  function renderCurrentRoute() {
    if (!currentRole) {
      return;
    }

    if (isRootOrEmptyHash(location.hash)) {
      const defaultRoute = getDefaultRoute(currentRole);
      if (defaultRoute && location.hash !== defaultRoute) {
        location.hash = defaultRoute;
        return;
      }
    }

    const previousHash = renderedHash;
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
    const studentPages = ['#/student/profile', '#/student/plan'];
    const existingLayout = root.querySelector('.protected-shell--student');
    const existingMain = existingLayout?.querySelector('.shell-content');
    const reuseStudentShell = currentRole === 'STUDENT' && existingMain &&
      previousHash !== route.hash && studentPages.includes(previousHash) && studentPages.includes(route.hash);
    const doc = root.ownerDocument;
    const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let useViewTransition = reuseStudentShell && !reducedMotion && typeof doc.startViewTransition === 'function';
    let committed = false;
    const commit = () => {
      // skipTransition does not cancel its queued DOM callback. Fence it against
      // newer navigation, expiry, logout, access denial and destroyed shells.
      if (committed || destroyed || controller.signal.aborted || routeController !== controller ||
          currentRole !== route.role || location.hash !== renderedHash) return;
      committed = true;
      if (reuseStudentShell) {
        // Keep main itself, too: the persistent skip-link handler references it.
        existingMain.dataset.studentRouteChange = 'true';
        existingMain.dataset.routeMotion = useViewTransition ? 'view-transition' : 'css';
        existingMain.replaceChildren(...main.childNodes);
        for (const link of existingLayout.querySelectorAll('.shell-nav__link')) {
          const active = link.getAttribute('href') === route.hash;
          link.classList.toggle('shell-nav__link--active', active);
          if (active) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        }
        existingMain.focus({ preventScroll: true });
      } else {
        replaceRoot(root, layout);
        main.focus({ preventScroll: true });
      }
    };
    if (controller.signal.aborted || destroyed) return;
    if (!useViewTransition) { commit(); return; }
    doc.documentElement.classList.add('student-route-transition');
    try {
      const transition = doc.startViewTransition(commit);
      studentRouteTransition = transition;
      const finish = () => {
        if (studentRouteTransition !== transition) return;
        studentRouteTransition = null;
        doc.documentElement.classList.remove('student-route-transition');
      };
      Promise.resolve(transition.finished).then(finish, finish);
      Promise.resolve(transition.ready).catch(() => {});
      Promise.resolve(transition.updateCallbackDone).catch(() => {});
    } catch {
      cancelStudentRouteTransition();
      // Unsupported/failed animation never blocks the guarded route update.
      useViewTransition = false;
      commit();
    }
  }

  function selectInitialRoute() {
    const rawHash = typeof location.hash === 'string' ? location.hash.trim() : '';
    if (!isRootOrEmptyHash(rawHash)) {
      if (isAllowlistedRoute(rawHash)) {
        safelyClearReturnRoute(storage);
        renderCurrentRoute();
        return;
      }
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
    currentCanReviewPlan = false;
    renderLoading();

    try {
      const session = await loadSession({ signal: controller.signal });
      scrubAuthCallbackUrl(location, history);
      if (destroyed || controller.signal.aborted || activeController !== controller) {
        return;
      }
      currentRole = session.role;
      currentCanReviewPlan = session.role === 'STAFF' && session.canReviewPlan === true;
      selectInitialRoute();
    } catch (error) {
      scrubAuthCallbackUrl(location, history);
      if (destroyed || controller.signal.aborted || activeController !== controller || error?.name === 'AbortError') {
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
  const handleLogoutSignal = () => {
    activeController?.abort();
    safelyClearReturnRoute(storage);
    renderSignIn({ rememberRoute: false });
    Promise.resolve(invalidateLocalSession()).catch(() => {});
  };
  const handlePageHide = () => {
    activeController?.abort(); abortRouteWork(); currentRole = null;
    currentCanReviewPlan = false; renderLoading();
  };
  const handlePageShow = (event) => { if (event.persisted) bootstrap(); };

  return Object.freeze({
    start() {
      destroyed = false;
      eventTarget.addEventListener('hashchange', handleHashChange);
      eventTarget.addEventListener('pagehide', handlePageHide);
      eventTarget.addEventListener('pageshow', handlePageShow);
      unsubscribeLogout = subscribeToLogout(handleLogoutSignal, eventTarget);
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
      eventTarget.removeEventListener('pagehide', handlePageHide);
      eventTarget.removeEventListener('pageshow', handlePageShow);
      unsubscribeLogout?.();
    }
  });
}
