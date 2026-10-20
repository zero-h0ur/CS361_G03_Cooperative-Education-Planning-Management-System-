/**
 * Advisor read-only pages for CO-ED V3 (#75).
 * Every page is read-only by construction: no form, input, or workflow button is rendered.
 * Only navigation links and buttons for retry/pagination are created.
 * Scope comes from the Advisor API (#68), which enforces it on every request.
 */

import { ADVISOR_ERROR_CODES, DEFAULT_ADVISOR_PAGE_SIZE } from './advisor-client.js';
import { createWorkspaceIcon } from '../ui/workspace-presentation.js';
import { renderPlanWorkflow } from '../workflow/workflow-views.js';

const STUDENT_LIST_HASH = '#/advisor/students';

const PLAN_STATUS_META = Object.freeze({
  REJECTED: {label:'ไม่ผ่านเกณฑ์ในรอบนี้ (REJECTED)',badgeClass:'student-badge--danger'},
  DRAFT: { label: 'ฉบับร่าง (DRAFT)', badgeClass: 'student-badge--neutral' },
  SUBMITTED: { label: 'ส่งแผนแล้ว (SUBMITTED)', badgeClass: 'student-badge--status' },
  UNDER_REVIEW: { label: 'กำลังตรวจสอบ (UNDER_REVIEW)', badgeClass: 'student-badge--status' },
  NEEDS_REVISION: { label: 'ส่งกลับให้แก้ไข (NEEDS_REVISION)', badgeClass: 'student-badge--warning' },
  APPROVED: { label: 'อนุมัติแล้ว (APPROVED)', badgeClass: 'student-badge--status' },
  CANCELLED: { label: 'ยกเลิกแผน (CANCELLED)', badgeClass: 'student-badge--danger' }
});

const ENROLLMENT_LABELS = Object.freeze({
  ACTIVE: 'กำลังศึกษา',
  INACTIVE: 'ไม่ได้ลงทะเบียนเรียน'
});

const NOT_IN_SCOPE_MESSAGE =
  'ไม่พบข้อมูลที่ร้องขอ หรือข้อมูลนี้ไม่อยู่ในขอบเขตนักศึกษาที่คุณได้รับมอบหมาย';

const timestampFormatter = (() => {
  try {
    // th-TH uses the Buddhist calendar (พ.ศ.) by default
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok'
    });
  } catch {
    return null;
  }
})();

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

function link(href, className, text) {
  const anchor = element('a', className, text);
  anchor.href = href;
  return anchor;
}

