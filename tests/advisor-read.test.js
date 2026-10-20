const { Router } = require('../src/api/router');
const { createLambdaHandler } = require('../src/lambda');
const { TokenValidator } = require('../src/auth/token-validator');
const { IdentityResolver } = require('../src/auth/identity-resolver');
const { attachRequestContext } = require('../src/api/context');
const { registerProtectedRoute } = require('../src/api/routes/v3-routes');
const {
  registerAdvisorReadRoutes
} = require('../src/api/routes/advisor-read-routes');
const {
  AdvisorReadService
} = require('../src/api/services/advisor-read-service');
const {
  ADVISOR_STUDENT_FIELDS,
  ADVISOR_PLAN_SUMMARY_FIELDS,
  ADVISOR_PLAN_DETAIL_FIELDS,
  toAdvisorStudent,
  toAdvisorPlanSummary,
  toAdvisorPlanDetail
} = require('../src/api/services/advisor-read-serializers');
const {
  ACTIONS,
  AuthorizationService
} = require('../src/api/services/authorization-service');
const {
  AdvisorReadRepository
} = require('../src/db/repositories/advisor-read-repository');

const NOW = new Date('2026-10-18T08:00:00.000Z');
const ADVISOR_ID = '70000000-0000-4000-8000-000000000010';
const STUDENT_ID = '40000000-0000-4000-8000-000000000101';
const PLAN_ID = '50000000-0000-4000-8000-000000000101';
const CYCLE_ID = '30000000-0000-4000-8000-000000000101';

const ADVISOR_CONTEXT = Object.freeze({
  isAuthenticated: true,
  userId: ADVISOR_ID,
  role: 'ADVISOR',
  accountStatus: 'ACTIVE'
});

const STUDENT_ROW = Object.freeze({
  id: STUDENT_ID,
  student_number: 'TEST000001',
  full_name: 'Assigned Student',
  preferred_name: 'Assigned',
  institutional_email: 'private@student.example.com',
  department: 'CPE',
  program: 'CPE',
  major: 'Computer Engineering',
  academic_year: 2569,
  enrollment_status: 'ACTIVE',
  user_id: '70000000-0000-4000-8000-000000000001',
  source: 'PROTECTED_SOURCE',
  private_note: 'must not leak'
});

const PLAN_ROW = Object.freeze({
  id: PLAN_ID,
  student_id: STUDENT_ID,
  cycle_id: CYCLE_ID,
  company_id: '10000000-0000-4000-8000-000000000001',
  company_name: 'Public Company',
  position_id: '20000000-0000-4000-8000-000000000001',
  position_title: 'Software Engineer',
  status: 'CANCELLED',
  notes: 'Historical student note',
  review_notes: 'private staff comment',
  version: 2,
  created_at: new Date('2025-01-01T00:00:00.000Z'),
  updated_at: new Date('2025-02-01T00:00:00.000Z'),
  source: 'PROTECTED_SOURCE',
  operation_id: 'private-operation'
});

function createResponse() {
  let statusCode = 200;
  let headers = {};
  let body = '';
  return {
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      headers = { ...headers, ...nextHeaders };
    },
    end(value = '') {
      body = String(value);
      this.writableEnded = true;
    },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body ? JSON.parse(body) : null; },
    writableEnded: false
  };
}

function allowAdvisorAuthorization() {
  return {
    authorize: jest.fn(async (context, action, resource) => ({
      authorized: true,
      role: context.role,
      action,
      studentId: resource.studentId || null,
      planId: resource.planId || null
    }))
  };
}

function buildRouter(repository, authorizationService = allowAdvisorAuthorization()) {
  const router = new Router();
  registerAdvisorReadRoutes(router, registerProtectedRoute, {
    now: () => NOW,
    authOptions: { authorizationService },
    advisorReadRepository: repository
  });
  return { router, authorizationService };
}

async function request(router, method, url, context = ADVISOR_CONTEXT) {
  const req = { method, url, headers: {} };
  attachRequestContext(req, context);
  const res = createResponse();
  await router.handle(req, res);
  return res;
}

