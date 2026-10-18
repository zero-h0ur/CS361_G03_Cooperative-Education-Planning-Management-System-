/**
 * Comprehensive Tests for Issue #63:
 * [V3-F06] Implement transactional workflow and immutable audit service.
 *
 * Verifies:
 * 1. State machine rules and allowed transitions (#54, #63)
 *    - CANCEL allowed only from DRAFT, SUBMITTED, NEEDS_REVISION (not UNDER_REVIEW)
 * 2. Preconditions and editable constraints (#52 ข้อ 3, ข้อ 6)
 *    - Cycle, public company, and matching public position required for submit
 *    - Review notes optional for approve, mandatory for return_for_revision
 *    - Rejection of unknown fields with 400
 *    - Rejection of conflicting duplicate aliases with 400
 *    - Rejection of missing/invalid client operation_id with 400
 * 3. Centralized role, ownership, and scope authorization (#49, #62)
 * 4. Optimistic concurrency control and conflict responses (409)
 * 5. Idempotent retries via plan_operations (#52 ข้อ 9)
 *    - operation_id match with same payload -> cached response
 *    - operation_id match with different payload/action/actor -> 409 IDEMPOTENCY_KEY_REUSED
 *    - unpermitted actor gets 403 BEFORE idempotency check
 *    - new operation_id with stale expected_version -> 409 STALE_RECORD_CONFLICT
 * 6. Single atomic database transactions and rollback safety
 * 7. Real PostgreSQL concurrency and row-lock serialization
 * 8. Real PostgreSQL idempotent retry verification (no duplicate version or audit event)
 */

const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const {
  PLAN_STATES,
  TERMINAL_STATES,
  ACTIONS,
  AUDIT_ACTIONS,
  TRANSITION_RULES,
  WorkflowService
} = require('../src/api/services/workflow-service');
const { WorkflowRepository } = require('../src/db/repositories/workflow-repository');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InvalidStateTransitionError
} = require('../src/api/errors');

