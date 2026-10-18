/**
 * Public exports for CO-ED V3 Auth module.
 * Conforms to Issue #61 (Token validation and trusted request context).
 */

const { TokenValidator, parseJwt, DEFAULT_REQUIRED_SCOPE } = require('./token-validator');
const { IdentityResolver } = require('./identity-resolver');
const { createAuthMiddleware } = require('./auth-middleware');

module.exports = {
  TokenValidator,
  IdentityResolver,
  createAuthMiddleware,
  parseJwt,
  DEFAULT_REQUIRED_SCOPE
};
