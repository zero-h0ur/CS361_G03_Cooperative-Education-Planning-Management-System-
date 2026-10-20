// Development-only, synthetic data. Never imported by src/frontend/app.js.
import { sanitizeStatusHistoryEntry } from '../../src/frontend/student/plan-submission-client.js';
import { sanitizeAdvisorStudent, sanitizeAdvisorPlanSummary, sanitizeAdvisorPlanDetail } from '../../src/frontend/advisor/advisor-client.js';

export const SCENARIOS = Object.freeze({
  rejected:'ไม่ผ่านคุณสมบัติในรอบนี้',
  'company-confirmed':'ผ่านเกณฑ์และบริษัทยืนยันแล้ว',
  'company-pending':'รอแบบฟอร์มบริษัทตอบกลับ',
  'capacity-full':'Advisor ครบ 5 คน',
  'missing-policy':'Staff ยังไม่กำหนดเอกสาร',
  legacy:'รายการเก่าที่ไม่มี snapshot',
  draft: 'ฉบับร่าง พร้อมแก้ไข',
  incomplete: 'ฉบับร่าง ข้อมูลยังไม่ครบ',
  revision: 'ส่งกลับให้แก้ไข',
  submitted: 'ส่งแผนแล้ว (อ่านอย่างเดียว)',
  review: 'กำลังตรวจสอบ (อ่านอย่างเดียว)',
  approved: 'อนุมัติแล้ว (อ่านอย่างเดียว)',
  cancelled: 'ยกเลิกแล้ว (อ่านอย่างเดียว)',
  empty: 'ยังไม่มีแผน',
  loading: 'กำลังโหลด (ค้างไว้สำหรับตรวจ UI)',
  error: 'โหลดข้อมูลไม่สำเร็จ',
  conflict: 'บันทึกแล้วพบ Version conflict',
  expired: 'Session หมดอายุ',
  forbidden: 'ไม่มีสิทธิ์เข้าถึง'
});

export const ADVISOR_SCENARIOS = Object.freeze({
  assigned: 'มีนักศึกษาในความดูแล',
  unassigned: 'ยังไม่ได้รับมอบหมายนักศึกษา',
  'no-plans': 'มีนักศึกษา แต่ยังไม่มีแผน',
  'long-text': 'ชื่อและข้อมูลยาว',
  revoked: 'ถอนการมอบหมาย (เปิดรายละเอียดเพื่อทดสอบ)',
  loading: SCENARIOS.loading,
  error: SCENARIOS.error,
  expired: SCENARIOS.expired,
  forbidden: SCENARIOS.forbidden
});

const ids = {
  plan: '50000000-0000-4000-8000-000000000101',
  cycle: '30000000-0000-4000-8000-000000000101',
  cycle2: '30000000-0000-4000-8000-000000000102',
  company: '10000000-0000-4000-8000-000000000001',
  company2: '10000000-0000-4000-8000-000000000002',
  position: '20000000-0000-4000-8000-000000000001',
  position2: '20000000-0000-4000-8000-000000000002'
};
const stamp = '2026-10-20T03:00:00.000Z';
// Fixtures contain JSON values only; also works in the jsdom test environment.
const copy = (value) => JSON.parse(JSON.stringify(value));
const failure = (code) => Object.assign(new Error('Local UI preview scenario'), { code });

