/**
 * Authentication Middleware for CO-ED V3.
 * Enforces token validation, identity resolution, and immutable trusted context creation.
 * Conforms to Issue #48, #49, #50, #51, #55, and #61.
 */

const { extractBearerToken, attachRequestContext } = require('../api/context');
const { UnauthorizedError, ForbiddenError } = require('../api/errors');
const { sendError } = require('../api/response');
const { TokenValidator } = require('./token-validator');
const { IdentityResolver } = require('./identity-resolver');

function hasAuthorizationHeader(request) {
  const header = request?.headers?.authorization ?? request?.headers?.Authorization;
  return typeof header === 'string' && header.trim().length > 0;
}

function freezeAttachedContext(request) {
  if (!request || typeof request !== 'object') return;
  for (const sym of Object.getOwnPropertySymbols(request)) {
    if (request[sym] && typeof request[sym] === 'object') {
      Object.freeze(request[sym]);
    }
  }
}

/**
 * Creates an authentication middleware function for route pipelines.
 *
 * @param {object} [options]
 * @param {TokenValidator} [options.tokenValidator]
 * @param {IdentityResolver} [options.identityResolver]
 * @param {boolean} [options.required=true]
 * @param {boolean} [options.allowBearerFallback=false] Verify raw Bearer tokens in-process when
 *   no API Gateway authorizer claims exist. Off by default: per #48, Lambda trusts identity only
 *   from requestContext.authorizer.jwt.claims. Enable only for local development or tests.
 */
function createAuthMiddleware(options = {}) {
  const tokenValidator = options.tokenValidator || new TokenValidator();
  const identityResolver = options.identityResolver || new IdentityResolver();
  const required = options.required ?? true;
  const allowBearerFallback = options.allowBearerFallback ?? false;

  return async function authMiddleware(request, response, context = {}) {
    try {
      // 1. Check API Gateway HTTP API JWT Authorizer claims first (#48 trust boundary)
      const authorizerJwt = request?.requestContext?.authorizer?.jwt;
      const authorizerClaims =
        authorizerJwt?.claims && typeof authorizerJwt.claims === 'object'
          ? authorizerJwt.claims
          : null;
      const authorizerScopes = Array.isArray(authorizerJwt?.scopes)
        ? authorizerJwt.scopes
        : null;

      // 2. Otherwise extract Bearer token from Authorization header (only when fallback is enabled)
      const rawToken = allowBearerFallback ? extractBearerToken(request) : null;
      const hasAuthHeader = hasAuthorizationHeader(request);

      if (!authorizerClaims && !rawToken) {
        if (hasAuthHeader) {
          throw new UnauthorizedError('Malformed authorization header.');
        }
        if (!required) {
          attachRequestContext(request, {
            isAuthenticated: false,
            userId: null,
            user: null,
            role: null,
            accountStatus: null,
            studentId: null,
            scopes: Object.freeze([])
          });
          freezeAttachedContext(request);
          return;
        }
        throw new UnauthorizedError('Authentication required.');
      }

      // 3. Validate token claims (and signature when raw Bearer token is used)
      const validatedClaims = authorizerClaims
        ? tokenValidator.validateClaims(authorizerClaims, undefined, authorizerScopes)
        : await tokenValidator.validateToken(rawToken);

      // 4. Resolve internal User, Role, and Student context from RDS
      const identity = await identityResolver.resolveIdentity(
        validatedClaims.issuer,
        validatedClaims.subject
      );

      // 5. Attach immutable trusted identity context (omits sensitive iss/sub per #50/#51)
      const trustedUser = Object.freeze({
        id: identity.userId,
        studentId: identity.studentId
      });

      attachRequestContext(request, {
        isAuthenticated: true,
        userId: identity.userId,
        user: trustedUser,
        role: identity.role,
        accountStatus: identity.accountStatus,
        studentId: identity.studentId,
        department: identity.department,
        program: identity.program,
        major: identity.major,
        academicYear: identity.academicYear,
        enrollmentStatus: identity.enrollmentStatus,
        scopes: Object.freeze([...(validatedClaims.scopes || [])])
      });
      freezeAttachedContext(request);
    } catch (err) {
      // Return uniform sanitized 401/403 responses without leaking token claims or account existence
      if (err instanceof UnauthorizedError) {
        sendError(
          response,
          new UnauthorizedError('Authentication required.', 'UNAUTHORIZED')
        );
        return;
      }

      if (err instanceof ForbiddenError) {
        sendError(
          response,
          new ForbiddenError('Access denied.', 'FORBIDDEN')
        );
        return;
      }

      sendError(response, err, null, null, {}, null, context.dal);
    }
  };
}

module.exports = {
  createAuthMiddleware
};
