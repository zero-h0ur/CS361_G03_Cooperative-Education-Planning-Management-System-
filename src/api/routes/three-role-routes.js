const { ACTIONS } = require('../services/authorization-service');
const { ThreeRoleService } = require('../services/three-role-service');
const { WorkflowService } = require('../services/workflow-service');
const { toPlanWorkflowResponse } = require('./plan-submission-routes');
const { toStaffReviewCommandResponse } = require('./staff-review-routes');
const { parseJsonBody, assertAllowedQueryParameters } = require('../router');
const { sendSuccess } = require('../response');
const { fields } = require('../services/workflow-input');
function registerThreeRoleRoutes(router, protect, options = {}) {
  const service = options.threeRoleService || new ThreeRoleService({...options.authOptions,...options});
  const workflow = options.workflowService || new WorkflowService({...options.authOptions,repository: options.workflowRepository});
  const register = (method, pattern, action, resource, handle) => protect(router, {
    method, pattern, action, authOptions: options.authOptions || {}, resolveResource: resource,
    handler: async (req,res,ctx) => {
      assertAllowedQueryParameters(ctx.url.searchParams,new Set());
      const body = method === 'GET' ? null : await parseJsonBody(req);
      const result = await handle(ctx.authContext,ctx.params?.[0],body);
      res.setHeader('Cache-Control','no-store');
      sendSuccess(res,result,200);
    }
  });
  const plan = (_req,ctx) => ({planId:ctx.params[0]});
  const listing = () => ({listOnly:true});
  register('GET',/^\/api\/v3\/plans\/([^/]+)\/workflow$/,ACTIONS.PLAN_LIST_READ,plan,(a,id) => service.getWorkflow(a,id));
  register('PATCH',/^\/api\/v3\/plans\/([^/]+)\/workflow$/,ACTIONS.PLAN_UPDATE_CONTENT,plan,(a,id,b) => service.saveWorkflow(a,id,b));
  register('GET','/api/v3/staff/workflow',ACTIONS.ASSIGNMENT_READ_SCOPED,listing,a => service.dashboard(a));
  register('POST','/api/v3/staff/document-policies',ACTIONS.WORKFLOW_STAFF_WRITE,listing,(a,_id,b) => service.publish(a,b));
  register('POST','/api/v3/staff/assignments',ACTIONS.WORKFLOW_STAFF_WRITE,listing,(a,_id,b) => service.assign(a,b));
  for (const name of ['revoke','reassign']) register('POST',new RegExp(`^/api/v3/staff/assignments/([^/]+)/${name}$`),
    ACTIONS.WORKFLOW_STAFF_WRITE,listing,(a,id,b) => service.changeAssignment(a,id,b,name === 'reassign'));
  register('POST',/^\/api\/v3\/plans\/([^/]+)\/cancel$/,ACTIONS.PLAN_CANCEL,plan,
    async (a,id,b) => { fields(b,['expected_version','operation_id','correlation_id']); return toPlanWorkflowResponse(await workflow.cancelPlan({...b,actor:a,plan_id:id})); });
  register('POST',/^\/api\/v3\/plans\/([^/]+)\/reject$/,ACTIONS.PLAN_REJECT,(_req,ctx) => ({...plan(_req,ctx),isReviewAction:true}),
    async (a,id,b) => { fields(b,['expected_version','operation_id','review_notes','correlation_id']); return toStaffReviewCommandResponse(await workflow.rejectPlan({...b,actor:a,plan_id:id})); });
  register('PATCH',/^\/api\/v3\/plans\/([^/]+)\/placement$/,ACTIONS.PLAN_UPDATE_CONTENT,plan,(a,id,b) => service.placement(a,id,'save',b));
  for (const action of ['submit','mark-sent','return','confirm']) register('POST',new RegExp(`^/api/v3/plans/([^/]+)/placement/${action}$`),
    action === 'submit' ? ACTIONS.PLAN_UPDATE_CONTENT : ACTIONS.WORKFLOW_STAFF_WRITE,
    plan,(a,id,b) => service.placement(a,id,action,b));
}
module.exports = { registerThreeRoleRoutes };
