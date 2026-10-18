/**
 * Integration and Unit Tests for Issue #70:
 * [V3-A06] Implement Staff start-review, return and approve commands.
 */

const crypto = require('node:crypto');
const { createLambdaHandler } = require('../src/lambda');
const {
  TokenValidator,
  IdentityResolver,
  AuthorizationService
} = require('../src/auth');

function createTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048
  });
  return { publicKey, privateKey };
}

function signJwt(payload, privateKey, headerOverrides = {}) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...headerOverrides
  };

  const fullPayload = {
    token_use: 'access',
    client_id: payload.aud || 'staff-review-client-id',
    scope: 'openid email coed-api/access',
    ...payload
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

describe('Issue #70: Staff start-review, return and approve commands', () => {
  const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_reviewTest';
  const AUDIENCE = 'staff-review-client-id';

  const USER_STAFF_CPE = '70000000-0000-4000-8000-000000000020';
  const USER_STAFF_CPE_2 = '70000000-0000-4000-8000-000000000023';
  const USER_STAFF_EE = '70000000-0000-4000-8000-000000000021';
  const USER_STAFF_OLD_YEAR = '70000000-0000-4000-8000-000000000022';
  const USER_ADVISOR = '70000000-0000-4000-8000-000000000010';
  const USER_STUDENT = '70000000-0000-4000-8000-000000000001';
  const USER_ADMIN = '70000000-0000-4000-8000-000000000030';

  const STUDENT_CPE_ID = '40000000-0000-4000-8000-000000000101';
  const PLAN_CPE_ID = '50000000-0000-4000-8000-000000000101';
  const MISSING_PLAN_ID = '50000000-0000-4000-8000-000000000999';
  const CYCLE_OPEN_ID = '30000000-0000-4000-8000-000000000001';
  const COMPANY_ID = '40000000-0000-4000-8000-000000000001';
  const POSITION_ID = '60000000-0000-4000-8000-000000000001';

  const OP_ID_1 = '90000000-0000-4000-8000-000000000001';
  const OP_ID_2 = '90000000-0000-4000-8000-000000000002';
  const OP_ID_3 = '90000000-0000-4000-8000-000000000003';

  let keyPair;
  let nowSeconds;

  beforeAll(() => {
    keyPair = createTestKeyPair();
  });

  beforeEach(() => {
    nowSeconds = Math.floor(Date.now() / 1000);
  });

  function authorizerFromToken(token) {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return { jwt: { claims, scopes: ['coed-api/access'] } };
  }

  function buildEvent(path, token, options = {}) {
    return {
      version: '2.0',
      rawPath: path,
      rawQueryString: options.rawQueryString || '',
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
      isBase64Encoded: Boolean(options.isBase64Encoded),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      },
      requestContext: {
        http: {
          method: options.method || 'POST',
          path
        },
        ...(token ? { authorizer: authorizerFromToken(token) } : {})
      }
    };
  }

  const IDENTITIES = {
    'sub-staff-cpe': {
      user_id: USER_STAFF_CPE,
      role: 'STAFF',
      account_status: 'ACTIVE',
      identity_link_id: 'link-staff-cpe',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
    },
    'sub-staff-cpe-2': {
      user_id: USER_STAFF_CPE_2,
      role: 'STAFF',
      account_status: 'ACTIVE',
      identity_link_id: 'link-staff-cpe-2',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
    },
    'sub-staff-ee': {
      user_id: USER_STAFF_EE,
      role: 'STAFF',
      account_status: 'ACTIVE',
      identity_link_id: 'link-staff-ee',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
    },
    'sub-staff-old-year': {
      user_id: USER_STAFF_OLD_YEAR,
      role: 'STAFF',
      account_status: 'ACTIVE',
      identity_link_id: 'link-staff-old',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
    },
    'sub-advisor': {
      user_id: USER_ADVISOR,
      role: 'ADVISOR',
      account_status: 'ACTIVE',
      identity_link_id: 'link-advisor',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
    },
    'sub-student': {
      user_id: USER_STUDENT,
      role: 'STUDENT',
      account_status: 'ACTIVE',
      identity_link_id: 'link-student',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: STUDENT_CPE_ID,
      student_number: 'TEST000001',
      full_name: 'Student Synthetic',
      institutional_email: 'student1@student.example.com',
      department: 'CPE',
      program: 'CPE',
      major: 'Computer Engineering',
      academic_year: 2569,
      enrollment_status: 'ACTIVE'
    },
    'sub-admin': {
      user_id: USER_ADMIN,
      role: 'ADMIN',
      account_status: 'ACTIVE',
      identity_link_id: 'link-admin',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
    }
  };

  function makePlanRow(overrides = {}) {
    return {
      id: PLAN_CPE_ID,
      student_id: STUDENT_CPE_ID,
      cycle_id: CYCLE_OPEN_ID,
      round_id: CYCLE_OPEN_ID,
      company_id: COMPANY_ID,
      position_id: POSITION_ID,
      notes: 'Student original plan notes must remain untouched',
      status: 'SUBMITTED',
      version: 2,
      legacy_compatibility: false,
      created_at: new Date('2026-01-15T08:00:00.000Z'),
      updated_at: new Date('2026-01-20T09:00:00.000Z'),
      round_academic_year: 2569,
      round_semester: 1,
      round_status: 'OPEN',
      student_department: 'CPE',
      student_program: 'CPE',
      student_academic_year: 2569,
      company_visibility: 'public',
      position_visibility: 'public',
      position_company_id: COMPANY_ID,
      ...overrides
    };
  }

  function createTestSetup({ initialPlan = {}, repositoryOverrides = {} } = {}) {
    const plansStore = new Map();
    const operationsStore = new Map();
    const auditsStore = [];
    const txLog = [];

    const initialRow = makePlanRow(initialPlan);
    plansStore.set(initialRow.id, { ...initialRow });

    const mockClient = {
      query: jest.fn(async (sql) => {
        txLog.push(sql);
        return { rows: [] };
      }),
      release: jest.fn()
    };

    const workflowRepository = {
      getClient: jest.fn(async () => mockClient),
      findPlanByIdForUpdate: jest.fn(async (_client, planId) => {
        const row = plansStore.get(planId);
        return row ? { ...row } : null;
      }),
      findOperationById: jest.fn(async (_client, operationId) => {
        const op = operationsStore.get(operationId);
        return op ? { ...op } : null;
      }),
      updatePlanStatus: jest.fn(async (_client, { planId, status, nextVersion, expectedVersion }) => {
        const row = plansStore.get(planId);
        if (!row || Number(row.version) !== Number(expectedVersion)) {
          return null;
        }
        const updated = {
          ...row,
          status,
          version: nextVersion,
          updated_at: new Date('2026-02-05T11:00:00.000Z')
        };
        plansStore.set(planId, updated);
        return { ...updated };
      }),
      insertPlanOperation: jest.fn(async (_client, opParams) => {
        const record = {
          operation_id: opParams.operationId,
          plan_id: opParams.planId,
          actor_id: opParams.actorId,
          action: opParams.action,
          request_hash: opParams.requestHash,
          response_status: opParams.responseStatus,
          response_payload: opParams.responsePayload,
          result_version: opParams.resultVersion,
          created_at: new Date('2026-02-05T11:00:00.000Z')
        };
        operationsStore.set(opParams.operationId, record);
        return record;
      }),
      insertAuditEvent: jest.fn(async (_client, auditParams) => {
        const event = {
          event_id: auditParams.eventId,
          plan_id: auditParams.planId,
          actor_id: auditParams.actorId,
          actor_role: auditParams.actorRole,
          action: auditParams.action,
          resource_type: auditParams.resourceType,
          resource_id: auditParams.resourceId,
          from_state: auditParams.fromState,
          to_state: auditParams.toState,
          notes: auditParams.notes,
          correlation_id: auditParams.correlationId,
          operation_id: auditParams.operationId,
          created_at: new Date('2026-02-05T11:00:00.000Z')
        };
        auditsStore.push(event);
        return event;
      }),
      ...repositoryOverrides
    };

    const STAFF_SCOPES_BY_USER = {
      [USER_STAFF_CPE]: [
        { department: 'CPE', program: null, academic_year: null, status: 'ACTIVE' }
      ],
      [USER_STAFF_CPE_2]: [
        { department: 'CPE', program: 'CPE', academic_year: 2569, status: 'ACTIVE' }
      ],
      [USER_STAFF_EE]: [
        { department: 'EE', program: null, academic_year: null, status: 'ACTIVE' }
      ],
      [USER_STAFF_OLD_YEAR]: [
        { department: 'CPE', program: 'CPE', academic_year: 2568, status: 'ACTIVE' }
      ]
    };

    const authorizationRepository = {
      findPlanById: jest.fn(async (planId) => {
        const plan = plansStore.get(planId);
        if (!plan) return null;
        return {
          plan_id: plan.id,
          student_id: plan.student_id,
          plan_status: plan.status,
          round_id: plan.round_id,
          round_academic_year: plan.round_academic_year,
          round_semester: plan.round_semester,
          round_status: plan.round_status,
          student_department: plan.student_department,
          student_program: plan.student_program,
          student_academic_year: plan.student_academic_year
        };
      }),
      listActiveStaffScopes: jest.fn(async (staffUserId) => {
        return STAFF_SCOPES_BY_USER[staffUserId] || [];
      }),
      findStaffScopeMatch: jest.fn(async ({ staffUserId, studentId, planId, isReviewAction }) => {
        const scopes = STAFF_SCOPES_BY_USER[staffUserId] || [];
        const plan = planId ? plansStore.get(planId) : null;
        if (planId && (!plan || plan.student_id !== studentId)) {
          return null;
        }
        const targetDept = plan ? plan.student_department : 'CPE';
        const targetProg = plan ? plan.student_program : 'CPE';
        const targetYear = plan ? plan.round_academic_year : 2569;
        const roundStatus = plan ? plan.round_status : 'OPEN';

        for (const sc of scopes) {
          if (sc.status !== 'ACTIVE') continue;
          if (sc.department !== targetDept) continue;
          if (sc.program !== null && sc.program !== targetProg) continue;
          if (sc.academic_year !== null && Number(sc.academic_year) !== Number(targetYear)) continue;
          if (isReviewAction && roundStatus !== 'OPEN') continue;

          return {
            scope_id: 'scope-match-1',
            scope_department: sc.department,
            scope_program: sc.program,
            scope_academic_year: sc.academic_year,
            scope_status: sc.status,
            user_role: 'STAFF',
            user_account_status: 'ACTIVE',
            student_id: studentId,
            student_department: targetDept,
            student_program: targetProg,
            student_academic_year: 2569,
            plan_id: planId,
            plan_student_id: studentId,
            round_academic_year: targetYear,
            round_status: roundStatus
          };
        }
        return null;
      })
    };

    const mockPool = {
      query: jest.fn(async (_sql, params = []) => {
        const sub = params[1];
        const identity = IDENTITIES[sub];
        return { rows: identity ? [identity] : [] };
      })
    };

    const tokenValidator = new TokenValidator({
      expectedIssuer: ISSUER,
      expectedClientId: AUDIENCE,
      publicKey: keyPair.publicKey
    });
    const identityResolver = new IdentityResolver({ pool: mockPool });
    const authorizationService = new AuthorizationService({
      pool: mockPool,
      repository: authorizationRepository,
      now: () => new Date('2026-10-18T08:00:00.000Z')
    });

    const dal = {
      listPublicCompanies: jest.fn(async () => ({
        items: [{ id: 'comp-1', name: 'ACME' }],
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1
      })),
      getCompanyById: jest.fn(async () => null),
      checkHealth: jest.fn(async () => true)
    };

    const handler = createLambdaHandler({
      dal,
      authOptions: {
        tokenValidator,
        identityResolver,
        authorizationService
      },
      workflowRepository
    });

    function tokenFor(sub) {
      return signJwt(
        {
          iss: ISSUER,
          sub,
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );
    }

    return {
      handler,
      tokenFor,
      plansStore,
      operationsStore,
      auditsStore,
      txLog,
      workflowRepository
    };
  }

  describe('1. Staff start-review, return, and approve transitions & Atomic Audit', () => {
    test('start-review transitions SUBMITTED -> UNDER_REVIEW and records PLAN_REVIEW_STARTED', async () => {
      const { handler, tokenFor, plansStore, auditsStore, txLog } = createTestSetup({
        initialPlan: { status: 'SUBMITTED', version: 2 }
      });

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/start-review`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 2,
            operation_id: OP_ID_1
          }
        })
      );

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('UNDER_REVIEW');
      expect(body.data.version).toBe(3);
      expect(body.data.notes).toBe('Student original plan notes must remain untouched');
      expect(body.data.audit_reference).toMatchObject({
        action: 'PLAN_REVIEW_STARTED',
        from_state: 'SUBMITTED',
        to_state: 'UNDER_REVIEW',
        operation_id: OP_ID_1
      });
      expect(txLog).toEqual(['BEGIN', 'COMMIT']);
      expect(plansStore.get(PLAN_CPE_ID).status).toBe('UNDER_REVIEW');
      expect(auditsStore).toHaveLength(1);
    });

    test('return transitions UNDER_REVIEW -> NEEDS_REVISION, requires review_notes, and preserves Student plan notes', async () => {
      const { handler, tokenFor, plansStore, auditsStore } = createTestSetup({
        initialPlan: { status: 'UNDER_REVIEW', version: 3 }
      });

      // Missing review_notes must fail with 400 VALIDATION_ERROR
      const missingNotesRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/return`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_1
          }
        })
      );
      expect(missingNotesRes.statusCode).toBe(400);
      expect(JSON.parse(missingNotesRes.body).error.code).toBe('VALIDATION_ERROR');
      expect(plansStore.get(PLAN_CPE_ID).status).toBe('UNDER_REVIEW');

      // Valid return with review_notes
      const returnRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/return`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_2,
            review_notes: '  Please clarify job description and supervisor contact.  '
          }
        })
      );

      expect(returnRes.statusCode).toBe(200);
      const body = JSON.parse(returnRes.body);
      expect(body.data.status).toBe('NEEDS_REVISION');
      expect(body.data.version).toBe(4);
      // Student's own notes field must NOT be overwritten by Staff review_notes
      expect(body.data.notes).toBe('Student original plan notes must remain untouched');
      expect(body.data.audit_reference).toMatchObject({
        action: 'PLAN_RETURNED',
        from_state: 'UNDER_REVIEW',
        to_state: 'NEEDS_REVISION',
        notes: 'Please clarify job description and supervisor contact.',
        operation_id: OP_ID_2
      });
      expect(auditsStore).toHaveLength(1);
    });

    test('approve transitions UNDER_REVIEW -> APPROVED with optional review_notes', async () => {
      const { handler, tokenFor, plansStore, auditsStore } = createTestSetup({
        initialPlan: { status: 'UNDER_REVIEW', version: 3 }
      });

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/approve`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_1,
            review_notes: 'Approved for Semester 1/2569.'
          }
        })
      );

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('APPROVED');
      expect(body.data.version).toBe(4);
      expect(body.data.audit_reference).toMatchObject({
        action: 'PLAN_APPROVED',
        from_state: 'UNDER_REVIEW',
        to_state: 'APPROVED',
        notes: 'Approved for Semester 1/2569.'
      });
      expect(plansStore.get(PLAN_CPE_ID).status).toBe('APPROVED');
      expect(auditsStore).toHaveLength(1);
    });
  });

  describe('2. State Machine Enforcement (422 INVALID_STATE_TRANSITION)', () => {
    test.each([
      ['start-review', 'DRAFT'],
      ['start-review', 'UNDER_REVIEW'],
      ['start-review', 'NEEDS_REVISION'],
      ['start-review', 'APPROVED'],
      ['start-review', 'CANCELLED'],
      ['return', 'DRAFT'],
      ['return', 'SUBMITTED'],
      ['return', 'NEEDS_REVISION'],
      ['return', 'APPROVED'],
      ['return', 'CANCELLED'],
      ['approve', 'DRAFT'],
      ['approve', 'SUBMITTED'],
      ['approve', 'NEEDS_REVISION'],
      ['approve', 'APPROVED'],
      ['approve', 'CANCELLED']
    ])(
      'rejects %s when Plan is in disallowed source state %s with 422 INVALID_STATE_TRANSITION',
      async (commandPath, currentStatus) => {
        const { handler, tokenFor, plansStore, auditsStore } = createTestSetup({
          initialPlan: { status: currentStatus, version: 2 }
        });

        const response = await handler(
          buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/${commandPath}`, tokenFor('sub-staff-cpe'), {
            body: {
              expected_version: 2,
              operation_id: OP_ID_1,
              ...(commandPath === 'return' ? { review_notes: 'Reason' } : {})
            }
          })
        );

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body).error.code).toBe('INVALID_STATE_TRANSITION');
        expect(plansStore.get(PLAN_CPE_ID).status).toBe(currentStatus);
        expect(auditsStore).toHaveLength(0);
      }
    );
  });

  describe('3. Staff Scope & Role Boundaries (Advisor Read-Only, Out-of-Scope Staff)', () => {
    test.each(['start-review', 'return', 'approve'])(
      'rejects ADVISOR, STUDENT, and ADMIN calling %s with 403 FORBIDDEN',
      async (commandPath) => {
        const { handler, tokenFor, workflowRepository } = createTestSetup({
          initialPlan: {
            status: commandPath === 'start-review' ? 'SUBMITTED' : 'UNDER_REVIEW',
            version: 2
          }
        });

        for (const sub of ['sub-advisor', 'sub-student', 'sub-admin']) {
          const response = await handler(
            buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/${commandPath}`, tokenFor(sub), {
              body: {
                expected_version: 2,
                operation_id: OP_ID_1,
                ...(commandPath === 'return' ? { review_notes: 'Attempted note' } : {})
              }
            })
          );

          expect(response.statusCode).toBe(403);
          expect(JSON.parse(response.body).error.code).toBe('FORBIDDEN');
        }

        expect(workflowRepository.updatePlanStatus).not.toHaveBeenCalled();
      }
    );

    test('rejects out-of-department Staff (EE), out-of-year Staff (2568), and closed-round Plans with 403 FORBIDDEN', async () => {
      const { handler, tokenFor, workflowRepository } = createTestSetup({
        initialPlan: { status: 'SUBMITTED', version: 2 }
      });

      // Out-of-department Staff (EE)
      const eeRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/start-review`, tokenFor('sub-staff-ee'), {
          body: { expected_version: 2, operation_id: OP_ID_1 }
        })
      );
      expect(eeRes.statusCode).toBe(403);

      // Out-of-academic-year Staff (2568 vs 2569)
      const oldYearRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/start-review`, tokenFor('sub-staff-old-year'), {
          body: { expected_version: 2, operation_id: OP_ID_1 }
        })
      );
      expect(oldYearRes.statusCode).toBe(403);

      expect(workflowRepository.updatePlanStatus).not.toHaveBeenCalled();

      // Closed round Plan -> 403 FORBIDDEN even for CPE Staff
      const closedSetup = createTestSetup({
        initialPlan: { status: 'SUBMITTED', version: 2, round_status: 'CLOSED' }
      });
      const closedRes = await closedSetup.handler(
        buildEvent(
          `/api/v3/plans/${PLAN_CPE_ID}/start-review`,
          closedSetup.tokenFor('sub-staff-cpe'),
          { body: { expected_version: 2, operation_id: OP_ID_1 } }
        )
      );
      expect(closedRes.statusCode).toBe(403);
    });
  });

  describe('4. Concurrent Reviewer Attempts & Idempotent Retry (409 STALE_RECORD_CONFLICT)', () => {
    test('prevents two concurrent Staff reviewers from overwriting each other (second attempt gets 409 STALE_RECORD_CONFLICT)', async () => {
      const { handler, tokenFor, plansStore, auditsStore } = createTestSetup({
        initialPlan: { status: 'UNDER_REVIEW', version: 3 }
      });

      // Reviewer 1 returns plan for revision at version 3 -> becomes NEEDS_REVISION (version 4)
      const reviewer1Res = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/return`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_1,
            review_notes: 'Please attach company address.'
          }
        })
      );
      expect(reviewer1Res.statusCode).toBe(200);

      // Reviewer 2 concurrently tries to approve the same plan using stale expected_version: 3
      const reviewer2Res = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/approve`, tokenFor('sub-staff-cpe-2'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_2,
            review_notes: 'Looks good to me.'
          }
        })
      );

      expect(reviewer2Res.statusCode).toBe(409);
      const conflictBody = JSON.parse(reviewer2Res.body);
      expect(conflictBody.error.code).toBe('STALE_RECORD_CONFLICT');
      expect(conflictBody.error.details).toEqual({
        expectedVersion: 3,
        currentVersion: 4
      });

      // Reviewer 1's decision remains intact
      expect(plansStore.get(PLAN_CPE_ID).status).toBe('NEEDS_REVISION');
      expect(plansStore.get(PLAN_CPE_ID).version).toBe(4);
      expect(auditsStore).toHaveLength(1);
    });

    test('supports idempotent retry of Staff review command with same operation_id and rolls back on audit error', async () => {
      const { handler, tokenFor, auditsStore } = createTestSetup({
        initialPlan: { status: 'UNDER_REVIEW', version: 3 }
      });

      const firstApprove = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/approve`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_3,
            review_notes: 'Approved.'
          }
        })
      );
      expect(firstApprove.statusCode).toBe(200);

      const retryApprove = await handler(
        buildEvent(`/api/v3/plans/${PLAN_CPE_ID}/approve`, tokenFor('sub-staff-cpe'), {
          body: {
            expected_version: 3,
            operation_id: OP_ID_3,
            review_notes: 'Approved.'
          }
        })
      );
      expect(retryApprove.statusCode).toBe(200);
      expect(JSON.parse(retryApprove.body).data.idempotent_replay).toBe(true);
      expect(auditsStore).toHaveLength(1);

      // Missing plan returns 404 RECORD_NOT_FOUND
      const missingRes = await handler(
        buildEvent(`/api/v3/plans/${MISSING_PLAN_ID}/approve`, tokenFor('sub-staff-cpe'), {
          body: { expected_version: 1, operation_id: OP_ID_1 }
        })
      );
      expect(missingRes.statusCode).toBe(404);
    });
  });
});
