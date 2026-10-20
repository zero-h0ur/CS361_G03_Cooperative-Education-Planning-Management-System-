/**
 * Staff review workspace pages for CO-ED V3 (#77): review queue and Plan review detail.
 * Review controls render only when the session capability, the Plan state and an OPEN
 * Round all allow a command (getAvailableReviewCommands). The backend enforces the same
 * rules on every command. Advisor pages never import this module (#75 coordination note).
 */

import {
  DEFAULT_QUEUE_PAGE_SIZE,
  MAX_REVIEW_NOTES_LENGTH,
  PLAN_STATUSES,
  REVIEW_COMMANDS,
  REVIEW_QUEUE_STATUSES,
  STAFF_REVIEW_ERROR_CODES,
  getAvailableReviewCommands,
  validateReviewNotes
} from './staff-review-client.js';

import { renderPlanWorkflow } from '../workflow/workflow-views.js';
const QUEUE_HASH = '#/staff/review';

const STATUS_META = Object.freeze({
  REJECTED: {label:'ไม่ผ่านเกณฑ์ในรอบนี้',badgeClass:'student-badge--danger'},
  [PLAN_STATUSES.DRAFT]: { label: 'ฉบับร่าง (DRAFT)', badgeClass: 'student-badge--neutral' },
  [PLAN_STATUSES.SUBMITTED]: { label: 'รอรับเรื่อง (SUBMITTED)', badgeClass: 'student-badge--warning' },
  [PLAN_STATUSES.UNDER_REVIEW]: { label: 'กำลังตรวจสอบ (UNDER_REVIEW)', badgeClass: 'student-badge--neutral' },
  [PLAN_STATUSES.NEEDS_REVISION]: { label: 'ส่งกลับให้แก้ไข (NEEDS_REVISION)', badgeClass: 'student-badge--warning' },
  [PLAN_STATUSES.APPROVED]: { label: 'อนุมัติแล้ว (APPROVED)', badgeClass: 'student-badge--status' },
  [PLAN_STATUSES.CANCELLED]: { label: 'ยกเลิกแผน (CANCELLED)', badgeClass: 'student-badge--danger' }
});

const COMMAND_META = Object.freeze({
  [REVIEW_COMMANDS.START_REVIEW]: {
    label: 'เริ่มตรวจแผน',
    confirmTitle: 'ยืนยันการเริ่มตรวจแผน',
    confirmLabel: 'ยืนยันเริ่มตรวจแผน',
    description: 'สถานะจะเปลี่ยนจาก SUBMITTED เป็น UNDER_REVIEW และนักศึกษาจะแก้ไขแผนไม่ได้ระหว่างตรวจ',
    notes: null,
    secondary: false
  },
  [REVIEW_COMMANDS.APPROVE]: {
    label: 'อนุมัติแผน',
    confirmTitle: 'ยืนยันการอนุมัติแผน',
    confirmLabel: 'ยืนยันอนุมัติแผน',
    description: 'สถานะจะเปลี่ยนเป็น APPROVED และแผนจะถูกล็อกเป็นแบบอ่านอย่างเดียว',
    notes: { label: 'ความเห็นถึงนักศึกษา (ไม่บังคับ)', required: false },
    secondary: false
  },
  [REVIEW_COMMANDS.RETURN]: {
    label: 'ส่งกลับให้แก้ไข',
    confirmTitle: 'ยืนยันการส่งกลับให้แก้ไข',
    confirmLabel: 'ยืนยันส่งกลับให้แก้ไข',
    description: 'สถานะจะเปลี่ยนเป็น NEEDS_REVISION และนักศึกษาจะเห็นเหตุผลนี้ในหน้าแผนของตน',
    notes: { label: 'เหตุผลที่ส่งกลับ (จำเป็น)', required: true },
    secondary: true
  }
});

const NOT_AVAILABLE_MESSAGE =
  'ไม่พบแผนที่ร้องขอ หรือแผนนี้ไม่อยู่ในขอบเขตการตรวจของคุณ';

