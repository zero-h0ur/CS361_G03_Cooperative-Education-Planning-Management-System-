/**
 * Public exports for CO-ED V3 Auth module.
 * Conforms to Issue #61 (Token validation and trusted request context)
 * and Issue #62 (Centralized role, ownership and scope authorization).
 */

const { TokenValidator, parseJwt, DEFAULT_REQUIRED_SCOPE } = require('./token-validator');
const { IdentityResolver } = require('./identity-resolver');
const { createAuthMiddleware } = require('./auth-middleware');
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
  AuthorizationRepository,
  AuthorizationService,
  createAuthorizationMiddleware
} = require('./authorization');

module.exports = {
  TokenValidator,
  IdentityResolver,
  createAuthMiddleware,
  parseJwt,
  DEFAULT_REQUIRED_SCOPE,
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
