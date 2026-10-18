import { STUDENT_PLAN_ERROR_CODES } from './plan-submission-client.js';

const EDITABLE = new Set(['DRAFT', 'NEEDS_REVISION']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

export function validatePlanDraft(content, status = 'DRAFT') {
  const errors = {};
  if (!UUID.test(content.cycle_id || '')) errors.cycle_id = 'กรุณาเลือกรอบการสมัคร';
  for (const key of ['company_id', 'position_id']) {
    if (content[key] !== null && !UUID.test(content[key] || '')) errors[key] = 'กรุณาเลือกข้อมูลจากรายการ';
  }
  if (content.position_id && !content.company_id) errors.position_id = 'กรุณาเลือกสถานประกอบการก่อน';
  if (status === 'NEEDS_REVISION') {
    if (!content.company_id) errors.company_id = 'แผนที่ส่งกลับแก้ไขต้องมีสถานประกอบการ';
    if (!content.position_id) errors.position_id = 'แผนที่ส่งกลับแก้ไขต้องมีตำแหน่งงาน';
  }
  if (typeof content.notes === 'string' && content.notes.trim().length > 2000) {
    errors.notes = 'บันทึกต้องยาวไม่เกิน 2,000 ตัวอักษร';
  }
  return errors;
}

/** Native selects preserve keyboard support; all directory text stays plain text. */
export function renderPlanEditor({
  plan = null, planClient, signal, onSaved, onReload, onSessionExpired,
  onAccessDenied, onDirtyChange = () => {}, onBusyChange = () => {},
  createOperationId = () => globalThis.crypto.randomUUID()
}) {
  if (plan && !EDITABLE.has(plan.status)) return null;
  const section = node('section', 'student-card plan-editor');
  section.dataset.role = 'plan-editor';
  const title = node('h2', 'student-card__title', plan ? 'แก้ไขแผนสหกิจศึกษา' : 'สร้างแผนสหกิจศึกษา');
  title.id = 'plan-editor-title';
  section.setAttribute('aria-labelledby', title.id);
  section.append(title, node('p', 'student-card__description',
    'เลือกรอบสมัครและบันทึกแผนไว้ก่อนได้ เมื่อเลือกสถานประกอบการและตำแหน่งงานครบแล้วจึงส่งแผนให้เจ้าหน้าที่ตรวจสอบ'));
  const form = node('form', 'student-profile-form');
  form.noValidate = true;
  const feedback = node('div', 'student-profile-feedback');
  feedback.dataset.role = 'plan-save-feedback';
  feedback.hidden = true;
  feedback.tabIndex = -1;
  const fields = {};
  const errors = {};
  const values = {
    cycle_id: plan?.cycle_id || '', company_id: plan?.company_id || null,
    position_id: plan?.position_id || null, notes: plan?.notes || ''
  };
  let cycles = [];
  let positions = [];
  let selectedCompany = plan?.company_id && plan?.company_name
    ? { id: plan.company_id, name: plan.company_name } : null;
  let cycleReady = false;
  let positionsReady = !values.company_id;
  let saving = false;
  let conflict = false;
  let pending = null;
  let timer;
  let companyRequest = null;
  let positionRequest = null;
  let searchSequence = 0;
  let positionSequence = 0;
  let searchPage = 1;
  let searchTerm = '';
  const alive = () => !signal?.aborted;

  function field(key, label, tag = 'select') {
    const wrapper = node('div', 'student-form__field');
    const input = node(tag, 'student-form__input');
    input.id = `plan-${key}`;
    input.name = key;
    const labelNode = node('label', 'student-form__label', label);
    labelNode.htmlFor = input.id;
    const error = node('p', 'student-form__error');
    error.id = `${input.id}-error`;
    error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    wrapper.append(labelNode, input, error);
    fields[key] = input;
    errors[key] = error;
    return wrapper;
  }
  function option(select, value, label, disabled = false) {
    const item = node('option', '', label);
    item.value = value;
    item.disabled = disabled;
    select.append(item);
  }
  const cycleField = field('cycle_id', 'รอบการสมัคร (จำเป็น)');
  fields.cycle_id.required = true;
  option(fields.cycle_id, '', 'กำลังโหลดรอบสมัคร…');
  const cycleHint = node('p', 'student-form__hint');
  cycleHint.id = 'plan-cycle-hint';
  fields.cycle_id.setAttribute('aria-describedby', `${errors.cycle_id.id} ${cycleHint.id}`);
  cycleField.append(cycleHint);
  const cycleRetry = node('button', 'shell-button shell-button--secondary', 'โหลดรอบสมัครอีกครั้ง');
  cycleRetry.type = 'button';
  cycleRetry.hidden = true;
  cycleRetry.addEventListener('click', () => loadCycles());
  cycleField.append(cycleRetry);

  const directory = node('fieldset', 'plan-editor__directory');
  directory.append(node('legend', 'student-form__label', 'สถานประกอบการและตำแหน่งงาน'));
  const searchField = field('search', 'ค้นหาสถานประกอบการหรือตำแหน่งงาน', 'input');
  fields.search.type = 'search';
  fields.search.placeholder = 'ค้นหาจาก Public Directory';
  const directoryStatus = node('p', 'student-form__hint');
  directoryStatus.setAttribute('role', 'status');
  directoryStatus.id = 'plan-directory-status';
  fields.search.setAttribute('aria-describedby', directoryStatus.id);
  const companyField = field('company_id', 'สถานประกอบการ');
  option(fields.company_id, '', 'ยังไม่เลือกสถานประกอบการ');
  if (selectedCompany) option(fields.company_id, selectedCompany.id, selectedCompany.name);
  fields.company_id.value = selectedCompany?.id || '';
  const more = node('button', 'shell-button shell-button--secondary', 'ดูสถานประกอบการเพิ่มเติม');
  more.type = 'button';
  more.hidden = true;
  more.addEventListener('click', () => searchCompanies(searchTerm, searchPage + 1));
  const directoryRetry = node('button', 'shell-button shell-button--secondary', 'ค้นหาอีกครั้ง');
  directoryRetry.type = 'button';
  directoryRetry.hidden = true;
  directoryRetry.addEventListener('click', () => searchCompanies(fields.search.value, 1));
  const positionField = field('position_id', 'ตำแหน่งงาน');
  option(fields.position_id, '', values.company_id ? 'กำลังโหลดตำแหน่งงาน…' : 'เลือกสถานประกอบการก่อน');
  const positionStatus = node('p', 'student-form__hint');
  positionStatus.setAttribute('role', 'status');
  positionStatus.id = 'plan-position-status';
  fields.position_id.setAttribute('aria-describedby', `${errors.position_id.id} ${positionStatus.id}`);
  const positionRetry = node('button', 'shell-button shell-button--secondary', 'โหลดตำแหน่งงานอีกครั้ง');
  positionRetry.type = 'button';
  positionRetry.hidden = true;
  positionRetry.addEventListener('click', () => loadPositions(values.company_id));
  positionField.append(positionStatus, positionRetry);
  const selections = node('div', 'plan-editor__selections');
  selections.append(companyField, positionField);
  directory.append(searchField, directoryStatus, directoryRetry, selections, more);

  const notesField = field('notes', 'บันทึกเพิ่มเติม (ไม่บังคับ)', 'textarea');
  fields.notes.rows = 4;
  fields.notes.value = values.notes;
  const count = node('p', 'student-form__meta', `${values.notes.length.toLocaleString('th-TH')} / 2,000 ตัวอักษร`);
  count.id = 'plan-notes-count';
  fields.notes.setAttribute('aria-describedby', `${errors.notes.id} ${count.id}`);
  notesField.append(count);

  const actions = node('div', 'student-form__actions');
  const save = node('button', 'shell-button', plan ? 'บันทึกการแก้ไข' : 'สร้างฉบับร่าง');
  save.type = 'submit';
  save.dataset.role = 'save-plan-button';
  const reload = node('button', 'shell-button shell-button--secondary', 'โหลดแผนล่าสุดและทิ้งการแก้ไข');
  reload.type = 'button';
  reload.hidden = true;
  reload.addEventListener('click', () => {
    if (saving) return;
    onDirtyChange(false);
    onReload?.();
  });
  actions.append(save, reload);
  const controls = node('fieldset', 'plan-editor__controls');
  controls.dataset.role = 'plan-editor-controls';
  controls.append(cycleField, directory, notesField, feedback, actions);
  form.append(controls);
  section.append(form);

  function setDirty() {
    reload.hidden = false;
    onDirtyChange(true);
  }
  function sync() {
    const locked = saving || Boolean(pending) || conflict;
    fields.cycle_id.disabled = locked || !cycleReady;
    fields.company_id.disabled = locked;
    fields.position_id.disabled = locked || !values.company_id || !positionsReady;
    fields.search.disabled = locked;
    fields.notes.disabled = saving;
    fields.notes.readOnly = locked;
    save.disabled = saving || conflict || !cycleReady || !positionsReady;
    more.disabled = locked || Boolean(companyRequest);
    directoryRetry.disabled = locked;
    cycleRetry.disabled = locked;
    positionRetry.disabled = locked;
    reload.disabled = saving;
    section.setAttribute('aria-busy', String(saving));
    save.textContent = saving ? 'กำลังบันทึก…' : pending ? 'ลองบันทึกคำขอเดิมอีกครั้ง' : plan ? 'บันทึกการแก้ไข' : 'สร้างฉบับร่าง';
    onBusyChange(saving || Boolean(pending) || conflict);
  }
  function showFeedback(message, tone = 'error') {
    feedback.hidden = false;
    feedback.className = `student-profile-feedback student-profile-feedback--${tone}`;
    feedback.setAttribute('role', tone === 'status' ? 'status' : 'alert');
    feedback.textContent = message;
    feedback.focus();
  }
  function fieldErrors(issues = {}) {
    for (const key of ['cycle_id', 'company_id', 'position_id', 'notes']) {
      errors[key].textContent = issues[key] || '';
      errors[key].hidden = !issues[key];
      fields[key].setAttribute('aria-invalid', String(Boolean(issues[key])));
    }
  }
  function authFailure(error) {
    if (error?.code === STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED) { onSessionExpired?.(); return true; }
    if (error?.code === STUDENT_PLAN_ERROR_CODES.ACCESS_DENIED) { onAccessDenied?.('บัญชีนี้ไม่มีสิทธิ์แก้ไขแผน'); return true; }
    return false;
  }
  fields.cycle_id.addEventListener('change', () => {
    values.cycle_id = fields.cycle_id.value;
    const cycle = cycles.find((item) => item.id === values.cycle_id);
    cycleHint.textContent = cycle?.status === 'CLOSED' ? 'รอบนี้ปิดรับแล้ว บันทึกฉบับร่างได้ แต่ยังส่งแผนไม่ได้' : '';
    setDirty();
  });
  fields.company_id.addEventListener('change', () => {
    values.company_id = fields.company_id.value || null;
    values.position_id = null;
    selectedCompany = values.company_id ? { id: values.company_id, name: fields.company_id.selectedOptions[0].textContent } : null;
    setDirty();
    loadPositions(values.company_id);
  });
  fields.position_id.addEventListener('change', () => { values.position_id = fields.position_id.value || null; setDirty(); });
  fields.notes.addEventListener('input', () => {
    values.notes = fields.notes.value;
    count.textContent = `${values.notes.length.toLocaleString('th-TH')} / 2,000 ตัวอักษร`;
    setDirty();
  });
  fields.search.addEventListener('input', () => {
    clearTimeout(timer);
    // Invalidate the previous query immediately, before the debounce window.
    searchSequence += 1;
    companyRequest?.abort();
    companyRequest = null;
    timer = setTimeout(() => searchCompanies(fields.search.value, 1), 300);
  });

  async function loadCycles() {
    cycleRetry.hidden = true;
    fields.cycle_id.setAttribute('aria-busy', 'true');
    try {
      cycles = await planClient.listCycles({ signal });
      if (!alive()) return;
      fields.cycle_id.replaceChildren();
      option(fields.cycle_id, '', cycles.length ? 'เลือกรอบการสมัคร' : 'ยังไม่มีรอบสมัครที่เปิดเผย');
      for (const cycle of cycles) {
        option(fields.cycle_id, cycle.id, `${cycle.name}${cycle.status === 'CLOSED' ? ' (ปิดรับ — ฉบับร่างเท่านั้น)' : ''}`);
      }
      fields.cycle_id.value = cycles.some((cycle) => cycle.id === values.cycle_id) ? values.cycle_id : '';
      if (values.cycle_id && !fields.cycle_id.value) {
        cycleHint.textContent = 'รอบเดิมไม่พร้อมให้เลือก กรุณาเลือกรอบสมัครจากรายการ';
      } else if (cycles.find((cycle) => cycle.id === values.cycle_id)?.status === 'CLOSED') {
        cycleHint.textContent = 'รอบนี้ปิดรับแล้ว บันทึกฉบับร่างได้ แต่ยังส่งแผนไม่ได้';
      }
      cycleReady = cycles.length > 0;
    } catch (error) {
      if (!alive() || error?.name === 'AbortError' || authFailure(error)) return;
      cycleHint.textContent = 'โหลดรอบสมัครไม่สำเร็จ กรุณาลองใหม่';
      cycleRetry.hidden = false;
    } finally {
      if (alive()) { fields.cycle_id.removeAttribute('aria-busy'); sync(); }
    }
  }

  async function searchCompanies(q, page) {
    companyRequest?.abort();
    const controller = new AbortController();
    companyRequest = controller;
    const sequence = ++searchSequence;
    directoryStatus.textContent = 'กำลังค้นหาสถานประกอบการ…';
    directoryRetry.hidden = true;
    more.disabled = true;
    directory.setAttribute('aria-busy', 'true');
    try {
      const result = await planClient.searchCompanies({ q, page, signal: controller.signal });
      if (!alive() || sequence !== searchSequence) return;
      if (page === 1) {
        fields.company_id.replaceChildren();
        option(fields.company_id, '', 'ยังไม่เลือกสถานประกอบการ');
        if (selectedCompany) option(fields.company_id, selectedCompany.id, selectedCompany.name);
      }
      const seen = new Set([...fields.company_id.options].map((item) => item.value));
      for (const item of result.items) {
        if (!seen.has(item.id)) { option(fields.company_id, item.id, item.name); seen.add(item.id); }
      }
      fields.company_id.value = values.company_id || '';
      searchPage = page;
      searchTerm = q;
      more.hidden = page >= result.pagination.totalPages;
      directoryStatus.textContent = result.items.length
        ? `แสดงผลการค้นหาถึงหน้า ${page} จาก ${result.pagination.totalPages}`
        : 'ไม่พบสถานประกอบการ ลองเปลี่ยนคำค้นหา';
    } catch (error) {
      if (!alive() || sequence !== searchSequence || error?.name === 'AbortError') return;
      directoryStatus.textContent = 'ค้นหาสถานประกอบการไม่สำเร็จ ข้อมูลที่กรอกไว้ยังอยู่';
      directoryRetry.hidden = false;
    } finally {
      if (alive() && sequence === searchSequence) {
        companyRequest = null;
        directory.setAttribute('aria-busy', 'false');
        sync();
      }
    }
  }

  async function loadPositions(companyId) {
    positionRequest?.abort();
    const sequence = ++positionSequence;
    const controller = new AbortController();
    positionRequest = controller;
    positions = [];
    positionsReady = !companyId;
    positionRetry.hidden = true;
    fields.position_id.replaceChildren();
    option(fields.position_id, '', companyId ? 'กำลังโหลดตำแหน่งงาน…' : 'เลือกสถานประกอบการก่อน');
    positionStatus.textContent = '';
    sync();
    if (!companyId) return;
    fields.position_id.setAttribute('aria-busy', 'true');
    try {
      positions = await planClient.getCompanyPositions({ companyId, signal: controller.signal });
      if (!alive() || sequence !== positionSequence) return;
      fields.position_id.replaceChildren();
      option(fields.position_id, '', 'ยังไม่เลือกตำแหน่งงาน');
      for (const item of positions) option(fields.position_id, item.id, item.title);
      fields.position_id.value = positions.some((item) => item.id === values.position_id) ? values.position_id : '';
      if (values.position_id && !fields.position_id.value) {
        positionStatus.textContent = 'ตำแหน่งเดิมไม่พร้อมใช้งาน กรุณาเลือกตำแหน่งใหม่';
      } else if (!positions.length) positionStatus.textContent = 'สถานประกอบการนี้ยังไม่มีตำแหน่งงานที่เปิดเผย';
      positionsReady = true;
    } catch (error) {
      if (!alive() || sequence !== positionSequence || error?.name === 'AbortError') return;
      positionStatus.textContent = 'โหลดตำแหน่งงานไม่สำเร็จ กรุณาลองใหม่';
      positionRetry.hidden = false;
    } finally {
      if (alive() && sequence === positionSequence) {
        fields.position_id.removeAttribute('aria-busy');
        sync();
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || conflict || !cycleReady || !positionsReady) return;
    if (!pending) {
      const content = {
        cycle_id: fields.cycle_id.value,
        company_id: values.company_id,
        position_id: fields.position_id.value || null,
        notes: fields.notes.value.trim() || null
      };
      const issues = validatePlanDraft(content, plan?.status);
      if (content.company_id && !selectedCompany) issues.company_id = 'สถานประกอบการเดิมไม่พร้อมใช้งาน กรุณาเลือกใหม่';
      fieldErrors(issues);
      if (Object.keys(issues).length) {
        showFeedback('กรุณาตรวจสอบข้อมูลที่ระบุก่อนบันทึก');
        fields[Object.keys(issues)[0]].focus();
        return;
      }
      pending = { planId: plan?.id || null, expectedVersion: plan?.version,
        operationId: createOperationId(), content };
    }
    saving = true;
    sync();
    try {
      const saved = await planClient.saveDraft({ ...pending, signal });
      if (!alive()) return;
      pending = null;
      onDirtyChange(false);
      await onSaved(saved);
    } catch (error) {
      if (!alive() || error?.name === 'AbortError' || authFailure(error)) return;
      if (error?.code !== STUDENT_PLAN_ERROR_CODES.SERVICE_UNAVAILABLE) pending = null;
      if ([STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT,
        STUDENT_PLAN_ERROR_CODES.INVALID_STATE_TRANSITION].includes(error?.code)) {
        conflict = true;
        reload.hidden = false;
        showFeedback('แผนถูกแก้ไขหรือเปลี่ยนสถานะแล้ว ข้อมูลที่คุณกรอกยังอยู่ กรุณาคัดลอกบันทึกที่ต้องการเก็บ แล้วโหลดแผนล่าสุดก่อนแก้ไขอีกครั้ง', 'warning');
      } else if (pending) {
        reload.hidden = false;
        showFeedback('ยังยืนยันผลการบันทึกไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง หรือโหลดแผนล่าสุดก่อนแก้ข้อมูลเพิ่ม', 'warning');
      } else if (error?.code === STUDENT_PLAN_ERROR_CODES.PLAN_ALREADY_EXISTS_FOR_CYCLE) {
        reload.hidden = false;
        showFeedback('มีแผนในรอบนี้แล้ว กรุณาเปิดแผนเดิมหรือเลือกรอบอื่น', 'warning');
      } else {
        const issues = {};
        for (const detail of error?.details || []) {
          if (errors[detail.field]) issues[detail.field] = 'ข้อมูลนี้ไม่ผ่านการตรวจสอบ กรุณาเลือกหรือกรอกใหม่';
        }
        fieldErrors(issues);
        showFeedback('บันทึกไม่สำเร็จ กรุณาตรวจสอบรอบสมัคร สถานประกอบการ ตำแหน่งงาน และบันทึก แล้วลองใหม่');
      }
    } finally {
      saving = false;
      if (alive()) sync();
    }
  });
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    companyRequest?.abort();
    positionRequest?.abort();
  }, { once: true });
  // No notes, identity or protected payload is persisted in browser storage.
  sync();
  loadCycles();
  searchCompanies('', 1);
  if (values.company_id) loadPositions(values.company_id);
  return section;
}
