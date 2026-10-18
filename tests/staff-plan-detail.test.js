/**
 * Tests for Issue #77: Staff review workspace read routes.
 * GET /api/v3/staff/plans/:planId and GET /api/v3/staff/plans/:planId/history
 */

const { createLambdaHandler } = require('../src/lambda');
const { attachRequestContext } = require('../src/api/context');
const { AuthorizationService } = require('../src/api/services/authorization-service');

const STAFF = Object.freeze({
  isAuthenticated: true,
  userId: '70000000-0000-4000-8000-000000000020',
  role: 'STAFF',
  accountStatus: 'ACTIVE'
});
const ADVISOR = Object.freeze({ ...STAFF, userId: '70000000-0000-4000-8000-000000000010', role: 'ADVISOR' });
const STUDENT = Object.freeze({
  ...STAFF,
  userId: '70000000-0000-4000-8000-000000000002',
  role: 'STUDENT',
  studentId: '40000000-0000-4000-8000-000000000102'
});

const PLAN_ID = '50000000-0000-4000-8000-000000000102';
const OUT_OF_SCOPE_PLAN_ID = '50000000-0000-4000-8000-000000000103';
const MISSING_PLAN_ID = '50000000-0000-4000-8000-0000000009ff';

const PLAN_ROW = Object.freeze({
  id: PLAN_ID,
  status: 'UNDER_REVIEW',
  version: 2,
  created_at: new Date('2026-10-02T10:00:00.000Z'),
  updated_at: new Date('2026-10-03T11:00:00.000Z'),
  cycle_id: '30000000-0000-4000-8000-000000000101',
  cycle_name: 'รอบที่ 1 ภาคเรียนที่ 1/2569',
  cycle_academic_year: 2569,
  cycle_semester: 1,
  cycle_status: 'OPEN',
  company_id: '10000000-0000-4000-8000-000000000002',
  company_name: 'Mock Analytics Lab',
  position_id: '20000000-0000-4000-8000-000000000003',
  position_title: 'นักวิเคราะห์ข้อมูล',
  student_id: '40000000-0000-4000-8000-000000000102',
  student_number: 'TEST000002',
  full_name: 'วิภา จำลอง',
  preferred_name: 'วิภา',
  department: 'CPE',
  program: 'ISNE',
  student_academic_year: 2569,
  notes: 'สนใจงานวิเคราะห์ข้อมูล',
  // Columns that must never reach the response (#50)
  institutional_email: 'wipha.j@student.example.com',
  user_id: '70000000-0000-4000-8000-000000000002'
});

const HISTORY_ROWS = Object.freeze([
  {
    event_id: '91000000-0000-4000-8000-000000000001',
    action: 'PLAN_SUBMITTED',
    from_state: 'DRAFT',
    to_state: 'SUBMITTED',
    actor_role: 'STUDENT',
    notes: null,
    created_at: new Date('2026-10-02T10:00:00.000Z'),
    actor_id: 'actor-must-not-leak'
  },
  {
    event_id: '91000000-0000-4000-8000-000000000002',
    action: 'PLAN_RETURNED',
    from_state: 'UNDER_REVIEW',
    to_state: 'NEEDS_REVISION',
    actor_role: 'STAFF',
    notes: 'กรุณาแนบหนังสือตอบรับ',
    created_at: new Date('2026-10-04T13:00:00.000Z'),
    operation_id: 'operation-must-not-leak'
  }
]);

function buildHandler({ actor = STAFF, planRow = PLAN_ROW } = {}) {
  const staffReviewRepository = { findScopedPlan: jest.fn(async () => planRow) };
  const planHistoryRepository = { listPlanHistory: jest.fn(async () => HISTORY_ROWS) };
  const authorizationService = new AuthorizationService({
    repository: {
      findPlanById: jest.fn(async (planId) => {
        if (planId === PLAN_ID) return { plan_id: PLAN_ID, student_id: PLAN_ROW.student_id, plan_status: 'UNDER_REVIEW' };
        if (planId === OUT_OF_SCOPE_PLAN_ID) return { plan_id: planId, student_id: '40000000-0000-4000-8000-000000000103', plan_status: 'SUBMITTED' };
        return null;
      }),
      findStaffScopeMatch: jest.fn(async ({ studentId }) =>
        studentId === PLAN_ROW.student_id
          ? {
            plan_id: PLAN_ID,
            user_role: 'STAFF',
            user_account_status: 'ACTIVE',
            scope_status: 'ACTIVE',
            scope_department: 'CPE',
            student_department: 'CPE',
            scope_program: null,
            scope_academic_year: null
          }
          : null),
      listActiveStaffScopes: jest.fn(async () => [{ department: 'CPE', program: null, academic_year: null }]),
      // Advisor policy path; never reached for /api/v3/staff/* because the route refuses first
      findAdvisorAssignmentMatch: jest.fn(async () => ({ assignment_id: 'a' })),
      findActiveAdvisorAssignment: jest.fn(async () => ({ assignment_id: 'a' }))
    }
  });
  const handler = createLambdaHandler({
    authOptions: {
      authMiddleware: async (request) => attachRequestContext(request, actor),
      authorizationService
    },
    staffReviewRepository,
    planHistoryRepository
  });
  return { handler, staffReviewRepository, planHistoryRepository, authorizationService };
}

