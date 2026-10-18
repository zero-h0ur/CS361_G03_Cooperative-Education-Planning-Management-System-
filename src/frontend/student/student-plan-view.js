import {
  PLAN_STATUSES,
  STUDENT_PLAN_ERROR_CODES,
  evaluatePlanReadiness,
  validateSubmissionNote
} from './plan-submission-client.js';

const STATUS_META = Object.freeze({
  [PLAN_STATUSES.DRAFT]: {
    label: 'ฉบับร่าง (DRAFT)',
    badgeClass: 'student-badge--neutral',
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
  [PLAN_STATUSES.RETURNED_FOR_REVISION]: {
    label: 'ส่งกลับให้แก้ไข (RETURNED_FOR_REVISION)',
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

const PLAN_DETAIL_FIELDS = Object.freeze([
  { key: 'academic_year', label: 'ปีการศึกษา' },
  { key: 'semester', label: 'ภาคการศึกษา' },
  { key: 'company_display', label: 'สถานประกอบการ' },
  { key: 'position_title', label: 'ตำแหน่งงานสหกิจ' },
  { key: 'job_description', label: 'รายละเอียดงานโดยสังเขป' },
  { key: 'start_date', label: 'วันเริ่มปฏิบัติงาน' },
  { key: 'end_date', label: 'วันสิ้นสุดการปฏิบัติงาน' }
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
  const fromLabel = entry.from_status ? formatStatusLabel(entry.from_status) : 'เริ่มต้น';
  const toLabel = formatStatusLabel(entry.to_status);
  return `${fromLabel} → ${toLabel}`;
}

function formatTimestamp(isoString) {
  if (!isoString || typeof isoString !== 'string') {
    return 'ไม่ระบุเวลา';
  }
  return isoString;
}

function mergeHistoryLists(existingHistory, incomingHistory) {
  if (!Array.isArray(incomingHistory) || incomingHistory.length === 0) {
    return Array.isArray(existingHistory) ? existingHistory : [];
  }

  // If the server returned the full history array (more than 1 item or no prior history), use it directly
  if (incomingHistory.length > 1 || !Array.isArray(existingHistory) || existingHistory.length === 0) {
    return incomingHistory;
  }

  const newest = incomingHistory[0];
  const alreadyPresent = existingHistory.some(
    (item) =>
      (newest.id && item.id === newest.id) ||
      (item.to_status === newest.to_status && item.created_at === newest.created_at)
  );

  return alreadyPresent ? existingHistory : [...existingHistory, newest];
}

export function renderStudentPlanView({
  planClient,
  signal,
  onSessionExpired,
  onAccessDenied
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

  function isAborted() {
    return Boolean(signal?.aborted);
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
    currentStatusBadge.dataset.role = 'plan-current-status';

    const versionBadge = element('span', 'student-badge student-badge--neutral', `เวอร์ชันแผน v${plan.version}`);
    versionBadge.dataset.role = 'plan-version';

    const modeBadge = element(
      'span',
      'student-badge student-badge--neutral',
      readiness.isReadOnly ? 'โหมดอ่านอย่างเดียว (Read-only)' : 'โหมดแก้ไขและเตรียมส่งแผน'
    );
    modeBadge.dataset.role = 'plan-access-mode';

    statusBadgeRow.append(currentStatusBadge, versionBadge, modeBadge);

    const statusDescription = element('p', 'student-card__description', statusInfo.description);
    statusSection.append(statusTitle, statusBadgeRow, statusDescription);

    if (plan.status === PLAN_STATUSES.RETURNED_FOR_REVISION && plan.return_reason) {
      const returnCallout = element('div', 'student-profile-feedback student-profile-feedback--warning');
      returnCallout.dataset.role = 'plan-return-reason';
      returnCallout.append(
        element('p', 'student-profile-feedback__text', `เหตุผลที่เจ้าหน้าที่ส่งกลับให้แก้ไข: ${plan.return_reason}`)
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
        ? 'ข้อมูลแผนสหกิจศึกษา (ล็อกแบบอ่านอย่างเดียวหลังส่งแผน)'
        : 'ตรวจสอบความพร้อมของข้อมูลแผนก่อนส่ง (Submission Readiness)'
    );
    readinessTitle.id = 'student-plan-readiness-title';

    const readinessSummaryText = element('p', 'student-profile-official__notice');
    readinessSummaryText.dataset.role = 'plan-readiness-summary';
    if (readiness.isReadOnly) {
      readinessSummaryText.textContent =
        'แผนสหกิจอยู่ในสถานะที่ส่งแล้วหรือสิ้นสุดการแก้ไข ข้อมูลทั้งหมดจึงถูกล็อกเป็นแบบอ่านอย่างเดียวตามสัญญา API';
    } else if (readiness.isComplete) {
      readinessSummaryText.textContent =
        'ข้อมูลบังคับครบถ้วนทุกรายการ พร้อมส่งแผนสหกิจศึกษาให้เจ้าหน้าที่ตรวจสอบ';
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

    readinessSection.append(readinessTitle, readinessSummaryText, detailList);

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

    const submitTitle = element('h2', 'student-card__title', 'การส่งแผนสหกิจศึกษา (Submit Plan)');
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

    const noteFieldGroup = element('div', 'student-form__field');
    const noteLabel = element('label', 'student-form__label', 'หมายเหตุประกอบการส่งแผน (ถ้ามี)');
    noteLabel.htmlFor = 'student-plan-submit-note';

    const noteInput = element('textarea', 'student-form__input');
    noteInput.id = 'student-plan-submit-note';
    noteInput.name = 'reason';
    noteInput.rows = 3;
    noteInput.readOnly = readiness.isReadOnly;
    noteInput.disabled = readiness.isReadOnly;
    noteInput.setAttribute('aria-describedby', 'student-plan-submit-note-hint student-plan-submit-note-error');
    noteInput.setAttribute('aria-invalid', 'false');

    const noteHint = element(
      'p',
      'student-form__hint',
      readiness.isReadOnly
        ? 'แผนสหกิจถูกล็อกเป็นแบบอ่านอย่างเดียว ไม่สามารถแก้ไขหรือส่งซ้ำได้ในสถานะนี้'
        : 'ระบุข้อความเพิ่มเติมถึงเจ้าหน้าที่สหกิจศึกษา (ไม่เกิน 500 ตัวอักษร หรือเว้นว่างได้)'
    );
    noteHint.id = 'student-plan-submit-note-hint';

    const noteError = element('p', 'student-form__error');
    noteError.id = 'student-plan-submit-note-error';
    noteError.setAttribute('role', 'alert');
    noteError.setAttribute('aria-live', 'polite');
    noteError.hidden = true;

    function setNoteError(message) {
      if (message) {
        noteInput.setAttribute('aria-invalid', 'true');
        noteError.textContent = message;
        noteError.hidden = false;
      } else {
        noteInput.setAttribute('aria-invalid', 'false');
        noteError.textContent = '';
        noteError.hidden = true;
      }
    }

    noteInput.addEventListener('blur', () => {
      const check = validateSubmissionNote(noteInput.value);
      if (!check.valid) {
        setNoteError(check.error);
      }
    });

    noteInput.addEventListener('input', () => {
      if (noteInput.getAttribute('aria-invalid') === 'true') {
        setNoteError(null);
      }
    });

    const submitActions = element('div', 'student-form__actions');
    const submitButton = element('button', 'shell-button', 'ส่งแผนสหกิจศึกษา');
    submitButton.type = 'submit';
    submitButton.dataset.role = 'submit-plan-button';
    // Submit enabled ONLY when plan/state is submittable and ready (#76 AC 1)
    submitButton.disabled = !readiness.canSubmit;

    const refreshButton = element('button', 'shell-button shell-button--secondary', 'รีเฟรชสถานะล่าสุด');
    refreshButton.type = 'button';
    refreshButton.dataset.role = 'refresh-plan-button';
    refreshButton.addEventListener('click', () => {
      if (!isSubmitting) {
        loadPlanBundle();
      }
    });

    submitActions.append(submitButton, refreshButton);
    noteFieldGroup.append(noteLabel, noteInput, noteHint, noteError);
    form.append(noteFieldGroup, submitActions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSubmitting) {
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

      const noteValidation = validateSubmissionNote(noteInput.value);
      if (!noteValidation.valid) {
        setNoteError(noteValidation.error);
        noteInput.focus();
        return;
      }

      setNoteError(null);
      showFeedback(null);

      // Prevent accidental duplicate submit while request is in flight (#76 Scope & AC)
      isSubmitting = true;
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'กำลังส่งแผนสหกิจ...';
      refreshButton.disabled = true;
      noteInput.readOnly = true;

      try {
        const result = await planClient.submitPlan({
          planId: currentPlan.id,
          version: currentPlan.version,
          reason: noteValidation.value,
          signal
        });

        if (isAborted()) {
          return;
        }

        isSubmitting = false;
        const mergedHistory = mergeHistoryLists(currentHistory, result.statusHistory);
        // Strictly use server response for new state and history (#76 Coordination note)
        renderPlanExperience(result.plan, mergedHistory, {
          tone: 'status',
          message: `ส่งแผนสหกิจศึกษาเรียบร้อยแล้ว สถานะปัจจุบันคือ ${formatStatusLabel(result.plan.status)}`
        });
      } catch (error) {
        if (isAborted() || error?.name === 'AbortError') {
          return;
        }

        isSubmitting = false;
        submitButton.disabled = !evaluatePlanReadiness(currentPlan).canSubmit;
        submitButton.removeAttribute('aria-busy');
        submitButton.textContent = 'ส่งแผนสหกิจศึกษา';
        refreshButton.disabled = false;
        noteInput.readOnly = evaluatePlanReadiness(currentPlan).isReadOnly;

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

        if (
          error?.code === STUDENT_PLAN_ERROR_CODES.INCOMPLETE_PLAN ||
          error?.code === STUDENT_PLAN_ERROR_CODES.VALIDATION_ERROR
        ) {
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

    const historyTitle = element('h2', 'student-card__title', 'ประวัติการเปลี่ยนสถานะแผนสหกิจศึกษา (Status History)');
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
        headerRow.append(
          element('strong', 'student-plan-history__transition', formatTransitionAction(entry)),
          element('span', 'student-plan-history__time', formatTimestamp(entry.created_at))
        );

        const actorLine = element(
          'p',
          'student-plan-history__actor',
          `ผู้ดำเนินการ: ${entry.actor_label}`
        );

        item.append(headerRow, actorLine);

        if (entry.reason) {
          item.append(
            element('p', 'student-plan-history__reason', `หมายเหตุ/เหตุผล: ${entry.reason}`)
          );
        }

        historyList.append(item);
      }

      historySection.append(historyTitle, historyList);
    }

    container.replaceChildren(statusSection, readinessSection, submitSection, historySection);
  }

  async function loadPlanBundle(postLoadFeedback = null) {
    renderLoadingState();

    try {
      const bundle = await planClient.getOwnPlan({ signal });
      if (isAborted()) {
        return;
      }
      renderPlanExperience(bundle.plan, bundle.statusHistory, postLoadFeedback);
    } catch (error) {
      if (isAborted() || error?.name === 'AbortError') {
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
