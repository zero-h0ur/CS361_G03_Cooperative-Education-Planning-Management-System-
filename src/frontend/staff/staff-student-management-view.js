import { STAFF_ERROR_CODES } from './staff-client.js';
import { STAFF_PLAN_STATES, normalizeStaffFilters, serializeStaffRouteState } from './staff-route-state.js';

const STATUS_LABELS = Object.freeze({ DRAFT: 'ฉบับร่าง', SUBMITTED: 'ส่งแผนแล้ว',
  UNDER_REVIEW: 'กำลังตรวจสอบ', NEEDS_REVISION: 'ส่งกลับให้แก้ไข', APPROVED: 'อนุมัติแล้ว', CANCELLED: 'ยกเลิก' });
function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
const display = (value) => value == null || value === '' ? 'ไม่ระบุ' : String(value);
const dateFormatter = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
function date(value) { return value && !Number.isNaN(Date.parse(value)) ? dateFormatter.format(new Date(value)) : 'ไม่ระบุเวลา'; }
function link(hash, label) { const result = node('a', 'shell-button shell-button--secondary', label); result.href = hash; return result; }
function button(label, handler, secondary = false) {
  const result = node('button', secondary ? 'shell-button shell-button--secondary' : 'shell-button', label);
  result.type = 'button'; result.addEventListener('click', handler); return result;
}
function detail(list, label, value) {
  const wrapper = node('div', 'staff-result__detail');
  wrapper.append(node('dt', '', label), node('dd', '', display(value)));
  list.append(wrapper);
}

