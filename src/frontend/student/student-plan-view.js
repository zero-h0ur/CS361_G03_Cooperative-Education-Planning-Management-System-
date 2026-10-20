import {
  PLAN_STATUSES,
  STUDENT_PLAN_ERROR_CODES,
  evaluatePlanReadiness,
  findLatestReturnReason
} from './plan-submission-client.js';
import { renderPlanEditor } from './plan-editor-view.js';
import { createWorkspaceIcon, decorateStudentCard } from '../ui/workspace-presentation.js';

const STATUS_META = Object.freeze({
  [PLAN_STATUSES.DRAFT]: {
    label: 'ฉบับร่าง (DRAFT)',
    badgeClass: 'student-badge--draft',
    description: 'แผนสหกิจยังเป็นฉบับร่าง ตรวจสอบความครบถ้วนของข้อมูลแล้วกดส่งแผนเพื่อให้เจ้าหน้าที่ตรวจสอบ'
  },
  [PLAN_STATUSES.SUBMITTED]: {
    label: 'ส่งแผนแล้ว (SUBMITTED)',
    badgeClass: 'student-badge--status',
    description: 'ส่งแผนสหกิจศึกษาเรียบร้อยแล้ว ข้อมูลถูกล็อกเป็นแบบอ่านอย่างเดียวระหว่างรอเจ้าหน้าที่รับเรื่องตรวจแผน'
  },
  [PLAN_STATUSES.UNDER_REVIEW]: {
    label: 'กำลังตรวจสอบ (UNDER_REVIEW)',
    badgeClass: 'student-badge--status',
    description: 'เจ้าหน้าที่กำลังตรวจสอบแผนสหกิจของคุณ ข้อมูลถูกล็อกเป็นแบบอ่านอย่างเดียว'
  },
  [PLAN_STATUSES.NEEDS_REVISION]: {
    label: 'ส่งกลับให้แก้ไข (NEEDS_REVISION)',
    badgeClass: 'student-badge--warning',
    description: 'เจ้าหน้าที่ส่งแผนกลับมาให้ปรับปรุง กรุณาตรวจสอบเหตุผลการส่งกลับ แก้ไขข้อมูลให้ครบถ้วน แล้วกดส่งแผนอีกครั้ง'
  },
  [PLAN_STATUSES.APPROVED]: {
    label: 'อนุมัติแล้ว (APPROVED)',
    badgeClass: 'student-badge--status',
    description: 'แผนสหกิจศึกษาได้รับการอนุมัติเรียบร้อยแล้ว ข้อมูลทั้งหมดถูกล็อกเป็นแบบอ่านอย่างเดียว'
  },
  [PLAN_STATUSES.CANCELLED]: {
    label: 'ยกเลิกแผน (CANCELLED)',
    badgeClass: 'student-badge--danger',
    description: 'แผนสหกิจศึกษานี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขหรือส่งซ้ำได้'
  }
});

// Plan fields from #52; Company/Position names come from the public directory
const PLAN_DETAIL_FIELDS = Object.freeze([
  { key: 'cycle_id', label: 'รอบการสมัคร (Cycle)' },
  { key: 'company_display', label: 'สถานประกอบการ' },
  { key: 'position_display', label: 'ตำแหน่งงาน' },
  { key: 'notes', label: 'บันทึกของนักศึกษา' }
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

function formatPlanFieldValue(plan, key) {
  if (key === 'company_display') {
    if (typeof plan.company_name === 'string' && plan.company_name.trim() !== '') {
      return plan.company_name.trim();
    }
    if (typeof plan.company_id === 'string' && plan.company_id.trim() !== '') {
      return `รหัสสถานประกอบการ ${plan.company_id.trim()}`;
    }
    return 'ยังไม่ได้ระบุ';
  }

  if (key === 'position_display') {
    if (typeof plan.position_title === 'string' && plan.position_title.trim() !== '') {
      return plan.position_title.trim();
    }
    if (typeof plan.position_id === 'string' && plan.position_id.trim() !== '') {
      return `รหัสตำแหน่งงาน ${plan.position_id.trim()}`;
    }
    return 'ยังไม่ได้ระบุ';
  }

  const raw = plan[key];
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return 'ยังไม่ได้ระบุ';
  }
  return String(raw).trim();
}

function formatStatusLabel(status) {
  return STATUS_META[status]?.label || status || 'ไม่ระบุสถานะ';
}

function formatTransitionAction(entry) {
  if (!entry.to_status || entry.from_status === entry.to_status) {
    return entry.action_label;
  }
  const fromLabel = entry.from_status ? formatStatusLabel(entry.from_status) : 'เริ่มต้น';
  return `${entry.action_label}: ${fromLabel} → ${formatStatusLabel(entry.to_status)}`;
}

const historyDateFormatter = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
});

