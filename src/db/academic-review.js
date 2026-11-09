const {InvalidStateTransitionError}=require('../api/errors');
const domain=require('../api/services/academic-review-domain');
async function ready(db){return (await db.query("SELECT to_regclass(current_schema() || '.phase1_academic_reviews') IS NOT NULL AS ready")).rows[0]?.ready===true;}
async function latestPolicy(db,cycleId,curriculum){return (await db.query('SELECT * FROM phase1_policies WHERE cycle_id=$1 AND curriculum=$2 ORDER BY version DESC LIMIT 1',[cycleId,curriculum || ''])).rows[0] || null;}
async function read(db,submission){
 if(!await ready(db))return {schema_ready:false,version:0,record:null};
 const record=(await db.query('SELECT id,submission_id,submission_checksum,cohort_id,actor_id,policy_id,policy_version,version,checks,assessment,note,created_at FROM phase1_academic_reviews WHERE submission_id=$1 ORDER BY version DESC LIMIT 1',[submission.id])).rows[0] || null;
 return {schema_ready:true,version:record?.version || 0,record};
}
async function gate(db,submission,cycleId,{allowSynthetic=false}={}){
 const curriculum=submission.snapshot?.declared_academic?.curriculum || submission.snapshot?.payload?.curriculum;
 const policy=await latestPolicy(db,cycleId,curriculum),preview=domain.assessment(submission.snapshot,policy,{allowSynthetic});
 const current=await read(db,submission),r=current.record;
 const confirmed=Boolean(r && r.submission_checksum===submission.checksum && r.policy_id===policy?.id && r.policy_version===policy?.version && r.assessment?.eligibility==='PASS' && preview.can_confirm);
 return {...current,preview,confirmed};
}
async function requireConfirmed(db,submission,cycleId,cohortId,options){
 if(!submission?.snapshot?.assessment?.review_required)return null;
 if(!await ready(db))throw new InvalidStateTransitionError('ระบบตรวจรับรองยังไม่พร้อม ต้องอัปเกรดฐานข้อมูลก่อน','ACADEMIC_REVIEW_REQUIRED');
 const state=await gate(db,submission,cycleId,options);
 if(!state.confirmed || state.record.cohort_id!==cohortId || state.record.actor_id!==options?.actorId)throw new InvalidStateTransitionError('ต้องตรวจรับรองหลักฐานตามเกณฑ์ที่ยืนยันล่าสุดก่อนส่งต่อกรรมการ','ACADEMIC_REVIEW_REQUIRED');
 return state.record;
}
module.exports={ready,latestPolicy,read,gate,requireConfirmed};
