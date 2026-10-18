/**
 * Staff Review Command Routes for CO-ED V3.
 * Provides POST /api/v3/plans/:planId/start-review, /return, and /approve
 * using Centralized Authorization (#62) and Transactional WorkflowService (#63).
 * Conforms to Issue #49, #50, #52, #53, #54, #55, #61, #62, #63, and #70.
 */

const { ACTIONS } = require('../services/authorization-service');
const { WorkflowService } = require('../services/workflow-service');
const {
  assertAllowedQueryParameters,
  decodePathParameter,
  parseJsonBody
} = require('../router');
const { ValidationError } = require('../errors');
const { sendSuccess } = require('../response');

const PLAN_START_REVIEW_PATTERN = /^\/api\/v3\/plans\/([^/]+)\/start-review$/;
// One path per command (#53 examples); each path needs its own API Gateway JWT Authorizer route
const PLAN_RETURN_PATTERN = /^\/api\/v3\/plans\/([^/]+)\/return$/;
const PLAN_APPROVE_PATTERN = /^\/api\/v3\/plans\/([^/]+)\/approve$/;

const ALLOWED_REVIEW_QUERY_PARAMS = new Set([]);

// Body keys that must not be supplied by the client to override route/context parameters
const FORBIDDEN_BODY_OVERRIDE_KEYS = new Set([
  'actor',
  'action',
  'plan_id',
  'planId',
  'student_id',
  'studentId',
  'status'
]);

function toIsoOrNull(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value !== undefined ? value : null;
}

/**
 * Formats the Staff review transition result using an explicit response allowlist (#50, #52, #70).
 * Excludes internal fields such as request_hash, source, visibility, and data_status.
 *
 * @param {object} result Result from WorkflowService
 * @returns {object}
 */
function toStaffReviewCommandResponse(result = {}) {
  const plan = result.plan || result.data || {};
  const operation = result.operation || null;
  const auditEvent = result.auditEvent || null;

  return Object.freeze({
    id: plan.id ?? null,
    student_id: plan.student_id ?? null,
    // V3 uses cycle_id as the contract name; legacy round_id is not exposed (#52 section 12)
    cycle_id: plan.cycle_id ?? null,
    company_id: plan.company_id ?? null,
    position_id: plan.position_id ?? null,
    notes: plan.notes ?? null,
    status: plan.status ?? result.toState ?? null,
    version: plan.version ?? result.version ?? operation?.result_version ?? null,
    created_at: toIsoOrNull(plan.created_at),
    updated_at: toIsoOrNull(plan.updated_at),
    operation_id: operation?.operation_id ?? auditEvent?.operation_id ?? null,
    idempotent_replay: Boolean(result.idempotentReplay),
    audit_reference: auditEvent
      ? Object.freeze({
          event_id: auditEvent.event_id,
          action: auditEvent.action,
          from_state: auditEvent.from_state,
          to_state: auditEvent.to_state,
          notes: auditEvent.notes ?? null,
          operation_id: auditEvent.operation_id,
          correlation_id: auditEvent.correlation_id,
          created_at: toIsoOrNull(auditEvent.created_at)
        })
      : null
  });
}

function assertNoBodyOverrides(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return;
  }

  const overridden = Object.keys(body).filter((key) =>
    FORBIDDEN_BODY_OVERRIDE_KEYS.has(key)
  );
  if (overridden.length > 0) {
    throw new ValidationError(
      `Unknown or unallowed field(s): ${overridden.join(', ')}`,
      overridden.map((field) => ({
        field,
        issue: 'field cannot be supplied in workflow command body'
      }))
    );
  }
}

// The central policy (#62) rejects malformed plan ids with 400 and checks Staff role,
// scope and OPEN round; this resolver only identifies the target Plan.
function resolveReviewPlanResource(_request, context) {
  return {
    planId: decodePathParameter(context.params[0]),
    isReviewAction: true
  };
}

/**
 * Registers Staff review command endpoints on the V3 router.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 * @param {object} [options.workflowRepository] Workflow repository override (tests)
 * @param {WorkflowService} [options.workflowService] Workflow service override (tests)
 */
function registerStaffReviewRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const workflowService =
    options.workflowService ||
    new WorkflowService({
      ...authOptions,
      repository: options.workflowRepository
    });

  function createReviewCommandHandler(executeCommand) {
    // Role (STAFF only, Advisor read-only) is enforced by the central policy action;
    // no ad-hoc role checks in route handlers (#62 coordination note).
    return async function handleStaffReviewCommand(request, response, context) {
      assertAllowedQueryParameters(
        context.url.searchParams,
        ALLOWED_REVIEW_QUERY_PARAMS
      );

      const planId = decodePathParameter(context.params[0]);
      const body = await parseJsonBody(request);
      assertNoBodyOverrides(body);

      const result = await executeCommand({
        ...body,
        actor: context.authContext,
        plan_id: planId
      });

      sendSuccess(response, toStaffReviewCommandResponse(result), 200);
    };
  }

  registerProtectedRoute(router, {
    method: 'POST',
    pattern: PLAN_START_REVIEW_PATTERN,
    action: ACTIONS.PLAN_START_REVIEW,
    resolveResource: resolveReviewPlanResource,
    authOptions,
    handler: createReviewCommandHandler((params) =>
      workflowService.startReview(params)
    )
  });

  registerProtectedRoute(router, {
    method: 'POST',
    pattern: PLAN_RETURN_PATTERN,
    action: ACTIONS.PLAN_RETURN_FOR_REVISION,
    resolveResource: resolveReviewPlanResource,
    authOptions,
    handler: createReviewCommandHandler((params) =>
      workflowService.returnForRevision(params)
    )
  });

  registerProtectedRoute(router, {
    method: 'POST',
    pattern: PLAN_APPROVE_PATTERN,
    action: ACTIONS.PLAN_APPROVE,
    resolveResource: resolveReviewPlanResource,
    authOptions,
    handler: createReviewCommandHandler((params) =>
      workflowService.approvePlan(params)
    )
  });
}

module.exports = {
  PLAN_START_REVIEW_PATTERN,
  PLAN_RETURN_PATTERN,
  PLAN_APPROVE_PATTERN,
  toStaffReviewCommandResponse,
  registerStaffReviewRoutes
};
