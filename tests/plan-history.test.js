/**
 * Tests for GET /api/v3/plans/:planId/history (#76, audit:read_own_plan_history).
 */

const { createLambdaHandler } = require('../src/lambda');
const { attachRequestContext } = require('../src/api/context');
const { AuthorizationService } = require('../src/api/services/authorization-service');
const { toPlanHistoryEntry } = require('../src/api/routes/plan-history-routes');

const OWNER = Object.freeze({
  isAuthenticated: true,
  userId: '70000000-0000-4000-8000-000000000004',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  studentId: '40000000-0000-4000-8000-000000000104'
});
const PLAN_ID = '50000000-0000-4000-8000-000000000104';
const OTHER_PLAN_ID = '50000000-0000-4000-8000-000000000101';

const AUDIT_ROWS = Object.freeze([
  {
    event_id: '91000000-0000-4000-8000-000000000001',
    action: 'PLAN_SUBMITTED',
    from_state: 'DRAFT',
    to_state: 'SUBMITTED',
    actor_role: 'STUDENT',
    notes: 'student-side note that must stay private',
    created_at: new Date('2026-10-02T10:00:00.000Z'),
    actor_id: 'actor-must-not-leak',
    operation_id: 'operation-must-not-leak'
  },
  {
    event_id: '91000000-0000-4000-8000-000000000002',
    action: 'PLAN_RETURNED',
    from_state: 'UNDER_REVIEW',
    to_state: 'NEEDS_REVISION',
    actor_role: 'STAFF',
    notes: 'กรุณาแนบหนังสือตอบรับ',
    created_at: new Date('2026-10-04T13:00:00.000Z')
  }
]);

function buildHandler({ actor = OWNER, rows = AUDIT_ROWS } = {}) {
  const planHistoryRepository = { listPlanHistory: jest.fn(async () => rows) };
  const authorizationService = new AuthorizationService({
    repository: {
      findPlanById: jest.fn(async (planId) => {
        if (planId === PLAN_ID) return { plan_id: PLAN_ID, student_id: OWNER.studentId, plan_status: 'NEEDS_REVISION' };
        if (planId === OTHER_PLAN_ID) return { plan_id: OTHER_PLAN_ID, student_id: 'someone-else', plan_status: 'APPROVED' };
        return null;
      })
    }
  });
  const handler = createLambdaHandler({
    authOptions: {
      authMiddleware: async (request) => attachRequestContext(request, actor),
      authorizationService
    },
    planHistoryRepository
  });
  return { handler, planHistoryRepository };
}

const event = (path, method = 'GET', query = '') => ({
  rawPath: path,
  rawQueryString: query,
  headers: {},
  requestContext: { http: { method } }
});

describe('Issue #76: GET /api/v3/plans/:planId/history', () => {
  it('returns the owner history in chronological order through the response allowlist', async () => {
    const { handler, planHistoryRepository } = buildHandler();
    const response = await handler(event(`/api/v3/plans/${PLAN_ID}/history`));

    expect(response.statusCode).toBe(200);
    const { data } = JSON.parse(response.body);
    expect(data).toEqual([
      {
        event_id: AUDIT_ROWS[0].event_id,
        action: 'PLAN_SUBMITTED',
        from_state: 'DRAFT',
        to_state: 'SUBMITTED',
        actor_role: 'STUDENT',
        review_notes: null,
        created_at: '2026-10-02T10:00:00.000Z'
      },
      {
        event_id: AUDIT_ROWS[1].event_id,
        action: 'PLAN_RETURNED',
        from_state: 'UNDER_REVIEW',
        to_state: 'NEEDS_REVISION',
        actor_role: 'STAFF',
        review_notes: 'กรุณาแนบหนังสือตอบรับ',
        created_at: '2026-10-04T13:00:00.000Z'
      }
    ]);
    expect(response.body).not.toContain('must-not-leak');
    expect(response.body).not.toContain('student-side note');
    expect(planHistoryRepository.listPlanHistory).toHaveBeenCalledWith(PLAN_ID);
  });

  it('exposes review comments only for PLAN_RETURNED and PLAN_APPROVED (#50)', () => {
    expect(toPlanHistoryEntry({ ...AUDIT_ROWS[1], action: 'PLAN_APPROVED' }).review_notes).toBe('กรุณาแนบหนังสือตอบรับ');
    expect(toPlanHistoryEntry({ ...AUDIT_ROWS[1], action: 'PLAN_DRAFT_UPDATED' }).review_notes).toBeNull();
  });

  it.each([
    ['another Student Plan', OTHER_PLAN_ID, 403],
    ['a missing Plan', '50000000-0000-4000-8000-0000000009ff', 404],
    ['a malformed id', 'not-a-uuid', 400]
  ])('rejects %s before reading audit events', async (_label, planId, status) => {
    const { handler, planHistoryRepository } = buildHandler();
    const response = await handler(event(`/api/v3/plans/${planId}/history`));
    expect(response.statusCode).toBe(status);
    expect(planHistoryRepository.listPlanHistory).not.toHaveBeenCalled();
  });

  it.each([
    ['ADVISOR', { ...OWNER, role: 'ADVISOR', studentId: null }],
    ['STAFF', { ...OWNER, role: 'STAFF', studentId: null }]
  ])('denies %s (Student-owner endpoint; Advisor/Staff history belongs to #75/#77)', async (_role, actor) => {
    const { handler, planHistoryRepository } = buildHandler({ actor });
    const response = await handler(event(`/api/v3/plans/${PLAN_ID}/history`));
    expect(response.statusCode).toBe(403);
    expect(planHistoryRepository.listPlanHistory).not.toHaveBeenCalled();
  });

  it('rejects query parameters and non-GET methods', async () => {
    const { handler } = buildHandler();
    expect((await handler(event(`/api/v3/plans/${PLAN_ID}/history`, 'GET', 'limit=5'))).statusCode).toBe(400);
    expect((await handler(event(`/api/v3/plans/${PLAN_ID}/history`, 'POST'))).statusCode).toBe(405);
  });

  const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
  (hasTestDb ? describe : describe.skip)('against seeded fixtures (PostgreSQL)', () => {
    const { seedV3 } = require('../src/db/seed');
    const { close } = require('../src/db/connection');
    const { PlanHistoryRepository } = require('../src/db/repositories/plan-history-repository');

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

    it('reads the fixture history of plan 104 with runtime action names', async () => {
      const rows = await new PlanHistoryRepository().listPlanHistory(PLAN_ID);
      expect(rows.map((row) => row.action)).toEqual(['PLAN_RETURNED']);
      expect(toPlanHistoryEntry(rows[0]).review_notes).toBeTruthy();
    });
  });
});
