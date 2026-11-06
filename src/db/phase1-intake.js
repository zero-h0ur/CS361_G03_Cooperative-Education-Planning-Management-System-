const {ServiceUnavailableError}=require('../api/errors');
const {applicationAccess,INTAKE_MODES,pilotScope}=require('../shared/application-access');
const pendingAcademic=p=>p?.identity_source==='TU_ONBOARDING' && p.registration?.study_source==='self_reported';
function access(actor,cycleId){return applicationAccess(process.env.COED_API_MAINTENANCE,{actor,cycleId,scope:process.env.COED_INTAKE_PILOT});}
function requireCapability(actor,cycleId,key){if(!access(actor,cycleId)[key])throw new ServiceUnavailableError('ส่วนนี้ยังไม่เปิดให้ทำรายการ','COED_MAINTENANCE');}
function staffScope(actor,cycleId){
  const mode=process.env.COED_API_MAINTENANCE;if(!mode || mode==='off')return cycleId;
  const p=pilotScope(process.env.COED_INTAKE_PILOT);
  if(!INTAKE_MODES.includes(mode) || !p || actor?.userId!==p.coordinator_user_id || actor?.role!=='COORDINATOR' ||
    actor.accountStatus!=='ACTIVE' || cycleId && cycleId!==p.cycle_id)throw new ServiceUnavailableError('ส่วนนี้ยังไม่เปิดให้ทำรายการ','COED_MAINTENANCE');
  return p.cycle_id;
}
async function schemaReady(db){
  const r=await db.query(`SELECT to_regclass(current_schema() || '.phase1_intake_routes') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(current_schema() || '.phase1_submissions')
      AND attname='contract_version' AND NOT attisdropped) AS ready`);return r.rows[0]?.ready===true;
}
async function route(db,app,official,{lock=false}={}){
  if(!pendingAcademic(official) || !await schemaReady(db))return null;
  const r=official.registration;
  if(lock)await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended(jsonb_build_array($1::uuid,$2::text,$3::text,$4::text,$5::text)::text,0))',
    [app.cycle_id,r.faculty,r.department,r.program_type,app.payload.curriculum || '']);
  const rows=(await db.query(`SELECT rt.id AS route_id,rt.version AS route_version,c.id AS cohort_id,
      c.cycle_id,c.department,c.program,c.coordinator_id
    FROM phase1_intake_routes rt JOIN selection_cohorts c ON c.id=rt.cohort_id
    JOIN users u ON u.id=c.coordinator_id
    WHERE rt.cycle_id=$1 AND rt.tu_faculty=$2 AND rt.tu_department=$3 AND rt.program_type=$4
      AND rt.curriculum=$5 AND rt.active AND c.cycle_id=rt.cycle_id AND c.status='ACTIVE'
      AND u.role='COORDINATOR' AND u.account_status='ACTIVE'
      AND rt.version=(SELECT max(v.version) FROM phase1_intake_routes v WHERE v.cycle_id=rt.cycle_id
        AND v.tu_faculty=rt.tu_faculty AND v.tu_department=rt.tu_department AND v.program_type=rt.program_type AND v.curriculum=rt.curriculum)
    ${lock?'FOR SHARE OF c,u':''}`,[app.cycle_id,r.faculty,r.department,r.program_type,app.payload.curriculum || ''])).rows;
  return rows.length===1?rows[0]:null;
}
async function visibleCycles(db,official){
  if(!pendingAcademic(official) || !await schemaReady(db))return [];
  const r=official.registration;
  return (await db.query(`SELECT DISTINCT rt.cycle_id FROM phase1_intake_routes rt
    JOIN selection_cohorts c ON c.id=rt.cohort_id AND c.cycle_id=rt.cycle_id AND c.status='ACTIVE'
    JOIN users u ON u.id=c.coordinator_id AND u.role='COORDINATOR' AND u.account_status='ACTIVE'
    WHERE rt.active AND rt.tu_faculty=$1 AND rt.tu_department=$2 AND rt.program_type=$3
      AND rt.version=(SELECT max(v.version) FROM phase1_intake_routes v WHERE v.cycle_id=rt.cycle_id
        AND v.tu_faculty=rt.tu_faculty AND v.tu_department=rt.tu_department AND v.program_type=rt.program_type AND v.curriculum=rt.curriculum)`,
  [r.faculty,r.department,r.program_type])).rows.map(x=>x.cycle_id);
}
module.exports={pendingAcademic,access,requireCapability,staffScope,schemaReady,route,visibleCycles};
