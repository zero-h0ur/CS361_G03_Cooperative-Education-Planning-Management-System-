// Provider-only dependency graph: no database, provisioning or signing capability.
const {createHash}=require('node:crypto');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {ValidationError,UnauthorizedError,ForbiddenError,ServiceUnavailableError,AppError}=require('../api/errors');
const {tuConfig}=require('./tu-config');
const DEFAULT_TU_API_URL='https://restapi.tu.ac.th/api/v1/auth/Ad/verify';
const TU_API_URLS=Object.freeze([DEFAULT_TU_API_URL,'https://restapi.tu.ac.th/api/v1/auth/Ad/verify2']);
const SECRET_ARN=/^arn:aws:secretsmanager:([a-z0-9-]+):\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;
const proofs=new WeakMap();
function validateTuLogin(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    Object.keys(input).some(k=>!['studentId','password'].includes(k)) ||
    typeof input.studentId!=='string' || !/^\d{10}$/.test(input.studentId.trim()) ||
    typeof input.password!=='string' || !input.password.length || input.password.length>1024)
    throw new ValidationError('กรุณากรอกรหัสนักศึกษา 10 หลักและรหัสผ่านให้ถูกต้อง');
  return input.studentId.trim();
}
class TuProviderVerifier {
  constructor(options={}) {
    this.issuer=options.issuer || tuConfig().issuer;
    this.tuApiUrl=options.tuApiUrl || process.env.TU_API_URL || DEFAULT_TU_API_URL;
    this.tuAppKey=options.tuAppKey ?? process.env.TU_API_APP_KEY ?? '';
    this.tuSecretArn=options.tuSecretArn ?? process.env.TU_API_SECRET_ARN ?? '';
    this.fetchImpl=options.fetchImpl || globalThis.fetch;this.secretsClient=options.secretsClient;
    this.clock=options.clock || Date.now;this.attempts=new Map();
  }
  isRealApiConfigured(){return Boolean(this.tuAppKey?.trim() || SECRET_ARN.test(this.tuSecretArn));}
  limit(subject){
    const now=this.clock(),key=createHash('sha256').update(subject).digest('hex');
    for(const [k,v] of this.attempts)if(v.until<=now)this.attempts.delete(k);
    const current=this.attempts.get(key) || {n:0,until:now+60000};
    if(current.n>=5 || this.attempts.size>=1000)throw new AppError('กรุณารอสักครู่แล้วลองเข้าสู่ระบบใหม่','TU_LOGIN_RATE_LIMIT',429);
    current.n++;this.attempts.set(key,current);
  }
  async resolveAppKey(){
    if(this.tuAppKey?.trim())return this.tuAppKey.trim();
    const match=this.tuSecretArn.match(SECRET_ARN);
    if(!match)throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ','TU_AUTH_UNAVAILABLE');
    if(this.cachedSecret && this.cachedUntil>this.clock())return this.cachedSecret;
    const abort=new AbortController();let timer;
    try{
      const client=this.secretsClient || new SecretsManagerClient({region:match[1],maxAttempts:1,
        requestHandler:{connectionTimeout:1000,requestTimeout:2000,throwOnRequestTimeout:true}});
      const result=await Promise.race([
        client.send(new GetSecretValueCommand({SecretId:this.tuSecretArn,VersionStage:'AWSCURRENT'}),{abortSignal:abort.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error());},2500);})
      ]);
      const text=result.SecretString || '',parsed=text.trim().startsWith('{')?JSON.parse(text):null;
      const key=parsed?parsed.TU_API_APP_KEY:text;
      if(typeof key!=='string' || !key.trim())throw Error();
      this.cachedSecret=key.trim();this.cachedUntil=this.clock()+300000;return this.cachedSecret;
    }catch{throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังไม่พร้อม กรุณาลองใหม่','TU_AUTH_UNAVAILABLE');}
    finally{clearTimeout(timer);}
  }
  async verifyWithRealTuApi(studentId,password){
    if(!TU_API_URLS.includes(this.tuApiUrl))throw new ServiceUnavailableError('ปลายทางยืนยันตัวตนไม่ถูกต้อง','TU_AUTH_UNAVAILABLE');
    const appKey=await this.resolveAppKey();let response,payload;
    try{
      response=await this.fetchImpl(this.tuApiUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{'Content-Type':'application/json','Application-Key':appKey},body:JSON.stringify({UserName:studentId,PassWord:password})});
    }catch{throw new ServiceUnavailableError('ติดต่อระบบทะเบียนไม่สำเร็จ กรุณาลองใหม่','TU_API_UNAVAILABLE');}
    const discard=async()=>{try{await response.body?.cancel();}catch{/* No raw upstream content. */}};
    if(response.status===401 || response.status===403){await discard();throw new ServiceUnavailableError('ระบบยืนยันตัวตนมหาวิทยาลัยไม่อนุญาตคำขอ กรุณาติดต่อผู้ดูแล','TU_API_ACCESS_DENIED');}
    if(response.status===429){await discard();throw new AppError('ระบบมหาวิทยาลัยจำกัดจำนวนคำขอ กรุณารอสักครู่แล้วลองใหม่','TU_API_RATE_LIMIT',429);}
    if(!response.ok && response.status!==400){await discard();throw new ServiceUnavailableError('ระบบทะเบียนยังไม่พร้อม กรุณาลองใหม่','TU_API_UNAVAILABLE');}
    try{payload=await response.json();}catch{throw new ServiceUnavailableError('อ่านผลจากระบบทะเบียนไม่สำเร็จ กรุณาลองใหม่','TU_API_INVALID_RESPONSE');}
    if(response.status===400 && payload?.message==='Could not read the request body!')throw new ServiceUnavailableError('ระบบทะเบียนไม่สามารถอ่านคำขอยืนยันตัวตน กรุณาติดต่อผู้ดูแล','TU_API_REQUEST_REJECTED');
    if(!response.ok || payload?.status!==true || payload.type!=='student' || (Object.hasOwn(payload,'username') && payload.username!==studentId))
      throw new UnauthorizedError('ไม่สามารถยืนยันตัวตนได้ กรุณาตรวจสอบบัญชีและรหัสผ่าน','INVALID_CREDENTIALS');
    const proof=Object.freeze({issuer:this.issuer,subject:studentId,verifiedAt:this.clock()});
    const fields=['displayname_th','displayname_en','email','faculty','department','tu_status','statusid'];
    const profile=Object.fromEntries(fields.map(k=>[k,typeof payload[k]==='string' && payload[k].length<=500?payload[k]:null]));
    proofs.set(proof,{owner:this,profile:Object.freeze(profile)});return proof;
  }
  assertVerifiedProof(proof){
    if(proofs.get(proof)?.owner!==this || proof.issuer!==this.issuer || !/^\d{10}$/.test(proof.subject) || this.clock()<proof.verifiedAt || this.clock()-proof.verifiedAt>300000)
      throw new ForbiddenError('ต้องยืนยันตัวตน TU ใหม่','TU_PROOF_REQUIRED');
    return proof;
  }
  registrationIdentity(proof){
    this.assertVerifiedProof(proof);
    return require('./tu-registration-contract').fromProvider(proofs.get(proof).profile,proof.subject);
  }
}
module.exports={TuProviderVerifier,validateTuLogin,DEFAULT_TU_API_URL,TU_API_URLS,SECRET_ARN};
