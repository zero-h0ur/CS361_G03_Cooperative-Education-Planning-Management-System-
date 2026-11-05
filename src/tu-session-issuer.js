// IAM-only direct invocation. Event shape validation is NOT caller authentication;
// deployment must deny all unapproved principals and must not expose HTTP/URL routes.
const {randomUUID}=require('node:crypto');
const {TuSessionService}=require('./auth/tu-session-service');
const {createTuSigningKeyProvider}=require('./auth/tu-signing-secret');
const {CONTRACT,sessionTarget,validateEnvelope}=require('./auth/tu-session-contract');
const {safeError,safeLog}=require('./auth/tu-safe-response');
const {ServiceUnavailableError,ForbiddenError}=require('./api/errors');
const registrationContract=require('./auth/tu-registration-contract');
const {TuRegistrationService}=require('./auth/tu-registration-service');
function createTuSessionIssuer(options={}){
  const clock=options.clock || Date.now,session=options.sessionService || new TuSessionService(options);
  const getKeys=options.getKeys || createTuSigningKeyProvider(options),logger=options.logger || (line=>console.log(line));
  const registration=options.registrationService || new TuRegistrationService(options);
  return async function handler(event,context={}){
    const start=Date.now();let requestId=randomUUID(),stage='request',status=200,code='OK',cancelled=false,timer,contract=CONTRACT;
    try{
      const isRegistration=event?.contract===registrationContract.REGISTRATION;
      if(isRegistration && process.env.TU_ONBOARDING_ENABLED!=='true')throw new ForbiddenError();
      const envelope=isRegistration?registrationContract.envelope(event,clock()):validateEnvelope(event,clock());requestId=envelope.requestId;
      if(isRegistration)contract=registrationContract.REGISTRATION;
      const target=sessionTarget(options.targetArn ?? process.env.TU_SESSION_FUNCTION_ARN);
      if(context.invokedFunctionArn!==target.arn || !/^[1-9][0-9]*$/.test(context.functionVersion))throw new ForbiddenError('Access denied.','TU_ATTESTATION_REJECTED');
      if(!options.pool && !options.sessionService && (process.env.NODE_ENV!=='production' || process.env.DB_USER!=='coed_tu_login' ||
        !process.env.DB_SECRET_ARN || process.env.DATABASE_URL || process.env.DB_POOL_MAX!=='1' ||
        !['DB_CONN_TIMEOUT','DB_QUERY_TIMEOUT'].every(key=>/^\d+$/.test(process.env[key] || '') && Number(process.env[key])>0 && Number(process.env[key])<=1500)))
        throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
      stage='identity';
      const budget=isRegistration?14000:7000;
      const remaining=typeof context.getRemainingTimeInMillis==='function'?context.getRemainingTimeInMillis()-300:budget;
      if(!Number.isFinite(remaining) || remaining<1)throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
      const guardedKeys=async()=>{
          if(cancelled)throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
          stage='signing';const keys=await getKeys();
          if(cancelled)throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
          return keys;
      };
      const work=async()=>{
        if(!isRegistration)return session.issue(envelope.subject,guardedKeys);
        if(envelope.operation==='begin')return registration.begin(envelope,guardedKeys);
        const owner=await registration.complete(envelope);
        if(cancelled)throw new ServiceUnavailableError();
        const issued=await session.issue(owner.subject,guardedKeys);
        if(issued.user.id!==owner.userId || issued.user.studentId!==owner.studentId)throw new ForbiddenError();
        return issued;
      };
      const data=await Promise.race([
        work(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE'));},Math.min(budget,remaining));})]);
      return {contract,ok:true,[isRegistration && envelope.operation==='begin'?'registration':'session']:data};
    }catch(error){const safe=safeError(error);status=safe.status;code=safe.code;
      return {contract,ok:false,error:{code,status}};
    }finally{cancelled=true;clearTimeout(timer);safeLog(logger,{requestId,stage,code,status,durationMs:Date.now()-start,version:context.functionVersion});}
  };
}
module.exports={createTuSessionIssuer,handler:createTuSessionIssuer()};