describe('Issue #68 Advisor assigned-scope read-only API', () => {
  describe('privacy serializers', () => {
    test('Student response contains only the explicit Advisor allowlist', () => {
      const output = toAdvisorStudent(STUDENT_ROW);
      expect(Object.keys(output)).toEqual(ADVISOR_STUDENT_FIELDS);
      expect(output).not.toHaveProperty('institutional_email');
      expect(output).not.toHaveProperty('user_id');
      expect(output).not.toHaveProperty('source');
      expect(output).not.toHaveProperty('private_note');
    });

    test('Plan summary and detail expose public selections without internal ownership/audit fields', () => {
      const summary = toAdvisorPlanSummary(PLAN_ROW);
      const detail = toAdvisorPlanDetail(PLAN_ROW);

      expect(Object.keys(summary)).toEqual(ADVISOR_PLAN_SUMMARY_FIELDS);
      expect(Object.keys(detail)).toEqual(ADVISOR_PLAN_DETAIL_FIELDS);
      expect(detail.company).toEqual({
        id: PLAN_ROW.company_id,
        name: PLAN_ROW.company_name
      });
      expect(detail.position).toEqual({
        id: PLAN_ROW.position_id,
        title: PLAN_ROW.position_title
      });
      for (const protectedField of [
        'student_id',
        'review_notes',
        'source',
        'operation_id'
      ]) {
        expect(detail).not.toHaveProperty(protectedField);
      }
    });
  });

  describe('service scope, history, and validation', () => {
    test('returns only assigned Students with scoped pagination totals', async () => {
      const repository = {
        listAssignedStudents: jest.fn().mockResolvedValue({
          rows: [STUDENT_ROW],
          total: 1
        })
      };
      const service = new AdvisorReadService({ repository, now: () => NOW });

      const result = await service.listStudents(
        ADVISOR_CONTEXT,
        { page: '1', pageSize: '10' },
        NOW
      );

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1
      });
      expect(repository.listAssignedStudents).toHaveBeenCalledWith({
        advisorUserId: ADVISOR_ID,
        timestampIso: NOW.toISOString(),
        limit: 10,
        offset: 0
      });
    });

    test('returns historical and CANCELLED Plans while the current Student assignment is active', async () => {
      const repository = {
        listAssignedStudentPlans: jest.fn().mockResolvedValue({
          rows: [PLAN_ROW, { ...PLAN_ROW, id: '50000000-0000-4000-8000-000000000102', status: 'APPROVED' }],
          total: 2
        })
      };
      const service = new AdvisorReadService({ repository, now: () => NOW });

      const result = await service.listStudentPlans(
        ADVISOR_CONTEXT,
        STUDENT_ID,
        { page: '1', pageSize: '10' },
        NOW
      );

      expect(result.items.map((plan) => plan.status)).toEqual(['CANCELLED', 'APPROVED']);
      expect(repository.listAssignedStudentPlans).toHaveBeenCalledWith(
        expect.objectContaining({ cycleId: null, status: null })
      );
    });

    test('fails closed immediately after the repository no longer sees an active assignment', async () => {
      const repository = {
        findAssignedStudent: jest
          .fn()
          .mockResolvedValueOnce(STUDENT_ROW)
          .mockResolvedValueOnce(null)
      };
      const service = new AdvisorReadService({ repository, now: () => NOW });

      await expect(service.getStudent(ADVISOR_CONTEXT, STUDENT_ID, NOW))
        .resolves.toMatchObject({ id: STUDENT_ID });
      await expect(service.getStudent(ADVISOR_CONTEXT, STUDENT_ID, NOW))
        .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    });

    test('rejects malformed IDs, invalid filters, and oversized pages', async () => {
      const service = new AdvisorReadService({ repository: {}, now: () => NOW });

      await expect(service.getPlan(ADVISOR_CONTEXT, 'not-a-uuid', NOW))
        .rejects.toMatchObject({ statusCode: 400 });
      await expect(service.listStudentPlans(
        ADVISOR_CONTEXT,
        STUDENT_ID,
        { status: 'UNKNOWN' },
        NOW
      )).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.listStudents(
        ADVISOR_CONTEXT,
        { pageSize: '101' },
        NOW
      )).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('HTTP routes and negative attempts', () => {
    function completeRepository(overrides = {}) {
      return {
        listAssignedStudents: jest.fn().mockResolvedValue({ rows: [STUDENT_ROW], total: 1 }),
        findAssignedStudent: jest.fn().mockResolvedValue(STUDENT_ROW),
        listAssignedStudentPlans: jest.fn().mockResolvedValue({ rows: [PLAN_ROW], total: 1 }),
        findAssignedPlan: jest.fn().mockResolvedValue(PLAN_ROW),
        ...overrides
      };
    }

    test('serves all four GET routes with deterministic response envelopes', async () => {
      const repository = completeRepository();
      const { router } = buildRouter(repository);

      const students = await request(router, 'GET', '/api/v3/advisor/students?page=1&pageSize=10');
      const student = await request(router, 'GET', `/api/v3/advisor/students/${STUDENT_ID}`);
      const plans = await request(router, 'GET', `/api/v3/advisor/students/${STUDENT_ID}/plans?status=CANCELLED`);
      const plan = await request(router, 'GET', `/api/v3/advisor/plans/${PLAN_ID}`);

      expect(students.statusCode).toBe(200);
      expect(students.body.pagination.total).toBe(1);
      expect(student.statusCode).toBe(200);
      expect(student.body.data).not.toHaveProperty('institutional_email');
      expect(plans.statusCode).toBe(200);
      expect(plans.body.data[0].status).toBe('CANCELLED');
      expect(plan.statusCode).toBe(200);
      expect(plan.body.data.notes).toBe(PLAN_ROW.notes);
    });

    test('returns an empty scoped list without revealing global totals', async () => {
      const repository = completeRepository({
        listAssignedStudents: jest.fn().mockResolvedValue({ rows: [], total: 0 })
      });
      const { router } = buildRouter(repository);

      const response = await request(router, 'GET', '/api/v3/advisor/students');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        data: [],
        pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 }
      });
    });

    test('uses generic 403 for guessed or out-of-scope Student and Plan UUIDs', async () => {
      const repository = completeRepository({
        findAssignedStudent: jest.fn().mockResolvedValue(null),
        findAssignedPlan: jest.fn().mockResolvedValue(null)
      });
      const { router } = buildRouter(repository);

      const student = await request(router, 'GET', `/api/v3/advisor/students/${STUDENT_ID}`);
      const plan = await request(router, 'GET', `/api/v3/advisor/plans/${PLAN_ID}`);

      for (const response of [student, plan]) {
        expect(response.statusCode).toBe(403);
        expect(response.body).toEqual({
          error: { code: 'FORBIDDEN', message: 'Access denied.' }
        });
      }
    });

    test('rejects unknown/duplicate query parameters and malformed UUIDs with 400', async () => {
      const { router } = buildRouter(completeRepository());

      const unknown = await request(router, 'GET', '/api/v3/advisor/students?search=name');
      const duplicate = await request(router, 'GET', '/api/v3/advisor/students?page=1&page=2');
      const malformed = await request(router, 'GET', '/api/v3/advisor/plans/not-a-uuid');

      expect(unknown.statusCode).toBe(400);
      expect(duplicate.statusCode).toBe(400);
      expect(malformed.statusCode).toBe(400);
    });

    test('does not expose Advisor mutation routes: matching read paths return 405 Allow GET', async () => {
      const { router } = buildRouter(completeRepository());

      const response = await request(
        router,
        'PATCH',
        `/api/v3/advisor/plans/${PLAN_ID}`
      );

      expect(response.statusCode).toBe(405);
      expect(response.headers.Allow).toBe('GET');
      expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
    });

    test('central authorization returns generic 403 when an Advisor attempts a protected mutation', async () => {
      const router = new Router();
      registerProtectedRoute(router, {
        method: 'PATCH',
        pattern: '/api/v3/protected-plan-transition',
        action: ACTIONS.PLAN_APPROVE,
        resolveResource: () => ({ planId: PLAN_ID, isMutation: true }),
        authOptions: { authorizationService: new AuthorizationService() },
        handler: async () => {
          throw new Error('must never run');
        }
      });

      const response = await request(router, 'PATCH', '/api/v3/protected-plan-transition');

      expect(response.statusCode).toBe(403);
      expect(response.body).toEqual({
        error: { code: 'FORBIDDEN', message: 'Access denied.' }
      });
    });
  });

  describe('repository defense in depth', () => {
    test('every read query includes role/account and effective active-assignment predicates', async () => {
      const pool = {
        query: jest.fn(async (sql) => {
          if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: 0 }] };
          return { rows: [] };
        })
      };
      const repository = new AdvisorReadRepository({ pool });

      await repository.listAssignedStudents({
        advisorUserId: ADVISOR_ID,
        timestampIso: NOW.toISOString(),
        limit: 10,
        offset: 0
      });
      await repository.findAssignedStudent({
        advisorUserId: ADVISOR_ID,
        studentId: STUDENT_ID,
        timestampIso: NOW.toISOString()
      });
      await repository.listAssignedStudentPlans({
        advisorUserId: ADVISOR_ID,
        studentId: STUDENT_ID,
        timestampIso: NOW.toISOString(),
        limit: 10,
        offset: 0
      });
      await repository.findAssignedPlan({
        advisorUserId: ADVISOR_ID,
        planId: PLAN_ID,
        timestampIso: NOW.toISOString()
      });

      expect(pool.query).toHaveBeenCalledTimes(6);
      for (const [sql] of pool.query.mock.calls) {
        expect(sql).toContain("aa.status = 'ACTIVE'");
        expect(sql).toContain('aa.revoked_at IS NULL');
        expect(sql).toContain('aa.effective_from <= $2::timestamptz');
        expect(sql).toContain('aa.effective_to > $2::timestamptz');
        expect(sql).toContain("advisor_user.role = 'ADVISOR'");
        expect(sql).toContain("advisor_user.account_status = 'ACTIVE'");
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
      }
    });
  });

  (process.env.TEST_DATABASE_URL ? describe : describe.skip)('PostgreSQL and Lambda integration', () => {
    const { Pool } = require('pg');
    const { seedV3 } = require('../src/db/seed');
    const { close } = require('../src/db/connection');
    const fixtures = require('../data/v3/fixtures.json');
    const link = fixtures.external_identity_links.find((row) => row.user_id === ADVISOR_ID);
    const unassignedStudent = fixtures.students.find((row) => row.id.endsWith('103'));
    const unassignedPlan = fixtures.plans.find((row) => row.student_id === unassignedStudent.id);
    let pool;
    let client;
    let handler;
    let requestTime;

    function event(path, sub = link.external_subject, method = 'GET') {
      return {
        rawPath: path,
        requestContext: {
          http: { method },
          ...(sub ? { authorizer: { jwt: { claims: {
            iss: link.external_issuer, sub, client_id: 'advisor-test-client',
            token_use: 'access', scope: 'coed-api/access',
            exp: Math.floor(Date.now() / 1000) + 3600
          } } } } : {})
        }
      };
    }

    beforeAll(async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      try { await seedV3(); } finally { log.mockRestore(); }
      pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    }, 60000);

    beforeEach(async () => {
      client = await pool.connect();
      await client.query('BEGIN');
      requestTime = NOW;
      handler = createLambdaHandler({
        now: () => requestTime,
        authOptions: {
          pool: client,
          tokenValidator: new TokenValidator({
            expectedIssuer: link.external_issuer,
            expectedClientId: 'advisor-test-client', requiredScope: 'coed-api/access'
          }),
          identityResolver: new IdentityResolver({ pool: client }),
          authorizationService: new AuthorizationService({ pool: client })
        },
        advisorReadRepository: new AdvisorReadRepository({ pool: client })
      });
    });

    afterEach(async () => {
      if (client) { await client.query('ROLLBACK'); client.release(); }
    });
    afterAll(async () => { if (pool) await pool.end(); await close(); });

    test('all four real routes enforce assignment and strip private fields', async () => {
      const list = await handler(event('/api/v3/advisor/students'));
      expect(list.statusCode).toBe(200);
      const payload = JSON.parse(list.body);
      expect(payload.pagination.total).toBe(2);
      expect(payload.data.map((row) => row.id).sort()).toEqual(
        fixtures.advisor_assignments.filter((row) => row.advisor_id === ADVISOR_ID && row.status === 'ACTIVE')
          .map((row) => row.student_id).sort()
      );
      for (const path of [
        `/api/v3/advisor/students/${STUDENT_ID}`,
        `/api/v3/advisor/students/${STUDENT_ID}/plans`,
        `/api/v3/advisor/plans/${PLAN_ID}`
      ]) {
        const response = await handler(event(path));
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toMatch(/institutional_email|external_subject|user_id|review_notes|operation_id/);
      }
      for (const path of [
        `/api/v3/advisor/students/${unassignedStudent.id}`,
        `/api/v3/advisor/students/${unassignedStudent.id}/plans`,
        `/api/v3/advisor/plans/${unassignedPlan.id}`,
        '/api/v3/advisor/plans/50000000-0000-4000-8000-000000009999'
      ]) {
        const response = await handler(event(path));
        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.body).error.message).toBe('Access denied.');
      }
    });

    test('reads historical CANCELLED plans across cycles and paginates consistently', async () => {
      const original = fixtures.plans.find((row) => row.status === 'CANCELLED');
      const olderCycle = fixtures.rounds.find((row) => row.id !== original.cycle_id);
      const historical = {...original,id:require('node:crypto').randomUUID()};
      // Terminal rows are immutable: create the historical fixture in its correct cycle.
      await client.query(`INSERT INTO plans(id,student_id,cycle_id,round_id,company_id,position_id,status,source,visibility,data_status)
        VALUES($1,$2,$3,$3,$4,$5,'CANCELLED','test','private','mock')`,
      [historical.id,historical.student_id,olderCycle.id,historical.company_id,historical.position_id]);
      const response = await handler(event(`/api/v3/advisor/plans/${historical.id}`));
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data.cycle_id).toBe(olderCycle.id);
      const repository = new AdvisorReadRepository({ pool: client });
      const input = { advisorUserId: ADVISOR_ID, timestampIso: NOW.toISOString(), limit: 1 };
      const first = await repository.listAssignedStudents({ ...input, offset: 0 });
      const second = await repository.listAssignedStudents({ ...input, offset: 1 });
      expect(first.total).toBe(2);
      expect(first.rows[0].id).not.toBe(second.rows[0].id);
      expect((await repository.listAssignedStudents({ ...input, offset: 0 })).rows).toEqual(first.rows);
    });

    test('revocation denies the very next request through policy and repository', async () => {
      const path = `/api/v3/advisor/students/${STUDENT_ID}`;
      expect((await handler(event(path))).statusCode).toBe(200);
      await client.query(`UPDATE advisor_assignments SET status = 'REVOKED',
        revoked_at = $1, revoked_by = assigned_by WHERE advisor_id = $2 AND student_id = $3 AND status = 'ACTIVE'`,
      [NOW, ADVISOR_ID, STUDENT_ID]);
      expect((await handler(event(path))).statusCode).toBe(403);
      expect(await new AdvisorReadRepository({ pool: client }).findAssignedStudent({
        advisorUserId: ADVISOR_ID, studentId: STUDENT_ID, timestampIso: NOW.toISOString()
      })).toBeNull();
    });

    test('enforces the exact half-open assignment time interval', async () => {
      const assignment = fixtures.advisor_assignments.find((row) => row.advisor_id === ADVISOR_ID && row.status === 'ACTIVE');
      const path = `/api/v3/advisor/students/${assignment.student_id}`;
      requestTime = new Date(new Date(assignment.effective_from).getTime() - 1);
      expect((await handler(event(path))).statusCode).toBe(403);
      requestTime = new Date(assignment.effective_from);
      expect((await handler(event(path))).statusCode).toBe(200);
      requestTime = new Date(assignment.effective_to);
      expect((await handler(event(path))).statusCode).toBe(403);
    });

    test('rejects anonymous, other roles, and a disabled Advisor account', async () => {
      const path = `/api/v3/advisor/students/${STUDENT_ID}`;
      expect((await handler(event(path, null))).statusCode).toBe(401);
      for (const userId of [fixtures.students[0].user_id,
        '70000000-0000-4000-8000-000000000020', '70000000-0000-4000-8000-000000000030']) {
        const identity = fixtures.external_identity_links.find((row) => row.user_id === userId && row.status === 'ACTIVE');
        expect((await handler(event(path, identity.external_subject))).statusCode).toBe(403);
      }
      await client.query("UPDATE users SET account_status = 'DISABLED' WHERE id = $1", [ADVISOR_ID]);
      expect((await handler(event(path))).statusCode).toBe(403);
    });
  });
});
