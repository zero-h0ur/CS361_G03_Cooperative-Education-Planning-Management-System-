/**
 * Transactional Workflow and Immutable Audit Service for CO-ED V3.
 * Central service enforcing atomic, concurrency-safe Plan state transitions
 * and recording immutable audit events and idempotency operation records.
 *
 * Conforms to Issue #49, #50, #52, #53, #54, #56, #62, and #63.
 */

const crypto = require('crypto');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InvalidStateTransitionError
} = require('../errors');
const { WorkflowRepository } = require('../../db/repositories/workflow-repository');
const { AuthorizationService } = require('./authorization-service');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

const PLAN_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEEDS_REVISION: 'NEEDS_REVISION',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED'
});

const TERMINAL_STATES = new Set([PLAN_STATES.APPROVED, PLAN_STATES.CANCELLED]);

const ACTIONS = Object.freeze({
  PLAN_SUBMIT: 'plan:submit',
  PLAN_START_REVIEW: 'plan:start_review',
  PLAN_RETURN_FOR_REVISION: 'plan:return_for_revision',
  PLAN_APPROVE: 'plan:approve',
  PLAN_CANCEL: 'plan:cancel'
});

const AUDIT_ACTIONS = Object.freeze({
  [ACTIONS.PLAN_SUBMIT]: 'PLAN_SUBMITTED',
  [ACTIONS.PLAN_START_REVIEW]: 'PLAN_REVIEW_STARTED',
  [ACTIONS.PLAN_RETURN_FOR_REVISION]: 'PLAN_RETURNED',
  [ACTIONS.PLAN_APPROVE]: 'PLAN_APPROVED',
  [ACTIONS.PLAN_CANCEL]: 'PLAN_CANCELLED'
});

const ACTION_ALIASES = Object.freeze({
  'submit': ACTIONS.PLAN_SUBMIT,
  'SUBMIT': ACTIONS.PLAN_SUBMIT,
  'plan:submit': ACTIONS.PLAN_SUBMIT,
  'plan_submit': ACTIONS.PLAN_SUBMIT,
  'PLAN_SUBMIT': ACTIONS.PLAN_SUBMIT,
  'PLAN_SUBMITTED': ACTIONS.PLAN_SUBMIT,

  'start_review': ACTIONS.PLAN_START_REVIEW,
  'START_REVIEW': ACTIONS.PLAN_START_REVIEW,
  'startReview': ACTIONS.PLAN_START_REVIEW,
  'plan:start_review': ACTIONS.PLAN_START_REVIEW,
  'plan_start_review': ACTIONS.PLAN_START_REVIEW,
  'PLAN_REVIEW_STARTED': ACTIONS.PLAN_START_REVIEW,

  'return_for_revision': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'RETURN_FOR_REVISION': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'returnForRevision': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'plan:return_for_revision': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'plan_return_for_revision': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'PLAN_RETURNED': ACTIONS.PLAN_RETURN_FOR_REVISION,

  'approve': ACTIONS.PLAN_APPROVE,
  'APPROVE': ACTIONS.PLAN_APPROVE,
  'plan:approve': ACTIONS.PLAN_APPROVE,
  'plan_approve': ACTIONS.PLAN_APPROVE,
  'PLAN_APPROVED': ACTIONS.PLAN_APPROVE,

  'cancel': ACTIONS.PLAN_CANCEL,
  'CANCEL': ACTIONS.PLAN_CANCEL,
  'plan:cancel': ACTIONS.PLAN_CANCEL,
  'plan_cancel': ACTIONS.PLAN_CANCEL,
  'PLAN_CANCELLED': ACTIONS.PLAN_CANCEL
});

