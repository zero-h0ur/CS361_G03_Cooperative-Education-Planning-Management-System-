import { students as initialStudents } from '../data/students.js';
import { companies as initialCompanies } from '../data/companies.js';
import { positions as initialPositions } from '../data/positions.js';
import { cycles as initialCycles } from '../data/cycles.js';
import { initialPlans } from '../data/plans.js';

// In-memory systematically managed store
class DynamicDataStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.students = JSON.parse(JSON.stringify(initialStudents));
    this.companies = JSON.parse(JSON.stringify(initialCompanies));
    this.positions = JSON.parse(JSON.stringify(initialPositions));
    this.cycles = JSON.parse(JSON.stringify(initialCycles));
    this.plans = JSON.parse(JSON.stringify(initialPlans));
  }
}

export const store = new DynamicDataStore();

// Utility string normalizer
export function normalizeText(value = '') {
  return String(value ?? '').trim().toLocaleLowerCase('th');
}

export function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function paginate(items, page = 1, pageSize = 10) {
  const safePageSize = Math.max(1, Math.min(parsePositiveInt(pageSize, 10), 100));
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / safePageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(parsePositiveInt(page, 1), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const pagedItems = items.slice(startIndex, startIndex + safePageSize);

  return {
    items: pagedItems,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1
    }
  };
}

// -------------------------------------------------------------
// 1. STUDENTS SERVICE
// -------------------------------------------------------------
export function queryStudents({
  query = '',
  eligibility = 'all',
  year = 'all',
  curriculum = 'all',
  major = 'all',
  page = 1,
  pageSize = 10,
  sortBy = 'name',
  sortOrder = 'asc'
} = {}) {
  const q = normalizeText(query);
  const eligibilityFilter = String(eligibility).toLowerCase();
  const yearFilter = String(year);
  const curriculumFilter = normalizeText(curriculum);
  const majorFilter = normalizeText(major);

  let filtered = store.students.filter((student) => {
    if (eligibilityFilter !== 'all' && student.eligibilityStatus !== eligibilityFilter) {
      return false;
    }
    if (yearFilter !== 'all' && String(student.year) !== yearFilter) {
      return false;
    }
    if (curriculumFilter !== 'all' && !normalizeText(student.curriculum).includes(curriculumFilter)) {
      return false;
    }
    if (majorFilter !== 'all' && !normalizeText(student.major).includes(majorFilter)) {
      return false;
    }
    if (q) {
      const searchHaystack = [
        student.id,
        student.name,
        student.nameEn,
        student.major,
        student.curriculum,
        student.eligibilityReason,
        ...(student.skills ?? []),
        ...(student.interests ?? [])
      ].join(' ').toLocaleLowerCase('th');

      if (!searchHaystack.includes(q)) return false;
    }
    return true;
  });

  // Sorting
  filtered.sort((a, b) => {
    let comp = 0;
    if (sortBy === 'gpax') {
      comp = (a.gpax ?? 0) - (b.gpax ?? 0);
    } else if (sortBy === 'creditsCompleted') {
      comp = (a.creditsCompleted ?? 0) - (b.creditsCompleted ?? 0);
    } else if (sortBy === 'id') {
      comp = a.id.localeCompare(b.id);
    } else {
      comp = a.name.localeCompare(b.name, 'th');
    }
    return sortOrder === 'desc' ? -comp : comp;
  });

  return paginate(filtered, page, pageSize);
}

export function getStudentById(id) {
  const student = store.students.find((s) => s.id === id);
  if (!student) return null;

  const currentPlan = student.currentPlanId
    ? store.plans.find((p) => p.id === student.currentPlanId)
    : null;

  return { ...student, currentPlan };
}

