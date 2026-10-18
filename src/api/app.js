const http = require('node:http');

const defaultDal = require('../db/dal');
const {
  Router,
  decodePathParameter,
  assertAllowedQueryParameters
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
const { registerV3Routes } = require('./routes/v3-routes');
const {
  extractBearerToken,
  attachRequestContext,
  getRequestContext
} = require('./context');

function createAppRouter() {
  const router = new Router();

  // Register public company & health routes
  registerPublicCompanyRoutes(router);

  // Register V3 protected extension routes
  registerV3Routes(router);

  return router;
}

function createRequestHandler(dal = defaultDal) {
  const router = createAppRouter();

  return async function requestHandler(request, response) {
    await router.handle(request, response, dal);
  };
}

function createApiServer({ dal = defaultDal } = {}) {
  return http.createServer(createRequestHandler(dal));
}

module.exports = {
  createApiServer,
  createRequestHandler,
  createAppRouter,
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