// Presentation fixtures only: no network, credentials, writes or mutation methods.
function createAdvisorPreviewClient({ scenario, delayMs }) {
  const names = ['กานต์ ตัวอย่าง', 'ปณิตา ทดลอง', 'ธนกฤต สมมติ'];
  const students = scenario === 'unassigned' ? [] : names.map((name, index) => sanitizeAdvisorStudent({
    id: `40000000-0000-4000-8000-00000000010${index + 1}`,
    student_number: `DEMO00000${index + 1}`,
    full_name: scenario === 'long-text' ? `${name} ${'ชื่อสมมติสำหรับตรวจการตัดบรรทัด'.repeat(5)}` : name,
    preferred_name: null, department: 'ภาควิชาวิทยาการคอมพิวเตอร์',
    program: 'วิทยาศาสตรบัณฑิต', major: 'วิทยาการคอมพิวเตอร์',
    academic_year: 2569, enrollment_status: 'ACTIVE'
  }));
  const plan = sanitizeAdvisorPlanDetail({
    id: ids.plan, cycle_id: ids.cycle,
    company: { id: ids.company, name: 'บริษัทตัวอย่างเพื่อทดสอบ จำกัด' },
    position: { id: ids.position, title: 'Software Developer' },
    status: 'APPROVED', version: 2, created_at: stamp, updated_at: stamp,
    notes: 'ข้อมูลสมมติสำหรับตรวจหน้าจอให้คำปรึกษา ไม่ใช่ข้อมูลนักศึกษาจริง'
  });
  async function read({ signal } = {}, detail = false) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((resolve, reject) => {
      let timer;
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      if (scenario !== 'loading') timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort); resolve();
      }, delayMs);
    });
    if (scenario === 'error') throw failure('SERVICE_UNAVAILABLE');
    if (scenario === 'expired') throw failure('SESSION_EXPIRED');
    if (scenario === 'forbidden' || (scenario === 'revoked' && detail)) throw failure('NOT_IN_SCOPE');
  }
  function requireStudent(studentId) {
    const student = students.find((item) => item.id === studentId);
    if (!student) throw failure('NOT_IN_SCOPE');
    return student;
  }
  function pageOf(items, { page = 1, pageSize = 20 } = {}) {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safeSize = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 20;
    return copy({ items: items.slice((safePage - 1) * safeSize, safePage * safeSize),
      pagination: { page: safePage, pageSize: safeSize, total: items.length, totalPages: Math.ceil(items.length / safeSize) } });
  }
  return Object.freeze({
    async listStudents(options = {}) { await read(options); return pageOf(students, options); },
    async getStudent(studentId, options = {}) { await read(options, true); return copy(requireStudent(studentId)); },
    async listStudentPlans(studentId, options = {}) {
      await read(options, true); requireStudent(studentId);
      return pageOf(scenario === 'no-plans' || studentId !== students[0]?.id ? [] : [sanitizeAdvisorPlanSummary(plan)], options);
    },
    async getPlan(planId, options = {}) {
      await read(options, true);
      if (planId !== plan.id || !students.length || scenario === 'no-plans') throw failure('NOT_IN_SCOPE');
      return copy(plan);
    }
  });
}