function formatTimestamp(isoString) {
  if (!isoString || typeof isoString !== 'string') {
    return 'ไม่ระบุเวลา';
  }
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? 'ไม่ระบุเวลา' : historyDateFormatter.format(date);
}

function defaultOperationId() {
  return globalThis.crypto.randomUUID();
}

export function renderStudentPlanView({
  planClient,
  signal,
  onSessionExpired,
  onAccessDenied,
  createOperationId = defaultOperationId
} = {}) {
  const container = element('div', 'student-workspace student-plan-workspace');

  if (!planClient || typeof planClient.getOwnPlan !== 'function') {
    const fallback = element('section', 'shell-placeholder');
    fallback.append(
      element('span', 'shell-placeholder__index', 'V3'),
      element('h2', 'shell-placeholder__title', 'พื้นที่นี้พร้อมสำหรับการเชื่อมต่อขั้นถัดไป'),
      element('p', 'shell-placeholder__description', 'ยังไม่ได้กำหนด Student Plan Client')
    );
    container.append(fallback);
    return container;
  }

  let currentPlan = null;
  let currentHistory = [];
  let isSubmitting = false;
  let currentPlans = [];
  let selectedPlanId = null;
  let editorController = null;
  let editorDirty = false;
  let editorBusy = false;
  let loadSequence = 0;
  let submitNeedsRefresh = false;
  // One operation_id per submit click, reused only when retrying after a network
  // failure so the server deduplicates the request instead of submitting twice (#52 section 9)
  let pendingOperationId = null;

  function isAborted() {
    return Boolean(signal?.aborted);
  }

  signal?.addEventListener('abort', () => editorController?.abort(), { once: true });

  function syncEditorControls() {
    const locked = editorDirty || editorBusy || isSubmitting;
    for (const control of container.querySelectorAll('[data-editor-lock]')) {
      control.disabled = locked || control.dataset.unavailable === 'true';
    }
    const editorControls = container.querySelector('[data-role="plan-editor-controls"]');
    if (editorControls) editorControls.disabled = isSubmitting || submitNeedsRefresh;
  }

  function renderPlanPicker() {
    if (typeof planClient.saveDraft !== 'function' || currentPlans.length === 0) return null;
    const picker = element('section', 'student-card plan-picker');
    const label = element('label', 'student-form__label', 'เปิดแผนที่บันทึกไว้');
    label.htmlFor = 'student-plan-picker';
    const select = element('select', 'student-form__input');
    select.id = label.htmlFor;
    select.dataset.editorLock = 'true';
    for (const plan of currentPlans) {
      const created = new Date(plan.created_at);
      const date = Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString('th-TH');
      const option = element('option', '', `${formatStatusLabel(plan.status)}${date ? ` — สร้าง ${date}` : ''}`);
      option.value = plan.id;
      select.append(option);
    }
    select.value = selectedPlanId || currentPlan?.id || currentPlans[0].id;
    select.addEventListener('change', () => {
      if (editorDirty || editorBusy || isSubmitting) return;
      selectedPlanId = select.value;
      loadPlanBundle();
    });
    const create = element('button', 'shell-button shell-button--secondary', 'สร้างแผนใหม่');
    create.type = 'button';
    create.dataset.editorLock = 'true';
    create.addEventListener('click', () => {
      if (editorDirty || editorBusy || isSubmitting) return;
      editorController?.abort();
      selectedPlanId = null;
      pendingOperationId = null;
      renderNoPlanState();
    });
    picker.append(label, select, create);
    return picker;
  }

  function makeEditor(plan = null) {
    if (typeof planClient.saveDraft !== 'function') return null;
    editorController?.abort();
    editorController = new AbortController();
    editorDirty = false;
    editorBusy = false;
    const editor = renderPlanEditor({
      plan, planClient, signal: editorController.signal, createOperationId,
      onSessionExpired, onAccessDenied,
      onDirtyChange: (dirty) => { editorDirty = dirty; syncEditorControls(); },
      onBusyChange: (busy) => { editorBusy = busy; syncEditorControls(); },
      onReload: () => loadPlanBundle(),
      onSaved: async (saved) => {
        selectedPlanId = saved.id;
        await loadPlanBundle({ tone: 'status', message: 'บันทึกแผนเรียบร้อยแล้ว กรุณาตรวจสอบข้อมูลก่อนส่งแผน' });
      }
    });
    return editor ? decorateStudentCard(editor, 'edit') : null;
  }

  function renderLoadingState() {
    container.setAttribute('aria-busy', 'true');
    const card = element('section', 'student-card student-card--loading');
    card.setAttribute('role', 'status');
    card.append(
      element('p', 'student-card__eyebrow', 'LOADING PLAN'),
      element('h2', 'student-card__title', 'กำลังโหลดข้อมูลแผนสหกิจศึกษา...'),
      element('p', 'student-card__description', 'ระบบกำลังดึงสถานะล่าสุดและประวัติการดำเนินการของแผนสหกิจศึกษา')
    );
    container.replaceChildren(card);
  }

  function renderLoadErrorState(message = 'ไม่สามารถโหลดข้อมูลแผนสหกิจศึกษาได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง') {
    container.setAttribute('aria-busy', 'false');
    const card = element('section', 'student-card student-card--error');
    card.setAttribute('role', 'alert');

    const retryBtn = element('button', 'shell-button', 'ลองโหลดข้อมูลแผนอีกครั้ง');
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', () => {
      loadPlanBundle();
    });

    card.append(
      element('p', 'student-card__eyebrow', 'PLAN UNAVAILABLE'),
      element('h2', 'student-card__title', 'โหลดแผนสหกิจศึกษาไม่สำเร็จ'),
      element('p', 'student-card__description', message),
      retryBtn
    );
    container.replaceChildren(card);
  }

  function renderNoPlanState() {
    container.setAttribute('aria-busy', 'false');
    container.dataset.planStatus = 'DRAFT';
    container.dataset.planReadonly = 'false';
    const card = element('section', 'student-card');
    card.dataset.role = 'plan-empty';
    const refreshBtn = element('button', 'shell-button shell-button--secondary', 'รีเฟรชสถานะล่าสุด');
    refreshBtn.type = 'button';
    refreshBtn.dataset.editorLock = 'true';
    refreshBtn.addEventListener('click', () => {
      if (!editorDirty && !editorBusy) loadPlanBundle();
    });
    card.append(
      element('p', 'student-card__eyebrow', 'NO PLAN YET'),
      element('h2', 'student-card__title', 'ยังไม่มีแผนสหกิจศึกษา'),
      element('p', 'student-card__description', 'เลือกรอบสมัครเพื่อเริ่มบันทึกฉบับร่าง คุณสามารถเลือกสถานประกอบการและตำแหน่งงานเพิ่มเติมได้ภายหลัง'),
      refreshBtn
    );
    const picker = renderPlanPicker();
    const editor = makeEditor();
    container.replaceChildren(...[picker, card, editor].filter(Boolean));
    container.classList.add('student-workspace--ready');
    syncEditorControls();
  }

  function renderPlanExperience(plan, statusHistory, initialFeedback = null) {
    currentPlan = plan;
    currentHistory = Array.isArray(statusHistory) ? statusHistory : [];
    const readiness = evaluatePlanReadiness(plan);
    const statusInfo = STATUS_META[plan.status] || {
      label: plan.status,
      badgeClass: 'student-badge--neutral',
      description: ''
    };

    container.setAttribute('aria-busy', 'false');
    container.dataset.planStatus = plan.status;
    container.dataset.planReadonly = String(readiness.isReadOnly);

    // 1. Current Status & Summary Card
    const statusSection = element('section', 'student-card student-plan-status');
    statusSection.setAttribute('aria-labelledby', 'student-plan-status-title');

    const statusTitle = element('h2', 'student-card__title', 'สถานะแผนสหกิจศึกษาปัจจุบัน');
    statusTitle.id = 'student-plan-status-title';

    const statusBadgeRow = element('div', 'student-dashboard-summary__badges');
    const currentStatusBadge = element('span', `student-badge ${statusInfo.badgeClass}`, statusInfo.label);
    if (plan.status === PLAN_STATUSES.DRAFT) currentStatusBadge.prepend(createWorkspaceIcon('edit'));
    currentStatusBadge.dataset.role = 'plan-current-status';

    const versionBadge = element('span', 'student-badge student-badge--neutral', `เวอร์ชันแผน v${plan.version}`);
    versionBadge.dataset.role = 'plan-version';

    const modeBadge = element(
      'span',
      'student-plan-access-mode',
      readiness.isReadOnly ? 'โหมดอ่านอย่างเดียว (Read-only)' : 'โหมดแก้ไขและเตรียมส่งแผน'
    );
    modeBadge.dataset.role = 'plan-access-mode';

    statusBadgeRow.append(currentStatusBadge, versionBadge);

    const statusDescription = element('p', 'student-card__description', statusInfo.description);
    const statusHeading = element('div', 'student-plan-status__heading');
    statusHeading.append(statusTitle);
    statusSection.append(statusHeading, statusBadgeRow, statusDescription, modeBadge);

    const returnReason = plan.status === PLAN_STATUSES.NEEDS_REVISION
      ? findLatestReturnReason(currentHistory)
      : null;
    if (returnReason) {
      const returnCallout = element('div', 'student-profile-feedback student-profile-feedback--warning');
      returnCallout.dataset.role = 'plan-return-reason';
      returnCallout.append(
        element('p', 'student-profile-feedback__text', `เหตุผลที่เจ้าหน้าที่ส่งกลับให้แก้ไข: ${returnReason}`)
      );
      statusSection.append(returnCallout);
    }

    // 2. Plan Details & Readiness Checklist Card
    const readinessSection = element('section', 'student-card student-plan-readiness');
    readinessSection.setAttribute('aria-labelledby', 'student-plan-readiness-title');

    const readinessTitle = element(
      'h2',
      'student-card__title',
      readiness.isReadOnly
        ? 'ข้อมูลแผนสหกิจศึกษา (อ่านอย่างเดียว)'
        : 'ตรวจสอบความพร้อมก่อนส่ง'
    );
    readinessTitle.id = 'student-plan-readiness-title';

    const readinessSummaryText = element('p', 'student-profile-official__notice');
    readinessSummaryText.dataset.role = 'plan-readiness-summary';
    if (readiness.isReadOnly) {
      readinessSummaryText.textContent =
        'สถานะปัจจุบันไม่อนุญาตให้แก้ไขหรือส่งแผนซ้ำ คุณยังตรวจสอบข้อมูลและประวัติได้';
    } else if (readiness.isComplete) {
      readinessSummaryText.textContent =
        'ระบุข้อมูลเบื้องต้นครบแล้ว ระบบจะตรวจว่ารอบเปิดรับและข้อมูลยังใช้ได้อีกครั้งเมื่อส่งแผน';
    } else {
      readinessSummaryText.textContent =
        `ข้อมูลยังไม่ครบถ้วนสำหรับส่งแผน (ขาดอีก ${readiness.missingFields.length} รายการ) กรุณากรอกข้อมูลให้ครบก่อนกดส่งแผน`;
    }

    const detailList = element('dl', 'student-profile-list');
    for (const item of PLAN_DETAIL_FIELDS) {
      const wrapper = element('div', 'student-profile-list__item');
      wrapper.dataset.readonly = String(readiness.isReadOnly);
      const dt = element('dt', 'student-profile-list__term', item.label);
      const dd = element('dd', 'student-profile-list__detail', formatPlanFieldValue(plan, item.key));
      dd.dataset.planField = item.key;
      wrapper.append(dt, dd);
      detailList.append(wrapper);
    }

    readinessSection.append(readinessTitle, detailList, readinessSummaryText);
    // Resolve the human-readable Cycle label using the existing Student options API.
    // Never derive a name from an ID or change the submitted reference.
    if (plan.cycle_id && typeof planClient.listCycles === 'function') {
      Promise.resolve().then(() => planClient.listCycles({ signal })).then((cycles) => {
        if (signal?.aborted || currentPlan?.id !== plan.id) return;
        const cycle = cycles.find((item) => item.id === plan.cycle_id);
        const value = detailList.querySelector('[data-plan-field="cycle_id"]');
        if (cycle && value) value.textContent = cycle.name;
      }).catch((error) => {
        if (signal?.aborted) return;
        if (error?.code === STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED) onSessionExpired?.();
        else if (error?.code === STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED) onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์เข้าถึงรอบสมัคร');
        // For transient failures keep the original reference visible.
      });
    }

    if (!readiness.isComplete && readiness.isSubmittableStatus) {
      const missingBox = element('div', 'student-profile-feedback student-profile-feedback--warning');
      missingBox.dataset.role = 'plan-missing-fields';
      const missingText = readiness.missingFields.map((m) => m.issue).join(', ');
      missingBox.append(
        element('p', 'student-profile-feedback__text', `รายการที่ต้องระบุเพิ่มก่อนส่งแผน: ${missingText}`)
      );
      readinessSection.append(missingBox);
    }

    // 3. Plan Submission Action Card
    const submitSection = element('section', 'student-card student-plan-submit');
    submitSection.setAttribute('aria-labelledby', 'student-plan-submit-title');

    const submitTitle = element('h2', 'student-card__title', 'การส่งแผนสหกิจศึกษา');
    submitTitle.id = 'student-plan-submit-title';

    const feedbackRegion = element('div', 'student-profile-feedback');
    feedbackRegion.dataset.role = 'plan-submit-feedback';
    feedbackRegion.hidden = true;

    function showFeedback(options = null) {
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

      if (actionLabel && typeof onAction === 'function') {
        const actionBtn = element('button', 'shell-button shell-button--secondary', actionLabel);
        actionBtn.type = 'button';
        actionBtn.addEventListener('click', onAction);
        feedbackRegion.append(actionBtn);
      }
    }

    if (initialFeedback) {
      showFeedback(initialFeedback);
    }

    const form = element('form', 'student-profile-form');
    form.noValidate = true;

    const readinessBanner = element('div', `student-plan-submit__readiness student-plan-submit__readiness--${
      readiness.isReadOnly ? 'neutral' : readiness.canSubmit ? 'ready' : 'warning'}`);
    readinessBanner.dataset.role = 'plan-submit-readiness';
    readinessBanner.append(createWorkspaceIcon(readiness.isReadOnly ? 'lock' : readiness.canSubmit ? 'check' : 'warning'));
    const readinessCopy = element('div');
    readinessCopy.append(
      element('strong', null, readiness.isReadOnly ? 'แผนอยู่ในโหมดอ่านอย่างเดียว'
        : readiness.canSubmit ? 'ข้อมูลเบื้องต้นครบ พร้อมส่งตรวจ' : 'ยังมีข้อมูลที่ต้องระบุก่อนส่ง'),
      element('p', null, readiness.isReadOnly ? 'ตรวจสอบรายละเอียดและติดตามประวัติด้านล่างได้'
        : readiness.canSubmit ? 'ระบบจะตรวจสอบรอบรับสมัครและข้อมูลอีกครั้งเมื่อกดส่ง'
          : 'ตรวจสอบรายการที่ขาดในส่วนข้อมูลแผนด้านบน')
    );
    readinessBanner.append(readinessCopy);

    const submitHint = element(
      'p',
      'student-form__hint',
      readiness.isReadOnly
        ? 'แผนสหกิจถูกล็อกเป็นแบบอ่านอย่างเดียว ไม่สามารถแก้ไขหรือส่งซ้ำได้ในสถานะนี้'
        : 'ระบบจะตรวจซ้ำตอนส่งว่ารอบการสมัครยังเปิดอยู่ และสถานประกอบการกับตำแหน่งงานยังเปิดเผยอยู่'
    );
    submitHint.dataset.role = 'plan-submit-hint';

    const submitActions = element('div', 'student-form__actions');
    const submitButton = element('button', 'shell-button', 'ส่งแผนสหกิจศึกษา');
    submitButton.type = 'submit';
    submitButton.dataset.role = 'submit-plan-button';
    submitButton.dataset.editorLock = 'true';
    submitButton.dataset.unavailable = String(!readiness.canSubmit);
    submitButton.setAttribute('aria-describedby', 'student-plan-submit-hint');
    // Submit enabled ONLY when plan/state is submittable and ready (#76 AC 1)
    submitButton.disabled = !readiness.canSubmit;

    const refreshButton = element('button', 'shell-button shell-button--secondary', 'รีเฟรชสถานะล่าสุด');
    refreshButton.type = 'button';
    refreshButton.dataset.role = 'refresh-plan-button';
    refreshButton.dataset.editorLock = 'true';
    refreshButton.prepend(createWorkspaceIcon('refresh'));
    refreshButton.addEventListener('click', () => {
      if (!isSubmitting && !editorDirty && !editorBusy) {
        loadPlanBundle();
      }
    });

    submitActions.append(submitButton, refreshButton);
    submitHint.id = 'student-plan-submit-hint';
    form.append(readinessBanner, submitActions, submitHint);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSubmitting || editorDirty || editorBusy) {
        return;
      }

      const currentReadiness = evaluatePlanReadiness(currentPlan);
      if (!currentReadiness.canSubmit) {
        showFeedback({
          tone: 'error',
          message: currentReadiness.isReadOnly
            ? 'แผนสหกิจอยู่ในสถานะที่ไม่สามารถส่งซ้ำได้'
            : 'ข้อมูลแผนสหกิจยังไม่ครบถ้วนตามเงื่อนไขการส่งแผน'
        });
        return;
      }

      showFeedback(null);
      pendingOperationId = pendingOperationId || createOperationId();

      // Prevent accidental duplicate submit while request is in flight (#76 Scope & AC)
      isSubmitting = true;
      syncEditorControls();
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'กำลังส่งแผนสหกิจ...';
      refreshButton.disabled = true;

      try {
        const result = await planClient.submitPlan({
          planId: currentPlan.id,
          expectedVersion: currentPlan.version,
          operationId: pendingOperationId,
          signal
        });

        if (isAborted()) {
          return;
        }

        isSubmitting = false;
        pendingOperationId = null;
        // Re-read state and history from the server instead of guessing (#76 coordination note)
        await loadPlanBundle({
          tone: 'status',
          message: `ส่งแผนสหกิจศึกษาเรียบร้อยแล้ว สถานะปัจจุบันคือ ${formatStatusLabel(result.status)}`
        });
      } catch (error) {
        if (isAborted() || error?.name === 'AbortError') {
          return;
        }

        isSubmitting = false;
        // A submit attempt may have committed before a network failure. Require
        // a server refresh before editing the same Plan again.
        submitNeedsRefresh = [STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE,
          STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT,
          STUDENT_PLAN_ERROR_CODES.INVALID_STATE_TRANSITION].includes(error?.code);
        syncEditorControls();
        submitButton.disabled = !evaluatePlanReadiness(currentPlan).canSubmit;
        submitButton.removeAttribute('aria-busy');
        submitButton.textContent = 'ส่งแผนสหกิจศึกษา';
        refreshButton.disabled = false;
        // Keep the operation_id only for a network failure, so retrying the same click is deduplicated
        if (error?.code !== STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE) {
          pendingOperationId = null;
        }

        if (error?.code === STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED) {
          onSessionExpired?.();
          return;
        }

        if (error?.code === STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED) {
          onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์ส่งแผนสหกิจศึกษารายการนี้');
          return;
        }

        if (
          error?.code === STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT ||
          error?.code === STUDENT_PLAN_ERROR_CODES.INVALID_STATE_TRANSITION
        ) {
          showFeedback({
            tone: 'warning',
            message: error.message || 'ข้อมูลหรือสถานะของแผนมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลแผนล่าสุด',
            actionLabel: 'โหลดข้อมูลแผนล่าสุด',
            onAction: () => {
              loadPlanBundle({
                tone: 'status',
                message: 'ซิงก์สถานะแผนสหกิจล่าสุดจากเซิร์ฟเวอร์เรียบร้อยแล้ว'
              });
            }
          });
          return;
        }

        if (error?.code === STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR) {
          const detailIssues = Array.isArray(error.details) && error.details.length > 0
            ? ` (${error.details.map((d) => d.field || d.issue).join(', ')})`
            : '';
          showFeedback({
            tone: 'error',
            message: `${error.message || 'ข้อมูลแผนสหกิจยังไม่ครบถ้วน'}${detailIssues}`
          });
          return;
        }

        showFeedback({
          tone: 'error',
          message: 'ส่งแผนสหกิจศึกษาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
        });
      }
    });

    submitSection.append(submitTitle, feedbackRegion, form);

    // 4. Audit-Derived Status History Timeline Card
    const historySection = element('section', 'student-card student-plan-history');
    historySection.setAttribute('aria-labelledby', 'student-plan-history-title');

    const historyTitle = element('h2', 'student-card__title', 'ประวัติการเปลี่ยนสถานะ');
    historyTitle.id = 'student-plan-history-title';

    if (currentHistory.length === 0) {
      const emptyHistory = element(
        'p',
        'student-card__description',
        'ยังไม่มีประวัติการเปลี่ยนสถานะของแผนสหกิจศึกษานี้'
      );
      emptyHistory.dataset.role = 'plan-history-empty';
      historySection.append(historyTitle, emptyHistory);
    } else {
      const historyList = element('ol', 'student-plan-history__list');
      historyList.dataset.role = 'plan-history-list';

      for (const entry of currentHistory) {
        const item = element('li', 'student-plan-history__item');
        const headerRow = element('div', 'student-plan-history__header');
        const timestamp = element('time', 'student-plan-history__time', formatTimestamp(entry.created_at));
        if (entry.created_at && !Number.isNaN(Date.parse(entry.created_at))) timestamp.dateTime = entry.created_at;
        headerRow.append(element('strong', 'student-plan-history__transition', entry.action_label), timestamp);

        const actorLine = element(
          'p',
          'student-plan-history__actor',
          `ผู้ดำเนินการ: ${entry.actor_label}`
        );

        item.append(headerRow, actorLine);

        if (entry.to_status && entry.from_status !== entry.to_status) {
          item.append(element('p', 'student-plan-history__states', formatTransitionAction(entry)));
        }

        if (entry.reason) {
          item.append(
            element('p', 'student-plan-history__reason', `ความเห็นจากเจ้าหน้าที่: ${entry.reason}`)
          );
        }

        historyList.append(item);
      }

      historySection.append(historyTitle, historyList);
    }

    const picker = renderPlanPicker();
    const editor = makeEditor(plan);
    const tools = picker || editor ? element('details', 'student-plan-tools') : null;
    if (tools) {
      const summary = element('summary', 'student-plan-tools__summary', editor
        ? 'จัดการและแก้ไขแผนสหกิจ' : 'เลือกแผนหรือสร้างแผนใหม่');
      tools.append(summary, ...[picker, editor].filter(Boolean));
      // Keep the reference's four-card overview while retaining the complete editor.
      const manage = element('button', 'student-plan-status__manage', editor ? 'แก้ไขแผน' : 'เลือกแผน');
      manage.type = 'button';
      manage.prepend(createWorkspaceIcon(editor ? 'edit' : 'file'));
      manage.addEventListener('click', () => {
        tools.open = true;
        summary.focus({ preventScroll: true });
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        tools.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
      });
      statusHeading.append(manage);
      if (plan.status === PLAN_STATUSES.NEEDS_REVISION) tools.open = true;
    }
    container.replaceChildren(...[
      decorateStudentCard(statusSection, 'file'),
      decorateStudentCard(readinessSection, 'clipboard'),
      decorateStudentCard(submitSection, 'send'),
      decorateStudentCard(historySection, 'clock'),
      tools
    ].filter(Boolean));
    // Content is now readable; keep this class through saves and refreshes.
    container.classList.add('student-workspace--ready');
    syncEditorControls();
  }

  async function loadPlanBundle(postLoadFeedback = null) {
    const sequence = ++loadSequence;
    editorController?.abort();
    editorDirty = false;
    editorBusy = false;
    submitNeedsRefresh = false;
    pendingOperationId = null;
    renderLoadingState();

    try {
      const bundle = await planClient.getOwnPlan({ signal, ...(selectedPlanId ? { planId: selectedPlanId } : {}) });
      if (isAborted() || sequence !== loadSequence) {
        return;
      }
      currentPlans = bundle.plans || (bundle.plan ? [bundle.plan] : []);
      selectedPlanId = bundle.plan?.id || null;
      if (!bundle.plan) {
        renderNoPlanState();
        return;
      }
      renderPlanExperience(bundle.plan, bundle.statusHistory, postLoadFeedback);
      if (postLoadFeedback) {
        const feedback = container.querySelector('[data-role="plan-submit-feedback"]');
        feedback.tabIndex = -1;
        feedback.focus();
      }
    } catch (error) {
      if (isAborted() || sequence !== loadSequence || error?.name === 'AbortError') {
        return;
      }

      if (error?.code === STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED) {
        onSessionExpired?.();
        return;
      }

      if (error?.code === STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED) {
        onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์เข้าถึงแผนสหกิจศึกษานี้');
        return;
      }

      if (error?.code === STUDENT_PLAN_ERROR_CODES.NOT_FOUND) {
        renderLoadErrorState('ยังไม่มีแผนสหกิจศึกษาที่สร้างไว้สำหรับบัญชีนี้');
        return;
      }

      renderLoadErrorState();
    }
  }

  loadPlanBundle();
  return container;
}
