/**
 * Authenticated /me and Session Context Routes for CO-ED V3.
 * Conforms to Issue #55, #61, #62, and #64.
 */

const { ACTIONS } = require('../services/authorization-service');
const { SessionService } = require('../services/session-service');
const { assertAllowedQueryParameters } = require('../router');
const { sendSuccess } = require('../response');

const SESSION_PATHS = Object.freeze(['/api/v3/me', '/api/me', '/me']);
const ALLOWED_ME_QUERY_PARAMS = new Set([]);

/**
 * Registers the authenticated /me session context endpoint on the router.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 */
function registerSessionRoutes(router, registerProtectedRoute, options = {}) {
  const sessionService =
    options.sessionService || new SessionService(options);

  const handleGetMe = async (request, response, context) => {
    assertAllowedQueryParameters(
      context.url.searchParams,
      ALLOWED_ME_QUERY_PARAMS
    );

    const sessionData = await sessionService.getSessionContext(
      context.authContext,
      options
    );
    sendSuccess(response, sessionData, 200);
  };

  for (const path of SESSION_PATHS) {
    registerProtectedRoute(router, {
      method: 'GET',
      pattern: path,
      action: ACTIONS.SESSION_READ_ME,
      authOptions: options,
      handler: handleGetMe
    });
  }
}

module.exports = {
  SESSION_PATHS,
  registerSessionRoutes
};
