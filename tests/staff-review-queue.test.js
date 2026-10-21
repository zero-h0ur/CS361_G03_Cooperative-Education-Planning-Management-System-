/**
 * Tests for Issue #67: Staff Student/Plan search and review queue API (read-only).
 */

const { createLambdaHandler } = require('../src/lambda');
const { TokenValidator, IdentityResolver, AuthorizationService } = require('../src/auth');
const { StaffReviewRepository } = require('../src/db/repositories/staff-review-repository');

const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_staffTest';
const CLIENT_ID = 'staff-test-client-id';

const USERS = Object.freeze({
  'sub-staff-cpe': { user_id: '70000000-0000-4000-8000-000000000020', role: 'STAFF' },
  'sub-staff-noscope': { user_id: '70000000-0000-4000-8000-000000000029', role: 'STAFF' },
  'sub-advisor': { user_id: '70000000-0000-4000-8000-000000000010', role: 'ADVISOR' },
  'sub-admin': { user_id: '70000000-0000-4000-8000-000000000030', role: 'ADMIN' },
  'sub-student': {
    user_id: '70000000-0000-4000-8000-000000000001',
    role: 'STUDENT',
    student_id: '40000000-0000-4000-8000-000000000101'
  }
});

const ACTIVE_SCOPES = Object.freeze({
  '70000000-0000-4000-8000-000000000020': [{ department: 'CPE', program: null, academicYear: null }]
});

const STUDENT_ROW = Object.freeze({
  id: '40000000-0000-4000-8000-000000000101',
  student_number: 'TEST000001',
  full_name: 'สมมุติ เรียนดี',
  preferred_name: 'สมมุติ',
  department: 'CPE',
  program: 'CPE',
  major: 'Computer Engineering',
  academic_year: 2569,
  enrollment_status: 'ACTIVE',
  // Columns that must never reach a Staff list response (#50)
  institutional_email: 'sommut.r@student.example.com',
  user_id: '70000000-0000-4000-8000-000000000001',
  anonymous_ref: 'STU-ANON-0001',
  data_source: 'LEGACY_CSV'
});

const PLAN_ROW = Object.freeze({
  id: '50000000-0000-4000-8000-000000000102',
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
  // Columns that must never reach a Staff list response (#50)
  notes: 'private plan notes',
  institutional_email: 'wipha.j@student.example.com'
});

function claimsFor(sub) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub,
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'openid coed-api/access',
    exp: now + 3600,
    nbf: now - 60
  };
}

function buildHandler({ repository } = {}) {
  const identityPool = {
    query: jest.fn(async (_sql, [, sub]) => {
      const user = USERS[sub];
      if (!user) return { rows: [] };
      return {
        rows: [{
          user_id: user.user_id,
          role: user.role,
          account_status: 'ACTIVE',
          link_status: 'ACTIVE',
          active_link_count: 1,
          student_id: user.student_id || null,
          student_number: user.student_id ? 'TEST000001' : null,
          full_name: user.student_id ? 'สมมุติ เรียนดี' : null,
          institutional_email: user.student_id ? 'sommut.r@student.example.com' : null,
          department: user.student_id ? 'CPE' : null,
          program: user.student_id ? 'CPE' : null,
          major: user.student_id ? 'Computer Engineering' : null,
          academic_year: user.student_id ? 2569 : null,
          enrollment_status: user.student_id ? 'ACTIVE' : null
        }]
      };
    })
  };

  const staffReviewRepository = repository || {
    searchStudents: jest.fn(async () => ({ rows: [STUDENT_ROW], total: 1 })),
    searchPlans: jest.fn(async () => ({ rows: [PLAN_ROW], total: 1 }))
  };

  const handler = createLambdaHandler({
    authOptions: {
      tokenValidator: new TokenValidator({ expectedIssuer: ISSUER, expectedClientId: CLIENT_ID }),
      identityResolver: new IdentityResolver({ pool: identityPool }),
      authorizationService: new AuthorizationService({
        repository: {
          listActiveStaffScopes: jest.fn(async (userId) =>
            (ACTIVE_SCOPES[userId] || []).map((scope) => ({ id: 'scope', ...scope }))
          )
        }
      })
    },
    staffReviewRepository
  });

  return { handler, staffReviewRepository };
}

