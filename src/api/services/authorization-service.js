/**
 * Centralized Authorization Policy Service for CO-ED V3.
 * Enforces Role-Based Access Control (RBAC), Student Ownership (OWN),
 * Advisor Active Assignment (ASSIGNED), and Staff Visibility/Review Scope (SCOPED).
 *
 * Pure service layer: throws domain errors from src/api/errors.js and delegates
 * SQL queries to AuthorizationRepository.
 * Conforms to Issue #49, #50, #53, #55, and #62.
 */

const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError
} = require('../errors');
const {
  AuthorizationRepository
} = require('../../db/repositories/authorization-repository');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLES = Object.freeze({
  PUBLIC: 'PUBLIC',
  STUDENT: 'STUDENT',
  ADVISOR: 'ADVISOR',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM'
});

const PERMISSION_SCOPES = Object.freeze({
  PUBLIC: 'PUBLIC',
  AUTHENTICATED: 'AUTHENTICATED',
  OWN: 'OWN',
  ASSIGNED: 'ASSIGNED',
  SCOPED: 'SCOPED',
  OPS: 'OPS',
  DENY: 'DENY'
});

const ACTIONS = Object.freeze({
  // Session bootstrap (#64)
  SESSION_READ_ME: 'session:read_me',

  // Company & Position permissions (#49)
  COMPANY_READ_PUBLIC: 'company:read_public',
  POSITION_READ_PUBLIC: 'position:read_public',
  DIRECTORY_SEARCH_PUBLIC: 'directory:search_public',
  COMPANY_READ_PRIVATE: 'company:read_private',
  COMPANY_CREATE: 'company:create',
  COMPANY_UPDATE: 'company:update',
  COMPANY_DELETE: 'company:delete',
  POSITION_CREATE: 'position:create',
  POSITION_UPDATE: 'position:update',
  POSITION_DELETE: 'position:delete',

  // Student resource permissions (#49)
  STUDENT_READ_PROFILE: 'student:read_profile',
  STUDENT_SEARCH_LIST: 'student:search_list',
  STUDENT_UPDATE_SELF_PROFILE: 'student:update_self_profile',
  STUDENT_UPDATE_STAFF_FIELDS: 'student:update_staff_fields',
  STUDENT_READ_STATUS_SUMMARY: 'student:read_status_summary',
  STUDENT_DELETE: 'student:delete',
  STUDENT_CHANGE_IDENTITY_LINK: 'student:change_identity_link',
  USER_CHANGE_ROLE: 'user:change_role',
  USER_DISABLE_ACCOUNT: 'user:disable_account',

  // Plan permissions (#49)
  PLAN_LIST_READ: 'plan:list_read',
  PLAN_CREATE: 'plan:create',
  PLAN_UPDATE_CONTENT: 'plan:update_content',
  PLAN_SELECT_COMPANY_POSITION: 'plan:select_company_position',
  PLAN_SUBMIT: 'plan:submit',
  PLAN_CANCEL: 'plan:cancel',
  PLAN_START_REVIEW: 'plan:start_review',
  PLAN_RETURN_FOR_REVISION: 'plan:return_for_revision',
  PLAN_APPROVE: 'plan:approve',
  PLAN_SET_STATUS_DIRECTLY: 'plan:set_status_directly',
  PLAN_DELETE: 'plan:delete',

  // Audit-history permissions (#49)
  AUDIT_READ_OWN_PLAN_HISTORY: 'audit:read_own_plan_history',
  AUDIT_READ_ASSIGNED_PLAN_HISTORY: 'audit:read_assigned_plan_history',
  AUDIT_READ_SCOPED_HISTORY: 'audit:read_scoped_history',
  AUDIT_READ_PLAN_HISTORY: 'audit:read_plan_history',
  AUDIT_CREATE_DIRECTLY: 'audit:create_directly',
  AUDIT_UPDATE_DELETE: 'audit:update_delete',

  // Advisor-assignment permissions (#49 & #53)
  ASSIGNMENT_READ_OWN: 'assignment:read_own',
  ASSIGNMENT_READ_SCOPED: 'assignment:read_scoped',
  ASSIGNMENT_MANAGE: 'assignment:manage',

  // Staff read-only search and review queue (#53 section 3.3, #67)
  STAFF_STUDENT_SEARCH: 'staff:search_students',
  STAFF_PLAN_SEARCH: 'staff:search_plans',
  STAFF_REVIEW_QUEUE_READ: 'staff:read_review_queue'
});

