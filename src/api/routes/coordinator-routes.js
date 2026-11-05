const {ACTIONS}=require('../services/authorization-service');
const {CoordinatorWorkspaceService}=require('../services/coordinator-workspace-service');
const {parseJsonBody,assertAllowedQueryParameters}=require('../router');
const {sendSuccess}=require('../response');
const {ValidationError}=require('../errors');
function registerCoordinatorRoutes(router,protect,options={}) {
  const service=options.coordinatorWorkspaceService || new CoordinatorWorkspaceService(options);
  const intake=options.intakeControlService || new (require('../services/intake-control-service').IntakeControlService)({pool:options.pool || options.authOptions?.pool});
  const add=(method,pattern,handle,keys=[],write=false)=>protect(router,{method,pattern,
    action:write?ACTIONS.COORDINATOR_SCHEDULE_WRITE:method==='GET'?ACTIONS.COORDINATOR_SELECTION_READ:ACTIONS.COORDINATOR_ACKNOWLEDGE,authOptions:options.authOptions || {},
    handler:async(req,res,ctx)=>{
      assertAllowedQueryParameters(ctx.url.searchParams,new Set(keys));
      for(const key of keys)if(ctx.url.searchParams.getAll(key).length>1)throw new ValidationError('Duplicate query parameter.');
      const value=await handle(ctx.authContext,ctx.params?.[0],method==='GET'?null:await parseJsonBody(req),Object.fromEntries(ctx.url.searchParams));
      sendSuccess(res,value,200,null,{'Cache-Control':'no-store'});
    }});
  const filters=['cycle_id','search','state','curriculum','program_type','sort','page','pageSize'];
  add('GET','/api/v4/coordinator/options',a=>service.options(a));
  add('GET',/^\/api\/v4\/coordinator\/intake\/([^/]+)$/, (a,id)=>intake.get(a,id));
  add('POST',/^\/api\/v4\/coordinator\/intake\/([^/]+)$/, (a,id,b)=>intake.set(a,id,b),[],true);
  add('GET','/api/v4/coordinator/applications',(a,_id,_body,q)=>service.list(a,q),filters);
  add('GET','/api/v4/coordinator/tracking',(a,_id,_body,q)=>service.tracking(a,q),filters.filter(x=>x!=='state'));
  add('GET',/^\/api\/v4\/coordinator\/applications\/([^/]+)$/, (a,id)=>service.detail(a,id));
  add('POST',/^\/api\/v4\/coordinator\/applications\/([^/]+)\/return$/, (a,id,b)=>service.review(a,id,b,'return'));
  add('POST',/^\/api\/v4\/coordinator\/applications\/([^/]+)\/forward$/, (a,id,b)=>service.review(a,id,b,'forward'));
  add('GET',/^\/api\/v4\/coordinator\/schedules\/([^/]+)$/, (a,id)=>service.getSchedule(a,id));
  add('POST',/^\/api\/v4\/coordinator\/schedules\/([^/]+)$/, (a,id,b)=>service.saveSchedule(a,id,b),[],true);
}
module.exports={registerCoordinatorRoutes};
