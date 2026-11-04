const {ServiceUnavailableError,ForbiddenError}=require('../api/errors');
const CONTRACT='coed-tu-session-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ARN=/^arn:aws:lambda:([a-z0-9-]+):(\d{12}):function:coed-tu-session-issuer:(live|candidate)$/;
const exact=(object,keys)=>Boolean(object && typeof object==='object' && !Array.isArray(object) &&
  Object.keys(object).length===keys.length && keys.every(k=>Object.hasOwn(object,k)));
function sessionTarget(value=process.env.TU_SESSION_FUNCTION_ARN){
  const match=typeof value==='string' && value.match(SESSION_ARN);
  if(!match || (process.env.AWS_REGION && process.env.AWS_REGION!==match[1]))throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ','TU_SESSION_UNAVAILABLE');
  return {arn:value,region:match[1],account:match[2],alias:match[3]};
}
function validateEnvelope(value,now=Date.now()){
  if(!exact(value,['contract','subject','verifiedAt','requestId']) || value.contract!==CONTRACT ||
    typeof value.subject!=='string' || !/^\d{10}$/.test(value.subject) || !UUID.test(value.requestId) ||
    !Number.isSafeInteger(value.verifiedAt) || value.verifiedAt<now-30000 || value.verifiedAt>now+5000)
    throw new ForbiddenError('Access denied.','TU_ATTESTATION_REJECTED');
  return value;
}
const PROFILE_FIELDS=['id','student_number','full_name','preferred_name','institutional_email','department','program',
  'major','academic_year','enrollment_status','version','contact_email','contact_phone','contact_address'];
module.exports={CONTRACT,UUID,SESSION_ARN,exact,sessionTarget,validateEnvelope,PROFILE_FIELDS};
