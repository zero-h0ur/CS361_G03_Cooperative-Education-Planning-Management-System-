const {schedule}=require('./coordinator-domain');
const {ConflictError}=require('../errors');

function confirmationWindow(primary,legacy) {
  const keys=['confirmation_opens_at','confirmation_closes_at'];
  const hasPrimary=keys.some(key=>primary[key]!=null),hasLegacy=keys.some(key=>legacy[key]!=null);
  if(hasPrimary && hasLegacy && keys.some(key=>Date.parse(primary[key])!==Date.parse(legacy[key])))
    throw new ConflictError('กำหนดการสองชุดไม่ตรงกัน กรุณาติดต่อผู้ดูแลเพื่อตรวจสอบก่อนบันทึก','SCHEDULE_SOURCE_CONFLICT');
  return Object.fromEntries(keys.map(key=>[key,(hasPrimary?primary:legacy)[key] ?? null]));
}

// Both schedule APIs share one lock and transaction. Never invent review dates
// or backfill historical rows to make the two read models appear consistent.
async function syncCoordinatorConfirmation(db,cycleId,window,actorId) {
  const prior=(await db.query('SELECT * FROM coordinator_round_schedules WHERE cycle_id=$1 FOR UPDATE',[cycleId])).rows[0];
  if(!prior)return;
  const iso=value=>value instanceof Date?value.toISOString():value;
  schedule(Object.fromEntries(Object.entries({...prior,...window}).map(([key,value])=>[key,iso(value)])));
  await db.query(`UPDATE coordinator_round_schedules SET confirmation_opens_at=$2,confirmation_closes_at=$3,
    version=version+1,updated_by=$4,updated_at=clock_timestamp() WHERE cycle_id=$1`,
  [cycleId,window.confirmation_opens_at,window.confirmation_closes_at,actorId]);
}
module.exports={syncCoordinatorConfirmation,confirmationWindow};
