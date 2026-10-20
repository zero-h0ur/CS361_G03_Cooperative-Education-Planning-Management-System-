/**
 * Student own Plan history route for CO-ED V3.
 * GET /api/v3/plans/:planId/history returns the audit-derived timeline of an owned Plan.
 * Conforms to Issue #49 (audit:read_own_plan_history), #50, #52, #54, and #76.
 */

const { ACTIONS } = require('../services/authorization-service');
const { PlanHistoryRepository } = require('../../db/repositories/plan-history-repository');
const { assertAllowedQueryParameters, decodePathParameter } = require('../router');
const { sendSuccess } = require('../response');

const PLAN_HISTORY_PATTERN = /^\/api\/v3\/plans\/([^/]+)\/history$/;
const NO_QUERY_PARAMS = new Set([]);

// Review comments are readable by the Student owner (#50: "Return reason/review comment:
// Owner and authorized review scope"). Notes of any other event are never exposed.
const REVIEW_COMMENT_ACTIONS = new Set(['PLAN_RETURNED', 'PLAN_APPROVED', 'PLAN_REJECTED']);

function toIsoOrNull(value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

/**
 * Response allowlist (#50): no actor_id, operation_id, correlation_id or resource ids.
 */
function toPlanHistoryEntry(row) {
  return Object.freeze({
    event_id: row.event_id,
    action: row.action,
    from_state: row.from_state ?? null,
    to_state: row.to_state ?? null,
    actor_role: row.actor_role,
    review_notes: REVIEW_COMMENT_ACTIONS.has(row.action) ? row.notes ?? null : null,
    created_at: toIsoOrNull(row.created_at)
  });
}

/**
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 * @param {PlanHistoryRepository} [options.planHistoryRepository] Repository override (tests)
 */
function registerPlanHistoryRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const repository =
    options.planHistoryRepository || new PlanHistoryRepository({ pool: authOptions.pool });

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: PLAN_HISTORY_PATTERN,
    // STUDENT/OWN only; the policy validates the UUID (400), existence (404) and ownership (403)
    action: ACTIONS.AUDIT_READ_OWN_PLAN_HISTORY,
    resolveResource: (_request, context) => ({ planId: decodePathParameter(context.params[0]) }),
    authOptions,
    handler: async (_request, response, context) => {
      assertAllowedQueryParameters(context.url.searchParams, NO_QUERY_PARAMS);
      const rows = await repository.listPlanHistory(context.authzDecision.planId);
      sendSuccess(response, rows.map(toPlanHistoryEntry), 200);
    }
  });
}

module.exports = {
  PLAN_HISTORY_PATTERN,
  REVIEW_COMMENT_ACTIONS,
  toPlanHistoryEntry,
  registerPlanHistoryRoutes
};