export function createPreviewClients({ role = 'STUDENT', scenario = role === 'ADVISOR' ? 'assigned' : 'draft', delayMs = 250 } = {}) {
  if (!['STUDENT', 'STAFF', 'ADVISOR'].includes(role)) throw new Error('Unsupported preview role');
  if (role === 'ADVISOR') {
    if (!Object.hasOwn(ADVISOR_SCENARIOS, scenario)) throw new Error('Unknown Advisor preview scenario');
    return { loadSession: async () => ({ role, canReviewPlan: false }),
      advisorClient: createAdvisorPreviewClient({ scenario, delayMs }) };
  }
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new Error('Unknown preview scenario');
  const status = { revision: 'NEEDS_REVISION', submitted: 'SUBMITTED', review: 'UNDER_REVIEW',
    approved: 'APPROVED', cancelled: 'CANCELLED',rejected:'REJECTED',
    'company-confirmed':'APPROVED','company-pending':'APPROVED','capacity-full':'APPROVED' }[scenario] || 'DRAFT';
  // Invented identity with a realistic display format, not a TU record. The reserved
  // .invalid domain is deliberate: never use a real student's contact details.
  const profile = {
    id: '20000000-0000-4000-8000-000000000101', student_number: '6609612345',
    full_name: 'ณัฐวดี ศิริกุล', preferred_name: null,
    institutional_email: 'nattawadee.s@example.invalid', department: 'ภาควิชาวิทยาการคอมพิวเตอร์',
    program: 'วิทยาศาสตรบัณฑิต', major: 'วิทยาการคอมพิวเตอร์', academic_year: 2569,
    enrollment_status: 'ACTIVE', version: 1, created_at: '2023-08-01T02:00:00.000Z', updated_at: stamp
  };
  let plans = scenario === 'empty' ? [] : [{
    id: ids.plan, cycle_id: ids.cycle,
    company_id: scenario === 'incomplete' ? null : ids.company,
    position_id: scenario === 'incomplete' ? null : ids.position,
    company_name: scenario === 'incomplete' ? null : 'บริษัทตัวอย่างเพื่อทดสอบ จำกัด',
    position_title: scenario === 'incomplete' ? null : 'Software Developer',
    notes: 'สนใจพัฒนาเว็บแอปพลิเคชันด้วย JavaScript และออกแบบ REST API ร่วมกับทีมพัฒนา (ข้อมูลสมมติสำหรับ Preview เท่านั้น)',
    status, version: 2, created_at: stamp, updated_at: stamp
  }];
  let history = [event('PLAN_CREATED', null, 'DRAFT')];
  if (status === 'CANCELLED') history.push(event('PLAN_CANCELLED', 'DRAFT', status));
  if (['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'APPROVED'].includes(status)) {
    history.push(event('PLAN_SUBMITTED', 'DRAFT', 'SUBMITTED'));
  }
  if (['UNDER_REVIEW', 'NEEDS_REVISION', 'APPROVED'].includes(status)) {
    history.push(event('PLAN_REVIEW_STARTED', 'SUBMITTED', 'UNDER_REVIEW'));
  }
  if (status === 'NEEDS_REVISION') history.push(event('PLAN_RETURNED', 'UNDER_REVIEW', status));
  if (status === 'APPROVED') history.push(event('PLAN_APPROVED', 'UNDER_REVIEW', status));

  function event(action, from, to) {
    return sanitizeStatusHistoryEntry({ event_id: crypto.randomUUID(), action,
      from_state: from, to_state: to, actor_role: ['PLAN_CREATED', 'PLAN_DRAFT_UPDATED', 'PLAN_SUBMITTED', 'PLAN_CANCELLED'].includes(action) ? 'STUDENT' : 'STAFF',
      review_notes: action === 'PLAN_RETURNED' ? 'กรุณาตรวจสอบตำแหน่งงานและปรับบันทึกให้ชัดเจน (ข้อมูลจำลอง)' : null,
      created_at: stamp });
  }
  async function wait({ signal } = {}, write = false) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((resolve, reject) => {
      let timer;
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      if (scenario !== 'loading') timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort); resolve();
      }, delayMs);
    });
    if (scenario === 'error') throw failure('SERVICE_UNAVAILABLE');
    if (scenario === 'expired') throw failure('SESSION_EXPIRED');
    if (scenario === 'forbidden') throw failure('ACCESS_DENIED');
    if (scenario === 'conflict' && write) throw failure('STALE_RECORD_CONFLICT');
  }
  const companies = [{ id: ids.company, name: 'บริษัทตัวอย่างเพื่อทดสอบ จำกัด' },
    { id: ids.company2, name: 'บริษัททดลองด้านการออกแบบ จำกัด' }];
  const positions = [{ id: ids.position, company_id: ids.company, title: 'Software Developer' },
    { id: ids.position2, company_id: ids.company2, title: 'UX/UI Designer' }];

  return {
    // Synthetic role in this separate entry point, never authentication.
    loadSession: async () => ({ role, canReviewPlan: false }),
    // Synthetic read-only list data, not a mock permission or review-command service.
    staffClient: {
      async searchStudents(options = {}) { return staffResults('students', options); },
      async searchPlans(options = {}) { return staffResults('plans', options); }
    },
    studentProfileClient: {
      async getOwnProfile(options) { await wait(options); return copy(profile); }
    },
    studentPlanClient: {
      async getOwnPlan({ planId, signal } = {}) {
        await wait({ signal });
        const plan = plans.find((item) => item.id === planId) || plans[0] || null;
        return copy({ plan, plans, statusHistory: history });
      },
      async listCycles(options) {
        await wait(options);
        return [{ id: ids.cycle, name: 'รอบที่ 1 ปีการศึกษา 2569 (จำลอง)', academic_year: 2569, semester: 1, status: 'OPEN' },
          { id: ids.cycle2, name: 'รอบที่ 2 ปีการศึกษา 2569 (จำลอง)', academic_year: 2569, semester: 2, status: 'OPEN' }];
      },
      async searchCompanies({ q = '', signal } = {}) {
        await wait({ signal });
        return { items: copy(companies.filter((item) => item.name.includes(q.trim()))), pagination: { page: 1, totalPages: 1 } };
      },
      async getCompanyPositions({ companyId, signal }) {
        await wait({ signal }); return copy(positions.filter((item) => item.company_id === companyId));
      },
      async saveDraft({ planId, content, expectedVersion, signal }) {
        await wait({ signal }, true);
        const previous = plans.find((item) => item.id === planId);
        if (planId && (!previous || expectedVersion !== previous.version)) throw failure('STALE_RECORD_CONFLICT');
        if (previous && !['DRAFT', 'NEEDS_REVISION'].includes(previous.status)) throw failure('INVALID_STATE_TRANSITION');
        if (plans.some((item) => item.id !== planId && item.cycle_id === content.cycle_id && item.status !== 'CANCELLED')) {
          throw failure('PLAN_ALREADY_EXISTS_FOR_CYCLE');
        }
        const saved = { ...content, id: planId || crypto.randomUUID(), status: previous?.status || 'DRAFT',
          version: (previous?.version || 0) + 1, created_at: previous?.created_at || stamp, updated_at: stamp,
          company_name: companies.find((item) => item.id === content.company_id)?.name || null,
          position_title: positions.find((item) => item.id === content.position_id)?.title || null };
        plans = [saved, ...plans.filter((item) => item.id !== planId)];
        history.push(event(previous ? 'PLAN_DRAFT_UPDATED' : 'PLAN_CREATED', previous?.status || null, saved.status));
        return copy(saved);
      },
      async submitPlan({ planId, expectedVersion, signal }) {
        await wait({ signal }, true);
        const plan = plans.find((item) => item.id === planId);
        if (!plan || plan.version !== expectedVersion) throw failure('STALE_RECORD_CONFLICT');
        if (!['DRAFT', 'NEEDS_REVISION'].includes(plan.status)) throw failure('INVALID_STATE_TRANSITION');
        if (!plan.cycle_id || !plan.company_id || !plan.position_id) throw failure('VALIDATION_ERROR');
        history.push(event('PLAN_SUBMITTED', plan.status, 'SUBMITTED'));
        plan.status = 'SUBMITTED'; plan.version += 1;
        return copy(plan);
      }
    }
  };

  async function staffResults(mode, options) {
    await wait(options);
    const student = Object.fromEntries(['id', 'student_number', 'full_name', 'preferred_name',
      'department', 'program', 'major', 'academic_year', 'enrollment_status'].map((key) => [key, profile[key]]));
    let rows = mode === 'students' ? [student] : plans.map((plan) => ({
      id: plan.id, status: plan.status, student,
      cycle: { id: plan.cycle_id, name: 'รอบที่ 1 ปีการศึกษา 2569 (จำลอง)', academic_year: 2569 },
      company: plan.company_id ? { id: plan.company_id, name: plan.company_name } : null,
      position: plan.position_id ? { id: plan.position_id, title: plan.position_title } : null,
      created_at: plan.created_at, updated_at: plan.updated_at
    }));
    if (scenario === 'empty') rows = [];
    const query = (options.q || '').toLowerCase();
    rows = rows.filter((row) => {
      const owner = row.student || row;
      return (!query || `${owner.full_name} ${owner.preferred_name} ${owner.student_number}`.toLowerCase().includes(query)) &&
        (!options.academic_year || String(options.academic_year) === String(owner.academic_year)) &&
        (!options.status || options.status === row.status);
    });
    const total = rows.length, page = options.page || 1, pageSize = options.pageSize || 20;
    return copy({ items: rows.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  }
}
