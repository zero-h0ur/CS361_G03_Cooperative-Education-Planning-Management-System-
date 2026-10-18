/**
 * Advisor assigned-scope, read-only routes for CO-ED V3 (#68).
 * No Advisor mutation route is registered in this module.
 */

const { ACTIONS } = require('../services/authorization-service');
const { AdvisorReadService } = require('../services/advisor-read-service');
const { assertAllowedQueryParameters } = require('../router');
const { ValidationError } = require('../errors');
const { sendSuccess } = require('../response');

const REQUEST_TIMESTAMP = Symbol('advisorRequestTimestamp');
const STUDENT_LIST_QUERY_PARAMS = new Set(['page', 'pageSize']);
const PLAN_LIST_QUERY_PARAMS = new Set(['page', 'pageSize', 'cycle_id', 'status']);
const DETAIL_QUERY_PARAMS = new Set([]);

function getRequestTimestamp(request, now = () => new Date()) {
  if (!request[REQUEST_TIMESTAMP]) {
    Object.defineProperty(request, REQUEST_TIMESTAMP, {
      value: now(),
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  return request[REQUEST_TIMESTAMP];
}

function queryObject(searchParams, allowed) {
  assertAllowedQueryParameters(searchParams, allowed);
  const query = {};
  for (const key of allowed) {
    const values = searchParams.getAll(key);
    if (values.length > 1) {
      throw new ValidationError('Duplicate query parameter.', [
        { field: key, issue: 'must be provided at most once' }
      ]);
    }
    if (values.length === 1) query[key] = values[0];
  }
  return query;
}

function registerAdvisorReadRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const now = options.now || authOptions.now || (() => new Date());
  const service =
    options.advisorReadService ||
    new AdvisorReadService({
      ...authOptions,
      now,
      advisorReadRepository: options.advisorReadRepository
    });

  const timestampFor = (request) => getRequestTimestamp(request, now);

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: '/api/v3/advisor/students',
    action: ACTIONS.STUDENT_SEARCH_LIST,
    resolveResource: (request) => ({
      listOnly: true,
      requestTimestamp: timestampFor(request)
    }),
    authOptions,
    handler: async (request, response, context) => {
      const input = queryObject(context.url.searchParams, STUDENT_LIST_QUERY_PARAMS);
      const result = await service.listStudents(
        context.authContext,
        input,
        timestampFor(request)
      );
      sendSuccess(response, result.items, 200, result.pagination);
    }
  });

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: /^\/api\/v3\/advisor\/students\/([^/]+)\/plans$/,
    action: ACTIONS.PLAN_LIST_READ,
    resolveResource: (request, context) => ({
      studentId: context.params[0],
      requestTimestamp: timestampFor(request)
    }),
    authOptions,
    handler: async (request, response, context) => {
      const input = queryObject(context.url.searchParams, PLAN_LIST_QUERY_PARAMS);
      const result = await service.listStudentPlans(
        context.authContext,
        context.params[0],
        input,
        timestampFor(request)
      );
      sendSuccess(response, result.items, 200, result.pagination);
    }
  });

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: /^\/api\/v3\/advisor\/students\/([^/]+)$/,
    action: ACTIONS.STUDENT_READ_PROFILE,
    resolveResource: (request, context) => ({
      studentId: context.params[0],
      requestTimestamp: timestampFor(request)
    }),
    authOptions,
    handler: async (request, response, context) => {
      queryObject(context.url.searchParams, DETAIL_QUERY_PARAMS);
      const student = await service.getStudent(
        context.authContext,
        context.params[0],
        timestampFor(request)
      );
      sendSuccess(response, student, 200);
    }
  });

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: /^\/api\/v3\/advisor\/plans\/([^/]+)$/,
    action: ACTIONS.PLAN_LIST_READ,
    resolveResource: (request, context) => ({
      planId: context.params[0],
      requestTimestamp: timestampFor(request)
    }),
    authOptions,
    handler: async (request, response, context) => {
      queryObject(context.url.searchParams, DETAIL_QUERY_PARAMS);
      const plan = await service.getPlan(
        context.authContext,
        context.params[0],
        timestampFor(request)
      );
      sendSuccess(response, plan, 200);
    }
  });
}

module.exports = {
  STUDENT_LIST_QUERY_PARAMS,
  PLAN_LIST_QUERY_PARAMS,
  getRequestTimestamp,
  registerAdvisorReadRoutes
};
