/**
 * Issue #79 — [V3-T02] Verify authentication and authorization boundaries.
 *
 * End-to-end positive/negative verification of V3 authentication and authorization
 * boundaries against real HTTP endpoints and the centralized AuthorizationService.
 */

const crypto = require('node:crypto');
const { createApiServer } = require('../src/api/app');
const { TokenValidator } = require('../src/auth/token-validator');
const { IdentityResolver } = require('../src/auth/identity-resolver');
const {
  ROLES,
  ACTIONS,
  AuthorizationService
} = require('../src/api/services/authorization-service');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});
const { privateKey: untrustedPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});

const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_v3Pool';
const CLIENT_ID = 'v3-client-id-boundary-test';

function signJwt(
  payload,
  header = { alg: 'RS256', typ: 'JWT', kid: 'v3-key-1' },
  signingKey = privateKey
) {
  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encHeader}.${encPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(signingKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function makeClaims(sub, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub,
    iss: ISSUER,
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'openid email coed-api/access',
    exp: now + 3600,
    nbf: now - 10,
    ...overrides
  };
}

const ACTORS = Object.freeze({
  studentA: {
    sub: 'sub-student-a',
    userId: '70000000-0000-4000-8000-000000000001',
    studentId: '40000000-0000-4000-8000-000000000101',
    role: ROLES.STUDENT,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE',
    studentNumber: 'TEST000001',
    fullName: 'สมชาย ใจดี',
    institutionalEmail: 'test000001@student.example.com',
    department: 'CPE',
    program: 'B.Eng.',
    major: 'CPE',
    academicYear: 2569,
    enrollmentStatus: 'ACTIVE'
  },
  studentB: {
    sub: 'sub-student-b',
    userId: '70000000-0000-4000-8000-000000000002',
    studentId: '40000000-0000-4000-8000-000000000102',
    role: ROLES.STUDENT,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE',
    studentNumber: 'TEST000002',
    fullName: 'สมหญิง รักเรียน',
    institutionalEmail: 'test000002@student.example.com',
    department: 'EE',
    program: 'B.Eng.',
    major: 'EE',
    academicYear: 2569,
    enrollmentStatus: 'ACTIVE'
  },
  staffCpe: {
    sub: 'sub-staff-cpe',
    userId: '70000000-0000-4000-8000-000000000020',
    studentId: null,
    role: ROLES.STAFF,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  },
  staffEeOutScope: {
    sub: 'sub-staff-ee',
    userId: '70000000-0000-4000-8000-000000000021',
    studentId: null,
    role: ROLES.STAFF,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  },
  advisorAssigned: {
    sub: 'sub-advisor-1',
    userId: '70000000-0000-4000-8000-000000000010',
    studentId: null,
    role: ROLES.ADVISOR,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  },
  disabledUser: {
    sub: 'sub-disabled-user',
    userId: '70000000-0000-4000-8000-000000000090',
    studentId: null,
    role: ROLES.STAFF,
    accountStatus: 'DISABLED',
    linkStatus: 'ACTIVE'
  },
  revokedLinkUser: {
    sub: 'sub-revoked-link',
    userId: '70000000-0000-4000-8000-000000000091',
    studentId: null,
    role: ROLES.STAFF,
    accountStatus: 'ACTIVE',
    linkStatus: 'REVOKED'
  },
  unlinkedStudentRole: {
    sub: 'sub-student-missing-profile',
    userId: '70000000-0000-4000-8000-000000000092',
    studentId: null,
    role: ROLES.STUDENT,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  }
});

const PLANS = Object.freeze({
  planA_Draft: {
    id: '50000000-0000-4000-8000-000000000501',
    student_id: ACTORS.studentA.studentId,
    company_id: '10000000-0000-4000-8000-000000000001',
    position_id: '20000000-0000-4000-8000-000000000001',
    cycle_id: '30000000-0000-4000-8000-000000000001',
    academic_year: 2569,
    semester: 1,
    position_title: 'Backend Intern',
    job_description: 'Develop APIs',
    start_date: '2026-06-01',
    end_date: '2026-09-30',
    status: 'DRAFT',
    student_department: 'CPE',
    student_program: 'B.Eng.',
    student_academic_year: 2569,
    version: 1
  },
  planA_Submitted: {
    id: '50000000-0000-4000-8000-000000000502',
    student_id: ACTORS.studentA.studentId,
    company_id: '10000000-0000-4000-8000-000000000001',
    position_id: '20000000-0000-4000-8000-000000000001',
    cycle_id: '30000000-0000-4000-8000-000000000001',
    academic_year: 2569,
    semester: 1,
    position_title: 'Backend Intern',
    job_description: 'Develop APIs',
    start_date: '2026-06-01',
    end_date: '2026-09-30',
    status: 'SUBMITTED',
    student_department: 'CPE',
    student_program: 'B.Eng.',
    student_academic_year: 2569,
    version: 2
  },
  planA_UnderReview: {
    id: '50000000-0000-4000-8000-000000000503',
    student_id: ACTORS.studentA.studentId,
    company_id: '10000000-0000-4000-8000-000000000001',
    position_id: '20000000-0000-4000-8000-000000000001',
    cycle_id: '30000000-0000-4000-8000-000000000001',
    academic_year: 2569,
    semester: 1,
    position_title: 'Backend Intern',
    job_description: 'Develop APIs',
    start_date: '2026-06-01',
    end_date: '2026-09-30',
    status: 'UNDER_REVIEW',
    student_department: 'CPE',
    student_program: 'B.Eng.',
    student_academic_year: 2569,
    version: 3
  },
  planB_Draft: {
    id: '50000000-0000-4000-8000-000000000504',
    student_id: ACTORS.studentB.studentId,
    company_id: '10000000-0000-4000-8000-000000000001',
    position_id: '20000000-0000-4000-8000-000000000001',
    cycle_id: '30000000-0000-4000-8000-000000000001',
    academic_year: 2569,
    semester: 1,
    position_title: 'Hardware Intern',
    job_description: 'Design PCB',
    start_date: '2026-06-01',
    end_date: '2026-09-30',
    status: 'DRAFT',
    student_department: 'EE',
    student_program: 'B.Eng.',
    student_academic_year: 2569,
    version: 1
  }
});

function createBoundaryTestEnvironment() {
  const auditLogs = [];
  const actorsBySub = new Map(Object.values(ACTORS).map((a) => [a.sub, a]));
  const plansById = new Map(Object.values(PLANS).map((p) => [p.id, { ...p }]));

  const tokenValidator = new TokenValidator({
    expectedIssuer: ISSUER,
    expectedClientId: CLIENT_ID,
    requiredScope: 'coed-api/access',
    publicKey
  });

  const identityPool = {
    async query(_sql, [issuer, subject]) {
      if (issuer !== ISSUER) return { rows: [] };
      const actor = actorsBySub.get(subject);
      if (!actor) return { rows: [] };

      const row = {
        user_id: actor.userId,
        role: actor.role,
        account_status: actor.accountStatus,
        identity_link_id: `link-${actor.userId}`,
        link_status: actor.linkStatus,
        active_link_count: actor.linkStatus === 'ACTIVE' ? 1 : 0,
        student_id: actor.studentId
      };

      if (actor.studentId) {
        Object.assign(row, {
          student_number: actor.studentNumber,
          full_name: actor.fullName,
          preferred_name: 'ชาย',
          institutional_email: actor.institutionalEmail,
          department: actor.department,
          program: actor.program,
          major: actor.major,
          academic_year: actor.academicYear,
          enrollment_status: actor.enrollmentStatus
        });
      }

      return { rows: [row] };
    }
  };

  const identityResolver = new IdentityResolver({ pool: identityPool });

  const authzRepository = {
    async findPlanById(planId) {
      const plan = plansById.get(planId);
      if (!plan) return null;
      return {
        ...plan,
        round_status: 'OPEN',
        round_academic_year: 2569
      };
    },
    async listActiveStaffScopes(staffUserId) {
      if (staffUserId === ACTORS.staffCpe.userId) {
        return [{ department: 'CPE', program: null, academic_year: 2569 }];
      }
      if (staffUserId === ACTORS.staffEeOutScope.userId) {
        return [{ department: 'EE', program: null, academic_year: 2568 }];
      }
      return [];
    },
    async listActiveAdvisorAssignments(advisorUserId) {
      if (advisorUserId === ACTORS.advisorAssigned.userId) {
        return [{ student_id: ACTORS.studentA.studentId, academic_year: 2569, semester: 1 }];
      }
      return [];
    },
    async findActiveAdvisorAssignment({ advisorUserId, studentId }) {
      if (
        advisorUserId === ACTORS.advisorAssigned.userId &&
        studentId === ACTORS.studentA.studentId
      ) {
        return {
          id: 'assign-1',
          advisor_id: advisorUserId,
          student_id: studentId,
          academic_year: 2569,
          semester: 1,
          status: 'ACTIVE',
          revoked_at: null,
          user_account_status: 'ACTIVE',
          user_role: ROLES.ADVISOR,
          effective_from: '2025-01-01T00:00:00.000Z',
          effective_to: '2030-01-01T00:00:00.000Z'
        };
      }
      return null;
    },
    async findStaffScopeMatch({ staffUserId, studentId, planId }) {
      const plan = planId ? plansById.get(planId) : null;
      const studentDept =
        studentId === ACTORS.studentA.studentId
          ? 'CPE'
          : studentId === ACTORS.studentB.studentId
            ? 'EE'
            : plan?.student_department || null;

      if (staffUserId === ACTORS.staffCpe.userId && studentDept === 'CPE') {
        return {
          user_role: ROLES.STAFF,
          user_account_status: 'ACTIVE',
          scope_status: 'ACTIVE',
          scope_department: 'CPE',
          scope_program: null,
          scope_academic_year: 2569,
          student_department: 'CPE',
          student_program: 'B.Eng.',
          student_academic_year: 2569,
          plan_id: planId || null,
          round_status: 'OPEN',
          round_academic_year: 2569
        };
      }
      return null;
    }
  };

  const authorizationService = new AuthorizationService({
    repository: authzRepository
  });

  const sessionRepository = {
    async findUserSessionProfile({ userId, studentId }) {
      const actor = Object.values(ACTORS).find((a) => a.userId === userId);
      if (!actor) return null;
      return {
        user: {
          id: actor.userId,
          role: actor.role,
          account_status: actor.accountStatus
        },
        student: studentId
          ? {
              id: studentId,
              student_number: actor.studentNumber,
              full_name: actor.fullName,
              preferred_name: 'ชาย',
              institutional_email: actor.institutionalEmail,
              department: actor.department,
              program: actor.program,
              major: actor.major,
              academic_year: actor.academicYear,
              enrollment_status: actor.enrollmentStatus
            }
          : null,
        staffScopes: await authzRepository.listActiveStaffScopes(userId),
        advisorAssignments: await authzRepository.listActiveAdvisorAssignments(userId)
      };
    }
  };

  const studentProfileRepository = {
    async findOwnStudentProfile({ studentId, userId }) {
      if (
        studentId === ACTORS.studentA.studentId &&
        userId === ACTORS.studentA.userId
      ) {
        return {
          id: ACTORS.studentA.studentId,
          user_id: ACTORS.studentA.userId,
          student_number: ACTORS.studentA.studentNumber,
          full_name: ACTORS.studentA.fullName,
          preferred_name: 'ชาย',
          institutional_email: ACTORS.studentA.institutionalEmail,
          department: ACTORS.studentA.department,
          program: ACTORS.studentA.program,
          major: ACTORS.studentA.major,
          academic_year: ACTORS.studentA.academicYear,
          enrollment_status: ACTORS.studentA.enrollmentStatus,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
          version: 1
        };
      }
      return null;
    },
    async updateOwnPreferredName({ studentId, userId, preferredName, expectedVersion }) {
      const existing = await this.findOwnStudentProfile({ studentId, userId });
      if (!existing) return null;
      if (expectedVersion !== null && existing.version !== expectedVersion) {
        return null;
      }
      return {
        ...existing,
        preferred_name: preferredName,
        version: existing.version + 1
      };
    }
  };

  const operationsById = new Map();
  const workflowRepository = {
    async getClient() {
      return {
        async query() {
          return { rows: [] };
        },
        release() {}
      };
    },
    async findPlanByIdForUpdate(_client, planId) {
      const plan = plansById.get(planId);
      if (!plan) return null;
      return {
        ...plan,
        round_status: 'OPEN',
        company_visibility: 'public',
        position_visibility: 'public',
        position_company_id: plan.company_id
      };
    },
    async findOperationById(_client, operationId) {
      return operationsById.get(operationId) || null;
    },
    async updatePlanStatus(_client, { planId, status, nextVersion, expectedVersion }) {
      const current = plansById.get(planId);
      if (!current || Number(current.version) !== Number(expectedVersion)) return null;
      const updated = {
        ...current,
        status,
        version: nextVersion,
        updated_at: new Date().toISOString()
      };
      plansById.set(planId, updated);
      return updated;
    },
    async insertPlanOperation(_client, op) {
      const saved = {
        operation_id: op.operationId,
        plan_id: op.planId,
        actor_id: op.actorId,
        action: op.action,
        request_hash: op.requestHash,
        response_status: op.responseStatus,
        response_payload: op.responsePayload,
        result_version: op.resultVersion
      };
      operationsById.set(op.operationId, saved);
      return saved;
    },
    async insertAuditEvent(_client, event) {
      const saved = {
        event_id: event.eventId,
        plan_id: event.planId,
        actor_id: event.actorId,
        actor_role: event.actorRole,
        action: event.action,
        from_state: event.fromState,
        to_state: event.toState,
        notes: event.notes,
        correlation_id: event.correlationId,
        operation_id: event.operationId,
        created_at: new Date().toISOString()
      };
      auditLogs.push(saved);
      return saved;
    }
  };

  const sampleCompany = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'บริษัท ตัวอย่าง จำกัด',
    description: 'Public company',
    website_url: 'https://example.com',
    location: 'Bangkok',
    source: 'v2-dataset',
    updated_at: '2026-01-01T00:00:00.000Z',
    data_status: 'verified'
  };
  const samplePosition = {
    id: '20000000-0000-4000-8000-000000000001',
    company_id: sampleCompany.id,
    title: 'Software Engineer Intern',
    description: 'Build services',
    location: 'Bangkok',
    source: 'v2-dataset',
    updated_at: '2026-01-01T00:00:00.000Z',
    data_status: 'verified'
  };

  const dal = {
    InvalidInputError: class InvalidInputError extends Error {},
    listPublicCompanies: jest.fn().mockResolvedValue({
      items: [sampleCompany],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    }),
    searchPublicCompaniesAndPositions: jest.fn().mockResolvedValue({
      items: [sampleCompany],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    }),
    getPublicCompanyById: jest.fn().mockResolvedValue({
      ...sampleCompany,
      positions: [samplePosition]
    }),
    listPublicPositionsByCompany: jest.fn().mockResolvedValue([samplePosition]),
    getPublicPositionById: jest.fn().mockResolvedValue(samplePosition)
  };

  const authOptions = {
    allowBearerFallback: true,
    tokenValidator,
    identityResolver,
    repository: authzRepository,
    authorizationService,
    auditLogger: (entry) => auditLogs.push(entry)
  };

  const server = createApiServer({
    dal,
    authOptions,
    sessionRepository,
    studentProfileRepository,
    workflowRepository
  });

  return {
    server,
    authOptions,
    authorizationService,
    auditLogs
  };
}

