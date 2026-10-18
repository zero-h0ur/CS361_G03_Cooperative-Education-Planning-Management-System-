/**
 * Issue #80 — [V3-T03] Verify workflow transitions, audit and concurrent updates.
 *
 * End-to-end verification of:
 * 1. Legal workflow transitions & preconditions via HTTP endpoints (#69, #70) & WorkflowService (#63)
 * 2. Exhaustive illegal state transition matrix (422 INVALID_STATE_TRANSITION)
 * 3. Actor, ownership, Staff scope, and Advisor read-only enforcement (403 FORBIDDEN)
 * 4. Transactional atomicity & rollback when status update, operation log, or audit insert fails
 * 5. Idempotent retries, stale version conflicts (409 STALE_RECORD_CONFLICT), and concurrent updates
 * 6. Immutable audit trail contract (actor, action, from_state, to_state, notes, timestamp)
 */

const crypto = require('node:crypto');
const { createApiServer } = require('../src/api/app');
const { TokenValidator } = require('../src/auth/token-validator');
const { IdentityResolver } = require('../src/auth/identity-resolver');
const {
  ROLES,
  AuthorizationService
} = require('../src/api/services/authorization-service');
const {
  PLAN_STATES,
  ACTIONS: WORKFLOW_ACTIONS,
  AUDIT_ACTIONS,
  WorkflowService
} = require('../src/api/services/workflow-service');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});

const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_v3WorkflowPool';
const CLIENT_ID = 'v3-workflow-client';

function signJwt(payload) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'v3-wf-key-1' };
  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encHeader}.${encPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function makeClaims(sub) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub,
    iss: ISSUER,
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'openid email coed-api/access',
    exp: now + 3600,
    nbf: now - 10
  };
}

const ACTORS = Object.freeze({
  studentOwner: {
    sub: 'wf-sub-student-owner',
    userId: '71000000-0000-4000-8000-000000000001',
    studentId: '61000000-0000-4000-8000-000000000001',
    role: ROLES.STUDENT,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE',
    department: 'CPE',
    program: 'B.Eng.',
    academicYear: 2569
  },
  studentOther: {
    sub: 'wf-sub-student-other',
    userId: '71000000-0000-4000-8000-000000000002',
    studentId: '61000000-0000-4000-8000-000000000002',
    role: ROLES.STUDENT,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE',
    department: 'CPE',
    program: 'B.Eng.',
    academicYear: 2569
  },
  staffInScope: {
    sub: 'wf-sub-staff-cpe',
    userId: '71000000-0000-4000-8000-000000000010',
    studentId: null,
    role: ROLES.STAFF,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  },
  staffOutOfScope: {
    sub: 'wf-sub-staff-ee',
    userId: '71000000-0000-4000-8000-000000000011',
    studentId: null,
    role: ROLES.STAFF,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  },
  advisorAssigned: {
    sub: 'wf-sub-advisor',
    userId: '71000000-0000-4000-8000-000000000020',
    studentId: null,
    role: ROLES.ADVISOR,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  },
  adminUser: {
    sub: 'wf-sub-admin',
    userId: '71000000-0000-4000-8000-000000000030',
    studentId: null,
    role: ROLES.ADMIN,
    accountStatus: 'ACTIVE',
    linkStatus: 'ACTIVE'
  }
});

/**
 * In-memory harness for HTTP/state-policy tests. PostgreSQL transaction, locking,
 * rollback and append-only guarantees are verified in v3-t03-postgres.test.js.
 */