// Production path (#48): API Gateway's JWT Authorizer forwards verified claims to Lambda
function event(path, { sub, query = '', method = 'GET' } = {}) {
  return {
    rawPath: path,
    rawQueryString: query,
    headers: {},
    requestContext: {
      http: { method },
      ...(sub ? { authorizer: { jwt: { claims: claimsFor(sub), scopes: ['coed-api/access'] } } } : {})
    }
  };
}

function body(response) {
  return JSON.parse(response.body);
}

const ENDPOINTS = Object.freeze([
  '/api/v3/staff/students',
  '/api/v3/staff/plans',
  '/api/v3/staff/review-queue'
]);

describe('Issue #67: Staff Student/Plan search and review queue API', () => {
  describe('authorization (#49, #53, #62)', () => {
    it('allows an ACTIVE Staff with an active scope on every endpoint', async () => {
      const { handler } = buildHandler();
      for (const path of ENDPOINTS) {
        const response = await handler(event(path, { sub: 'sub-staff-cpe' }));
        expect(response.statusCode).toBe(200);
        expect(body(response).pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
      }
    });

    it.each([
      ['ADVISOR', 'sub-advisor'],
      ['STUDENT', 'sub-student'],
      ['ADMIN', 'sub-admin']
    ])('rejects %s with 403 before touching Staff data', async (_role, sub) => {
      const { handler, staffReviewRepository } = buildHandler();
      for (const path of ENDPOINTS) {
        const response = await handler(event(path, { sub }));
        expect(response.statusCode).toBe(403);
        expect(body(response)).toEqual({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
      }
      expect(staffReviewRepository.searchStudents).not.toHaveBeenCalled();
      expect(staffReviewRepository.searchPlans).not.toHaveBeenCalled();
    });

    it('rejects Staff without any ACTIVE scope with 403', async () => {
      const { handler, staffReviewRepository } = buildHandler();
      const response = await handler(event('/api/v3/staff/review-queue', { sub: 'sub-staff-noscope' }));
      expect(response.statusCode).toBe(403);
      expect(staffReviewRepository.searchPlans).not.toHaveBeenCalled();
    });

    it('rejects anonymous requests with 401', async () => {
      const { handler } = buildHandler();
      for (const path of ENDPOINTS) {
        const response = await handler(event(path));
        expect(response.statusCode).toBe(401);
      }
    });

    it('scopes queries by the trusted Staff identity, never by client input', async () => {
      const { handler, staffReviewRepository } = buildHandler();
      await handler(event('/api/v3/staff/plans', { sub: 'sub-staff-cpe' }));
      expect(staffReviewRepository.searchPlans).toHaveBeenCalledWith(
        expect.objectContaining({ staffUserId: USERS['sub-staff-cpe'].user_id })
      );

      for (const query of ['staff_id=70000000-0000-4000-8000-000000000021', 'department=EE', 'scope=all']) {
        const response = await handler(event('/api/v3/staff/plans', { sub: 'sub-staff-cpe', query }));
        expect(response.statusCode).toBe(400);
        expect(body(response).error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects non-GET methods with 405', async () => {
      const { handler } = buildHandler();
      const response = await handler(event('/api/v3/staff/review-queue', { sub: 'sub-staff-cpe', method: 'POST' }));
      expect(response.statusCode).toBe(405);
      expect(response.headers.Allow).toBe('GET');
    });
  });

  describe('response allowlist (#50)', () => {
    it('returns Student summaries without email, identity or legacy columns', async () => {
      const { handler } = buildHandler();
      const response = await handler(event('/api/v3/staff/students', { sub: 'sub-staff-cpe' }));
      const [student] = body(response).data;
      expect(Object.keys(student).sort()).toEqual([
        'academic_year', 'department', 'enrollment_status', 'full_name', 'id',
        'major', 'preferred_name', 'program', 'student_number'
      ]);
      expect(response.body).not.toContain('student.example.com');
      expect(response.body).not.toContain('STU-ANON');
    });

    it('returns Plan summaries without notes or student contact data', async () => {
      const { handler } = buildHandler();
      const response = await handler(event('/api/v3/staff/review-queue', { sub: 'sub-staff-cpe' }));
      const [plan] = body(response).data;
      expect(plan).toEqual({
        id: PLAN_ROW.id,
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
        }
      });
      expect(response.body).not.toContain('private plan notes');
      expect(response.body).not.toContain('student.example.com');
    });
  });

  describe('filters, pagination and ordering', () => {
    it('applies deterministic defaults: search newest first, review queue oldest first', async () => {
      const { handler, staffReviewRepository } = buildHandler();
      await handler(event('/api/v3/staff/plans', { sub: 'sub-staff-cpe' }));
      await handler(event('/api/v3/staff/review-queue', { sub: 'sub-staff-cpe' }));

      expect(staffReviewRepository.searchPlans).toHaveBeenNthCalledWith(1, expect.objectContaining({
        reviewQueue: false, sort: 'updated_at', order: 'desc', page: 1, pageSize: 20
      }));
      expect(staffReviewRepository.searchPlans).toHaveBeenNthCalledWith(2, expect.objectContaining({
        reviewQueue: true, sort: 'submitted_at', order: 'asc', page: 1, pageSize: 20
      }));
    });

    it('passes validated filters to the repository', async () => {
      const { handler, staffReviewRepository } = buildHandler();
      const query = [
        'q=%20TEST%20', 'academic_year=2569', 'round_id=30000000-0000-4000-8000-000000000101',
        'status=SUBMITTED', 'company_id=10000000-0000-4000-8000-000000000001',
        'advisor_id=70000000-0000-4000-8000-000000000010', 'sort=student_number', 'order=asc',
        'page=2', 'pageSize=5'
      ].join('&');
      const response = await handler(event('/api/v3/staff/plans', { sub: 'sub-staff-cpe', query }));

      expect(response.statusCode).toBe(200);
      expect(staffReviewRepository.searchPlans).toHaveBeenCalledWith({
        staffUserId: USERS['sub-staff-cpe'].user_id,
        reviewQueue: false,
        keyword: 'TEST',
        academicYear: 2569,
        roundId: '30000000-0000-4000-8000-000000000101',
        status: 'SUBMITTED',
        companyId: '10000000-0000-4000-8000-000000000001',
        advisorId: '70000000-0000-4000-8000-000000000010',
        sort: 'student_number',
        order: 'asc',
        page: 2,
        pageSize: 5
      });
    });

    it('treats empty filter values as not provided', async () => {
      const { handler, staffReviewRepository } = buildHandler();
      const response = await handler(event('/api/v3/staff/students', {
        sub: 'sub-staff-cpe',
        query: 'q=&academic_year=&advisor_id='
      }));
      expect(response.statusCode).toBe(200);
      expect(staffReviewRepository.searchStudents).toHaveBeenCalledWith(expect.objectContaining({
        keyword: null, academicYear: null, advisorId: null
      }));
    });

    it.each([
      ['/api/v3/staff/plans', 'academic_year=2026', 'academic_year'],
      ['/api/v3/staff/plans', 'status=PUBLISHED', 'status'],
      ['/api/v3/staff/review-queue', 'status=APPROVED', 'status'],
      ['/api/v3/staff/plans', 'round_id=not-a-uuid', 'round_id'],
      ['/api/v3/staff/plans', 'company_id=123', 'company_id'],
      ['/api/v3/staff/students', 'advisor_id=x', 'advisor_id'],
      ['/api/v3/staff/plans', 'sort=notes', 'sort'],
      ['/api/v3/staff/plans', 'order=sideways', 'order'],
      ['/api/v3/staff/students', 'page=0', 'page'],
      ['/api/v3/staff/students', 'pageSize=101', 'pageSize'],
      ['/api/v3/staff/students', 'status=DRAFT', 'status'],
      ['/api/v3/staff/plans', 'status=DRAFT&status=SUBMITTED', 'status'],
      ['/api/v3/staff/students', `q=${'x'.repeat(101)}`, 'q']
    ])('rejects %s?%s with 400 VALIDATION_ERROR on %s', async (path, query, field) => {
      const { handler, staffReviewRepository } = buildHandler();
      const response = await handler(event(path, { sub: 'sub-staff-cpe', query }));
      expect(response.statusCode).toBe(400);
      const { error } = body(response);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details.map((detail) => detail.field)).toContain(field);
      expect(staffReviewRepository.searchStudents).not.toHaveBeenCalled();
      expect(staffReviewRepository.searchPlans).not.toHaveBeenCalled();
    });

    it('returns an empty page with zero totals when nothing is in scope', async () => {
      const { handler } = buildHandler({
        repository: {
          searchStudents: jest.fn(async () => ({ rows: [], total: 0 })),
          searchPlans: jest.fn(async () => ({ rows: [], total: 0 }))
        }
      });
      const response = await handler(event('/api/v3/staff/review-queue', { sub: 'sub-staff-cpe' }));
      expect(response.statusCode).toBe(200);
      expect(body(response)).toEqual({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
      });
    });

    it('returns 503 when the database is unavailable', async () => {
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const { handler } = buildHandler({
        repository: new StaffReviewRepository({ pool: { query: jest.fn().mockRejectedValue(connectionError) } })
      });
      const response = await handler(event('/api/v3/staff/plans', { sub: 'sub-staff-cpe' }));
      expect(response.statusCode).toBe(503);
      expect(body(response).error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  // Runs the real SQL against seeded V3 fixtures (#60) when an isolated test database exists
  const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
  (hasTestDb ? describe : describe.skip)('scope SQL against seeded fixtures (PostgreSQL)', () => {
    const { Pool } = require('pg');
    const { seedV3 } = require('../src/db/seed');
    const { close } = require('../src/db/connection');
    const { StaffReviewService } = require('../src/api/services/staff-review-service');

    const STAFF_CPE = '70000000-0000-4000-8000-000000000020';
    const STAFF_EE = '70000000-0000-4000-8000-000000000021';
    const STAFF_CPE_2568 = '70000000-0000-4000-8000-000000000022';
    const ADVISOR_1 = '70000000-0000-4000-8000-000000000010';
    const OPEN_ROUND = '30000000-0000-4000-8000-000000000101';

    let pool;
    let service;
    const params = (query = '') => new URLSearchParams(query);
    const numbers = (result) => result.items.map((item) => item.student_number || item.student.student_number);

    beforeAll(async () => {
      process.env.NODE_ENV = 'test';
      process.env.ALLOW_DB_RESET = 'true';
      jest.spyOn(console, 'log').mockImplementation(() => {});
      await seedV3();
      console.log.mockRestore();
      pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      service = new StaffReviewService({ pool });
    }, 60000);

    afterAll(async () => {
      if (pool) await pool.end();
      await close();
    });

    it('limits Students to the Staff department and counts only in-scope rows', async () => {
      const cpe = await service.searchStudents(STAFF_CPE, params());
      expect(numbers(cpe)).toEqual(['TEST000001', 'TEST000002', 'TEST000004', 'TEST000005']);
      expect(cpe.pagination.total).toBe(4);

      const ee = await service.searchStudents(STAFF_EE, params());
      expect(numbers(ee)).toEqual(['TEST000003']);
    });

    it('applies a year-restricted scope to the Plan round year', async () => {
      const result = await service.searchPlans(STAFF_CPE_2568, params());
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('returns only pending Plans in OPEN rounds, oldest first', async () => {
      const queue = await service.getReviewQueue(STAFF_CPE, params());
      expect(queue.items.map((plan) => plan.status)).toEqual(['UNDER_REVIEW', 'NEEDS_REVISION']);
      expect(queue.items.every((plan) => plan.cycle.status === 'OPEN')).toBe(true);

      await pool.query(`UPDATE rounds SET status = 'CLOSED' WHERE id = $1`, [OPEN_ROUND]);
      try {
        const closed = await service.getReviewQueue(STAFF_CPE, params());
        expect(closed.items).toEqual([]);
        expect(closed.pagination.total).toBe(0);
      } finally {
        await pool.query(`UPDATE rounds SET status = 'OPEN' WHERE id = $1`, [OPEN_ROUND]);
      }
    });

    it('paginates deterministically with a stable tiebreaker', async () => {
      const query = 'sort=student_number&order=asc&pageSize=2';
      const first = await service.searchPlans(STAFF_CPE, params(`${query}&page=1`));
      const second = await service.searchPlans(STAFF_CPE, params(`${query}&page=2`));
      const again = await service.searchPlans(STAFF_CPE, params(`${query}&page=1`));

      expect(first.items.map((plan) => plan.id)).toEqual(again.items.map((plan) => plan.id));
      expect(new Set([...first.items, ...second.items].map((plan) => plan.id)).size).toBe(4);
      expect(first.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    });

    it('filters by active advisor assignment and escapes LIKE wildcards in keywords', async () => {
      const byAdvisor = await service.searchStudents(STAFF_CPE, params(`advisor_id=${ADVISOR_1}`));
      expect(numbers(byAdvisor)).toEqual(['TEST000001', 'TEST000002']);

      const wildcard = await service.searchStudents(STAFF_CPE, params('q=%25'));
      expect(wildcard.items).toEqual([]);

      const byNumber = await service.searchStudents(STAFF_CPE, params('q=test000004'));
      expect(numbers(byNumber)).toEqual(['TEST000004']);
    });
  });
});
