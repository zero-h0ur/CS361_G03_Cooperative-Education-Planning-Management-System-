const http = require('node:http');

const defaultDal = require('../db/dal');
const {
  Router,
  decodePathParameter,
  assertAllowedQueryParameters,
  parseJsonBody
} = require('./router');
const {
  mapError,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  InvalidStateTransitionError,
  ServiceUnavailableError
} = require('./errors');
const {
  sendJson,
  sendSuccess,
  sendError,
  formatSuccess,
  formatError
} = require('./response');
const {
  registerPublicCompanyRoutes,
  toPublicCompany,
  toPublicPosition,
  COMPANY_PUBLIC_FIELDS,
  POSITION_PUBLIC_FIELDS
} = require('./routes/public-company-routes');
const { registerV3Routes, registerProtectedRoute } = require('./routes/v3-routes');
const {
  extractBearerToken,
  attachRequestContext,
  getRequestContext
} = require('./context');

function createAppRouter(options = {}) {
  const router = new Router();

  // Register public company & health routes
  registerPublicCompanyRoutes(router);

  // Register V3 protected extension routes
  registerV3Routes(router, options);

  return router;
}

function createRequestHandler(dal = defaultDal, options = {}) {
  const router = createAppRouter(options);

  return async function requestHandler(request, response) {
    await router.handle(request, response, dal);
  };
}

function createApiServer({ dal = defaultDal, ...options } = {}) {
  return http.createServer(createRequestHandler(dal, options));
}

module.exports = {
  createApiServer,
  createRequestHandler,
  createAppRouter,
  registerV3Routes,
  registerProtectedRoute,
  toPublicCompany,
  toPublicPosition,
  mapError,
  sendJson,
  sendSuccess,
  sendError,
  formatSuccess,
  formatError,
  decodePathParameter,
  assertAllowedQueryParameters,
  parseJsonBody,
  // Export errors & context for downstream consumers
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  InvalidStateTransitionError,
  ServiceUnavailableError,
  extractBearerToken,
  attachRequestContext,
  getRequestContext,
  COMPANY_PUBLIC_FIELDS,
  POSITION_PUBLIC_FIELDS
};
