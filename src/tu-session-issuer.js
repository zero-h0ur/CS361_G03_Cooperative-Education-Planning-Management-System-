// IAM-only direct invocation. Event shape validation is NOT caller authentication;
// deployment must deny all unapproved principals and must not expose HTTP/URL routes.
const {randomUUID}=require('node:crypto');
const {TuSessionService}=require('./auth/tu-session-service');
const {createTuSigningKeyProvider}=require('./auth/tu-signing-secret');
const {CONTRACT,sessionTarget,validateEnvelope}=require('./auth/tu-session-contract');
const {safeError,safeLog}=require('./auth/tu-safe-response');
const {ServiceUnavailableError,ForbiddenError}=require('./api/errors');
function createTuSessionIssuer(options={}){
  const clock=options.clock || Date.now,session=options.sessionService || new TuSessionService(options);
  const getKeys=options.getKeys || createTuSigningKeyProvider(options),logger=options.logger || (line=>console.log(line));
  return async function handler(event,context={}){
    const start=Date.now();let requestId=randomUUID(),stage='request',status=200,code='OK',cancelled=false,timer;
    try{
      const envelope=validateEnvelope(event,clock());requestId=envelope.requestId;
      const target=sessionTarget(options.targetArn ?? process.env.TU_SESSION_FUNCTION_ARN);
      if(context.invokedFunctionArn!==target.arn || !/^[1-9][0-9]*$/.test(context.functionVersion))throw new ForbiddenError('Access denied.','TU_ATTESTATION_REJECTED');
      if(!options.pool && !options.sessionService && (process.env.NODE_ENV!=='production' || process.env.DB_USER!=='coed_tu_login' ||
        !process.env.DB_SECRET_ARN || process.env.DATABASE_URL || process.env.DB_POOL_MAX!=='1' ||
        !['DB_CONN_TIMEOUT','DB_QUERY_TIMEOUT'].every(key=>/^\d+$/.test(process.env[key] || '') && Number(process.env[key])>0 && Number(process.env[key])<=1500)))
        throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
      stage='identity';
      const remaining=typeof context.getRemainingTimeInMillis==='function'?context.getRemainingTimeInMillis()-300:7000;
      if(!Number.isFinite(remaining) || remaining<1)throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
      const data=await Promise.race([
        session.issue(envelope.subject,async()=>{
          if(cancelled)throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
          stage='signing';const keys=await getKeys();
          if(cancelled)throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
          return keys;
        }),
        new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE'));},Math.min(7000,remaining));})]);
      return {contract:CONTRACT,ok:true,session:data};
    }catch(error){const safe=safeError(error);status=safe.status;code=safe.code;
      return {contract:CONTRACT,ok:false,error:{code,status}};
    }finally{cancelled=true;clearTimeout(timer);safeLog(logger,{requestId,stage,code,status,durationMs:Date.now()-start,version:context.functionVersion});}
  };
}
module.exports={createTuSessionIssuer,handler:createTuSessionIssuer()};
