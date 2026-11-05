// Private issuer only. Registration is an explicit operation, never an identity fallback.
const {randomUUID}=require('node:crypto');
const {getPool}=require('../db/connection');
const {signTuJwt}=require('./tu-keys');
const {getTuPublicKey}=require('./tu-public-key');
const {tuConfig}=require('./tu-config');
const {REGISTRATION,identity,study,verifyTicket}=require('./tu-registration-contract');
const {ForbiddenError,ConflictError,ServiceUnavailableError}=require('../api/errors');
class TuRegistrationService {
 constructor(options={}){Object.assign(this,tuConfig(),options);this.clock=options.clock || Date.now;}
 get db(){return this.pool || getPool();}
 async begin(envelope,getKeys){
  const i=identity(envelope.identity);
  const row=(await this.db.query(`SELECT
   EXISTS(SELECT 1 FROM public.external_identity_links WHERE external_issuer=$1 AND external_subject=$2) AS linked,
   EXISTS(SELECT 1 FROM public.students WHERE student_number=$2) AS student`,[this.issuer,i.subject])).rows[0];
  if(row?.linked!==false || row?.student!==false)throw new ForbiddenError();
  const keys=await getKeys(),now=Math.floor(this.clock()/1000);
  const registrationToken=signTuJwt({iss:this.issuer+':registration',aud:this.clientId+':registration',sub:i.subject,
   token_use:'registration',scope:'coed-registration/complete',iat:now,nbf:now,exp:now+300,jti:randomUUID(),identity:i},
  {privateKey:keys.privateKey,kid:this.kid});
  return {contract:REGISTRATION,registrationToken,expiresIn:300,identity:i};
 }
 async complete(envelope){
  const p=verifyTicket(envelope.ticket,{publicKey:this.publicKey || getTuPublicKey(),config:this,now:Math.floor(this.clock()/1000)});
  const data=study(envelope.study);let db;
  try{
   // Runtime SELECT-only login connection is never used for a provisioning write.
   db=this.provisionConnect?await this.provisionConnect():await require('./tu-registration-store').connectRegistration();
   const result=(await db.query('SELECT * FROM public.complete_tu_registration($1,$2,$3,$4,$5,$6,$7)',
    [this.issuer,p.jti,envelope.operationId,JSON.stringify(p.identity),data.programType,data.entryYear,new Date(p.exp*1000)])).rows[0];
   if(!result?.student_id || !result.user_id)throw Error();
   return {subject:p.sub,userId:result.user_id,studentId:result.student_id};
  }catch(error){
   if(['23505','P0001','23514'].includes(error.code))throw new ConflictError('บัญชีมีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่','TU_REGISTRATION_CONFLICT');
   if(error instanceof ForbiddenError)throw error;
   throw new ServiceUnavailableError('ระบบลงทะเบียนยังไม่พร้อม กรุณาลองใหม่','TU_REGISTRATION_UNAVAILABLE');
  }finally{if(db)await db.end().catch(()=>{});}
 }
}
module.exports={TuRegistrationService};