const REVIEW_MUTATION_ACTIONS = new Set([
  ACTIONS.PLAN_START_REVIEW,
  ACTIONS.PLAN_RETURN_FOR_REVISION,
  ACTIONS.PLAN_APPROVE
]);

// Issue #53 section 4.1: while a current Student assignment is active, an
// Advisor may read that Student's Plan history across every cycle. Assignment
// academic_year/semester describe the assignment itself; they do not narrow
// historical Plan reads.
const ADVISOR_HISTORICAL_PLAN_READ_ACTIONS = new Set([
  ACTIONS.PLAN_LIST_READ,
  ACTIONS.AUDIT_READ_ASSIGNED_PLAN_HISTORY,
  ACTIONS.AUDIT_READ_PLAN_HISTORY
]);

const MUTATION_ACTIONS = new Set([
  ACTIONS.COMPANY_CREATE,
  ACTIONS.COMPANY_UPDATE,
  ACTIONS.COMPANY_DELETE,
  ACTIONS.POSITION_CREATE,
  ACTIONS.POSITION_UPDATE,
  ACTIONS.POSITION_DELETE,
  ACTIONS.STUDENT_UPDATE_SELF_PROFILE,
  ACTIONS.STUDENT_UPDATE_STAFF_FIELDS,
  ACTIONS.STUDENT_DELETE,
  ACTIONS.STUDENT_CHANGE_IDENTITY_LINK,
  ACTIONS.USER_CHANGE_ROLE,
  ACTIONS.USER_DISABLE_ACCOUNT,
  ACTIONS.PLAN_CREATE,
  ACTIONS.PLAN_UPDATE_CONTENT,
  ACTIONS.PLAN_SELECT_COMPANY_POSITION,
  ACTIONS.PLAN_SUBMIT,
  ACTIONS.PLAN_CANCEL,
  ACTIONS.PLAN_START_REVIEW,
  ACTIONS.PLAN_RETURN_FOR_REVISION,
  ACTIONS.PLAN_APPROVE,
  ACTIONS.PLAN_SET_STATUS_DIRECTLY,
  ACTIONS.PLAN_DELETE,
  ACTIONS.AUDIT_CREATE_DIRECTLY,
  ACTIONS.AUDIT_UPDATE_DELETE,
  ACTIONS.ASSIGNMENT_MANAGE
]);

const STUDENT_EDITABLE_PLAN_STATES = new Set(['DRAFT', 'NEEDS_REVISION']);

