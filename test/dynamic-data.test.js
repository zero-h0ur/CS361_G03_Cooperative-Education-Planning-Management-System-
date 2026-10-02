import test from 'node:test';
import assert from 'node:assert/strict';

import {
  store,
  queryStudents,
  getStudentById,
  queryCompanies,
  getCompanyById,
  queryPositions,
  getPositionById,
  queryCycles,
  getActiveCycle,
  getCycleById,
  queryPlans,
  getPlanById,
  createPlan,
  updatePlanStatus,
  getSystemSummary
} from '../services/dynamic-data-service.js';

test.beforeEach(() => {
  store.reset();
});

test('queryStudents filters by eligibility status and searches by student name/ID', () => {
  const eligibleStudents = queryStudents({ eligibility: 'eligible', pageSize: 50 });
  assert.ok(eligibleStudents.items.length > 0);
  assert.ok(eligibleStudents.items.every((s) => s.eligibilityStatus === 'eligible'));

  const searchById = queryStudents({ query: '6609650012' });
  assert.equal(searchById.items.length, 1);
  assert.equal(searchById.items[0].name, 'ชานนท์ วงศ์สวัสดิ์');

  const searchByName = queryStudents({ query: 'ณัฐธิดา' });
  assert.equal(searchByName.items.length, 1);
  assert.equal(searchByName.items[0].id, '6609650046');

  const conditional = queryStudents({ eligibility: 'conditional' });
  assert.ok(conditional.items.length >= 2);
  assert.ok(conditional.items.every((s) => s.eligibilityStatus === 'conditional'));
});

test('queryStudents filters by year and sorts correctly', () => {
  const year4 = queryStudents({ year: '4' });
  assert.ok(year4.items.length >= 2);
  assert.ok(year4.items.every((s) => s.year === 4));

  const sortedByGpax = queryStudents({ sortBy: 'gpax', sortOrder: 'desc', pageSize: 5 });
  assert.ok(sortedByGpax.items[0].gpax >= sortedByGpax.items[1].gpax);
});

test('getStudentById returns student with current plan details', () => {
  const student = getStudentById('6609650012');
  assert.ok(student);
  assert.equal(student.id, '6609650012');
  assert.ok(student.currentPlan);
  assert.equal(student.currentPlan.id, 'plan-2567-001');

  const notFound = getStudentById('9999999999');
  assert.equal(notFound, null);
});

test('queryCompanies filters by MOU and searches by keyword', () => {
  const mouCompanies = queryCompanies({ hasMOU: 'true', pageSize: 50 });
  assert.ok(mouCompanies.items.length > 0);
  assert.ok(mouCompanies.items.every((c) => c.coopMOU === true));

  const searchCloud = queryCompanies({ query: 'cloud' });
  assert.ok(searchCloud.items.length > 0);
});

test('getCompanyById returns company with positions and plans', () => {
  const company = getCompanyById('agoda');
  assert.ok(company);
  assert.equal(company.name, 'Agoda');
  assert.ok(Array.isArray(company.positions));
  assert.ok(company.positions.length >= 1);
  assert.ok(Array.isArray(company.plans));
});

test('queryPositions filters by field, work mode, and company', () => {
  const softwarePositions = queryPositions({ field: 'Software Engineering' });
  assert.ok(softwarePositions.items.length >= 2);
  assert.ok(softwarePositions.items.every((p) => p.field === 'Software Engineering'));

  const hybridPositions = queryPositions({ workMode: 'Hybrid' });
  assert.ok(hybridPositions.items.length > 0);
  assert.ok(hybridPositions.items.every((p) => p.workMode === 'Hybrid'));

  const kbtgPositions = queryPositions({ companyId: 'kbtg' });
  assert.ok(kbtgPositions.items.length >= 2);
  assert.ok(kbtgPositions.items.every((p) => p.companyId === 'kbtg'));
});

test('queryCycles, getActiveCycle, and getCycleById return structured cycles', () => {
  const allCycles = queryCycles();
  assert.ok(allCycles.items.length >= 3);

  const active = getActiveCycle();
  assert.ok(active);
  assert.equal(active.status, 'active');
  assert.ok(Array.isArray(active.milestones));
  assert.ok(active.milestones.length >= 5);

  const detail = getCycleById(active.id);
  assert.equal(detail.id, active.id);
});

