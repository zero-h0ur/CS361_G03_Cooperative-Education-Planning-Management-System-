import { STUDENT_PROFILE_ERROR_CODES } from './profile-client.js';
import { createWorkspaceIcon, decorateStudentCard } from '../ui/workspace-presentation.js';

const OFFICIAL_FIELD_DEFINITIONS = Object.freeze([
  { key: 'student_number', label: 'รหัสนักศึกษา' },
  { key: 'full_name', label: 'ชื่อ-นามสกุลทางการ' },
  { key: 'institutional_email', label: 'อีเมลสถาบัน' },
  { key: 'department', label: 'ภาควิชา' },
  { key: 'program', label: 'หลักสูตร' },
  { key: 'major', label: 'สาขาวิชา' },
  { key: 'academic_year', label: 'ปีการศึกษา' },
  { key: 'enrollment_status', label: 'สถานภาพนักศึกษา' }
]);

const ENROLLMENT_STATUS_LABELS = Object.freeze({
  ACTIVE: 'กำลังศึกษา (ACTIVE)',
  INACTIVE: 'ไม่ได้อยู่ระหว่างการศึกษา (INACTIVE)'
});

// Informational guidance, not a progress tracker or additional workflow states.
const WORKFLOW_GUIDE = Object.freeze([
  {
    title: 'เตรียมแผนสหกิจของคุณ',
    text: 'เปิดหน้าแผนสหกิจเพื่อเตรียมฉบับร่างและตรวจสอบข้อมูลก่อนส่ง ชื่อ-นามสกุล รหัสนักศึกษา และข้อมูลทางการจากมหาวิทยาลัยเป็นข้อมูลอ่านอย่างเดียว'
  },
  {
    title: 'ส่งแผนให้เจ้าหน้าที่ตรวจสอบ',
    text: 'เมื่อส่งแผนแล้ว ให้รอเจ้าหน้าที่ตรวจสอบ ระหว่างรอตรวจจะไม่สามารถแก้ไข ลบ หรือส่งแผนเดิมซ้ำได้ ตรวจสอบสถานะจริงได้ที่หน้าแผนสหกิจ'
  },
  {
    title: 'ตรวจผลพิจารณาและแก้ไขเมื่อได้รับแจ้ง',
    text: 'เจ้าหน้าที่ตรวจคุณสมบัติตามเกณฑ์ของสาขา การไม่อนุมัติเพราะคุณสมบัติไม่ผ่านต่างจากการส่งกลับให้แก้ไข หากได้รับแจ้งให้แก้ไข ให้ทำตามข้อเสนอแนะก่อนส่งอีกครั้ง การแก้ไขไม่ได้หมายถึงได้รับอนุมัติโดยอัตโนมัติ'
  },
  {
    title: 'รอเจ้าหน้าที่มอบหมายอาจารย์ที่ปรึกษา',
    text: 'หลังได้รับอนุมัติ เจ้าหน้าที่เป็นผู้มอบหมายอาจารย์ที่ปรึกษาโดยพิจารณาบริษัท ตำแหน่ง และหัวข้อโครงการที่เหมาะสม อาจารย์จะอ่านข้อมูลของคุณได้เมื่อได้รับมอบหมายแล้ว'
  }
]);

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (typeof text === 'string') node.textContent = text;
  return node;
}

function formatOfficialValue(key, value) {
  if (value === null || value === undefined || String(value).trim() === '') return 'ไม่ระบุ';
  const text = String(value).trim();
  return key === 'enrollment_status' ? ENROLLMENT_STATUS_LABELS[text] || text : text;
}

function updatedLabel(value) {
  if (!value) return 'ไม่ระบุวันที่อัปเดต';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ไม่ระบุวันที่อัปเดต';
  return `อัปเดตข้อมูลล่าสุด ${new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
  }).format(date)}`;
}

