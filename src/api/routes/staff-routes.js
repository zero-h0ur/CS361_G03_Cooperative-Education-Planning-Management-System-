/**
 * Staff read-only Student/Plan search and review queue routes for CO-ED V3.
 * Workflow commands (start-review, return, approve) live in #70 under /api/v3/plans/:id/*.
 * Plan detail and history for the review workspace were added in #77.
 * Conforms to Issue #49, #50, #53, #55, #62, #67, and #77.
 */

const { ACTIONS, ROLES } = require('../services/authorization-service');
const { StaffReviewService } = require('../services/staff-review-service');
const { PlanHistoryRepository } = require('../../db/repositories/plan-history-repository');
const { toPlanHistoryEntry } = require('./plan-history-routes');
const { getRequestContext } = require('../context');
const { assertAllowedQueryParameters, decodePathParameter } = require('../router');
const { ForbiddenError } = require('../errors');
const { sendSuccess } = require('../response');

const STAFF_STUDENTS_PATH = '/api/v3/staff/students';
const STAFF_PLANS_PATH = '/api/v3/staff/plans';
const STAFF_REVIEW_QUEUE_PATH = '/api/v3/staff/review-queue';
const STAFF_PLAN_DETAIL_PATTERN = /^\/api\/v3\/staff\/plans\/([^/]+)$/;
const STAFF_PLAN_HISTORY_PATTERN = /^\/api\/v3\/staff\/plans\/([^/]+)\/history$/;
const NO_QUERY_PARAMS = new Set([]);

// listOnly asks the central policy to require at least one ACTIVE Staff scope (#62).
// The scope itself is enforced in SQL; client query parameters cannot widen it (#53 section 3.4).
function resolveListResource() {
  return { listOnly: true };
}

// plan:list_read and audit:read_plan_history also grant ADVISOR (ASSIGNED). /api/v3/staff/*
// belongs to Staff only, so other roles are refused before the policy reads any record.
function resolveStaffPlanResource(request, context) {
  if (getRequestContext(request).role !== ROLES.STAFF) {
    throw new ForbiddenError('Access denied.', 'FORBIDDEN');
  }
  return { planId: decodePathParameter(context.params[0]) };
}

/**
 * Registers Staff search and review-queue routes.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 * @param {object} [options.staffReviewRepository] Repository override (tests)
 * @param {StaffReviewService} [options.staffReviewService] Service override (tests)
 * @param {PlanHistoryRepository} [options.planHistoryRepository] Repository override (tests)
 */
function registerStaffRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const staffReviewService =
    options.staffReviewService ||
    new StaffReviewService({
      pool: authOptions.pool,
      staffReviewRepository: options.staffReviewRepository
    });

  const routes = [
    { pattern: STAFF_STUDENTS_PATH, action: ACTIONS.STAFF_STUDENT_SEARCH, method: 'searchStudents' },
    { pattern: STAFF_PLANS_PATH, action: ACTIONS.STAFF_PLAN_SEARCH, method: 'searchPlans' },
    { pattern: STAFF_REVIEW_QUEUE_PATH, action: ACTIONS.STAFF_REVIEW_QUEUE_READ, method: 'getReviewQueue' }
  ];

  for (const route of routes) {
    registerProtectedRoute(router, {
      method: 'GET',
      pattern: route.pattern,
      action: route.action,
      resolveResource: resolveListResource,
      authOptions,
      handler: async (request, response, { url, authzDecision }) => {
        const result = await staffReviewService[route.method](authzDecision.userId, url.searchParams);
        sendSuccess(response, result.items, 200, result.pagination);
      }
    });
  }

  const planHistoryRepository =
    options.planHistoryRepository || new PlanHistoryRepository({ pool: authOptions.pool });

  // Issue #77: one scoped Plan for the review workspace
  registerProtectedRoute(router, {
    method: 'GET',
    pattern: STAFF_PLAN_DETAIL_PATTERN,
    action: ACTIONS.PLAN_LIST_READ,
    resolveResource: resolveStaffPlanResource,
    authOptions,
    handler: async (_request, response, { url, authzDecision }) => {
      assertAllowedQueryParameters(url.searchParams, NO_QUERY_PARAMS);
      const plan = await staffReviewService.getPlanDetail(authzDecision.userId, authzDecision.planId);
      sendSuccess(response, plan, 200);
    }
  });

  // Issue #77: audit-derived history of one scoped Plan, same allowlist as #76
  registerProtectedRoute(router, {
    method: 'GET',
    pattern: STAFF_PLAN_HISTORY_PATTERN,
    action: ACTIONS.AUDIT_READ_PLAN_HISTORY,
    resolveResource: resolveStaffPlanResource,
    authOptions,
    handler: async (_request, response, { url, authzDecision }) => {
      assertAllowedQueryParameters(url.searchParams, NO_QUERY_PARAMS);
      const rows = await planHistoryRepository.listPlanHistory(authzDecision.planId);
      sendSuccess(response, rows.map(toPlanHistoryEntry), 200);
    }
  });
}

module.exports = {
  STAFF_STUDENTS_PATH,
  STAFF_PLANS_PATH,
  STAFF_REVIEW_QUEUE_PATH,
  STAFF_PLAN_DETAIL_PATTERN,
  STAFF_PLAN_HISTORY_PATTERN,
  registerStaffRoutes
};