const TRANSITION_RULES = Object.freeze({
  [ACTIONS.PLAN_SUBMIT]: Object.freeze({
    allowedFrom: Object.freeze([PLAN_STATES.DRAFT, PLAN_STATES.NEEDS_REVISION]),
    targetState: PLAN_STATES.SUBMITTED,
    allowedRoles: Object.freeze(['STUDENT']),
    isReviewAction: false,
    validatePreconditions: (plan) => {
      const details = [];
      if (!plan.cycle_id) {
        details.push({ field: 'cycle_id', issue: 'cycle_id is required to submit' });
      } else if (plan.round_status !== 'OPEN') {
        details.push({ field: 'cycle_id', issue: 'cycle must exist and be open for submission' });
      }
      if (!plan.company_id) details.push({ field: 'company_id', issue: 'company_id is required to submit' });
      if (!plan.position_id) details.push({ field: 'position_id', issue: 'position_id is required to submit' });

      // #52 ข้อ 3: Company and Position must have public visibility
      if (plan.company_id && plan.company_visibility && plan.company_visibility !== 'public') {
        details.push({ field: 'company_id', issue: 'selected company must have public visibility' });
      }
      if (plan.position_id && plan.position_visibility && plan.position_visibility !== 'public') {
        details.push({ field: 'position_id', issue: 'selected position must have public visibility' });
      }

      // #52 ข้อ 3: Position must belong to the selected Company
      if (
        plan.company_id &&
        plan.position_id &&
        plan.position_company_id &&
        plan.position_company_id !== plan.company_id
      ) {
        details.push({ field: 'position_id', issue: 'selected position does not belong to the selected company' });
      }

      if (details.length > 0) {
        throw new ValidationError('Plan must have cycle, public company, and matching public position specified before submission.', details);
      }
    }
  }),

  [ACTIONS.PLAN_START_REVIEW]: Object.freeze({
    allowedFrom: Object.freeze([PLAN_STATES.SUBMITTED]),
    targetState: PLAN_STATES.UNDER_REVIEW,
    allowedRoles: Object.freeze(['STAFF']),
    isReviewAction: true,
    validatePreconditions: () => {}
  }),

  [ACTIONS.PLAN_RETURN_FOR_REVISION]: Object.freeze({
    allowedFrom: Object.freeze([PLAN_STATES.UNDER_REVIEW]),
    targetState: PLAN_STATES.NEEDS_REVISION,
    allowedRoles: Object.freeze(['STAFF']),
    isReviewAction: true,
    validatePreconditions: (plan, options) => {
      const rawNotes = options?.review_notes !== undefined
        ? options.review_notes
        : (options?.notes !== undefined ? options.notes : options?.comment);
      if (
        rawNotes === undefined ||
        rawNotes === null ||
        typeof rawNotes !== 'string' ||
        rawNotes.trim().length === 0
      ) {
        throw new ValidationError('Feedback review notes are required when returning a plan for revision.', [
          { field: 'review_notes', issue: 'review_notes cannot be empty' }
        ]);
      }
      if (rawNotes.trim().length > 2000) {
        throw new ValidationError('Feedback review notes cannot exceed 2000 characters.', [
          { field: 'review_notes', issue: 'review_notes exceeds maximum length of 2000' }
        ]);
      }
    }
  }),

  [ACTIONS.PLAN_APPROVE]: Object.freeze({
    allowedFrom: Object.freeze([PLAN_STATES.UNDER_REVIEW]),
    targetState: PLAN_STATES.APPROVED,
    allowedRoles: Object.freeze(['STAFF']),
    isReviewAction: true,
    validatePreconditions: (plan, options) => {
      // #52: review_notes is OPTIONAL for approve
      const rawNotes = options?.review_notes !== undefined
        ? options.review_notes
        : (options?.notes !== undefined ? options.notes : options?.comment);
      if (rawNotes !== undefined && rawNotes !== null) {
        if (typeof rawNotes !== 'string' || rawNotes.trim().length > 2000) {
          throw new ValidationError('Approval review notes cannot exceed 2000 characters.', [
            { field: 'review_notes', issue: 'review_notes exceeds maximum length of 2000' }
          ]);
        }
      }
    }
  }),

  [ACTIONS.PLAN_CANCEL]: Object.freeze({
    // #54: cancel allowed only from DRAFT, SUBMITTED, NEEDS_REVISION (UNDER_REVIEW removed)
    allowedFrom: Object.freeze([
      PLAN_STATES.DRAFT,
      PLAN_STATES.SUBMITTED,
      PLAN_STATES.NEEDS_REVISION
    ]),
    targetState: PLAN_STATES.CANCELLED,
    allowedRoles: Object.freeze(['STUDENT']),
    isReviewAction: false,
    validatePreconditions: (plan, options) => {
      const rawNotes = options?.review_notes !== undefined
        ? options.review_notes
        : (options?.notes !== undefined ? options.notes : options?.comment);
      if (rawNotes !== undefined && rawNotes !== null) {
        if (typeof rawNotes !== 'string' || rawNotes.trim().length > 2000) {
          throw new ValidationError('Cancellation review notes cannot exceed 2000 characters.', [
            { field: 'review_notes', issue: 'review_notes exceeds maximum length of 2000' }
          ]);
        }
      }
    }
  })
});

