const { createLambdaHandler } = require('../src/lambda');
const { attachRequestContext } = require('../src/api/context');
const {
  StudentPlanService,
  RESPONSE_FIELDS
} = require('../src/api/services/student-plan-service');
const {
  ValidationError,
  ForbiddenError,
  ConflictError
} = require('../src/api/errors');

const USER_ID = '10000000-0000-4000-8000-000000000001';
const STUDENT_ID = '20000000-0000-4000-8000-000000000001';
const PLAN_ID = '30000000-0000-4000-8000-000000000001';
const CYCLE_ID = '40000000-0000-4000-8000-000000000001';
const COMPANY_ID = '50000000-0000-4000-8000-000000000001';
const POSITION_ID = '60000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '80000000-0000-4000-8000-000000000001';

const ACTOR = Object.freeze({
  isAuthenticated: true,
  userId: USER_ID,
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  studentId: STUDENT_ID
});

function planRow(overrides = {}) {
  return {
    id: PLAN_ID,
    student_id: STUDENT_ID,
    cycle_id: CYCLE_ID,
    round_id: null,
    company_id: COMPANY_ID,
    position_id: POSITION_ID,
    notes: 'Draft note',
    status: 'DRAFT',
    version: 1,
    created_at: new Date('2026-10-18T00:00:00.000Z'),
    updated_at: new Date('2026-10-18T00:00:00.000Z'),
    source: 'must-not-leak',
    visibility: 'private',
    data_status: 'mock',
    legacy_compatibility: false,
    ...overrides
  };
}

function createClient() {
  return {
    query: jest.fn(async () => ({ rows: [] })),
    release: jest.fn()
  };
}

function createRepository(overrides = {}) {
  const client = createClient();
  const repository = {
    getClient: jest.fn(async () => client),
    findActiveStudentLink: jest.fn(async () => ({ id: STUDENT_ID })),
    findOperationById: jest.fn(async () => null),
    findCycle: jest.fn(async () => ({ id: CYCLE_ID, status: 'OPEN' })),
    findPublicCompany: jest.fn(async () => ({ id: COMPANY_ID })),
    findPublicPosition: jest.fn(async () => ({ id: POSITION_ID, company_id: COMPANY_ID })),
    insertPlan: jest.fn(async (_client, values) => planRow({
      id: values.planId,
      cycle_id: values.cycleId,
      company_id: values.companyId,
      position_id: values.positionId,
      notes: values.notes
    })),
    findPlanByIdForUpdate: jest.fn(async () => planRow()),
    updateOwnPlan: jest.fn(async (_client, values) => planRow({
      cycle_id: values.cycleId,
      company_id: values.companyId,
      position_id: values.positionId,
      notes: values.notes,
      version: 2,
      updated_at: new Date('2026-10-18T00:01:00.000Z')
    })),
    insertPlanOperation: jest.fn(async () => ({})),
    insertAuditEvent: jest.fn(async () => ({})),
    findOwnPlanById: jest.fn(async () => planRow()),
    listOwnPlans: jest.fn(async () => ({ items: [planRow()], total: 1 })),
    ...overrides
  };
  return { repository, client };
}

