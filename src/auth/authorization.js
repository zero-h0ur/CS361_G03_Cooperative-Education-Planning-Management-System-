/**
 * HTTP Authorization Middleware and Policy Re-exports for CO-ED V3.
 * Delegates policy decisions to src/api/services/authorization-service.js.
 * Conforms to Issue #49, #53, #55, and #62.
 */

const { getRequestContext } = require('../api/context');
const { UnauthorizedError, ForbiddenError } = require('../api/errors');
const { sendError } = require('../api/response');
const {
  ROLES,
  PERMISSION_SCOPES,
  ACTIONS,
  REVIEW_MUTATION_ACTIONS,
  MUTATION_ACTIONS,
  STUDENT_EDITABLE_PLAN_STATES,
  PERMISSION_MATRIX,
  getPermissionScope,
  getRoleCapabilities,
  AuthorizationService
} = require('../api/services/authorization-service');
const {
  AuthorizationRepository
} = require('../db/repositories/authorization-repository');

/**
 * Creates a route/controller authorization guard middleware.
 *
 * @param {string} action Canonical action from ACTIONS
 * @param {object} [options]
 * @param {AuthorizationService} [options.authorizationService]
 * @param {Function} [options.resolveResource] Optional (request, context) => resourceContext
 */
function createAuthorizationMiddleware(action, options = {}) {
  const authorizationService =
    options.authorizationService || new AuthorizationService(options);
  const resolveResource = options.resolveResource || (() => ({}));

  return async function authorizationMiddleware(request, response, context = {}) {
    try {
      const authContext = request?.authContext || getRequestContext(request);
      const resource = (await resolveResource(request, context)) || {};
      const decision = await authorizationService.authorize(authContext, action, resource);

      Object.defineProperty(request, 'authzDecision', {
        value: decision,
        writable: false,
        configurable: true,
        enumerable: true
      });
      return decision;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        sendError(
          response,
          new UnauthorizedError('Authentication required.', 'UNAUTHORIZED')
        );
        return null;
      }
      if (err instanceof ForbiddenError) {
        sendError(
          response,
          new ForbiddenError('Access denied.', 'FORBIDDEN')
        );
        return null;
      }
      sendError(response, err, null, null, {}, null, context.dal);
      return null;
    }
  };
}

module.exports = {
  ROLES,
  PERMISSION_SCOPES,
  ACTIONS,
  REVIEW_MUTATION_ACTIONS,
  MUTATION_ACTIONS,
  STUDENT_EDITABLE_PLAN_STATES,
  PERMISSION_MATRIX,
  getPermissionScope,
  getRoleCapabilities,
  AuthorizationRepository,
  AuthorizationService,
  createAuthorizationMiddleware
};