const ALLOWED_PARAM_KEYS = new Set([
  'actor',
  'planId',
  'plan_id',
  'action',
  'expectedVersion',
  'expected_version',
  'operationId',
  'operation_id',
  'reviewNotes',
  'review_notes',
  'notes',
  'comment',
  'correlationId',
  'correlation_id',
  'requestHash',
  'request_hash',
  'idempotencyKey'
]);

function canonicalizeAction(action) {
  if (typeof action !== 'string') return null;
  return ACTION_ALIASES[action.trim()] || null;
}

function normalizeHash(hashInput, fallbackSeed) {
  if (typeof hashInput === 'string' && hashInput.trim().length > 0) {
    const trimmed = hashInput.trim();
    if (SHA256_HEX_REGEX.test(trimmed)) {
      return trimmed;
    }
    return crypto.createHash('sha256').update(trimmed).digest('hex');
  }
  return crypto.createHash('sha256').update(fallbackSeed || crypto.randomUUID()).digest('hex');
}

class WorkflowService {
  /**
   * @param {object} [options]
   * @param {WorkflowRepository} [options.repository]
   * @param {AuthorizationService} [options.authorizationService]
   */
  constructor(options = {}) {
    this.repository = options.repository || new WorkflowRepository(options);
    this.authorizationService = options.authorizationService || new AuthorizationService(options);
  }

