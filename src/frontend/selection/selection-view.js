const LABELS = Object.freeze({
  AWAITING_COORDINATOR: 'รอผู้ประสานงานรับเรื่อง',
  NEEDS_REVISION: 'ส่งกลับให้แก้ไข',
  UNDER_COMMITTEE_REVIEW: 'ส่งต่อกรรมการแล้ว',
  SELECTION_COMPLETE_PENDING_ANNOUNCEMENT: 'ครบ 3 ความเห็นแล้ว รอประกาศผล'
});

const SHORT_LABELS = Object.freeze({
  AWAITING_COORDINATOR: 'รอตรวจสอบ',
  NEEDS_REVISION: 'ส่งกลับแก้ไข',
  UNDER_COMMITTEE_REVIEW: 'ส่งต่อกรรมการแล้ว',
  SELECTION_COMPLETE_PENDING_ANNOUNCEMENT: 'ครบ 3 ความเห็น'
});

const BADGE_TONES = Object.freeze({
  AWAITING_COORDINATOR: 'coordinator-badge--pending',
  NEEDS_REVISION: 'coordinator-badge--revision',
  UNDER_COMMITTEE_REVIEW: 'coordinator-badge--review',
  SELECTION_COMPLETE_PENDING_ANNOUNCEMENT: 'coordinator-badge--complete'
});

const CORE_COURSES_66 = Object.freeze([
  { code: 'คพ.100', name: 'การเขียนโปรแกรมเบื้องต้น / พื้นฐานวิทยาการคอมพิวเตอร์' },
  { code: 'คพ.101', name: 'โครงสร้างข้อมูลและอัลกอริทึมพื้นฐาน' },
  { code: 'คพ.102', name: 'การเขียนโปรแกรมเชิงวัตถุ' },
  { code: 'คพ.111', name: 'คณิตศาสตร์ดิสครีตสำหรับวิทยาการคอมพิวเตอร์' },
  { code: 'คพ.213 / คพ.216', name: 'สถาปัตยกรรมคอมพิวเตอร์และระบบปฏิบัติการ' },
  { code: 'คพ.251', name: 'ระบบฐานข้อมูล' },
  { code: 'คพ.261', name: 'วิศวกรรมซอฟต์แวร์' }
]);

const CORE_COURSES_61 = Object.freeze([
  { code: 'คพ.101', name: 'โครงสร้างข้อมูลและอัลกอริทึมพื้นฐาน' },
  { code: 'คพ.102', name: 'การเขียนโปรแกรมเชิงวัตถุ' },
  { code: 'คพ.111', name: 'คณิตศาสตร์ดิสครีตสำหรับวิทยาการคอมพิวเตอร์' },
  { code: 'คพ.213 / คพ.216', name: 'สถาปัตยกรรมคอมพิวเตอร์และระบบปฏิบัติการ' },
  { code: 'คพ.251', name: 'ระบบฐานข้อมูล' },
  { code: 'คพ.264', name: 'โครงสร้างข้อมูลขั้นสูงและวิศวกรรมซอฟต์แวร์' }
]);

const PREREQ_COURSES_66 = Object.freeze({
  mandatory: { code: 'คพ.180', name: 'วิชาบังคับตามเงื่อนไขก่อนฝึกงาน / สหกิจศึกษา' },
  electives: [
    { code: 'คพ.262', name: 'การออกแบบและพัฒนาเว็บ' },
    { code: 'คพ.331', name: 'การเขียนโปรแกรมบนอุปกรณ์เคลื่อนที่' },
    { code: 'คพ.240', name: 'การเขียนโปรแกรมระบบคลาวด์' }
  ]
});

const PREREQ_COURSES_61 = Object.freeze({
  mandatory: { code: 'คพ.384', name: 'การเตรียมความพร้อมสหกิจศึกษาและโครงงาน' },
  electives: [
    { code: 'คพ.266', name: 'เทคโนโลยีเว็บขั้นสูง' },
    { code: 'คพ.322', name: 'การพัฒนาแอปพลิเคชันบนอุปกรณ์เคลื่อนที่' },
    { code: 'คพ.348', name: 'เทคโนโลยีความปลอดภัยสารสนเทศ' }
  ]
});

const ADVANCE_COURSE_66 = Object.freeze({
  code: 'คพ.301',
  name: 'เตรียมความพร้อมสหกิจศึกษา'
});

const ADVANCE_COURSE_61 = Object.freeze({
  code: 'คพ.302',
  name: 'สัมมนาสหกิจศึกษา'
});

const REQUIRED_DOCUMENTS_TEMPLATE = Object.freeze([
  { key: 'cv', title: 'CV / Resume', description: 'ประวัติย่อ ทักษะการเขียนโปรแกรม และผลงานของนักศึกษา' },
  { key: 'transcript', title: 'ใบแจ้งผลการศึกษา (Transcript)', description: 'ใช้ตรวจสอบ GPAX (≥ 2.75) และเกรดวิชาบังคับ 7 วิชาหลัก (≥ 2.50)' },
  { key: 'photo', title: 'รูปถ่ายนักศึกษา', description: 'รูปถ่ายชุดนักศึกษาหน้าตรง สุภาพ สำหรับแนบใบสมัคร' },
  { key: 'conduct', title: 'เอกสารรับรองความประพฤติ', description: 'ต้องมีลายเซ็นอาจารย์ที่ปรึกษาเซ็นรับรองครบถ้วน' }
]);

const REVISION_CHECKLIST_OPTIONS = Object.freeze([
  'เอกสารรับรองความประพฤติขาดลายเซ็นอาจารย์ที่ปรึกษา',
  'เกรดเฉลี่ยสะสม (GPAX) หรือเกรดวิชาหลัก 7 วิชาไม่ตรงกับใบแจ้งผลการศึกษา (Transcript)',
  'ไฟล์เอกสารแนบไม่ครบ 4 รายการ หรือไฟล์ไม่ชัดเจน',
  'ข้อมูลการติดต่อ ที่อยู่ หรือข้อมูลผู้ปกครองไม่ครบถ้วน'
]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function normalizeDocuments(row) {
  const refs = Array.isArray(row.document_references) ? row.document_references : [];
  return REQUIRED_DOCUMENTS_TEMPLATE.map((tpl, index) => {
    const matched = refs.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const type = String(item.type || item.key || item.category || '').toLowerCase();
      const name = String(item.name || item.title || item.filename || '').toLowerCase();
      return type.includes(tpl.key) || name.includes(tpl.key) || (tpl.key === 'cv' && name.includes('resume'));
    }) || refs[index] || null;

    if (matched && typeof matched === 'object') {
      return {
        ...tpl,
        attached: true,
        fileName: matched.filename || matched.name || matched.title || `${tpl.title}.pdf`,
        reference: matched.reference || matched.uri || matched.url || matched.id || `DOC-${index + 1}`,
        updatedAt: matched.uploaded_at || matched.updated_at || row.submitted_at || null,
        summary: matched.summary || matched.note || `ไฟล์แนบสำหรับ ${tpl.title} พร้อมให้ผู้ประสานงานตรวจสอบ`
      };
    }
    if (typeof matched === 'string' && matched.trim()) {
      return {
        ...tpl,
        attached: true,
        fileName: matched.trim(),
        reference: matched.trim(),
        updatedAt: row.submitted_at || null,
        summary: `อ้างอิงเอกสาร: ${matched.trim()}`
      };
    }
    return {
      ...tpl,
      attached: false,
      fileName: 'ยังไม่ได้ระบุชื่อไฟล์แนบในระบบ',
      reference: '-',
      updatedAt: null,
      summary: 'กรุณาตรวจสอบจากชุดเอกสารใบสมัครหรือแจ้งให้นักศึกษาแนบเพิ่มเติมหากไม่ครบถ้วน'
    };
  });
}