test('queryPlans filters by status and searches by topic', () => {
  const approvedPlans = queryPlans({ status: 'approved' });
  assert.ok(approvedPlans.items.length >= 3);
  assert.ok(approvedPlans.items.every((p) => p.status === 'approved'));

  const searchCache = queryPlans({ query: 'Caching' });
  assert.equal(searchCache.items.length, 1);
  assert.equal(searchCache.items[0].id, 'plan-2567-001');
});

test('getPlanById resolves student, company, position, and cycle details', () => {
  const plan = getPlanById('plan-2567-001');
  assert.ok(plan);
  assert.ok(plan.student);
  assert.equal(plan.student.id, '6609650012');
  assert.ok(plan.company);
  assert.equal(plan.company.id, 'agoda');
  assert.ok(plan.position);
  assert.ok(plan.cycle);
});

test('createPlan validates inputs and persists new plan', () => {
  // Test missing fields
  assert.throws(
    () => createPlan({ studentId: '6609650224' }),
    /จำเป็นต้องระบุข้อมูล/
  );

  // Test ineligible student rejection
  assert.throws(
    () =>
      createPlan({
        studentId: '6609650311', // Ineligible student
        cycleId: 'cycle-2567-2',
        companyId: 'agoda',
        positionId: 'pos-agoda-01',
        proposedTopic: 'Game Dev Project',
        objective: 'Objective test'
      }),
    /ไม่ผ่านเกณฑ์คุณสมบัติสหกิจ/
  );

  // Test duplicate plan rejection
  assert.throws(
    () =>
      createPlan({
        studentId: '6609650012', // Already has plan-2567-001
        cycleId: 'cycle-2567-2',
        companyId: 'agoda',
        positionId: 'pos-agoda-01',
        proposedTopic: 'Duplicate Project',
        objective: 'Objective test'
      }),
    /ได้ยื่นแผนในรอบนี้ไปแล้ว/
  );

  // Successful submission with an eligible student who has no current plan
  const newPlan = createPlan({
    studentId: '6609650224', // Waranya (Eligible, currentPlanId: null)
    cycleId: 'cycle-2567-2',
    companyId: 'cp-all',
    positionId: 'pos-cpall-01',
    proposedTopic: 'ระบบ Real-time Streaming Analytics สำหรับตรวจสอบยอดขายสินค้าโปรโมชั่น',
    objective: '1. เพื่อพัฒนา Streaming Pipeline ด้วย Kafka และ Spark\n2. เพื่อแสดงผลสรุปยอดขายแบบ Real-time บน Dashboard'
  });

  assert.ok(newPlan.id.startsWith('plan-2567-'));
  assert.equal(newPlan.status, 'pending');
  assert.equal(newPlan.studentId, '6609650224');
  assert.equal(newPlan.companyName, 'CP ALL');

  // Verify it appears in store and queries
  const queried = queryPlans({ query: 'Streaming Analytics' });
  assert.equal(queried.items.length, 1);
  assert.equal(queried.items[0].id, newPlan.id);

  // Verify student was linked
  const student = getStudentById('6609650224');
  assert.equal(student.currentPlanId, newPlan.id);
});

test('updatePlanStatus updates status, review notes, and advisor', () => {
  const updated = updatePlanStatus('plan-2567-004', {
    status: 'approved',
    reviewNotes: 'คณะกรรมการพิจารณาอนุมัติเรียบร้อย',
    facultyAdvisor: 'รศ.ดร.สมชาย ทรงคุณ'
  });

  assert.equal(updated.status, 'approved');
  assert.equal(updated.statusLabel, 'ผ่านการอนุมัติ');
  assert.equal(updated.reviewNotes, 'คณะกรรมการพิจารณาอนุมัติเรียบร้อย');
  assert.equal(updated.facultyAdvisor, 'รศ.ดร.สมชาย ทรงคุณ');
});

test('getSystemSummary computes metrics across all 5 dynamic entities', () => {
  const summary = getSystemSummary();

  assert.ok(summary.students.total >= 10);
  assert.ok(summary.students.eligible > 0);
  assert.ok(summary.students.eligibilityRate > 0);

  assert.ok(summary.companies.total >= 12);
  assert.ok(summary.companies.mouCount > 0);

  assert.ok(summary.positions.total >= 10);
  assert.ok(summary.positions.totalSlots > 0);
  assert.ok(summary.positions.fieldBreakdown['Software Engineering'] > 0);

  assert.ok(summary.plans.total >= 5);
  assert.ok(summary.plans.approved > 0);

  assert.ok(summary.activeCycle);
  assert.equal(summary.activeCycle.status, 'active');
});