describe('Issue #79 [V3-T02]: Verify authentication and authorization boundaries', () => {
  let env;
  let baseUrl;

  beforeEach(async () => {
    env = createBoundaryTestEnvironment();
    await new Promise((resolve) => {
      env.server.listen(0, '127.0.0.1', () => {
        const address = env.server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => env.server.close(resolve));
  });

  const PROTECTED_ENDPOINTS = [
    { method: 'GET', path: '/api/v3/me' },
    { method: 'GET', path: '/api/v3/students/me' },
    { method: 'PATCH', path: '/api/v3/students/me', body: { preferred_name: 'ชาย', version: 1 } },
    { method: 'PUT', path: '/api/v3/students/me', body: { preferred_name: 'ชาย', version: 1 } },
    {
      method: 'POST',
      path: `/api/v3/plans/${PLANS.planA_Draft.id}/submit`,
      body: { version: 1 }
    },
    {
      method: 'POST',
      path: `/api/v3/plans/${PLANS.planA_Submitted.id}/start-review`,
      body: { version: 2 }
    },
    {
      method: 'POST',
      path: `/api/v3/plans/${PLANS.planA_UnderReview.id}/return`,
      body: { version: 3, reason: 'โปรดแก้ไข' }
    },
    {
      method: 'POST',
      path: `/api/v3/plans/${PLANS.planA_UnderReview.id}/approve`,
      body: { version: 3 }
    }
  ];

  describe('1. Unauthenticated & Invalid Token Rejection Across All Protected Endpoints', () => {
    it.each(PROTECTED_ENDPOINTS)(
      'rejects unauthenticated $method $path with 401 UNAUTHORIZED',
      async ({ method, path: routePath, body }) => {
        const response = await fetch(`${baseUrl}${routePath}`, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined
        });
        const payload = await response.json();

        expect(response.status).toBe(401);
        expect(payload.error.code).toBe('UNAUTHORIZED');
      }
    );

    it.each([
      ['malformed token', 'not-a-jwt'],
      [
        'expired token',
        signJwt(makeClaims(ACTORS.studentA.sub, { exp: Math.floor(Date.now() / 1000) - 300 }))
      ],
      [
        'wrong issuer',
        signJwt(makeClaims(ACTORS.studentA.sub, { iss: 'https://evil-idp.example.com/pool' }))
      ],
      [
        'wrong audience / client_id',
        signJwt(makeClaims(ACTORS.studentA.sub, { client_id: 'wrong-client-id' }))
      ],
      [
        'ID token instead of Access token',
        signJwt(makeClaims(ACTORS.studentA.sub, { token_use: 'id' }))
      ],
      [
        'missing required scope',
        signJwt(makeClaims(ACTORS.studentA.sub, { scope: 'openid email' }))
      ],
      [
        'tampered signature (signed with untrusted key)',
        signJwt(
          makeClaims(ACTORS.studentA.sub),
          { alg: 'RS256', typ: 'JWT', kid: 'v3-key-1' },
          untrustedPrivateKey
        )
      ]
    ])('rejects %s with 401 and never leaks raw token in response or logs', async (_label, badToken) => {
      const response = await fetch(`${baseUrl}/api/v3/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${badToken}`
        }
      });
      const text = await response.text();

      expect(response.status).toBe(401);
      expect(text).not.toContain(badToken);
      expect(JSON.stringify(env.auditLogs)).not.toContain(badToken);
    });
  });

  describe('2. Trusted Identity Linking & Disabled/Unlinked/Revoked Accounts', () => {
    it.each([
      ['unlinked external subject', 'sub-unknown-never-linked'],
      ['revoked identity link', ACTORS.revokedLinkUser.sub],
      ['disabled user account', ACTORS.disabledUser.sub],
      ['student role missing linked student record', ACTORS.unlinkedStudentRole.sub]
    ])('denies %s with uniform sanitized 403 FORBIDDEN without leaking account existence', async (_label, sub) => {
      const token = signJwt(makeClaims(sub));
      const response = await fetch(`${baseUrl}/api/v3/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload.error.code).toBe('FORBIDDEN');
      expect(JSON.stringify(payload)).not.toContain(sub);
    });
  });

  describe('3. Zero Trust Against Client-Supplied User/Role/Scope Spoofing', () => {
    it('ignores spoofed X-User-Id, X-Role, and X-Staff-Scope headers when Student A attempts a Staff command', async () => {
      const studentAToken = signJwt(makeClaims(ACTORS.studentA.sub));
      const response = await fetch(
        `${baseUrl}/api/v3/plans/${PLANS.planA_Submitted.id}/start-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${studentAToken}`,
            'Content-Type': 'application/json',
            'X-User-Id': ACTORS.staffCpe.userId,
            'X-Role': 'STAFF',
            'X-Staff-Scope': 'CPE'
          },
          body: JSON.stringify({ version: 2 })
        }
      );

      expect(response.status).toBe(403);
    });

    it('rejects attempts by Student A to inject official or foreign student fields in PATCH /api/v3/students/me', async () => {
      const studentAToken = signJwt(makeClaims(ACTORS.studentA.sub));
      const response = await fetch(`${baseUrl}/api/v3/students/me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          preferred_name: 'ชาย',
          student_id: ACTORS.studentB.studentId,
          role: 'STAFF',
          department: 'EE',
          version: 1
        })
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('4. Role, Ownership, Staff Scope & Advisor Assignment Matrix', () => {
    it('enforces Student ownership: Student A can read/update own profile and submit own Plan, but is denied (403) on Student B Plan and Staff commands', async () => {
      const studentAToken = signJwt(makeClaims(ACTORS.studentA.sub));

      // Allowed: own profile read & update
      const getProfileRes = await fetch(`${baseUrl}/api/v3/students/me`, {
        headers: { Authorization: `Bearer ${studentAToken}` }
      });
      expect(getProfileRes.status).toBe(200);

      const patchProfileRes = await fetch(`${baseUrl}/api/v3/students/me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${studentAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ preferred_name: 'สมชาย (ใหม่)', version: 1 })
      });
      expect(patchProfileRes.status).toBe(200);

      // Allowed: submit own DRAFT plan
      const submitOwnRes = await fetch(
        `${baseUrl}/api/v3/plans/${PLANS.planA_Draft.id}/submit`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${studentAToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(submitOwnRes.status).toBe(200);

      // Denied (403): submit Student B's plan
      const submitForeignRes = await fetch(
        `${baseUrl}/api/v3/plans/${PLANS.planB_Draft.id}/submit`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${studentAToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(submitForeignRes.status).toBe(403);
    });

    it('enforces Staff scope server-side: in-scope CPE Staff succeeds (200) on CPE plan, out-of-scope EE Staff is denied (403)', async () => {
      const staffCpeToken = signJwt(makeClaims(ACTORS.staffCpe.sub));
      const staffEeToken = signJwt(makeClaims(ACTORS.staffEeOutScope.sub));

      // Out-of-scope Staff denied on CPE plan
      const outScopeRes = await fetch(
        `${baseUrl}/api/v3/plans/${PLANS.planA_Submitted.id}/start-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffEeToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 2,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(outScopeRes.status).toBe(403);

      // In-scope CPE Staff allowed on CPE plan
      const inScopeRes = await fetch(
        `${baseUrl}/api/v3/plans/${PLANS.planA_Submitted.id}/start-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffCpeToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 2,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(inScopeRes.status).toBe(200);
    });

    it('enforces Advisor read-only boundary: Advisor can read assigned student/plan, is denied on unassigned student, and is denied on every mutation endpoint', async () => {
      const advisorToken = signJwt(makeClaims(ACTORS.advisorAssigned.sub));
      const advisorContext = {
        isAuthenticated: true,
        userId: ACTORS.advisorAssigned.userId,
        accountStatus: 'ACTIVE',
        role: ROLES.ADVISOR
      };

      // Advisor can read assigned Student A
      await expect(
        env.authorizationService.authorize(advisorContext, ACTIONS.STUDENT_READ_PROFILE, {
          studentId: ACTORS.studentA.studentId
        })
      ).resolves.toMatchObject({ authorized: true });

      // Advisor denied reading unassigned Student B
      await expect(
        env.authorizationService.authorize(advisorContext, ACTIONS.STUDENT_READ_PROFILE, {
          studentId: ACTORS.studentB.studentId
        })
      ).rejects.toMatchObject({ statusCode: 403 });

      // Advisor denied on all mutation endpoints even for assigned Student A
      const mutationTargets = [
        {
          method: 'PATCH',
          path: '/api/v3/students/me',
          body: { preferred_name: 'Hack', version: 1 }
        },
        {
          method: 'POST',
          path: `/api/v3/plans/${PLANS.planA_Draft.id}/submit`,
          body: { version: 1 }
        },
        {
          method: 'POST',
          path: `/api/v3/plans/${PLANS.planA_Submitted.id}/start-review`,
          body: { version: 2 }
        },
        {
          method: 'POST',
          path: `/api/v3/plans/${PLANS.planA_UnderReview.id}/return`,
          body: { version: 3, reason: 'Advisor cannot return' }
        },
        {
          method: 'POST',
          path: `/api/v3/plans/${PLANS.planA_UnderReview.id}/approve`,
          body: { version: 3 }
        }
      ];

      for (const target of mutationTargets) {
        const res = await fetch(`${baseUrl}${target.path}`, {
          method: target.method,
          headers: {
            Authorization: `Bearer ${advisorToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(target.body)
        });
        expect(res.status).toBe(403);
      }
    });
  });

  describe('5. Public V2 Company Directory Regression', () => {
    it.each([
      '/api/health',
      '/api/companies',
      '/api/companies/10000000-0000-4000-8000-000000000001',
      '/api/companies/10000000-0000-4000-8000-000000000001/positions',
      '/api/positions/20000000-0000-4000-8000-000000000001'
    ])('keeps %s publicly accessible without an Authorization header', async (publicPath) => {
      const response = await fetch(`${baseUrl}${publicPath}`);
      expect(response.status).toBe(200);
    });
  });
});
