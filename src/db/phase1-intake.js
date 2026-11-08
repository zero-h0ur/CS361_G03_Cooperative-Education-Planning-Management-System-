const {ServiceUnavailableError}=require('../api/errors');
const {applicationAccess,INTAKE_MODES,pilotScope}=require('../shared/application-access');
const pendingAcademic=p=>p?.identity_source==='TU_ONBOARDING' && p.registration?.study_source==='self_reported';
const audience=()=>process.env.COED_INTAKE_AUDIENCE ?? 'pilot';
function access(actor,cycleId,routedStudent=false){return applicationAccess(process.env.COED_API_MAINTENANCE,{actor,cycleId,scope:process.env.COED_INTAKE_PILOT,audience:audience(),routedStudent});}
function denied(){throw new ServiceUnavailableError('ส่วนนี้ยังไม่เปิดให้ทำรายการ','COED_MAINTENANCE');}
// Cheap stage check only. Every admitted operation must also run the DB check below.
function requireStageCapability(actor,cycleId,key){if(!access(actor,cycleId,true)[key])denied();}
async function scopedAccess(db,actor,cycleId,{official,app,lock=false}={}){
  if(audience()!=='routed-tu-students' || !INTAKE_MODES.includes(process.env.COED_API_MAINTENANCE) || actor?.role!=='STUDENT')return access(actor,cycleId);
  const scope=pilotScope(process.env.COED_INTAKE_PILOT);
  if(!scope || !actor.isAuthenticated || actor.accountStatus!=='ACTIVE' || cycleId && cycleId!==scope.cycle_id ||
    !pendingAcademic(official) || official.student_id!==actor.studentId)return access(actor,cycleId);
  // Match the verified TU subject to this internal user; an email/name or a
  // browser-supplied role/department cannot grant intake membership.
  const linked=(await db.query(`SELECT 1 FROM external_identity_links WHERE user_id=$1
    AND external_issuer=$2 AND external_subject=$3 AND status='ACTIVE'`,
  [actor.userId,require('../auth/tu-config').tuConfig().issuer,official.student_number])).rowCount===1;
  if(!linked)return access(actor,cycleId);
  const target=cycleId || scope.cycle_id,curriculum=app?.payload?.curriculum || null;
  if(lock && curriculum)await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended(jsonb_build_array($1::uuid,$2::text,$3::text,$4::text,$5::text)::text,0))',
    [target,official.registration.faculty,official.registration.department,official.registration.program_type,curriculum]);
  const cycles=await visibleCycles(db,official,{cycleId:target,coordinatorId:scope.coordinator_user_id,curriculum,lock});
  return access(actor,target,cycles.includes(target));
}
async function requireCapability(db,actor,cycleId,key,context){if(!(await scopedAccess(db,actor,cycleId,context))[key])denied();}
function staffScope(actor,cycleId){
  const mode=process.env.COED_API_MAINTENANCE;if(!mode || mode==='off')return cycleId;
  const p=pilotScope(process.env.COED_INTAKE_PILOT);
  if(!['pilot','routed-tu-students'].includes(audience()) || !INTAKE_MODES.includes(mode) || !p || actor?.userId!==p.coordinator_user_id || actor?.role!=='COORDINATOR' ||
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
async function visibleCycles(db,official,{cycleId=null,coordinatorId=null,curriculum=null,lock=false}={}){
  if(!pendingAcademic(official) || !await schemaReady(db))return [];
  const r=official.registration;
  return (await db.query(`SELECT rt.cycle_id FROM phase1_intake_routes rt
    JOIN selection_cohorts c ON c.id=rt.cohort_id AND c.cycle_id=rt.cycle_id AND c.status='ACTIVE'
    JOIN users u ON u.id=c.coordinator_id AND u.role='COORDINATOR' AND u.account_status='ACTIVE'
    WHERE rt.active AND rt.tu_faculty=$1 AND rt.tu_department=$2 AND rt.program_type=$3
      AND ($4::uuid IS NULL OR rt.cycle_id=$4) AND ($5::uuid IS NULL OR c.coordinator_id=$5)
      AND ($6::text IS NULL OR rt.curriculum=$6)
      AND rt.version=(SELECT max(v.version) FROM phase1_intake_routes v WHERE v.cycle_id=rt.cycle_id
        AND v.tu_faculty=rt.tu_faculty AND v.tu_department=rt.tu_department AND v.program_type=rt.program_type AND v.curriculum=rt.curriculum)
    ${lock?'FOR SHARE OF c,u':''}`,
  [r.faculty,r.department,r.program_type,cycleId,coordinatorId,curriculum])).rows.map(x=>x.cycle_id);
}
module.exports={pendingAcademic,access,scopedAccess,requireStageCapability,requireCapability,staffScope,schemaReady,route,visibleCycles};