const event = (path, method = 'GET', query = '') => ({
  rawPath: path,
  rawQueryString: query,
  headers: {},
  requestContext: { http: { method } }
});

describe('Issue #77: GET /api/v3/staff/plans/:planId', () => {
  it('returns one scoped Plan through the allowlist, including Plan notes (#50)', async () => {
    const { handler, staffReviewRepository } = buildHandler();
    const response = await handler(event(`/api/v3/staff/plans/${PLAN_ID}`));

    expect(response.statusCode).toBe(200);
    const { data } = JSON.parse(response.body);
    expect(data).toEqual({
      id: PLAN_ID,
      status: 'UNDER_REVIEW',
      version: 2,
      created_at: '2026-10-02T10:00:00.000Z',
      updated_at: '2026-10-03T11:00:00.000Z',
      cycle: { id: PLAN_ROW.cycle_id, name: PLAN_ROW.cycle_name, academic_year: 2569, semester: 1, status: 'OPEN' },
      company: { id: PLAN_ROW.company_id, name: 'Mock Analytics Lab' },
      position: { id: PLAN_ROW.position_id, title: 'นักวิเคราะห์ข้อมูล' },
      student: {
        id: PLAN_ROW.student_id,
        student_number: 'TEST000002',
        full_name: 'วิภา จำลอง',
        preferred_name: 'วิภา',
        department: 'CPE',
        program: 'ISNE',
        academic_year: 2569
      },
      notes: 'สนใจงานวิเคราะห์ข้อมูล'
    });
    expect(response.body).not.toContain('example.com');
    expect(staffReviewRepository.findScopedPlan).toHaveBeenCalledWith({ staffUserId: STAFF.userId, planId: PLAN_ID });
  });

  it.each([
    ['an out-of-scope Plan', OUT_OF_SCOPE_PLAN_ID, 403],
    ['a missing Plan', MISSING_PLAN_ID, 404],
    ['a malformed id', 'not-a-uuid', 400]
  ])('rejects %s before reading the Plan', async (_label, planId, status) => {
    const { handler, staffReviewRepository } = buildHandler();
    const response = await handler(event(`/api/v3/staff/plans/${planId}`));
    expect(response.statusCode).toBe(status);
    expect(staffReviewRepository.findScopedPlan).not.toHaveBeenCalled();
  });

  it('returns 403 when scope changed between the policy check and the read', async () => {
    const { handler } = buildHandler({ planRow: null });
    expect((await handler(event(`/api/v3/staff/plans/${PLAN_ID}`))).statusCode).toBe(403);
  });

  it.each([
    ['ADVISOR', ADVISOR],
    ['STUDENT', STUDENT]
  ])('refuses %s on the Staff path before the policy reads any record', async (_role, actor) => {
    const { handler, staffReviewRepository, planHistoryRepository, authorizationService } = buildHandler({ actor });
    for (const path of [`/api/v3/staff/plans/${PLAN_ID}`, `/api/v3/staff/plans/${PLAN_ID}/history`]) {
      expect((await handler(event(path))).statusCode).toBe(403);
    }
    expect(authorizationService.repository.findPlanById).not.toHaveBeenCalled();
    expect(staffReviewRepository.findScopedPlan).not.toHaveBeenCalled();
    expect(planHistoryRepository.listPlanHistory).not.toHaveBeenCalled();
  });

  it('rejects query parameters and non-GET methods', async () => {
    const { handler } = buildHandler();
    expect((await handler(event(`/api/v3/staff/plans/${PLAN_ID}`, 'GET', 'include=notes'))).statusCode).toBe(400);
    expect((await handler(event(`/api/v3/staff/plans/${PLAN_ID}`, 'PATCH'))).statusCode).toBe(405);
  });

  it('keeps the existing Plan search route intact', async () => {
    const { handler } = buildHandler();
    const response = await handler(event('/api/v3/staff/plans', 'GET', 'status=NOPE'));
    expect(response.statusCode).toBe(400);
  });
});

