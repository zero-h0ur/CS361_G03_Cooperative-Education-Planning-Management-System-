/**
 * Unit and Integration Tests for Issue #62:
 * [V3-F05] Implement centralized role, ownership and scope authorization.
 */

const crypto = require('node:crypto');
const { Router } = require('../src/api/router');
const { sendSuccess } = require('../src/api/response');
const { attachRequestContext } = require('../src/api/context');
const { UnauthorizedError, ForbiddenError, NotFoundError } = require('../src/api/errors');
const { registerProtectedRoute } = require('../src/api/routes/v3-routes');
const {
  ROLES,
  PERMISSION_SCOPES,
  ACTIONS,
  getPermissionScope,
  getRoleCapabilities,
  AuthorizationService,
  createAuthorizationMiddleware,
  TokenValidator,
  IdentityResolver,
  createAuthMiddleware
} = require('../src/auth');

describe('Issue #62: Centralized Role, Ownership and Scope Authorization', () => {
  const FIXED_NOW = new Date('2026-10-18T07:00:00.000Z');

  function makeStudentContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: 'user-student-a',
      role: ROLES.STUDENT,
      accountStatus: 'ACTIVE',
      studentId: 'student-a-uuid',
      department: 'Computer Science',
      program: 'B.Sc.',
      major: 'Computer Science',
      academicYear: 2567,
      enrollmentStatus: 'ACTIVE',
      ...overrides
    });
  }

  function makeAdvisorContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: 'user-advisor-1',
      role: ROLES.ADVISOR,
      accountStatus: 'ACTIVE',
      studentId: null,
      ...overrides
    });
  }

  function makeStaffContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: 'user-staff-1',
      role: ROLES.STAFF,
      accountStatus: 'ACTIVE',
      studentId: null,
      ...overrides
    });
  }

  function makeAdminContext(overrides = {}) {
    return Object.freeze({
      isAuthenticated: true,
      userId: 'user-admin-1',
      role: ROLES.ADMIN,
      accountStatus: 'ACTIVE',
      studentId: null,
      ...overrides
    });
  }

  describe('1. Permission Matrix & Deny-by-Default (#49)', () => {
    it('denies unknown actions and unknown roles by default', async () => {
      const authz = new AuthorizationService();
      const studentCtx = makeStudentContext();

      expect(getPermissionScope(ROLES.STUDENT, 'unknown:action')).toBe(PERMISSION_SCOPES.DENY);
      expect(getPermissionScope('UNKNOWN_ROLE', ACTIONS.STUDENT_READ_PROFILE)).toBe(
        PERMISSION_SCOPES.DENY
      );
      expect(getPermissionScope(ROLES.STUDENT, '')).toBe(PERMISSION_SCOPES.DENY);

      await expect(authz.authorize(studentCtx, 'unknown:action')).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize({ ...studentCtx, role: 'SUPERUSER' }, ACTIONS.STUDENT_READ_PROFILE)
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows PUBLIC directory actions for anonymous and authenticated callers', async () => {
      const authz = new AuthorizationService();

      const anonDecision = await authz.authorize(
        { isAuthenticated: false, role: null },
        ACTIONS.COMPANY_READ_PUBLIC
      );
      expect(anonDecision.authorized).toBe(true);
      expect(anonDecision.scopeMode).toBe(PERMISSION_SCOPES.PUBLIC);

      const studentDecision = await authz.authorize(
        makeStudentContext(),
        ACTIONS.DIRECTORY_SEARCH_PUBLIC
      );
      expect(studentDecision.authorized).toBe(true);
    });

    it('rejects anonymous requests to protected Student/Plan endpoints with 401 Unauthorized', async () => {
      const authz = new AuthorizationService();

      await expect(
        authz.authorize({ isAuthenticated: false, userId: null }, ACTIONS.STUDENT_READ_PROFILE)
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        authz.authorize(null, ACTIONS.PLAN_LIST_READ)
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects disabled accounts immediately across all roles with 403 Forbidden', async () => {
      const authz = new AuthorizationService();

      await expect(
        authz.authorize(
          makeStudentContext({ accountStatus: 'DISABLED' }),
          ACTIONS.STUDENT_READ_PROFILE,
          { studentId: 'student-a-uuid' }
        )
      ).rejects.toThrow(ForbiddenError);

      await expect(
        authz.authorize(
          makeStaffContext({ accountStatus: 'DISABLED' }),
          ACTIONS.SESSION_READ_ME
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('denies globally prohibited actions (hard-delete Plan, direct status write, direct audit write) for all roles', async () => {
      const authz = new AuthorizationService();
      const contexts = [
        makeStudentContext(),
        makeAdvisorContext(),
        makeStaffContext(),
        makeAdminContext()
      ];

      const prohibitedActions = [
        ACTIONS.PLAN_DELETE,
        ACTIONS.PLAN_SET_STATUS_DIRECTLY,
        ACTIONS.AUDIT_CREATE_DIRECTLY,
        ACTIONS.AUDIT_UPDATE_DELETE,
        ACTIONS.COMPANY_CREATE,
        ACTIONS.COMPANY_READ_PRIVATE,
        ACTIONS.STUDENT_DELETE
      ];

      for (const ctx of contexts) {
        for (const action of prohibitedActions) {
          await expect(authz.authorize(ctx, action)).rejects.toThrow(ForbiddenError);
        }
      }
    });
  });

  describe('2. Student Ownership (OWN) Boundaries (#49 & #62)', () => {
    it('allows Student A to read and update their own profile', async () => {
      const authz = new AuthorizationService();
      const studentA = makeStudentContext();

      const readRes = await authz.authorize(studentA, ACTIONS.STUDENT_READ_PROFILE, {
        studentId: 'student-a-uuid'
      });
      expect(readRes.authorized).toBe(true);
      expect(readRes.scopeMode).toBe(PERMISSION_SCOPES.OWN);
      expect(readRes.studentId).toBe('student-a-uuid');

      const updateRes = await authz.authorize(studentA, ACTIONS.STUDENT_UPDATE_SELF_PROFILE, {
        studentId: 'student-a-uuid'
      });
      expect(updateRes.authorized).toBe(true);
    });

    it('rejects Student A attempting to read or update Student B with 403 Forbidden', async () => {
      const authz = new AuthorizationService();
      const studentA = makeStudentContext();

      await expect(
        authz.authorize(studentA, ACTIONS.STUDENT_READ_PROFILE, {
          studentId: 'student-b-uuid'
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        authz.authorize(studentA, ACTIONS.STUDENT_UPDATE_SELF_PROFILE, {
          studentId: 'student-b-uuid'
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows Student A to edit/submit own Plan in DRAFT or NEEDS_REVISION state, and denies in SUBMITTED/APPROVED', async () => {
      const planRow = (planStatus) => ({
        rows: [{
          plan_id: 'plan-a-1',
          student_id: 'student-a-uuid',
          plan_status: planStatus,
          plan_version: 1
        }]
      });
      const mockPool = {
        query: jest.fn()
          .mockResolvedValueOnce(planRow('DRAFT'))
          .mockResolvedValueOnce(planRow('NEEDS_REVISION'))
          .mockResolvedValueOnce(planRow('SUBMITTED'))
          .mockResolvedValueOnce(planRow('APPROVED'))
      };
      const authz = new AuthorizationService({ pool: mockPool });
      const studentA = makeStudentContext();

      const draftEdit = await authz.authorize(studentA, ACTIONS.PLAN_UPDATE_CONTENT, {
        planId: 'plan-a-1'
      });
      expect(draftEdit.authorized).toBe(true);

      const revisionSubmit = await authz.authorize(studentA, ACTIONS.PLAN_SUBMIT, {
        planId: 'plan-a-1'
      });
      expect(revisionSubmit.authorized).toBe(true);

      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_UPDATE_CONTENT, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_SUBMIT, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('ignores caller-supplied planStudentId and planStatus and re-reads ownership/state from the database', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            plan_id: 'plan-b-1',
            student_id: 'student-b-uuid',
            plan_status: 'SUBMITTED'
          }]
        })
      };
      const authz = new AuthorizationService({ pool: mockPool });

      // Student A claims Student B's plan is theirs
      await expect(
        authz.authorize(makeStudentContext(), ACTIONS.PLAN_LIST_READ, {
          planId: 'plan-b-1',
          planStudentId: 'student-a-uuid'
        })
      ).rejects.toThrow(ForbiddenError);

      // Student B claims their SUBMITTED plan is still a DRAFT
      const studentB = makeStudentContext({ userId: 'user-student-b', studentId: 'student-b-uuid' });
      await expect(
        authz.authorize(studentB, ACTIONS.PLAN_UPDATE_CONTENT, {
          planId: 'plan-b-1',
          planStudentId: 'student-b-uuid',
          planStatus: 'DRAFT'
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects Student A attempting to read, edit, or submit Student B Plan with 403 Forbidden', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            plan_id: 'plan-b-1',
            student_id: 'student-b-uuid',
            plan_status: 'DRAFT'
          }]
        })
      };
      const authz = new AuthorizationService({ pool: mockPool });
      const studentA = makeStudentContext();

      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_LIST_READ, { planId: 'plan-b-1' })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_SUBMIT, { planId: 'plan-b-1' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('returns 404 Not Found when Student requests a non-existent Plan ID within their own context', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };
      const authz = new AuthorizationService({ pool: mockPool });
      const studentA = makeStudentContext();

      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_LIST_READ, { planId: 'missing-plan-id' })
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects Student calling Staff review commands or Student search list with 403 Forbidden', async () => {
      const authz = new AuthorizationService();
      const studentA = makeStudentContext();

      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_START_REVIEW, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_RETURN_FOR_REVISION, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(studentA, ACTIONS.PLAN_APPROVE, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(studentA, ACTIONS.STUDENT_SEARCH_LIST)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('3. Advisor Assigned-Scope (ASSIGNED) & Read-Only Rules (#49 & #53)', () => {
    it('allows Advisor with active assignment in [effective_from, effective_to) to read assigned Student and Plan', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            id: 'assign-1',
            advisor_id: 'user-advisor-1',
            student_id: 'student-a-uuid',
            academic_year: 2567,
            semester: 1,
            status: 'ACTIVE',
            revoked_at: null,
            effective_from: '2026-08-01T00:00:00.000Z',
            effective_to: '2026-12-31T23:59:59.000Z',
            user_role: 'ADVISOR',
            user_account_status: 'ACTIVE'
          }]
        })
      };
      const authz = new AuthorizationService({
        pool: mockPool,
        now: () => FIXED_NOW
      });
      const advisor = makeAdvisorContext();

      const profileDecision = await authz.authorize(advisor, ACTIONS.STUDENT_READ_PROFILE, {
        studentId: 'student-a-uuid',
        academicYear: 2567,
        semester: 1
      });
      expect(profileDecision.authorized).toBe(true);
      expect(profileDecision.scopeMode).toBe(PERMISSION_SCOPES.ASSIGNED);
      expect(profileDecision.studentId).toBe('student-a-uuid');

      const planDecision = await authz.authorize(advisor, ACTIONS.PLAN_LIST_READ, {
        studentId: 'student-a-uuid',
        planId: 'plan-a-1',
        academicYear: 2567,
        semester: 1
      });
      expect(planDecision.authorized).toBe(true);
    });

    it('rejects Advisor reading unassigned Student or Plan with 403 Forbidden', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };
      const authz = new AuthorizationService({
        pool: mockPool,
        now: () => FIXED_NOW
      });
      const advisor = makeAdvisorContext();

      await expect(
        authz.authorize(advisor, ACTIONS.STUDENT_READ_PROFILE, {
          studentId: 'unassigned-student-uuid'
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        authz.authorize(advisor, ACTIONS.PLAN_LIST_READ, {
          planId: 'unassigned-plan-uuid'
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects Advisor assigned to Student A reading a Plan owned by Student B even when studentId=A is supplied', async () => {
      const repository = {
        findPlanById: jest.fn().mockResolvedValue({
          plan_id: 'plan-b-1',
          student_id: 'student-b-uuid',
          plan_status: 'SUBMITTED',
          round_academic_year: 2567,
          round_semester: 1
        }),
        findActiveAdvisorAssignment: jest.fn(async ({ studentId }) =>
          studentId === 'student-a-uuid'
            ? { status: 'ACTIVE', user_role: 'ADVISOR', user_account_status: 'ACTIVE' }
            : null
        )
      };
      const authz = new AuthorizationService({ repository, now: () => FIXED_NOW });

      await expect(
        authz.authorize(makeAdvisorContext(), ACTIONS.PLAN_LIST_READ, {
          studentId: 'student-a-uuid',
          planId: 'plan-b-1'
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        authz.authorize(makeAdvisorContext(), ACTIONS.PLAN_LIST_READ, { planId: 'plan-b-1' })
      ).rejects.toThrow(ForbiddenError);
      expect(repository.findActiveAdvisorAssignment).toHaveBeenLastCalledWith(
        expect.objectContaining({
          studentId: 'student-b-uuid',
          academicYear: null,
          semester: null
        })
      );
    });

    it('allows historical Plan reads across cycles while any current Student assignment is active (#53 section 4.1)', async () => {
      const repository = {
        findPlanById: jest.fn().mockResolvedValue({
          plan_id: 'plan-history-1',
          student_id: 'student-a-uuid',
          plan_status: 'CANCELLED',
          round_academic_year: 2564,
          round_semester: 2
        }),
        findActiveAdvisorAssignment: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          user_role: 'ADVISOR',
          user_account_status: 'ACTIVE',
          academic_year: 2567,
          semester: 1
        })
      };
      const authz = new AuthorizationService({ repository, now: () => FIXED_NOW });

      const decision = await authz.authorize(
        makeAdvisorContext(),
        ACTIONS.PLAN_LIST_READ,
        { planId: 'plan-history-1' }
      );

      expect(decision.authorized).toBe(true);
      expect(repository.findActiveAdvisorAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'student-a-uuid',
          academicYear: null,
          semester: null
        })
      );
    });

    it('enforces half-open interval [effective_from, effective_to): rejects when req_timestamp === effective_to or effective_from > now or revoked (#53 Section 2.3)', async () => {
      const boundaryTime = new Date('2026-12-31T23:59:59.000Z');
      const mockPoolExactBoundary = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            id: 'assign-boundary',
            advisor_id: 'user-advisor-1',
            student_id: 'student-a-uuid',
            academic_year: 2567,
            semester: 1,
            status: 'ACTIVE',
            revoked_at: null,
            effective_from: '2026-08-01T00:00:00.000Z',
            effective_to: '2026-12-31T23:59:59.000Z',
            user_role: 'ADVISOR',
            user_account_status: 'ACTIVE'
          }]
        })
      };

      const authzBoundary = new AuthorizationService({
        pool: mockPoolExactBoundary,
        now: () => boundaryTime
      });

      // Exact boundary req_timestamp === effective_to must fail with 403 Forbidden
      await expect(
        authzBoundary.authorize(makeAdvisorContext(), ACTIONS.STUDENT_READ_PROFILE, {
          studentId: 'student-a-uuid'
        })
      ).rejects.toThrow(ForbiddenError);

      // Future effective_from > req_timestamp must fail with 403 Forbidden
      const beforeStart = new Date('2026-07-01T00:00:00.000Z');
      await expect(
        authzBoundary.authorize(makeAdvisorContext(), ACTIONS.STUDENT_READ_PROFILE, {
          studentId: 'student-a-uuid',
          requestTimestamp: beforeStart
        })
      ).rejects.toThrow(ForbiddenError);

      // Revoked assignment must fail immediately with 403 Forbidden
      const mockPoolRevoked = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            id: 'assign-revoked',
            advisor_id: 'user-advisor-1',
            student_id: 'student-a-uuid',
            status: 'REVOKED',
            revoked_at: '2026-10-10T00:00:00.000Z',
            effective_from: '2026-08-01T00:00:00.000Z',
            effective_to: '2026-12-31T23:59:59.000Z',
            user_role: 'ADVISOR',
            user_account_status: 'ACTIVE'
          }]
        })
      };
      const authzRevoked = new AuthorizationService({
        pool: mockPoolRevoked,
        now: () => FIXED_NOW
      });

      await expect(
        authzRevoked.authorize(makeAdvisorContext(), ACTIONS.STUDENT_READ_PROFILE, {
          studentId: 'student-a-uuid'
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('strictly prohibits Advisor from all mutations (start-review, return, approve, create/edit Plan or Student) (#49 & #53)', async () => {
      const authz = new AuthorizationService();
      const advisor = makeAdvisorContext();

      const forbiddenMutations = [
        ACTIONS.PLAN_START_REVIEW,
        ACTIONS.PLAN_RETURN_FOR_REVISION,
        ACTIONS.PLAN_APPROVE,
        ACTIONS.PLAN_CREATE,
        ACTIONS.PLAN_UPDATE_CONTENT,
        ACTIONS.PLAN_SELECT_COMPANY_POSITION,
        ACTIONS.PLAN_SUBMIT,
        ACTIONS.STUDENT_UPDATE_SELF_PROFILE,
        ACTIONS.STUDENT_UPDATE_STAFF_FIELDS,
        ACTIONS.ASSIGNMENT_MANAGE
      ];

      for (const action of forbiddenMutations) {
        await expect(
          authz.authorize(advisor, action, { studentId: 'student-a-uuid', planId: 'plan-a-1' })
        ).rejects.toThrow(ForbiddenError);
      }
    });
  });

  describe('4. Staff Visibility & Review Scope (SCOPED) Rules (#49 & #53)', () => {
    it('allows Staff to read Student/Plan and execute review commands within active department/program/year scope and OPEN round', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            scope_id: 'scope-1',
            scope_department: 'Computer Science',
            scope_program: 'B.Sc.',
            scope_academic_year: 2567,
            scope_status: 'ACTIVE',
            user_role: 'STAFF',
            user_account_status: 'ACTIVE',
            student_id: 'student-a-uuid',
            student_department: 'Computer Science',
            student_program: 'B.Sc.',
            student_academic_year: 2567,
            plan_id: 'plan-a-1',
            plan_student_id: 'student-a-uuid',
            round_academic_year: 2567,
            round_status: 'OPEN'
          }]
        })
      };
      const authz = new AuthorizationService({ pool: mockPool });
      const staff = makeStaffContext();

      const readDecision = await authz.authorize(staff, ACTIONS.STUDENT_READ_PROFILE, {
        studentId: 'student-a-uuid'
      });
      expect(readDecision.authorized).toBe(true);
      expect(readDecision.scopeMode).toBe(PERMISSION_SCOPES.SCOPED);

      const reviewDecision = await authz.authorize(staff, ACTIONS.PLAN_START_REVIEW, {
        studentId: 'student-a-uuid',
        planId: 'plan-a-1'
      });
      expect(reviewDecision.authorized).toBe(true);
      expect(reviewDecision.isReviewAction).toBe(true);
    });

    it('rejects Staff reading or reviewing a Student/Plan outside their department or in a CLOSED round with 403 Forbidden', async () => {
      // Out of department scope
      const mockPoolOutOfDept = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            scope_id: 'scope-cs',
            scope_department: 'Computer Science',
            scope_status: 'ACTIVE',
            user_role: 'STAFF',
            user_account_status: 'ACTIVE',
            student_id: 'student-math-uuid',
            student_department: 'Mathematics',
            plan_id: 'plan-math-1',
            round_status: 'OPEN'
          }]
        })
      };
      const authzOut = new AuthorizationService({ pool: mockPoolOutOfDept });
      await expect(
        authzOut.authorize(makeStaffContext(), ACTIONS.STUDENT_READ_PROFILE, {
          studentId: 'student-math-uuid'
        })
      ).rejects.toThrow(ForbiddenError);

      // Review command on CLOSED round (#53 Section 3.2)
      const mockPoolClosedRound = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            scope_id: 'scope-cs',
            scope_department: 'Computer Science',
            scope_status: 'ACTIVE',
            user_role: 'STAFF',
            user_account_status: 'ACTIVE',
            student_id: 'student-a-uuid',
            student_department: 'Computer Science',
            plan_id: 'plan-a-1',
            round_status: 'CLOSED'
          }]
        })
      };
      const authzClosed = new AuthorizationService({ pool: mockPoolClosedRound });
      await expect(
        authzClosed.authorize(makeStaffContext(), ACTIONS.PLAN_APPROVE, {
          studentId: 'student-a-uuid',
          planId: 'plan-a-1'
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects Staff attempting to edit Plan content, submit Plan for Student, or manage Advisor assignments', async () => {
      const authz = new AuthorizationService();
      const staff = makeStaffContext();

      await expect(
        authz.authorize(staff, ACTIONS.PLAN_UPDATE_CONTENT, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(staff, ACTIONS.PLAN_SUBMIT, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(staff, ACTIONS.STUDENT_UPDATE_SELF_PROFILE, { studentId: 'student-a-uuid' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(staff, ACTIONS.ASSIGNMENT_MANAGE)
      ).rejects.toThrow(ForbiddenError);
    });

    it('returns 404 Not Found when an in-scope Staff member requests a non-existent Plan ID, and 403 if Staff has no active scope', async () => {
      const mockPoolWithScope = {
        query: jest.fn()
          // 1st call: findPlanResource -> empty
          .mockResolvedValueOnce({ rows: [] })
          // 2nd call: getActiveStaffScopes -> has active scope
          .mockResolvedValueOnce({
            rows: [{ id: 'scope-1', department: 'Computer Science', program: null, academicYear: null }]
          })
      };
      const authzWithScope = new AuthorizationService({ pool: mockPoolWithScope });

      await expect(
        authzWithScope.authorize(makeStaffContext(), ACTIONS.PLAN_LIST_READ, {
          planId: 'non-existent-plan'
        })
      ).rejects.toThrow(NotFoundError);

      const mockPoolNoScope = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };
      const authzNoScope = new AuthorizationService({ pool: mockPoolNoScope });

      await expect(
        authzNoScope.authorize(makeStaffContext(), ACTIONS.STUDENT_SEARCH_LIST, {
          listOnly: true
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('5. Admin & System Role Boundaries (#49)', () => {
    it('rejects Admin attempting implicit access to Student profiles, Plans, or Staff review actions with 403 Forbidden', async () => {
      const authz = new AuthorizationService();
      const admin = makeAdminContext();

      await expect(
        authz.authorize(admin, ACTIONS.STUDENT_READ_PROFILE, { studentId: 'student-a-uuid' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(admin, ACTIONS.STUDENT_SEARCH_LIST)
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(admin, ACTIONS.PLAN_LIST_READ, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        authz.authorize(admin, ACTIONS.PLAN_APPROVE, { planId: 'plan-a-1' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('requires explicit allowOps boundary for Admin OPS actions and denies them on regular endpoints', async () => {
      const authz = new AuthorizationService();
      const admin = makeAdminContext();

      // Denied without allowOps: true
      await expect(
        authz.authorize(admin, ACTIONS.ASSIGNMENT_MANAGE, {})
      ).rejects.toThrow(ForbiddenError);

      // Allowed in controlled operational context
      const opsDecision = await authz.authorize(admin, ACTIONS.ASSIGNMENT_MANAGE, {
        allowOps: true
      });
      expect(opsDecision.authorized).toBe(true);
      expect(opsDecision.scopeMode).toBe(PERMISSION_SCOPES.OPS);
    });
  });

  describe('6. Centralized Route Entry Guard (registerProtectedRoute & createAuthorizationMiddleware)', () => {
    function createMockResponse() {
      let statusCode = 200;
      let headers = {};
      let body = '';
      return {
        writeHead(code, h = {}) {
          statusCode = code;
          headers = { ...headers, ...h };
        },
        end(data) {
          body = data;
          this.writableEnded = true;
        },
        get statusCode() { return statusCode; },
        get headers() { return headers; },
        get body() { return body ? JSON.parse(body) : null; },
        writableEnded: false
      };
    }

    it('enforces authentication and ownership on protected routes and ignores spoofed client parameters', async () => {
      const router = new Router();
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };
      const authzService = new AuthorizationService({ pool: mockPool });

      registerProtectedRoute(router, {
        method: 'GET',
        pattern: /^\/api\/v3\/students\/([^/]+)$/,
        action: ACTIONS.STUDENT_READ_PROFILE,
        resolveResource: (req, ctx) => ({
          // Route param specifies requested studentId; client also tries spoofing via header
          studentId: ctx.params[0]
        }),
        authOptions: {
          authorizationService: authzService
        },
        handler: async (req, res, ctx) => {
          sendSuccess(res, {
            studentId: ctx.authzDecision.studentId,
            actorRole: ctx.authContext.role
          });
        }
      });

      // Case A: Student A requests own profile -> 200 OK
      const reqOwn = {
        method: 'GET',
        url: '/api/v3/students/student-a-uuid',
        headers: { 'x-role': 'ADMIN', 'x-student-id': 'student-b-uuid' }
      };
      attachRequestContext(reqOwn, makeStudentContext());
      const resOwn = createMockResponse();
      await router.handle(reqOwn, resOwn);

      expect(resOwn.statusCode).toBe(200);
      expect(resOwn.body).toEqual({
        data: {
          studentId: 'student-a-uuid',
          actorRole: 'STUDENT'
        }
      });

      // Case B: Student A requests Student B's profile -> 403 Forbidden
      const reqCross = {
        method: 'GET',
        url: '/api/v3/students/student-b-uuid',
        headers: {}
      };
      attachRequestContext(reqCross, makeStudentContext());
      const resCross = createMockResponse();
      await router.handle(reqCross, resCross);

      expect(resCross.statusCode).toBe(403);
      expect(resCross.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied.'
        }
      });
    });

    it('authenticates protected routes as route-scoped middleware and leaves public routes untouched', async () => {
      const router = new Router();
      router.get('/api/health', (req, res) => sendSuccess(res, { status: 'ok' }));
      registerProtectedRoute(router, {
        method: 'GET',
        pattern: '/api/v3/me',
        action: ACTIONS.SESSION_READ_ME,
        authOptions: {
          tokenValidator: new TokenValidator({ expectedIssuer: 'https://iss', expectedClientId: 'cid' }),
          identityResolver: new IdentityResolver({ pool: { query: jest.fn() } })
        },
        handler: async (req, res) => sendSuccess(res, { ok: true })
      });

      const publicRes = createMockResponse();
      await router.handle({ method: 'GET', url: '/api/health', headers: {} }, publicRes);
      expect(publicRes.statusCode).toBe(200);

      const protectedRes = createMockResponse();
      await router.handle({ method: 'GET', url: '/api/v3/me', headers: {} }, protectedRes);
      expect(protectedRes.statusCode).toBe(401);
      expect(protectedRes.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects protected route registration without a valid canonical action', () => {
      const router = new Router();
      expect(() => registerProtectedRoute(router, {
        method: 'GET',
        pattern: '/api/v3/anything',
        action: 'plan:do_anything',
        handler: async () => {}
      })).toThrow(TypeError);
    });

    it('returns 503 when authorization lookups cannot reach the database', async () => {
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const authz = new AuthorizationService({
        pool: { query: jest.fn().mockRejectedValue(connectionError) }
      });
      const middleware = createAuthorizationMiddleware(ACTIONS.PLAN_LIST_READ, {
        authorizationService: authz,
        resolveResource: () => ({ planId: 'plan-a-1' })
      });

      const req = { headers: {} };
      attachRequestContext(req, makeStudentContext());
      const res = createMockResponse();
      await middleware(req, res, {});

      expect(res.statusCode).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('provides deterministic role capabilities for STUDENT, ADVISOR, STAFF, and ADMIN', () => {
      const studentCaps = getRoleCapabilities(ROLES.STUDENT);
      expect(studentCaps.scopeMode).toBe(PERMISSION_SCOPES.OWN);
      expect(studentCaps.canMutateStudentProfile).toBe(true);
      expect(studentCaps.canReviewPlan).toBe(false);
      expect(studentCaps.navigation.canAccessStudentDashboard).toBe(true);
      expect(studentCaps.navigation.canAccessStaffReviewQueue).toBe(false);

      const advisorCaps = getRoleCapabilities(ROLES.ADVISOR);
      expect(advisorCaps.scopeMode).toBe(PERMISSION_SCOPES.ASSIGNED);
      expect(advisorCaps.isReadOnly).toBe(true);
      expect(advisorCaps.canMutatePlanContent).toBe(false);
      expect(advisorCaps.navigation.canAccessAdvisorStudents).toBe(true);

      const staffCaps = getRoleCapabilities(ROLES.STAFF);
      expect(staffCaps.scopeMode).toBe(PERMISSION_SCOPES.SCOPED);
      expect(staffCaps.canReviewPlan).toBe(true);
      expect(staffCaps.canMutatePlanContent).toBe(false);
      expect(staffCaps.navigation.canAccessStaffReviewQueue).toBe(true);

      const adminCaps = getRoleCapabilities(ROLES.ADMIN);
      expect(adminCaps.scopeMode).toBe(PERMISSION_SCOPES.DENY);
      expect(adminCaps.isReadOnly).toBe(true);
    });
  });
});
