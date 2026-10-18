/**
 * Advisor read-only pages for CO-ED V3 (#75).
 * Every page is read-only by construction: no form, input, or workflow button is rendered.
 * Only navigation links and buttons for retry/pagination are created.
 * Scope comes from the Advisor API (#68), which enforces it on every request.
 */

import { ADVISOR_ERROR_CODES, DEFAULT_ADVISOR_PAGE_SIZE } from './advisor-client.js';

const STUDENT_LIST_HASH = '#/advisor/students';

const PLAN_STATUS_META = Object.freeze({
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
    element('p', 'student-card__eyebrow', 'LOADING'),
    element('h2', 'student-card__title', title),
    element('p', 'student-card__description', 'ระบบกำลังดึงข้อมูลตาม Assignment ปัจจุบันของคุณ')
  );
  container.replaceChildren(card);
}

function renderNotInScope(container) {
  container.setAttribute('aria-busy', 'false');
  const card = element('section', 'student-card student-card--error');
  card.setAttribute('role', 'alert');
  card.dataset.role = 'advisor-not-in-scope';
  card.append(
    element('p', 'student-card__eyebrow', 'NOT AVAILABLE'),
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
    element('p', 'student-card__eyebrow', 'SERVICE UNAVAILABLE'),
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

function createCard({ eyebrow, title, titleId }) {
  const card = element('section', 'student-card');
  card.setAttribute('aria-labelledby', titleId);
  const heading = element('h2', 'student-card__title', title);
  heading.id = titleId;
  card.append(element('p', 'student-card__eyebrow', eyebrow), heading);
  return card;
}

function createReadOnlyNotice(text) {
  const notice = element('p', 'student-profile-official__notice advisor-readonly-notice', text);
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

function createTable({ caption, columns, rows }) {
  // Scrollable region is focusable so keyboard users can scroll a wide table on small screens
  const region = element('div', 'advisor-table-wrap');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', caption);
  region.tabIndex = 0;

  const table = element('table', 'advisor-table');
  const captionNode = element('caption', 'advisor-table__caption', caption);
  const head = element('thead');
  const headRow = element('tr');
  for (const column of columns) {
    const th = element('th', null, column);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);

  const body = element('tbody');
  for (const cells of rows) {
    const tr = element('tr');
    for (const cell of cells) {
      const td = element('td');
      if (cell instanceof Node) {
        td.append(cell);
      } else {
        td.textContent = cell;
      }
      tr.append(td);
    }
    body.append(tr);
  }

  table.append(captionNode, head, body);
  region.append(table);
  return region;
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

export function renderAdvisorStudentListView({ advisorClient, signal, onSessionExpired, onAccessDenied } = {}) {
  const container = createWorkspace();
  if (!isUsableClient(advisorClient, ['listStudents'])) {
    return renderFallback(container);
  }

  async function load(page = 1) {
    renderLoading(container, 'กำลังโหลดรายชื่อนักศึกษาที่ได้รับมอบหมาย...');
    try {
      const result = await advisorClient.listStudents({ page, pageSize: DEFAULT_ADVISOR_PAGE_SIZE, signal });
      if (signal?.aborted) {
        return;
      }
      renderList(result);
    } catch (error) {
      handleLoadError(error, {
        container,
        signal,
        onSessionExpired,
        retry: () => load(page),
        // No id in this request: a 403 means the account itself may not use the Advisor view
        notInScopeHandler: () => onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์อ่านรายชื่อนักศึกษาในฐานะอาจารย์ที่ปรึกษา')
      });
    }
  }

  function renderList({ items, pagination }) {
    container.setAttribute('aria-busy', 'false');
    const card = createCard({ eyebrow: 'ASSIGNED STUDENTS', title: 'รายชื่อนักศึกษาที่ได้รับมอบหมาย', titleId: 'advisor-students-title' });
    const badges = element('div', 'student-dashboard-summary__badges');
    badges.append(readOnlyBadge());
    card.append(
      badges,
      createReadOnlyNotice('แสดงเฉพาะนักศึกษาที่มี Assignment ที่มีผลอยู่ ณ ตอนนี้ อาจารย์ที่ปรึกษาอ่านข้อมูลได้อย่างเดียว ไม่สามารถแก้ไขหรือดำเนินการกับแผนได้')
    );

    if (items.length === 0) {
      const empty = element('p', 'student-card__description', 'ยังไม่มีนักศึกษาที่ได้รับมอบหมายให้คุณในขณะนี้ หากข้อมูลไม่ถูกต้องกรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา');
      empty.dataset.role = 'advisor-no-assignment';
      card.append(empty);
      container.replaceChildren(card);
      return;
    }

    const table = createTable({
      caption: 'นักศึกษาที่ได้รับมอบหมาย',
      columns: ['รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'หลักสูตร / สาขา', 'ปีการศึกษา', 'สถานะการศึกษา'],
      rows: items.map((student) => [
        displayText(student.student_number),
        link(`#/advisor/students/${student.id}`, 'advisor-link', studentName(student)),
        studentProgram(student),
        displayText(student.academic_year),
        ENROLLMENT_LABELS[student.enrollment_status] || displayText(student.enrollment_status)
      ])
    });
    table.dataset.role = 'advisor-student-list';
    card.append(table);

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

  async function load(planPage = 1) {
    renderLoading(container, 'กำลังโหลดข้อมูลนักศึกษา...');
    try {
      const [student, plans] = await Promise.all([
        advisorClient.getStudent(studentId, { signal }),
        advisorClient.listStudentPlans(studentId, { page: planPage, pageSize: DEFAULT_ADVISOR_PAGE_SIZE, signal })
      ]);
      if (signal?.aborted) {
        return;
      }
      renderDetail(student, plans);
    } catch (error) {
      handleLoadError(error, {
        container,
        signal,
        onSessionExpired,
        retry: () => load(planPage),
        notInScopeHandler: () => renderNotInScope(container)
      });
    }
  }

  function renderDetail(student, { items, pagination }) {
    container.setAttribute('aria-busy', 'false');
    const back = link(STUDENT_LIST_HASH, 'advisor-back-link', '← กลับไปยังรายชื่อนักศึกษา');

    const profileCard = createCard({ eyebrow: 'STUDENT', title: studentName(student), titleId: 'advisor-student-title' });
    const badges = element('div', 'student-dashboard-summary__badges');
    badges.append(readOnlyBadge());
    profileCard.append(
      badges,
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

    const plansCard = createCard({ eyebrow: 'CO-OP PLANS', title: 'แผนสหกิจของนักศึกษา', titleId: 'advisor-student-plans-title' });
    plansCard.append(
      createReadOnlyNotice('การรับเรื่องตรวจ ส่งกลับให้แก้ไข และอนุมัติแผนเป็นหน้าที่ของเจ้าหน้าที่สหกิจศึกษา อาจารย์ที่ปรึกษาอ่านสถานะได้อย่างเดียว')
    );

    if (items.length === 0) {
      const empty = element('p', 'student-card__description', 'นักศึกษายังไม่มีแผนสหกิจศึกษา');
      empty.dataset.role = 'advisor-no-plans';
      plansCard.append(empty);
    } else {
      const table = createTable({
        caption: 'แผนสหกิจของนักศึกษา',
        columns: ['สถานะ', 'สถานประกอบการ', 'ตำแหน่งงาน', 'อัปเดตล่าสุด', 'รายละเอียด'],
        rows: items.map((plan) => [
          statusBadge(plan.status),
          plan.company?.name || 'ยังไม่ได้ระบุ',
          plan.position?.title || 'ยังไม่ได้ระบุ',
          formatTimestamp(plan.updated_at),
          link(`#/advisor/plans/${plan.id}`, 'advisor-link', 'ดูแผน')
        ])
      });
      table.dataset.role = 'advisor-plan-list';
      plansCard.append(table);
      const pager = createPager(pagination, (nextPage) => load(nextPage));
      if (pager) {
        plansCard.append(pager);
      }
    }

    container.replaceChildren(back, profileCard, plansCard);
  }

  load();
  return container;
}

export function renderAdvisorPlanView({ advisorClient, planId, signal, onSessionExpired } = {}) {
  const container = createWorkspace();
  if (!isUsableClient(advisorClient, ['getPlan'])) {
    return renderFallback(container);
  }

  async function load() {
    renderLoading(container, 'กำลังโหลดแผนสหกิจ...');
    try {
      const plan = await advisorClient.getPlan(planId, { signal });
      if (signal?.aborted) {
        return;
      }
      renderPlan(plan);
    } catch (error) {
      handleLoadError(error, {
        container,
        signal,
        onSessionExpired,
        retry: load,
        notInScopeHandler: () => renderNotInScope(container)
      });
    }
  }

  function renderPlan(plan) {
    container.setAttribute('aria-busy', 'false');
    container.dataset.planStatus = plan.status;
    const back = link(STUDENT_LIST_HASH, 'advisor-back-link', '← กลับไปยังรายชื่อนักศึกษา');

    const card = createCard({ eyebrow: 'CO-OP PLAN · READ-ONLY', title: 'รายละเอียดแผนสหกิจ', titleId: 'advisor-plan-title' });
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

    container.replaceChildren(back, card);
  }

  load();
  return container;
}
