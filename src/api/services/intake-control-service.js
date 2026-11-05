const {getPool}=require('../../db/connection');
const {hash}=require('./application-service');
const {roleGuard}=require('./selection-service');
const {applicationBudget}=require('../../db/application-budget');
const intake=require('../../db/phase1-intake');
const control=require('../../db/intake-control');
const {evaluateIntake,MODES}=require('../../shared/intake-control');
const v=require('./workflow-input');
const {ValidationError,ForbiddenError,NotFoundError,ConflictError,ServiceUnavailableError}=require('../errors');
function input(body){
  v.fields(body,['operation_id','expected_version','mode','opens_at','closes_at']);v.command(body);
  if(!MODES.includes(body.mode))throw new ValidationError('โหมดรับสมัครไม่ถูกต้อง');
  if(body.mode!=='SCHEDULED'){
    if(body.opens_at!==undefined || body.closes_at!==undefined)throw new ValidationError('โหมดนี้ไม่รับวันเวลาจากผู้ใช้');
    return {mode:body.mode,opens_at:null,closes_at:null};
  }
  for(const key of ['opens_at','closes_at']){
    if(typeof body[key]!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(body[key]) || !Number.isFinite(Date.parse(body[key])))
      throw new ValidationError('ระบุวันเวลาและเขตเวลาให้ครบ');
    const local=body[key].match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/);
    const [,year,month,day,hour,minute,second='00',,offsetHour='00',offsetMinute='00']=local;
    const calendar=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
    if(calendar.getUTCFullYear()!==Number(year) || calendar.getUTCMonth()+1!==Number(month) || calendar.getUTCDate()!==Number(day) ||
      Number(hour)>23 || Number(minute)>59 || Number(second)>59 || Number(offsetHour)>14 || Number(offsetMinute)>59 || Number(offsetHour)===14 && Number(offsetMinute)!==0)
      throw new ValidationError('วันที่หรือเขตเวลาไม่มีอยู่จริง');
  }
  if(Date.parse(body.closes_at)<=Date.parse(body.opens_at))throw new ValidationError('วันปิดต้องอยู่หลังวันเปิด');
  return {mode:body.mode,opens_at:new Date(body.opens_at).toISOString(),closes_at:new Date(body.closes_at).toISOString()};
}
class IntakeControlService{
  constructor({pool}={}){this.pool=pool;}
  db(){return this.pool || getPool();}
  guard(actor,id){roleGuard(actor,['COORDINATOR']);v.uuid(id,'cycle_id');intake.staffScope(actor,id);}
  async scope(db,actor,id){
    if(!(await db.query("SELECT id FROM users WHERE id=$1 AND role='COORDINATOR' AND account_status='ACTIVE'",[actor.userId])).rowCount)throw new ForbiddenError();
    const cohorts=(await db.query("SELECT coordinator_id FROM selection_cohorts WHERE cycle_id=$1 AND status='ACTIVE' ORDER BY id",[id])).rows;
    if(!cohorts.some(c=>c.coordinator_id===actor.userId))throw new ForbiddenError();
    const cycle=(await db.query(`SELECT r.id,r.name,r.status,w.announced_at FROM rounds r LEFT JOIN phase1_cycle_windows w ON w.cycle_id=r.id WHERE r.id=$1`,[id])).rows[0];
    if(!cycle)throw new NotFoundError();
    return {...cycle,can_control:cohorts.every(c=>c.coordinator_id===actor.userId) && cycle.status==='OPEN' && !cycle.announced_at};
  }
  async present(db,cycle,row){
    const state=evaluateIntake(row,row?.server_time?.toISOString?.() || row?.server_time);
    return {cycle_id:cycle.id,cycle_name:cycle.name,control:state,can_control:cycle.can_control && Boolean(row),
      reason:!cycle.can_control?'SCOPE_OR_ROUND':!row?'UNCONFIGURED':null,
      history:row?(await db.query(`SELECT actor_id,created_at,previous_state->>'mode' AS previous_mode,next_state->>'mode' AS mode,
        (next_state->>'version')::int AS version FROM phase1_intake_control_events WHERE cycle_id=$1 ORDER BY id DESC LIMIT 20`,[cycle.id])).rows:[]};
  }
  async get(actor,id){
    this.guard(actor,id);const db=this.db(),cycle=await this.scope(db,actor,id);
    const row=await control.read(db,id,{required:true});return this.present(db,cycle,row);
  }
  async set(actor,id,body){
    this.guard(actor,id);const data=input(body),connection=await this.db().connect(),db=applicationBudget(connection);
    try{
      await connection.query('BEGIN');await db.query("SET LOCAL lock_timeout='1000ms'");
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[body.operation_id]);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || $1::text,0))",[id]);
      const cycle=await this.scope(db,actor,id);if(!cycle.can_control)throw new ForbiddenError('ต้องได้รับมอบหมายทั้งรอบและยังไม่ประกาศผล');
      const row=await control.read(db,id,{required:true,lock:true});
      if(!row)throw new ServiceUnavailableError('ยังไม่ได้จัดเตรียมรอบควบคุม','INTAKE_CONTROL_UNCONFIGURED');
      const requestHash=hash({actor:actor.userId,id,body,action:'intake-control'});
      const old=(await db.query('SELECT * FROM coordinator_operations WHERE operation_id=$1',[body.operation_id])).rows[0];
      if(old){if(old.actor_id!==actor.userId || old.resource_id!==id || old.action!=='intake-control' || old.request_hash!==requestHash)throw new ConflictError('Operation ID ถูกใช้แล้ว','IDEMPOTENCY_KEY_REUSED');
        await db.query('COMMIT');return {...old.result,idempotent_replay:true};}
      if(body.expected_version!==row.version)throw new ConflictError('สถานะรับสมัครเปลี่ยนแล้ว กรุณาโหลดล่าสุด','STALE_RECORD_CONFLICT');
      const updated=(await db.query(`UPDATE phase1_intake_controls SET mode=$2,opens_at=$3,closes_at=$4,version=version+1,updated_by=$5,operation_id=$6
        WHERE cycle_id=$1 RETURNING *,clock_timestamp() AS server_time`,[id,data.mode,data.opens_at,data.closes_at,actor.userId,body.operation_id])).rows[0];
      const result=await this.present(db,cycle,updated);
      await db.query(`INSERT INTO coordinator_operations(operation_id,actor_id,action,resource_id,request_hash,result)
        VALUES($1,$2,'intake-control',$3,$4,$5)`,[body.operation_id,actor.userId,id,requestHash,result]);
      await db.query('COMMIT');return result;
    }catch(e){await connection.query('ROLLBACK');throw e;}finally{connection.release();}
  }
}
module.exports={IntakeControlService,input};
