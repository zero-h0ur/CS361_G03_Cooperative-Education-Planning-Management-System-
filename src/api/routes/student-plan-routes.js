/**
 * Student Own Plan routes for Issue #66.
 * All routes use the protected V3 registration boundary; ownership is resolved
 * from the trusted request context and never accepted from the client body.
 */

const { ACTIONS } = require('../services/authorization-service');
const { StudentPlanService } = require('../services/student-plan-service');
const { assertAllowedQueryParameters, parseJsonBody } = require('../router');
const { getRequestContext } = require('../context');
const { sendSuccess } = require('../response');

const OWN_PLANS_PATH = '/api/v3/plans';
const OWN_PLAN_DETAIL_PATTERN = /^\/api\/v3\/plans\/([^/]+)$/;
const ALLOWED_LIST_QUERY_PARAMS = new Set(['page', 'pageSize', 'cycle_id', 'status']);
const NO_QUERY_PARAMS = new Set([]);

function resolveOwnStudent(request) {
  return {
    studentId: getRequestContext(request).studentId || null,
    listOnly: true
  };
}

function resolveOwnPlan(_request, context) {
  return { planId: context.params[0] };
}

function registerStudentPlanRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const service = options.studentPlanService || new StudentPlanService({
    ...authOptions,
    repository: options.studentPlanRepository
  });

  registerProtectedRoute(router, {
    method: 'POST',
    pattern: OWN_PLANS_PATH,
    action: ACTIONS.PLAN_CREATE,
    resolveResource: resolveOwnStudent,
    authOptions,
    handler: async (request, response, context) => {
      assertAllowedQueryParameters(context.url.searchParams, NO_QUERY_PARAMS);
      const body = await parseJsonBody(request);
      const result = await service.createOwnPlan(context.authContext, body);
      sendSuccess(response, result.plan, 201);
    }
  });

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: OWN_PLANS_PATH,
    action: ACTIONS.PLAN_LIST_READ,
    resolveResource: resolveOwnStudent,
    authOptions,
    handler: async (_request, response, context) => {
      assertAllowedQueryParameters(context.url.searchParams, ALLOWED_LIST_QUERY_PARAMS);
      const result = await service.listOwnPlans(context.authContext, {
        page: context.url.searchParams.get('page') ?? undefined,
        pageSize: context.url.searchParams.get('pageSize') ?? undefined,
        cycle_id: context.url.searchParams.get('cycle_id') ?? undefined,
        status: context.url.searchParams.get('status') ?? undefined
      });
      sendSuccess(response, result.items, 200, result.pagination);
    }
  });

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: OWN_PLAN_DETAIL_PATTERN,
    action: ACTIONS.PLAN_LIST_READ,
    resolveResource: resolveOwnPlan,
    authOptions,
    handler: async (_request, response, context) => {
      assertAllowedQueryParameters(context.url.searchParams, NO_QUERY_PARAMS);
      const plan = await service.getOwnPlan(context.authContext, context.params[0]);
      sendSuccess(response, plan, 200);
    }
  });

  registerProtectedRoute(router, {
    method: 'PATCH',
    pattern: OWN_PLAN_DETAIL_PATTERN,
    action: ACTIONS.PLAN_UPDATE_CONTENT,
    resolveResource: resolveOwnPlan,
    authOptions,
    handler: async (request, response, context) => {
      assertAllowedQueryParameters(context.url.searchParams, NO_QUERY_PARAMS);
      const body = await parseJsonBody(request);
      const result = await service.updateOwnPlan(
        context.authContext,
        context.params[0],
        body
      );
      sendSuccess(response, result.plan, 200);
    }
  });
}

module.exports = {
  OWN_PLANS_PATH,
  OWN_PLAN_DETAIL_PATTERN,
  ALLOWED_LIST_QUERY_PARAMS,
  registerStudentPlanRoutes
};
