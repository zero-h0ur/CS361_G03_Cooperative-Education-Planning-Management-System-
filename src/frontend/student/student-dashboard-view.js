import {
  MAX_PREFERRED_NAME_LENGTH,
  STUDENT_PROFILE_ERROR_CODES,
  validatePreferredName
} from './profile-client.js';

const OFFICIAL_FIELD_DEFINITIONS = Object.freeze([
  { key: 'student_number', label: 'รหัสนักศึกษา' },
  { key: 'full_name', label: 'ชื่อ-นามสกุลทางการ' },
  { key: 'institutional_email', label: 'อีเมลสถาบัน' },
  { key: 'department', label: 'ภาควิชา' },
  { key: 'program', label: 'หลักสูตร' },
  { key: 'major', label: 'สาขาวิชา' },
  { key: 'academic_year', label: 'ปีการศึกษา' },
  { key: 'enrollment_status', label: 'สถานะภาพนักศึกษา' }
]);

// enrollment_status values allowed by #51 and chk_students_enrollment_status
const ENROLLMENT_STATUS_LABELS = Object.freeze({
  ACTIVE: 'กำลังศึกษา (ACTIVE)',
  INACTIVE: 'ไม่ได้อยู่ระหว่างการศึกษา (INACTIVE)'
});

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

function formatOfficialValue(key, rawValue) {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return 'ไม่ระบุ';
  }

  const text = String(rawValue).trim();
  if (key === 'enrollment_status' && ENROLLMENT_STATUS_LABELS[text]) {
    return ENROLLMENT_STATUS_LABELS[text];
  }

  return text;
}

function formatDisplayName(profile) {
  if (typeof profile.preferred_name === 'string' && profile.preferred_name.trim() !== '') {
    return `${profile.preferred_name.trim()} (${profile.full_name})`;
  }
  return profile.full_name;
}