const PERMISSION_MATRIX = Object.freeze({
  [ACTIONS.SESSION_READ_ME]: Object.freeze({
    [ROLES.PUBLIC]: PERMISSION_SCOPES.DENY,
    [ROLES.STUDENT]: PERMISSION_SCOPES.AUTHENTICATED,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.AUTHENTICATED,
    [ROLES.STAFF]: PERMISSION_SCOPES.AUTHENTICATED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.AUTHENTICATED,
    [ROLES.SYSTEM]: PERMISSION_SCOPES.DENY
  }),

  // Company & Position
  [ACTIONS.COMPANY_READ_PUBLIC]: Object.freeze({
    [ROLES.PUBLIC]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.STUDENT]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.STAFF]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.ADMIN]: PERMISSION_SCOPES.PUBLIC
  }),
  [ACTIONS.POSITION_READ_PUBLIC]: Object.freeze({
    [ROLES.PUBLIC]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.STUDENT]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.STAFF]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.ADMIN]: PERMISSION_SCOPES.PUBLIC
  }),
  [ACTIONS.DIRECTORY_SEARCH_PUBLIC]: Object.freeze({
    [ROLES.PUBLIC]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.STUDENT]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.STAFF]: PERMISSION_SCOPES.PUBLIC,
    [ROLES.ADMIN]: PERMISSION_SCOPES.PUBLIC
  }),
  [ACTIONS.COMPANY_READ_PRIVATE]: Object.freeze({}),
  [ACTIONS.COMPANY_CREATE]: Object.freeze({}),
  [ACTIONS.COMPANY_UPDATE]: Object.freeze({}),
  [ACTIONS.COMPANY_DELETE]: Object.freeze({}),
  [ACTIONS.POSITION_CREATE]: Object.freeze({}),
  [ACTIONS.POSITION_UPDATE]: Object.freeze({}),
  [ACTIONS.POSITION_DELETE]: Object.freeze({}),

  // Student resource
  [ACTIONS.STUDENT_READ_PROFILE]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.STUDENT_SEARCH_LIST]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.DENY,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.STUDENT_UPDATE_SELF_PROFILE]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.STUDENT_UPDATE_STAFF_FIELDS]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.DENY,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.OPS
  }),
  [ACTIONS.STUDENT_READ_STATUS_SUMMARY]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.STUDENT_DELETE]: Object.freeze({}),
  [ACTIONS.STUDENT_CHANGE_IDENTITY_LINK]: Object.freeze({
    [ROLES.ADMIN]: PERMISSION_SCOPES.OPS
  }),
  [ACTIONS.USER_CHANGE_ROLE]: Object.freeze({
    [ROLES.ADMIN]: PERMISSION_SCOPES.OPS
  }),
  [ACTIONS.USER_DISABLE_ACCOUNT]: Object.freeze({
    [ROLES.ADMIN]: PERMISSION_SCOPES.OPS
  }),

  // Plan resource
  [ACTIONS.PLAN_LIST_READ]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_CREATE]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_UPDATE_CONTENT]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_SELECT_COMPANY_POSITION]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_SUBMIT]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_CANCEL]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.DENY,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_START_REVIEW]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.DENY,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_RETURN_FOR_REVISION]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.DENY,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_APPROVE]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.DENY,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.DENY,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.PLAN_SET_STATUS_DIRECTLY]: Object.freeze({}),
  [ACTIONS.PLAN_DELETE]: Object.freeze({}),

  // Audit history
  [ACTIONS.AUDIT_READ_OWN_PLAN_HISTORY]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN
  }),
  [ACTIONS.AUDIT_READ_ASSIGNED_PLAN_HISTORY]: Object.freeze({
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED
  }),
  [ACTIONS.AUDIT_READ_SCOPED_HISTORY]: Object.freeze({
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED
  }),
  [ACTIONS.AUDIT_READ_PLAN_HISTORY]: Object.freeze({
    [ROLES.STUDENT]: PERMISSION_SCOPES.OWN,
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED,
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED,
    [ROLES.ADMIN]: PERMISSION_SCOPES.DENY
  }),
  [ACTIONS.AUDIT_CREATE_DIRECTLY]: Object.freeze({}),
  [ACTIONS.AUDIT_UPDATE_DELETE]: Object.freeze({}),

  // Advisor assignments
  [ACTIONS.ASSIGNMENT_READ_OWN]: Object.freeze({
    [ROLES.ADVISOR]: PERMISSION_SCOPES.ASSIGNED
  }),
  [ACTIONS.ASSIGNMENT_READ_SCOPED]: Object.freeze({
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED
  }),
  [ACTIONS.ASSIGNMENT_MANAGE]: Object.freeze({
    [ROLES.ADMIN]: PERMISSION_SCOPES.OPS
  }),

  // Staff-only read APIs; Advisor search belongs to #68, so every other role is DENY
  [ACTIONS.STAFF_STUDENT_SEARCH]: Object.freeze({
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED
  }),
  [ACTIONS.STAFF_PLAN_SEARCH]: Object.freeze({
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED
  }),
  [ACTIONS.STAFF_REVIEW_QUEUE_READ]: Object.freeze({
    [ROLES.STAFF]: PERMISSION_SCOPES.SCOPED
  })
});

function createForbiddenError(reason = 'FORBIDDEN') {
  const err = new ForbiddenError('Access denied.', 'FORBIDDEN');
  Object.defineProperty(err, 'reason', {
    value: reason,
    enumerable: false,
    writable: false
  });
  return err;
}

