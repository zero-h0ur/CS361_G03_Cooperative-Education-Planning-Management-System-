/**
 * Integration and Unit Tests for Issue #69:
 * [V3-A04] Implement Student Plan submission transaction (POST /api/v3/plans/:planId/submit).
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
    client_id: payload.aud || 'plan-submit-client-id',
    scope: 'openid email coed-api/access',
    ...payload
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

describe('Issue #69: Student Plan submission transaction (POST /api/v3/plans/:planId/submit)', () => {
  const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_submitTest';
  const AUDIENCE = 'plan-submit-client-id';

  const USER_STUDENT_A = '10000000-0000-4000-8000-000000000001';
  const USER_STUDENT_B = '10000000-0000-4000-8000-000000000002';
  const USER_ADVISOR = '10000000-0000-4000-8000-000000000010';
  const USER_STAFF = '10000000-0000-4000-8000-000000000020';
  const USER_ADMIN = '10000000-0000-4000-8000-000000000030';

  const STUDENT_A_ID = '20000000-0000-4000-8000-000000000001';
  const STUDENT_B_ID = '20000000-0000-4000-8000-000000000002';

  const PLAN_A_ID = '50000000-0000-4000-8000-000000000101';
  const PLAN_B_ID = '50000000-0000-4000-8000-000000000102';
  const MISSING_PLAN_ID = '50000000-0000-4000-8000-000000000999';

  const CYCLE_OPEN_ID = '30000000-0000-4000-8000-000000000001';
  const COMPANY_PUBLIC_ID = '40000000-0000-4000-8000-000000000001';
  const COMPANY_OTHER_ID = '40000000-0000-4000-8000-000000000002';
  const POSITION_PUBLIC_ID = '60000000-0000-4000-8000-000000000001';

  const OP_ID_1 = '70000000-0000-4000-8000-000000000001';
  const OP_ID_2 = '70000000-0000-4000-8000-000000000002';
  const CORRELATION_ID_1 = '80000000-0000-4000-8000-000000000001';

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
    'sub-student-a': {
      user_id: USER_STUDENT_A,
      role: 'STUDENT',
      account_status: 'ACTIVE',
      identity_link_id: 'link-stu-a',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: STUDENT_A_ID,
      student_number: 'TEST000001',
      full_name: 'Student A Synthetic',
      institutional_email: 'studenta@student.example.com',
      department: 'CPE',
      program: 'CPE',
      major: 'Computer Engineering',
      academic_year: 2569,
      enrollment_status: 'ACTIVE'
    },
    'sub-student-b': {
      user_id: USER_STUDENT_B,
      role: 'STUDENT',
      account_status: 'ACTIVE',
      identity_link_id: 'link-stu-b',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: STUDENT_B_ID,
      student_number: 'TEST000002',
      full_name: 'Student B Synthetic',
      institutional_email: 'studentb@student.example.com',
      department: 'CPE',
      program: 'CPE',
      major: 'Computer Engineering',
      academic_year: 2569,
      enrollment_status: 'ACTIVE'
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
    'sub-staff': {
      user_id: USER_STAFF,
      role: 'STAFF',
      account_status: 'ACTIVE',
      identity_link_id: 'link-staff',
      link_status: 'ACTIVE',
      active_link_count: 1,
      student_id: null
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
      id: PLAN_A_ID,
      student_id: STUDENT_A_ID,
      cycle_id: CYCLE_OPEN_ID,
      round_id: CYCLE_OPEN_ID,
      company_id: COMPANY_PUBLIC_ID,
      position_id: POSITION_PUBLIC_ID,
      notes: 'Interested in backend engineering internship',
      status: 'DRAFT',
      version: 1,
      legacy_compatibility: false,
      created_at: new Date('2026-01-15T08:00:00.000Z'),
      updated_at: new Date('2026-01-15T09:00:00.000Z'),
      round_academic_year: 2569,
      round_semester: 1,
      round_status: 'OPEN',
      student_department: 'CPE',
      student_program: 'CPE',
      student_academic_year: 2569,
      company_visibility: 'public',
      position_visibility: 'public',
      position_company_id: COMPANY_PUBLIC_ID,
      ...overrides
    };
  }

  function createTestSetup({ initialPlans = {}, repositoryOverrides = {} } = {}) {
    const plansStore = new Map();
    const operationsStore = new Map();
    const auditsStore = [];
    const txLog = [];

    const defaultPlans = {
      [PLAN_A_ID]: makePlanRow(),
      [PLAN_B_ID]: makePlanRow({ id: PLAN_B_ID, student_id: STUDENT_B_ID }),
      ...initialPlans
    };

    for (const [id, row] of Object.entries(defaultPlans)) {
      if (row) {
        plansStore.set(id, { ...row });
      }
    }

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
          updated_at: new Date('2026-02-01T10:00:00.000Z')
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
          created_at: new Date('2026-02-01T10:00:00.000Z')
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
          created_at: new Date('2026-02-01T10:00:00.000Z')
        };
        auditsStore.push(event);
        return event;
      }),
      ...repositoryOverrides
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
    // The central policy reads Plan ownership from the same store as the workflow repository,
    // mirroring a single database in production (#62 resolves planId -> owner before the handler)
    const authorizationService = new AuthorizationService({
      repository: {
        findPlanById: jest.fn(async (planId) => {
          const row = plansStore.get(planId);
          return row
            ? { plan_id: row.id, student_id: row.student_id, plan_status: row.status, plan_version: row.version }
            : null;
        })
      },
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
      mockClient,
      workflowRepository
    };
  }

  describe('1. Successful Plan Submission & Atomic Audit Trail', () => {
    test('submits an owned DRAFT Plan, transitions to SUBMITTED, increments version, and returns audit reference', async () => {
      const { handler, tokenFor, plansStore, auditsStore, txLog } = createTestSetup();
      const token = tokenFor('sub-student-a');

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_1,
            correlation_id: CORRELATION_ID_1
          }
        })
      );

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.body);
      expect(payload).toEqual({
        data: {
          id: PLAN_A_ID,
          student_id: STUDENT_A_ID,
          cycle_id: CYCLE_OPEN_ID,
          company_id: COMPANY_PUBLIC_ID,
          position_id: POSITION_PUBLIC_ID,
          notes: 'Interested in backend engineering internship',
          status: 'SUBMITTED',
          version: 2,
          created_at: '2026-01-15T08:00:00.000Z',
          updated_at: '2026-02-01T10:00:00.000Z',
          operation_id: OP_ID_1,
          idempotent_replay: false,
          audit_reference: {
            event_id: expect.any(String),
            action: 'PLAN_SUBMITTED',
            from_state: 'DRAFT',
            to_state: 'SUBMITTED',
            notes: null,
            operation_id: OP_ID_1,
            correlation_id: CORRELATION_ID_1,
            created_at: '2026-02-01T10:00:00.000Z'
          }
        }
      });

      // Verify internal fields are never leaked
      expect(payload.data).not.toHaveProperty('request_hash');
      expect(payload.data).not.toHaveProperty('company_visibility');

      // Verify single database transaction and audit event recorded
      expect(txLog).toEqual(['BEGIN', 'COMMIT']);
      expect(plansStore.get(PLAN_A_ID).status).toBe('SUBMITTED');
      expect(plansStore.get(PLAN_A_ID).version).toBe(2);
      expect(auditsStore).toHaveLength(1);
      expect(auditsStore[0]).toMatchObject({
        plan_id: PLAN_A_ID,
        actor_id: USER_STUDENT_A,
        actor_role: 'STUDENT',
        action: 'PLAN_SUBMITTED',
        from_state: 'DRAFT',
        to_state: 'SUBMITTED',
        operation_id: OP_ID_1
      });
    });

    test('submits an owned NEEDS_REVISION Plan back to SUBMITTED', async () => {
      const { handler, tokenFor, auditsStore } = createTestSetup({
        initialPlans: {
          [PLAN_A_ID]: makePlanRow({ status: 'NEEDS_REVISION', version: 3 })
        }
      });
      const token = tokenFor('sub-student-a');

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 3,
            operation_id: OP_ID_1
          }
        })
      );

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('SUBMITTED');
      expect(body.data.version).toBe(4);
      expect(body.data.audit_reference.from_state).toBe('NEEDS_REVISION');
      expect(body.data.audit_reference.to_state).toBe('SUBMITTED');
      expect(auditsStore).toHaveLength(1);
    });
  });

  describe('2. Precondition & Payload Validation (400 VALIDATION_ERROR, No State Change)', () => {
    test.each([
      ['missing cycle_id', { cycle_id: null }, 'cycle_id'],
      ['closed cycle/round', { round_status: 'CLOSED' }, 'cycle_id'],
      ['missing company_id', { company_id: null }, 'company_id'],
      ['missing position_id', { position_id: null }, 'position_id'],
      ['non-public company', { company_visibility: 'private' }, 'company_id'],
      ['non-public position', { position_visibility: 'internal' }, 'position_id'],
      ['position from another company', { position_company_id: COMPANY_OTHER_ID }, 'position_id']
    ])(
      'rejects incomplete/invalid Plan (%s) with 400 VALIDATION_ERROR and leaves state unchanged',
      async (_label, planOverrides, expectedField) => {
        const { handler, tokenFor, plansStore, auditsStore, txLog } = createTestSetup({
          initialPlans: {
            [PLAN_A_ID]: makePlanRow(planOverrides)
          }
        });
        const token = tokenFor('sub-student-a');

        const response = await handler(
          buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
            body: {
              expected_version: 1,
              operation_id: OP_ID_1
            }
          })
        );

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(body.error.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: expectedField })
          ])
        );

        expect(txLog).toContain('ROLLBACK');
        expect(plansStore.get(PLAN_A_ID).status).toBe('DRAFT');
        expect(plansStore.get(PLAN_A_ID).version).toBe(1);
        expect(auditsStore).toHaveLength(0);
      }
    );

    test('rejects missing expected_version, missing operation_id, unknown fields, or query params with 400 VALIDATION_ERROR', async () => {
      const { handler, tokenFor, workflowRepository } = createTestSetup();
      const token = tokenFor('sub-student-a');

      // Missing operation_id
      const noOpRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: { expected_version: 1 }
        })
      );
      expect(noOpRes.statusCode).toBe(400);

      // Missing expected_version
      const noVerRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: { operation_id: OP_ID_1 }
        })
      );
      expect(noVerRes.statusCode).toBe(400);

      // Unknown or disallowed body override field
      const overrideRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_1,
            student_id: STUDENT_B_ID
          }
        })
      );
      expect(overrideRes.statusCode).toBe(400);

      // Disallowed query parameter
      const queryRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          rawQueryString: 'force=true',
          body: {
            expected_version: 1,
            operation_id: OP_ID_1
          }
        })
      );
      expect(queryRes.statusCode).toBe(400);

      expect(workflowRepository.updatePlanStatus).not.toHaveBeenCalled();
    });
  });

  describe('3. Idempotent Retry, Stale Version (409), and Illegal State (422)', () => {
    test('returns 200 OK with cached result on duplicate retry with same operation_id without incrementing version or duplicating audit', async () => {
      const { handler, tokenFor, plansStore, auditsStore } = createTestSetup();
      const token = tokenFor('sub-student-a');

      const firstRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_1
          }
        })
      );
      expect(firstRes.statusCode).toBe(200);
      expect(JSON.parse(firstRes.body).data.idempotent_replay).toBe(false);

      // Retry identical submit request after plan is already SUBMITTED (version 2)
      const retryRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_1
          }
        })
      );
      expect(retryRes.statusCode).toBe(200);
      const retryPayload = JSON.parse(retryRes.body);
      expect(retryPayload.data.idempotent_replay).toBe(true);
      expect(retryPayload.data.status).toBe('SUBMITTED');
      expect(retryPayload.data.version).toBe(2);

      // Version was NOT incremented again and no second audit event was written
      expect(plansStore.get(PLAN_A_ID).version).toBe(2);
      expect(auditsStore).toHaveLength(1);
    });

    test('returns 409 STALE_RECORD_CONFLICT when submitting with a new operation_id and stale expected_version', async () => {
      const { handler, tokenFor } = createTestSetup({
        initialPlans: {
          [PLAN_A_ID]: makePlanRow({ status: 'DRAFT', version: 3 })
        }
      });
      const token = tokenFor('sub-student-a');

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_2
          }
        })
      );

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('STALE_RECORD_CONFLICT');
    });

    test('returns 422 INVALID_STATE_TRANSITION when Plan is already SUBMITTED, UNDER_REVIEW, APPROVED, or CANCELLED', async () => {
      for (const illegalStatus of ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CANCELLED']) {
        const { handler, tokenFor } = createTestSetup({
          initialPlans: {
            [PLAN_A_ID]: makePlanRow({ status: illegalStatus, version: 2 })
          }
        });
        const token = tokenFor('sub-student-a');

        const response = await handler(
          buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
            body: {
              expected_version: 2,
              operation_id: OP_ID_2
            }
          })
        );

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body).error.code).toBe('INVALID_STATE_TRANSITION');
      }
    });
  });

  describe('4. Ownership, Role Boundaries (403 FORBIDDEN / 401 UNAUTHORIZED), and Rollback', () => {
    test('rejects Student B attempting to submit Student A Plan with 403 FORBIDDEN', async () => {
      const { handler, tokenFor, plansStore, auditsStore } = createTestSetup();
      const tokenB = tokenFor('sub-student-b');

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, tokenB, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_1
          }
        })
      );

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe('FORBIDDEN');
      expect(plansStore.get(PLAN_A_ID).status).toBe('DRAFT');
      expect(auditsStore).toHaveLength(0);
    });

    test.each(['sub-advisor', 'sub-staff', 'sub-admin'])(
      'rejects non-Student actor (%s) attempting to submit a Plan with 403 FORBIDDEN',
      async (sub) => {
        const { handler, tokenFor, workflowRepository } = createTestSetup();
        const token = tokenFor(sub);

        const response = await handler(
          buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
            body: {
              expected_version: 1,
              operation_id: OP_ID_1
            }
          })
        );

        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.body).error.code).toBe('FORBIDDEN');
        expect(workflowRepository.updatePlanStatus).not.toHaveBeenCalled();
      }
    );

    test('rejects unauthenticated requests with 401 UNAUTHORIZED and missing plans with 404 RECORD_NOT_FOUND', async () => {
      const { handler, tokenFor } = createTestSetup();

      const unauthRes = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, null, {
          body: { expected_version: 1, operation_id: OP_ID_1 }
        })
      );
      expect(unauthRes.statusCode).toBe(401);

      const missingRes = await handler(
        buildEvent(`/api/v3/plans/${MISSING_PLAN_ID}/submit`, tokenFor('sub-student-a'), {
          body: { expected_version: 1, operation_id: OP_ID_1 }
        })
      );
      expect(missingRes.statusCode).toBe(404);
      expect(JSON.parse(missingRes.body).error.code).toBe('RECORD_NOT_FOUND');
    });

    test('rolls back the entire transaction if audit event insertion fails', async () => {
      const { handler, tokenFor, txLog } = createTestSetup({
        repositoryOverrides: {
          insertAuditEvent: jest.fn(async () => {
            throw new Error('Simulated audit insertion failure');
          })
        }
      });
      const token = tokenFor('sub-student-a');

      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, token, {
          body: {
            expected_version: 1,
            operation_id: OP_ID_1
          }
        })
      );

      expect(response.statusCode).toBe(500);
      expect(txLog).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  describe('5. Central policy boundary and response allowlist', () => {
    test('rejects malformed and unknown plan ids in the central policy before the workflow runs', async () => {
      const { handler, tokenFor, workflowRepository } = createTestSetup();
      const token = tokenFor('sub-student-a');

      const malformed = await handler(
        buildEvent('/api/v3/plans/not-a-uuid/submit', token, {
          body: { expected_version: 1, operation_id: OP_ID_1 }
        })
      );
      expect(malformed.statusCode).toBe(400);
      expect(JSON.parse(malformed.body).error.code).toBe('VALIDATION_ERROR');

      const unknown = await handler(
        buildEvent('/api/v3/plans/50000000-0000-4000-8000-0000000009ff/submit', token, {
          body: { expected_version: 1, operation_id: OP_ID_2 }
        })
      );
      expect(unknown.statusCode).toBe(404);
      expect(workflowRepository.getClient).not.toHaveBeenCalled();
    });

    test('returns cycle_id but never the legacy round_id', async () => {
      const { handler, tokenFor } = createTestSetup();
      const response = await handler(
        buildEvent(`/api/v3/plans/${PLAN_A_ID}/submit`, tokenFor('sub-student-a'), {
          body: { expected_version: 1, operation_id: OP_ID_1 }
        })
      );
      expect(response.statusCode).toBe(200);
      const { data } = JSON.parse(response.body);
      expect(data).toHaveProperty('cycle_id');
      expect(data).not.toHaveProperty('round_id');
    });
  });
});