export function renderStudentDashboardView({
  profileClient,
  signal,
  onSessionExpired,
  onAccessDenied,
  onNavigate
} = {}) {
  const container = element('div', 'student-workspace');

  if (!profileClient || typeof profileClient.getOwnProfile !== 'function') {
    const fallback = element('section', 'shell-placeholder');
    fallback.append(
      element('span', 'shell-placeholder__index', 'V3'),
      element('h2', 'shell-placeholder__title', 'พื้นที่นี้พร้อมสำหรับการเชื่อมต่อขั้นถัดไป'),
      element('p', 'shell-placeholder__description', 'ยังไม่ได้กำหนด Student Profile Client')
    );
    container.append(fallback);
    return container;
  }

  let currentProfile = null;
  let isSaving = false;

  function isAborted() {
    return Boolean(signal?.aborted);
  }

  function renderLoadingState() {
    container.setAttribute('aria-busy', 'true');
    const loadingCard = element('section', 'student-card student-card--loading');
    loadingCard.setAttribute('role', 'status');
    loadingCard.append(
      element('p', 'student-card__eyebrow', 'LOADING PROFILE'),
      element('h2', 'student-card__title', 'กำลังโหลดข้อมูลนักศึกษา...'),
      element('p', 'student-card__description', 'ระบบกำลังดึงข้อมูลทางการและข้อมูลโปรไฟล์ของคุณจากฐานข้อมูล')
    );
    container.replaceChildren(loadingCard);
  }

  function renderLoadErrorState(message = 'ไม่สามารถโหลดข้อมูลนักศึกษาได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง') {
    container.setAttribute('aria-busy', 'false');
    const errorCard = element('section', 'student-card student-card--error');
    errorCard.setAttribute('role', 'alert');

    const retryButton = element('button', 'shell-button', 'ลองโหลดข้อมูลอีกครั้ง');
    retryButton.type = 'button';
    retryButton.addEventListener('click', () => {
      loadProfile();
    });

    errorCard.append(
      element('p', 'student-card__eyebrow', 'PROFILE UNAVAILABLE'),
      element('h2', 'student-card__title', 'โหลดข้อมูลนักศึกษาไม่สำเร็จ'),
      element('p', 'student-card__description', message),
      retryButton
    );
    container.replaceChildren(errorCard);
  }

  function renderDashboardAndProfile(profile, initialFeedback = null) {
    currentProfile = profile;
    container.setAttribute('aria-busy', 'false');

    // 1. Dashboard Summary Card
    const summarySection = element('section', 'student-card student-dashboard-summary');
    summarySection.setAttribute('aria-labelledby', 'student-dashboard-summary-title');

    const summaryHeader = element('div', 'student-dashboard-summary__header');
    const summaryTitle = element('h2', 'student-card__title', 'สรุปสถานะนักศึกษาและทางลัดสหกิจศึกษา');
    summaryTitle.id = 'student-dashboard-summary-title';

    const displayNameValue = element('p', 'student-dashboard-summary__greeting');
    displayNameValue.dataset.role = 'display-greeting';
    displayNameValue.textContent = `สวัสดี ${formatDisplayName(profile)}`;

    const badgeRow = element('div', 'student-dashboard-summary__badges');
    const statusBadge = element(
      'span',
      'student-badge student-badge--status',
      formatOfficialValue('enrollment_status', profile.enrollment_status)
    );
    const yearBadge = element(
      'span',
      'student-badge student-badge--neutral',
      `ปีการศึกษา ${formatOfficialValue('academic_year', profile.academic_year)}`
    );
    const versionBadge = element(
      'span',
      'student-badge student-badge--neutral',
      `ข้อมูลเวอร์ชัน v${profile.version}`
    );
    versionBadge.dataset.role = 'profile-version';
    badgeRow.append(statusBadge, yearBadge, versionBadge);

    summaryHeader.append(summaryTitle, displayNameValue, badgeRow);

    const planCtaBox = element('div', 'student-dashboard-summary__cta');
    const planCtaCopy = element(
      'p',
      'student-dashboard-summary__cta-copy',
      'ตรวจสอบสถานะการวางแผน เลือกสถานประกอบการ และส่งแผนสหกิจศึกษาเพื่อให้เจ้าหน้าที่ตรวจสอบ'
    );
    const planActions = element('div', 'student-dashboard-summary__actions');

    const planLink = element('a', 'shell-button', 'เปิดแผนสหกิจของฉัน');
    planLink.href = '#/student/plan';
    planLink.dataset.role = 'go-to-student-plan';
    planLink.addEventListener('click', (event) => {
      if (typeof onNavigate === 'function') {
        event.preventDefault();
        onNavigate('#/student/plan');
      }
    });

    const directoryLink = element('a', 'shell-button shell-button--secondary', 'ดูรายชื่อสถานประกอบการ');
    directoryLink.href = 'company-directory.html';

    planActions.append(planLink, directoryLink);
    planCtaBox.append(planCtaCopy, planActions);
    summarySection.append(summaryHeader, planCtaBox);

    // 2. Official Read-Only Profile Card
    const officialSection = element('section', 'student-card student-profile-official');
    officialSection.setAttribute('aria-labelledby', 'student-official-profile-title');

    const officialTitle = element('h2', 'student-card__title', 'ข้อมูลทางการจากทะเบียนนักศึกษา (อ่านอย่างเดียว)');
    officialTitle.id = 'student-official-profile-title';

    const officialNotice = element(
      'p',
      'student-profile-official__notice',
      'ข้อมูลทางการเชื่อมโยงจากระบบทะเบียนของมหาวิทยาลัย นักศึกษาไม่สามารถแก้ไขได้ หากพบข้อมูลไม่ถูกต้องกรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา'
    );

    const officialList = element('dl', 'student-profile-list');
    for (const fieldDef of OFFICIAL_FIELD_DEFINITIONS) {
      const item = element('div', 'student-profile-list__item');
      const dt = element('dt', 'student-profile-list__term', fieldDef.label);
      const dd = element(
        'dd',
        'student-profile-list__detail',
        formatOfficialValue(fieldDef.key, profile[fieldDef.key])
      );
      dd.dataset.field = fieldDef.key;
      item.append(dt, dd);
      officialList.append(item);
    }

    officialSection.append(officialTitle, officialNotice, officialList);

    // 3. Editable Preferred Name Section
    const editableSection = element('section', 'student-card student-profile-editable');
    editableSection.setAttribute('aria-labelledby', 'student-editable-profile-title');

    const editableTitle = element('h2', 'student-card__title', 'ตั้งค่าชื่อที่ต้องการให้แสดง (แก้ไขได้เฉพาะนักศึกษา)');
    editableTitle.id = 'student-editable-profile-title';

    const editableDescription = element(
      'p',
      'student-card__description',
      'คุณสามารถระบุชื่อเล่นหรือชื่อที่ต้องการให้แสดงควบคู่กับชื่อทางการในหน้าพื้นที่ผู้ใช้งาน'
    );

    const feedbackRegion = element('div', 'student-profile-feedback');
    feedbackRegion.dataset.role = 'profile-feedback';
    feedbackRegion.hidden = true;

    const form = element('form', 'student-profile-form');
    form.noValidate = true;

    const fieldGroup = element('div', 'student-form__field');
    const label = element('label', 'student-form__label', 'ชื่อที่ต้องการให้แสดง (Preferred Name)');
    label.htmlFor = 'student-preferred-name';

    const input = element('input', 'student-form__input');
    input.id = 'student-preferred-name';
    input.name = 'preferred_name';
    input.type = 'text';
    input.autocomplete = 'nickname';
    input.value = typeof profile.preferred_name === 'string' ? profile.preferred_name : '';
    input.setAttribute('aria-describedby', 'student-preferred-name-hint student-preferred-name-error');
    input.setAttribute('aria-invalid', 'false');

    const metaRow = element('div', 'student-form__meta');
    const hint = element(
      'p',
      'student-form__hint',
      `ความยาวไม่เกิน ${MAX_PREFERRED_NAME_LENGTH} ตัวอักษร และห้ามมีอักขระควบคุม (เว้นว่างได้หากต้องการแสดงเฉพาะชื่อทางการ)`
    );
    hint.id = 'student-preferred-name-hint';

    const counter = element('span', 'student-form__counter');
    counter.dataset.role = 'char-counter';

    function updateCounter() {
      const length = input.value.trim().length;
      counter.textContent = `${length} / ${MAX_PREFERRED_NAME_LENGTH} ตัวอักษร`;
    }
    updateCounter();

    metaRow.append(hint, counter);

    const errorText = element('p', 'student-form__error');
    errorText.id = 'student-preferred-name-error';
    errorText.setAttribute('role', 'alert');
    errorText.setAttribute('aria-live', 'polite');
    errorText.hidden = true;

    function setFieldError(message) {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        errorText.textContent = message;
        errorText.hidden = false;
      } else {
        input.setAttribute('aria-invalid', 'false');
        errorText.textContent = '';
        errorText.hidden = true;
      }
    }

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

      const textNode = element('p', 'student-profile-feedback__text', message);
      feedbackRegion.append(textNode);

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

    // Validate on blur to avoid premature warnings while typing,
    // and reset error states on input as soon as the user attempts a correction.
    input.addEventListener('blur', () => {
      const validation = validatePreferredName(input.value);
      if (!validation.valid) {
        setFieldError(validation.error);
      }
    });

    input.addEventListener('input', () => {
      updateCounter();
      if (input.getAttribute('aria-invalid') === 'true') {
        setFieldError(null);
      }
    });

    const actionsRow = element('div', 'student-form__actions');
    const submitButton = element('button', 'shell-button', 'บันทึกชื่อที่แสดง');
    submitButton.type = 'submit';

    const resetButton = element('button', 'shell-button shell-button--secondary', 'คืนค่าเดิม');
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => {
      if (isSaving) {
        return;
      }
      input.value = typeof currentProfile.preferred_name === 'string' ? currentProfile.preferred_name : '';
      updateCounter();
      setFieldError(null);
      showFeedback(null);
    });

    actionsRow.append(submitButton, resetButton);
    fieldGroup.append(label, input, metaRow, errorText);
    form.append(fieldGroup, actionsRow);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSaving) {
        return;
      }

      const validation = validatePreferredName(input.value);
      if (!validation.valid) {
        setFieldError(validation.error);
        showFeedback(null);
        input.focus();
        return;
      }

      setFieldError(null);
      showFeedback(null);

      // Disable the submit button after a valid submission is clicked to prevent double-posts.
      isSaving = true;
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'กำลังบันทึก...';
      resetButton.disabled = true;

      try {
        const updatedProfile = await profileClient.updateOwnProfile({
          preferredName: validation.value,
          version: currentProfile.version,
          signal
        });

        if (isAborted()) {
          return;
        }

        isSaving = false;
        renderDashboardAndProfile(updatedProfile, {
          tone: 'status',
          message: 'บันทึกชื่อที่ต้องการให้แสดงเรียบร้อยแล้ว'
        });
      } catch (error) {
        if (isAborted() || error?.name === 'AbortError') {
          return;
        }

        isSaving = false;
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.textContent = 'บันทึกชื่อที่แสดง';
        resetButton.disabled = false;

        if (error?.code === STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED) {
          onSessionExpired?.();
          return;
        }

        if (error?.code === STUDENT_PROFILE_ERROR_CODES.ACCESS_DENIED) {
          onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์แก้ไขข้อมูลนักศึกษา');
          return;
        }

        if (error?.code === STUDENT_PROFILE_ERROR_CODES.VALIDATION_ERROR) {
          setFieldError(error.message || 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
          input.focus();
          return;
        }

        if (error?.code === STUDENT_PROFILE_ERROR_CODES.STALE_RECORD_CONFLICT) {
          showFeedback({
            tone: 'warning',
            message: 'ข้อมูลถูกอัปเดตจากหน้าต่างหรืออุปกรณ์อื่น กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกใหม่',
            actionLabel: 'โหลดข้อมูลล่าสุด',
            onAction: () => {
              loadProfile({
                tone: 'status',
                message: 'ซิงก์ข้อมูลล่าสุดจากระบบเรียบร้อยแล้ว'
              });
            }
          });
          return;
        }

        showFeedback({
          tone: 'error',
          message: 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
        });
      }
    });

    editableSection.append(editableTitle, editableDescription, feedbackRegion, form);
    container.replaceChildren(summarySection, officialSection, editableSection);
  }

  async function loadProfile(postLoadFeedback = null) {
    renderLoadingState();

    try {
      const profile = await profileClient.getOwnProfile({ signal });
      if (isAborted()) {
        return;
      }
      renderDashboardAndProfile(profile, postLoadFeedback);
    } catch (error) {
      if (isAborted() || error?.name === 'AbortError') {
        return;
      }

      if (error?.code === STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED) {
        onSessionExpired?.();
        return;
      }

      if (error?.code === STUDENT_PROFILE_ERROR_CODES.ACCESS_DENIED) {
        onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลนักศึกษา');
        return;
      }

      if (error?.code === STUDENT_PROFILE_ERROR_CODES.NOT_FOUND) {
        renderLoadErrorState('ไม่พบระเบียนข้อมูลนักศึกษาที่เชื่อมโยงกับบัญชีนี้ กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา');
        return;
      }

      renderLoadErrorState();
    }
  }

  loadProfile();
  return container;
}
