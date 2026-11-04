const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const {TokenValidator,parseJwt}=require('./token-validator');
const {TuProviderVerifier,validateTuLogin}=require('./tu-provider-verifier');
const {tuConfig}=require('./tu-config');
const {ServiceUnavailableError,AppError}=require('../api/errors');
const {CONTRACT,UUID,exact,sessionTarget,PROFILE_FIELDS}=require('./tu-session-contract');
const {ERRORS}=require('./tu-safe-response');
const {getTuPublicKey}=require('./tu-public-key');
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
    const subject=validateTuLogin(input),target=sessionTarget(this.targetArn);getTuPublicKey(this.publicKey);
    if(!UUID.test(requestId) || !this.verifier.isRealApiConfigured())throw new ServiceUnavailableError('Unavailable.','TU_AUTH_UNAVAILABLE');
    this.verifier.limit(subject);stage('provider');
    const proof=this.verifier.assertVerifiedProof(await this.verifier.verifyWithRealTuApi(subject,input.password));
    stage('invoke');
    const client=this.client || new LambdaClient({region:target.region,maxAttempts:1,
      requestHandler:{connectionTimeout:1000,requestTimeout:7500,throwOnRequestTimeout:true}});
    let response,timer;const abort=new AbortController();
    try{
      response=await Promise.race([
        client.send(new InvokeCommand({FunctionName:target.arn,InvocationType:'RequestResponse',LogType:'None',
          Payload:Buffer.from(JSON.stringify({contract:CONTRACT,subject:proof.subject,verifiedAt:proof.verifiedAt,requestId}))}),{abortSignal:abort.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error());},8000);})]);
    }catch{throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');}finally{clearTimeout(timer);}
    try{
      if(response.StatusCode!==200 || response.FunctionError || !/^[1-9][0-9]*$/.test(response.ExecutedVersion) ||
        !(response.Payload instanceof Uint8Array) || response.Payload.byteLength>65536)throw Error();
      const value=JSON.parse(Buffer.from(response.Payload).toString('utf8'));
      if(value?.contract!==CONTRACT || typeof value.ok!=='boolean')throw Error();
      if(!value.ok){
        if(!exact(value,['contract','ok','error']) || !exact(value.error,['code','status']) ||
          !['TU_ACCOUNT_UNAVAILABLE','TU_SESSION_UNAVAILABLE','TU_SIGNING_UNAVAILABLE','TU_ATTESTATION_REJECTED'].includes(value.error.code) ||
          value.error.status!==ERRORS[value.error.code][0])throw Error();
        throw new AppError(ERRORS[value.error.code][1],value.error.code,value.error.status);
      }
      if(!exact(value,['contract','ok','session']))throw Error();
      const s=value.session,p=s?.profile;
      if(!exact(s,['accessToken','tokenType','expiresIn','mode','user','profile']) || s.tokenType!=='Bearer' || s.expiresIn!==900 || s.mode!=='tu_api' ||
        !exact(s.user,['id','role','studentId']) || s.user.role!=='STUDENT' || !UUID.test(s.user.id) || !UUID.test(s.user.studentId) ||
        !exact(p,PROFILE_FIELDS) || p.id!==s.user.studentId || p.student_number!==subject ||
        !Number.isInteger(p.academic_year) || p.academic_year<=0 || !Number.isInteger(p.version) || p.version<1 ||
        !['full_name','institutional_email','department','program','major','enrollment_status'].every(k=>typeof p[k]==='string' && p[k].trim() && p[k].length<=2000) ||
        !['preferred_name','contact_email','contact_phone','contact_address'].every(k=>p[k]===null || (typeof p[k]==='string' && p[k].length<=10000)) ||
        typeof s.accessToken!=='string' || s.accessToken.length>8192)throw Error();
      const claims=await this.validator.validateToken(s.accessToken,Math.floor(this.clock()/1000)),jwt=parseJwt(s.accessToken).payload;
      if(claims.subject!==subject || claims.issuer!==this.config.issuer || !Number.isInteger(jwt.iat) ||
        Math.abs(jwt.iat-Math.floor(this.clock()/1000))>5 || jwt.nbf!==jwt.iat || jwt.exp-jwt.iat!==900)throw Error();
      return s;
    }catch(error){
      if(error instanceof AppError && ['TU_ACCOUNT_UNAVAILABLE','TU_SIGNING_UNAVAILABLE','TU_ATTESTATION_REJECTED'].includes(error.code))throw error;
      throw new ServiceUnavailableError('Unavailable.','TU_SESSION_UNAVAILABLE');
    }
  }
}
module.exports={TuBrokerService};
