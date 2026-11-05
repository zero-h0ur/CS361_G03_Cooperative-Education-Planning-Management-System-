import input from '../../api/services/application-input.js';
import form from '../../shared/application-form.js';

const TEXT_FIELDS = ['curriculum','gpax','declared_group_gpa','contact_address','contact_phone','contact_email',
  'major_group','name_prefix','thai_full_name','english_full_name','gpax_reporting_term','skills_detail',
  'interested_position_other','guardian_name','guardian_relationship','guardian_address','guardian_phone',
  'interested_position_codes','interested_positions','skills','course_attempts','selected_courses','additional_studies'];
const clone = value => JSON.parse(JSON.stringify(value));
const LABELS = {curriculum:'หลักสูตร',gpax:'GPAX ที่แจ้ง',declared_group_gpa:'ค่าเฉลี่ยกลุ่มวิชาที่แจ้ง',contact_address:'ที่อยู่ติดต่อ',contact_phone:'โทรศัพท์ติดต่อ',contact_email:'อีเมลติดต่อ',major_group:'กลุ่มวิชาเอก',name_prefix:'คำนำหน้าชื่อ',thai_full_name:'ชื่อภาษาไทย',english_full_name:'ชื่อภาษาอังกฤษ',gpax_reporting_term:'ภาคการศึกษาตาม Transcript',skills_detail:'ทักษะและความถนัด',interested_position_other:'ตำแหน่งอื่นที่สนใจ',guardian_name:'ชื่อผู้ติดต่อฉุกเฉิน',guardian_relationship:'ความสัมพันธ์',guardian_address:'ที่อยู่ผู้ติดต่อฉุกเฉิน',guardian_phone:'โทรศัพท์ผู้ติดต่อฉุกเฉิน',interested_position_codes:'ตำแหน่งที่สนใจ',interested_positions:'ตำแหน่งที่สนใจจากฉบับเดิม',skills:'ทักษะจากฉบับเดิม',course_attempts:'ผลการเรียนที่แจ้ง',selected_courses:'วิชาทางเลือก',additional_studies:'รายวิชาเพิ่มเติม'};

// Claimed owner consistency prevents accidental shared-browser imports, not proof
// of historical authorship/submission. Only server options supply the current owner.
export function recoveryCandidates(storage, official, cycles) {
  if (!official?.student_id || !official.student_number) return [];
  let records;
  try {
    const raw = storage?.getItem('co-ed:tu-applications');
    if (!raw || raw.length > 2000000) return [];
    records = JSON.parse(raw);
  } catch { return []; }
  if (!Array.isArray(records) || records.length > 100) return [];
  return records.flatMap((record, index) => {
    if (!record || record.student_id !== official.student_id || record.official?.student_id !== official.student_id ||
      record.official?.student_number !== official.student_number || !cycles.some(c => c.id === record.cycle_id)) return [];
    for (const key of ['student_number','institutional_email','full_name']) {
      if (record.official[key] && official[key] && record.official[key] !== official[key]) return [];
    }
    const payload = {}, rejected = [];
    for (const key of TEXT_FIELDS) if (Object.hasOwn(record.payload || {}, key)) {
      try { Object.assign(payload, input.payload({[key]: clone(record.payload[key])})); }
      catch { rejected.push(key); }
    }
    // Never import documents, old status/UUID/version, verified flags or declarations.
    return [{index, cycle_id: record.cycle_id, payload, rejected}];
  });
}

export function createDraftRecovery({client, storage, sessionStorage, randomUUID = () => crypto.randomUUID()}) {
  const attempts = new Map();
  return async function recover(candidate, selectedFields, {signal,expectedDraftVersion} = {}) {
    const options = await client.options({signal});
    const matching = [storage, sessionStorage].filter(Boolean).flatMap(s => recoveryCandidates(s, options.official, options.cycles))
      .find(c => c.cycle_id === candidate.cycle_id && JSON.stringify(c.payload) === JSON.stringify(candidate.payload));
    if (!matching) throw new Error('ยืนยันเจ้าของข้อมูลเดิมไม่ได้ กรุณาโหลดหน้าใหม่');
    const signature = JSON.stringify({owner: options.official.student_id, candidate, selectedFields});
    let attempt = attempts.get(signature);
    if (!attempt) { attempt = {create: randomUUID(), save: randomUUID()}; attempts.set(signature, attempt); }
    const list = await client.list({signal});
    let app = list.find(a => a.cycle_id === candidate.cycle_id);
    if (app && app.status !== 'DRAFT') throw new Error('รอบนี้มีใบสมัครที่ส่งแล้วหรือรอแก้ไข ไม่กู้ทับข้อมูลเดิม');
    if (app && expectedDraftVersion === undefined && !attempt.body) {
      // Reconcile an uncertain create with its original operation. If another
      // Draft was created meanwhile, the server rejects instead of overwriting it.
      await client.create({cycle_id:candidate.cycle_id,operation_id:attempt.create},{signal});
    }
    app = app ? await client.get(app.id, {signal}) : await client.create({cycle_id: candidate.cycle_id, operation_id: attempt.create}, {signal});
    if (app.status !== 'DRAFT' || app.availability?.can_edit !== true) throw new Error('ฉบับร่างนี้ไม่เปิดให้แก้ไข');
    if (!attempt.body && expectedDraftVersion !== undefined && app.version !== expectedDraftVersion)
      throw new Error('ฉบับร่างเปลี่ยนหลังจากที่คุณตรวจเทียบ กรุณาโหลดหน้าใหม่ก่อนเลือกข้อความอีกครั้ง');
    // Freeze the version/body for an uncertain-result retry; never overwrite a later edit.
    if (!attempt.body) attempt.body = {operation_id: attempt.save, expected_version: app.version,
      expected_policy_id: app.policy?.id || null, payload: {
        ...Object.fromEntries(selectedFields.filter(k => TEXT_FIELDS.includes(k) && Object.hasOwn(candidate.payload, k)).map(k => [k, candidate.payload[k]])),
        acknowledgements: Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k => [k, false]))
      }};
    const saved = await client.save(app.id, attempt.body, {signal});
    if (saved.status !== 'DRAFT') throw new Error('ยังยืนยันการกู้ฉบับร่างไม่ได้ กรุณาโหลดข้อมูลล่าสุด');
    return saved; // The source is deliberately never removed or modified.
  };
}

