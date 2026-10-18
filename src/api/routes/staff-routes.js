/**
 * Staff read-only Student/Plan search and review queue routes for CO-ED V3.
 * Workflow commands (start-review, return, approve) live in #70 under /api/v3/plans/:id/*.
 * Conforms to Issue #49, #53, #55, #62, and #67.
 */

const { ACTIONS } = require('../services/authorization-service');
const { StaffReviewService } = require('../services/staff-review-service');
const { sendSuccess } = require('../response');

const STAFF_STUDENTS_PATH = '/api/v3/staff/students';
const STAFF_PLANS_PATH = '/api/v3/staff/plans';
const STAFF_REVIEW_QUEUE_PATH = '/api/v3/staff/review-queue';

// listOnly asks the central policy to require at least one ACTIVE Staff scope (#62).
// The scope itself is enforced in SQL; client query parameters cannot widen it (#53 section 3.4).
function resolveListResource() {
  return { listOnly: true };
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
}

module.exports = {
  STAFF_STUDENTS_PATH,
  STAFF_PLANS_PATH,
  STAFF_REVIEW_QUEUE_PATH,
  registerStaffRoutes
};
