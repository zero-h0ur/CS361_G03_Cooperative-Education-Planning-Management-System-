const {ACTIONS}=require('../services/authorization-service');
const {ApplicationService}=require('../services/application-service');
const {parseJsonBody,assertAllowedQueryParameters}=require('../router');
const {sendSuccess}=require('../response');
const {ValidationError,ServiceUnavailableError}=require('../errors');
function registerApplicationRoutes(router,protect,options={}) {
  const service=options.applicationService || new ApplicationService({...options.authOptions,...options});
  const reg=(method,pattern,write,handle,binary=false)=>protect(router,{method,pattern,
    action:write?ACTIONS.APPLICATION_WRITE:ACTIONS.APPLICATION_READ,authOptions:options.authOptions || {},
    resolveResource:()=>({listOnly:true}),handler:async(req,res,ctx)=>{
      assertAllowedQueryParameters(ctx.url.searchParams,new Set());
      if(binary) {
        const store=service.documentStore();
        if(!store.local || !['development','test'].includes(process.env.NODE_ENV) || process.env.AWS_LAMBDA_FUNCTION_NAME)throw new ServiceUnavailableError();
        if(method==='PUT') {
          const chunks=[];let size=0;
          for await(const chunk of req){size+=chunk.length;if(size>10485760)throw new ValidationError('ไฟล์มีขนาดเกินข้อกำหนด');chunks.push(Buffer.from(chunk));}
          sendSuccess(res,await service.localContent(ctx.authContext,ctx.params[0],ctx.params[1],Buffer.concat(chunks,size)),200,null,{'Cache-Control':'no-store'});
        } else {
          const result=await service.localContent(ctx.authContext,ctx.params[0],ctx.params[1]);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="coed-document"',
            'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(result.bytes);
        }
        return;
      }
      const body=method==='GET'?null:await parseJsonBody(req);
      const result=await handle(ctx.authContext,ctx.params || [],body);
      // Private local byte targets must return through the same authenticated bridge.
      // Never rewrite S3 targets or allow browser credentials onto arbitrary hosts.
      if(ctx.authProvider==='tu')for(const key of ['upload','download']) {
        const target=result?.[key];
        if(target?.auth_required===true && target.url?.startsWith('/api/v4/applications/'))
          result[key]={...target,url:'/api/tu-proxy'+target.url};
      }
      sendSuccess(res,result,200,null,{'Cache-Control':'no-store'});
    }});
  const root='/api/v4/applications';
  reg('GET','/api/v4/application-options',true,a=>service.options(a));
  reg('GET',root,false,a=>service.list(a));
  reg('POST',root,true,(a,_p,b)=>service.create(a,b));
  reg('GET',/^\/api\/v4\/applications\/([^/]+)$/,false,(a,p)=>service.get(a,p[0]));
  reg('PATCH',/^\/api\/v4\/applications\/([^/]+)$/,true,(a,p,b)=>service.save(a,p[0],b));
  reg('GET',/^\/api\/v4\/applications\/([^/]+)\/readiness$/,true,(a,p)=>service.readiness(a,p[0]));
  reg('POST',/^\/api\/v4\/applications\/([^/]+)\/uploads$/,true,(a,p,b)=>service.beginUpload(a,p[0],b));
  reg('POST',/^\/api\/v4\/applications\/([^/]+)\/uploads\/([^/]+)\/complete$/,true,(a,p,b)=>service.completeUpload(a,p[0],p[1],b));
  reg('POST',/^\/api\/v4\/applications\/([^/]+)\/documents\/([^/]+)\/download$/,false,async(a,p)=>({download:(await service.download(a,p[0],p[1])).download}));
  reg('POST',/^\/api\/v4\/applications\/([^/]+)\/submit$/,true,(a,p,b)=>service.submit(a,p[0],b));
  // These handlers explicitly refuse production/Lambda even if a local store is injected.
  reg('PUT',/^\/api\/v4\/applications\/([^/]+)\/uploads\/([^/]+)\/content$/,true,null,true);
  reg('GET',/^\/api\/v4\/applications\/([^/]+)\/documents\/([^/]+)\/content$/,false,null,true);
}
module.exports={registerApplicationRoutes};
