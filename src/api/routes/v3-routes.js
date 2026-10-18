/**
 * V3 Protected Routes Scaffolding and Extension Points.
 * Serves as the registration boundary for downstream feature issues (#61-#70).
 */

const { createAuthMiddleware } = require('../../auth');

/**
 * Registers V3 protected routes.
 *
 * Protected routes must attach `authenticate` as a route-scoped middleware so that
 * public routes stay unauthenticated (#48):
 *
 *   router.get('/api/v3/me', authenticate, async (request, response) => {
 *     const identity = getRequestContext(request);
 *     sendSuccess(response, { userId: identity.userId, role: identity.role });
 *   });
 *
 * @param {import('../router').Router} router
 * @param {object} [options]
 * @param {Function} [options.authenticate] Authentication middleware override (tests)
 */
function registerV3Routes(router, { authenticate = createAuthMiddleware() } = {}) {
  // Downstream Issue #64: Authenticated /me and session context endpoint
  // Downstream Issue #65: Student self-profile API
  // Downstream Issue #66: Own Plan create/read/edit API
  // Downstream Issue #67: Staff Student/Plan search and review queue API
  // Downstream Issue #68: Advisor assigned-scope read-only API
  // Downstream Issue #69: Student Plan submission transaction
  // Downstream Issue #70: Staff review commands
  return { authenticate };
}

module.exports = {
  registerV3Routes
};