export function renderStaffStudentManagementView({ mode = 'students', initialFilters = {}, staffClient,
  signal, onSessionExpired, onAccessDenied, onRouteStateChange = () => {} } = {}) {
  let applied = normalizeStaffFilters(mode, initialFilters);
  let sequence = 0;
  let request = null;
  let pagination = null;
  let busy = false;
  const root = node('div', 'student-workspace staff-management');
  root.dataset.role = 'staff-management';
  const formSection = node('section', 'student-card');
  const title = node('h2', 'student-card__title', mode === 'students' ? 'ค้นหานักศึกษาในขอบเขตที่รับผิดชอบ' : 'ค้นหาแผนสหกิจในขอบเขตที่รับผิดชอบ');
  title.id = 'staff-search-title'; formSection.setAttribute('aria-labelledby', title.id);
  const form = node('form', 'staff-search-form');
  form.noValidate = true;
  form.setAttribute('aria-label', mode === 'students' ? 'ค้นหานักศึกษา' : 'ค้นหาแผนสหกิจ');
  const fields = {};
  const fieldErrors = {};
  function field(key, label, tag = 'input', options = []) {
    const wrapper = node('div', 'student-form__field');
    const input = node(tag, 'student-form__input');
    input.name = key; input.id = `staff-filter-${key}`;
    const labelNode = node('label', 'student-form__label', label); labelNode.htmlFor = input.id;
    for (const [value, text] of options) {
      const option = node('option', '', text); option.value = value; input.append(option);
    }
    const error = node('p', 'student-form__error'); error.id = `${input.id}-error`; error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    wrapper.append(labelNode, input, error);
    fields[key] = input; fieldErrors[key] = error;
    form.append(wrapper);
    return input;
  }
  field('q', 'ชื่อ ชื่อที่ใช้เรียก หรือรหัสนักศึกษา');
  fields.q.type = 'search'; fields.q.maxLength = 100; fields.q.autocomplete = 'off';
  const hint = node('p', 'student-form__hint', 'คำค้นใช้เฉพาะในหน้านี้ และไม่บันทึกใน URL หรือ Browser storage');
  hint.id = 'staff-search-privacy'; fields.q.setAttribute('aria-describedby', `${fieldErrors.q.id} ${hint.id}`);
  const year = field('academic_year', 'ปีการศึกษา (พ.ศ.)'); year.inputMode = 'numeric'; year.maxLength = 4; year.placeholder = 'เช่น 2569';
  field('pageSize', 'จำนวนรายการต่อหน้า', 'select', [...new Set([20, 50, 100, applied.pageSize])].sort((a, b) => a - b)
    .map((size) => [String(size), `${size} รายการ`]));
  if (mode === 'plans') {
    field('status', 'สถานะแผน', 'select', [['', 'ทุกสถานะ'], ...STAFF_PLAN_STATES.map((status) => [status, STATUS_LABELS[status]])]);
    field('sort', 'เรียงตาม', 'select', [['updated_at', 'เวลาอัปเดต'], ['created_at', 'เวลาสร้างแผน'], ['student_number', 'รหัสนักศึกษา']]);
    field('order', 'ลำดับ', 'select', [['desc', 'มากไปน้อย / ล่าสุดก่อน'], ['asc', 'น้อยไปมาก / เก่าสุดก่อน']]);
  }
  const formActions = node('div', 'student-form__actions staff-search-form__actions');
  const search = node('button', 'shell-button', 'ค้นหา'); search.type = 'submit';
  const reset = button('ล้างตัวกรอง', () => {
    applied = normalizeStaffFilters(mode); fillFields(); load(applied, true);
  }, true);
  formActions.append(search, reset);
  const summary = node('p', 'student-card__description');
  summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  summary.dataset.role = 'staff-result-summary';
  const results = node('section', 'student-card staff-results');
  results.setAttribute('aria-label', mode === 'students' ? 'ผลการค้นหานักศึกษา' : 'ผลการค้นหาแผน');
  results.tabIndex = -1;
  results.dataset.role = 'staff-results';
  const paginationBar = node('nav', 'staff-pagination'); paginationBar.setAttribute('aria-label', 'หน้าผลการค้นหา');
  const previous = button('หน้าก่อนหน้า', () => navigatePage(-1), true);
  const pageLabel = node('span', 'staff-pagination__label');
  const next = button('หน้าถัดไป', () => navigatePage(1), true);
  paginationBar.append(previous, pageLabel, next); paginationBar.hidden = true;
  form.append(formActions);
  formSection.append(title, hint, form);
  if (mode === 'students') formSection.append(node('p', 'student-card__description', 'เรียงตามรหัสนักศึกษา แล้วตามรหัสรายการ จากเซิร์ฟเวอร์'));
  root.append(formSection, summary, results, paginationBar);

  function fillFields() { for (const [key, input] of Object.entries(fields)) input.value = String(applied[key] ?? ''); }
  function showFieldErrors(details = []) {
    for (const key of Object.keys(fieldErrors)) {
      const detail = details.find((entry) => entry.field === key);
      fieldErrors[key].textContent = detail?.issue || '';
      fieldErrors[key].hidden = !detail;
      fields[key].setAttribute('aria-invalid', String(Boolean(detail)));
    }
    const invalid = details.find((entry) => fields[entry.field]);
    if (invalid) fields[invalid.field].focus();
  }
  function filtersFromForm() {
    const raw = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
    return normalizeStaffFilters(mode, { ...raw, page: 1 });
  }
  function setBusy(value) {
    busy = value; root.setAttribute('aria-busy', String(value));
    previous.disabled = value || !pagination || pagination.page <= 1;
    next.disabled = value || !pagination || pagination.page >= pagination.totalPages;
  }
  function navigatePage(delta) {
    if (busy || !pagination) return;
    const page = applied.page + delta;
    if (page < 1 || page > pagination.totalPages) return;
    load(normalizeStaffFilters(mode, { ...applied, page }), true);
  }
  function state(titleText, description, retry = false) {
    results.replaceChildren(node('h3', 'student-card__title', titleText), node('p', 'student-card__description', description));
    if (retry) results.append(button('ลองอีกครั้ง', () => load(applied, true), true));
  }
  function studentResult(item) {
    const article = node('article', 'staff-result');
    const heading = node('h3', 'staff-result__title', display(item.full_name));
    const number = node('p', 'staff-result__number', `รหัสนักศึกษา ${display(item.student_number)}`);
    const data = node('dl', 'staff-result__details');
    detail(data, 'ชื่อที่ใช้เรียก', item.preferred_name);
    detail(data, 'ภาควิชา / หลักสูตร', [item.department, item.program].filter(Boolean).join(' / '));
    detail(data, 'สาขา', item.major); detail(data, 'ปีการศึกษา', item.academic_year);
    detail(data, 'สถานะการศึกษา', ({ ACTIVE: 'กำลังศึกษา', INACTIVE: 'ไม่ได้ลงทะเบียนเรียน' })[item.enrollment_status] || item.enrollment_status);
    article.append(heading, number, data);
    return article;
  }
  function planResult(item) {
    const article = node('article', 'staff-result');
    const heading = node('h3', 'staff-result__title', display(item.student.full_name));
    const badge = node('span', 'student-badge student-badge--neutral', `${STATUS_LABELS[item.status]} (${item.status})`);
    const data = node('dl', 'staff-result__details');
    detail(data, 'รหัสนักศึกษา', item.student.student_number);
    detail(data, 'ภาควิชา / หลักสูตร', [item.student.department, item.student.program].filter(Boolean).join(' / '));
    detail(data, 'รอบสมัคร / ปีการศึกษา', `${display(item.cycle.name)} / ${item.cycle.academic_year}`);
    detail(data, 'สถานประกอบการ', item.company ? item.company.name || 'ไม่เปิดเผยชื่อสถานประกอบการ' : 'ยังไม่เลือก');
    detail(data, 'ตำแหน่งงาน', item.position ? item.position.title || 'ไม่เปิดเผยชื่อตำแหน่งงาน' : 'ยังไม่เลือก');
    detail(data, 'อัปเดตล่าสุด', date(item.updated_at));
    const review = link(`#/staff/review/${item.id}`, 'เปิดตรวจแผน');
    review.setAttribute('aria-label', `เปิดตรวจแผนของ ${display(item.student.full_name)}`);
    article.append(heading, badge, data, review);
    return article;
  }
  async function load(filters, focusResults = false) {
    request?.abort(); request = new AbortController();
    const current = ++sequence;
    applied = filters; pagination = null;
    showFieldErrors(); results.removeAttribute('role'); paginationBar.hidden = true;
    summary.textContent = 'กำลังค้นหาข้อมูลในขอบเขตที่รับผิดชอบ…';
    state('กำลังโหลดข้อมูล', 'กรุณารอสักครู่'); setBusy(true);
    onRouteStateChange(serializeStaffRouteState(mode, filters));
    try {
      const response = await staffClient[mode === 'students' ? 'searchStudents' : 'searchPlans']({ ...filters, signal: request.signal });
      if (signal?.aborted || current !== sequence) return;
      pagination = response.pagination;
      summary.textContent = `พบ ${pagination.total.toLocaleString('th-TH')} รายการในขอบเขตที่คุณมีสิทธิ์อ่าน`;
      if (!response.items.length) {
        state(pagination.total ? 'ไม่มีรายการในหน้านี้' : 'ไม่พบข้อมูลตามตัวกรอง', 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง');
        if (pagination.page > 1) results.append(button('กลับไปหน้าแรก', () => load(normalizeStaffFilters(mode, { ...applied, page: 1 }), true), true));
      } else {
        results.replaceChildren(...response.items.map(mode === 'students' ? studentResult : planResult));
      }
      pageLabel.textContent = `หน้า ${pagination.page} จาก ${Math.max(pagination.totalPages, 1)}`;
      paginationBar.hidden = pagination.totalPages <= 1;
      if (focusResults) results.focus();
    } catch (error) {
      if (signal?.aborted || current !== sequence || error?.name === 'AbortError') return;
      summary.textContent = '';
      results.replaceChildren(); results.setAttribute('role', 'alert');
      if (error?.code === STAFF_ERROR_CODES.SESSION_EXPIRED) {
        state('Session หมดอายุ', 'กรุณาเข้าสู่ระบบอีกครั้ง'); onSessionExpired?.(); return;
      }
      if (error?.code === STAFF_ERROR_CODES.ACCESS_DENIED) {
        state('ไม่มีสิทธิ์เข้าถึง', 'บัญชีนี้ไม่มีขอบเขตสำหรับอ่านข้อมูลที่ร้องขอ');
        onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์ค้นหาข้อมูล Staff หรือไม่มี Scope ที่ Active'); return;
      }
      if (error?.code === STAFF_ERROR_CODES.VALIDATION_ERROR) {
        state('ตัวกรองไม่ถูกต้อง', 'ตรวจสอบข้อมูลในช่องค้นหาแล้วลองใหม่');
        showFieldErrors(error.details); return;
      }
      state('โหลดข้อมูลไม่สำเร็จ', 'ยังไม่สามารถอ่านผลการค้นหาได้ กรุณาลองอีกครั้ง', true);
      if (focusResults) results.focus();
    } finally {
      if (!signal?.aborted && current === sequence) setBusy(false);
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try { load(filtersFromForm(), true); }
    catch (error) { showFieldErrors(error.details); }
  });
  for (const key of ['pageSize', 'status', 'sort', 'order']) {
    fields[key]?.addEventListener('change', () => {
      try { load(filtersFromForm(), true); } catch (error) { showFieldErrors(error.details); }
    });
  }
  signal?.addEventListener('abort', () => { sequence += 1; request?.abort(); }, { once: true });
  fillFields();
  if (!signal?.aborted) load(applied);
  return root;
}

/** #77 owns the eventual detail/API/actions. This handoff performs no request. */
export function renderStaffReviewHandoff({ planId } = {}) {
  const section = node('section', 'student-card staff-review-handoff');
  section.dataset.role = 'staff-review-handoff';
  section.append(node('h2', 'student-card__title', 'หน้าเปิดตรวจแผนอยู่ระหว่างพัฒนา'),
    node('p', 'student-card__description', 'เลือกแผนแล้ว ส่วนรายละเอียดและคำสั่งตรวจแผนจะพร้อมใช้งานเมื่อ Issue #77 เสร็จสมบูรณ์'));
  // The UUID is passed via the guarded route only, never a private payload in storage.
  if (planId) section.dataset.planId = planId;
  section.append(link('#/staff/plans', 'กลับไปค้นหาแผน'), link('#/staff/students', 'ค้นหานักศึกษา'));
  return section;
}
