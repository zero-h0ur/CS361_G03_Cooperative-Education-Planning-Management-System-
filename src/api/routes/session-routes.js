/**
 * Authenticated /me and Session Context Routes for CO-ED V3.
 * Conforms to Issue #55, #61, #62, and #64.
 */

const { ACTIONS } = require('../services/authorization-service');
const { SessionService } = require('../services/session-service');
const { assertAllowedQueryParameters } = require('../router');
const { sendSuccess } = require('../response');

// Single canonical path under the protected /api/v3 prefix (#48, #59)
const SESSION_PATH = '/api/v3/me';
const ALLOWED_ME_QUERY_PARAMS = new Set([]);

/**
 * Registers the authenticated /me session context endpoint on the router.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 * @param {SessionService} [options.sessionService] Session service override (tests)
 */
function registerSessionRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const sessionService =
    options.sessionService || new SessionService(authOptions);

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: SESSION_PATH,
    action: ACTIONS.SESSION_READ_ME,
    authOptions,
    handler: async (request, response, context) => {
      assertAllowedQueryParameters(
        context.url.searchParams,
        ALLOWED_ME_QUERY_PARAMS
      );

      const sessionData = await sessionService.getSessionContext(context.authContext);
      sendSuccess(response, sessionData, 200);
    }
  });
}

module.exports = {
  SESSION_PATH,
  registerSessionRoutes
};