describe('Issue #77: GET /api/v3/staff/plans/:planId/history', () => {
  it('returns the history with review comments and without actor/operation ids', async () => {
    const { handler, planHistoryRepository } = buildHandler();
    const response = await handler(event(`/api/v3/staff/plans/${PLAN_ID}/history`));

    expect(response.statusCode).toBe(200);
    const { data } = JSON.parse(response.body);
    expect(data.map((entry) => entry.action)).toEqual(['PLAN_SUBMITTED', 'PLAN_RETURNED']);
    expect(data[1].review_notes).toBe('กรุณาแนบหนังสือตอบรับ');
    expect(response.body).not.toContain('must-not-leak');
    expect(planHistoryRepository.listPlanHistory).toHaveBeenCalledWith(PLAN_ID);
  });

  it.each([
    [OUT_OF_SCOPE_PLAN_ID, 403],
    [MISSING_PLAN_ID, 404]
  ])('rejects plan %s with %i before reading audit events', async (planId, status) => {
    const { handler, planHistoryRepository } = buildHandler();
    expect((await handler(event(`/api/v3/staff/plans/${planId}/history`))).statusCode).toBe(status);
    expect(planHistoryRepository.listPlanHistory).not.toHaveBeenCalled();
  });
});

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
(hasTestDb ? describe : describe.skip)('Issue #77: Staff Plan routes against seeded fixtures (PostgreSQL)', () => {
  const { seedV3 } = require('../src/db/seed');
  const { close } = require('../src/db/connection');

  const STAFF_EE = '70000000-0000-4000-8000-000000000021';
  const STAFF_CPE_2568 = '70000000-0000-4000-8000-000000000022';
  const actorFor = (userId) => ({ ...STAFF, userId });
  // Real policy and real SQL: only the trusted identity is injected
  const realHandler = (actor) => createLambdaHandler({
    authOptions: { authMiddleware: async (request) => attachRequestContext(request, actor) }
  });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DB_RESET = 'true';
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await seedV3();
    console.log.mockRestore();
  }, 60000);

  afterAll(async () => {
    await close();
  });

  it('serves a scoped Plan with notes and its fixture history', async () => {
    const handler = realHandler(STAFF);
    const detail = await handler(event(`/api/v3/staff/plans/${PLAN_ID}`));
    expect(detail.statusCode).toBe(200);
    const plan = JSON.parse(detail.body).data;
    expect(plan.student.student_number).toBe('TEST000002');
    expect(plan.status).toBe('UNDER_REVIEW');
    expect(plan).toHaveProperty('notes');

    // Plan 102 has no fixture events; plan 104 (TEST000004, CPE) was returned with a comment
    const emptyHistory = await handler(event(`/api/v3/staff/plans/${PLAN_ID}/history`));
    expect(emptyHistory.statusCode).toBe(200);
    expect(JSON.parse(emptyHistory.body).data).toEqual([]);

    const history = await handler(event('/api/v3/staff/plans/50000000-0000-4000-8000-000000000104/history'));
    expect(history.statusCode).toBe(200);
    const entries = JSON.parse(history.body).data;
    expect(entries.map((entry) => entry.action)).toEqual(['PLAN_RETURNED']);
    expect(entries[0].review_notes).toBeTruthy();
  });

  it.each([
    ['another department', STAFF_EE],
    ['a scope for another academic year', STAFF_CPE_2568]
  ])('denies Staff with %s', async (_label, userId) => {
    const handler = realHandler(actorFor(userId));
    expect((await handler(event(`/api/v3/staff/plans/${PLAN_ID}`))).statusCode).toBe(403);
    expect((await handler(event(`/api/v3/staff/plans/${PLAN_ID}/history`))).statusCode).toBe(403);
  });

  it('denies an assigned Advisor on the Staff path', async () => {
    const handler = realHandler(ADVISOR);
    expect((await handler(event(`/api/v3/staff/plans/${PLAN_ID}`))).statusCode).toBe(403);
  });
});
