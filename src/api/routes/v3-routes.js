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
const { ForbiddenError } = require('../errors');

const VALID_ACTIONS = new Set(Object.values(ACTIONS));

/**
 * Registers a protected V3 route that enforces:
 * 1. Token validation & trusted identity resolution (#61)
 * 2. Centralized role, ownership, assignment, and scope authorization (#62)
 * 3. Route handler execution
 *
 * @param {import('../router').Router} router
 * @param {object} config
 * @param {string} config.method HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string|RegExp} config.pattern Route path or pattern
 * @param {string} config.action Canonical action from ACTIONS
 * @param {Function} config.handler Route handler (request, response, context)
 * @param {Function} [config.resolveResource] Optional (request, context) => resourceContext
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
    throw new ForbiddenError(
      'Protected route must declare a valid canonical authorization action.',
      'INVALID_POLICY_ACTION'
    );
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

  return router.register(method, pattern, async (request, response, context) => {
    // If authentication was not already run by router-level middleware, run it now
    let authContext = request.authContext || getRequestContext(request);
    if (!authContext || !authContext.isAuthenticated) {
      await authenticate(request, response, context);
      if (response.writableEnded) {
        return;
      }
      authContext = request.authContext || getRequestContext(request);
    }

    // Enforce centralized authorization policy (#62)
    const decision = await authorize(request, response, context);
    if (!decision || response.writableEnded) {
      return;
    }

    await handler(request, response, {
      ...context,
      authContext,
      authzDecision: decision
    });
  });
}

/**
 * Registers V3 protected routes on the application router.
 *
 * @param {import('../router').Router} router
 * @param {object} [options]
 */
function registerV3Routes(router, options = {}) {
  // Downstream Issue #64: Authenticated /me and session context endpoint
  // Downstream Issue #65: Student self-profile API
  // Downstream Issue #66: Own Plan create/read/edit API
  // Downstream Issue #67: Staff Student/Plan search and review queue API
  // Downstream Issue #68: Advisor assigned-scope read-only API
  // Downstream Issue #69: Student Plan submission transaction
  // Downstream Issue #70: Staff review commands
  return options;
}

module.exports = {
  registerV3Routes,
  registerProtectedRoute
};