// -------------------------------------------------------------
// 2. COMPANIES SERVICE
// -------------------------------------------------------------
export function queryCompanies({
  query = '',
  category = 'all',
  location = 'all',
  hasMOU = 'all',
  page = 1,
  pageSize = 10,
  sortBy = 'name',
  sortOrder = 'asc'
} = {}) {
  const q = normalizeText(query);
  const catFilter = normalizeText(category);
  const locFilter = normalizeText(location);

  let filtered = store.companies.filter((company) => {
    if (catFilter !== 'all' && !normalizeText(company.category).includes(catFilter)) {
      return false;
    }
    if (locFilter !== 'all' && !normalizeText(company.location).includes(locFilter)) {
      return false;
    }
    if (hasMOU !== 'all') {
      const wantMOU = String(hasMOU) === 'true';
      if (Boolean(company.coopMOU) !== wantMOU) return false;
    }
    if (q) {
      const searchHaystack = [
        company.name,
        company.nameEn,
        company.category,
        company.location,
        company.address,
        company.position,
        company.benefit,
        ...(company.keywords ?? [])
      ].join(' ').toLocaleLowerCase('th');

      if (!searchHaystack.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let comp = 0;
    if (sortBy === 'rating') {
      comp = (a.rating ?? 0) - (b.rating ?? 0);
    } else {
      comp = a.name.localeCompare(b.name, 'th');
    }
    return sortOrder === 'desc' ? -comp : comp;
  });

  return paginate(filtered, page, pageSize);
}

export function getCompanyById(id) {
  const company = store.companies.find((c) => c.id === id);
  if (!company) return null;

  const companyPositions = store.positions.filter((p) => p.companyId === id);
  const companyPlans = store.plans.filter((p) => p.companyId === id);

  return {
    ...company,
    positions: companyPositions,
    plans: companyPlans
  };
}

// -------------------------------------------------------------
// 3. POSITIONS / PROJECTS SERVICE
// -------------------------------------------------------------
export function queryPositions({
  query = '',
  field = 'all',
  workMode = 'all',
  companyId = 'all',
  status = 'all',
  minStipend = 0,
  page = 1,
  pageSize = 10,
  sortBy = 'title',
  sortOrder = 'asc'
} = {}) {
  const q = normalizeText(query);
  const fieldFilter = normalizeText(field);
  const modeFilter = normalizeText(workMode);
  const compIdFilter = String(companyId);
  const statusFilter = String(status).toLowerCase();
  const stipendThreshold = Number(minStipend) || 0;

  let filtered = store.positions.filter((pos) => {
    if (fieldFilter !== 'all' && !normalizeText(pos.field).includes(fieldFilter)) {
      return false;
    }
    if (modeFilter !== 'all' && !normalizeText(pos.workMode).includes(modeFilter)) {
      return false;
    }
    if (compIdFilter !== 'all' && pos.companyId !== compIdFilter) {
      return false;
    }
    if (statusFilter !== 'all' && pos.status !== statusFilter) {
      return false;
    }
    if (stipendThreshold > 0 && (pos.stipendAmount ?? 0) < stipendThreshold) {
      return false;
    }
    if (q) {
      const searchHaystack = [
        pos.title,
        pos.companyName,
        pos.field,
        pos.description,
        pos.projectScope,
        pos.location,
        pos.stipend,
        ...(pos.requiredSkills ?? [])
      ].join(' ').toLocaleLowerCase('th');

      if (!searchHaystack.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let comp = 0;
    if (sortBy === 'stipend') {
      comp = (a.stipendAmount ?? 0) - (b.stipendAmount ?? 0);
    } else if (sortBy === 'capacity') {
      comp = (a.capacity ?? 0) - (b.capacity ?? 0);
    } else {
      comp = a.title.localeCompare(b.title, 'th');
    }
    return sortOrder === 'desc' ? -comp : comp;
  });

  return paginate(filtered, page, pageSize);
}

export function getPositionById(id) {
  const position = store.positions.find((p) => p.id === id);
  if (!position) return null;

  const company = store.companies.find((c) => c.id === position.companyId);
  return { ...position, company };
}

// -------------------------------------------------------------
// 4. CYCLES / COHORTS SERVICE
// -------------------------------------------------------------
export function queryCycles({
  status = 'all',
  academicYear = 'all',
  page = 1,
  pageSize = 10
} = {}) {
  const statusFilter = String(status).toLowerCase();
  const yearFilter = String(academicYear);

  const filtered = store.cycles.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (yearFilter !== 'all' && String(c.academicYear) !== yearFilter) return false;
    return true;
  });

  return paginate(filtered, page, pageSize);
}

export function getActiveCycle() {
  return store.cycles.find((c) => c.status === 'active') ?? store.cycles[0];
}

export function getCycleById(id) {
  return store.cycles.find((c) => c.id === id) ?? null;
}

// -------------------------------------------------------------
// 5. CO-OP PLANS SERVICE (QUERY, CREATE, UPDATE)
// -------------------------------------------------------------
export function queryPlans({
  query = '',
  status = 'all',
  cycleId = 'all',
  companyId = 'all',
  studentId = 'all',
  page = 1,
  pageSize = 10,
  sortBy = 'submittedAt',
  sortOrder = 'desc'
} = {}) {
  const q = normalizeText(query);
  const statusFilter = String(status).toLowerCase();
  const cycleFilter = String(cycleId);
  const companyFilter = String(companyId);
  const studentFilter = String(studentId);

  let filtered = store.plans.filter((plan) => {
    if (statusFilter !== 'all' && plan.status !== statusFilter) return false;
    if (cycleFilter !== 'all' && plan.cycleId !== cycleFilter) return false;
    if (companyFilter !== 'all' && plan.companyId !== companyFilter) return false;
    if (studentFilter !== 'all' && plan.studentId !== studentFilter) return false;

    if (q) {
      const searchHaystack = [
        plan.id,
        plan.studentId,
        plan.studentName,
        plan.companyName,
        plan.positionTitle,
        plan.proposedTopic,
        plan.objective,
        plan.facultyAdvisor,
        plan.companyMentor,
        plan.statusLabel
      ].join(' ').toLocaleLowerCase('th');

      if (!searchHaystack.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let comp = 0;
    if (sortBy === 'studentName') {
      comp = a.studentName.localeCompare(b.studentName, 'th');
    } else if (sortBy === 'status') {
      comp = a.status.localeCompare(b.status);
    } else {
      // Default: submittedAt
      comp = new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    }
    return sortOrder === 'desc' ? -comp : comp;
  });

  return paginate(filtered, page, pageSize);
}

export function getPlanById(id) {
  const plan = store.plans.find((p) => p.id === id);
  if (!plan) return null;

  const student = store.students.find((s) => s.id === plan.studentId);
  const company = store.companies.find((c) => c.id === plan.companyId);
  const position = store.positions.find((p) => p.id === plan.positionId);
  const cycle = store.cycles.find((c) => c.id === plan.cycleId);

  return {
    ...plan,
    student,
    company,
    position,
    cycle
  };
}

export function createPlan(data) {
  const {
    studentId,
    cycleId,
    companyId,
    positionId,
    proposedTopic,
    objective,
    facultyAdvisor = 'อาจารย์ที่ปรึกษาสหกิจประจำสาขาวิชา',
    companyMentor = 'พนักงานพี่เลี้ยง ณ สถานประกอบการ'
  } = data ?? {};

  // Validation
  if (!studentId || !cycleId || !companyId || !positionId) {
    throw new Error('จำเป็นต้องระบุข้อมูล studentId, cycleId, companyId และ positionId ให้ครบถ้วน');
  }

  if (!proposedTopic || !proposedTopic.trim()) {
    throw new Error('โปรดระบุหัวข้อโครงงานสหกิจศึกษาที่เสนอ');
  }

  if (!objective || !objective.trim()) {
    throw new Error('โปรดระบุวัตถุประสงค์และขอบเขตงานโครงงานสหกิจ');
  }

  const student = store.students.find((s) => s.id === studentId);
  if (!student) {
    throw new Error(`ไม่พบข้อมูลนักศึกษารหัส ${studentId}`);
  }

  if (student.eligibilityStatus === 'ineligible') {
    throw new Error(`นักศึกษารหัส ${studentId} ไม่ผ่านเกณฑ์คุณสมบัติสหกิจ: ${student.eligibilityReason}`);
  }

  // Check if student already has active or approved plan in this cycle
  const existingPlan = store.plans.find(
    (p) => p.studentId === studentId && p.cycleId === cycleId && p.status !== 'rejected'
  );
  if (existingPlan) {
    throw new Error(`นักศึกษารหัส ${studentId} ได้ยื่นแผนในรอบนี้ไปแล้ว (รหัสแผน: ${existingPlan.id}, สถานะ: ${existingPlan.statusLabel})`);
  }

  const cycle = store.cycles.find((c) => c.id === cycleId);
  if (!cycle) {
    throw new Error(`ไม่พบข้อมูลรอบสหกิจรหัส ${cycleId}`);
  }

  const company = store.companies.find((c) => c.id === companyId);
  if (!company) {
    throw new Error(`ไม่พบข้อมูลสถานประกอบการรหัส ${companyId}`);
  }

  const position = store.positions.find((p) => p.id === positionId);
  if (!position) {
    throw new Error(`ไม่พบข้อมูลตำแหน่งงานรหัส ${positionId}`);
  }

  const yearSeq = String(store.plans.length + 1).padStart(3, '0');
  const planId = `plan-2567-${yearSeq}`;
  const now = new Date().toISOString();

  const newPlan = {
    id: planId,
    studentId,
    studentName: student.name,
    studentMajor: student.major,
    studentGpax: student.gpax,
    cycleId,
    cycleTitle: cycle.title,
    companyId,
    companyName: company.name,
    positionId,
    positionTitle: position.title,
    proposedTopic: proposedTopic.trim(),
    objective: objective.trim(),
    facultyAdvisor,
    companyMentor,
    status: 'pending',
    statusLabel: 'รอการพิจารณา',
    submittedAt: now,
    updatedAt: now,
    reviewNotes: 'ระบบได้รับแผนสหกิจศึกษาเรียบร้อย อยู่ระหว่างรอการตรวจสอบโดยคณะกรรมการ',
    deliverables: [
      'รายงานโครงงานฉบับสมบูรณ์',
      'ผลงานที่พัฒนาจริง ณ สถานประกอบการ',
      'แบบประเมินผลการปฏิบัติงาน'
    ]
  };

  store.plans.unshift(newPlan);
  student.currentPlanId = planId;

  // Increment position applied count
  if (typeof position.appliedCount === 'number') {
    position.appliedCount += 1;
  }

  return newPlan;
}

export function updatePlanStatus(planId, { status, reviewNotes, facultyAdvisor }) {
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) {
    throw new Error(`ไม่พบแผนสหกิจรหัส ${planId}`);
  }

  const validStatuses = new Map([
    ['approved', 'ผ่านการอนุมัติ'],
    ['pending', 'รอการพิจารณา'],
    ['needs_revision', 'ส่งกลับแก้ไข'],
    ['in_progress', 'กำลังปฏิบัติงาน'],
    ['completed', 'เสร็จสิ้น'],
    ['rejected', 'ไม่อนุมัติ']
  ]);

  if (status) {
    if (!validStatuses.has(status)) {
      throw new Error(`สถานะไม่ถูกต้อง: ${status}`);
    }
    plan.status = status;
    plan.statusLabel = validStatuses.get(status);
  }

  if (reviewNotes !== undefined) {
    plan.reviewNotes = String(reviewNotes);
  }

  if (facultyAdvisor) {
    plan.facultyAdvisor = String(facultyAdvisor);
  }

  plan.updatedAt = new Date().toISOString();
  return plan;
}

// -------------------------------------------------------------
// 6. SYSTEM DASHBOARD SUMMARY METRICS
// -------------------------------------------------------------
export function getSystemSummary() {
  const activeCycle = getActiveCycle();

  // Student metrics
  const totalStudents = store.students.length;
  const eligibleStudents = store.students.filter((s) => s.eligibilityStatus === 'eligible').length;
  const conditionalStudents = store.students.filter((s) => s.eligibilityStatus === 'conditional').length;
  const ineligibleStudents = store.students.filter((s) => s.eligibilityStatus === 'ineligible').length;

  // Company metrics
  const totalCompanies = store.companies.length;
  const mouCompanies = store.companies.filter((c) => Boolean(c.coopMOU)).length;

  // Position metrics
  const totalPositions = store.positions.length;
  const totalSlots = store.positions.reduce((acc, p) => acc + (p.capacity ?? 0), 0);
  const openPositions = store.positions.filter((p) => p.status === 'open').length;

  // Field breakdown
  const fieldCounts = {};
  store.positions.forEach((p) => {
    fieldCounts[p.field] = (fieldCounts[p.field] || 0) + 1;
  });

  // Plans metrics
  const totalPlans = store.plans.length;
  const approvedPlans = store.plans.filter((p) => p.status === 'approved').length;
  const pendingPlans = store.plans.filter((p) => p.status === 'pending').length;
  const revisionPlans = store.plans.filter((p) => p.status === 'needs_revision').length;

  return {
    students: {
      total: totalStudents,
      eligible: eligibleStudents,
      conditional: conditionalStudents,
      ineligible: ineligibleStudents,
      eligibilityRate: totalStudents > 0 ? Math.round((eligibleStudents / totalStudents) * 100) : 0
    },
    companies: {
      total: totalCompanies,
      mouCount: mouCompanies,
      regularCount: totalCompanies - mouCompanies
    },
    positions: {
      total: totalPositions,
      totalSlots,
      openCount: openPositions,
      fieldBreakdown: fieldCounts
    },
    plans: {
      total: totalPlans,
      approved: approvedPlans,
      pending: pendingPlans,
      needsRevision: revisionPlans,
      approvalRate: totalPlans > 0 ? Math.round((approvedPlans / totalPlans) * 100) : 0
    },
    activeCycle: {
      id: activeCycle?.id,
      title: activeCycle?.title,
      applicationDeadline: activeCycle?.applicationDeadline,
      status: activeCycle?.status,
      milestonesCount: activeCycle?.milestones?.length ?? 0
    }
  };
}
