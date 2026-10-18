/**
 * Transactional Workflow and Immutable Audit Service for CO-ED V3.
 * Central service enforcing atomic, concurrency-safe Plan state transitions
 * and recording immutable audit events and idempotency operation records.
 *
 * Conforms to Issue #49, #50, #53, #54, #56, #62, and #63.
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

const ACTION_ALIASES = Object.freeze({
  'submit': ACTIONS.PLAN_SUBMIT,
  'SUBMIT': ACTIONS.PLAN_SUBMIT,
  'plan:submit': ACTIONS.PLAN_SUBMIT,

  'start_review': ACTIONS.PLAN_START_REVIEW,
  'START_REVIEW': ACTIONS.PLAN_START_REVIEW,
  'startReview': ACTIONS.PLAN_START_REVIEW,
  'plan:start_review': ACTIONS.PLAN_START_REVIEW,

  'return_for_revision': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'RETURN_FOR_REVISION': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'returnForRevision': ACTIONS.PLAN_RETURN_FOR_REVISION,
  'plan:return_for_revision': ACTIONS.PLAN_RETURN_FOR_REVISION,

  'approve': ACTIONS.PLAN_APPROVE,
  'APPROVE': ACTIONS.PLAN_APPROVE,
  'plan:approve': ACTIONS.PLAN_APPROVE,

  'cancel': ACTIONS.PLAN_CANCEL,
  'CANCEL': ACTIONS.PLAN_CANCEL,
  'plan:cancel': ACTIONS.PLAN_CANCEL
});

const TRANSITION_RULES = Object.freeze({
  [ACTIONS.PLAN_SUBMIT]: Object.freeze({
    allowedFrom: Object.freeze([PLAN_STATES.DRAFT, PLAN_STATES.NEEDS_REVISION]),
    targetState: PLAN_STATES.SUBMITTED,
    allowedRoles: Object.freeze(['STUDENT']),
    isReviewAction: false,
    validatePreconditions: (plan) => {
      const cycleId = plan.cycle_id || plan.round_id;
      const details = [];
      if (!cycleId) details.push({ field: 'cycle_id', issue: 'cycle_id is required to submit' });
      if (!plan.company_id) details.push({ field: 'company_id', issue: 'company_id is required to submit' });
      if (!plan.position_id) details.push({ field: 'position_id', issue: 'position_id is required to submit' });
      if (details.length > 0) {
        throw new ValidationError('Plan must have cycle, company, and position specified before submission.', details);
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
      const rawNotes = options?.notes !== undefined ? options.notes : options?.comment;
      if (
        rawNotes === undefined ||
        rawNotes === null ||
        typeof rawNotes !== 'string' ||
        rawNotes.trim().length === 0
      ) {
        throw new ValidationError('Feedback notes are required when returning a plan for revision.', [
          { field: 'notes', issue: 'notes cannot be empty' }
        ]);
      }
      if (rawNotes.trim().length > 2000) {
        throw new ValidationError('Feedback notes cannot exceed 2000 characters.', [
          { field: 'notes', issue: 'notes exceeds maximum length of 2000' }
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
      const rawNotes = options?.notes !== undefined ? options.notes : options?.comment;
      if (rawNotes !== undefined && rawNotes !== null) {
        if (typeof rawNotes !== 'string' || rawNotes.trim().length > 2000) {
          throw new ValidationError('Approval notes cannot exceed 2000 characters.', [
            { field: 'notes', issue: 'notes exceeds maximum length of 2000' }
          ]);
        }
      }
    }
  }),

  [ACTIONS.PLAN_CANCEL]: Object.freeze({
    allowedFrom: Object.freeze([
      PLAN_STATES.DRAFT,
      PLAN_STATES.SUBMITTED,
      PLAN_STATES.UNDER_REVIEW,
      PLAN_STATES.NEEDS_REVISION
    ]),
    targetState: PLAN_STATES.CANCELLED,
    allowedRoles: Object.freeze(['STUDENT']),
    isReviewAction: false,
    validatePreconditions: (plan, options) => {
      const rawNotes = options?.notes !== undefined ? options.notes : options?.comment;
      if (rawNotes !== undefined && rawNotes !== null) {
        if (typeof rawNotes !== 'string' || rawNotes.trim().length > 2000) {
          throw new ValidationError('Cancellation notes cannot exceed 2000 characters.', [
            { field: 'notes', issue: 'notes exceeds maximum length of 2000' }
          ]);
        }
      }
    }
  })
});

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
   * 1. Authentication and actor validation (fail-closed, 401/403)
   * 2. Row locking via SELECT FOR UPDATE OF p
   * 3. Centralized authorization via AuthorizationService (#62)
   * 4. Idempotency cache verification strictly AFTER authorization
   * 5. Optimistic concurrency check (409 on version mismatch)
   * 6. State machine transition check (#54, 422 on illegal transition)
   * 7. Precondition validation (400 on missing submittable fields / notes)
   * 8. Atomic single-transaction Plan update, operation logging, and immutable audit event
   *
   * @param {object} params
   * @param {object} params.actor Authenticated user context from auth middleware
   * @param {string} params.planId UUID of target Plan
   * @param {string} params.action Transition action ('plan:submit', 'plan:approve', etc.)
   * @param {number} params.expectedVersion Optimistic concurrency version
   * @param {string} [params.notes] Feedback or reason notes (1-2000 characters)
   * @param {string} [params.correlationId] UUID for tracking event chain
   * @param {string} [params.requestHash] Idempotency hash or key
   * @param {string} [params.idempotencyKey] Alternative alias for requestHash
   * @returns {Promise<object>} Result containing updated plan, operation, and audit event
   */
  async executeTransition({
    actor,
    planId,
    action,
    expectedVersion,
    notes,
    comment,
    correlationId,
    requestHash,
    idempotencyKey
  } = {}) {
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
        { field: 'planId', issue: 'must be a valid UUID string' }
      ]);
    }

    // 5. Validate Expected Version
    if (
      expectedVersion === undefined ||
      expectedVersion === null ||
      !Number.isInteger(Number(expectedVersion)) ||
      Number(expectedVersion) < 1
    ) {
      throw new ValidationError('expectedVersion is required and must be an integer >= 1.', [
        { field: 'expectedVersion', issue: 'must be an integer >= 1' }
      ]);
    }
    const parsedExpectedVersion = Number(expectedVersion);

    // 6. Validate Correlation ID
    let finalCorrelationId = null;
    if (correlationId !== undefined && correlationId !== null) {
      if (typeof correlationId !== 'string' || !UUID_REGEX.test(correlationId)) {
        throw new ValidationError('Invalid correlationId: must be a valid UUID string.', [
          { field: 'correlationId', issue: 'must be a valid UUID string' }
        ]);
      }
      finalCorrelationId = correlationId;
    } else {
      finalCorrelationId = crypto.randomUUID();
    }

    // 7. Normalize Request Hash (bound to planId + actorId + action)
    const rawKey = requestHash || idempotencyKey || null;
    let finalRequestHash = null;
    let isCallerSuppliedHash = false;

    if (rawKey !== null) {
      finalRequestHash = normalizeHash(rawKey, `${planId}:${actor.userId}:${canonicalAction}:${rawKey}`);
      isCallerSuppliedHash = true;
    }

    // 8. Begin Database Transaction
    const client = await this.repository.getClient();
    try {
      await client.query('BEGIN');

      // Acquire exclusive row lock on the plan row
      const lockedPlan = await this.repository.findPlanByIdForUpdate(client, planId);
      if (!lockedPlan) {
        throw new NotFoundError('Plan not found.', 'RECORD_NOT_FOUND');
      }

      // 9. Centralized Authorization Policy (#62)
      // Check ownership or staff scope on the locked row BEFORE checking cache or version
      if (actor.role === 'STUDENT') {
        if (lockedPlan.student_id !== actor.studentId) {
          throw new ForbiddenError('Access denied.', 'FORBIDDEN');
        }
      } else if (actor.role === 'STAFF') {
        // Enforces full predicate of #53 via centralized AuthorizationService
        const inScope = await this.authorizationService.isInStaffScope({
          staffUserId: actor.userId,
          studentId: lockedPlan.student_id,
          planId: lockedPlan.id,
          isReviewAction: true
        });

        if (!inScope) {
          throw new ForbiddenError('Access denied.', 'FORBIDDEN');
        }
      }

      // 10. Idempotency Check (executed strictly AFTER authorization to prevent cache leakage)
      if (isCallerSuppliedHash) {
        const existingOp = await this.repository.findOperationByRequestHash(client, planId, finalRequestHash);
        if (existingOp) {
          if (existingOp.actor_id !== actor.userId || existingOp.action !== canonicalAction) {
            throw new ConflictError(
              'Request hash conflict: hash has already been used for another action or actor.',
              'CONFLICT'
            );
          }
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
      }

      // 11. Check Optimistic Concurrency
      if (Number(lockedPlan.version) !== parsedExpectedVersion) {
        throw new ConflictError(
          'Plan has been updated by another transaction. Please reload and retry.',
          'STALE_RECORD_CONFLICT',
          { expectedVersion: parsedExpectedVersion, currentVersion: Number(lockedPlan.version) }
        );
      }

      // 12. Check State Machine Validity (#54)
      if (!rule.allowedFrom.includes(lockedPlan.status)) {
        throw new InvalidStateTransitionError(
          `Cannot transition Plan from status ${lockedPlan.status} via action ${canonicalAction}. Allowed statuses: ${rule.allowedFrom.join(', ')}.`
        );
      }

      // 13. Check Preconditions
      rule.validatePreconditions(lockedPlan, { notes, comment });

      // 14. Prepare Notes
      const rawNotes = notes !== undefined ? notes : comment;
      let trimmedNotes = null;
      if (typeof rawNotes === 'string' && rawNotes.trim().length > 0) {
        trimmedNotes = rawNotes.trim();
      }

      let planNotesToUpdate = lockedPlan.notes;
      if (canonicalAction === ACTIONS.PLAN_RETURN_FOR_REVISION) {
        planNotesToUpdate = trimmedNotes;
      } else if (trimmedNotes !== null) {
        planNotesToUpdate = trimmedNotes;
      } else if (notes === null) {
        planNotesToUpdate = null;
      }

      // 15. Increment Version and Apply Update
      const nextVersion = Number(lockedPlan.version) + 1;
      const updatedPlan = await this.repository.updatePlanStatus(client, {
        planId: lockedPlan.id,
        status: rule.targetState,
        nextVersion,
        expectedVersion: lockedPlan.version,
        notes: planNotesToUpdate
      });

      if (!updatedPlan) {
        throw new ConflictError(
          'Plan concurrent modification detected during update.',
          'STALE_RECORD_CONFLICT'
        );
      }

      // 16. Construct Response Payload
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

      // 17. Record Operation
      const operationId = crypto.randomUUID();
      const operationHash = finalRequestHash || normalizeHash(null, `${lockedPlan.id}:${canonicalAction}:${nextVersion}:${operationId}`);

      const planOperation = await this.repository.insertPlanOperation(client, {
        operationId,
        planId: lockedPlan.id,
        actorId: actor.userId,
        action: canonicalAction,
        requestHash: operationHash,
        responseStatus: 200,
        responsePayload,
        resultVersion: nextVersion
      });

      // 18. Append Immutable Audit Event
      const eventId = crypto.randomUUID();
      const auditEvent = await this.repository.insertAuditEvent(client, {
        eventId,
        planId: lockedPlan.id,
        actorId: actor.userId,
        actorRole: actor.role,
        action: canonicalAction,
        resourceType: 'plan',
        resourceId: lockedPlan.id,
        fromState: lockedPlan.status,
        toState: rule.targetState,
        notes: trimmedNotes,
        correlationId: finalCorrelationId,
        operationId
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

  async submitPlan({ actor, planId, expectedVersion, notes, correlationId, requestHash, idempotencyKey }) {
    return this.executeTransition({
      actor,
      planId,
      action: ACTIONS.PLAN_SUBMIT,
      expectedVersion,
      notes,
      correlationId,
      requestHash,
      idempotencyKey
    });
  }

  async startReview({ actor, planId, expectedVersion, notes, correlationId, requestHash, idempotencyKey }) {
    return this.executeTransition({
      actor,
      planId,
      action: ACTIONS.PLAN_START_REVIEW,
      expectedVersion,
      notes,
      correlationId,
      requestHash,
      idempotencyKey
    });
  }

  async returnForRevision({ actor, planId, expectedVersion, notes, correlationId, requestHash, idempotencyKey }) {
    return this.executeTransition({
      actor,
      planId,
      action: ACTIONS.PLAN_RETURN_FOR_REVISION,
      expectedVersion,
      notes,
      correlationId,
      requestHash,
      idempotencyKey
    });
  }

  async approvePlan({ actor, planId, expectedVersion, notes, correlationId, requestHash, idempotencyKey }) {
    return this.executeTransition({
      actor,
      planId,
      action: ACTIONS.PLAN_APPROVE,
      expectedVersion,
      notes,
      correlationId,
      requestHash,
      idempotencyKey
    });
  }

  async cancelPlan({ actor, planId, expectedVersion, notes, correlationId, requestHash, idempotencyKey }) {
    return this.executeTransition({
      actor,
      planId,
      action: ACTIONS.PLAN_CANCEL,
      expectedVersion,
      notes,
      correlationId,
      requestHash,
      idempotencyKey
    });
  }

  // --- Read Helpers ---

  async getAuditHistory(planId) {
    if (!planId || typeof planId !== 'string' || !UUID_REGEX.test(planId)) {
      throw new ValidationError('Invalid planId: must be a valid UUID.', [
        { field: 'planId', issue: 'must be a valid UUID string' }
      ]);
    }
    return this.repository.listAuditEventsByPlanId(null, planId);
  }

  async getPlanOperations(planId) {
    if (!planId || typeof planId !== 'string' || !UUID_REGEX.test(planId)) {
      throw new ValidationError('Invalid planId: must be a valid UUID.', [
        { field: 'planId', issue: 'must be a valid UUID string' }
      ]);
    }
    return this.repository.listPlanOperationsByPlanId(null, planId);
  }
}

module.exports = {
  PLAN_STATES,
  TERMINAL_STATES,
  ACTIONS,
  TRANSITION_RULES,
  WorkflowService
};