function createWorkflowTestHarness(initialPlans = []) {
  const plansById = new Map();
  const operationsById = new Map();
  const auditEvents = [];
  const rowLocks = new Map();

  const defaultPlanTemplate = {
    id: '51000000-0000-4000-8000-000000000501',
    student_id: ACTORS.studentOwner.studentId,
    cycle_id: '31000000-0000-4000-8000-000000000001',
    round_id: '31000000-0000-4000-8000-000000000001',
    company_id: '11000000-0000-4000-8000-000000000001',
    position_id: '21000000-0000-4000-8000-000000000001',
    notes: 'Student initial plan notes',
    status: PLAN_STATES.DRAFT,
    version: 1,
    round_status: 'OPEN',
    round_academic_year: 2569,
    student_department: 'CPE',
    student_program: 'B.Eng.',
    student_academic_year: 2569,
    company_visibility: 'public',
    position_visibility: 'public',
    position_company_id: '11000000-0000-4000-8000-000000000001',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z'
  };

  const seeds = initialPlans.length > 0 ? initialPlans : [defaultPlanTemplate];
  for (const plan of seeds) {
    plansById.set(plan.id, { ...defaultPlanTemplate, ...plan });
  }

  let failOnStep = null;

  function acquireRowLock(planId) {
    const previousLock = rowLocks.get(planId) || Promise.resolve();
    let releaseLock;
    const currentLock = new Promise((resolve) => {
      releaseLock = resolve;
    });
    rowLocks.set(
      planId,
      previousLock.then(() => currentLock)
    );
    return previousLock.then(() => releaseLock);
  }

  const authzRepository = {
    async findPlanById(planId) {
      return plansById.get(planId) || null;
    },
    async listActiveStaffScopes(staffUserId) {
      if (staffUserId === ACTORS.staffInScope.userId) {
        return [{ department: 'CPE', program: null, academic_year: 2569 }];
      }
      if (staffUserId === ACTORS.staffOutOfScope.userId) {
        return [{ department: 'EE', program: null, academic_year: 2568 }];
      }
      return [];
    },
    async listActiveAdvisorAssignments(advisorUserId) {
      if (advisorUserId === ACTORS.advisorAssigned.userId) {
        return [{ student_id: ACTORS.studentOwner.studentId, academic_year: 2569, semester: 1 }];
      }
      return [];
    },
    async findActiveAdvisorAssignment({ advisorUserId, studentId }) {
      if (
        advisorUserId === ACTORS.advisorAssigned.userId &&
        studentId === ACTORS.studentOwner.studentId
      ) {
        return {
          id: 'assign-wf-1',
          advisor_id: advisorUserId,
          student_id: studentId,
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
      const dept =
        studentId === ACTORS.studentOwner.studentId
          ? 'CPE'
          : plan?.student_department || null;

      if (staffUserId === ACTORS.staffInScope.userId && dept === 'CPE') {
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
          round_status: plan?.round_status || 'OPEN',
          round_academic_year: plan?.round_academic_year || 2569
        };
      }
      return null;
    }
  };

  const authorizationService = new AuthorizationService({
    repository: authzRepository
  });

  const workflowRepository = {
    async getClient() {
      let txSnapshot = null;
      const heldRowUnlockFns = [];

      function releaseAllLocks() {
        while (heldRowUnlockFns.length > 0) {
          const unlock = heldRowUnlockFns.pop();
          unlock();
        }
      }

      return {
        _holdUnlock(unlockFn) {
          heldRowUnlockFns.push(unlockFn);
          // Take the rollback baseline after the row lock is acquired, so a
          // losing retry cannot restore data from before the winner committed.
          txSnapshot = {
            plans: new Map(Array.from(plansById.entries()).map(([k, v]) => [k, { ...v }])),
            operations: new Map(Array.from(operationsById.entries()).map(([k, v]) => [k, { ...v }])),
            auditLength: auditEvents.length
          };
        },
        async query(sql) {
          const upper = String(sql).trim().toUpperCase();
          if (upper === 'BEGIN') {
            txSnapshot = {
              plans: new Map(
                Array.from(plansById.entries()).map(([k, v]) => [k, { ...v }])
              ),
              operations: new Map(
                Array.from(operationsById.entries()).map(([k, v]) => [k, { ...v }])
              ),
              auditLength: auditEvents.length
            };
          } else if (upper === 'ROLLBACK' && txSnapshot) {
            plansById.clear();
            for (const [k, v] of txSnapshot.plans.entries()) {
              plansById.set(k, v);
            }
            operationsById.clear();
            for (const [k, v] of txSnapshot.operations.entries()) {
              operationsById.set(k, v);
            }
            auditEvents.splice(txSnapshot.auditLength);
            txSnapshot = null;
            releaseAllLocks();
          } else if (upper === 'COMMIT') {
            txSnapshot = null;
            releaseAllLocks();
          }
          return { rows: [] };
        },
        release() {
          releaseAllLocks();
        }
      };
    },
    async findPlanByIdForUpdate(client, planId) {
      const unlock = await acquireRowLock(planId);
      client._holdUnlock(unlock);
      const plan = plansById.get(planId);
      return plan ? { ...plan } : null;
    },
    async findOperationById(_client, operationId) {
      const op = operationsById.get(operationId);
      return op ? { ...op } : null;
    },
    async updatePlanStatus(_client, { planId, status, nextVersion, expectedVersion }) {
      if (failOnStep === 'updatePlanStatus') {
        throw new Error('Simulated DB failure during updatePlanStatus');
      }
      const current = plansById.get(planId);
      if (!current || Number(current.version) !== Number(expectedVersion)) {
        return null;
      }
      const updated = {
        ...current,
        status,
        version: nextVersion,
        updated_at: new Date().toISOString()
      };
      plansById.set(planId, updated);
      return { ...updated };
    },
    async insertPlanOperation(_client, op) {
      if (failOnStep === 'insertPlanOperation') {
        throw new Error('Simulated DB failure during insertPlanOperation');
      }
      const saved = {
        operation_id: op.operationId,
        plan_id: op.planId,
        actor_id: op.actorId,
        action: op.action,
        request_hash: op.requestHash,
        response_status: op.responseStatus,
        response_payload: op.responsePayload,
        result_version: op.resultVersion,
        created_at: new Date().toISOString()
      };
      operationsById.set(op.operationId, saved);
      return { ...saved };
    },
    async insertAuditEvent(_client, event) {
      if (failOnStep === 'insertAuditEvent') {
        throw new Error('Simulated DB failure during insertAuditEvent');
      }
      const saved = {
        event_id: event.eventId,
        plan_id: event.planId,
        actor_id: event.actorId,
        actor_role: event.actorRole,
        action: event.action,
        resource_type: event.resourceType || 'plan',
        resource_id: event.resourceId || event.planId,
        from_state: event.fromState,
        to_state: event.toState,
        notes: event.notes ?? null,
        correlation_id: event.correlationId,
        operation_id: event.operationId,
        created_at: new Date().toISOString()
      };
      auditEvents.push(saved);
      return { ...saved };
    }
  };

  const tokenValidator = new TokenValidator({
    expectedIssuer: ISSUER,
    expectedClientId: CLIENT_ID,
    requiredScope: 'coed-api/access',
    publicKey
  });

  const actorsBySub = new Map(Object.values(ACTORS).map((a) => [a.sub, a]));
  const identityResolver = new IdentityResolver({
    pool: {
      async query(_sql, [issuer, subject]) {
        if (issuer !== ISSUER) return { rows: [] };
        const actor = actorsBySub.get(subject);
        if (!actor) return { rows: [] };
        return {
          rows: [
            {
              user_id: actor.userId,
              role: actor.role,
              account_status: actor.accountStatus,
              identity_link_id: `link-${actor.userId}`,
              link_status: actor.linkStatus,
              active_link_count: 1,
              student_id: actor.studentId,
              student_number: 'TEST-WORKFLOW-001',
              full_name: 'นายสมชาย ใจดี',
              preferred_name: 'ชาย',
              institutional_email: 'workflow-001@student.example.com',
              department: actor.department || 'CPE',
              program: actor.program || 'B.Eng.',
              major: 'Computer Engineering',
              academic_year: actor.academicYear || 2569,
              enrollment_status: 'ACTIVE'
            }
          ]
        };
      }
    }
  });

  const workflowService = new WorkflowService({
    repository: workflowRepository,
    authorizationService
  });

  const authOptions = {
    allowBearerFallback: true,
    tokenValidator,
    identityResolver,
    repository: authzRepository,
    authorizationService
  };

  const server = createApiServer({
    authOptions,
    workflowRepository,
    workflowService
  });

  return {
    server,
    workflowService,
    workflowRepository,
    plansById,
    operationsById,
    auditEvents,
    setFailOnStep(stepName) {
      failOnStep = stepName;
    }
  };
}

describe('Issue #80 [V3-T03]: Verify workflow transitions, audit and concurrent updates', () => {
  let harness;
  let baseUrl;

  beforeEach(async () => {
    harness = createWorkflowTestHarness();
    await new Promise((resolve) => {
      harness.server.listen(0, '127.0.0.1', () => {
        const addr = harness.server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (harness?.server) {
      await new Promise((resolve) => harness.server.close(resolve));
    }
  });

  describe('1. Legal Workflow Transitions & Preconditions (HTTP Endpoints + WorkflowService)', () => {
    it('completes the full end-to-end lifecycle DRAFT -> SUBMITTED -> UNDER_REVIEW -> NEEDS_REVISION -> SUBMITTED -> UNDER_REVIEW -> APPROVED with monotonic versions and immutable audit trail', async () => {
      const planId = '51000000-0000-4000-8000-000000000501';
      const studentToken = signJwt(makeClaims(ACTORS.studentOwner.sub));
      const staffToken = signJwt(makeClaims(ACTORS.staffInScope.sub));

      // Step 1: Student submits DRAFT (v1 -> v2)
      const step1Res = await fetch(`${baseUrl}/api/v3/plans/${planId}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 1,
          operation_id: crypto.randomUUID()
        })
      });
      const step1Body = await step1Res.json();
      expect(step1Res.status).toBe(200);
      expect(step1Body.data.status).toBe(PLAN_STATES.SUBMITTED);
      expect(step1Body.data.version).toBe(2);
      expect(step1Body.data.audit_reference).toMatchObject({
        action: AUDIT_ACTIONS[WORKFLOW_ACTIONS.PLAN_SUBMIT],
        from_state: PLAN_STATES.DRAFT,
        to_state: PLAN_STATES.SUBMITTED
      });

      // Step 2: Staff starts review (v2 -> v3)
      const step2Res = await fetch(`${baseUrl}/api/v3/plans/${planId}/start-review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 2,
          operation_id: crypto.randomUUID()
        })
      });
      const step2Body = await step2Res.json();
      expect(step2Res.status).toBe(200);
      expect(step2Body.data.status).toBe(PLAN_STATES.UNDER_REVIEW);
      expect(step2Body.data.version).toBe(3);

      // Step 3: Staff returns plan for revision with mandatory review_notes (v3 -> v4)
      const step3Res = await fetch(`${baseUrl}/api/v3/plans/${planId}/return`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 3,
          operation_id: crypto.randomUUID(),
          review_notes: 'กรุณาระบุรายละเอียดงานและเทคโนโลยีที่ใช้เพิ่มเติม'
        })
      });
      const step3Body = await step3Res.json();
      expect(step3Res.status).toBe(200);
      expect(step3Body.data.status).toBe(PLAN_STATES.NEEDS_REVISION);
      expect(step3Body.data.version).toBe(4);
      // Student's own notes must remain untouched
      expect(step3Body.data.notes).toBe('Student initial plan notes');
      expect(step3Body.data.audit_reference.notes).toBe(
        'กรุณาระบุรายละเอียดงานและเทคโนโลยีที่ใช้เพิ่มเติม'
      );

      // Step 4: Student resubmits plan from NEEDS_REVISION (v4 -> v5)
      const step4Res = await fetch(`${baseUrl}/api/v3/plans/${planId}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 4,
          operation_id: crypto.randomUUID()
        })
      });
      const step4Body = await step4Res.json();
      expect(step4Res.status).toBe(200);
      expect(step4Body.data.status).toBe(PLAN_STATES.SUBMITTED);
      expect(step4Body.data.version).toBe(5);

      // Step 5: Staff starts second review (v5 -> v6)
      const step5Res = await fetch(`${baseUrl}/api/v3/plans/${planId}/start-review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 5,
          operation_id: crypto.randomUUID()
        })
      });
      const step5Body = await step5Res.json();
      expect(step5Res.status).toBe(200);
      expect(step5Body.data.status).toBe(PLAN_STATES.UNDER_REVIEW);
      expect(step5Body.data.version).toBe(6);

      // Step 6: Staff approves plan (v6 -> v7)
      const step6Res = await fetch(`${baseUrl}/api/v3/plans/${planId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staffToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 6,
          operation_id: crypto.randomUUID(),
          review_notes: 'อนุมัติแผนสหกิจศึกษา'
        })
      });
      const step6Body = await step6Res.json();
      expect(step6Res.status).toBe(200);
      expect(step6Body.data.status).toBe(PLAN_STATES.APPROVED);
      expect(step6Body.data.version).toBe(7);

      // Verify all 6 immutable audit events were recorded in exact order
      expect(harness.auditEvents).toHaveLength(6);
      expect(
        harness.auditEvents.map((e) => ({
          actor_role: e.actor_role,
          action: e.action,
          from_state: e.from_state,
          to_state: e.to_state
        }))
      ).toEqual([
        {
          actor_role: 'STUDENT',
          action: 'PLAN_SUBMITTED',
          from_state: 'DRAFT',
          to_state: 'SUBMITTED'
        },
        {
          actor_role: 'STAFF',
          action: 'PLAN_REVIEW_STARTED',
          from_state: 'SUBMITTED',
          to_state: 'UNDER_REVIEW'
        },
        {
          actor_role: 'STAFF',
          action: 'PLAN_RETURNED',
          from_state: 'UNDER_REVIEW',
          to_state: 'NEEDS_REVISION'
        },
        {
          actor_role: 'STUDENT',
          action: 'PLAN_SUBMITTED',
          from_state: 'NEEDS_REVISION',
          to_state: 'SUBMITTED'
        },
        {
          actor_role: 'STAFF',
          action: 'PLAN_REVIEW_STARTED',
          from_state: 'SUBMITTED',
          to_state: 'UNDER_REVIEW'
        },
        {
          actor_role: 'STAFF',
          action: 'PLAN_APPROVED',
          from_state: 'UNDER_REVIEW',
          to_state: 'APPROVED'
        }
      ]);
    });

    it('enforces submission and return-for-revision preconditions (400 VALIDATION_ERROR)', async () => {
      const incompletePlanId = '51000000-0000-4000-8000-000000000599';
      harness.plansById.set(incompletePlanId, {
        ...harness.plansById.get('51000000-0000-4000-8000-000000000501'),
        id: incompletePlanId,
        company_id: null,
        position_id: null,
        status: PLAN_STATES.DRAFT,
        version: 1
      });

      const underReviewPlanId = '51000000-0000-4000-8000-000000000598';
      harness.plansById.set(underReviewPlanId, {
        ...harness.plansById.get('51000000-0000-4000-8000-000000000501'),
        id: underReviewPlanId,
        status: PLAN_STATES.UNDER_REVIEW,
        version: 3
      });

      const studentToken = signJwt(makeClaims(ACTORS.studentOwner.sub));
      const staffToken = signJwt(makeClaims(ACTORS.staffInScope.sub));

      // Submit incomplete plan -> 400 VALIDATION_ERROR
      const incompleteRes = await fetch(
        `${baseUrl}/api/v3/plans/${incompletePlanId}/submit`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(incompleteRes.status).toBe(400);
      expect(harness.plansById.get(incompletePlanId).status).toBe(PLAN_STATES.DRAFT);
      expect(harness.plansById.get(incompletePlanId).version).toBe(1);

      // Return plan without review_notes -> 400 VALIDATION_ERROR
      const missingNotesRes = await fetch(
        `${baseUrl}/api/v3/plans/${underReviewPlanId}/return`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 3,
            operation_id: crypto.randomUUID(),
            review_notes: '   '
          })
        }
      );
      expect(missingNotesRes.status).toBe(400);
      expect(harness.plansById.get(underReviewPlanId).status).toBe(
        PLAN_STATES.UNDER_REVIEW
      );
      expect(harness.plansById.get(underReviewPlanId).version).toBe(3);
      expect(harness.operationsById.size).toBe(0);
      expect(harness.auditEvents).toHaveLength(0);
    });
  });

  describe('2. Exhaustive Illegal State Transition Matrix (422 INVALID_STATE_TRANSITION)', () => {
    const studentActor = {
      isAuthenticated: true,
      userId: ACTORS.studentOwner.userId,
      studentId: ACTORS.studentOwner.studentId,
      accountStatus: 'ACTIVE',
      role: ROLES.STUDENT
    };
    const staffActor = {
      isAuthenticated: true,
      userId: ACTORS.staffInScope.userId,
      accountStatus: 'ACTIVE',
      role: ROLES.STAFF
    };

    it.each([
      // From DRAFT
      { from: PLAN_STATES.DRAFT, action: WORKFLOW_ACTIONS.PLAN_START_REVIEW, actor: staffActor },
      { from: PLAN_STATES.DRAFT, action: WORKFLOW_ACTIONS.PLAN_RETURN_FOR_REVISION, actor: staffActor, notes: 'Invalid' },
      { from: PLAN_STATES.DRAFT, action: WORKFLOW_ACTIONS.PLAN_APPROVE, actor: staffActor },
      // From SUBMITTED
      { from: PLAN_STATES.SUBMITTED, action: WORKFLOW_ACTIONS.PLAN_SUBMIT, actor: studentActor },
      { from: PLAN_STATES.SUBMITTED, action: WORKFLOW_ACTIONS.PLAN_RETURN_FOR_REVISION, actor: staffActor, notes: 'Skip start-review' },
      { from: PLAN_STATES.SUBMITTED, action: WORKFLOW_ACTIONS.PLAN_APPROVE, actor: staffActor },
      // From UNDER_REVIEW
      { from: PLAN_STATES.UNDER_REVIEW, action: WORKFLOW_ACTIONS.PLAN_SUBMIT, actor: studentActor },
      { from: PLAN_STATES.UNDER_REVIEW, action: WORKFLOW_ACTIONS.PLAN_START_REVIEW, actor: staffActor },
      { from: PLAN_STATES.UNDER_REVIEW, action: WORKFLOW_ACTIONS.PLAN_CANCEL, actor: studentActor },
      // From NEEDS_REVISION
      { from: PLAN_STATES.NEEDS_REVISION, action: WORKFLOW_ACTIONS.PLAN_START_REVIEW, actor: staffActor },
      { from: PLAN_STATES.NEEDS_REVISION, action: WORKFLOW_ACTIONS.PLAN_RETURN_FOR_REVISION, actor: staffActor, notes: 'Already returned' },
      { from: PLAN_STATES.NEEDS_REVISION, action: WORKFLOW_ACTIONS.PLAN_APPROVE, actor: staffActor },
      // From terminal APPROVED
      { from: PLAN_STATES.APPROVED, action: WORKFLOW_ACTIONS.PLAN_SUBMIT, actor: studentActor },
      { from: PLAN_STATES.APPROVED, action: WORKFLOW_ACTIONS.PLAN_START_REVIEW, actor: staffActor },
      { from: PLAN_STATES.APPROVED, action: WORKFLOW_ACTIONS.PLAN_RETURN_FOR_REVISION, actor: staffActor, notes: 'Cannot reopen' },
      { from: PLAN_STATES.APPROVED, action: WORKFLOW_ACTIONS.PLAN_APPROVE, actor: staffActor },
      { from: PLAN_STATES.APPROVED, action: WORKFLOW_ACTIONS.PLAN_CANCEL, actor: studentActor },
      // From terminal CANCELLED
      { from: PLAN_STATES.CANCELLED, action: WORKFLOW_ACTIONS.PLAN_SUBMIT, actor: studentActor },
      { from: PLAN_STATES.CANCELLED, action: WORKFLOW_ACTIONS.PLAN_START_REVIEW, actor: staffActor },
      { from: PLAN_STATES.CANCELLED, action: WORKFLOW_ACTIONS.PLAN_RETURN_FOR_REVISION, actor: staffActor, notes: 'Cannot return cancelled' },
      { from: PLAN_STATES.CANCELLED, action: WORKFLOW_ACTIONS.PLAN_APPROVE, actor: staffActor },
      { from: PLAN_STATES.CANCELLED, action: WORKFLOW_ACTIONS.PLAN_CANCEL, actor: studentActor }
    ])(
      'rejects illegal transition from $from via $action with 422 INVALID_STATE_TRANSITION and leaves state/audit unchanged',
      async ({ from, action, actor, notes }) => {
        const planId = '51000000-0000-4000-8000-000000000501';
        harness.plansById.set(planId, {
          ...harness.plansById.get(planId),
          status: from,
          version: 3
        });

        await expect(
          harness.workflowService.executeTransition({
            actor,
            plan_id: planId,
            action,
            expected_version: 3,
            operation_id: crypto.randomUUID(),
            ...(notes ? { review_notes: notes } : {})
          })
        ).rejects.toMatchObject({
          statusCode: 422,
          code: 'INVALID_STATE_TRANSITION'
        });

        expect(harness.plansById.get(planId).status).toBe(from);
        expect(harness.plansById.get(planId).version).toBe(3);
        expect(harness.auditEvents).toHaveLength(0);
        expect(harness.operationsById.size).toBe(0);
      }
    );
  });

  describe('3. Actor, Ownership, Staff Scope & Advisor Read-Only Enforcement', () => {
    it('rejects Advisor, Admin, out-of-scope Staff, and non-owner Student across workflow commands with 403 FORBIDDEN', async () => {
      const planId = '51000000-0000-4000-8000-000000000501';
      const advisorToken = signJwt(makeClaims(ACTORS.advisorAssigned.sub));
      const adminToken = signJwt(makeClaims(ACTORS.adminUser.sub));
      const foreignStudentToken = signJwt(makeClaims(ACTORS.studentOther.sub));
      const outScopeStaffToken = signJwt(makeClaims(ACTORS.staffOutOfScope.sub));

      // Advisor rejected on submit, start-review, return, approve
      for (const path of ['submit', 'start-review', 'return', 'approve']) {
        const res = await fetch(`${baseUrl}/api/v3/plans/${planId}/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${advisorToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID(),
            ...(path === 'return' ? { review_notes: 'Advisor attempt' } : {})
          })
        });
        expect(res.status).toBe(403);
      }

      // Admin rejected on submit, start-review, return, approve
      for (const path of ['submit', 'start-review', 'return', 'approve']) {
        const res = await fetch(`${baseUrl}/api/v3/plans/${planId}/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID()
          })
        });
        expect(res.status).toBe(403);
      }

      // Non-owner Student rejected on submitting Student A's plan
      const foreignSubmitRes = await fetch(
        `${baseUrl}/api/v3/plans/${planId}/submit`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${foreignStudentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(foreignSubmitRes.status).toBe(403);
      expect(harness.plansById.get(planId)).toMatchObject({ status: PLAN_STATES.DRAFT, version: 1 });
      expect(harness.operationsById.size).toBe(0);

      // Out-of-scope Staff rejected on start-review
      harness.plansById.set(planId, {
        ...harness.plansById.get(planId),
        status: PLAN_STATES.SUBMITTED,
        version: 2
      });
      const outScopeRes = await fetch(
        `${baseUrl}/api/v3/plans/${planId}/start-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${outScopeStaffToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 2,
            operation_id: crypto.randomUUID()
          })
        }
      );
      expect(outScopeRes.status).toBe(403);
      expect(harness.plansById.get(planId)).toMatchObject({ status: PLAN_STATES.SUBMITTED, version: 2 });
      expect(harness.operationsById.size).toBe(0);
      expect(harness.auditEvents).toHaveLength(0);
    });
  });

  describe('4. Transactional Atomicity & Rollback Verification', () => {
    it.each(['updatePlanStatus', 'insertPlanOperation', 'insertAuditEvent'])(
      'rolls back the entire transaction when %s throws an error so business state and audit events never diverge',
      async (failingStep) => {
        const planId = '51000000-0000-4000-8000-000000000501';
        const studentToken = signJwt(makeClaims(ACTORS.studentOwner.sub));

        harness.setFailOnStep(failingStep);

        const res = await fetch(`${baseUrl}/api/v3/plans/${planId}/submit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 1,
            operation_id: crypto.randomUUID()
          })
        });

        expect(res.status).toBe(500);

        // Plan status/version, operations table, and audit_events must be completely rolled back
        const planAfterFailure = harness.plansById.get(planId);
        expect(planAfterFailure.status).toBe(PLAN_STATES.DRAFT);
        expect(planAfterFailure.version).toBe(1);
        expect(harness.operationsById.size).toBe(0);
        expect(harness.auditEvents).toHaveLength(0);
      }
    );
  });

  describe('5. Idempotent Retries, Stale Version Conflicts & Concurrent Updates', () => {
    it('returns idempotent replay on duplicate operation_id with matching parameters and rejects reused operation_id with different parameters (409 IDEMPOTENCY_KEY_REUSED)', async () => {
      const planId = '51000000-0000-4000-8000-000000000501';
      const studentToken = signJwt(makeClaims(ACTORS.studentOwner.sub));
      const staffToken = signJwt(makeClaims(ACTORS.staffInScope.sub));
      const opId = crypto.randomUUID();

      // First submit succeeds
      const firstRes = await fetch(`${baseUrl}/api/v3/plans/${planId}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 1,
          operation_id: opId
        })
      });
      const firstPayload = await firstRes.json();
      expect(firstRes.status).toBe(200);
      expect(firstPayload.data.idempotent_replay).toBe(false);
      expect(firstPayload.data.version).toBe(2);

      // Duplicate retry with identical operation_id returns 200 idempotent replay without second audit row
      const retryRes = await fetch(`${baseUrl}/api/v3/plans/${planId}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          expected_version: 1,
          operation_id: opId
        })
      });
      const retryPayload = await retryRes.json();
      expect(retryRes.status).toBe(200);
      expect(retryPayload.data.idempotent_replay).toBe(true);
      expect(retryPayload.data.version).toBe(2);
      expect(harness.auditEvents).toHaveLength(1);
      expect(harness.operationsById.size).toBe(1);

      // Reusing the same operation_id for a different action/actor is rejected with 409 IDEMPOTENCY_KEY_REUSED
      const reusedKeyRes = await fetch(
        `${baseUrl}/api/v3/plans/${planId}/start-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 2,
            operation_id: opId
          })
        }
      );
      const reusedKeyPayload = await reusedKeyRes.json();
      expect(reusedKeyRes.status).toBe(409);
      expect(reusedKeyPayload.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('prevents lost updates and duplicate audit rows when concurrent requests race with the same expected_version (409 STALE_RECORD_CONFLICT)', async () => {
      const planId = '51000000-0000-4000-8000-000000000501';
      harness.plansById.set(planId, {
        ...harness.plansById.get(planId),
        status: PLAN_STATES.UNDER_REVIEW,
        version: 3
      });

      const staffToken = signJwt(makeClaims(ACTORS.staffInScope.sub));

      // Fire two concurrent Staff commands (one approve, one return) both claiming expected_version: 3
      const [resA, resB] = await Promise.all([
        fetch(`${baseUrl}/api/v3/plans/${planId}/approve`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 3,
            operation_id: crypto.randomUUID(),
            review_notes: 'Concurrent approve'
          })
        }),
        fetch(`${baseUrl}/api/v3/plans/${planId}/return`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expected_version: 3,
            operation_id: crypto.randomUUID(),
            review_notes: 'Concurrent return'
          })
        })
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      // Exactly one request succeeds (200) and the second loses the optimistic concurrency check (409)
      expect(statuses).toEqual([200, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      const conflictPayload = await conflictRes.json();
      expect(conflictPayload.error.code).toBe('STALE_RECORD_CONFLICT');

      // Version incremented once (3 -> 4), and exactly 1 operation + 1 audit event exist
      expect(harness.plansById.get(planId).version).toBe(4);
      expect(harness.operationsById.size).toBe(1);
      expect(harness.auditEvents).toHaveLength(1);
    });
  });
});
