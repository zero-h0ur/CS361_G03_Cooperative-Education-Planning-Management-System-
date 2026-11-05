const {randomUUID}=require('node:crypto');
const {TuBrokerService}=require('./auth/tu-broker-service');
const {safeError,safeLog}=require('./auth/tu-safe-response');
const {ValidationError,AppError}=require('./api/errors');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache'};
function createTuAuthBroker(options={}){
  const service=options.service || new TuBrokerService(options),logger=options.logger || (line=>console.log(line));
  return async function handler(event={},context={}){
    const start=Date.now(),requestId=randomUUID();let stage='request',status=200,code='OK';
    try{
      const method=event.requestContext?.http?.method || event.httpMethod,path=event.rawPath || event.path;
      if(event.rawQueryString || Object.keys(event.queryStringParameters || {}).length)throw new ValidationError();
      if(!['/api/v3/auth/tu-login','/api/v3/auth/tu-status','/api/v3/auth/tu-register'].includes(path))throw new AppError('Not found.','NOT_FOUND',404);
      const isolated=process.env.NODE_ENV!=='production' || !['DB_SECRET_ARN','DATABASE_URL','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN','TU_API_APP_KEY'].some(key=>Boolean(process.env[key]));
      if(method==='GET' && path.endsWith('/tu-status'))return {statusCode:200,headers,body:JSON.stringify({data:{configured:isolated && service.isRealApiConfigured(),mode:'tu_api'}})};
      if(method!=='POST' || !['/api/v3/auth/tu-login','/api/v3/auth/tu-register'].includes(path))throw new AppError('Method not allowed.','METHOD_NOT_ALLOWED',405);
      if(process.env.TU_LOGIN_MAINTENANCE==='true')throw new AppError('Unavailable.','TU_LOGIN_MAINTENANCE',503);
      if(!isolated)throw new AppError('Unavailable.','TU_AUTH_UNAVAILABLE',503);
      if(typeof event.body!=='string' || event.body.length>12288 || event.isBase64Encoded)throw new ValidationError();
      let body;try{body=JSON.parse(event.body);}catch{throw new ValidationError();}
      const data=await service[path.endsWith('/tu-register')?'register':'login'](body,requestId,next=>{stage=next;});
      return {statusCode:200,headers,body:JSON.stringify({data})};
    }catch(error){const safe=safeError(error);status=safe.status;code=safe.code;
      return {statusCode:status,headers,body:JSON.stringify({error:{code,message:safe.message},request_id:requestId})};
    }finally{safeLog(logger,{requestId,stage,code,status,durationMs:Date.now()-start,version:context.functionVersion});}
  };
}
module.exports={createTuAuthBroker,handler:createTuAuthBroker()};