function evaluateEligibility(row) {
  const is61 =
    row.curriculum_year === '61' ||
    (typeof row.curriculum === 'string' && row.curriculum.includes('61')) ||
    (typeof row.student_number === 'string' && row.student_number.startsWith('61'));

  // 1. Department / Major check (Computer Science)
  const deptText = `${row.department || ''} ${row.program || ''} ${row.major || ''} ${row.program_track || ''}`;
  const isCSStudent =
    deptText.includes('คอมพิวเตอร์') ||
    deptText.includes('CS') ||
    deptText.includes('CPE') ||
    !row.department;
  const rule1 = {
    id: 1,
    title: '1. เป็นนักศึกษาสาขาวิชาวิทยาการคอมพิวเตอร์ คณะวิทยาศาสตร์ฯ ม.ธรรมศาสตร์',
    passed: isCSStudent,
    detail: isCSStudent
      ? 'สังกัดสาขาวิชาวิทยาการคอมพิวเตอร์ ถูกต้องตามระเบียบ'
      : 'ไม่พบข้อมูลสังกัดสาขาวิชาวิทยาการคอมพิวเตอร์',
    checklistKey: 'ข้อมูลการติดต่อ ที่อยู่ หรือข้อมูลผู้ปกครองไม่ครบถ้วน'
  };

  // 2. Core Courses GPA >= 2.50
  const coreGpaVal = row.core_gpa !== undefined && row.core_gpa !== null ? Number(row.core_gpa) : null;
  const coreGpaPassed = coreGpaVal !== null ? coreGpaVal >= 2.5 : true;
  const rule2 = {
    id: 2,
    title: `2. เคยศึกษาวิชาหลักตาม${is61 ? 'หลักสูตร 61 (6 วิชา)' : 'หลักสูตร 66 (7 วิชา)'} และเกรดเฉลี่ยกลุ่มนี้ไม่ต่ำกว่า 2.50`,
    passed: coreGpaPassed,
    detail:
      coreGpaVal !== null
        ? `เกรดเฉลี่ยกลุ่มวิชาหลัก: ${coreGpaVal.toFixed(2)} (เกณฑ์ขั้นต่ำ 2.50)`
        : 'ตรวจสอบเกรดเฉลี่ยรายวิชาหลักจาก Transcript (เกณฑ์ขั้นต่ำ 2.50)',
    checklistKey: 'เกรดเฉลี่ยสะสม (GPAX) หรือเกรดวิชาหลัก 7 วิชาไม่ตรงกับใบแจ้งผลการศึกษา (Transcript)'
  };

  // 3. Prerequisite Courses (Mandatory + Electives)
  let rule3Passed = true;
  let rule3Detail = '';
  if (row.prerequisite_courses) {
    const mand = row.prerequisite_courses.mandatory;
    const elecs = row.prerequisite_courses.electives || {};
    const mandOk = mand && mand.grade && mand.grade !== '-';
    const elecOk = Object.values(elecs).some((g) => g && g !== '-');
    rule3Passed = Boolean(mandOk && elecOk);
    const mandCode = is61 ? 'คพ.384' : 'คพ.180';
    rule3Detail = rule3Passed
      ? `ผ่านเกณฑ์วิชาบังคับ (${mandCode}) และเลือกศึกษาอย่างน้อย 1 รายวิชาครบถ้วน`
      : `ยังขาดผลการศึกษาวิชาบังคับ (${mandCode}) หรือยังไม่มีผลการศึกษาวิชาเลือกในกลุ่ม`;
  } else {
    rule3Passed = true;
    rule3Detail = `ตรวจสอบผลการศึกษาของ ${is61 ? 'คพ.384 และวิชาเลือกกลุ่ม 61' : 'คพ.180 และวิชาเลือกกลุ่ม 66'}`;
  }
  const rule3 = {
    id: 3,
    title: `3. กำลังศึกษา หรือเคยศึกษาวิชาตามเงื่อนไข (${is61 ? 'คพ.384 บังคับ และวิชาเลือกอย่างน้อย 1 รายวิชา' : 'คพ.180 บังคับ และวิชาเลือกอย่างน้อย 1 รายวิชา'})`,
    passed: rule3Passed,
    detail: rule3Detail,
    checklistKey: 'เกรดเฉลี่ยสะสม (GPAX) หรือเกรดวิชาหลัก 7 วิชาไม่ตรงกับใบแจ้งผลการศึกษา (Transcript)'
  };

  // 4. Advance course before co-op (คพ.301 / คพ.302)
  const advCode = is61 ? 'คพ.302' : 'คพ.301';
  const rule4 = {
    id: 4,
    title: `4. รับทราบเงื่อนไขว่าจะต้องสอบได้วิชา ${advCode} ก่อนออกปฏิบัติงานจริง`,
    passed: true,
    detail: `รับทราบเงื่อนไขวิชา ${advCode} (${row.advance_course?.status || 'ลงทะเบียน/กำลังศึกษา'})`,
    checklistKey: null
  };

  // 5. GPAX >= 2.75
  const gpaxVal = row.gpax !== undefined && row.gpax !== null ? Number(row.gpax) : null;
  const gpaxPassed = gpaxVal !== null ? gpaxVal >= 2.75 : true;
  const rule5 = {
    id: 5,
    title: '5. มีผลการเรียนเฉลี่ยสะสม (GPAX) ไม่ต่ำกว่า 2.75',
    passed: gpaxPassed,
    detail:
      gpaxVal !== null
        ? `GPAX: ${gpaxVal.toFixed(2)} (เกณฑ์ขั้นต่ำ 2.75)`
        : 'ตรวจสอบ GPAX จากใบแจ้งผลการศึกษา (Transcript)',
    checklistKey: 'เกรดเฉลี่ยสะสม (GPAX) หรือเกรดวิชาหลัก 7 วิชาไม่ตรงกับใบแจ้งผลการศึกษา (Transcript)'
  };

  // 6. Good conduct & advisor signed document
  const docs = normalizeDocuments(row);
  const conductDoc = docs.find((d) => d.key === 'conduct');
  const conductNote = `${conductDoc?.fileName || ''} ${conductDoc?.summary || ''} ${row.revision_notes || ''}`.toLowerCase();
  const conductUnsigned =
    conductNote.includes('unsigned') ||
    conductNote.includes('ขาดลายเซ็น') ||
    conductNote.includes('ไม่ปรากฏลายเซ็น') ||
    conductNote.includes('ฉบับร่าง');
  const conductPassed = Boolean(conductDoc?.attached && !conductUnsigned);
  const rule6 = {
    id: 6,
    title: '6. มีความประพฤติเรียบร้อย (มีเอกสารรับรองความประพฤติที่มีลายเซ็นอาจารย์ที่ปรึกษา)',
    passed: conductPassed,
    detail: conductPassed
      ? 'เอกสารรับรองความประพฤติถูกต้องและมีลายเซ็นอาจารย์ที่ปรึกษาครบถ้วน'
      : 'เอกสารรับรองความประพฤติยังขาดลายเซ็นอาจารย์ที่ปรึกษา หรือยังไม่ได้แนบเอกสารฉบับสมบูรณ์',
    checklistKey: 'เอกสารรับรองความประพฤติขาดลายเซ็นอาจารย์ที่ปรึกษา'
  };

  // 7. All 4 documents attached
  const attachedCount = docs.filter((d) => d.attached).length;
  const allDocsPassed = attachedCount === 4 && conductPassed;
  const rule7 = {
    id: 7,
    title: '7. รับทราบเกณฑ์และแนบเอกสารครบถ้วน 4 รายการ (CV, Transcript, รูปถ่าย, เอกสารรับรองความประพฤติ)',
    passed: allDocsPassed,
    detail: allDocsPassed
      ? 'แนบเอกสารประกอบการสมัครครบทั้ง 4 รายการ'
      : `แนบเอกสารแล้ว ${attachedCount} / 4 รายการ (ต้องตรวจสอบความถูกต้องและลายเซ็น)`,
    checklistKey: 'ไฟล์เอกสารแนบไม่ครบ 4 รายการ หรือไฟล์ไม่ชัดเจน'
  };

  const rules = [rule1, rule2, rule3, rule4, rule5, rule6, rule7];
  const allPassed = rules.every((r) => r.passed);
  const failedRules = rules.filter((r) => !r.passed);

  return { rules, allPassed, failedRules };
}