export function renderDraftRecovery({client, official, cycles, list, signal, onNavigate, storage = window.localStorage, sessionStorage = window.sessionStorage}) {
  const candidates = [storage, sessionStorage].flatMap(s => recoveryCandidates(s, official, cycles))
    .filter((c, i, all) => all.findIndex(x => x.cycle_id === c.cycle_id && JSON.stringify(x.payload) === JSON.stringify(c.payload)) === i)
    .filter(c => !list.some(a => a.cycle_id === c.cycle_id && a.status !== 'DRAFT'));
  if (!candidates.length) return null;
  const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const root = el('details'); root.className = 'application-card application-recovery';
  root.append(el('summary', 'กู้ข้อความจากใบสมัครในเบราว์เซอร์เดิม'));
  root.append(el('p', 'ข้อมูลเดิมไม่ใช่หลักฐานว่าส่งสำเร็จ เลือกข้อความที่จะกู้เป็นฉบับร่างเท่านั้น ต้องตรวจข้อมูล รับรองคุณสมบัติใหม่ และแนบไฟล์จริงอีกครั้ง ข้อมูลต้นฉบับจะไม่ถูกลบ'));
  const recover = createDraftRecovery({client, storage, sessionStorage});
  for (const c of candidates) {
    const section = el('section'), checks = [], existing = list.find(a => a.cycle_id === c.cycle_id);
    let reviewedVersion;
    section.append(el('h3', cycles.find(cycle => cycle.id === c.cycle_id)?.name || 'รอบสมัคร'));
    if (existing) section.append(el('p', 'มีฉบับร่างบนเซิร์ฟเวอร์แล้ว: เปรียบเทียบค่าก่อนเลือก ช่องที่เลือกจะถูกแทนที่ ช่องอื่นเก็บไว้ตามเดิม'));
    if (c.rejected.length) section.append(el('p', 'บางช่องมีรูปแบบไม่ถูกต้องและจะไม่ถูกกู้ กรุณากรอกใหม่'));
    for (const [key, value] of Object.entries(c.payload)) {
      const label = el('label'), check = el('input'); check.type = 'checkbox'; check.value = key;
      check.disabled = Boolean(existing);label.append(check, document.createTextNode(' ' + LABELS[key]));
      const preview = el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      preview.style.whiteSpace = 'pre-wrap'; preview.style.overflowWrap = 'anywhere';
      section.append(label, preview); checks.push(check);
      if (existing) {
        const before = el('p', 'กำลังโหลดค่าบนเซิร์ฟเวอร์…'); section.append(before);
        check._before = before;
      }
    }
    const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const action = el('button', 'กู้เฉพาะช่องที่เลือกเป็นฉบับร่าง'); action.type = 'button'; action.className = 'shell-button shell-button--secondary';
    if (existing) {
      action.disabled = true;
      client.get(existing.id, {signal}).then(app => {
        if (signal?.aborted) return;
        if (app.status !== 'DRAFT' || app.availability?.can_edit !== true) throw new Error('ฉบับร่างนี้ไม่เปิดให้แก้ไข');
        reviewedVersion = app.version;
        for (const check of checks) {
          const value = app.payload?.[check.value];
          check._before.textContent = 'ค่าปัจจุบันบนเซิร์ฟเวอร์: ' + (value === undefined ? 'ยังไม่ได้กรอก' : typeof value === 'string' ? value : JSON.stringify(value));
          check.disabled = false;
        }
        action.disabled = false;
      }).catch(() => { if (!signal?.aborted) { status.setAttribute('role', 'alert'); status.textContent = 'โหลดฉบับร่างเพื่อเปรียบเทียบไม่สำเร็จ กรุณาโหลดหน้านี้ใหม่ ข้อมูลเดิมยังอยู่'; } });
    }
    action.addEventListener('click', async () => {
      const fields = checks.filter(check => check.checked).map(check => check.value);
      if (!fields.length) { status.textContent = 'กรุณาเลือกข้อความอย่างน้อยหนึ่งช่อง'; return; }
      action.disabled = true; status.setAttribute('role', 'status'); status.textContent = 'กำลังกู้เป็นฉบับร่าง…';
      try { const saved = await recover(c, fields, {signal,expectedDraftVersion:reviewedVersion}); if (!signal?.aborted) onNavigate?.(`#/student/application/${saved.id}`); }
      catch (error) { if (!signal?.aborted) { status.setAttribute('role', 'alert'); status.textContent = error.message || 'ยังกู้ไม่สำเร็จ ข้อมูลต้นฉบับยังอยู่'; } }
      finally { action.disabled = false; }
    });
    section.append(status, action); root.append(section);
  }
  return root;
}