describe('Issue #63: Transactional Workflow and Immutable Audit Service', () => {
  const TEST_PLAN_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_PLAN_ID = '22222222-2222-4222-8222-222222222222';
  const STUDENT_A_ID = '33333333-3333-4333-8333-333333333331';
  const STUDENT_B_ID = '33333333-3333-4333-8333-333333333332';
  const USER_STUDENT_A = '44444444-4444-4444-8444-444444444441';
  const USER_STUDENT_B = '44444444-4444-4444-8444-444444444442';
  const USER_STAFF_1 = '55555555-5555-4555-8555-555555555551';
  const USER_STAFF_2 = '55555555-5555-4555-8555-555555555553';
  const USER_STAFF_OUT_SCOPE = '55555555-5555-4555-8555-555555555552';
  const USER_ADVISOR = '66666666-6666-4666-8666-666666666661';
  const USER_ADMIN = '77777777-7777-4777-8777-777777777771';
  const CYCLE_ID = '88888888-8888-4888-8888-888888888881';
  const COMPANY_ID = '99999999-9999-4999-8999-999999999991';
  const POSITION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function makeOperationId() {
    return crypto.randomUUID();
  }

  function makeStudentContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: USER_STUDENT_A,
      role: 'STUDENT',
      accountStatus: 'ACTIVE',
      studentId: STUDENT_A_ID,
      department: 'Computer Science',
      academicYear: 2568,
      ...overrides
    });
  }

  function makeStaffContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: USER_STAFF_1,
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      studentId: null,
      ...overrides
    });
  }

  function makeAdvisorContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: USER_ADVISOR,
      role: 'ADVISOR',
      accountStatus: 'ACTIVE',
      studentId: null,
      ...overrides
    });
  }

  function makeAdminContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: USER_ADMIN,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      studentId: null,
      ...overrides
    });
  }

  function createMockPlanRow(overrides = {}) {
    return {
      id: TEST_PLAN_ID,
      student_id: STUDENT_A_ID,
      cycle_id: CYCLE_ID,
      round_id: CYCLE_ID,
      company_id: COMPANY_ID,
      position_id: POSITION_ID,
      notes: null,
      status: PLAN_STATES.DRAFT,
      version: 1,
      legacy_compatibility: false,
      created_at: new Date('2026-10-18T00:00:00Z'),
      updated_at: new Date('2026-10-18T00:00:00Z'),
      round_academic_year: 2568,
      round_semester: 1,
      round_status: 'OPEN',
      student_department: 'Computer Science',
      student_program: 'B.Sc.',
      student_academic_year: 2568,
      company_visibility: 'public',
      position_visibility: 'public',
      position_company_id: COMPANY_ID,
      ...overrides
    };
  }

  function createMockRepo(initialPlan = createMockPlanRow(), { scopeMatch = true } = {}) {
    let currentPlan = { ...initialPlan };
    let snapshotPlan = { ...initialPlan };
    const auditLogs = [];
    let pendingAudits = [];
    const operations = [];
    let pendingOperations = [];

    const mockClient = {
      query: jest.fn().mockImplementation(async (sql) => {
        const text = sql.trim();
        if (text === 'BEGIN') {
          snapshotPlan = { ...currentPlan };
          pendingAudits = [];
          pendingOperations = [];
          return { rows: [] };
        }
        if (text === 'COMMIT') {
          auditLogs.push(...pendingAudits);
          operations.push(...pendingOperations);
          pendingAudits = [];
          pendingOperations = [];
          return { rows: [] };
        }
        if (text === 'ROLLBACK') {
          currentPlan = { ...snapshotPlan };
          pendingAudits = [];
          pendingOperations = [];
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: jest.fn()
    };

    const repo = {
      getClient: jest.fn().mockResolvedValue(mockClient),
      mockClient,
      auditLogs,
      operations,
      getCurrentPlan: () => currentPlan,

      findPlanByIdForUpdate: jest.fn().mockImplementation(async (client, planId) => {
        if (planId === currentPlan.id) {
          return { ...currentPlan };
        }
        return null;
      }),

      findOperationById: jest.fn().mockImplementation(async (client, opId) => {
        const allOps = [...operations, ...pendingOperations];
        return allOps.find((op) => op.operation_id === opId) || null;
      }),

      findOperationByRequestHash: jest.fn().mockImplementation(async (client, planId, hash) => {
        const allOps = [...operations, ...pendingOperations];
        return allOps.find((op) => op.plan_id === planId && op.request_hash === hash) || null;
      }),

      findStaffScopeMatch: jest.fn().mockImplementation(async ({ staffUserId, studentId, isReviewAction }) => {
        if (!scopeMatch || staffUserId === USER_STAFF_OUT_SCOPE) {
          return null;
        }
        if (currentPlan.round_status !== 'OPEN' && isReviewAction) {
          return null;
        }
        return {
          scope_id: 'scope-1',
          scope_department: 'Computer Science',
          round_status: currentPlan.round_status
        };
      }),

      updatePlanStatus: jest.fn().mockImplementation(async (client, { planId, status, nextVersion, expectedVersion }) => {
        if (currentPlan.id === planId && Number(currentPlan.version) === Number(expectedVersion)) {
          currentPlan.status = status;
          currentPlan.version = nextVersion;
          currentPlan.updated_at = new Date();
          return { ...currentPlan };
        }
        return null;
      }),

      insertPlanOperation: jest.fn().mockImplementation(async (client, params) => {
        const row = {
          operation_id: params.operationId,
          plan_id: params.planId,
          actor_id: params.actorId,
          action: params.action,
          request_hash: params.requestHash,
          response_status: params.responseStatus,
          response_payload: params.responsePayload,
          result_version: params.resultVersion,
          created_at: new Date()
        };
        pendingOperations.push(row);
        return row;
      }),

      insertAuditEvent: jest.fn().mockImplementation(async (client, params) => {
        const row = {
          event_id: params.eventId,
          plan_id: params.planId,
          actor_id: params.actorId,
          actor_role: params.actorRole,
          action: params.action,
          resource_type: params.resourceType,
          resource_id: params.resourceId,
          from_state: params.fromState,
          to_state: params.toState,
          notes: params.notes,
          correlation_id: params.correlationId,
          operation_id: params.operationId,
          created_at: new Date()
        };
        pendingAudits.push(row);
        return row;
      }),

      listAuditEventsByPlanId: jest.fn().mockImplementation(async (client, planId) => {
        return auditLogs.filter((evt) => evt.plan_id === planId);
      }),

      listPlanOperationsByPlanId: jest.fn().mockImplementation(async (client, planId) => {
        return operations.filter((op) => op.plan_id === planId);
      })
    };

    return repo;
  }

  describe('1. State Machine Transitions & Invariants (#54)', () => {
    it('allows Student to submit a DRAFT Plan with complete fields -> SUBMITTED and version +1', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      const result = await service.submitPlan({
        actor: student,
        plan_id: TEST_PLAN_ID,
        expected_version: 1,
        operation_id: makeOperationId()
      });

      expect(result.plan.status).toBe(PLAN_STATES.SUBMITTED);
      expect(result.plan.version).toBe(2);
      expect(result.fromState).toBe(PLAN_STATES.DRAFT);
      expect(result.toState).toBe(PLAN_STATES.SUBMITTED);

      expect(repo.auditLogs).toHaveLength(1);
      expect(repo.auditLogs[0]).toMatchObject({
        actor_id: USER_STUDENT_A,
        actor_role: 'STUDENT',
        action: 'PLAN_SUBMITTED',
        from_state: PLAN_STATES.DRAFT,
        to_state: PLAN_STATES.SUBMITTED
      });

      expect(repo.operations).toHaveLength(1);
      expect(repo.operations[0].result_version).toBe(2);
      expect(repo.mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(repo.mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('allows Staff to start review on SUBMITTED Plan in OPEN round -> UNDER_REVIEW', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.SUBMITTED, version: 2 }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();

      const result = await service.startReview({
        actor: staff,
        plan_id: TEST_PLAN_ID,
        expected_version: 2,
        operation_id: makeOperationId()
      });

      expect(result.plan.status).toBe(PLAN_STATES.UNDER_REVIEW);
      expect(result.plan.version).toBe(3);
      expect(repo.auditLogs).toHaveLength(1);
      expect(repo.auditLogs[0]).toMatchObject({
        actor_id: USER_STAFF_1,
        actor_role: 'STAFF',
        action: 'PLAN_REVIEW_STARTED',
        from_state: PLAN_STATES.SUBMITTED,
        to_state: PLAN_STATES.UNDER_REVIEW
      });
      expect(repo.findStaffScopeMatch).toHaveBeenCalledWith(expect.objectContaining({
        client: repo.mockClient,
        staffUserId: USER_STAFF_1,
        planId: TEST_PLAN_ID,
        isReviewAction: true
      }));
    });

    it('allows Staff to return UNDER_REVIEW Plan for revision with mandatory notes -> NEEDS_REVISION', async () => {
      const repo = createMockRepo(createMockPlanRow({
        status: PLAN_STATES.UNDER_REVIEW,
        version: 3,
        notes: 'Student-authored plan note'
      }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();

      const result = await service.returnForRevision({
        actor: staff,
        plan_id: TEST_PLAN_ID,
        expected_version: 3,
        operation_id: makeOperationId(),
        review_notes: 'Please add more details regarding project responsibilities.'
      });

      expect(result.plan.status).toBe(PLAN_STATES.NEEDS_REVISION);
      expect(result.plan.version).toBe(4);
      expect(result.plan.notes).toBe('Student-authored plan note');
      expect(repo.auditLogs[0].action).toBe('PLAN_RETURNED');
      expect(repo.auditLogs[0].notes).toBe('Please add more details regarding project responsibilities.');
    });

    it('allows Student to resubmit a NEEDS_REVISION Plan -> SUBMITTED', async () => {
      const repo = createMockRepo(createMockPlanRow({
        status: PLAN_STATES.NEEDS_REVISION,
        version: 4,
        notes: 'Updated project responsibilities.'
      }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      const result = await service.submitPlan({
        actor: student,
        plan_id: TEST_PLAN_ID,
        expected_version: 4,
        operation_id: makeOperationId()
      });

      expect(result.plan.status).toBe(PLAN_STATES.SUBMITTED);
      expect(result.plan.version).toBe(5);
      expect(repo.auditLogs[0]).toMatchObject({
        action: 'PLAN_SUBMITTED',
        from_state: PLAN_STATES.NEEDS_REVISION,
        to_state: PLAN_STATES.SUBMITTED
      });
    });

    it('allows Staff to approve an UNDER_REVIEW Plan -> APPROVED (terminal state) with review_notes optional', async () => {
      // 1. Approve with review_notes
      const repoWithNotes = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 5 }));
      const serviceWithNotes = new WorkflowService({ repository: repoWithNotes });
      const staff = makeStaffContext();

      const resultWithNotes = await serviceWithNotes.approvePlan({
        actor: staff,
        plan_id: TEST_PLAN_ID,
        expected_version: 5,
        operation_id: makeOperationId(),
        review_notes: 'Approved without remarks.'
      });

      expect(resultWithNotes.plan.status).toBe(PLAN_STATES.APPROVED);
      expect(resultWithNotes.plan.version).toBe(6);
      expect(repoWithNotes.auditLogs[0]).toMatchObject({
        action: 'PLAN_APPROVED',
        from_state: PLAN_STATES.UNDER_REVIEW,
        to_state: PLAN_STATES.APPROVED,
        notes: 'Approved without remarks.'
      });

      // 2. Approve without review_notes (#52: optional)
      const repoNoNotes = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 5 }));
      const serviceNoNotes = new WorkflowService({ repository: repoNoNotes });

      const resultNoNotes = await serviceNoNotes.approvePlan({
        actor: staff,
        plan_id: TEST_PLAN_ID,
        expected_version: 5,
        operation_id: makeOperationId()
      });

      expect(resultNoNotes.plan.status).toBe(PLAN_STATES.APPROVED);
      expect(repoNoNotes.auditLogs[0].action).toBe('PLAN_APPROVED');
      expect(repoNoNotes.auditLogs[0].notes).toBeNull();
    });

    it('allows Student to cancel Plan from DRAFT, SUBMITTED, and NEEDS_REVISION -> CANCELLED (#54)', async () => {
      // #54: CANCEL only from DRAFT, SUBMITTED, NEEDS_REVISION (UNDER_REVIEW removed)
      const allowedStates = [
        PLAN_STATES.DRAFT,
        PLAN_STATES.SUBMITTED,
        PLAN_STATES.NEEDS_REVISION
      ];

      for (const st of allowedStates) {
        const repo = createMockRepo(createMockPlanRow({ status: st, version: 1 }));
        const service = new WorkflowService({ repository: repo });
        const student = makeStudentContext();

        const result = await service.cancelPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });

        expect(result.plan.status).toBe(PLAN_STATES.CANCELLED);
        expect(repo.auditLogs[0].action).toBe('PLAN_CANCELLED');
        expect(repo.auditLogs[0].to_state).toBe(PLAN_STATES.CANCELLED);
      }
    });

    it('rejects Student cancel Plan from UNDER_REVIEW with 422 INVALID_STATE_TRANSITION (#54)', async () => {
      // #54 contract: cancel from UNDER_REVIEW is illegal
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 2 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      await expect(
        service.cancelPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 2,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(InvalidStateTransitionError);

      expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.UNDER_REVIEW);
      expect(repo.getCurrentPlan().version).toBe(2);
      expect(repo.auditLogs).toHaveLength(0);
      expect(repo.operations).toHaveLength(0);
    });

    it('rejects any transition attempt on terminal APPROVED or CANCELLED state with 422 INVALID_STATE_TRANSITION', async () => {
      const terminalStates = [PLAN_STATES.APPROVED, PLAN_STATES.CANCELLED];
      const allActions = [
        ACTIONS.PLAN_SUBMIT,
        ACTIONS.PLAN_START_REVIEW,
        ACTIONS.PLAN_RETURN_FOR_REVISION,
        ACTIONS.PLAN_APPROVE,
        ACTIONS.PLAN_CANCEL
      ];

      for (const st of terminalStates) {
        for (const act of allActions) {
          const repo = createMockRepo(createMockPlanRow({ status: st, version: 10 }));
          const service = new WorkflowService({ repository: repo });
          const actor = act === ACTIONS.PLAN_SUBMIT || act === ACTIONS.PLAN_CANCEL
            ? makeStudentContext()
            : makeStaffContext();

          const transitionParams = {
              actor,
              plan_id: TEST_PLAN_ID,
              action: act,
              expected_version: 10,
              operation_id: makeOperationId()
          };
          if (act === ACTIONS.PLAN_RETURN_FOR_REVISION || act === ACTIONS.PLAN_APPROVE) {
            transitionParams.review_notes = 'Attempting invalid move';
          }
          await expect(service.executeTransition(transitionParams)).rejects.toThrow(InvalidStateTransitionError);

          // Acceptance criterion: illegal transition must NOT change Plan and NOT create audit event
          expect(repo.getCurrentPlan().status).toBe(st);
          expect(repo.getCurrentPlan().version).toBe(10);
          expect(repo.auditLogs).toHaveLength(0);
          expect(repo.operations).toHaveLength(0);
        }
      }
    });

    it('rejects illegal transitions (e.g. approve from DRAFT, start_review from DRAFT) with 422', async () => {
      const illegalCombinations = [
        { status: PLAN_STATES.DRAFT, action: ACTIONS.PLAN_APPROVE, actor: makeStaffContext() },
        { status: PLAN_STATES.DRAFT, action: ACTIONS.PLAN_START_REVIEW, actor: makeStaffContext() },
        { status: PLAN_STATES.DRAFT, action: ACTIONS.PLAN_RETURN_FOR_REVISION, actor: makeStaffContext() },
        { status: PLAN_STATES.SUBMITTED, action: ACTIONS.PLAN_APPROVE, actor: makeStaffContext() },
        { status: PLAN_STATES.SUBMITTED, action: ACTIONS.PLAN_RETURN_FOR_REVISION, actor: makeStaffContext() },
        { status: PLAN_STATES.NEEDS_REVISION, action: ACTIONS.PLAN_START_REVIEW, actor: makeStaffContext() },
        { status: PLAN_STATES.NEEDS_REVISION, action: ACTIONS.PLAN_APPROVE, actor: makeStaffContext() }
      ];

      for (const { status, action, actor } of illegalCombinations) {
        const repo = createMockRepo(createMockPlanRow({ status, version: 2 }));
        const service = new WorkflowService({ repository: repo });

        await expect(
          service.executeTransition({
            actor,
            plan_id: TEST_PLAN_ID,
            action,
            expected_version: 2,
            operation_id: makeOperationId(),
            review_notes: 'illegal note'
          })
        ).rejects.toThrow(InvalidStateTransitionError);

        expect(repo.getCurrentPlan().status).toBe(status);
        expect(repo.getCurrentPlan().version).toBe(2);
        expect(repo.auditLogs).toHaveLength(0);
      }
    });
  });

  describe('2. Preconditions and Required Fields Enforcement (#52)', () => {
    it('rejects mutation if operation_id is missing or not a valid UUID with 400 VALIDATION_ERROR (#52 ข้อ 9)', async () => {
      const repo = createMockRepo();
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      const invalidOperationIds = [undefined, null, '', 'not-a-uuid', 12345];

      for (const opId of invalidOperationIds) {
        let caughtErr = null;
        try {
          await service.submitPlan({
            actor: student,
            plan_id: TEST_PLAN_ID,
            expected_version: 1,
            operation_id: opId
          });
        } catch (err) {
          caughtErr = err;
        }

        expect(caughtErr).toBeInstanceOf(ValidationError);
        expect(caughtErr.statusCode).toBe(400);
        expect(caughtErr.details.some((d) => d.field === 'operation_id')).toBe(true);
      }
    });

    it('rejects conflicting duplicate fields (e.g. expected_version and expectedVersion) with 400 VALIDATION_ERROR (#52)', async () => {
      const repo = createMockRepo();
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          expectedVersion: 1, // Duplicate alias!
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ValidationError);
      expect(caughtErr.statusCode).toBe(400);
      expect(caughtErr.message).toContain('Conflicting duplicate fields');
    });

    it('rejects submitPlan if cycle_id, company_id, or position_id is missing with 400 VALIDATION_ERROR', async () => {
      const missingFieldsCases = [
        { cycle_id: null, round_id: null },
        { company_id: null },
        { position_id: null }
      ];

      for (const override of missingFieldsCases) {
        const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1, ...override }));
        const service = new WorkflowService({ repository: repo });
        const student = makeStudentContext();

        await expect(
          service.submitPlan({
            actor: student,
            plan_id: TEST_PLAN_ID,
            expected_version: 1,
            operation_id: makeOperationId()
          })
        ).rejects.toThrow(ValidationError);

        expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
        expect(repo.auditLogs).toHaveLength(0);
      }
    });

    it('rejects submitPlan when the referenced cycle is missing or not OPEN', async () => {
      for (const round_status of [null, 'CLOSED']) {
        const repo = createMockRepo(createMockPlanRow({
          status: PLAN_STATES.DRAFT,
          version: 1,
          round_status
        }));
        const service = new WorkflowService({ repository: repo });

        await expect(service.submitPlan({
          actor: makeStudentContext(),
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })).rejects.toThrow(ValidationError);

        expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
        expect(repo.auditLogs).toHaveLength(0);
      }
    });

    it('rejects review_notes on Student submit/cancel workflow actions', async () => {
      for (const action of [ACTIONS.PLAN_SUBMIT, ACTIONS.PLAN_CANCEL]) {
        const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
        const service = new WorkflowService({ repository: repo });

        await expect(service.executeTransition({
          actor: makeStudentContext(),
          plan_id: TEST_PLAN_ID,
          action,
          expected_version: 1,
          operation_id: makeOperationId(),
          review_notes: 'Student cannot write review notes'
        })).rejects.toThrow(ValidationError);

        expect(repo.getCurrentPlan().version).toBe(1);
        expect(repo.auditLogs).toHaveLength(0);
      }
    });

    it('rejects submitPlan if company is not public with 400 VALIDATION_ERROR (#52 ข้อ 3)', async () => {
      const repo = createMockRepo(createMockPlanRow({
        status: PLAN_STATES.DRAFT,
        version: 1,
        company_visibility: 'private'
      }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ValidationError);
      expect(caughtErr.details.some((d) => d.field === 'company_id')).toBe(true);
      expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
      expect(repo.auditLogs).toHaveLength(0);
    });

    it('rejects submitPlan if position is not public with 400 VALIDATION_ERROR (#52 ข้อ 3)', async () => {
      const repo = createMockRepo(createMockPlanRow({
        status: PLAN_STATES.DRAFT,
        version: 1,
        position_visibility: 'private'
      }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ValidationError);
      expect(caughtErr.details.some((d) => d.field === 'position_id')).toBe(true);
      expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
      expect(repo.auditLogs).toHaveLength(0);
    });

    it('rejects submitPlan if position does not belong to selected company with 400 VALIDATION_ERROR (#52 ข้อ 3)', async () => {
      const repo = createMockRepo(createMockPlanRow({
        status: PLAN_STATES.DRAFT,
        version: 1,
        company_id: COMPANY_ID,
        position_company_id: '99999999-9999-4999-8999-999999999992' // Different company!
      }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ValidationError);
      expect(caughtErr.details.some((d) => d.field === 'position_id')).toBe(true);
      expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
      expect(repo.auditLogs).toHaveLength(0);
    });

    it('rejects returnForRevision if review_notes are missing or empty whitespace with 400 VALIDATION_ERROR', async () => {
      const invalidNotesCases = [undefined, null, '', '   '];

      for (const review_notes of invalidNotesCases) {
        const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 2 }));
        const service = new WorkflowService({ repository: repo });
        const staff = makeStaffContext();

        await expect(
          service.returnForRevision({
            actor: staff,
            plan_id: TEST_PLAN_ID,
            expected_version: 2,
            operation_id: makeOperationId(),
            review_notes
          })
        ).rejects.toThrow(ValidationError);

        expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.UNDER_REVIEW);
        expect(repo.auditLogs).toHaveLength(0);
      }
    });

    it('rejects review_notes exceeding 2000 characters with 400 VALIDATION_ERROR (#52 ข้อ 6)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 2 }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();

      await expect(
        service.returnForRevision({
          actor: staff,
          plan_id: TEST_PLAN_ID,
          expected_version: 2,
          operation_id: makeOperationId(),
          review_notes: 'x'.repeat(2001)
        })
      ).rejects.toThrow(ValidationError);
    });

    it('rejects unknown or unallowed fields with 400 VALIDATION_ERROR (#52 ข้อ 6)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      let caughtErr = null;
      try {
        await service.executeTransition({
          actor: student,
          plan_id: TEST_PLAN_ID,
          action: ACTIONS.PLAN_SUBMIT,
          expected_version: 1,
          operation_id: makeOperationId(),
          unexpected_extra_field: 'malicious_input'
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ValidationError);
      expect(caughtErr.statusCode).toBe(400);
      expect(caughtErr.message).toContain('Unknown or unallowed field');
      expect(repo.auditLogs).toHaveLength(0);
    });
  });

  describe('3. Centralized Authorization and Role Boundaries (#49, #62)', () => {
    it('strictly prohibits Advisor from calling ANY workflow transition with 403 FORBIDDEN and generic message', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.SUBMITTED, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const advisor = makeAdvisorContext();

      const allActions = [
        ACTIONS.PLAN_SUBMIT,
        ACTIONS.PLAN_START_REVIEW,
        ACTIONS.PLAN_RETURN_FOR_REVISION,
        ACTIONS.PLAN_APPROVE,
        ACTIONS.PLAN_CANCEL
      ];

      for (const act of allActions) {
        let caughtErr = null;
        try {
          await service.executeTransition({
            actor: advisor,
            plan_id: TEST_PLAN_ID,
            action: act,
            expected_version: 1,
            operation_id: makeOperationId()
          });
        } catch (err) {
          caughtErr = err;
        }

        expect(caughtErr).toBeInstanceOf(ForbiddenError);
        expect(caughtErr.statusCode).toBe(403);
        expect(caughtErr.code).toBe('FORBIDDEN');
        expect(caughtErr.message).toBe('Access denied.'); // Does not leak policy details
        expect(repo.auditLogs).toHaveLength(0);
      }
    });

    it('prohibits Admin from invoking workflow transitions directly with 403 FORBIDDEN and generic message', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const admin = makeAdminContext();

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: admin,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ForbiddenError);
      expect(caughtErr.statusCode).toBe(403);
      expect(caughtErr.code).toBe('FORBIDDEN');
      expect(caughtErr.message).toBe('Access denied.');
    });

    it('prohibits Student from calling Staff review actions with 403 FORBIDDEN', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.SUBMITTED, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      await expect(
        service.startReview({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        service.approvePlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('prohibits Staff from calling Student actions (submit, cancel) with 403 FORBIDDEN', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();

      await expect(
        service.submitPlan({
          actor: staff,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        service.cancelPlan({
          actor: staff,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('prohibits Student A from transitioning Student B Plan with 403 FORBIDDEN', async () => {
      const repo = createMockRepo(createMockPlanRow({ student_id: STUDENT_B_ID, status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const studentA = makeStudentContext({ studentId: STUDENT_A_ID, userId: USER_STUDENT_A });

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: studentA,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ForbiddenError);
      expect(caughtErr.statusCode).toBe(403);
      expect(caughtErr.message).toBe('Access denied.');
    });

    it('prohibits Staff from reviewing Plan outside their department/program scope with 403 FORBIDDEN', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.SUBMITTED, version: 1 }), { scopeMatch: false });
      const service = new WorkflowService({ repository: repo });
      const staffOutOfScope = makeStaffContext({ userId: USER_STAFF_OUT_SCOPE });

      let caughtErr = null;
      try {
        await service.startReview({
          actor: staffOutOfScope,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ForbiddenError);
      expect(caughtErr.statusCode).toBe(403);
      expect(caughtErr.message).toBe('Access denied.');
      expect(repo.auditLogs).toHaveLength(0);
    });

    it('prohibits Staff review actions when round status is CLOSED with 403 FORBIDDEN', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.SUBMITTED, version: 1, round_status: 'CLOSED' }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();

      await expect(
        service.startReview({
          actor: staff,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(ForbiddenError);

      expect(repo.auditLogs).toHaveLength(0);
    });

    it('rejects unauthenticated callers with 401 UNAUTHORIZED', async () => {
      const repo = createMockRepo();
      const service = new WorkflowService({ repository: repo });

      await expect(
        service.submitPlan({
          actor: null,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects disabled accounts with 403 FORBIDDEN and generic message', async () => {
      const repo = createMockRepo();
      const service = new WorkflowService({ repository: repo });
      const disabledStudent = makeStudentContext({ accountStatus: 'DISABLED' });

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: disabledStudent,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ForbiddenError);
      expect(caughtErr.message).toBe('Access denied.');
    });
  });

  describe('4. Optimistic Concurrency and Conflict Handling (409)', () => {
    it('returns 409 STALE_RECORD_CONFLICT when expected_version does not match current version', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 3 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 2, // Stale version! Current is 3
          operation_id: makeOperationId()
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConflictError);
      expect(caughtErr.statusCode).toBe(409);
      expect(caughtErr.code).toBe('STALE_RECORD_CONFLICT');
      expect(caughtErr.details).toEqual({
        expectedVersion: 2,
        currentVersion: 3
      });

      // Acceptance criterion: conflict does NOT modify Plan or create audit event
      expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
      expect(repo.getCurrentPlan().version).toBe(3);
      expect(repo.auditLogs).toHaveLength(0);
    });

    it('rejects invalid or missing expected_version with 400 VALIDATION_ERROR', async () => {
      const repo = createMockRepo();
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      const invalidVersions = [undefined, null, 0, -1, 'invalid', 1.5];

      for (const ver of invalidVersions) {
        await expect(
          service.submitPlan({
            actor: student,
            plan_id: TEST_PLAN_ID,
            expected_version: ver,
            operation_id: makeOperationId()
          })
        ).rejects.toThrow(ValidationError);
      }
    });

    it('returns 404 RECORD_NOT_FOUND when plan_id does not exist', async () => {
      const repo = createMockRepo();
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      await expect(
        service.submitPlan({
          actor: student,
          plan_id: OTHER_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('5. Idempotent Retry and Operation Tracking (#52 ข้อ 9)', () => {
    it('returns cached response when retrying with the same operation_id, actor, action, and payload (#52)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();
      const testOperationId = makeOperationId();

      // 1. First execution
      const firstResult = await service.submitPlan({
        actor: student,
        plan_id: TEST_PLAN_ID,
        expected_version: 1,
        operation_id: testOperationId
      });

      expect(firstResult.plan.status).toBe(PLAN_STATES.SUBMITTED);
      expect(firstResult.version).toBe(2);
      expect(repo.auditLogs).toHaveLength(1);
      expect(repo.operations).toHaveLength(1);

      // 2. Retry execution with exact same operation_id and payload
      const retryResult = await service.submitPlan({
        actor: student,
        plan_id: TEST_PLAN_ID,
        expected_version: 1,
        operation_id: testOperationId
      });

      expect(retryResult.idempotentReplay).toBe(true);
      expect(retryResult.plan.status).toBe(PLAN_STATES.SUBMITTED);
      expect(retryResult.plan.version).toBe(2);

      // Verify no duplicate updates or audit events were generated!
      expect(repo.auditLogs).toHaveLength(1);
      expect(repo.operations).toHaveLength(1);
    });

    it('rejects with 409 IDEMPOTENCY_KEY_REUSED when same operation_id is reused with different payload (#52 ข้อ 9)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();
      const testOperationId = makeOperationId();

      // 1. First call with payload A
      await service.approvePlan({
        actor: staff,
        plan_id: TEST_PLAN_ID,
        expected_version: 1,
        operation_id: testOperationId,
        review_notes: 'Notes A'
      });

      // 2. Second call with same operation_id but different payload (review_notes: 'Notes B')
      let caughtErr = null;
      try {
        await service.approvePlan({
          actor: staff,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: testOperationId,
          review_notes: 'Notes B' // Different payload!
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConflictError);
      expect(caughtErr.statusCode).toBe(409);
      expect(caughtErr.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(repo.auditLogs).toHaveLength(1); // Only initial audit log
    });

    it('operation_id เดิม payload เดิม แต่ คนละ actor: actor มีสิทธิ์ได้ 409 IDEMPOTENCY_KEY_REUSED, actor ไม่มีสิทธิ์ได้ 403 (#52 ข้อ 9)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.SUBMITTED, version: 2 }));
      const service = new WorkflowService({ repository: repo });
      const staff1 = makeStaffContext({ userId: USER_STAFF_1 });
      const staff2 = makeStaffContext({ userId: USER_STAFF_2 }); // Another authorized staff
      const studentB = makeStudentContext({ studentId: STUDENT_B_ID, userId: USER_STUDENT_B }); // Unauthorized
      const sharedOpId = makeOperationId();

      // 1. Staff 1 executes startReview with sharedOpId
      await service.startReview({
        actor: staff1,
        plan_id: TEST_PLAN_ID,
        expected_version: 2,
        operation_id: sharedOpId
      });

      // 2. Unauthorized actor (Student B) attempts to call with sharedOpId
      // MUST get 403 FORBIDDEN and NOT get cached response or 409!
      let unauthErr = null;
      try {
        await service.submitPlan({
          actor: studentB,
          plan_id: TEST_PLAN_ID,
          expected_version: 2,
          operation_id: sharedOpId
        });
      } catch (err) {
        unauthErr = err;
      }
      expect(unauthErr).toBeInstanceOf(ForbiddenError);
      expect(unauthErr.statusCode).toBe(403);
      expect(unauthErr.message).toBe('Access denied.');

      // 3. Another authorized actor (Staff 2 in scope) calls startReview with sharedOpId
      // MUST get 409 IDEMPOTENCY_KEY_REUSED
      let conflictErr = null;
      try {
        await service.startReview({
          actor: staff2,
          plan_id: TEST_PLAN_ID,
          expected_version: 2,
          operation_id: sharedOpId
        });
      } catch (err) {
        conflictErr = err;
      }
      expect(conflictErr).toBeInstanceOf(ConflictError);
      expect(conflictErr.statusCode).toBe(409);
      expect(conflictErr.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('rejects with 409 IDEMPOTENCY_KEY_REUSED when same operation_id is reused with different action (#52 ข้อ 9)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.UNDER_REVIEW, version: 3 }));
      const service = new WorkflowService({ repository: repo });
      const staff = makeStaffContext();
      const sharedOperationId = makeOperationId();

      // Pre-seed an operation for returnForRevision
      repo.operations.push({
        operation_id: sharedOperationId,
        plan_id: TEST_PLAN_ID,
        actor_id: USER_STAFF_1,
        action: 'PLAN_RETURNED',
        request_hash: crypto.createHash('sha256').update(JSON.stringify({ review_notes: 'Needs work' })).digest('hex'),
        response_status: 200,
        response_payload: { status: 'NEEDS_REVISION' },
        result_version: 4
      });

      // Staff attempts to reuse the same operation_id for approvePlan
      let caughtErr = null;
      try {
        await service.approvePlan({
          actor: staff,
          plan_id: TEST_PLAN_ID,
          expected_version: 3,
          operation_id: sharedOperationId,
          review_notes: 'Needs work'
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConflictError);
      expect(caughtErr.statusCode).toBe(409);
      expect(caughtErr.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('rejects with 409 STALE_RECORD_CONFLICT when new operation_id is used but expected_version is stale (#52 ข้อ 9)', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      // 1. Initial submit succeeds with op1, version becomes 2
      const op1 = makeOperationId();
      await service.submitPlan({
        actor: student,
        plan_id: TEST_PLAN_ID,
        expected_version: 1,
        operation_id: op1
      });

      // 2. Caller sends a new operation_id (op2), but with stale expected_version = 1
      const op2 = makeOperationId();
      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1, // Stale! Current version is 2
          operation_id: op2
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConflictError);
      expect(caughtErr.statusCode).toBe(409);
      expect(caughtErr.code).toBe('STALE_RECORD_CONFLICT');
      expect(caughtErr.details).toEqual({
        expectedVersion: 1,
        currentVersion: 2
      });
    });

    it('strictly checks authorization BEFORE checking cache: unauthorized actor cannot obtain cached results', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const studentA = makeStudentContext({ studentId: STUDENT_A_ID, userId: USER_STUDENT_A });
      const studentB = makeStudentContext({ studentId: STUDENT_B_ID, userId: USER_STUDENT_B });
      const sharedOpId = makeOperationId();

      // 1. Student A executes transition successfully
      await service.submitPlan({
        actor: studentA,
        plan_id: TEST_PLAN_ID,
        expected_version: 1,
        operation_id: sharedOpId
      });

      // 2. Student B attempts to call with the same operation_id on Plan A
      // Authorization must fail with 403 and NOT return cached response!
      let caughtErr = null;
      try {
        await service.submitPlan({
          actor: studentB,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: sharedOpId
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ForbiddenError);
      expect(caughtErr.statusCode).toBe(403);
      expect(caughtErr.message).toBe('Access denied.');
    });
  });

  describe('6. Transaction Rollback Safety', () => {
    it('rolls back database transaction and does not modify Plan or save audit log on failure', async () => {
      const repo = createMockRepo(createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 }));
      const service = new WorkflowService({ repository: repo });
      const student = makeStudentContext();

      // Simulate a database failure during audit event insertion
      repo.insertAuditEvent.mockRejectedValueOnce(new Error('Audit table constraint violation simulation'));

      await expect(
        service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ).rejects.toThrow('Audit table constraint violation simulation');

      // Assert rollback was issued
      expect(repo.mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(repo.mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(repo.mockClient.release).toHaveBeenCalled();

      // Assert Plan remains untouched
      expect(repo.getCurrentPlan().status).toBe(PLAN_STATES.DRAFT);
      expect(repo.getCurrentPlan().version).toBe(1);
      expect(repo.auditLogs).toHaveLength(0);
    });
  });

  describe('7. Concurrency & Row Lock Race Simulation', () => {
    it('serializes concurrent transition attempts on the same version: exactly one succeeds and the other gets 409', async () => {
      let planState = createMockPlanRow({ status: PLAN_STATES.DRAFT, version: 1 });
      const auditLog = [];

      let lockQueue = Promise.resolve();

      const concurrentRepo = {
        getClient: jest.fn().mockImplementation(async () => {
          let hasLock = false;
          let releaseLock = null;

          return {
            query: jest.fn().mockImplementation(async (sql) => {
              const text = sql.trim();
              if (text === 'BEGIN') {
                return { rows: [] };
              }
              if (text === 'COMMIT' || text === 'ROLLBACK') {
                if (hasLock && releaseLock) {
                  hasLock = false;
                  releaseLock();
                }
                return { rows: [] };
              }
              return { rows: [] };
            }),
            release: jest.fn().mockImplementation(() => {
              if (hasLock && releaseLock) {
                hasLock = false;
                releaseLock();
              }
            }),
            _acquireRowLock: async () => {
              let currentRelease;
              const nextLock = new Promise((resolve) => {
                currentRelease = resolve;
              });
              const oldQueue = lockQueue;
              lockQueue = oldQueue.then(() => nextLock);
              await oldQueue;
              hasLock = true;
              releaseLock = currentRelease;
            }
          };
        }),

        findPlanByIdForUpdate: jest.fn().mockImplementation(async (client, id) => {
          await client._acquireRowLock();
          return { ...planState };
        }),

        findOperationById: jest.fn().mockResolvedValue(null),
        findOperationByRequestHash: jest.fn().mockResolvedValue(null),

        findStaffScopeMatch: jest.fn().mockResolvedValue({
          scope_id: 'scope-1',
          scope_department: 'Computer Science',
          round_status: 'OPEN'
        }),

        updatePlanStatus: jest.fn().mockImplementation(async (client, { status, nextVersion, expectedVersion }) => {
          if (Number(planState.version) === Number(expectedVersion)) {
            planState.status = status;
            planState.version = nextVersion;
            return { ...planState };
          }
          return null;
        }),

        insertPlanOperation: jest.fn().mockImplementation(async (client, params) => params),
        insertAuditEvent: jest.fn().mockImplementation(async (client, params) => {
          auditLog.push(params);
          return params;
        })
      };

      const service = new WorkflowService({ repository: concurrentRepo });
      const student = makeStudentContext();

      const [res1, res2] = await Promise.allSettled([
        service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        }),
        service.submitPlan({
          actor: student,
          plan_id: TEST_PLAN_ID,
          expected_version: 1,
          operation_id: makeOperationId()
        })
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      expect(fulfilled[0].value.plan.status).toBe(PLAN_STATES.SUBMITTED);
      expect(fulfilled[0].value.plan.version).toBe(2);

      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
      expect(rejected[0].reason.statusCode).toBe(409);
      expect(rejected[0].reason.code).toBe('STALE_RECORD_CONFLICT');

      expect(planState.status).toBe(PLAN_STATES.SUBMITTED);
      expect(planState.version).toBe(2);
      expect(auditLog).toHaveLength(1);
    });
  });

  describe('8. Real PostgreSQL Integration Tests (runs when TEST_DATABASE_URL is set)', () => {
    const canRunPg = Boolean(process.env.TEST_DATABASE_URL);
    let pool;

    beforeAll(() => {
      if (canRunPg) {
        pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      }
    });

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
    });

    (canRunPg ? it : it.skip)('executes transition against real PostgreSQL with atomic update and immutable audit record, and verifies retry does not duplicate version/audit', async () => {
      const repo = new WorkflowRepository({ pool });
      const service = new WorkflowService({ repository: repo });

      const testStudentUserId = crypto.randomUUID();
      const testStudentId = crypto.randomUUID();
      const testRoundId = crypto.randomUUID();
      const testCompanyId = crypto.randomUUID();
      const testPositionId = crypto.randomUUID();
      const realPlanId = crypto.randomUUID();
      const testOperationId = makeOperationId();

      try {
        await pool.query(`INSERT INTO users (id, role, account_status) VALUES ($1, 'STUDENT', 'ACTIVE')`, [testStudentUserId]);

        const uniqueStudentNumber = String(Math.floor(1000000000 + Math.random() * 9000000000));
        await pool.query(`
          INSERT INTO students (
            id, anonymous_ref, source, visibility, data_status,
            user_id, student_number, full_name, institutional_email,
            department, program, major, academic_year, enrollment_status
          ) VALUES (
            $1, $2, 'v3_test', 'private', 'mock',
            $3, $4, 'Real Student Workflow', $5,
            'Computer Science', 'B.Sc.', 'CS', 2568, 'ACTIVE'
          )
        `, [
          testStudentId,
          `ANON_${testStudentId.slice(0, 12)}`,
          testStudentUserId,
          uniqueStudentNumber,
          `real_${Date.now()}_${Math.random().toString(36).slice(2)}@student.example.com`
        ]);

        await pool.query(`
          INSERT INTO rounds (id, name, academic_year, semester, status, source, visibility, data_status)
          VALUES ($1, 'Co-op Round 2568/1', 2568, 1, 'OPEN', 'v3_test', 'private', 'mock')
        `, [testRoundId]);

        await pool.query(`
          INSERT INTO companies (id, name, visibility, data_status, source)
          VALUES ($1, 'Workflow Test Corp', 'public', 'mock', 'v3_test')
        `, [testCompanyId]);

        await pool.query(`
          INSERT INTO positions (id, company_id, title, visibility, data_status, source)
          VALUES ($1, $2, 'Software Intern', 'public', 'mock', 'v3_test')
        `, [testPositionId, testCompanyId]);

        await pool.query(`
          INSERT INTO plans (id, student_id, cycle_id, round_id, company_id, position_id, status, version, source, visibility, data_status)
          VALUES ($1, $2, $3, $3, $4, $5, 'DRAFT', 1, 'v3_test', 'private', 'mock')
        `, [realPlanId, testStudentId, testRoundId, testCompanyId, testPositionId]);

        const studentActor = {
          isAuthenticated: true,
          userId: testStudentUserId,
          role: 'STUDENT',
          accountStatus: 'ACTIVE',
          studentId: testStudentId
        };

        // 1. Submit plan
        const submitResult = await service.submitPlan({
          actor: studentActor,
          plan_id: realPlanId,
          expected_version: 1,
          operation_id: testOperationId
        });

        expect(submitResult.plan.status).toBe('SUBMITTED');
        expect(submitResult.plan.version).toBe(2);

        // Verify DB row
        const planRes = await pool.query('SELECT status, version FROM plans WHERE id = $1', [realPlanId]);
        expect(planRes.rows[0].status).toBe('SUBMITTED');
        expect(planRes.rows[0].version).toBe(2);

        // Verify audit_events row
        const auditRes = await pool.query('SELECT * FROM audit_events WHERE plan_id = $1', [realPlanId]);
        expect(auditRes.rows).toHaveLength(1);
        expect(auditRes.rows[0].action).toBe('PLAN_SUBMITTED');
        expect(auditRes.rows[0].from_state).toBe('DRAFT');
        expect(auditRes.rows[0].to_state).toBe('SUBMITTED');
        expect(auditRes.rows[0].notes).toBeNull();

        // Verify plan_operations row
        const opRes = await pool.query('SELECT * FROM plan_operations WHERE plan_id = $1', [realPlanId]);
        expect(opRes.rows).toHaveLength(1);
        expect(opRes.rows[0].operation_id).toBe(testOperationId);
        expect(opRes.rows[0].result_version).toBe(2);

        // 2. Retry execution with exact same operation_id and payload
        // Verification: in real PostgreSQL, retry must NOT increase version and must NOT create duplicate audit row
        const retryResult = await service.submitPlan({
          actor: studentActor,
          plan_id: realPlanId,
          expected_version: 1,
          operation_id: testOperationId
        });

        expect(retryResult.idempotentReplay).toBe(true);
        expect(retryResult.plan.status).toBe('SUBMITTED');
        expect(retryResult.plan.version).toBe(2);

        // Real PostgreSQL verification: version is STILL 2 and audit events count is STILL exactly 1
        const planAfterRetry = await pool.query('SELECT status, version FROM plans WHERE id = $1', [realPlanId]);
        expect(planAfterRetry.rows[0].status).toBe('SUBMITTED');
        expect(planAfterRetry.rows[0].version).toBe(2);

        const auditAfterRetry = await pool.query('SELECT * FROM audit_events WHERE plan_id = $1', [realPlanId]);
        expect(auditAfterRetry.rows).toHaveLength(1);

        const opAfterRetry = await pool.query('SELECT * FROM plan_operations WHERE plan_id = $1', [realPlanId]);
        expect(opAfterRetry.rows).toHaveLength(1);

        // 3. Stale update attempt -> 409
        await expect(
          service.submitPlan({
            actor: studentActor,
            plan_id: realPlanId,
            expected_version: 1, // Stale! Current is 2
            operation_id: makeOperationId()
          })
        ).rejects.toThrow(ConflictError);
      } finally {
        const client = await pool.connect();
        try {
          await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable');
          await client.query('ALTER TABLE plan_operations DISABLE TRIGGER trg_plan_operations_immutable');
          await client.query('ALTER TABLE plans DISABLE TRIGGER trg_plans_no_delete');

          await client.query('DELETE FROM audit_events WHERE plan_id = $1', [realPlanId]);
          await client.query('DELETE FROM plan_operations WHERE plan_id = $1', [realPlanId]);
          await client.query('DELETE FROM plans WHERE id = $1', [realPlanId]);
          await client.query('DELETE FROM positions WHERE id = $1', [testPositionId]);
          await client.query('DELETE FROM companies WHERE id = $1', [testCompanyId]);
          await client.query('DELETE FROM rounds WHERE id = $1', [testRoundId]);
          await client.query('DELETE FROM students WHERE id = $1', [testStudentId]);
          await client.query('DELETE FROM users WHERE id = $1', [testStudentUserId]);

          await client.query('ALTER TABLE plans ENABLE TRIGGER trg_plans_no_delete');
          await client.query('ALTER TABLE plan_operations ENABLE TRIGGER trg_plan_operations_immutable');
          await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable');
        } finally {
          client.release();
        }
      }
    });

    (canRunPg ? it : it.skip)('enforces real PostgreSQL FOR UPDATE row lock concurrency: 2 simultaneous transactions with Promise.all results in exactly 1 success and 1 409 Conflict', async () => {
      const repo = new WorkflowRepository({ pool });
      const service = new WorkflowService({ repository: repo });

      const testStudentUserId = crypto.randomUUID();
      const testStudentId = crypto.randomUUID();
      const testStaffUserId = crypto.randomUUID();
      const testScopeId = crypto.randomUUID();
      const testRoundId = crypto.randomUUID();
      const testCompanyId = crypto.randomUUID();
      const testPositionId = crypto.randomUUID();
      const realPlanId = crypto.randomUUID();

      try {
        await pool.query(`INSERT INTO users (id, role, account_status) VALUES ($1, 'STUDENT', 'ACTIVE')`, [testStudentUserId]);
        await pool.query(`INSERT INTO users (id, role, account_status) VALUES ($1, 'STAFF', 'ACTIVE')`, [testStaffUserId]);

        const uniqueStudentNumber = String(Math.floor(1000000000 + Math.random() * 9000000000));
        await pool.query(`
          INSERT INTO students (
            id, anonymous_ref, source, visibility, data_status,
            user_id, student_number, full_name, institutional_email,
            department, program, major, academic_year, enrollment_status
          ) VALUES (
            $1, $2, 'v3_test', 'private', 'mock',
            $3, $4, 'Real Student Concurrency', $5,
            'Computer Science', 'B.Sc.', 'CS', 2568, 'ACTIVE'
          )
        `, [
          testStudentId,
          `ANON_${testStudentId.slice(0, 12)}`,
          testStudentUserId,
          uniqueStudentNumber,
          `real_conc_${Date.now()}_${Math.random().toString(36).slice(2)}@student.example.com`
        ]);

        await pool.query(`
          INSERT INTO staff_scopes (id, staff_id, department, academic_year, status)
          VALUES ($1, $2, 'Computer Science', 2568, 'ACTIVE')
        `, [testScopeId, testStaffUserId]);

        await pool.query(`
          INSERT INTO rounds (id, name, academic_year, semester, status, source, visibility, data_status)
          VALUES ($1, 'Co-op Round Concurrency', 2568, 1, 'OPEN', 'v3_test', 'private', 'mock')
        `, [testRoundId]);

        await pool.query(`
          INSERT INTO companies (id, name, visibility, data_status, source)
          VALUES ($1, 'Workflow Race Corp', 'public', 'mock', 'v3_test')
        `, [testCompanyId]);

        await pool.query(`
          INSERT INTO positions (id, company_id, title, visibility, data_status, source)
          VALUES ($1, $2, 'Concurrency Tester', 'public', 'mock', 'v3_test')
        `, [testPositionId, testCompanyId]);

        // Seed Plan in SUBMITTED state, version = 1
        await pool.query(`
          INSERT INTO plans (id, student_id, cycle_id, round_id, company_id, position_id, status, version, source, visibility, data_status)
          VALUES ($1, $2, $3, $3, $4, $5, 'SUBMITTED', 1, 'v3_test', 'private', 'mock')
        `, [realPlanId, testStudentId, testRoundId, testCompanyId, testPositionId]);

        const staffActor = {
          isAuthenticated: true,
          userId: testStaffUserId,
          role: 'STAFF',
          accountStatus: 'ACTIVE'
        };

        // Fire 2 concurrent transactions against real PostgreSQL with Promise.all
        const [res1, res2] = await Promise.allSettled([
          service.startReview({
            actor: staffActor,
            plan_id: realPlanId,
            expected_version: 1,
            operation_id: makeOperationId()
          }),
          service.startReview({
            actor: staffActor,
            plan_id: realPlanId,
            expected_version: 1,
            operation_id: makeOperationId()
          })
        ]);

        const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
        const rejected = [res1, res2].filter((r) => r.status === 'rejected');

        // Exactly one transaction commits, and one is rejected with 409 Conflict
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        expect(fulfilled[0].value.plan.status).toBe('UNDER_REVIEW');
        expect(fulfilled[0].value.plan.version).toBe(2);

        expect(rejected[0].reason).toBeInstanceOf(ConflictError);
        expect(rejected[0].reason.statusCode).toBe(409);
        expect(rejected[0].reason.code).toBe('STALE_RECORD_CONFLICT');

        // Verify PostgreSQL row status and version (incremented exactly once)
        const finalPlan = await pool.query('SELECT status, version FROM plans WHERE id = $1', [realPlanId]);
        expect(finalPlan.rows[0].status).toBe('UNDER_REVIEW');
        expect(finalPlan.rows[0].version).toBe(2);

        // Verify exactly one audit event in real PostgreSQL
        const auditRows = await pool.query('SELECT * FROM audit_events WHERE plan_id = $1', [realPlanId]);
        expect(auditRows.rows).toHaveLength(1);
        expect(auditRows.rows[0].action).toBe('PLAN_REVIEW_STARTED');
      } finally {
        const client = await pool.connect();
        try {
          await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable');
          await client.query('ALTER TABLE plan_operations DISABLE TRIGGER trg_plan_operations_immutable');
          await client.query('ALTER TABLE plans DISABLE TRIGGER trg_plans_no_delete');

          await client.query('DELETE FROM audit_events WHERE plan_id = $1', [realPlanId]);
          await client.query('DELETE FROM plan_operations WHERE plan_id = $1', [realPlanId]);
          await client.query('DELETE FROM plans WHERE id = $1', [realPlanId]);
          await client.query('DELETE FROM positions WHERE id = $1', [testPositionId]);
          await client.query('DELETE FROM companies WHERE id = $1', [testCompanyId]);
          await client.query('DELETE FROM staff_scopes WHERE id = $1', [testScopeId]);
          await client.query('DELETE FROM rounds WHERE id = $1', [testRoundId]);
          await client.query('DELETE FROM students WHERE id = $1', [testStudentId]);
          await client.query('DELETE FROM users WHERE id IN ($1, $2)', [testStudentUserId, testStaffUserId]);

          await client.query('ALTER TABLE plans ENABLE TRIGGER trg_plans_no_delete');
          await client.query('ALTER TABLE plan_operations ENABLE TRIGGER trg_plan_operations_immutable');
          await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable');
        } finally {
          client.release();
        }
      }
    });

    (canRunPg ? it : it.skip)('verifies illegal transition does not modify plan and creates 0 audit events in PostgreSQL', async () => {
      const repo = new WorkflowRepository({ pool });
      const service = new WorkflowService({ repository: repo });

      const testStaffUserId = crypto.randomUUID();
      const testStudentUserId = crypto.randomUUID();
      const testStudentId = crypto.randomUUID();
      const testRoundId = crypto.randomUUID();
      const testCompanyId = crypto.randomUUID();
      const testPositionId = crypto.randomUUID();
      const realPlanId = crypto.randomUUID();
      const testScopeId = crypto.randomUUID();

      try {
        await pool.query(`INSERT INTO users (id, role, account_status) VALUES ($1, 'STUDENT', 'ACTIVE')`, [testStudentUserId]);
        await pool.query(`INSERT INTO users (id, role, account_status) VALUES ($1, 'STAFF', 'ACTIVE')`, [testStaffUserId]);

        const uniqueStudentNumber = String(Math.floor(1000000000 + Math.random() * 9000000000));
        await pool.query(`
          INSERT INTO students (
            id, anonymous_ref, source, visibility, data_status,
            user_id, student_number, full_name, institutional_email,
            department, program, major, academic_year, enrollment_status
          ) VALUES (
            $1, $2, 'v3_test', 'private', 'mock',
            $3, $4, 'Real Student Illegal Trans', $5,
            'Computer Science', 'B.Sc.', 'CS', 2568, 'ACTIVE'
          )
        `, [
          testStudentId,
          `ANON_${testStudentId.slice(0, 12)}`,
          testStudentUserId,
          uniqueStudentNumber,
          `real_illegal_${Date.now()}_${Math.random().toString(36).slice(2)}@student.example.com`
        ]);

        await pool.query(`
          INSERT INTO staff_scopes (id, staff_id, department, academic_year, status)
          VALUES ($1, $2, 'Computer Science', 2568, 'ACTIVE')
        `, [testScopeId, testStaffUserId]);

        await pool.query(`
          INSERT INTO rounds (id, name, academic_year, semester, status, source, visibility, data_status)
          VALUES ($1, 'Co-op Round Illegal Test', 2568, 1, 'OPEN', 'v3_test', 'private', 'mock')
        `, [testRoundId]);

        await pool.query(`
          INSERT INTO companies (id, name, visibility, data_status, source)
          VALUES ($1, 'Workflow Illegal Test Corp', 'public', 'mock', 'v3_test')
        `, [testCompanyId]);

        await pool.query(`
          INSERT INTO positions (id, company_id, title, visibility, data_status, source)
          VALUES ($1, $2, 'Position Illegal Test', 'public', 'mock', 'v3_test')
        `, [testPositionId, testCompanyId]);

        // Seed Plan in DRAFT status
        await pool.query(`
          INSERT INTO plans (id, student_id, cycle_id, round_id, company_id, position_id, status, version, source, visibility, data_status)
          VALUES ($1, $2, $3, $3, $4, $5, 'DRAFT', 1, 'v3_test', 'private', 'mock')
        `, [realPlanId, testStudentId, testRoundId, testCompanyId, testPositionId]);

        const staffActor = {
          isAuthenticated: true,
          userId: testStaffUserId,
          role: 'STAFF',
          accountStatus: 'ACTIVE'
        };

        // Attempt illegal transition: approve directly on DRAFT plan
        await expect(
          service.approvePlan({
            actor: staffActor,
            plan_id: realPlanId,
            expected_version: 1,
            operation_id: makeOperationId()
          })
        ).rejects.toThrow(InvalidStateTransitionError);

        // Verify in PostgreSQL: plan is untouched (still DRAFT, version 1)
        const planRes = await pool.query('SELECT status, version FROM plans WHERE id = $1', [realPlanId]);
        expect(planRes.rows[0].status).toBe('DRAFT');
        expect(planRes.rows[0].version).toBe(1);

        // Verify 0 audit records were created
        const auditRes = await pool.query('SELECT * FROM audit_events WHERE plan_id = $1', [realPlanId]);
        expect(auditRes.rows).toHaveLength(0);
      } finally {
        const client = await pool.connect();
        try {
          await client.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable');
          await client.query('ALTER TABLE plan_operations DISABLE TRIGGER trg_plan_operations_immutable');
          await client.query('ALTER TABLE plans DISABLE TRIGGER trg_plans_no_delete');

          await client.query('DELETE FROM audit_events WHERE plan_id = $1', [realPlanId]);
          await client.query('DELETE FROM plan_operations WHERE plan_id = $1', [realPlanId]);
          await client.query('DELETE FROM plans WHERE id = $1', [realPlanId]);
          await client.query('DELETE FROM positions WHERE id = $1', [testPositionId]);
          await client.query('DELETE FROM companies WHERE id = $1', [testCompanyId]);
          await client.query('DELETE FROM staff_scopes WHERE id = $1', [testScopeId]);
          await client.query('DELETE FROM rounds WHERE id = $1', [testRoundId]);
          await client.query('DELETE FROM students WHERE id = $1', [testStudentId]);
          await client.query('DELETE FROM users WHERE id IN ($1, $2)', [testStudentUserId, testStaffUserId]);

          await client.query('ALTER TABLE plans ENABLE TRIGGER trg_plans_no_delete');
          await client.query('ALTER TABLE plan_operations ENABLE TRIGGER trg_plan_operations_immutable');
          await client.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable');
        } finally {
          client.release();
        }
      }
    });
  });
});