  /**
   * Primary entry point for transactional Plan workflow state transitions.
   *
   * Enforces:
   * 1. Reject unknown or unallowed fields with 400 (#52 ข้อ 6)
   * 2. Authentication and actor validation (fail-closed, 401/403)
   * 3. Row locking via SELECT FOR UPDATE OF p
   * 4. Centralized authorization via AuthorizationService (#62)
   * 5. Idempotency cache verification strictly AFTER authorization (#52 ข้อ 9)
   * 6. Optimistic concurrency check (409 on version mismatch)
   * 7. State machine transition check (#54, 422 on illegal transition)
   * 8. Precondition validation (400 on missing submittable fields / notes)
   * 9. Atomic single-transaction Plan update, operation logging, and immutable audit event
   *
   * @param {object} params
   * @param {object} params.actor Authenticated user context from auth middleware
   * @param {string} [params.plan_id] UUID of target Plan (standard snake_case #52)
   * @param {string} [params.planId] UUID alias
   * @param {string} params.action Transition action ('plan:submit', 'plan:approve', etc.)
   * @param {number} [params.expected_version] Optimistic concurrency version (snake_case #52)
   * @param {number} [params.expectedVersion] Optimistic concurrency version alias
   * @param {string} [params.operation_id] Client supplied operation UUID (#52)
   * @param {string} [params.operationId] Operation UUID alias
   * @param {string} [params.review_notes] Feedback or reason notes (1-2000 characters) (#52)
   * @param {string} [params.notes] Feedback alias
   * @param {string} [params.correlation_id] UUID for tracking event chain
   * @param {string} [params.correlationId] UUID alias
   * @returns {Promise<object>} Result containing updated plan, operation, and audit event
   */
  async executeTransition(params = {}) {
    // 0. Reject unknown or unallowed fields with 400 (#52 ข้อ 6)
    const unknownKeys = Object.keys(params || {}).filter((k) => !ALLOWED_PARAM_KEYS.has(k));
    if (unknownKeys.length > 0) {
      throw new ValidationError(
        `Unknown or unallowed field(s): ${unknownKeys.join(', ')}`,
        unknownKeys.map((k) => ({ field: k, issue: 'unknown or unallowed field' }))
      );
    }

    // 0.1 Reject conflicting duplicate aliases (#52)
    const duplicatePairs = [
      ['plan_id', 'planId'],
      ['expected_version', 'expectedVersion'],
      ['operation_id', 'operationId'],
      ['review_notes', 'notes'],
      ['review_notes', 'reviewNotes'],
      ['notes', 'reviewNotes'],
      ['correlation_id', 'correlationId'],
      ['operation_id', 'idempotencyKey'],
      ['operation_id', 'requestHash'],
      ['operation_id', 'request_hash'],
      ['request_hash', 'requestHash']
    ];

    for (const [snake, camel] of duplicatePairs) {
      if (
        Object.prototype.hasOwnProperty.call(params, snake) &&
        Object.prototype.hasOwnProperty.call(params, camel)
      ) {
        throw new ValidationError(
          `Conflicting duplicate fields provided: both '${snake}' and '${camel}' are present.`,
          [{ field: camel, issue: `duplicate field: specify only '${snake}'` }]
        );
      }
    }

    const actor = params.actor;
    const planId = params.plan_id || params.planId;
    const action = params.action;
    const expectedVersion = params.expected_version !== undefined ? params.expected_version : params.expectedVersion;
    const rawOperationId = params.operation_id !== undefined
      ? params.operation_id
      : (params.operationId !== undefined
        ? params.operationId
        : (params.idempotencyKey !== undefined ? params.idempotencyKey : params.request_hash));
    const correlationId = params.correlation_id || params.correlationId || null;
    const rawNotes = params.review_notes !== undefined
      ? params.review_notes
      : (params.notes !== undefined ? params.notes : (params.comment !== undefined ? params.comment : undefined));

    // 1. Validate Actor
    if (!actor || !actor.isAuthenticated || !actor.userId) {
      throw new UnauthorizedError('Authentication required.', 'UNAUTHORIZED');
    }

    if (actor.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    // Role boundaries: Advisors have strictly read-only access (#49, #53)
    if (actor.role === 'ADVISOR') {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    // Admins cannot perform plan workflow transitions directly (#49)
    if (actor.role === 'ADMIN') {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    // 2. Validate Action
    const canonicalAction = canonicalizeAction(action);
    if (!canonicalAction || !TRANSITION_RULES[canonicalAction]) {
      throw new ValidationError(`Unknown or unsupported workflow action: ${action}`, [
        { field: 'action', issue: 'must be a recognized workflow transition action' }
      ]);
    }

    const rule = TRANSITION_RULES[canonicalAction];

    // 3. Validate Role Permission for Action
    if (!rule.allowedRoles.includes(actor.role)) {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    // 4. Validate Plan ID
    if (!planId || typeof planId !== 'string' || !UUID_REGEX.test(planId)) {
      throw new ValidationError('Invalid planId: must be a valid UUID.', [
        { field: 'plan_id', issue: 'must be a valid UUID string' }
      ]);
    }

    // 5. Validate Expected Version
    if (
      expectedVersion === undefined ||
      expectedVersion === null ||
      !Number.isInteger(Number(expectedVersion)) ||
      Number(expectedVersion) < 1
    ) {
      throw new ValidationError('expected_version is required and must be an integer >= 1.', [
        { field: 'expected_version', issue: 'must be an integer >= 1' }
      ]);
    }
    const parsedExpectedVersion = Number(expectedVersion);

    // 6. Validate Operation ID (#52 ข้อ 9: Mandatory from client)
    if (
      rawOperationId === undefined ||
      rawOperationId === null ||
      typeof rawOperationId !== 'string' ||
      !UUID_REGEX.test(rawOperationId)
    ) {
      throw new ValidationError('operation_id is required and must be a valid UUID string.', [
        { field: 'operation_id', issue: 'operation_id is required and must be a valid UUID string' }
      ]);
    }
    const finalOperationId = rawOperationId;

    // 7. Validate Correlation ID
    let finalCorrelationId = null;
    if (correlationId !== undefined && correlationId !== null) {
      if (typeof correlationId !== 'string' || !UUID_REGEX.test(correlationId)) {
        throw new ValidationError('Invalid correlationId: must be a valid UUID string.', [
          { field: 'correlation_id', issue: 'must be a valid UUID string' }
        ]);
      }
      finalCorrelationId = correlationId;
    } else {
      finalCorrelationId = crypto.randomUUID();
    }

    // 8. Normalize Notes (#52 ข้อ 6)
    let trimmedNotes = null;
    if (typeof rawNotes === 'string') {
      const trimmed = rawNotes.trim();
      if (trimmed.length > 2000) {
        throw new ValidationError('Notes cannot exceed 2000 characters.', [
          { field: 'review_notes', issue: 'notes exceeds maximum length of 2000' }
        ]);
      }
      trimmedNotes = trimmed.length === 0 ? null : trimmed;
    } else if (rawNotes === null || rawNotes === undefined) {
      trimmedNotes = null;
    } else {
      throw new ValidationError('Notes must be a string or null.', [
        { field: 'review_notes', issue: 'notes must be a string or null' }
      ]);
    }

    // 9. Compute Normalized Payload Hash for Idempotency Deduplication (#52 ข้อ 9)
    const normalizedPayloadObj = {
      review_notes: trimmedNotes
    };
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(normalizedPayloadObj)).digest('hex');

    if (
      (canonicalAction === ACTIONS.PLAN_SUBMIT || canonicalAction === ACTIONS.PLAN_CANCEL) &&
      rawNotes !== undefined
    ) {
      throw new ValidationError('review_notes is not allowed for Student workflow actions.', [
        { field: 'review_notes', issue: 'field is only allowed for Staff review actions' }
      ]);
    }

    // 10. Begin Database Transaction
    const client = await this.repository.getClient();
    try {
      await client.query('BEGIN');

      // Acquire exclusive row lock on the plan row
      const lockedPlan = await this.repository.findPlanByIdForUpdate(client, planId);
      if (!lockedPlan) {
        throw new NotFoundError('Plan not found.', 'RECORD_NOT_FOUND');
      }

      // 11. Centralized Authorization Policy (#62)
      // Check ownership or staff scope on the locked row BEFORE checking cache or version
      if (actor.role === 'STUDENT') {
        if (lockedPlan.student_id !== actor.studentId) {
          throw new ForbiddenError('Access denied.', 'FORBIDDEN');
        }
      } else if (actor.role === 'STAFF') {
        // Enforces full predicate of #53 via centralized AuthorizationService
        const inScope = await this.authorizationService.isInStaffScope({
          client,
          staffUserId: actor.userId,
          studentId: lockedPlan.student_id,
          planId: lockedPlan.id,
          isReviewAction: true
        });

        if (!inScope) {
          throw new ForbiddenError('Access denied.', 'FORBIDDEN');
        }
      }

      // 12. Idempotency Check (#52 ข้อ 9)
      // Executed strictly AFTER authorization to prevent cache leakage
      const existingOp = await this.repository.findOperationById(client, finalOperationId);
      if (existingOp) {
        const planMatches = existingOp.plan_id === planId;
        const actorMatches = existingOp.actor_id === actor.userId;
        const actionMatches =
          existingOp.action === canonicalAction ||
          existingOp.action === AUDIT_ACTIONS[canonicalAction];
        const payloadMatches = existingOp.request_hash === payloadHash;

        if (planMatches && actorMatches && actionMatches && payloadMatches) {
          await client.query('ROLLBACK');
          return Object.freeze({
            idempotentReplay: true,
            status: existingOp.response_status,
            data: existingOp.response_payload,
            plan: existingOp.response_payload,
            operation: {
              operation_id: existingOp.operation_id,
              request_hash: existingOp.request_hash,
              response_status: existingOp.response_status,
              result_version: existingOp.result_version
            }
          });
        }

        throw new ConflictError(
          'Idempotency key has already been used with different request parameters.',
          'IDEMPOTENCY_KEY_REUSED'
        );
      }

      // 13. Check Optimistic Concurrency (#52 ข้อ 9)
      if (Number(lockedPlan.version) !== parsedExpectedVersion) {
        throw new ConflictError(
          'Plan has been updated by another transaction. Please reload and retry.',
          'STALE_RECORD_CONFLICT',
          { expectedVersion: parsedExpectedVersion, currentVersion: Number(lockedPlan.version) }
        );
      }

      // 14. Check State Machine Validity (#54)
      if (!rule.allowedFrom.includes(lockedPlan.status)) {
        throw new InvalidStateTransitionError(
          `Cannot transition Plan from status ${lockedPlan.status} via action ${canonicalAction}. Allowed statuses: ${rule.allowedFrom.join(', ')}.`
        );
      }

      // 15. Check Preconditions (#52 ข้อ 3)
      rule.validatePreconditions(lockedPlan, { review_notes: trimmedNotes, notes: trimmedNotes });

      // 16. Increment Version and Apply status only. Review notes belong exclusively
      // to immutable audit events and must never overwrite Student-authored Plan notes.
      const nextVersion = Number(lockedPlan.version) + 1;
      const updatedPlan = await this.repository.updatePlanStatus(client, {
        planId: lockedPlan.id,
        status: rule.targetState,
        nextVersion,
        expectedVersion: lockedPlan.version
      });

      if (!updatedPlan) {
        throw new ConflictError(
          'Plan concurrent modification detected during update.',
          'STALE_RECORD_CONFLICT'
        );
      }

      // 18. Construct Response Payload
      const responsePayload = Object.freeze({
        id: updatedPlan.id,
        status: updatedPlan.status,
        version: updatedPlan.version,
        student_id: updatedPlan.student_id,
        cycle_id: updatedPlan.cycle_id,
        round_id: updatedPlan.round_id,
        company_id: updatedPlan.company_id,
        position_id: updatedPlan.position_id,
        notes: updatedPlan.notes,
        created_at: updatedPlan.created_at,
        updated_at: updatedPlan.updated_at
      });

      // 19. Record Operation (#52 ข้อ 9)
      const auditAction = AUDIT_ACTIONS[canonicalAction];
      const planOperation = await this.repository.insertPlanOperation(client, {
        operationId: finalOperationId,
        planId: lockedPlan.id,
        actorId: actor.userId,
        action: auditAction,
        requestHash: payloadHash,
        responseStatus: 200,
        responsePayload,
        resultVersion: nextVersion
      });

      // 20. Append Immutable Audit Event (#52)
      const eventId = crypto.randomUUID();
      const auditEvent = await this.repository.insertAuditEvent(client, {
        eventId,
        planId: lockedPlan.id,
        actorId: actor.userId,
        actorRole: actor.role,
        action: auditAction,
        resourceType: 'plan',
        resourceId: lockedPlan.id,
        fromState: lockedPlan.status,
        toState: rule.targetState,
        notes: trimmedNotes,
        correlationId: finalCorrelationId,
        operationId: finalOperationId
      });

      await client.query('COMMIT');

      return Object.freeze({
        plan: responsePayload,
        fromState: lockedPlan.status,
        toState: rule.targetState,
        version: nextVersion,
        operation: planOperation,
        auditEvent
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Rollback failure is ignored to preserve original error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Convenience Action Helpers ---

  async submitPlan(params = {}) {
    return this.executeTransition({ ...params, action: ACTIONS.PLAN_SUBMIT });
  }

  async startReview(params = {}) {
    return this.executeTransition({ ...params, action: ACTIONS.PLAN_START_REVIEW });
  }

  async returnForRevision(params = {}) {
    return this.executeTransition({ ...params, action: ACTIONS.PLAN_RETURN_FOR_REVISION });
  }

  async approvePlan(params = {}) {
    return this.executeTransition({ ...params, action: ACTIONS.PLAN_APPROVE });
  }

  async cancelPlan(params = {}) {
    return this.executeTransition({ ...params, action: ACTIONS.PLAN_CANCEL });
  }

}

module.exports = {
  PLAN_STATES,
  TERMINAL_STATES,
  ACTIONS,
  AUDIT_ACTIONS,
  TRANSITION_RULES,
  WorkflowService
};
