/**
 * V3 Protected Routes Scaffolding and Policy Entry Boundary.
 * Serves as the registration boundary for downstream feature issues (#61-#70).
 * Conforms to Issue #55, #61, and #62.
 */

const { createAuthMiddleware } = require('../../auth/auth-middleware');
const {
  ACTIONS,
  createAuthorizationMiddleware
} = require('../../auth/authorization');
const { getRequestContext } = require('../context');
const { registerSessionRoutes } = require('./session-routes');
const { registerStudentProfileRoutes } = require('./student-profile-routes');
const { registerPlanSubmissionRoutes } = require('./plan-submission-routes');
const { registerStaffReviewRoutes } = require('./staff-review-routes');

const VALID_ACTIONS = new Set(Object.values(ACTIONS));

/**
 * Registers a protected V3 route that enforces, as route-scoped middlewares:
 * 1. Token validation & trusted identity resolution (#61)
 * 2. Centralized role, ownership, assignment, and scope authorization (#62)
 * 3. Route handler execution
 *
 * This is the only supported way to register a V3 protected route. Do not attach
 * the authentication middleware directly, as that would skip authorization (#62).
 *
 * @param {import('../router').Router} router
 * @param {object} config
 * @param {string} config.method HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string|RegExp} config.pattern Route path or pattern
 * @param {string} config.action Canonical action from ACTIONS
 * @param {Function} config.handler Route handler (request, response, context)
 * @param {Function} [config.resolveResource] Optional (request, context) => resource identifiers
 *   such as { studentId, planId }. Ownership and plan state are always re-read from the database.
 * @param {object} [config.authOptions] Optional overrides for auth/authz dependencies
 */
function registerProtectedRoute(router, config = {}) {
  const {
    method,
    pattern,
    action,
    handler,
    resolveResource,
    authOptions = {}
  } = config;

  if (!action || !VALID_ACTIONS.has(action)) {
    throw new TypeError('Protected route must declare a valid canonical authorization action.');
  }

  if (typeof handler !== 'function') {
    throw new TypeError('Protected route handler must be a function.');
  }

  const authenticate =
    authOptions.authMiddleware || createAuthMiddleware(authOptions);
  const authorize = createAuthorizationMiddleware(action, {
    ...authOptions,
    resolveResource
  });

  // Skip re-authentication only when a trusted context was already attached server-side
  async function ensureAuthenticated(request, response, context) {
    if (getRequestContext(request).isAuthenticated) {
      return;
    }
    await authenticate(request, response, context);
  }

  return router.register(
    method,
    pattern,
    ensureAuthenticated,
    authorize,
    async (request, response, context) => {
      await handler(request, response, {
        ...context,
        authContext: getRequestContext(request),
        authzDecision: request.authzDecision
      });
    }
  );
}

/**
 * Registers V3 protected routes on the application router.
 * Every route here must be registered through registerProtectedRoute():
 *
 *   registerProtectedRoute(router, {
 *     method: 'GET',
 *     pattern: /^\/api\/v3\/plans\/([^/]+)$/,
 *     action: ACTIONS.PLAN_LIST_READ,
 *     resolveResource: (request, { params }) => ({ planId: params[0] }),
 *     authOptions: options.authOptions,
 *     handler: async (request, response, { authzDecision }) => { ... }
 *   });
 *
 * @param {import('../router').Router} router
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 */
function registerV3Routes(router, options = {}) {
  // Issue #64: Authenticated /me and session context endpoint
  registerSessionRoutes(router, registerProtectedRoute, options);

  // Issue #65: Student self-profile read/update API
  registerStudentProfileRoutes(router, registerProtectedRoute, options);

  // Downstream Issue #66: Own Plan create/read/edit API
  // Downstream Issue #67: Staff Student/Plan search and review queue API
  // Downstream Issue #68: Advisor assigned-scope read-only API

  // Issue #69: Student Plan submission transaction
  registerPlanSubmissionRoutes(router, registerProtectedRoute, options);

  // Issue #70: Staff review commands
  registerStaffReviewRoutes(router, registerProtectedRoute, options);

  return options;
}

module.exports = {
  registerV3Routes,
  registerProtectedRoute
};
