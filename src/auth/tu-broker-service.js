const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const {TokenValidator,parseJwt}=require('./token-validator');
const {TuProviderVerifier,validateTuLogin}=require('./tu-provider-verifier');
const {tuConfig}=require('./tu-config');
const {ServiceUnavailableError,AppError,ValidationError}=require('../api/errors');
const {CONTRACT,UUID,exact,sessionTarget,PROFILE_FIELDS}=require('./tu-session-contract');
const {ERRORS}=require('./tu-safe-response');
const {getTuPublicKey}=require('./tu-public-key');
const {REGISTRATION,verifyTicket,metadata,study}=require('./tu-registration-contract');
class TuBrokerService {
  constructor(options={}){
    this.clock=options.clock || Date.now;this.verifier=options.verifier || new TuProviderVerifier(options);
    this.targetArn=options.targetArn ?? process.env.TU_SESSION_FUNCTION_ARN;
    this.client=options.client;this.publicKey=options.publicKey;this.config={...tuConfig(),...options.config};
    this.validator=new TokenValidator({tuIssuer:this.config.issuer,tuClientId:this.config.clientId,
      tuKeyId:this.config.kid,tuPublicKey:options.publicKey});
  }
  isRealApiConfigured(){try{sessionTarget(this.targetArn);getTuPublicKey(this.publicKey);return this.verifier.isRealApiConfigured();}catch{return false;}}
  async login(input,requestId,stage=()=>{}){
    const subject=validateTuLogin(input);sessionTarget(this.targetArn);getTuPublicKey(this.publicKey);
    if(!UUID.test(requestId) || !this.verifier.isRealApiConfigured())throw new ServiceUnavailableError('Unavailable.','TU_AUTH_UNAVAILABLE');
    this.verifier.limit(subject);stage('provider');
    const proof=this.verifier.assertVerifiedProof(await this.verifier.verifyWithRealTuApi(subject,input.password));
    stage('invoke');
    try{return this.validateSession(await this.invoke({contract:CONTRACT,subject:proof.subject,verifiedAt:proof.verifiedAt,requestId}),subject);}
    catch(error){
      if(error.code!=='TU_ACCOUNT_UNAVAILABLE' || process.env.TU_ONBOARDING_ENABLED!=='true')throw error;
    }
    // Only a fresh verifier-owned proof can start onboarding. The private issuer
    // independently rejects any existing profile/link, even disabled/revoked ones.
    const identity=this.verifier.registrationIdentity(proof);
    const value=await this.invoke({contract:REGISTRATION,operation:'begin',subject:proof.subject,identity,verifiedAt:proof.verifiedAt,requestId});
    const r=value.registration;
    if(!exact(value,['contract','ok','registration']) || !exact(r,['contract','registrationToken','expiresIn','identity']) ||
      r.contract!==REGISTRATION || r.expiresIn!==300)throw new ServiceUnavailableError();
    const ticket=verifyTicket(r.registrationToken,{publicKey:this.publicKey,config:this.config,now:Math.floor(this.clock()/1000)});
    if(ticket.sub!==subject || JSON.stringify(ticket.identity)!==JSON.stringify(identity) || JSON.stringify(r.identity)!==JSON.stringify(identity))throw new ServiceUnavailableError();
    return r;
  }
  async register(input,requestId,stage=()=>{}){
    if(process.env.TU_ONBOARDING_ENABLED!=='true')throw new ServiceUnavailableError();
    if(!exact(input,['registrationToken','programType','entryYear','operationId']) || !UUID.test(input.operationId) || !UUID.test(requestId))throw new ValidationError();
    const data=study({programType:input.programType,entryYear:input.entryYear});
    const p=verifyTicket(input.registrationToken,{publicKey:this.publicKey,config:this.config,now:Math.floor(this.clock()/1000)});
    stage('invoke');
    const value=await this.invoke({contract:REGISTRATION,operation:'complete',ticket:input.registrationToken,study:data,operationId:input.operationId,requestId});
    return this.validateSession(value,p.sub);
  }
  async invoke(envelope){
    const target=sessionTarget(this.targetArn);
    const registration=envelope.contract===REGISTRATION,deadline=registration?16000:8000;
    const client=this.client || new LambdaClient({region:target.region,maxAttempts:1,
      requestHandler:{connectionTimeout:1000,requestTimeout:deadline-500,throwOnRequestTimeout:true}});
    let response,timer;const abort=new AbortController();
    try{
      response=await Promise.race([
        client.send(new InvokeCommand({FunctionName:target.arn,InvocationType:'RequestResponse',LogType:'None',
          Payload:Buffer.from(JSON.stringify(envelope))}),{abortSignal:abort.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error());},deadline);})]);
    }catch{throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');}finally{clearTimeout(timer);}
    try{
      if(response.StatusCode!==200 || response.FunctionError || !/^[1-9][0-9]*$/.test(response.ExecutedVersion) ||
        !(response.Payload instanceof Uint8Array) || response.Payload.byteLength>65536)throw Error();
      const value=JSON.parse(Buffer.from(response.Payload).toString('utf8'));
      if(value?.contract!==envelope.contract || typeof value.ok!=='boolean')throw Error();
      if(!value.ok){
        if(!exact(value,['contract','ok','error']) || !exact(value.error,['code','status']) ||
          !['TU_ACCOUNT_UNAVAILABLE','TU_SESSION_UNAVAILABLE','TU_SIGNING_UNAVAILABLE','TU_ATTESTATION_REJECTED',
            'TU_REGISTRATION_REJECTED','TU_REGISTRATION_STATUS','TU_REGISTRATION_PROFILE','TU_REGISTRATION_CONFLICT','TU_REGISTRATION_UNAVAILABLE'].includes(value.error.code) ||
          value.error.status!==ERRORS[value.error.code][0])throw Error();
        throw new AppError(ERRORS[value.error.code][1],value.error.code,value.error.status);
      }
      return value;
    }catch(error){
      if(error instanceof AppError && Object.hasOwn(ERRORS,error.code))throw error;
      throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
    }
  }
  async validateSession(value,subject){
    try{
      if(!exact(value,['contract','ok','session']))throw Error();
      const s=value.session,p=s?.profile;
      const onboarded=p?.onboarding && process.env.TU_ONBOARDING_ENABLED==='true';
      if(onboarded)metadata(p.onboarding,p);
      if(!exact(s,['accessToken','tokenType','expiresIn','mode','user','profile']) || s.tokenType!=='Bearer' || s.expiresIn!==900 || s.mode!=='tu_api' ||
        !exact(s.user,['id','role','studentId']) || s.user.role!=='STUDENT' || !UUID.test(s.user.id) || !UUID.test(s.user.studentId) ||
        !exact(p,onboarded?[...PROFILE_FIELDS,'onboarding']:PROFILE_FIELDS) || p.id!==s.user.studentId || p.student_number!==subject ||
        (onboarded ? !['academic_year','department','program','major'].every(k=>p[k]===null) :
          !Number.isInteger(p.academic_year) || p.academic_year<=0 || !['department','program','major'].every(k=>typeof p[k]==='string' && p[k].trim() && p[k].length<=2000)) ||
        !Number.isInteger(p.version) || p.version<1 ||
        !['full_name','institutional_email','enrollment_status'].every(k=>typeof p[k]==='string' && p[k].trim() && p[k].length<=2000) ||
        !['preferred_name','contact_email','contact_phone','contact_address'].every(k=>p[k]===null || (typeof p[k]==='string' && p[k].length<=10000)) ||
        typeof s.accessToken!=='string' || s.accessToken.length>8192)throw Error();
      const claims=await this.validator.validateToken(s.accessToken,Math.floor(this.clock()/1000)),jwt=parseJwt(s.accessToken).payload;
      if(claims.subject!==subject || claims.issuer!==this.config.issuer || !Number.isInteger(jwt.iat) ||
        Math.abs(jwt.iat-Math.floor(this.clock()/1000))>5 || jwt.nbf!==jwt.iat || jwt.exp-jwt.iat!==900)throw Error();
      return s;
    }catch(error){
      throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
    }
  }
}
module.exports={TuBrokerService};
