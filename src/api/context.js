/**
 * Request context and authentication state helpers for CO-ED V3.
 * Provides extension points for token validation (#61) and authorization (#62).
 */

const REQUEST_CONTEXT_SYMBOL = Symbol('coed_request_context');

/**
 * Extracts the Bearer token from the Authorization header if present.
 *
 * @param {object} request Node.js HTTP IncomingMessage or Lambda request-like object
 * @returns {string|null}
 */
function extractBearerToken(request) {
  const authHeader = request.headers?.authorization || request.headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }

  return null;
}

/**
 * Attaches a trusted context object (user identity, role, scope) to the request.
 *
 * @param {object} request
 * @param {object} context
 */
function attachRequestContext(request, context = {}) {
  request[REQUEST_CONTEXT_SYMBOL] = {
    ...(request[REQUEST_CONTEXT_SYMBOL] || {}),
    ...context
  };
}

/**
 * Retrieves the trusted context object from the request.
 *
 * @param {object} request
 * @returns {object}
 */
function getRequestContext(request) {
  return request[REQUEST_CONTEXT_SYMBOL] || {
    isAuthenticated: false,
    user: null,
    role: null,
    scopes: []
  };
}

module.exports = {
  extractBearerToken,
  attachRequestContext,
  getRequestContext
};