describe('Issue #66 Student Own Plan service', () => {
  test('creates a DRAFT atomically, normalizes notes, and records operation/audit without note content', async () => {
    const { repository, client } = createRepository();
    const service = new StudentPlanService({ repository, uuid: () => PLAN_ID });

    const result = await service.createOwnPlan(ACTOR, {
      cycle_id: CYCLE_ID,
      company_id: COMPANY_ID,
      position_id: POSITION_ID,
      notes: '  Draft note  ',
      operation_id: OPERATION_ID,
      correlation_id: CORRELATION_ID
    });

    expect(result.plan.notes).toBe('Draft note');
    expect(result.plan.status).toBe('DRAFT');
    expect(Object.keys(result.plan)).toEqual(RESPONSE_FIELDS);
    expect(repository.insertPlan).toHaveBeenCalledWith(client, expect.objectContaining({
      studentId: STUDENT_ID,
      cycleId: CYCLE_ID,
      notes: 'Draft note'
    }));
    expect(repository.insertAuditEvent).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'PLAN_CREATED',
      fromState: null,
      toState: 'DRAFT',
      notes: null,
      operationId: OPERATION_ID
    }));
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rejects client-owned system fields before opening a transaction', async () => {
    const { repository } = createRepository();
    const service = new StudentPlanService({ repository });
    await expect(service.createOwnPlan(ACTOR, {
      cycle_id: CYCLE_ID,
      operation_id: OPERATION_ID,
      student_id: STUDENT_ID
    })).rejects.toBeInstanceOf(ValidationError);
    expect(repository.getClient).not.toHaveBeenCalled();
  });

  test('rejects a Position that does not belong to the selected public Company and rolls back', async () => {
    const { repository, client } = createRepository({
      findPublicPosition: jest.fn(async () => ({
        id: POSITION_ID,
        company_id: '50000000-0000-4000-8000-000000000099'
      }))
    });
    const service = new StudentPlanService({ repository });
    await expect(service.createOwnPlan(ACTOR, {
      cycle_id: CYCLE_ID,
      company_id: COMPANY_ID,
      position_id: POSITION_ID,
      operation_id: OPERATION_ID
    })).rejects.toBeInstanceOf(ValidationError);
    expect(repository.insertPlan).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  test('returns an exact create retry without a duplicate Plan or audit event', async () => {
    const storedPlan = planRow();
    const { repository } = createRepository();
    const service = new StudentPlanService({ repository, uuid: () => PLAN_ID });
    const body = {
      cycle_id: CYCLE_ID,
      company_id: COMPANY_ID,
      position_id: POSITION_ID,
      notes: 'Draft note',
      operation_id: OPERATION_ID
    };
    const first = await service.createOwnPlan(ACTOR, body);
    const operationCall = repository.insertPlanOperation.mock.calls[0][1];
    repository.findOperationById.mockResolvedValueOnce({
      operation_id: OPERATION_ID,
      plan_id: PLAN_ID,
      actor_id: USER_ID,
      action: 'plan:create',
      request_hash: operationCall.requestHash,
      response_payload: storedPlan
    });

    const replay = await service.createOwnPlan(ACTOR, body);
    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(repository.insertPlan).toHaveBeenCalledTimes(1);
    expect(repository.insertAuditEvent).toHaveBeenCalledTimes(1);
  });

  test('rejects an operation key reused with another payload', async () => {
    const { repository } = createRepository({
      findOperationById: jest.fn(async () => ({
        operation_id: OPERATION_ID,
        plan_id: PLAN_ID,
        actor_id: USER_ID,
        action: 'plan:create',
        request_hash: 'a'.repeat(64),
        response_payload: planRow()
      }))
    });
    const service = new StudentPlanService({ repository });
    await expect(service.createOwnPlan(ACTOR, {
      cycle_id: CYCLE_ID,
      operation_id: OPERATION_ID
    })).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  test('updates only an owned editable Plan and increments version with immutable audit metadata', async () => {
    const { repository, client } = createRepository();
    const service = new StudentPlanService({ repository, uuid: () => CORRELATION_ID });
    const result = await service.updateOwnPlan(ACTOR, PLAN_ID, {
      notes: '  Revised  ',
      expected_version: 1,
      operation_id: OPERATION_ID
    });
    expect(result.plan.version).toBe(2);
    expect(result.plan.notes).toBe('Revised');
    expect(repository.updateOwnPlan).toHaveBeenCalledWith(client, expect.objectContaining({
      planId: PLAN_ID,
      studentId: STUDENT_ID,
      expectedVersion: 1,
      notes: 'Revised'
    }));
    expect(repository.insertAuditEvent).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'PLAN_DRAFT_UPDATED',
      fromState: 'DRAFT',
      toState: 'DRAFT',
      notes: null
    }));
  });

  test('rejects stale updates with 409 and creates no operation or audit', async () => {
    const { repository, client } = createRepository({
      findPlanByIdForUpdate: jest.fn(async () => planRow({ version: 2 }))
    });
    const service = new StudentPlanService({ repository });
    await expect(service.updateOwnPlan(ACTOR, PLAN_ID, {
      notes: 'stale',
      expected_version: 1,
      operation_id: OPERATION_ID
    })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_RECORD_CONFLICT' });
    expect(repository.updateOwnPlan).not.toHaveBeenCalled();
    expect(repository.insertPlanOperation).not.toHaveBeenCalled();
    expect(repository.insertAuditEvent).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  test('rejects cross-student access and non-editable states without writes', async () => {
    const foreign = createRepository({
      findPlanByIdForUpdate: jest.fn(async () => planRow({
        student_id: '20000000-0000-4000-8000-000000000099'
      }))
    });
    const foreignService = new StudentPlanService({ repository: foreign.repository });
    await expect(foreignService.updateOwnPlan(ACTOR, PLAN_ID, {
      notes: 'blocked', expected_version: 1, operation_id: OPERATION_ID
    })).rejects.toBeInstanceOf(ForbiddenError);

    const submitted = createRepository({
      findPlanByIdForUpdate: jest.fn(async () => planRow({ status: 'SUBMITTED' }))
    });
    const submittedService = new StudentPlanService({ repository: submitted.repository });
    await expect(submittedService.updateOwnPlan(ACTOR, PLAN_ID, {
      notes: 'blocked', expected_version: 1, operation_id: OPERATION_ID
    })).rejects.toMatchObject({ statusCode: 403, code: 'PLAN_STATE_NOT_EDITABLE' });
    expect(submitted.repository.updateOwnPlan).not.toHaveBeenCalled();
  });

  test('requires explicit position_id whenever company_id changes', async () => {
    const { repository } = createRepository();
    const service = new StudentPlanService({ repository });
    await expect(service.updateOwnPlan(ACTOR, PLAN_ID, {
      company_id: COMPANY_ID,
      expected_version: 1,
      operation_id: OPERATION_ID
    })).rejects.toBeInstanceOf(ValidationError);
    expect(repository.getClient).not.toHaveBeenCalled();
  });

  test('lists cancelled history with validated pagination and masks private columns', async () => {
    const { repository } = createRepository({
      listOwnPlans: jest.fn(async () => ({
        items: [planRow({ status: 'CANCELLED' })],
        total: 1
      }))
    });
    const service = new StudentPlanService({ repository });
    const result = await service.listOwnPlans(ACTOR, { page: '1', pageSize: '10' });
    expect(result.items[0].status).toBe('CANCELLED');
    expect(result.items[0]).not.toHaveProperty('student_id');
    expect(result.items[0]).not.toHaveProperty('source');
    expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
  });
});

describe('Issue #66 HTTP route contract', () => {
  function buildEvent(path, { method = 'GET', query = '', body } = {}) {
    return {
      version: '2.0',
      rawPath: path,
      rawQueryString: query,
      headers: {},
      body: body === undefined ? undefined : JSON.stringify(body),
      requestContext: { http: { method, path } }
    };
  }

  function createHandler(overrides = {}) {
    const studentPlanService = {
      createOwnPlan: jest.fn(async () => ({ plan: planRow() })),
      listOwnPlans: jest.fn(async () => ({
        items: [planRow()],
        pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }
      })),
      getOwnPlan: jest.fn(async () => planRow()),
      updateOwnPlan: jest.fn(async () => ({ plan: planRow({ version: 2 }) })),
      ...overrides
    };
    const authMiddleware = async (request) => attachRequestContext(request, ACTOR);
    const authorizationService = {
      authorize: jest.fn(async () => ({ authorized: true, scopeMode: 'OWN' }))
    };
    const dal = {
      checkHealth: jest.fn(async () => true),
      listPublicCompanies: jest.fn(async () => ({
        items: [{ id: COMPANY_ID, name: 'Public Company' }],
        page: 1, pageSize: 10, total: 1, totalPages: 1
      })),
      getCompanyById: jest.fn(async () => null)
    };
    return {
      handler: createLambdaHandler({
        dal,
        authOptions: { authMiddleware, authorizationService },
        studentPlanService
      }),
      studentPlanService,
      dal
    };
  }

  test('POST /api/v3/plans returns the shared success envelope with 201', async () => {
    const { handler, studentPlanService } = createHandler();
    const response = await handler(buildEvent('/api/v3/plans', {
      method: 'POST',
      body: { cycle_id: CYCLE_ID, operation_id: OPERATION_ID }
    }));
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).data.id).toBe(PLAN_ID);
    expect(studentPlanService.createOwnPlan).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: STUDENT_ID }),
      { cycle_id: CYCLE_ID, operation_id: OPERATION_ID }
    );
  });

  test('GET list forwards filters and returns pagination; unknown query fields are rejected', async () => {
    const { handler, studentPlanService } = createHandler();
    const response = await handler(buildEvent('/api/v3/plans', {
      query: `page=1&pageSize=10&cycle_id=${CYCLE_ID}&status=DRAFT`
    }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).pagination.total).toBe(1);
    expect(studentPlanService.listOwnPlans).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: STUDENT_ID }),
      { page: '1', pageSize: '10', cycle_id: CYCLE_ID, status: 'DRAFT' }
    );

    const rejected = await handler(buildEvent('/api/v3/plans', { query: 'student_id=other' }));
    expect(rejected.statusCode).toBe(400);
  });

  test('PATCH forwards only to content service and never updates workflow state directly', async () => {
    const { handler, studentPlanService } = createHandler();
    const body = { notes: 'new', expected_version: 1, operation_id: OPERATION_ID };
    const response = await handler(buildEvent(`/api/v3/plans/${PLAN_ID}`, {
      method: 'PATCH', body
    }));
    expect(response.statusCode).toBe(200);
    expect(studentPlanService.updateOwnPlan).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: STUDENT_ID }), PLAN_ID, body
    );
  });

  test('keeps the existing public Company Directory available without authentication', async () => {
    const { handler, dal } = createHandler();
    const response = await handler(buildEvent('/api/companies'));
    expect(response.statusCode).toBe(200);
    expect(dal.listPublicCompanies).toHaveBeenCalledTimes(1);
  });
});
