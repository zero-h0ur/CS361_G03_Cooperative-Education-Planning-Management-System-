const {ServiceUnavailableError,ConflictError} = require('../api/errors');

async function assertDeliverySchema(db) {
  const {rows}=await db.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='phase1_submission_deliveries' AND c.relkind='r'
      AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='phase1_delivery_guard' AND t.tgenabled='O')
      AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND NOT a.attisdropped AND a.attname=ANY(ARRAY[
        'submission_id','application_id','application_version','cohort_id','coordinator_id_at_send','department','program','snapshot_checksum','provenance','created_at']))=10) AS ready`);
  if(!rows[0]?.ready)throw new ServiceUnavailableError('ระบบรับใบสมัครยังไม่พร้อม ข้อมูลฉบับร่างยังอยู่','APPLICATION_DELIVERY_UPGRADE_REQUIRED');
}
async function destination(db,app,official,{lock=false}={}) {
  await assertDeliverySchema(db);
  const previous=(await db.query(`SELECT d.cohort_id,COALESCE(d.department,s.snapshot->'official'->>'department') AS department,
    COALESCE(d.program,s.snapshot->'official'->>'program') AS program FROM phase1_submissions s
    LEFT JOIN phase1_submission_deliveries d ON d.submission_id=s.id
    WHERE s.application_id=$1 ORDER BY s.application_version DESC LIMIT 1`,[app.id])).rows[0];
  const intake=require('./phase1-intake');
  const routed=intake.pendingAcademic(official)?await intake.route(db,app,official,{lock}):null;
  const target=routed || official;
  if(previous && (previous.department!==target.department || previous.program!==target.program))return {
    ready:false,code:'APPLICATION_DESTINATION_CHANGED',message:'ข้อมูลหลักสูตรเปลี่ยนจากฉบับที่ส่ง กรุณาติดต่อผู้ประสานงานก่อนส่งซ้ำ'};
  const rows=intake.pendingAcademic(official)?(routed?[routed]:[]):(await db.query(`SELECT c.id AS cohort_id,c.cycle_id,c.department,c.program,c.coordinator_id
    FROM selection_cohorts c JOIN users u ON u.id=c.coordinator_id
    WHERE c.cycle_id=$1 AND c.status='ACTIVE' AND u.role='COORDINATOR' AND u.account_status='ACTIVE'
      AND c.department=$3 AND c.program=$4 AND ($2::uuid IS NULL OR c.id=$2)
    ${lock?'FOR SHARE OF u,c':''}`,[app.cycle_id,previous?.cohort_id || null,official.department,official.program])).rows;
  if(rows.length!==1)return {ready:false,code:'APPLICATION_DESTINATION_UNAVAILABLE',message:'ยังยืนยันผู้ประสานงานของรอบและหลักสูตรนี้ไม่ได้ กรุณาตรวจความพร้อมอีกครั้ง หากยังไม่พร้อมให้ติดต่อผู้ดูแล ข้อมูลฉบับร่างยังอยู่'};
  const row=rows[0];
  if(previous && previous.cohort_id && previous.cohort_id!==row.cohort_id)return {ready:false,code:'APPLICATION_DESTINATION_CHANGED',message:'ปลายทางเปลี่ยน กรุณาติดต่อผู้ประสานงานก่อนส่งซ้ำ'};
  return {ready:true,...row};
}
async function requireDestination(db,app,official) {
  const result=await destination(db,app,official,{lock:true});
  if(!result.ready)throw new ConflictError(result.message,result.code);
  return result;
}
async function receipt(db,submissionId) {
  if(!submissionId)return null;
  await assertDeliverySchema(db);
  const row=(await db.query(`SELECT d.submission_id,d.application_id,d.application_version,d.department,d.program,
    d.created_at,s.submitted_at,r.id AS cycle_id,r.name AS cycle_name FROM phase1_submission_deliveries d
    JOIN phase1_submissions s ON s.id=d.submission_id JOIN selection_cohorts c ON c.id=d.cohort_id
    JOIN rounds r ON r.id=c.cycle_id WHERE d.submission_id=$1`,[submissionId])).rows[0];
  return row?{...row,status:'QUEUED_FOR_COORDINATOR'}:null;
}
module.exports={assertDeliverySchema,destination,requireDestination,receipt};