function button(label, onClick, secondary = true) {
  const node = element('button', secondary ? 'shell-button shell-button--secondary' : 'shell-button', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function displayText(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return 'ไม่ระบุ';
  }
  return String(value).trim();
}

function formatTimestamp(isoString) {
  if (typeof isoString !== 'string' || isoString === '') {
    return 'ไม่ระบุเวลา';
  }
  const date = new Date(isoString);
  if (!timestampFormatter || Number.isNaN(date.getTime())) {
    return isoString;
  }
  return timestampFormatter.format(date);
}

function studentName(student) {
  const fullName = displayText(student.full_name);
  const preferred = typeof student.preferred_name === 'string' ? student.preferred_name.trim() : '';
  return preferred && preferred !== fullName ? `${fullName} (${preferred})` : fullName;
}

function studentProgram(student) {
  return [student.program, student.major].filter((part) => typeof part === 'string' && part.trim() !== '').join(' · ') || 'ไม่ระบุ';
}

function statusBadge(status) {
  const meta = PLAN_STATUS_META[status] || { label: displayText(status), badgeClass: 'student-badge--neutral' };
  const badge = element('span', `student-badge ${meta.badgeClass}`, meta.label);
  badge.dataset.role = 'plan-status';
  return badge;
}

function readOnlyBadge() {
  const badge = element('span', 'student-badge student-badge--neutral advisor-readonly-badge', 'อ่านอย่างเดียว (Read-only)');
  badge.prepend(createWorkspaceIcon('lock'));
  badge.dataset.role = 'advisor-readonly-badge';
  return badge;
}

function createWorkspace() {
  const container = element('div', 'student-workspace advisor-workspace');
  container.dataset.readonly = 'true';
  return container;
}

function renderFallback(container) {
  const fallback = element('section', 'shell-placeholder');
  fallback.append(
    element('span', 'shell-placeholder__index', 'V3'),
    element('h2', 'shell-placeholder__title', 'พื้นที่นี้พร้อมสำหรับการเชื่อมต่อขั้นถัดไป'),
    element('p', 'shell-placeholder__description', 'ยังไม่ได้กำหนด Advisor Client')
  );
  container.append(fallback);
  return container;
}

function renderLoading(container, title) {
  container.setAttribute('aria-busy', 'true');
  const card = element('section', 'student-card student-card--loading');
  card.setAttribute('role', 'status');
  card.dataset.role = 'advisor-loading';
  card.append(
    element('h2', 'student-card__title', title),
    element('p', 'student-card__description', 'กำลังตรวจสอบข้อมูลนักศึกษาที่อยู่ในความดูแลของคุณ')
  );
  container.replaceChildren(card);
}

function renderNotInScope(container) {
  container.setAttribute('aria-busy', 'false');
  const card = element('section', 'student-card student-card--error');
  card.setAttribute('role', 'alert');
  card.dataset.role = 'advisor-not-in-scope';
  card.append(
    element('h2', 'student-card__title', 'ไม่สามารถแสดงข้อมูลนี้ได้'),
    element('p', 'student-card__description', NOT_IN_SCOPE_MESSAGE),
    link(STUDENT_LIST_HASH, 'shell-button shell-button--secondary', 'กลับไปยังรายชื่อนักศึกษา')
  );
  container.replaceChildren(card);
}

function renderLoadError(container, retry) {
  container.setAttribute('aria-busy', 'false');
  const card = element('section', 'student-card student-card--error');
  card.setAttribute('role', 'alert');
  card.dataset.role = 'advisor-load-error';
  card.append(
    element('h2', 'student-card__title', 'โหลดข้อมูลไม่สำเร็จ'),
    element('p', 'student-card__description', 'ระบบยังไม่พร้อมให้บริการในขณะนี้ กรุณาลองใหม่อีกครั้ง'),
    button('ลองโหลดอีกครั้ง', retry, false)
  );
  container.replaceChildren(card);
}

/**
 * Shared error handling. Returns nothing; renders or delegates to the shell.
 * notInScopeHandler decides whether a 403/404 is an in-page "not available" (detail pages)
 * or an account-level denial (the list page, where no id is involved).
 */
function handleLoadError(error, { container, signal, onSessionExpired, retry, notInScopeHandler }) {
  if (signal?.aborted || error?.name === 'AbortError') {
    return;
  }
  if (error?.code === ADVISOR_ERROR_CODES.SESSION_EXPIRED) {
    onSessionExpired?.();
    return;
  }
  if (error?.code === ADVISOR_ERROR_CODES.NOT_IN_SCOPE || error?.code === ADVISOR_ERROR_CODES.VALIDATION_ERROR) {
    notInScopeHandler();
    return;
  }
  renderLoadError(container, retry);
}

function createCard({ title, titleId, icon = 'user' }) {
  const card = element('section', 'student-card advisor-card');
  card.setAttribute('aria-labelledby', titleId);
  const heading = element('h2', 'student-card__title', title);
  heading.id = titleId;
  const header = element('div', 'advisor-card__heading');
  const mark = element('span', 'advisor-card__icon');
  mark.append(createWorkspaceIcon(icon));
  header.append(mark, heading);
  card.append(header);
  return card;
}

function createReadOnlyNotice(text) {
  const notice = element('p', 'student-profile-official__notice advisor-readonly-notice', text);
  notice.prepend(createWorkspaceIcon('lock'));
  notice.dataset.role = 'advisor-readonly-notice';
  return notice;
}

function createDetailList(rows) {
  const list = element('dl', 'student-profile-list');
  for (const { label, value, field } of rows) {
    const item = element('div', 'student-profile-list__item');
    const detail = element('dd', 'student-profile-list__detail', typeof value === 'string' ? value : '');
    if (value instanceof Node) {
      detail.append(value);
    }
    if (field) {
      detail.dataset.field = field;
    }
    item.append(element('dt', 'student-profile-list__term', label), detail);
    list.append(item);
  }
  return list;
}

function createRefresh(onClick) {
  const control = button('รีเฟรชข้อมูล', onClick);
  control.prepend(createWorkspaceIcon('refresh'));
  control.dataset.role = 'advisor-refresh';
  return control;
}

function studentList(items) {
  const list = element('ul', 'advisor-student-cards');
  list.dataset.role = 'advisor-student-list';
  list.setAttribute('aria-label', 'นักศึกษาที่ได้รับมอบหมาย');
  for (const student of items) {
    const item = element('li', 'advisor-student-card');
    const heading = element('div', 'advisor-student-card__heading');
    const name = element('h3', 'advisor-student-card__name', studentName(student));
    const enrollmentClass = student.enrollment_status === 'ACTIVE'
      ? 'student-badge--status' : 'student-badge--neutral';
    const enrollment = element('span', `student-badge ${enrollmentClass}`,
      ENROLLMENT_LABELS[student.enrollment_status] || displayText(student.enrollment_status));
    heading.append(name, enrollment);
    const open = link(`#/advisor/students/${student.id}`, 'shell-button advisor-student-card__open', 'ดูข้อมูลและแผน');
    open.prepend(createWorkspaceIcon('file'));
    open.setAttribute('aria-label', `ดูข้อมูลและแผนของ ${studentName(student)}`);
    item.append(heading, createDetailList([
      { label: 'รหัสนักศึกษา', value: displayText(student.student_number) },
      { label: 'หลักสูตร / สาขา', value: studentProgram(student) },
      { label: 'ปีการศึกษา (พ.ศ.)', value: displayText(student.academic_year) }
    ]), open);
    list.append(item);
  }
  return list;
}

function planList(items) {
  const list = element('ul', 'advisor-plan-cards');
  list.dataset.role = 'advisor-plan-list';
  list.setAttribute('aria-label', 'แผนสหกิจของนักศึกษา');
  for (const plan of items) {
    const item = element('li', 'advisor-plan-card');
    item.append(statusBadge(plan.status), createDetailList([
      { label: 'สถานประกอบการ', value: plan.company?.name || 'ยังไม่ได้ระบุ' },
      { label: 'ตำแหน่งงาน', value: plan.position?.title || 'ยังไม่ได้ระบุ' },
      { label: 'อัปเดตล่าสุด', value: formatTimestamp(plan.updated_at) }
    ]));
    const open = link(`#/advisor/plans/${plan.id}`, 'shell-button shell-button--secondary', 'ดูรายละเอียดแผน');
    open.setAttribute('aria-label', `ดูรายละเอียดแผน ${plan.company?.name || 'ยังไม่ระบุสถานประกอบการ'} ${plan.position?.title || ''}`.trim());
    item.append(open);
    list.append(item);
  }
  return list;
}

function createPager(pagination, onPage) {
  if (!pagination || pagination.totalPages <= 1) {
    return null;
  }
  const nav = element('nav', 'advisor-pager');
  nav.setAttribute('aria-label', 'เปลี่ยนหน้า');
  const previous = button('หน้าก่อนหน้า', () => onPage(pagination.page - 1));
  previous.disabled = pagination.page <= 1;
  const next = button('หน้าถัดไป', () => onPage(pagination.page + 1));
  next.disabled = pagination.page >= pagination.totalPages;
  const status = element('p', 'advisor-pager__status', `หน้า ${pagination.page} จาก ${pagination.totalPages} (ทั้งหมด ${pagination.total} รายการ)`);
  status.setAttribute('aria-live', 'polite');
  nav.append(previous, status, next);
  return nav;
}

function isUsableClient(client, methods) {
  return Boolean(client) && methods.every((method) => typeof client[method] === 'function');
}

function restoreReadingFocus(container, hadFocus) {
  // A refreshed control is removed while loading. Restore a reading point only
  // if the user has not focused something else (e.g. logout) in the meantime.
  if (!hadFocus || !container.isConnected || document.activeElement !== document.body) return;
  const heading = container.querySelector('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

export function renderAdvisorStudentListView({ advisorClient, signal, onSessionExpired, onAccessDenied } = {}) {
  const container = createWorkspace();
  if (!isUsableClient(advisorClient, ['listStudents'])) {
    return renderFallback(container);
  }

  let loadVersion = 0;
  async function load(page = 1) {
    const requestVersion = ++loadVersion;
    const hadFocus = container.contains(document.activeElement);
    renderLoading(container, 'กำลังโหลดรายชื่อนักศึกษาที่ได้รับมอบหมาย...');
    try {
      const result = await advisorClient.listStudents({ page, pageSize: DEFAULT_ADVISOR_PAGE_SIZE, signal });
      if (signal?.aborted || requestVersion !== loadVersion) {
        return;
      }
      renderList(result);
      restoreReadingFocus(container, hadFocus);
    } catch (error) {
      if (requestVersion !== loadVersion) return;
      handleLoadError(error, {
        container,
        signal,
        onSessionExpired,
        retry: () => load(page),
        // No id in this request: a 403 means the account itself may not use the Advisor view
        notInScopeHandler: () => onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์อ่านรายชื่อนักศึกษาในฐานะอาจารย์ที่ปรึกษา')
      });
      restoreReadingFocus(container, hadFocus);
    }
  }

  function renderList({ items, pagination }) {
    container.setAttribute('aria-busy', 'false');
    const card = createCard({ title: 'นักศึกษาในความดูแลของคุณ', titleId: 'advisor-students-title' });
    const actions = element('div', 'advisor-toolbar');
    const badges = element('div', 'student-dashboard-summary__badges');
    badges.append(readOnlyBadge());
    actions.append(badges, createRefresh(() => load(1)));
    card.append(
      actions,
      createReadOnlyNotice('เจ้าหน้าที่เป็นผู้มอบหมายนักศึกษาและตรวจอนุมัติแผน คุณสามารถเปิดอ่านข้อมูลและแผนของนักศึกษาในความดูแลเพื่อให้คำปรึกษาได้')
    );

    if (items.length === 0) {
      const empty = element('section', 'advisor-empty');
      empty.dataset.role = 'advisor-no-assignment';
      const hasOtherPages = Number.isInteger(pagination?.total) && pagination.total > 0;
      empty.append(createWorkspaceIcon('user'),
        element('h3', null, hasOtherPages ? 'ไม่พบรายการในหน้านี้' : 'ยังไม่มีนักศึกษาที่ได้รับมอบหมาย'),
        element('p', 'student-card__description', hasOtherPages
          ? 'ข้อมูลอาจเปลี่ยนแปลง กรุณารีเฟรชเพื่อกลับไปยังรายชื่อปัจจุบัน'
          : 'เมื่อเจ้าหน้าที่มอบหมายนักศึกษาให้คุณ รายชื่อจะแสดงที่นี่ ก่อนหน้านั้นคุณยังไม่สามารถเปิดข้อมูลนักศึกษาได้ หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา'));
      card.append(empty);
      container.replaceChildren(card);
      return;
    }

    card.append(studentList(items));

    const pager = createPager(pagination, (nextPage) => load(nextPage));
    if (pager) {
      card.append(pager);
    }
    container.replaceChildren(card);
  }

  load();
  return container;
}

export function renderAdvisorStudentDetailView({ advisorClient, studentId, signal, onSessionExpired } = {}) {
  const container = createWorkspace();
  if (!isUsableClient(advisorClient, ['getStudent', 'listStudentPlans'])) {
    return renderFallback(container);
  }

  let loadVersion = 0;
  async function load(planPage = 1) {
    const requestVersion = ++loadVersion;
    const hadFocus = container.contains(document.activeElement);
    renderLoading(container, 'กำลังโหลดข้อมูลนักศึกษา...');
    try {
      const [student, plans] = await Promise.all([
        advisorClient.getStudent(studentId, { signal }),
        advisorClient.listStudentPlans(studentId, { page: planPage, pageSize: DEFAULT_ADVISOR_PAGE_SIZE, signal })
      ]);
      if (signal?.aborted || requestVersion !== loadVersion) {
        return;
      }
      renderDetail(student, plans);
      restoreReadingFocus(container, hadFocus);
    } catch (error) {
      if (requestVersion !== loadVersion) return;
      handleLoadError(error, {
        container,
        signal,
        onSessionExpired,
        retry: () => load(planPage),
        notInScopeHandler: () => renderNotInScope(container)
      });
      restoreReadingFocus(container, hadFocus);
    }
  }

  function renderDetail(student, { items, pagination }) {
    container.setAttribute('aria-busy', 'false');
    const back = link(STUDENT_LIST_HASH, 'advisor-back-link', '← กลับไปยังรายชื่อนักศึกษา');

    const profileCard = createCard({ title: studentName(student), titleId: 'advisor-student-title' });
    const badges = element('div', 'student-dashboard-summary__badges');
    badges.append(readOnlyBadge());
    profileCard.append(
      badges,
      createReadOnlyNotice('ข้อมูลสำหรับให้คำปรึกษา แสดงเฉพาะนักศึกษาที่เจ้าหน้าที่มอบหมายให้คุณดูแล'),
      createDetailList([
        { label: 'รหัสนักศึกษา', value: displayText(student.student_number), field: 'student_number' },
        { label: 'ชื่อ-นามสกุล', value: displayText(student.full_name), field: 'full_name' },
        { label: 'ชื่อที่ใช้เรียก', value: displayText(student.preferred_name), field: 'preferred_name' },
        { label: 'ภาควิชา', value: displayText(student.department), field: 'department' },
        { label: 'หลักสูตร', value: displayText(student.program), field: 'program' },
        { label: 'สาขาวิชา', value: displayText(student.major), field: 'major' },
        { label: 'ปีการศึกษา (พ.ศ.)', value: displayText(student.academic_year), field: 'academic_year' },
        {
          label: 'สถานะการศึกษา',
          value: ENROLLMENT_LABELS[student.enrollment_status] || displayText(student.enrollment_status),
          field: 'enrollment_status'
        }
      ])
    );

    const plansCard = createCard({ title: 'แผนสหกิจของนักศึกษา', titleId: 'advisor-student-plans-title', icon: 'file' });
    plansCard.append(
      createReadOnlyNotice('การรับเรื่องตรวจ ส่งกลับให้แก้ไข และอนุมัติแผนเป็นหน้าที่ของเจ้าหน้าที่สหกิจศึกษา อาจารย์ที่ปรึกษาอ่านสถานะได้อย่างเดียว')
    );

    if (items.length === 0) {
      const empty = element('p', 'student-card__description advisor-empty', 'ยังไม่มีแผนสหกิจให้แสดงสำหรับนักศึกษาคนนี้');
      empty.dataset.role = 'advisor-no-plans';
      plansCard.append(empty);
    } else {
      plansCard.append(planList(items));
      const pager = createPager(pagination, (nextPage) => load(nextPage));
      if (pager) {
        plansCard.append(pager);
      }
    }

    const navigation = element('div', 'advisor-toolbar');
    navigation.append(back, createRefresh(() => load()));
    container.replaceChildren(navigation, profileCard, plansCard);
  }

  load();
  return container;
}

export function renderAdvisorPlanView({ advisorClient, workflowClient, planId, signal, onSessionExpired, onAccessDenied } = {}) {
  let workflowController=null;
  signal?.addEventListener('abort',()=>workflowController?.abort(),{once:true});
  const container = createWorkspace();
  if (!isUsableClient(advisorClient, ['getPlan'])) {
    return renderFallback(container);
  }

  let loadVersion = 0;
  async function load() {
    const requestVersion = ++loadVersion;
    const hadFocus = container.contains(document.activeElement);
    renderLoading(container, 'กำลังโหลดแผนสหกิจ...');
    try {
      const plan = await advisorClient.getPlan(planId, { signal });
      if (signal?.aborted || requestVersion !== loadVersion) {
        return;
      }
      renderPlan(plan);
      restoreReadingFocus(container, hadFocus);
    } catch (error) {
      if (requestVersion !== loadVersion) return;
      handleLoadError(error, {
        container,
        signal,
        onSessionExpired,
        retry: load,
        notInScopeHandler: () => renderNotInScope(container)
      });
      restoreReadingFocus(container, hadFocus);
    }
  }

  function renderPlan(plan) {
    container.setAttribute('aria-busy', 'false');
    container.dataset.planStatus = plan.status;
    const back = link(STUDENT_LIST_HASH, 'advisor-back-link', '← กลับไปยังรายชื่อนักศึกษา');

    const card = createCard({ title: 'รายละเอียดแผนสหกิจ', titleId: 'advisor-plan-title', icon: 'file' });
    const badges = element('div', 'student-dashboard-summary__badges');
    badges.append(statusBadge(plan.status), readOnlyBadge());
    if (plan.version !== null) {
      badges.append(element('span', 'student-badge student-badge--neutral', `เวอร์ชันแผน v${plan.version}`));
    }

    card.append(
      badges,
      createReadOnlyNotice('อาจารย์ที่ปรึกษาอ่านแผนได้อย่างเดียว การรับเรื่องตรวจ ส่งกลับให้แก้ไข และอนุมัติเป็นหน้าที่ของเจ้าหน้าที่สหกิจศึกษา'),
      createDetailList([
        { label: 'สถานประกอบการ', value: plan.company?.name || 'ยังไม่ได้ระบุ', field: 'company' },
        { label: 'ตำแหน่งงาน', value: plan.position?.title || 'ยังไม่ได้ระบุ', field: 'position' },
        { label: 'รอบการสมัคร (Cycle)', value: displayText(plan.cycle_id), field: 'cycle_id' },
        { label: 'บันทึกของนักศึกษา', value: displayText(plan.notes), field: 'notes' },
        { label: 'สร้างเมื่อ', value: formatTimestamp(plan.created_at), field: 'created_at' },
        { label: 'อัปเดตล่าสุด', value: formatTimestamp(plan.updated_at), field: 'updated_at' }
      ])
    );

    const navigation = element('div', 'advisor-toolbar');
    navigation.append(back, createRefresh(load));
    container.replaceChildren(navigation, card);
    if (workflowClient) {
      workflowController?.abort();workflowController=new AbortController();
      container.append(renderPlanWorkflow({client:workflowClient,planId,role:'ADVISOR',signal:workflowController.signal,onSessionExpired,onAccessDenied}));
    }
  }

  load();
  return container;
}
