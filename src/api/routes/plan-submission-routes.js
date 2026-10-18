/**
 * Student Plan Submission Routes for CO-ED V3.
 * Provides POST /api/v3/plans/:planId/submit using the central transactional WorkflowService (#63).
 * Conforms to Issue #49, #50, #52, #54, #55, #61, #62, #63, and #69.
 */

const { ACTIONS } = require('../services/authorization-service');
const { WorkflowService } = require('../services/workflow-service');
const {
  assertAllowedQueryParameters,
  decodePathParameter,
  parseJsonBody
} = require('../router');
const { getRequestContext } = require('../context');
const { ValidationError, ForbiddenError } = require('../errors');
const { sendSuccess } = require('../response');

const PLAN_SUBMIT_PATTERN = /^\/api\/v3\/plans\/([^/]+)\/submit$/;
const ALLOWED_SUBMIT_QUERY_PARAMS = new Set([]);

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
 * Formats the workflow transition result using an explicit response allowlist (#50, #52, #69).
 * Excludes internal fields such as request_hash, source, visibility, and data_status.
 *
 * @param {object} result Result from WorkflowService
 * @returns {object}
 */
function toPlanWorkflowResponse(result = {}) {
  const plan = result.plan || result.data || {};
  const operation = result.operation || null;
  const auditEvent = result.auditEvent || null;

  return Object.freeze({
    id: plan.id ?? null,
    student_id: plan.student_id ?? null,
    cycle_id: plan.cycle_id ?? null,
    round_id: plan.round_id ?? null,
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

function resolveOwnStudent(request) {
  return { studentId: getRequestContext(request).studentId || null };
}

/**
 * Registers the Student Plan submission route on the V3 router.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 * @param {object} [options.workflowRepository] Workflow repository override (tests)
 * @param {WorkflowService} [options.workflowService] Workflow service override (tests)
 */
function registerPlanSubmissionRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const workflowService =
    options.workflowService ||
    new WorkflowService({
      ...authOptions,
      repository: options.workflowRepository
    });

  registerProtectedRoute(router, {
    method: 'POST',
    pattern: PLAN_SUBMIT_PATTERN,
    action: ACTIONS.PLAN_SUBMIT,
    resolveResource: resolveOwnStudent,
    authOptions,
    handler: async (request, response, context) => {
      if (context.authContext?.role !== 'STUDENT') {
        throw new ForbiddenError('Access denied.', 'FORBIDDEN');
      }

      assertAllowedQueryParameters(
        context.url.searchParams,
        ALLOWED_SUBMIT_QUERY_PARAMS
      );

      const planId = decodePathParameter(context.params[0]);
      const body = await parseJsonBody(request);
      assertNoBodyOverrides(body);

      const result = await workflowService.submitPlan({
        ...body,
        actor: context.authContext,
        plan_id: planId
      });

      sendSuccess(response, toPlanWorkflowResponse(result), 200);
    }
  });
}

module.exports = {
  PLAN_SUBMIT_PATTERN,
  toPlanWorkflowResponse,
  registerPlanSubmissionRoutes
};
