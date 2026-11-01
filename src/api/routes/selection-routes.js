const {ACTIONS}=require('../services/authorization-service');
const {SelectionService}=require('../services/selection-service');
const {parseJsonBody,assertAllowedQueryParameters}=require('../router');
const {sendSuccess}=require('../response');
const {ValidationError}=require('../errors');
function registerSelectionRoutes(router,protect,options={}){
  const service=options.selectionService||new SelectionService({...options.authOptions,...options});
  const add=(method,pattern,action,handler,queryKeys=[])=>protect(router,{method,pattern,action,authOptions:options.authOptions||{},
    handler:async(req,res,ctx)=>{
      assertAllowedQueryParameters(ctx.url.searchParams,new Set(queryKeys));
      for(const key of queryKeys)if(ctx.url.searchParams.getAll(key).length>1)throw new ValidationError('Duplicate query parameter.');
      const data=await handler(ctx.authContext,ctx.params?.[0],method==='GET'?null:await parseJsonBody(req),Object.fromEntries(ctx.url.searchParams));
      sendSuccess(res,data,200,null,{'Cache-Control':'no-store'});
    }});
  add('GET','/api/v3/coordinator/applications',ACTIONS.COORDINATOR_SELECTION_READ,(a,_id,_b,q)=>service.list(a,q),['department','program','page','pageSize']);
  add('GET','/api/v3/committee/applications',ACTIONS.COMMITTEE_SELECTION_READ,(a,_id,_b,q)=>service.list(a,q),['department','program','page','pageSize']);
  add('POST',/^\/api\/v3\/coordinator\/plans\/([^/]+)\/acknowledge$/,ACTIONS.COORDINATOR_ACKNOWLEDGE,(a,id,b)=>service.mutate(a,id,b));
  add('POST',/^\/api\/v3\/committee\/plans\/([^/]+)\/opinion$/,ACTIONS.COMMITTEE_OPINION_CREATE,(a,id,b)=>service.mutate(a,id,b,true));
  add('GET',/^\/api\/v3\/plans\/([^/]+)\/selection$/,ACTIONS.STUDENT_SELECTION_READ,(a,id)=>service.studentStatus(a,id));
  add('GET','/api/v3/student/selection',ACTIONS.STUDENT_SELECTION_READ,a=>service.studentList(a));
}
module.exports={registerSelectionRoutes};