export function renderStudentDashboardView({
  profileClient, signal, onSessionExpired, onAccessDenied, onNavigate
} = {}) {
  const container = element('div', 'student-workspace student-profile-workspace');
  if (!profileClient || typeof profileClient.getOwnProfile !== 'function') {
    const fallback = element('section', 'shell-placeholder');
    fallback.append(element('h2', 'shell-placeholder__title', 'ยังไม่พร้อมโหลดข้อมูลนักศึกษา'),
      element('p', 'shell-placeholder__description', 'ยังไม่ได้กำหนด Student Profile Client'));
    container.append(fallback);
    return container;
  }

  let isLoading = false;
  let requestVersion = 0;
  const expandedSteps = new Set();

  function renderLoadingState() {
    container.setAttribute('aria-busy', 'true');
    const card = element('section', 'student-card student-card--loading');
    card.setAttribute('role', 'status');
    card.append(element('h2', 'student-card__title', 'กำลังโหลดข้อมูลนักศึกษา...'),
      element('p', 'student-card__description', 'กำลังเรียกข้อมูลของคุณ กรุณารอสักครู่'));
    container.replaceChildren(card);
  }

  function renderLoadErrorState(message = 'ไม่สามารถโหลดข้อมูลนักศึกษาได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง') {
    container.setAttribute('aria-busy', 'false');
    const card = element('section', 'student-card student-card--error');
    card.setAttribute('role', 'alert');
    const retry = element('button', 'shell-button', 'ลองโหลดข้อมูลอีกครั้ง');
    retry.type = 'button';
    retry.addEventListener('click', () => loadProfile({ restoreFocus: true }));
    card.append(element('h2', 'student-card__title', 'โหลดข้อมูลนักศึกษาไม่สำเร็จ'),
      element('p', 'student-card__description', message), retry);
    container.replaceChildren(card);
  }

  function createGuide() {
    const section = element('section', 'student-card student-profile-guide');
    section.setAttribute('aria-labelledby', 'student-profile-guide-title');
    const title = element('h2', 'student-card__title', 'วางแผนขั้นตอนถัดไป');
    title.id = 'student-profile-guide-title';
    section.append(title, element('p', 'student-card__description',
      'คู่มือขั้นตอนทั่วไป ไม่ใช่สถานะปัจจุบันของคุณ กดแต่ละหัวข้อเพื่ออ่านรายละเอียด'));
    const list = element('ol', 'student-profile-guide__steps');
    WORKFLOW_GUIDE.forEach((step, index) => {
      const item = element('li');
      const details = element('details', 'student-profile-guide__step');
      details.open = expandedSteps.has(index);
      const summary = element('summary', 'student-profile-guide__summary', step.title);
      const body = element('p', 'student-profile-guide__content', step.text);
      details.addEventListener('toggle', () => {
        if (details.open) expandedSteps.add(index);
        else expandedSteps.delete(index);
      });
      details.append(summary, body);
      item.append(details);
      list.append(item);
    });
    const external = element('aside', 'student-profile-guide__external');
    external.append(element('h3', '', 'การสมัครบริษัทเป็นขั้นตอนแยกจากการอนุมัติแผน'),
      element('p', '', 'ส่ง CV / Resume และสมัครกับบริษัทด้วยตนเอง เมื่อบริษัทรับและคุณตอบตกลง ให้ส่งชื่อบริษัท ตำแหน่ง และหัวข้อโครงการผ่านแบบฟอร์มหรือช่องทางที่เจ้าหน้าที่กำหนด เจ้าหน้าที่จะประสานให้บริษัทยืนยันข้อมูลให้ตรงกัน หน้าโปรไฟล์นี้ไม่ได้รับเอกสารหรือยืนยันบริษัท'));
    section.append(list, external);
    return decorateStudentCard(section, 'clipboard');
  }

  function renderDashboardAndProfile(profile, refreshed) {
    container.setAttribute('aria-busy', 'false');
    const summarySection = element('section', 'student-card student-dashboard-summary');
    summarySection.setAttribute('aria-labelledby', 'student-dashboard-summary-title');
    const header = element('div', 'student-dashboard-summary__header');
    const title = element('h2', 'student-card__title', 'ข้อมูลนักศึกษาของคุณ');
    title.id = 'student-dashboard-summary-title';
    const greeting = element('p', 'student-dashboard-summary__greeting', `สวัสดี ${formatOfficialValue('full_name', profile.full_name)}`);
    greeting.dataset.role = 'display-greeting';
    const badges = element('div', 'student-dashboard-summary__badges');
    badges.append(element('span', `student-badge ${profile.enrollment_status === 'ACTIVE' ? 'student-badge--status' : 'student-badge--neutral'}`,
      formatOfficialValue('enrollment_status', profile.enrollment_status)),
    element('span', 'student-badge student-badge--neutral', `ปีการศึกษา ${formatOfficialValue('academic_year', profile.academic_year)}`));
    header.append(title, greeting, badges);

    const cta = element('div', 'student-dashboard-summary__cta');
    const actions = element('div', 'student-dashboard-summary__actions');
    const plan = element('a', 'shell-button', 'เปิดแผนสหกิจของฉัน');
    plan.href = '#/student/plan';
    plan.dataset.role = 'go-to-student-plan';
    plan.prepend(createWorkspaceIcon('file'));
    plan.addEventListener('click', (event) => {
      if (typeof onNavigate === 'function' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
        event.preventDefault(); onNavigate('#/student/plan');
      }
    });
    const directory = element('a', 'shell-button shell-button--secondary', 'ดูรายชื่อสถานประกอบการ');
    directory.href = 'company-directory.html';
    directory.prepend(createWorkspaceIcon('building'));
    actions.append(plan, directory);
    cta.append(element('p', 'student-dashboard-summary__cta-copy',
      'ตรวจข้อมูลทางการให้ถูกต้อง แล้วเปิดแผนสหกิจเพื่อเตรียมฉบับร่าง ส่งให้เจ้าหน้าที่ตรวจ และติดตามผลพิจารณา'), actions);
    summarySection.append(header, cta);

    const official = element('section', 'student-card student-profile-official');
    official.setAttribute('aria-labelledby', 'student-official-profile-title');
    const officialTitle = element('h2', 'student-card__title', 'ข้อมูลทางการจากทะเบียนนักศึกษา');
    officialTitle.id = 'student-official-profile-title';
    const toolbar = element('div', 'student-profile-toolbar');
    const lock = element('span', 'student-badge student-badge--neutral', 'อ่านอย่างเดียว');
    lock.prepend(createWorkspaceIcon('lock'));
    const refresh = element('button', 'shell-button shell-button--secondary student-profile-refresh', 'รีเฟรชข้อมูล');
    refresh.type = 'button';
    refresh.dataset.role = 'profile-refresh';
    refresh.prepend(createWorkspaceIcon('refresh'));
    refresh.addEventListener('click', () => loadProfile({ refreshButton: refresh, restoreFocus: true }));
    toolbar.append(lock, refresh);
    const feedback = element('p', 'student-profile-refresh-status');
    feedback.dataset.role = 'profile-refresh-status';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-atomic', 'true');
    feedback.textContent = refreshed ? 'โหลดข้อมูลล่าสุดเรียบร้อยแล้ว' : 'ข้อมูลนี้ใช้ตรวจสอบตัวตนและข้อมูลการศึกษาของคุณ';
    const list = element('dl', 'student-profile-list');
    for (const field of OFFICIAL_FIELD_DEFINITIONS) {
      const item = element('div', 'student-profile-list__item');
      const detail = element('dd', 'student-profile-list__detail', formatOfficialValue(field.key, profile[field.key]));
      detail.dataset.field = field.key;
      item.append(element('dt', 'student-profile-list__term', field.label), detail);
      list.append(item);
    }
    const metadata = element('p', 'student-profile-metadata', updatedLabel(profile.updated_at));
    const version = element('span', '', `ข้อมูลเวอร์ชัน v${profile.version}`);
    version.dataset.role = 'profile-version';
    metadata.append(version);
    official.append(officialTitle, toolbar, element('p', 'student-profile-official__notice',
      'ชื่อ-นามสกุล รหัสนักศึกษา และข้อมูลจากมหาวิทยาลัยไม่สามารถแก้ไขในหน้านี้ได้ หากข้อมูลไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา'),
    feedback, list, metadata);
    container.replaceChildren(decorateStudentCard(summarySection, 'user'), decorateStudentCard(official, 'lock'), createGuide());
  }

  async function loadProfile({ refreshButton = null, restoreFocus = false } = {}) {
    if (isLoading || signal?.aborted) return;
    isLoading = true;
    const version = ++requestVersion;
    const hadFocus = restoreFocus && container.contains(document.activeElement);
    if (refreshButton) {
      container.setAttribute('aria-busy', 'true');
      refreshButton.disabled = true;
      refreshButton.setAttribute('aria-busy', 'true');
      refreshButton.replaceChildren(createWorkspaceIcon('refresh'), document.createTextNode('กำลังรีเฟรช...'));
      container.querySelector('[data-role="profile-refresh-status"]').textContent = 'กำลังโหลดข้อมูลนักศึกษาล่าสุด';
    } else renderLoadingState();

    try {
      const profile = await profileClient.getOwnProfile({ signal });
      if (signal?.aborted || version !== requestVersion) return;
      renderDashboardAndProfile(profile, Boolean(refreshButton));
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || version !== requestVersion) return;
      // Never leave private profile content behind on an authorization failure.
      if (error?.code === STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED) {
        container.replaceChildren(); onSessionExpired?.(); return;
      }
      if (error?.code === STUDENT_PROFILE_ERROR_CODES.ACCESS_DENIED) {
        container.replaceChildren(); onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลนักศึกษา'); return;
      }
      renderLoadErrorState(error?.code === STUDENT_PROFILE_ERROR_CODES.NOT_FOUND
        ? 'ไม่พบระเบียนข้อมูลนักศึกษาที่เชื่อมโยงกับบัญชีนี้ กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา' : undefined);
    } finally {
      isLoading = false;
      // Restore only when rerender removed the focused control, not if the user moved elsewhere.
      if (!signal?.aborted && container.isConnected && hadFocus && document.activeElement === document.body) {
        const target = container.querySelector('[data-role="profile-refresh"]') || container.querySelector('button');
        target?.focus();
      }
    }
  }

  loadProfile();
  return container;
}
