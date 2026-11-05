// Public verification/validation only: no provider, database or private key.
const {verify}=require('node:crypto');
const {parseJwt}=require('./token-validator');
const {getTuPublicKey}=require('./tu-public-key');
const {tuConfig}=require('./tu-config');
const {ValidationError,ForbiddenError}=require('../api/errors');
const {exact,UUID}=require('./tu-session-contract');
const REGISTRATION='coed-tu-registration-v1';
const IDENTITY_FIELDS=['subject','nameTh','nameEn','email','faculty','department','tuStatus','statusId'];
const fail=()=>{throw new ForbiddenError('กรุณายืนยันตัวตน TU ใหม่','TU_REGISTRATION_REJECTED');};
function identity(value){
 if(!exact(value,IDENTITY_FIELDS) || typeof value.subject!=='string' || !/^\d{10}$/.test(value.subject) ||
  !['nameTh','email','faculty','department','tuStatus'].every(k=>typeof value[k]==='string' && value[k].trim()===value[k] && value[k].length>0 && value[k].length<=500) ||
  !['nameEn','statusId'].every(k=>value[k]===null || typeof value[k]==='string' && value[k].length>0 && value[k].length<=500 && value[k]===value[k].trim()) ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || Object.values(value).some(v=>typeof v==='string' && /[\u0000-\u001f\u007f]/.test(v)))fail();
 if(value.tuStatus!=='ปกติ' || value.statusId==='40')throw new ForbiddenError('สถานะนักศึกษาไม่พร้อมลงทะเบียน กรุณาติดต่อผู้ประสานงาน','TU_REGISTRATION_STATUS');
 return Object.freeze({...value});
}
function fromProvider(payload,subject){
 const text=k=>typeof payload?.[k]==='string'?(payload[k].trim()||null):null;
 try{return identity({subject,nameTh:text('displayname_th'),nameEn:text('displayname_en'),email:text('email'),
  faculty:text('faculty'),department:text('department'),tuStatus:text('tu_status'),statusId:text('statusid')});}
 catch(e){if(e.code==='TU_REGISTRATION_STATUS')throw e;
  throw new ForbiddenError('ข้อมูลจาก TU ยังไม่ครบ กรุณาติดต่อผู้ประสานงาน','TU_REGISTRATION_PROFILE');}
}
function study(value){
 if(!exact(value,['programType','entryYear']) || !['regular','special'].includes(value.programType) ||
  !Number.isInteger(value.entryYear) || value.entryYear<2500 || value.entryYear>2700)
  throw new ValidationError('กรุณาเลือกภาคและปีที่เข้าศึกษาให้ถูกต้อง');
 return {...value};
}
function verifyTicket(token,{publicKey,config=tuConfig(),now=Math.floor(Date.now()/1000)}={}){
 try{
  if(typeof token!=='string' || token.length>8192)fail();const j=parseJwt(token),p=j.payload;
  if(j.header.alg!=='RS256' || j.header.typ!=='JWT' || j.header.kid!==config.kid ||
   !verify('RSA-SHA256',Buffer.from(j.signingInput),getTuPublicKey(publicKey),j.signatureBuffer) ||
   !exact(p,['iss','aud','sub','token_use','scope','iat','nbf','exp','jti','identity']) ||
   p.iss!==config.issuer+':registration' || p.aud!==config.clientId+':registration' ||
   p.token_use!=='registration' || p.scope!=='coed-registration/complete' || !UUID.test(p.jti) ||
   ![p.iat,p.nbf,p.exp].every(Number.isSafeInteger) || p.nbf!==p.iat || p.exp-p.iat!==300 || p.iat>now+5 || p.exp<=now ||
   identity(p.identity).subject!==p.sub)fail();
  return p;
 }catch{fail();}
}
function envelope(value,now=Date.now()){
 if(value?.contract!==REGISTRATION || !UUID.test(value.requestId) || !['begin','complete'].includes(value.operation))fail();
 if(value.operation==='begin'){
  if(!exact(value,['contract','operation','subject','identity','verifiedAt','requestId']) ||
   identity(value.identity).subject!==value.subject || !Number.isSafeInteger(value.verifiedAt) ||
   value.verifiedAt<now-30000 || value.verifiedAt>now+5000)fail();
 }else{
  if(!exact(value,['contract','operation','ticket','study','operationId','requestId']) || !UUID.test(value.operationId))fail();
  study(value.study);if(typeof value.ticket!=='string' || value.ticket.length>8192)fail();
 }
 return value;
}
function metadata(value,profile){
 if(!exact(value,['identity','program_type','entry_year','study_source','academic_verification']) ||
  value.study_source!=='self_reported' || value.academic_verification!=='pending')fail();
 const i=identity(value.identity);study({programType:value.program_type,entryYear:value.entry_year});
 if(i.subject!==profile.student_number || i.nameTh!==profile.full_name || i.email!==profile.institutional_email || profile.enrollment_status!=='ACTIVE')fail();
 return value;
}
module.exports={REGISTRATION,IDENTITY_FIELDS,identity,fromProvider,study,verifyTicket,envelope,metadata};