function createNotFoundError(reason = 'NOT_FOUND') {
  const err = new NotFoundError('Requested resource was not found.', 'RECORD_NOT_FOUND');
  Object.defineProperty(err, 'reason', {
    value: reason,
    enumerable: false,
    writable: false
  });
  return err;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getPermissionScope(role, action) {
  if (!isNonEmptyString(action)) {
    return PERMISSION_SCOPES.DENY;
  }
  const actionEntry = PERMISSION_MATRIX[action];
  if (!actionEntry) {
    return PERMISSION_SCOPES.DENY;
  }
  const effectiveRole = isNonEmptyString(role) ? role : ROLES.PUBLIC;
  return actionEntry[effectiveRole] || PERMISSION_SCOPES.DENY;
}

function getRoleCapabilities(role) {
  const allowedActions = [];
  const permissions = {};

  for (const [action, roleMap] of Object.entries(PERMISSION_MATRIX)) {
    const scope = roleMap[role] || PERMISSION_SCOPES.DENY;
    if (scope !== PERMISSION_SCOPES.DENY && scope !== PERMISSION_SCOPES.OPS) {
      allowedActions.push(action);
      permissions[action] = scope;
    }
  }

  const navigation = {
    canAccessStudentDashboard: role === ROLES.STUDENT,
    canAccessMyProfile: role === ROLES.STUDENT,
    canAccessMyPlan: role === ROLES.STUDENT,
    canAccessAdvisorStudents: role === ROLES.ADVISOR,
    canAccessStaffStudentManagement: role === ROLES.STAFF,
    canAccessStaffReviewQueue: role === ROLES.STAFF
  };

  return Object.freeze({
    role,
    scopeMode:
      role === ROLES.STUDENT
        ? PERMISSION_SCOPES.OWN
        : role === ROLES.ADVISOR
          ? PERMISSION_SCOPES.ASSIGNED
          : role === ROLES.STAFF
            ? PERMISSION_SCOPES.SCOPED
            : PERMISSION_SCOPES.DENY,
    canMutateStudentProfile: role === ROLES.STUDENT,
    canMutatePlanContent: role === ROLES.STUDENT,
    canSubmitPlan: role === ROLES.STUDENT,
    canReviewPlan: role === ROLES.STAFF,
    isReadOnly: role === ROLES.ADVISOR || role === ROLES.ADMIN,
    allowedActions: Object.freeze(allowedActions),
    permissions: Object.freeze(permissions),
    navigation: Object.freeze(navigation)
  });
}

class AuthorizationService {
  /**
   * @param {object} [options]
   * @param {object} [options.pool] Database connection pool (or mock with .query)
   * @param {AuthorizationRepository} [options.repository] Optional repository override
   * @param {Function} [options.now] Clock function returning Date or ISO string/ms
   */
  constructor(options = {}) {
    this.pool = options.pool || null;
    this.repository =
      options.repository || new AuthorizationRepository({ pool: this.pool });
    this.now = options.now || (() => new Date());
  }

  resolveTimestamp(explicitTimestamp) {
    const raw = explicitTimestamp !== undefined ? explicitTimestamp : this.now();
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw createForbiddenError('INVALID_TIMESTAMP');
    }
    return date;
  }

  async isActiveAdvisor({
    advisorUserId,
    studentId,
    academicYear = null,
    semester = null,
    requestTimestamp
  } = {}) {
    if (!isNonEmptyString(advisorUserId) || !isNonEmptyString(studentId)) {
      return false;
    }

    const reqTime = this.resolveTimestamp(requestTimestamp);
    const row = await this.repository.findActiveAdvisorAssignment({
      advisorUserId,
      studentId,
      academicYear,
      semester,
      timestampIso: reqTime.toISOString()
    });

    if (!row) {
      return false;
    }

    if (row.status && row.status !== 'ACTIVE') return false;
    if (row.revoked_at !== undefined && row.revoked_at !== null) return false;
    if (row.user_account_status && row.user_account_status !== 'ACTIVE') return false;
    if (row.user_role && row.user_role !== ROLES.ADVISOR) return false;
    if (
      academicYear !== null &&
      row.academic_year !== undefined &&
      Number(row.academic_year) !== Number(academicYear)
    ) {
      return false;
    }
    if (
      semester !== null &&
      row.semester !== undefined &&
      Number(row.semester) !== Number(semester)
    ) {
      return false;
    }
    if (row.effective_from && row.effective_to) {
      const fromMs = new Date(row.effective_from).getTime();
      const toMs = new Date(row.effective_to).getTime();
      const reqMs = reqTime.getTime();
      if (!(fromMs <= reqMs && toMs > reqMs)) {
        return false;
      }
    }

    return true;
  }

  async isInStaffScope({
    client = null,
    staffUserId,
    studentId,
    planId = null,
    isReviewAction = false
  } = {}) {
    if (!isNonEmptyString(staffUserId) || !isNonEmptyString(studentId)) {
      return false;
    }

    if (isReviewAction && !isNonEmptyString(planId)) {
      return false;
    }

    const scopeQuery = {
      staffUserId,
      studentId,
      planId,
      isReviewAction: Boolean(isReviewAction)
    };
    if (client) scopeQuery.client = client;

    const row = await this.repository.findStaffScopeMatch(scopeQuery);

    if (!row) {
      return false;
    }

    if (row.user_role && row.user_role !== ROLES.STAFF) return false;
    if (row.user_account_status && row.user_account_status !== 'ACTIVE') return false;
    if (row.scope_status && row.scope_status !== 'ACTIVE') return false;
    if (
      row.scope_department &&
      row.student_department &&
      row.scope_department !== row.student_department
    ) {
      return false;
    }
    if (
      row.scope_program &&
      row.student_program &&
      row.scope_program !== row.student_program
    ) {
      return false;
    }
    if (planId && Object.prototype.hasOwnProperty.call(row, 'plan_id') && !row.plan_id) {
      return false;
    }
    if (row.scope_academic_year !== undefined && row.scope_academic_year !== null) {
      const targetYear = planId ? row.round_academic_year : row.student_academic_year;
      if (
        targetYear !== undefined &&
        Number(targetYear) !== Number(row.scope_academic_year)
      ) {
        return false;
      }
    }
    if (isReviewAction) {
      if (!planId) return false;
      if (row.round_status && row.round_status !== 'OPEN') return false;
    }

    return true;
  }

  async getActiveStaffScopes(staffUserId) {
    if (!isNonEmptyString(staffUserId)) {
      return [];
    }

    const rows = await this.repository.listActiveStaffScopes(staffUserId);
    return rows.map((row) =>
      Object.freeze({
        department: row.department,
        program: row.program ?? null,
        academicYear: row.academicYear ?? row.academic_year ?? null
      })
    );
  }

  async getActiveAdvisorAssignments(advisorUserId, requestTimestamp) {
    if (!isNonEmptyString(advisorUserId)) {
      return [];
    }

    const reqTime = this.resolveTimestamp(requestTimestamp);
    const rows = await this.repository.listActiveAdvisorAssignments(
      advisorUserId,
      reqTime.toISOString()
    );
    return rows.map((row) =>
      Object.freeze({
        studentId: row.studentId ?? row.student_id,
        academicYear: Number(row.academicYear ?? row.academic_year),
        semester: Number(row.semester)
      })
    );
  }

  async findPlanResource(planId) {
    if (!isNonEmptyString(planId)) {
      return null;
    }
    return this.repository.findPlanById(planId);
  }

  async authorize(authContext, action, resource = {}) {
    const scopeMode = getPermissionScope(authContext?.role, action);

    if (scopeMode === PERMISSION_SCOPES.PUBLIC) {
      return Object.freeze({
        authorized: true,
        action,
        role: authContext?.role || ROLES.PUBLIC,
        scopeMode: PERMISSION_SCOPES.PUBLIC
      });
    }

    if (!authContext || !authContext.isAuthenticated || !isNonEmptyString(authContext.userId)) {
      throw new UnauthorizedError('Authentication required.', 'UNAUTHORIZED');
    }

    // Reject malformed Plan ids before any database lookup; otherwise PostgreSQL raises
    // 22P02 (invalid uuid) and every /api/v3/plans/:id route would answer 500.
    if (resource.planId !== undefined && resource.planId !== null && !UUID_REGEX.test(resource.planId)) {
      throw new ValidationError('Invalid plan id.', [{ field: 'planId', issue: 'must be a UUID' }]);
    }

    if (authContext.accountStatus !== 'ACTIVE') {
      throw createForbiddenError('ACCOUNT_DISABLED');
    }

    const role = authContext.role;

    if (role === ROLES.ADVISOR && (MUTATION_ACTIONS.has(action) || resource.isMutation)) {
      throw createForbiddenError('ADVISOR_MUTATION_PROHIBITED');
    }

    if (scopeMode === PERMISSION_SCOPES.DENY) {
      throw createForbiddenError('ACTION_DENIED_BY_POLICY');
    }

    if (scopeMode === PERMISSION_SCOPES.OPS) {
      if (role !== ROLES.ADMIN || resource.allowOps !== true) {
        throw createForbiddenError('OPS_BOUNDARY_REQUIRED');
      }
      return Object.freeze({
        authorized: true,
        action,
        role,
        scopeMode: PERMISSION_SCOPES.OPS,
        userId: authContext.userId
      });
    }

    if (scopeMode === PERMISSION_SCOPES.AUTHENTICATED) {
      return Object.freeze({
        authorized: true,
        action,
        role,
        scopeMode: PERMISSION_SCOPES.AUTHENTICATED,
        userId: authContext.userId,
        studentId: authContext.studentId || null
      });
    }

    if (scopeMode === PERMISSION_SCOPES.OWN) {
      if (role !== ROLES.STUDENT || !isNonEmptyString(authContext.studentId)) {
        throw createForbiddenError('STUDENT_OWNERSHIP_REQUIRED');
      }

      if (
        isNonEmptyString(resource.studentId) &&
        resource.studentId !== authContext.studentId
      ) {
        throw createForbiddenError('CROSS_STUDENT_ACCESS_DENIED');
      }

      // Ownership always comes from the database, never from caller-supplied fields.
      // Workflow state is deliberately NOT checked here: per #49 enforcement order the
      // Service checks state (step 6) after policy checks ownership (step 5), so a
      // non-editable state answers 422 INVALID_STATE_TRANSITION (#52 section 10), not 403.
      if (isNonEmptyString(resource.planId)) {
        const planRecord = await this.findPlanResource(resource.planId);
        if (!planRecord) {
          throw createNotFoundError('PLAN_NOT_FOUND');
        }
        if (planRecord.student_id !== authContext.studentId) {
          throw createForbiddenError('CROSS_STUDENT_PLAN_ACCESS_DENIED');
        }
      }

      return Object.freeze({
        authorized: true,
        action,
        role,
        scopeMode: PERMISSION_SCOPES.OWN,
        userId: authContext.userId,
        studentId: authContext.studentId,
        planId: resource.planId || null
      });
    }

    if (scopeMode === PERMISSION_SCOPES.ASSIGNED) {
      if (role !== ROLES.ADVISOR) {
        throw createForbiddenError('ADVISOR_ROLE_REQUIRED');
      }

      if (resource.listOnly === true) {
        const assignments = await this.getActiveAdvisorAssignments(
          authContext.userId,
          resource.requestTimestamp
        );
        return Object.freeze({
          authorized: true,
          action,
          role,
          scopeMode: PERMISSION_SCOPES.ASSIGNED,
          userId: authContext.userId,
          assignedStudents: Object.freeze(assignments)
        });
      }

      let targetStudentId = resource.studentId || null;
      let targetAcademicYear = resource.academicYear ?? null;
      let targetSemester = resource.semester ?? null;
      let planRecord = null;

      // A Plan owner always comes from the database (#53): the assignment check
      // must target the Student who actually owns the requested Plan. For
      // historical Plan reads, any current assignment to that Student grants
      // read-only history access across cycles, so the Plan round must not
      // narrow the assignment query.
      if (isNonEmptyString(resource.planId)) {
        planRecord = await this.findPlanResource(resource.planId);
        if (!planRecord) {
          throw createForbiddenError('ADVISOR_ASSIGNMENT_REQUIRED');
        }
        if (isNonEmptyString(targetStudentId) && planRecord.student_id !== targetStudentId) {
          throw createForbiddenError('ADVISOR_PLAN_STUDENT_MISMATCH');
        }
        targetStudentId = planRecord.student_id;
        if (!ADVISOR_HISTORICAL_PLAN_READ_ACTIONS.has(action)) {
          if (planRecord.round_academic_year !== undefined && planRecord.round_academic_year !== null) {
            targetAcademicYear = planRecord.round_academic_year;
          }
          if (planRecord.round_semester !== undefined && planRecord.round_semester !== null) {
            targetSemester = planRecord.round_semester;
          }
        }
      }

      if (!isNonEmptyString(targetStudentId)) {
        throw createForbiddenError('ADVISOR_ASSIGNMENT_REQUIRED');
      }

      const assigned = await this.isActiveAdvisor({
        advisorUserId: authContext.userId,
        studentId: targetStudentId,
        academicYear: targetAcademicYear,
        semester: targetSemester,
        requestTimestamp: resource.requestTimestamp
      });

      if (!assigned) {
        throw createForbiddenError('ADVISOR_NOT_ASSIGNED');
      }

      return Object.freeze({
        authorized: true,
        action,
        role,
        scopeMode: PERMISSION_SCOPES.ASSIGNED,
        userId: authContext.userId,
        studentId: targetStudentId,
        planId: resource.planId || null
      });
    }

    if (scopeMode === PERMISSION_SCOPES.SCOPED) {
      if (role !== ROLES.STAFF) {
        throw createForbiddenError('STAFF_ROLE_REQUIRED');
      }

      const isReviewAction =
        REVIEW_MUTATION_ACTIONS.has(action) || Boolean(resource.isReviewAction);

      if (resource.listOnly === true && !isReviewAction) {
        const staffScopes = await this.getActiveStaffScopes(authContext.userId);
        if (staffScopes.length === 0) {
          throw createForbiddenError('STAFF_NO_ACTIVE_SCOPE');
        }
        return Object.freeze({
          authorized: true,
          action,
          role,
          scopeMode: PERMISSION_SCOPES.SCOPED,
          userId: authContext.userId,
          staffScopes: Object.freeze(staffScopes)
        });
      }

      let targetStudentId = resource.studentId || null;
      const targetPlanId = resource.planId || null;

      if (isReviewAction && !isNonEmptyString(targetPlanId)) {
        throw createForbiddenError('STAFF_REVIEW_REQUIRES_PLAN');
      }

      if (isNonEmptyString(targetPlanId) && !isNonEmptyString(targetStudentId)) {
        const planRecord = await this.findPlanResource(targetPlanId);
        if (!planRecord) {
          const activeScopes = await this.getActiveStaffScopes(authContext.userId);
          if (activeScopes.length === 0) {
            throw createForbiddenError('STAFF_NO_ACTIVE_SCOPE');
          }
          throw createNotFoundError('PLAN_NOT_FOUND');
        }
        targetStudentId = planRecord.student_id;
      }

      if (!isNonEmptyString(targetStudentId)) {
        throw createForbiddenError('STAFF_SCOPE_TARGET_REQUIRED');
      }

      const inScope = await this.isInStaffScope({
        staffUserId: authContext.userId,
        studentId: targetStudentId,
        planId: targetPlanId,
        isReviewAction
      });

      if (!inScope) {
        throw createForbiddenError('STAFF_OUT_OF_SCOPE');
      }

      return Object.freeze({
        authorized: true,
        action,
        role,
        scopeMode: PERMISSION_SCOPES.SCOPED,
        userId: authContext.userId,
        studentId: targetStudentId,
        planId: targetPlanId,
        isReviewAction
      });
    }

    throw createForbiddenError('DENY_BY_DEFAULT');
  }

  async resolveSessionAccessSummary(authContext, options = {}) {
    await this.authorize(authContext, ACTIONS.SESSION_READ_ME);

    const capabilities = getRoleCapabilities(authContext.role);
    let operationalScopes = [];
    let assignedStudents = [];

    if (authContext.role === ROLES.STAFF) {
      operationalScopes = await this.getActiveStaffScopes(authContext.userId);
    } else if (authContext.role === ROLES.ADVISOR) {
      assignedStudents = await this.getActiveAdvisorAssignments(
        authContext.userId,
        options.requestTimestamp
      );
    }

    return Object.freeze({
      capabilities,
      operationalScopes: Object.freeze(operationalScopes),
      assignedStudents: Object.freeze(assignedStudents)
    });
  }
}

module.exports = {
  ROLES,
  PERMISSION_SCOPES,
  ACTIONS,
  REVIEW_MUTATION_ACTIONS,
  MUTATION_ACTIONS,
  STUDENT_EDITABLE_PLAN_STATES,
  PERMISSION_MATRIX,
  getPermissionScope,
  getRoleCapabilities,
  AuthorizationService
};