const timestampFormatter = (() => {
  try {
    // th-TH uses the Buddhist calendar (พ.ศ.) by default
    return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
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

function button(label, onClick, { secondary = true, type = 'button' } = {}) {
  const node = element('button', secondary ? 'shell-button shell-button--secondary' : 'shell-button', label);
  node.type = type;
  if (onClick) node.addEventListener('click', onClick);
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

function formatStatus(status) {
  return STATUS_META[status]?.label || displayText(status);
}

function statusBadge(status) {
  const meta = STATUS_META[status] || { label: displayText(status), badgeClass: 'student-badge--neutral' };
  const badge = element('span', `student-badge ${meta.badgeClass}`, meta.label);
  badge.dataset.role = 'plan-status';
  return badge;
}

function studentName(student) {
  const fullName = displayText(student?.full_name);
  const preferred = student?.preferred_name;
  return preferred && preferred !== fullName ? `${fullName} (${preferred})` : fullName;
}

function formatCycle(cycle) {
  if (!cycle) return 'ไม่ระบุ';
  const name = displayText(cycle.name);
  return cycle.status && cycle.status !== 'OPEN' ? `${name} (ปิดรับแล้ว)` : name;
}

function createWorkspace() {
  return element('div', 'student-workspace staff-workspace');
}

function renderFallback(container) {
  const fallback = element('section', 'shell-placeholder');
  fallback.append(
    element('span', 'shell-placeholder__index', 'V3'),
    element('h2', 'shell-placeholder__title', 'พื้นที่นี้พร้อมสำหรับการเชื่อมต่อขั้นถัดไป'),
    element('p', 'shell-placeholder__description', 'ยังไม่ได้กำหนด Staff Review Client')
  );
  container.append(fallback);
  return container;
}

function renderLoading(container, title) {
  container.setAttribute('aria-busy', 'true');
  const card = element('section', 'student-card student-card--loading');
  card.setAttribute('role', 'status');
  card.dataset.role = 'staff-loading';
  card.append(
    element('p', 'student-card__eyebrow', 'LOADING'),
    element('h2', 'student-card__title', title),
    element('p', 'student-card__description', 'ระบบกำลังดึงข้อมูลล่าสุดภายในขอบเขตของคุณ')
  );
  container.replaceChildren(card);
}

function renderLoadError(container, retry) {
  container.setAttribute('aria-busy', 'false');
  const card = element('section', 'student-card student-card--error');
  card.setAttribute('role', 'alert');
  card.dataset.role = 'staff-load-error';
  card.append(
    element('p', 'student-card__eyebrow', 'SERVICE UNAVAILABLE'),
    element('h2', 'student-card__title', 'โหลดข้อมูลไม่สำเร็จ'),
    element('p', 'student-card__description', 'ระบบยังไม่พร้อมให้บริการในขณะนี้ กรุณาลองใหม่อีกครั้ง'),
    button('ลองโหลดอีกครั้ง', retry, { secondary: false })
  );
  container.replaceChildren(card);
}

function renderNotAvailable(container) {
  container.setAttribute('aria-busy', 'false');
  const card = element('section', 'student-card student-card--error');
  card.setAttribute('role', 'alert');
  card.dataset.role = 'staff-plan-not-available';
  card.append(
    element('p', 'student-card__eyebrow', 'NOT AVAILABLE'),
    element('h2', 'student-card__title', 'ไม่สามารถแสดงแผนนี้ได้'),
    element('p', 'student-card__description', NOT_AVAILABLE_MESSAGE),
    link(QUEUE_HASH, 'shell-button shell-button--secondary', 'กลับไปยังคิวตรวจแผน')
  );
  container.replaceChildren(card);
}

function createCard({ eyebrow, title, titleId }) {
  const card = element('section', 'student-card');
  card.setAttribute('aria-labelledby', titleId);
  const heading = element('h2', 'student-card__title', title);
  heading.id = titleId;
  card.append(element('p', 'student-card__eyebrow', eyebrow), heading);
  return card;
}

function createDetailList(rows) {
  const list = element('dl', 'student-profile-list');
  for (const { label, value, field } of rows) {
    const item = element('div', 'student-profile-list__item');
    const detail = element('dd', 'student-profile-list__detail', value);
    if (field) detail.dataset.field = field;
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
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(element('caption', 'advisor-table__caption', caption), head, body);
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

function defaultOperationId() {
  return globalThis.crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/* Review queue                                                        */
/* ------------------------------------------------------------------ */

export function renderStaffReviewQueueView({ staffReviewClient, signal, onSessionExpired, onAccessDenied } = {}) {
  const container = createWorkspace();
  if (!staffReviewClient || typeof staffReviewClient.getReviewQueue !== 'function') {
    return renderFallback(container);
  }

  const filters = { status: '', keyword: '' };

  async function load(page = 1) {
    renderLoading(container, 'กำลังโหลดคิวตรวจแผน...');
    try {
      const result = await staffReviewClient.getReviewQueue({
        page,
        pageSize: DEFAULT_QUEUE_PAGE_SIZE,
        status: filters.status || null,
        keyword: filters.keyword,
        signal
      });
      if (signal?.aborted) return;
      renderQueue(result);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return;
      if (error?.code === STAFF_REVIEW_ERROR_CODES.SESSION_EXPIRED) {
        onSessionExpired?.();
        return;
      }
      if (error?.code === STAFF_REVIEW_ERROR_CODES.NOT_IN_SCOPE) {
        onAccessDenied?.('บัญชีนี้ยังไม่มีขอบเขตการตรวจแผนที่มีผล กรุณาติดต่อผู้ดูแลระบบ');
        return;
      }
      renderLoadError(container, () => load(page));
    }
  }

  function createFilterForm() {
    const form = element('form', 'staff-queue-filter');
    form.setAttribute('role', 'search');
    form.setAttribute('aria-label', 'กรองคิวตรวจแผน');
    form.noValidate = true;

    const keywordField = element('div', 'student-form__field');
    const keywordLabel = element('label', 'student-form__label', 'ค้นหานักศึกษา (รหัสหรือชื่อ)');
    keywordLabel.htmlFor = 'staff-queue-keyword';
    const keywordInput = element('input', 'student-form__input');
    keywordInput.id = 'staff-queue-keyword';
    keywordInput.type = 'search';
    keywordInput.maxLength = 100;
    keywordInput.value = filters.keyword;
    keywordField.append(keywordLabel, keywordInput);

    const statusField = element('div', 'student-form__field');
    const statusLabel = element('label', 'student-form__label', 'สถานะ');
    statusLabel.htmlFor = 'staff-queue-status';
    const statusSelect = element('select', 'student-form__input');
    statusSelect.id = 'staff-queue-status';
    const allOption = element('option', null, 'ทุกสถานะที่รอดำเนินการ');
    allOption.value = '';
    statusSelect.append(allOption);
    for (const status of REVIEW_QUEUE_STATUSES) {
      const option = element('option', null, formatStatus(status));
      option.value = status;
      statusSelect.append(option);
    }
    statusSelect.value = filters.status;
    statusField.append(statusLabel, statusSelect);

    const actions = element('div', 'student-form__actions');
    actions.append(button('ค้นหา', null, { secondary: false, type: 'submit' }));
    form.append(keywordField, statusField, actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      filters.keyword = keywordInput.value.trim();
      filters.status = statusSelect.value;
      load(1);
    });
    return form;
  }

  function renderQueue({ items, pagination }) {
    container.setAttribute('aria-busy', 'false');
    const card = createCard({ eyebrow: 'REVIEW QUEUE', title: 'แผนที่รอดำเนินการ', titleId: 'staff-queue-title' });
    card.append(
      element('p', 'student-card__description', 'แสดงแผนสถานะ SUBMITTED, UNDER_REVIEW และ NEEDS_REVISION ในรอบที่เปิดอยู่ เรียงจากรอนานที่สุด'),
      createFilterForm()
    );

    if (items.length === 0) {
      const empty = element('p', 'student-card__description', filters.keyword || filters.status
        ? 'ไม่พบแผนที่ตรงกับเงื่อนไขที่ค้นหา'
        : 'ไม่มีแผนที่รอดำเนินการในขอบเขตของคุณ');
      empty.dataset.role = 'staff-queue-empty';
      card.append(empty);
      container.replaceChildren(card);
      return;
    }

    const table = createTable({
      caption: 'คิวตรวจแผน',
      columns: ['นักศึกษา', 'สถานประกอบการ / ตำแหน่ง', 'สถานะ', 'เวอร์ชัน', 'อัปเดตล่าสุด', 'ดำเนินการ'],
      rows: items.map((plan) => [
        `${displayText(plan.student?.student_number)} · ${studentName(plan.student)}`,
        `${plan.company?.name || 'ยังไม่ได้ระบุ'} / ${plan.position?.title || 'ยังไม่ได้ระบุ'}`,
        statusBadge(plan.status),
        `v${plan.version}`,
        formatTimestamp(plan.updated_at),
        link(`#/staff/plans/${plan.id}`, 'advisor-link', 'เปิดแผน')
      ])
    });
    table.dataset.role = 'staff-queue-list';
    card.append(table);
    const pager = createPager(pagination, (nextPage) => load(nextPage));
    if (pager) card.append(pager);
    container.replaceChildren(card);
  }

  load();
  return container;
}

/* ------------------------------------------------------------------ */
/* Plan review detail                                                  */
/* ------------------------------------------------------------------ */

export function renderStaffPlanReviewView({
  workflowClient,
  onAccessDenied,
  staffReviewClient,
  planId,
  canReviewPlan = false,
  signal,
  onSessionExpired,
  createOperationId = defaultOperationId
} = {}) {
  const container = createWorkspace();
  if (
    !staffReviewClient ||
    typeof staffReviewClient.getPlanWithHistory !== 'function' ||
    typeof staffReviewClient.runReviewCommand !== 'function'
  ) {
    return renderFallback(container);
  }

  let currentPlan = null;
  let workflowController = null;
  signal?.addEventListener('abort',()=>workflowController?.abort(),{once:true});
  let isSending = false;
  // One operation per confirmed command; reused only to retry the same command with the
  // same notes after a network/service failure, so the server deduplicates it (#52 section 9)
  let pendingOperation = null;

  async function load(feedback = null) {
    workflowController?.abort();
    renderLoading(container, 'กำลังโหลดแผนสหกิจ...');
    try {
      const bundle = await staffReviewClient.getPlanWithHistory(planId, { signal });
      if (signal?.aborted) return;
      renderPlan(bundle, feedback);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return;
      if (error?.code === STAFF_REVIEW_ERROR_CODES.SESSION_EXPIRED) {
        onSessionExpired?.();
        return;
      }
      if (
        error?.code === STAFF_REVIEW_ERROR_CODES.NOT_IN_SCOPE ||
        error?.code === STAFF_REVIEW_ERROR_CODES.NOT_FOUND ||
        error?.code === STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR
      ) {
        renderNotAvailable(container);
        return;
      }
      renderLoadError(container, () => load(feedback));
    }
  }

  function renderPlan({ plan, history }, initialFeedback) {
    currentPlan = plan;
    container.setAttribute('aria-busy', 'false');
    container.dataset.planStatus = plan.status;

    const back = link(QUEUE_HASH, 'advisor-back-link', '← กลับไปยังคิวตรวจแผน');

    // 1. Plan summary
    const summary = createCard({ eyebrow: 'CO-OP PLAN', title: studentName(plan.student), titleId: 'staff-plan-title' });
    const badges = element('div', 'student-dashboard-summary__badges');
    const version = element('span', 'student-badge student-badge--neutral', `เวอร์ชันแผน v${plan.version}`);
    version.dataset.role = 'plan-version';
    badges.append(statusBadge(plan.status), version);
    summary.append(
      badges,
      createDetailList([
        { label: 'รหัสนักศึกษา', value: displayText(plan.student?.student_number), field: 'student_number' },
        { label: 'ภาควิชา / หลักสูตร', value: `${displayText(plan.student?.department)} · ${displayText(plan.student?.program)}`, field: 'program' },
        { label: 'รอบการสมัคร', value: formatCycle(plan.cycle), field: 'cycle' },
        { label: 'สถานประกอบการ', value: plan.company?.name || 'ยังไม่ได้ระบุ', field: 'company' },
        { label: 'ตำแหน่งงาน', value: plan.position?.title || 'ยังไม่ได้ระบุ', field: 'position' },
        { label: 'บันทึกของนักศึกษา', value: displayText(plan.notes), field: 'notes' },
        { label: 'อัปเดตล่าสุด', value: formatTimestamp(plan.updated_at), field: 'updated_at' }
      ])
    );

    // 2. Review actions
    const actionsCard = createCard({ eyebrow: 'REVIEW', title: 'การตรวจแผน', titleId: 'staff-review-title' });
    const feedbackRegion = element('div', 'student-profile-feedback');
    feedbackRegion.dataset.role = 'review-feedback';
    feedbackRegion.tabIndex = -1;
    feedbackRegion.hidden = true;
    actionsCard.append(feedbackRegion);

    function showFeedback(options = null, { focus = false } = {}) {
      const { tone = 'status', message, actionLabel, onAction } = options || {};
      feedbackRegion.replaceChildren();
      if (!message) {
        feedbackRegion.hidden = true;
        feedbackRegion.removeAttribute('role');
        return;
      }
      feedbackRegion.hidden = false;
      feedbackRegion.className = `student-profile-feedback student-profile-feedback--${tone}`;
      feedbackRegion.setAttribute('role', tone === 'status' ? 'status' : 'alert');
      feedbackRegion.append(element('p', 'student-profile-feedback__text', message));
      if (actionLabel && onAction) {
        feedbackRegion.append(button(actionLabel, onAction));
      }
      if (focus) feedbackRegion.focus({ preventScroll: false });
    }

    const commands = getAvailableReviewCommands(plan, { canReviewPlan });
    const commandButtons = element('div', 'student-form__actions');
    commandButtons.dataset.role = 'review-commands';
    const confirmSlot = element('div', 'staff-review-confirm-slot');

    if (commands.length === 0) {
      const reason = !canReviewPlan
        ? 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการตรวจแผน'
        : plan.cycle?.status !== 'OPEN'
          ? 'รอบการสมัครของแผนนี้ปิดแล้ว จึงไม่สามารถดำเนินการตรวจได้'
          : `แผนในสถานะ ${formatStatus(plan.status)} ไม่มีคำสั่งตรวจที่ดำเนินการได้`;
      const noActions = element('p', 'student-profile-official__notice', reason);
      noActions.dataset.role = 'review-no-actions';
      actionsCard.append(noActions);
    } else {
      for (const command of commands) {
        const meta = COMMAND_META[command];
        const trigger = button(meta.label, () => openConfirm(command, trigger), { secondary: meta.secondary });
        trigger.dataset.command = command;
        commandButtons.append(trigger);
      }
      actionsCard.append(
        element('p', 'student-card__description', 'เลือกคำสั่งแล้วยืนยันอีกครั้ง ระบบจะตรวจสถานะและเวอร์ชันของแผนซ้ำก่อนบันทึก'),
        commandButtons,
        confirmSlot
      );
    }

    function setCommandButtonsDisabled(disabled) {
      for (const control of commandButtons.querySelectorAll('button')) control.disabled = disabled;
    }

    function closeConfirm(returnFocusTo = null) {
      confirmSlot.replaceChildren();
      setCommandButtonsDisabled(false);
      returnFocusTo?.focus();
    }

    function openConfirm(command, trigger, { notesValue = '', errorMessage = null } = {}) {
      const meta = COMMAND_META[command];
      setCommandButtonsDisabled(true);
      showFeedback(null);

      const panel = element('section', 'staff-review-confirm');
      panel.dataset.role = 'review-confirm';
      panel.dataset.command = command;
      panel.setAttribute('aria-labelledby', 'staff-review-confirm-title');
      const heading = element('h3', 'staff-review-confirm__title', meta.confirmTitle);
      heading.id = 'staff-review-confirm-title';
      heading.tabIndex = -1;
      panel.append(heading, element('p', 'student-card__description', meta.description));

      const form = element('form', 'student-profile-form');
      form.noValidate = true;
      let textarea = null;
      const fieldError = element('p', 'student-form__error');
      fieldError.id = 'staff-review-notes-error';
      fieldError.dataset.role = 'review-notes-error';
      fieldError.hidden = true;

      if (meta.notes) {
        const field = element('div', 'student-form__field');
        const label = element('label', 'student-form__label', meta.notes.label);
        label.htmlFor = 'staff-review-notes';
        textarea = element('textarea', 'student-form__input staff-review-notes');
        textarea.id = 'staff-review-notes';
        textarea.rows = 4;
        textarea.value = notesValue;
        textarea.required = meta.notes.required;
        textarea.setAttribute('aria-required', String(meta.notes.required));
        const counter = element('span', 'student-form__counter');
        counter.id = 'staff-review-notes-counter';
        const updateCounter = () => {
          counter.textContent = `${textarea.value.trim().length.toLocaleString('th-TH')} / ${MAX_REVIEW_NOTES_LENGTH.toLocaleString('th-TH')}`;
        };
        updateCounter();
        textarea.addEventListener('input', updateCounter);
        textarea.setAttribute('aria-describedby', 'staff-review-notes-counter staff-review-notes-error');
        const metaRow = element('div', 'student-form__meta');
        metaRow.append(element('span', null, 'ข้อความธรรมดา ไม่เกิน 2,000 ตัวอักษร'), counter);
        field.append(label, textarea, metaRow, fieldError);
        form.append(field);
      } else {
        form.append(fieldError);
      }

      const actions = element('div', 'student-form__actions');
      const confirmButton = button(meta.confirmLabel, null, { secondary: false, type: 'submit' });
      confirmButton.dataset.role = 'review-confirm-submit';
      const cancelButton = button('ยกเลิก', () => {
        if (!isSending) closeConfirm(trigger);
      });
      cancelButton.dataset.role = 'review-confirm-cancel';
      actions.append(confirmButton, cancelButton);
      form.append(actions);
      panel.append(form);

      panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !isSending) {
          event.preventDefault();
          closeConfirm(trigger);
        }
      });

      function showFieldError(message) {
        fieldError.textContent = message || '';
        fieldError.hidden = !message;
        if (textarea) {
          if (message) textarea.setAttribute('aria-invalid', 'true');
          else textarea.removeAttribute('aria-invalid');
        }
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSending) return;
        const notes = textarea ? textarea.value.trim() : '';
        const validationMessage = validateReviewNotes(command, notes);
        if (validationMessage) {
          showFieldError(validationMessage);
          (textarea || confirmButton).focus();
          return;
        }
        showFieldError(null);

        if (!pendingOperation || pendingOperation.command !== command || pendingOperation.notes !== notes) {
          pendingOperation = { command, notes, id: createOperationId() };
        }

        isSending = true;
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        if (textarea) textarea.readOnly = true;
        confirmButton.setAttribute('aria-busy', 'true');
        confirmButton.textContent = 'กำลังดำเนินการ...';

        try {
          const result = await staffReviewClient.runReviewCommand({
            planId: currentPlan.id,
            command,
            expectedVersion: currentPlan.version,
            operationId: pendingOperation.id,
            reviewNotes: notes,
            signal
          });
          if (signal?.aborted) return;
          isSending = false;
          pendingOperation = null;
          // Re-read state and history from the server instead of guessing (#77 scope)
          await load({
            tone: 'status',
            message: `${meta.label}เรียบร้อยแล้ว สถานะปัจจุบันคือ ${formatStatus(result.status)}`
          });
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') return;
          isSending = false;
          const retryable = error?.code === STAFF_REVIEW_ERROR_CODES.SERVICE_UNAVAILABLE;
          if (!retryable) pendingOperation = null;

          if (error?.code === STAFF_REVIEW_ERROR_CODES.SESSION_EXPIRED) {
            onSessionExpired?.();
            return;
          }
          if (error?.code === STAFF_REVIEW_ERROR_CODES.VALIDATION_ERROR || retryable) {
            // Keep the panel and the typed notes; a retry reuses the same operation_id
            const panelMessage = retryable
              ? 'ส่งคำสั่งไม่สำเร็จเพราะระบบไม่พร้อม กดยืนยันอีกครั้งเพื่อลองใหม่ ระบบจะไม่บันทึกซ้ำ'
              : 'ข้อมูลไม่ผ่านการตรวจสอบของระบบ กรุณาตรวจสอบความเห็นแล้วลองใหม่';
            openConfirm(command, trigger, { notesValue: notes, errorMessage: panelMessage });
            return;
          }

          closeConfirm();
          const reload = () => load({ tone: 'status', message: 'โหลดสถานะแผนล่าสุดจากเซิร์ฟเวอร์แล้ว' });
          if (
            error?.code === STAFF_REVIEW_ERROR_CODES.STALE_RECORD_CONFLICT ||
            error?.code === STAFF_REVIEW_ERROR_CODES.IDEMPOTENCY_KEY_REUSED
          ) {
            showFeedback({
              tone: 'warning',
              message: 'แผนนี้ถูกเปลี่ยนแปลงโดยผู้อื่นหรือจากหน้าต่างอื่นแล้ว คำสั่งของคุณยังไม่ถูกบันทึก กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการ',
              actionLabel: 'โหลดข้อมูลล่าสุด',
              onAction: reload
            }, { focus: true });
            return;
          }
          if (error?.code === STAFF_REVIEW_ERROR_CODES.INVALID_STATE_TRANSITION) {
            showFeedback({
              tone: 'warning',
              message: 'สถานะปัจจุบันของแผนไม่อนุญาตคำสั่งนี้แล้ว คำสั่งของคุณยังไม่ถูกบันทึก กรุณาโหลดข้อมูลล่าสุด',
              actionLabel: 'โหลดข้อมูลล่าสุด',
              onAction: reload
            }, { focus: true });
            return;
          }
          if (error?.code === STAFF_REVIEW_ERROR_CODES.COMMAND_FORBIDDEN) {
            showFeedback({
              tone: 'error',
              message: 'ไม่สามารถดำเนินการกับแผนนี้ได้ แผนอาจไม่อยู่ในขอบเขตของคุณแล้ว หรือรอบการสมัครปิดแล้ว',
              actionLabel: 'โหลดข้อมูลล่าสุด',
              onAction: reload
            }, { focus: true });
            return;
          }
          showFeedback({
            tone: 'error',
            message: 'ดำเนินการไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่',
            actionLabel: 'โหลดข้อมูลล่าสุด',
            onAction: reload
          }, { focus: true });
        }
      });

      confirmSlot.replaceChildren(panel);
      if (errorMessage) {
        const alert = element('div', 'student-profile-feedback student-profile-feedback--error');
        alert.setAttribute('role', 'alert');
        alert.dataset.role = 'review-confirm-error';
        alert.append(element('p', 'student-profile-feedback__text', errorMessage));
        panel.insertBefore(alert, form);
        confirmButton.focus();
      } else {
        (textarea || heading).focus();
      }
    }

    if (initialFeedback) {
      showFeedback(initialFeedback);
    }

    // 3. History
    const historyCard = createCard({ eyebrow: 'HISTORY', title: 'ประวัติการดำเนินการ', titleId: 'staff-history-title' });
    if (history.length === 0) {
      const empty = element('p', 'student-card__description', 'ยังไม่มีประวัติการดำเนินการของแผนนี้');
      empty.dataset.role = 'staff-history-empty';
      historyCard.append(empty);
    } else {
      const list = element('ol', 'student-plan-history__list');
      list.dataset.role = 'staff-history-list';
      for (const entry of history) {
        const item = element('li', 'student-plan-history__item');
        const header = element('div', 'student-plan-history__header');
        const transition = entry.to_status && entry.from_status !== entry.to_status
          ? `${entry.action_label}: ${entry.from_status ? formatStatus(entry.from_status) : 'เริ่มต้น'} → ${formatStatus(entry.to_status)}`
          : entry.action_label;
        header.append(
          element('strong', 'student-plan-history__transition', transition),
          element('span', 'student-plan-history__time', formatTimestamp(entry.created_at))
        );
        item.append(header, element('p', 'student-plan-history__actor', `ผู้ดำเนินการ: ${entry.actor_label}`));
        if (entry.review_notes) {
          item.append(element('p', 'student-plan-history__reason', `ความเห็น: ${entry.review_notes}`));
        }
        list.append(item);
      }
      historyCard.append(list);
    }

    container.replaceChildren(back, summary, actionsCard, historyCard);
    if (workflowClient) {
      workflowController=new AbortController();
      container.append(renderPlanWorkflow({client:workflowClient,planId,role:'STAFF',signal:workflowController.signal,onSessionExpired,onAccessDenied,onChanged:feedback=>load(feedback)}));
    }
    if (initialFeedback) {
      feedbackRegion.focus({ preventScroll: false });
    }
  }

  load();
  return container;
}