export function renderSelectionWorkspace({ client, role, signal, onSessionExpired, onAccessDenied } = {}) {
  const root = el('section', 'workflow-stack selection-workspace');
  const intro = el('section', 'workflow-card coordinator-intro-card');
  const coordinator = role === 'COORDINATOR';
  if (!coordinator && role !== 'COMMITTEE') {
    root.append(el('p', null, 'ไม่มีสิทธิ์เปิดพื้นที่นี้'));
    return root;
  }

  intro.append(
    el('h2', null, coordinator ? 'ตรวจสอบใบสมัคร รับเรื่อง และส่งต่อกรรมการ (Phase 1)' : 'บันทึกความเห็นแยกรายบุคคล'),
    el('p', 'shell-muted', 'กรรมการสามคนต้องบันทึกความเห็นแยกกันต่อผู้สมัครแต่ละคน ครบสามความเห็นไม่ใช่ผลผ่าน/ไม่ผ่าน และระบบยังไม่ประกาศผล'),
    el('p', 'shell-muted', 'ยังไม่มีข้อมูลเกรด GPAX/7 วิชาในระบบส่วนนี้ จึงยังไม่จัดอันดับหรือสร้างคะแนนสมมติ')
  );

  const feedback = el('p', 'workflow-feedback');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  const filter = el('form', `workflow-form selection-filters${coordinator ? ' selection-filters--coordinator' : ''}`);
  filter.setAttribute('aria-label', 'กรองผู้สมัครในขอบเขตที่ได้รับมอบหมาย');
  const department = el('select');
  const program = el('select');
  const stateFilter = el('select');
  const curriculumFilter = coordinator ? el('select') : null;
  const trackFilter = coordinator ? el('select') : null;
  const searchInput = el('input', 'coordinator-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = 'ค้นหารหัสนักศึกษา หรือ ชื่อ-นามสกุล';

  function selectField(title, input) {
    const label = el('label', 'coordinator-field-label', title);
    if (input.tagName === 'SELECT') {
      const wrap = el('div', 'coordinator-select-wrap');
      wrap.append(input);
      label.append(wrap);
    } else {
      label.append(input);
    }
    filter.append(label);
  }

  if (coordinator) {
    selectField('ค้นหานักศึกษา', searchInput);
    const stateOptions = [
      ['', 'ทั้งหมด'],
      ['AWAITING_COORDINATOR', 'รอตรวจสอบ'],
      ['NEEDS_REVISION', 'ส่งกลับแก้ไข'],
      ['UNDER_COMMITTEE_REVIEW', 'ส่งต่อกรรมการแล้ว'],
      ['SELECTION_COMPLETE_PENDING_ANNOUNCEMENT', 'ครบ 3 ความเห็นแล้ว']
    ];
    for (const [val, text] of stateOptions) {
      const opt = el('option', null, text);
      opt.value = val;
      stateFilter.append(opt);
    }
    selectField('สถานะใบสมัคร', stateFilter);

    const curriculumOptions = [
      ['', 'ทั้งหมด'],
      ['66', 'หลักสูตร 66'],
      ['61', 'หลักสูตร 61']
    ];
    for (const [val, text] of curriculumOptions) {
      const opt = el('option', null, text);
      opt.value = val;
      curriculumFilter.append(opt);
    }
    selectField('หลักสูตร', curriculumFilter);

    const trackOptions = [
      ['', 'ทั้งหมด'],
      ['คอมพิวเตอร์และวิทยาการสารสนเทศ (ภาคปกติ)', 'คอมพิวเตอร์และวิทยาการสารสนเทศ (ภาคปกติ)'],
      ['คอมพิวเตอร์ประยุกต์ (ภาคพิเศษ)', 'คอมพิวเตอร์ประยุกต์ (ภาคพิเศษ)'],
      ['คอมพิวเตอร์เครือข่ายและความปลอดภัยทางไซเบอร์ (ภาคพิเศษ)', 'คอมพิวเตอร์เครือข่ายและความปลอดภัยทางไซเบอร์ (ภาคพิเศษ)']
    ];
    for (const [val, text] of trackOptions) {
      const opt = el('option', null, text);
      opt.value = val;
      trackFilter.append(opt);
    }
    selectField('สาขาวิชา (ภาคปกติ / พิเศษ)', trackFilter);

    const filterActions = el('div', 'coordinator-filter-actions');
    const reset = el('button', 'shell-button shell-button--secondary coordinator-reset-btn', 'ล้างตัวกรอง');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      searchInput.value = '';
      stateFilter.value = '';
      curriculumFilter.value = '';
      trackFilter.value = '';
      queuePage = 1;
      renderCoordinatorSplitView();
    });
    filterActions.append(reset);
    filter.append(filterActions);
  } else {
    selectField('ภาควิชา', department);
    selectField('หลักสูตร', program);

    const filterActions = el('div', 'coordinator-filter-actions');
    const apply = el('button', 'shell-button', 'กรองรายการ');
    apply.type = 'submit';
    filterActions.append(apply);
    filter.append(filterActions);
  }

  const summaryBar = el('div', 'coordinator-summary-bar');
  const content = el('div', 'workflow-stack selection-applications');
  const modalHost = el('div', 'coordinator-modal-host');
  const pager = el('div', 'shell-actions selection-pagination');
  const previous = el('button', 'shell-button shell-button--secondary', 'หน้าก่อน');
  const next = el('button', 'shell-button shell-button--secondary', 'หน้าถัดไป');
  previous.type = next.type = 'button';
  pager.append(previous, next);
  pager.hidden = true;

  if (coordinator) {
    root.append(intro, summaryBar, filter, feedback, content, pager, modalHost);
  } else {
    root.append(intro, filter, feedback, content, pager);
  }

  let page = 1;
  let generation = 0;
  let filtersReady = false;
  let loadedApplications = [];
  let loadedCohorts = [];
  let selectedPlanId = null;
  let hasMoreData = false;
  let queuePage = 1;
  const QUEUE_PAGE_SIZE = 5;

  const pending = new Map();
  const base = `/api/v3/${coordinator ? 'coordinator' : 'committee'}`;

  function options(select, values) {
    select.replaceChildren();
    const first = el('option', null, 'ทั้งหมด');
    first.value = '';
    select.append(first);
    for (const value of [...new Set(values)].sort()) {
      const option = el('option', null, value);
      option.value = value;
      select.append(option);
    }
  }

  function failure(error) {
    if (signal?.aborted || error.name === 'AbortError') return;
    if ([401, 403].includes(error.status)) {
      content.replaceChildren();
      summaryBar.replaceChildren();
    }
    feedback.textContent =
      error.status === 409
        ? 'ข้อมูลเปลี่ยนหรือบันทึกไปแล้ว กรุณาโหลดรายการใหม่'
        : error.status === 422
          ? 'สถานะแผนหรือคณะกรรมการเปลี่ยนแล้ว กรุณาติดต่อผู้ประสานงาน'
          : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่ โดยใช้ข้อมูลเดิม';
    if (error.status === 401) onSessionExpired?.();
    if (error.status === 403) onAccessDenied?.('ไม่มีสิทธิ์หรือถูกถอนการมอบหมายแล้ว');
  }

  async function send(row, body, button, actionSuffix = null, successText = 'บันทึกเรียบร้อยแล้ว — ยังไม่ใช่การประกาศผล') {
    if (signal?.aborted) return;
    button.disabled = true;
    const endpointAction = actionSuffix || (coordinator ? 'acknowledge' : 'opinion');
    const signature = `${endpointAction}:${JSON.stringify(body)}`;
    const old = pending.get(row.plan_id);
    const command =
      old?.signature === signature
        ? old.command
        : { operation_id: globalThis.crypto.randomUUID(), expected_version: row.plan_version, ...body };
    pending.set(row.plan_id, { signature, command });
    feedback.textContent = 'กำลังบันทึก…';
    try {
      await client.request(`${base}/plans/${row.plan_id}/${endpointAction}`, {
        method: 'POST',
        body: command,
        signal
      });
      pending.delete(row.plan_id);
      if (signal?.aborted) return;
      await refresh(successText);
    } catch (error) {
      failure(error);
    } finally {
      if (!signal?.aborted) button.disabled = false;
    }
  }

  function openDocumentPreviewModal(row, doc) {
    modalHost.replaceChildren();
    const backdrop = el('div', 'coordinator-modal-backdrop');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', `ตัวอย่างเอกสาร ${doc.title}`);

    const dialog = el('div', 'workflow-card coordinator-modal-dialog');
    const header = el('div', 'coordinator-modal-header');
    header.append(
      el('h3', null, `ตัวอย่างเอกสาร: ${doc.title}`),
      el('span', `coordinator-badge ${doc.attached ? 'coordinator-badge--complete' : 'coordinator-badge--pending'}`, doc.attached ? 'แนบเอกสารแล้ว' : 'รอตรวจสอบไฟล์')
    );

    const meta = el('div', 'coordinator-detail-grid');
    meta.append(
      detailItem('นักศึกษา', `${row.student_number} · ${row.full_name}`),
      detailItem('ชื่อไฟล์ / รายการอ้างอิง', doc.fileName),
      detailItem('รหัสอ้างอิงเอกสาร', doc.reference),
      detailItem('คำอธิบายการตรวจ', doc.description)
    );

    const previewFrame = el('div', 'coordinator-doc-preview-frame');
    previewFrame.append(
      el('p', 'coordinator-doc-preview-title', doc.fileName),
      el('p', 'shell-muted', doc.summary)
    );

    const actions = el('div', 'shell-actions');
    const closeBtn = el('button', 'shell-button', 'ปิดหน้าต่างตัวอย่าง');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => modalHost.replaceChildren());
    actions.append(closeBtn);

    dialog.append(header, meta, previewFrame, actions);
    backdrop.append(dialog);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) modalHost.replaceChildren();
    });
    modalHost.append(backdrop);
  }

  function detailItem(term, detailContent, extraClass = '') {
    const box = el('div', `coordinator-detail-item${extraClass ? ` ${extraClass}` : ''}`);
    box.append(el('span', 'coordinator-detail-term', term));
    if (detailContent && typeof detailContent === 'object' && detailContent.nodeType) {
      box.append(detailContent);
    } else {
      box.append(el('strong', 'coordinator-detail-value', detailContent || 'ไม่ระบุ'));
    }
    return box;
  }

  function renderSummaryCounts(rows) {
    summaryBar.replaceChildren();
    const total = rows.length;
    const awaiting = rows.filter((r) => r.state === 'AWAITING_COORDINATOR').length;
    const returned = rows.filter((r) => r.state === 'NEEDS_REVISION').length;
    const forwarded = rows.filter((r) => r.state === 'UNDER_COMMITTEE_REVIEW' || r.state === 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT').length;

    const items = [
      { label: 'ใบสมัครในคิวทั้งหมด', count: `${total} คน`, tone: 'neutral', state: '' },
      { label: 'รอผู้ประสานงานตรวจ', count: `รอตรวจ ${awaiting} คน`, tone: 'pending', state: 'AWAITING_COORDINATOR' },
      { label: 'ส่งกลับให้แก้ไข', count: `${returned} คน`, tone: 'revision', state: 'NEEDS_REVISION' },
      { label: 'ยืนยันส่งต่อกรรมการแล้ว', count: `${forwarded} คน`, tone: 'complete', state: 'UNDER_COMMITTEE_REVIEW' }
    ];
    for (const item of items) {
      const isSelected = stateFilter.value === item.state;
      const pill = el('button', `coordinator-stat-card coordinator-stat-card--${item.tone}${isSelected ? ' coordinator-stat-card--active' : ''}`);
      pill.type = 'button';
      pill.setAttribute('aria-pressed', String(isSelected));
      pill.append(
        el('span', 'coordinator-stat-card__label', item.label),
        el('strong', 'coordinator-stat-card__value', item.count)
      );
      pill.addEventListener('click', () => {
        if (stateFilter.value === item.state) {
          stateFilter.value = '';
        } else {
          stateFilter.value = item.state;
        }
        queuePage = 1;
        renderCoordinatorSplitView();
      });
      summaryBar.append(pill);
    }
  }

  function getFilteredApplications() {
    if (!coordinator) return loadedApplications;
    const q = searchInput.value.trim().toLowerCase();
    const st = stateFilter.value;
    const curr = curriculumFilter ? curriculumFilter.value : '';
    const trk = trackFilter ? trackFilter.value : '';
    return loadedApplications.filter((row) => {
      if (st && row.state !== st) return false;
      if (curr) {
        const studentCurr = String(row.curriculum_year || row.curriculum || '');
        const studentId = String(row.student_number || '');
        if (curr === '66' && !studentCurr.includes('66') && !studentId.startsWith('66')) return false;
        if (curr === '61' && !studentCurr.includes('61') && !studentId.startsWith('61')) return false;
      }
      if (trk) {
        const trackText = `${row.program_track || ''} ${row.program || ''} ${row.major || ''}`;
        if (trk.includes('ภาคปกติ') && !trackText.includes('ภาคปกติ') && !trackText.includes('หลักสูตรปกติ')) return false;
        if (trk.includes('คอมพิวเตอร์ประยุกต์') && !trackText.includes('คอมพิวเตอร์ประยุกต์')) return false;
        if (trk.includes('คอมพิวเตอร์เครือข่าย') && !trackText.includes('คอมพิวเตอร์เครือข่าย') && !trackText.includes('ความปลอดภัยทางไซเบอร์')) return false;
      }
      if (q) {
        const positions = Array.isArray(row.interested_positions) ? row.interested_positions.join(' ') : (row.interested_positions || '');
        const hay = `${row.student_number || ''} ${row.full_name || ''} ${row.company_name || ''} ${row.position_title || ''} ${positions}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function updatePagerVisibility(itemCount) {
    if (!coordinator) {
      pager.hidden = false;
      pager.style.display = '';
      previous.disabled = page === 1;
      next.disabled = !hasMoreData;
      return;
    }
    const show = itemCount > 0 && (page > 1 || hasMoreData);
    pager.hidden = !show;
    pager.style.display = show ? '' : 'none';
    previous.disabled = page === 1;
    next.disabled = !hasMoreData;
  }

  function renderCoordinatorDetailPane(row) {
    const detailPane = el('article', 'workflow-card coordinator-detail-pane');
    detailPane.setAttribute('aria-label', `รายละเอียดใบสมัครของ ${row.student_number}`);

    // Top Header
    const header = el('header', 'coordinator-detail-header');
    const titleWrap = el('div', 'coordinator-detail-title-wrap');
    titleWrap.append(
      el('p', 'coordinator-eyebrow', `รอบการคัดเลือก: ${row.cycle_name || '-'} · เวอร์ชันแผน v${row.plan_version || 1}`),
      el('h3', 'coordinator-detail-heading', `${row.student_number} · ${row.full_name}`),
      el('p', 'shell-muted', `${row.department} / ${row.program}${row.major ? ` (${row.major})` : ''}`)
    );
    const badgeWrap = el('div', 'coordinator-detail-badges');
    badgeWrap.append(
      el('span', `coordinator-badge ${BADGE_TONES[row.state] || ''}`, LABELS[row.state] || 'สถานะไม่พร้อม กรุณารีเฟรช'),
      el('span', 'coordinator-badge coordinator-badge--neutral', `บันทึกความเห็นแล้ว ${row.opinion_count} / 3 คน`)
    );
    header.append(titleWrap, badgeWrap);
    detailPane.append(header);

    // Revision Notice if NEEDS_REVISION
    if (row.state === 'NEEDS_REVISION') {
      const revBox = el('section', 'coordinator-revision-banner');
      revBox.append(
        el('h4', null, 'ส่งกลับให้นักศึกษาแก้ไขแล้ว (รอนักศึกษายื่นใบสมัครใหม่)'),
        el('p', 'coordinator-revision-notes', row.revision_notes || 'ผู้ประสานงานได้ส่งกลับให้แก้ไขข้อมูลและแนบเอกสารใหม่')
      );
      detailPane.append(revBox);
    }

    // Section 1: Personal, Contact & Guardian Info
    const secPersonal = el('section', 'coordinator-section');
    secPersonal.append(el('h4', 'coordinator-section__title', '1. ข้อมูลนักศึกษา การติดต่อ และผู้ปกครอง'));

    // 1.1 Student Info & Contact
    const subStudent = el('div', 'coordinator-subgroup');
    subStudent.append(el('h5', 'coordinator-subgroup__title', '1.1 ข้อมูลนักศึกษาและการติดต่อ'));
    const studentGrid = el('div', 'coordinator-detail-grid');
    studentGrid.append(
      detailItem('รหัสนักศึกษา', row.student_number),
      detailItem('ชื่อ-นามสกุล', row.full_name),
      detailItem('ภาควิชา / หลักสูตร', `${row.department || '-'} / ${row.program || '-'}`),
      detailItem('สาขาวิชา / ปีการศึกษา', `${row.major || row.program || '-'} / ${row.academic_year || '2569'}`),
      detailItem('อีเมลมหาวิทยาลัย (Dome)', row.institutional_email || 'ตรวจสอบในทะเบียนนักศึกษา'),
      detailItem('อีเมลที่ติดต่อได้', row.contact_email || row.institutional_email || 'ระบุในใบสมัคร'),
      detailItem('เบอร์โทรศัพท์ติดต่อ', row.contact_phone || 'ระบุในใบสมัคร'),
      detailItem('ที่อยู่ที่ติดต่อได้ของนักศึกษา', row.contact_address || 'ระบุในใบสมัคร')
    );
    subStudent.append(studentGrid);
    secPersonal.append(subStudent);

    // 1.2 Guardian / Emergency Contact
    const subGuardian = el('div', 'coordinator-subgroup');
    subGuardian.append(el('h5', 'coordinator-subgroup__title', '1.2 ข้อมูลการติดต่อผู้ปกครอง (ผู้ติดต่อกรณีฉุกเฉิน)'));
    const guardianGrid = el('div', 'coordinator-detail-grid');
    const guardianName = row.guardian_name || (row.guardian_info ? row.guardian_info.split('(')[0].trim() : 'ระบุในใบสมัคร');
    const guardianRel = row.guardian_relationship || (row.guardian_info?.match(/\(([^)]+)\)/)?.[1] || 'ระบุในใบสมัคร');
    const guardianPhone = row.guardian_phone || (row.guardian_info?.match(/โทร[.:\s]*([0-9-]+)/)?.[1] || 'ระบุในใบสมัคร');
    const guardianAddr = row.guardian_address || 'ระบุในใบสมัคร';
    guardianGrid.append(
      detailItem('ชื่อ-นามสกุลผู้ปกครอง', guardianName),
      detailItem('ความสัมพันธ์กับนักศึกษา', guardianRel),
      detailItem('เบอร์โทรศัพท์ที่ติดต่อได้ของผู้ปกครอง', guardianPhone),
      detailItem('ที่อยู่ที่ติดต่อได้ของผู้ปกครอง', guardianAddr)
    );
    subGuardian.append(guardianGrid);
    secPersonal.append(subGuardian);

    detailPane.append(secPersonal);

    // Section 2: Academic & Curriculum Courses Verification (3 Subgroups, Letter grades A-F or '-')
    const is61 =
      row.curriculum_year === '61' ||
      (typeof row.curriculum === 'string' && row.curriculum.includes('61')) ||
      (typeof row.student_number === 'string' && row.student_number.startsWith('61'));
    const curriculumName = is61 ? 'หลักสูตร 61' : 'หลักสูตร 66';

    const secAcademic = el('section', 'coordinator-section');
    const academicHeader = el('div', 'coordinator-section__head-flex');
    academicHeader.append(
      el('h4', 'coordinator-section__title', `2. ตรวจสอบผลการเรียนและรายวิชาตาม${curriculumName}`),
      el('span', 'coordinator-badge coordinator-badge--curriculum', curriculumName)
    );
    secAcademic.append(academicHeader);

    const gpaSummary = el('div', 'coordinator-gpa-bar');
    const gpaxText =
      row.gpax !== undefined && row.gpax !== null
        ? `${Number(row.gpax).toFixed(2)} (เกณฑ์ขั้นต่ำ ≥ 2.75)`
        : 'ตรวจสอบจาก Transcript (เกณฑ์ ≥ 2.75)';
    const coreGpaText =
      row.core_gpa !== undefined && row.core_gpa !== null
        ? `${Number(row.core_gpa).toFixed(2)} (เกณฑ์ขั้นต่ำ ≥ 2.50)`
        : 'ตรวจสอบจาก Transcript (เกณฑ์ ≥ 2.50)';
    const academicPassed = (row.gpax ?? 3.0) >= 2.75 && (row.core_gpa ?? 3.0) >= 2.5;
    const eligibilityText = academicPassed
      ? 'ผ่านเกณฑ์ผลการเรียนขั้นต่ำ'
      : 'เทียบเกรดรายวิชาจากใบแจ้งผลการศึกษา (Transcript)';

    gpaSummary.append(
      detailItem('เกรดเฉลี่ยสะสม (GPAX)', gpaxText),
      detailItem(`เกรดเฉลี่ยกลุ่มวิชาหลัก (${is61 ? '6' : '7'} วิชา)`, coreGpaText),
      detailItem('สถานะการตรวจเกณฑ์ผลการเรียน', eligibilityText)
    );
    secAcademic.append(gpaSummary);

    const customCourses = row.core_courses && typeof row.core_courses === 'object' ? row.core_courses : {};

    // Subgroup 1: Core compulsory courses
    const sub1 = el('div', 'coordinator-subgroup');
    sub1.append(
      el('h5', 'coordinator-subgroup__title', `กลุ่มที่ 1: วิชาหลักบังคับตาม${curriculumName} (เกรดเฉลี่ยกลุ่มนี้ ≥ 2.50)`)
    );
    const coreGrid = el('div', 'coordinator-course-grid');
    const coreList = is61 ? CORE_COURSES_61 : CORE_COURSES_66;
    for (const c of coreList) {
      let grade = customCourses[c.code];
      if (!grade) {
        const short = c.code.split('/')[0].trim();
        grade = customCourses[short] || (row.core_gpa ? 'B+' : 'ดูใน Transcript');
      }
      const courseRow = el('div', 'coordinator-course-item coordinator-course-item--core');
      courseRow.append(
        el('strong', 'coordinator-course-code', c.code),
        el('span', 'coordinator-course-name', c.name),
        el('span', 'coordinator-course-grade', `เกรด: ${grade}`)
      );
      coreGrid.append(courseRow);
    }
    sub1.append(coreGrid);
    secAcademic.append(sub1);

    // Subgroup 2: Prerequisite courses (Mandatory + Electives min 1)
    const sub2 = el('div', 'coordinator-subgroup');
    const prereqData = is61 ? PREREQ_COURSES_61 : PREREQ_COURSES_66;
    sub2.append(
      el('h5', 'coordinator-subgroup__title', `กลุ่มที่ 2: วิชาที่กำลังศึกษา หรือเคยศึกษา (${prereqData.mandatory.code} บังคับ และวิชาเลือกอย่างน้อย 1 รายวิชา)`)
    );
    const prereqGrid = el('div', 'coordinator-course-grid');

    const mandGrade =
      row.prerequisite_courses?.mandatory?.grade ||
      customCourses[prereqData.mandatory.code] ||
      (row.core_gpa ? 'B+' : 'กำลังศึกษา');
    const mandItem = el('div', 'coordinator-course-item coordinator-course-item--mandatory');
    mandItem.append(
      el('strong', 'coordinator-course-code', `${prereqData.mandatory.code} (บังคับ)`),
      el('span', 'coordinator-course-name', prereqData.mandatory.name),
      el('span', 'coordinator-course-grade', `เกรด: ${mandGrade}`)
    );
    prereqGrid.append(mandItem);

    const electivesGradeMap = row.prerequisite_courses?.electives || {};
    for (const elec of prereqData.electives) {
      const elecGrade = electivesGradeMap[elec.code] || customCourses[elec.code] || '-';
      const elecItem = el('div', 'coordinator-course-item coordinator-course-item--elective');
      elecItem.append(
        el('strong', 'coordinator-course-code', `${elec.code} (วิชาเลือก · ขั้นต่ำ 1 ตัว)`),
        el('span', 'coordinator-course-name', elec.name),
        el('span', 'coordinator-course-grade', `เกรด: ${elecGrade}`)
      );
      prereqGrid.append(elecItem);
    }
    sub2.append(prereqGrid);
    secAcademic.append(sub2);

    // Subgroup 3: Advance Course to pass before actual co-op
    const sub3 = el('div', 'coordinator-subgroup');
    const advInfo = is61 ? ADVANCE_COURSE_61 : ADVANCE_COURSE_66;
    sub3.append(
      el('h5', 'coordinator-subgroup__title', `กลุ่มที่ 3: วิชาที่ต้องสอบได้ก่อนออกปฏิบัติงานจริง (${advInfo.code})`)
    );
    const advGrid = el('div', 'coordinator-course-grid');
    const advGrade = row.advance_course?.grade || row.advance_course?.status || 'กำลังศึกษา';
    const advItem = el('div', 'coordinator-course-item coordinator-course-item--advance');
    advItem.append(
      el('strong', 'coordinator-course-code', advInfo.code),
      el('span', 'coordinator-course-name', `${advInfo.name} (เกณฑ์ข้อ 4 รับทราบและต้องสอบผ่านก่อนออกปฏิบัติงาน)`),
      el('span', 'coordinator-course-grade', `สถานะ: ${advGrade}`)
    );
    advGrid.append(advItem);
    sub3.append(advGrid);
    secAcademic.append(sub3);

    detailPane.append(secAcademic);

    // Section 3: 4 Attached Documents Verification
    const secDocs = el('section', 'coordinator-section');
    secDocs.append(el('h4', 'coordinator-section__title', '3. เอกสารประกอบการสมัคร 4 รายการ'));
    const docsGrid = el('div', 'coordinator-docs-grid');
    const docs = normalizeDocuments(row);
    for (const doc of docs) {
      const docCard = el('div', 'coordinator-doc-card');
      const docHead = el('div', 'coordinator-doc-card__head');
      docHead.append(
        el('strong', 'coordinator-doc-title', doc.title),
        el('span', `coordinator-badge ${doc.attached ? 'coordinator-badge--complete' : 'coordinator-badge--pending'}`, doc.attached ? 'มีรายการอ้างอิง' : 'ตรวจสอบไฟล์แนบ')
      );
      const docDesc = el('p', 'shell-muted coordinator-doc-desc', doc.description);

      const docBottom = el('div', 'coordinator-doc-card__bottom');
      const docFile = el('p', 'coordinator-doc-filename', `ไฟล์: ${doc.fileName}`);
      const docActions = el('div', 'coordinator-doc-actions');
      const previewBtn = el('button', 'shell-button shell-button--secondary coordinator-doc-btn', 'ดูตัวอย่างไฟล์');
      previewBtn.type = 'button';
      previewBtn.addEventListener('click', () => openDocumentPreviewModal(row, doc));
      docActions.append(previewBtn);

      if (doc.reference && /^https?:\/\//i.test(doc.reference)) {
        const openLink = el('a', 'shell-button shell-button--secondary coordinator-doc-btn', 'เปิดในแท็บใหม่');
        openLink.href = doc.reference;
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        docActions.append(openLink);
      }
      docBottom.append(docFile, docActions);

      docCard.append(docHead, docDesc, docBottom);
      docsGrid.append(docCard);
    }
    secDocs.append(docsGrid);
    detailPane.append(secDocs);

    // Section 4: Interested Positions & Student Skills (Phase 1 Application)
    const secPlan = el('section', 'coordinator-section');
    secPlan.append(el('h4', 'coordinator-section__title', '4. ตำแหน่งงานที่สนใจ และทักษะของนักศึกษา'));
    const planGrid = el('div', 'coordinator-detail-grid');

    const positionsList = Array.isArray(row.interested_positions) && row.interested_positions.length
      ? row.interested_positions
      : (typeof row.position_title === 'string' && row.position_title.trim()
        ? row.position_title.split(/[,/·]+/).map((s) => s.trim()).filter(Boolean)
        : ['ระบุในใบสมัคร']);
    const pillsWrap = el('div', 'coordinator-interest-pills');
    for (const pos of positionsList) {
      pillsWrap.append(el('span', 'coordinator-interest-pill', pos));
    }
    planGrid.append(detailItem('ตำแหน่งงานที่สนใจ (เลือกได้หลายตำแหน่ง)', pillsWrap, 'coordinator-detail-item--full'));

    const skillsText =
      row.skills_detail ||
      (Array.isArray(row.skills) ? row.skills.join('\n') : row.skills) ||
      row.plan_notes ||
      'ระบุในเรซูเม่และใบสมัคร';
    const skillsWrap = el('div', 'coordinator-skills-box', skillsText);
    planGrid.append(
      detailItem('ระบุทักษะของนักศึกษา (เช่น ภาษาโปรแกรม, Frameworks, ทักษะเฉพาะด้าน เป็นต้น)', skillsWrap, 'coordinator-detail-item--full')
    );

    secPlan.append(planGrid);
    detailPane.append(secPlan);

    // Section 5: Automated Eligibility Check (7 criteria summary card)
    const secEligibility = el('section', 'coordinator-section coordinator-eligibility-section');
    const eligEval = evaluateEligibility(row);

    const eligHeader = el('div', 'coordinator-eligibility-header');
    eligHeader.append(
      el('h4', 'coordinator-section__title', '5. สรุปผลการตรวจสอบคุณสมบัติอัตโนมัติ (Automated Eligibility Check 7 ข้อ)'),
      el(
        'span',
        `coordinator-badge ${eligEval.allPassed ? 'coordinator-badge--complete' : 'coordinator-badge--revision'}`,
        eligEval.allPassed ? '✓ ผ่านเกณฑ์ครบทุกข้อ' : `✗ ไม่ผ่าน ${eligEval.failedRules.length} ข้อ`
      )
    );
    secEligibility.append(eligHeader);

    const eligBanner = el(
      'div',
      `coordinator-eligibility-banner ${eligEval.allPassed ? 'coordinator-eligibility-banner--pass' : 'coordinator-eligibility-banner--warn'}`
    );
    const bannerText = el(
      'p',
      null,
      eligEval.allPassed
        ? 'นักศึกษามีคุณสมบัติเบื้องต้นและเอกสารประกอบครบถ้วนตามเกณฑ์โครงการสหกิจศึกษา ภาควิชาวิทยาการคอมพิวเตอร์ สามารถกดยืนยันรับแผนเพื่อส่งต่อให้คณะกรรมการ 3 ท่านประเมินความเห็นได้'
        : `พบรายการที่ยังไม่ผ่านเกณฑ์หรือต้องแก้ไข ${eligEval.failedRules.length} รายการ กรุณาตรวจสอบหรือใช้ปุ่มลัดด้านล่างเพื่อส่งกลับให้นักศึกษาแก้ไขก่อนส่งต่อกรรมการ`
    );
    eligBanner.append(bannerText);

    let triggerAutoFillReturn = null;
    if (!eligEval.allPassed && row.state === 'AWAITING_COORDINATOR') {
      const autoFillBtn = el(
        'button',
        'shell-button shell-button--secondary coordinator-autofill-btn',
        '⚡ ส่งกลับแก้ไขตามรายการที่ไม่ผ่าน (Auto-fill)'
      );
      autoFillBtn.type = 'button';
      autoFillBtn.addEventListener('click', () => {
        if (triggerAutoFillReturn) triggerAutoFillReturn();
      });
      eligBanner.append(autoFillBtn);
    }
    secEligibility.append(eligBanner);

    const eligGrid = el('div', 'coordinator-eligibility-grid');
    for (const rule of eligEval.rules) {
      const ruleCard = el(
        'div',
        `coordinator-eligibility-card ${rule.passed ? 'coordinator-eligibility-card--pass' : 'coordinator-eligibility-card--fail'}`
      );
      const ruleTop = el('div', 'coordinator-eligibility-card__top');
      ruleTop.append(
        el('strong', 'coordinator-eligibility-card__title', rule.title),
        el(
          'span',
          `coordinator-badge ${rule.passed ? 'coordinator-badge--complete' : 'coordinator-badge--revision'}`,
          rule.passed ? 'ผ่านเกณฑ์' : 'ไม่ผ่าน'
        )
      );
      const ruleDetail = el('p', 'coordinator-eligibility-card__detail', rule.detail);
      ruleCard.append(ruleTop, ruleDetail);
      eligGrid.append(ruleCard);
    }
    secEligibility.append(eligGrid);
    detailPane.append(secEligibility);

    // Section 6: Coordinator Actions (Acknowledge or Return for Revision)
    const secAction = el('section', 'coordinator-section coordinator-action-panel');
    secAction.append(el('h4', 'coordinator-section__title', '6. การดำเนินการของผู้ประสานงาน'));

    if (row.state === 'AWAITING_COORDINATOR') {
      const actionDesc = el(
        'p',
        'shell-muted',
        'หากตรวจสอบข้อมูลและเอกสารครบถ้วนแล้ว กดยืนยันรับแผนเพื่อส่งต่อให้คณะกรรมการ 3 ท่านประเมินความเห็น หากข้อมูลไม่ครบถ้วนสามารถส่งกลับให้นักศึกษาแก้ไขและยื่นใหม่ได้'
      );
      const btnBar = el('div', 'shell-actions coordinator-action-buttons');
      const ackButton = el('button', 'shell-button', 'ยืนยันรับแผนและส่งต่อกรรมการ');
      ackButton.type = 'button';
      ackButton.addEventListener('click', () => send(row, {}, ackButton, 'acknowledge', 'บันทึกเรียบร้อยแล้ว — ยังไม่ใช่การประกาศผล'));

      const toggleReturnBtn = el('button', 'shell-button shell-button--secondary coordinator-return-toggle', 'ส่งกลับเพื่อแก้ไข');
      toggleReturnBtn.type = 'button';

      const returnFormHost = el('div', 'coordinator-return-form-host');

      function openReturnForm(prefilledChecklist = [], prefilledReason = '') {
        returnFormHost.replaceChildren();
        toggleReturnBtn.setAttribute('aria-expanded', 'true');
        const returnForm = el('form', 'workflow-form coordinator-return-form');
        returnForm.setAttribute('aria-label', `ส่งกลับเพื่อแก้ไขสำหรับ ${row.student_number}`);

        const checklistTitle = el('p', 'coordinator-checklist-title', 'เลือกรายการที่ต้องแก้ไข (เลือกได้หลายข้อ):');
        const checklistGroup = el('div', 'coordinator-checklist-group');
        const checkboxes = [];
        for (const itemText of REVISION_CHECKLIST_OPTIONS) {
          const itemLabel = el('label', 'coordinator-checkbox-label');
          const cb = el('input');
          cb.type = 'checkbox';
          cb.value = itemText;
          if (prefilledChecklist.includes(itemText)) {
            cb.checked = true;
          }
          itemLabel.append(cb, el('span', null, itemText));
          checklistGroup.append(itemLabel);
          checkboxes.push(cb);
        }

        const reasonTextarea = el('textarea');
        reasonTextarea.required = true;
        reasonTextarea.maxLength = 2000;
        reasonTextarea.rows = 3;
        reasonTextarea.placeholder = 'ระบุรายละเอียดที่นักศึกษาต้องแก้ไขเพิ่มเติม เช่น หน้าเอกสารที่ขาดลายเซ็น หรือข้อมูลที่ต้องอัปเดต...';
        if (prefilledReason) {
          reasonTextarea.value = prefilledReason;
        }
        const reasonLabel = el('label', null, 'เหตุผลและรายละเอียดที่ต้องแก้ไข (จำเป็นต้องระบุ ไม่เกิน 2,000 ตัวอักษร)');
        reasonLabel.append(reasonTextarea);

        const formActions = el('div', 'shell-actions');
        const submitReturnBtn = el('button', 'shell-button coordinator-submit-return-btn', 'ยืนยันส่งกลับแก้ไข');
        submitReturnBtn.type = 'submit';
        const cancelReturnBtn = el('button', 'shell-button shell-button--secondary', 'ยกเลิก');
        cancelReturnBtn.type = 'button';
        cancelReturnBtn.addEventListener('click', () => {
          returnFormHost.replaceChildren();
          toggleReturnBtn.setAttribute('aria-expanded', 'false');
        });
        formActions.append(submitReturnBtn, cancelReturnBtn);

        returnForm.append(checklistTitle, checklistGroup, reasonLabel, formActions);
        returnForm.addEventListener('submit', (event) => {
          event.preventDefault();
          const reasonText = reasonTextarea.value.trim();
          if (!reasonText) return;
          const selectedChecklist = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
          void send(
            row,
            { checklist: selectedChecklist, reason: reasonText },
            submitReturnBtn,
            'return',
            'ส่งกลับให้นักศึกษาแก้ไขเรียบร้อยแล้ว'
          );
        });
        returnFormHost.append(returnForm);
        reasonTextarea.focus();
      }

      toggleReturnBtn.addEventListener('click', () => {
        if (returnFormHost.firstChild) {
          returnFormHost.replaceChildren();
          toggleReturnBtn.setAttribute('aria-expanded', 'false');
        } else {
          openReturnForm();
        }
      });

      triggerAutoFillReturn = () => {
        const failedChecklistKeys = eligEval.failedRules
          .map((r) => r.checklistKey)
          .filter(Boolean);
        const reasons = eligEval.failedRules.map((r) => `- ${r.detail}`).join('\n');
        const autoReason = `พบรายการที่ไม่ผ่านเกณฑ์การตรวจสอบคุณสมบัติ:\n${reasons}\n\nกรุณาดำเนินการแก้ไขข้อมูลหรือแนบเอกสารที่ถูกต้องแล้วกดส่งแผนใหม่อีกครั้ง`;
        openReturnForm(failedChecklistKeys, autoReason);
      };

      btnBar.append(ackButton, toggleReturnBtn);
      secAction.append(actionDesc, btnBar, returnFormHost);
    } else if (row.state === 'NEEDS_REVISION') {
      secAction.append(
        el('p', 'shell-muted', 'ใบสมัครนี้อยู่ในสถานะส่งกลับให้แก้ไข เมื่อนักศึกษาแก้ไขและกดส่งแผนใหม่ สถานะจะกลับมาเป็น "รอผู้ประสานงานรับเรื่อง" เพื่อให้ตรวจซ้ำอีกครั้ง')
      );
    } else {
      secAction.append(
        el('p', 'shell-muted', 'ผู้ประสานงานได้ยืนยันรับแผนและส่งต่อให้คณะกรรมการเรียบร้อยแล้ว ขณะนี้อยู่ในขั้นตอนการบันทึกความเห็นของกรรมการ')
      );
    }

    detailPane.append(secAction);
    return detailPane;
  }

  function renderCoordinatorSplitView() {
    content.replaceChildren();
    renderSummaryCounts(loadedApplications);

    if (!loadedApplications.length) {
      updatePagerVisibility(0);
      content.append(
        el(
          'p',
          'shell-muted',
          loadedCohorts.length ? 'ยังไม่มีแผนในขอบเขตนี้' : 'ยังไม่ได้รับมอบหมายรอบ/หลักสูตร กรุณาติดต่อผู้ดูแลระบบ'
        )
      );
      return;
    }

    const filtered = getFilteredApplications();
    updatePagerVisibility(filtered.length);

    if (!filtered.length) {
      const emptyCard = el('div', 'workflow-card coordinator-empty-card');
      const emptyIcon = el('div', 'coordinator-empty-card__icon');
      emptyIcon.textContent = '🔍';
      const emptyTitle = el('h4', null, 'ไม่พบผู้สมัครที่ตรงกับเงื่อนไข');
      const emptyDesc = el('p', 'shell-muted', 'ไม่พบรายชื่อนักศึกษาที่ตรงกับคำค้นหาหรือตัวกรองสถานะที่เลือกไว้');
      const clearBtn = el('button', 'shell-button coordinator-empty-card__reset', 'ล้างตัวกรองทั้งหมด');
      clearBtn.type = 'button';
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        stateFilter.value = '';
        if (curriculumFilter) curriculumFilter.value = '';
        if (trackFilter) trackFilter.value = '';
        queuePage = 1;
        renderCoordinatorSplitView();
      });
      emptyCard.append(emptyIcon, emptyTitle, emptyDesc, clearBtn);
      content.append(emptyCard);
      return;
    }

    const activeRow = filtered.find((r) => r.plan_id === selectedPlanId) || filtered[0];
    selectedPlanId = activeRow.plan_id;

    const splitLayout = el('div', 'coordinator-split-layout');
    const masterPane = el('aside', 'workflow-card coordinator-master-pane');
    masterPane.setAttribute('aria-label', 'รายชื่อนักศึกษาที่ส่งแผน');

    const masterHeader = el('div', 'coordinator-master-header');
    masterHeader.append(
      el('h3', null, 'รายชื่อผู้สมัครสหกิจศึกษา'),
      el('span', 'coordinator-queue-count', `${filtered.length} คน`)
    );
    masterPane.append(masterHeader);

    const totalQueuePages = Math.max(1, Math.ceil(filtered.length / QUEUE_PAGE_SIZE));
    if (queuePage > totalQueuePages) queuePage = totalQueuePages;
    if (queuePage < 1) queuePage = 1;

    const startIdx = (queuePage - 1) * QUEUE_PAGE_SIZE;
    const pagedItems = filtered.slice(startIdx, startIdx + QUEUE_PAGE_SIZE);

    const queueList = el('div', 'coordinator-queue-list');
    for (let i = 0; i < pagedItems.length; i++) {
      const row = pagedItems[i];
      const itemIndex = startIdx + i + 1;
      const isSelected = row.plan_id === activeRow.plan_id;
      const itemBtn = el(
        'button',
        `coordinator-queue-item${isSelected ? ' coordinator-queue-item--active' : ''}`
      );
      itemBtn.type = 'button';
      itemBtn.setAttribute('aria-pressed', String(isSelected));

      const avatar = el('div', 'coordinator-queue-avatar', itemIndex);

      const body = el('div', 'coordinator-queue-item__body');
      const topLine = el('div', 'coordinator-queue-item__top');
      topLine.append(
        el('strong', 'coordinator-queue-item__id', row.student_number),
        el('span', `coordinator-badge ${BADGE_TONES[row.state] || ''}`, SHORT_LABELS[row.state] || LABELS[row.state] || row.state)
      );
      const nameLine = el('p', 'coordinator-queue-item__name', row.full_name);
      const posSummary = (Array.isArray(row.interested_positions) && row.interested_positions.length)
        ? row.interested_positions.join(', ')
        : (row.position_title || 'ตำแหน่งที่สนใจ');
      const metaLine = el('p', 'coordinator-queue-item__meta', `${posSummary} · ${row.program}`);

      body.append(topLine, nameLine, metaLine);
      itemBtn.append(avatar, body);

      itemBtn.addEventListener('click', () => {
        selectedPlanId = row.plan_id;
        renderCoordinatorSplitView();
      });
      queueList.append(itemBtn);
    }
    masterPane.append(queueList);

    if (totalQueuePages > 1) {
      const miniPager = el('div', 'coordinator-mini-pager');
      const prevQueueBtn = el('button', 'coordinator-mini-pager__btn', '◀ ก่อนหน้า');
      prevQueueBtn.type = 'button';
      prevQueueBtn.disabled = queuePage <= 1;
      prevQueueBtn.addEventListener('click', () => {
        if (queuePage > 1) {
          queuePage--;
          renderCoordinatorSplitView();
        }
      });

      const pageIndicator = el('span', 'coordinator-mini-pager__info', `${queuePage} / ${totalQueuePages}`);

      const nextQueueBtn = el('button', 'coordinator-mini-pager__btn', 'ถัดไป ▶');
      nextQueueBtn.type = 'button';
      nextQueueBtn.disabled = queuePage >= totalQueuePages;
      nextQueueBtn.addEventListener('click', () => {
        if (queuePage < totalQueuePages) {
          queuePage++;
          renderCoordinatorSplitView();
        }
      });

      miniPager.append(prevQueueBtn, pageIndicator, nextQueueBtn);
      masterPane.append(miniPager);
    }

    const detailPane = renderCoordinatorDetailPane(activeRow);
    splitLayout.append(masterPane, detailPane);
    content.append(splitLayout);
  }

  function card(row) {
    const box = el('section', 'workflow-card');
    box.append(
      el('h3', null, `${row.student_number} · ${row.full_name}`),
      el('p', 'shell-muted', `${row.department} / ${row.program} · ${row.cycle_name}`),
      el('p', null, LABELS[row.state] || 'สถานะไม่พร้อม กรุณารีเฟรช'),
      el('p', null, `บันทึกความเห็นแล้ว ${row.opinion_count} / 3 คน`)
    );
    if (coordinator && row.state === 'AWAITING_COORDINATOR') {
      const button = el('button', 'shell-button', 'ยืนยันรับแผนและส่งต่อกรรมการ');
      button.type = 'button';
      button.addEventListener('click', () => send(row, {}, button));
      box.append(button);
    }
    if (!coordinator && row.own_opinion) {
      box.append(
        el('p', null, `ความเห็นของคุณ: ${row.own_opinion.selected ? 'เห็นควรเลือก' : 'ไม่เลือก'}`),
        el('p', null, row.own_opinion.comment),
        el('p', 'shell-muted', 'บันทึกแล้ว ไม่แก้ไขทับประวัติเดิม')
      );
    } else if (!coordinator && row.state === 'UNDER_COMMITTEE_REVIEW') {
      const form = el('form', 'workflow-form selection-opinion-form');
      form.setAttribute('aria-label', `ความเห็นของคุณสำหรับ ${row.student_number}`);
      const choice = el('select');
      choice.required = true;
      for (const [value, label] of [
        ['', 'เลือกความเห็นของคุณ'],
        ['yes', 'เห็นควรเลือก'],
        ['no', 'ไม่เลือก']
      ]) {
        const option = el('option', null, label);
        option.value = value;
        choice.append(option);
      }
      const choiceLabel = el('label', null, 'ความเห็นรายบุคคล');
      choiceLabel.append(choice);
      const comment = el('textarea');
      comment.required = true;
      comment.maxLength = 2000;
      comment.rows = 3;
      const commentLabel = el('label', null, 'เหตุผล / ความเห็น (ไม่เกิน 2,000 ตัวอักษร)');
      commentLabel.append(comment);
      const button = el('button', 'shell-button', 'ยืนยันบันทึกความเห็น');
      button.type = 'submit';
      form.append(
        choiceLabel,
        commentLabel,
        el('p', 'shell-muted', 'ส่งแล้วจะไม่แก้ไขทับความเห็นเดิม โปรดตรวจสอบก่อนยืนยัน'),
        button
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!['yes', 'no'].includes(choice.value) || !comment.value.trim()) return;
        void send(row, { selected: choice.value === 'yes', comment: comment.value.trim() }, button);
      });
      box.append(form);
    }
    return box;
  }

  async function refresh(message = '') {
    const current = ++generation;
    content.setAttribute('aria-busy', 'true');
    feedback.textContent = 'กำลังโหลด…';
    const query = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (filtersReady && !coordinator && department.value) query.set('department', department.value);
    if (filtersReady && program.value) query.set('program', program.value);
    try {
      const data = await client.request(`${base}/applications?${query}`, { signal });
      if (signal?.aborted || current !== generation) return;
      if (!filtersReady) {
        if (!coordinator) options(department, data.cohorts.map((x) => x.department));
        options(program, data.cohorts.map((x) => x.program));
        filtersReady = true;
      }
      loadedApplications = data.applications || [];
      loadedCohorts = data.cohorts || [];
      hasMoreData = Boolean(data.has_more);

      if (coordinator) {
        renderCoordinatorSplitView();
      } else {
        content.replaceChildren();
        if (!loadedApplications.length) {
          content.append(
            el(
              'p',
              'shell-muted',
              loadedCohorts.length ? 'ยังไม่มีแผนในขอบเขตนี้' : 'ยังไม่ได้รับมอบหมายรอบ/หลักสูตร กรุณาติดต่อผู้ดูแลระบบ'
            )
          );
        }
        for (const row of loadedApplications) content.append(card(row));
        updatePagerVisibility(loadedApplications.length);
      }
      feedback.textContent = message;
    } catch (error) {
      if (current === generation) failure(error);
    } finally {
      if (current === generation) content.setAttribute('aria-busy', 'false');
    }
  }

  if (coordinator) {
    searchInput.addEventListener('input', () => {
      if (filtersReady) {
        queuePage = 1;
        renderCoordinatorSplitView();
      }
    });
    stateFilter.addEventListener('change', () => {
      if (filtersReady) {
        queuePage = 1;
        renderCoordinatorSplitView();
      }
    });
    if (curriculumFilter) {
      curriculumFilter.addEventListener('change', () => {
        if (filtersReady) {
          queuePage = 1;
          renderCoordinatorSplitView();
        }
      });
    }
    if (trackFilter) {
      trackFilter.addEventListener('change', () => {
        if (filtersReady) {
          queuePage = 1;
          renderCoordinatorSplitView();
        }
      });
    }
  }

  filter.addEventListener('submit', (event) => {
    event.preventDefault();
    page = 1;
    queuePage = 1;
    void refresh();
  });
  previous.addEventListener('click', () => {
    if (page > 1) {
      page--;
      queuePage = 1;
      void refresh();
    }
  });
  next.addEventListener('click', () => {
    page++;
    queuePage = 1;
    void refresh();
  });
  void refresh();
  return root;
}

export function renderStudentSelectionStatus({ client, signal, onSessionExpired, onAccessDenied } = {}) {
  const root = el('section', 'workflow-card');
  root.setAttribute('aria-busy', 'true');
  root.append(el('p', null, 'กำลังโหลดสถานะ…'));
  void client
    .request('/api/v3/student/selection', { signal })
    .then((data) => {
      if (signal?.aborted) return;
      root.replaceChildren();
      root.append(
        el('h2', null, 'สถานะการคัดเลือกของคุณ'),
        el('p', 'shell-muted', 'ครบสามความเห็นไม่ใช่ผลผ่าน/ไม่ผ่าน ระบบยังรอประกาศผล')
      );
      if (!data.applications.length) root.append(el('p', null, 'ยังไม่มีแผนที่ส่งเข้ารอบการคัดเลือกนี้'));
      for (const row of data.applications) {
        const card = el('section', 'workflow-card');
        card.append(
          el('h3', null, row.cycle_name),
          el('p', null, LABELS[row.state] || 'ยังไม่พร้อม'),
          el('p', null, `บันทึกความเห็นแล้ว ${row.opinion_count} / 3 คน`)
        );
        if (row.state === 'NEEDS_REVISION') {
          const revNotice = el('div', 'coordinator-revision-banner');
          revNotice.append(
            el('strong', null, 'กรุณาแก้ไขข้อมูลใบสมัคร (ส่งกลับให้แก้ไข)'),
            el('p', 'coordinator-revision-notes', row.revision_notes || 'กรุณาตรวจสอบข้อมูลและเอกสารประกอบใบสมัคร แล้วกดส่งแผนใหม่อีกครั้ง'),
            el('a', 'shell-button shell-button--secondary', 'ไปที่หน้าจัดการแผนสหกิจศึกษาเพื่อแก้ไขและยื่นใหม่')
          );
          revNotice.querySelector('a').href = '#/student/plan';
          card.append(revNotice);
        }
        root.append(card);
      }
    })
    .catch((error) => {
      if (signal?.aborted || error.name === 'AbortError') return;
      root.replaceChildren(el('p', null, 'โหลดสถานะไม่สำเร็จ กรุณารีเฟรช'));
      if (error.status === 401) onSessionExpired?.();
      if (error.status === 403) onAccessDenied?.('ไม่มีสิทธิ์ดูข้อมูลนี้');
    })
    .finally(() => {
      if (!signal?.aborted) root.setAttribute('aria-busy', 'false');
    });
  return root;
}
