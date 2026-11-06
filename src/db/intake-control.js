const {evaluateIntake}=require('../shared/intake-control');
const {pilotScope}=require('../shared/application-access');
const {ServiceUnavailableError}=require('../api/errors');
async function ready(db){return (await db.query("SELECT to_regclass(current_schema() || '.phase1_intake_controls') IS NOT NULL AS ready")).rows[0]?.ready===true;}
async function read(db,cycleId,{required=false,lock=false}={}){
  if(!await ready(db)){if(required)throw new ServiceUnavailableError('ยังไม่พร้อมควบคุมการรับสมัคร','INTAKE_CONTROL_UPGRADE_REQUIRED');return null;}
  return (await db.query(`SELECT *,clock_timestamp() AS server_time FROM phase1_intake_controls WHERE cycle_id=$1 ${lock?'FOR UPDATE':''}`,[cycleId])).rows[0] || null;
}
async function effective(db,cycleId,legacy){
  const control=await read(db,cycleId),pilot=pilotScope(process.env.COED_INTAKE_PILOT);
  const required=process.env.COED_INTAKE_CONTROLS_REQUIRED==='true' && pilot?.cycle_id===cycleId;
  if(!control && !required)return legacy;
  const intake=evaluateIntake(control,control?.server_time?.toISOString?.() || control?.server_time);
  return {...legacy,opens_at:intake.opens_at,closes_at:intake.closes_at,is_open:intake.is_open,intake};
}
module.exports={ready,read,effective};
