const {getPool}=require('../../db/connection');
const {roleGuard}=require('./selection-service');
const {hash}=require('./application-service');
const v=require('./workflow-input');
const {ValidationError,ForbiddenError,NotFoundError,ConflictError,InvalidStateTransitionError}=require('../errors');
const domain=require('./coordinator-domain');

const panelKey=c=>[c.cycle_id,c.department,c.committee_one,c.committee_two,c.committee_three].join(':');
const track=value=>/พิเศษ|special|\bACS\b/i.test(value || '')?'special':/ปกติ|normal|regular|\bCIS\b/i.test(value || '')?'regular':'unknown';
class CoordinatorWorkspaceService {
  constructor({pool,allowSyntheticPolicy=false}={}){this.pool=pool;this.allowSynthetic=process.env.NODE_ENV==='test' && allowSyntheticPolicy;}
  db(){return this.pool || getPool();}
  async scope(db,actor,cycleId=null,lock=false) {
    roleGuard(actor,['COORDINATOR']);if(cycleId)v.uuid(cycleId,'cycle_id');
    const user=(await db.query(`SELECT id FROM users WHERE id=$1 AND role='COORDINATOR' AND account_status='ACTIVE' ${lock?'FOR SHARE':''}`,[actor.userId])).rows[0];
    if(!user)throw new ForbiddenError();
    const rows=(await db.query(`SELECT c.*,r.name AS cycle_name,r.academic_year,r.semester,r.status AS cycle_status
      FROM selection_cohorts c JOIN rounds r ON r.id=c.cycle_id
      WHERE c.coordinator_id=$1 AND c.status='ACTIVE' AND ($2::uuid IS NULL OR c.cycle_id=$2)
      ORDER BY r.academic_year DESC,r.semester DESC NULLS LAST,c.id ${lock?'FOR SHARE OF c':''}`,[actor.userId,cycleId])).rows;
    if(cycleId && !rows.length)throw new NotFoundError('ไม่พบรอบที่ได้รับมอบหมาย');return rows;
  }
  async options(actor) {
    const cohorts=await this.scope(this.db(),actor);
    return {cycles:[...new Map(cohorts.map(c=>[c.cycle_id,{id:c.cycle_id,name:c.cycle_name,status:c.cycle_status}])).values()]};
  }
  async rows(db,actor,filters={}) {
    const scope=await this.scope(db,actor,filters.cycle_id);
    if(!scope.length)return [];
    // All matching rows are scoped before filtering/counting/pagination. No page-local filtering.
    return (await db.query(`SELECT a.id,a.student_id,a.cycle_id,a.status,a.version AS application_version,
      c.id AS cohort_id,c.program,c.department,r.name AS cycle_name,r.status AS cycle_status,
      sub.id AS submission_id,sub.application_version AS submitted_version,sub.snapshot,sub.checksum,sub.submitted_at,
      rv.state AS review_state,rv.version AS review_version,rv.reason,rv.updated_at AS reviewed_at,
      cw.state AS committee_state,cw.version AS committee_version
      FROM phase1_applications a JOIN students st ON st.id=a.student_id
      JOIN selection_cohorts c ON c.cycle_id=a.cycle_id AND c.department=st.department AND c.program=st.program
      JOIN rounds r ON r.id=a.cycle_id
      JOIN LATERAL(SELECT * FROM phase1_submissions s WHERE s.application_id=a.id ORDER BY s.application_version DESC LIMIT 1) sub ON true
      LEFT JOIN phase1_reviews rv ON rv.application_id=a.id
      LEFT JOIN selection_cohorts canonical ON canonical.id=(SELECT min(cc.id::text)::uuid FROM selection_cohorts cc
        WHERE cc.status='ACTIVE' AND cc.cycle_id=c.cycle_id AND cc.department=c.department
          AND cc.committee_one=c.committee_one AND cc.committee_two=c.committee_two AND cc.committee_three=c.committee_three)
      LEFT JOIN committee_workspaces cw ON cw.cohort_id=canonical.id
      WHERE c.id=ANY($1::uuid[]) AND c.status='ACTIVE' AND a.status IN ('SUBMITTED','NEEDS_REVISION')
      ORDER BY sub.submitted_at DESC,a.id`,[scope.map(c=>c.id)])).rows;
  }
  present(row,detail=false) {
    const s=row.snapshot || {},official=s.official || {},p=s.payload || {};
    const state=row.status==='NEEDS_REVISION'?'RETURNED':row.review_state || 'PENDING';
    const record={id:row.id,cycle_id:row.cycle_id,cycle_name:row.cycle_name,cohort_id:row.cohort_id,
      application_version:row.application_version,submission_id:row.submission_id,submitted_version:row.submitted_version,
      review_version:row.review_version || 0,state,reason:row.reason || null,submitted_at:row.submitted_at,
      cycle_status:row.cycle_status,student_number:official.student_number || null,full_name:official.full_name || p.thai_full_name || null,
      curriculum:official.curriculum || null,program:row.program,program_type:track(row.program),major_group:p.major_group || null,
      positions:p.interested_position_codes || [],...domain.academic(s,{allowSynthetic:this.allowSynthetic})};
    if(detail)Object.assign(record,{official,payload:p,documents:s.documents || [],policy:s.policy || null,
      declarations:domain.declarations(s),checksum:row.checksum,reviewed_at:row.reviewed_at,
      can_review:state==='PENDING' && row.status==='SUBMITTED' && row.cycle_status==='OPEN'});
    return record;
  }
  async list(actor,filters={}) {
    v.fields(filters,['cycle_id','search','state','curriculum','program_type','sort','page','pageSize']);
    for(const key of ['search','state','curriculum','program_type','sort'])if(filters[key]!==undefined)v.text(filters[key],key,200);
    if(filters.state && !domain.STATES.includes(filters.state))throw new ValidationError('สถานะไม่ถูกต้อง');
    if(filters.curriculum && !['61','66'].includes(filters.curriculum))throw new ValidationError('หลักสูตรไม่ถูกต้อง');
    if(filters.program_type && !['regular','special','unknown'].includes(filters.program_type))throw new ValidationError('ประเภทหลักสูตรไม่ถูกต้อง');
    if(filters.sort && !['newest','oldest','name','core','gpax'].includes(filters.sort))throw new ValidationError('การเรียงลำดับไม่ถูกต้อง');
    const page=Number(filters.page || 1),pageSize=Number(filters.pageSize || 10);
    if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new ValidationError('หน้าไม่ถูกต้อง');
    let rows=(await this.rows(this.db(),actor,filters)).map(r=>this.present(r));
    if(filters.search){const q=filters.search.toLocaleLowerCase('th');rows=rows.filter(r=>`${r.student_number || ''} ${r.full_name || ''}`.toLocaleLowerCase('th').includes(q));}
    if(filters.curriculum)rows=rows.filter(r=>r.curriculum===filters.curriculum);
    if(filters.program_type)rows=rows.filter(r=>r.program_type===filters.program_type);
    const counts={all:rows.length,...Object.fromEntries(domain.STATES.map(state=>[state,rows.filter(r=>r.state===state).length]))};
    if(filters.state)rows=rows.filter(r=>r.state===filters.state);
    const score=(a,b,key)=>a[key]===null?(b[key]===null?0:1):b[key]===null?-1:b[key]-a[key];
    rows.sort((a,b)=>filters.sort==='oldest'?Date.parse(a.submitted_at)-Date.parse(b.submitted_at):filters.sort==='name'?(a.full_name || '').localeCompare(b.full_name || '','th'):
      ['core','gpax'].includes(filters.sort)?score(a,b,filters.sort)||score(a,b,filters.sort==='core'?'gpax':'core')||a.id.localeCompare(b.id):Date.parse(b.submitted_at)-Date.parse(a.submitted_at));
    return {applications:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,counts,page,pageSize};
  }
  async detail(actor,id) {
    v.uuid(id,'application_id');const db=this.db();const row=(await this.rows(db,actor)).find(r=>r.id===id);
    if(!row)throw new NotFoundError('ไม่พบใบสมัครที่คุณมีสิทธิ์ตรวจ');
    const history=(await db.query('SELECT id,application_version,submitted_at,checksum FROM phase1_submissions WHERE application_id=$1 ORDER BY application_version DESC',[id])).rows;
    return {...this.present(row,true),submission_history:history};
  }
  async command(actor,id,body,action,work) {
    roleGuard(actor,['COORDINATOR']);v.uuid(id,'resource_id');v.command(body);
    const db=await this.db().connect();
    try {
      await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
      await this.scope(db,actor,null,true);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[body.operation_id]);
      const requestHash=hash({actor:actor.userId,id,body,action});
      const old=(await db.query('SELECT * FROM coordinator_operations WHERE operation_id=$1',[body.operation_id])).rows[0];
      if(old){if(old.actor_id!==actor.userId || old.request_hash!==requestHash)throw new ConflictError('Operation ID ถูกใช้กับข้อมูลอื่นแล้ว');
        await work(db,true);await db.query('COMMIT');return old.result;}
      const result=await work(db,false);
      await db.query('INSERT INTO coordinator_operations(operation_id,actor_id,action,resource_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
        [body.operation_id,actor.userId,action,id,requestHash,JSON.stringify(result)]);
      await db.query('COMMIT');return result;
    }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  }
  async review(actor,id,body,action) {
    if(!['return','forward'].includes(action))throw new ValidationError('คำสั่งไม่ถูกต้อง');
    v.fields(body,['operation_id','expected_version','submission_id',...(action==='return'?['reason']:[])]);
    v.uuid(body.submission_id,'submission_id');
    const reason=action==='return'?v.text(body.reason,'reason',2000):null;
    return this.command(actor,id,body,action,async(db,replay)=>{
      const app=(await db.query('SELECT * FROM phase1_applications WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!app)throw new NotFoundError();
      const cohorts=await this.scope(db,actor,app.cycle_id,true);
      const student=(await db.query('SELECT department,program FROM students WHERE id=$1',[app.student_id])).rows[0];
      const cohort=cohorts.find(c=>c.department===student?.department && c.program===student?.program);
      if(!cohort)throw new ForbiddenError();if(replay)return;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || $1::text,0))",[app.cycle_id]);
      const latest=(await db.query('SELECT id FROM phase1_submissions WHERE application_id=$1 ORDER BY application_version DESC LIMIT 1',[id])).rows[0];
      const current=(await db.query('SELECT * FROM phase1_reviews WHERE application_id=$1 FOR UPDATE',[id])).rows[0];
      if(body.expected_version!==(current?.version || 0) || latest?.id!==body.submission_id)throw new ConflictError('ใบสมัครเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุด');
      const window=(await db.query(`SELECT r.status,COALESCE(s.review_closes_at,w.closes_at) AS deadline,
        clock_timestamp()<COALESCE(s.review_closes_at,w.closes_at) AS is_open FROM rounds r
        LEFT JOIN coordinator_round_schedules s ON s.cycle_id=r.id LEFT JOIN phase1_cycle_windows w ON w.cycle_id=r.id WHERE r.id=$1`,[app.cycle_id])).rows[0];
      if(app.status!=='SUBMITTED' || current && current.state!=='PENDING' || window?.status!=='OPEN' || !window?.is_open)
        throw new InvalidStateTransitionError('ใบสมัครหรือช่วงพิจารณาไม่เปิดให้ทำรายการแล้ว');
      const canonical=(await db.query(`SELECT id FROM selection_cohorts WHERE status='ACTIVE' AND cycle_id=$1 AND department=$2
        AND committee_one=$3 AND committee_two=$4 AND committee_three=$5 ORDER BY id LIMIT 1`,
      [cohort.cycle_id,cohort.department,cohort.committee_one,cohort.committee_two,cohort.committee_three])).rows[0];
      const activeMembers=(await db.query("SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND role='COMMITTEE' AND account_status='ACTIVE'",
        [[cohort.committee_one,cohort.committee_two,cohort.committee_three]])).rows[0].n;
      if(activeMembers!==3)throw new InvalidStateTransitionError('กรรมการที่ได้รับมอบหมายต้องพร้อมใช้งานครบ 3 คน');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['committee:'+canonical.id]);
      const meeting=(await db.query('SELECT version,state FROM committee_workspaces WHERE cohort_id=$1 FOR UPDATE',[canonical.id])).rows[0];
      if(meeting?.state?.finalized)throw new InvalidStateTransitionError('กรรมการยืนยันผลแล้ว ไม่สามารถเปลี่ยนรายชื่อในรอบนี้');
      const state=action==='return'?'RETURNED':'FORWARDED',version=(current?.version || 0)+1;
      if(current)await db.query(`UPDATE phase1_reviews SET state=$2,version=$3,reason=$4,actor_id=$5,updated_at=clock_timestamp()
        WHERE application_id=$1`,[id,state,version,reason,actor.userId]);
      else await db.query(`INSERT INTO phase1_reviews(application_id,submission_id,cohort_id,state,version,reason,actor_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,latest.id,cohort.id,state,version,reason,actor.userId]);
      if(action==='return')await db.query("UPDATE phase1_applications SET status='NEEDS_REVISION',submitted_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",[id]);
      else await db.query(`INSERT INTO committee_workspaces(cohort_id,version,state) VALUES($1,1,$2)
        ON CONFLICT(cohort_id) DO UPDATE SET version=committee_workspaces.version+1`,
        [canonical.id,JSON.stringify({proposal:null,history:[],selected:[],finalized:false})]);
      return {id,state,review_version:version};
    });
  }
  async tracking(actor,filters={}) {
    const {applications,...page}=await this.list(actor,{...filters,state:'FORWARDED'});
    const cohorts=await this.scope(this.db(),actor,filters.cycle_id);
    const panels=[...new Map(cohorts.map(c=>[panelKey(c),c])).values()];
    const meetings=[];
    for(const c of panels){const same=cohorts.filter(x=>panelKey(x)===panelKey(c)).sort((a,b)=>a.id.localeCompare(b.id));
      const saved=(await this.db().query('SELECT version,state FROM committee_workspaces WHERE cohort_id=$1',[same[0].id])).rows[0];
      meetings.push({cycle_id:c.cycle_id,department:c.department,members:[c.committee_one,c.committee_two,c.committee_three],
        version:saved?.version || 0,state:saved?.state || null});}
    return {applications,...page,meetings};
  }
  async scheduleScope(db,actor,cycleId,lock=false) {
    const cohorts=await this.scope(db,actor,cycleId,lock);
    const other=(await db.query("SELECT id FROM selection_cohorts WHERE cycle_id=$1 AND status='ACTIVE' AND coordinator_id<>$2 LIMIT 1",[cycleId,actor.userId])).rows.length;
    return {cohorts,can_edit:!other && cohorts[0]?.cycle_status==='OPEN'};
  }
  async getSchedule(actor,id) {
    v.uuid(id,'cycle_id');const db=this.db();const scope=await this.scheduleScope(db,actor,id);
    const row=(await db.query(`SELECT w.opens_at,w.closes_at,w.version AS window_version,s.review_opens_at,s.review_closes_at,
      s.confirmation_opens_at,s.confirmation_closes_at,s.version,s.updated_at FROM rounds r
      LEFT JOIN phase1_cycle_windows w ON w.cycle_id=r.id LEFT JOIN coordinator_round_schedules s ON s.cycle_id=r.id WHERE r.id=$1`,[id])).rows[0];
    return {cycle_id:id,cycle_name:scope.cohorts[0].cycle_name,...row,version:row.version || 0,window_version:row.window_version || 0,can_edit:scope.can_edit};
  }
  async saveSchedule(actor,id,body) {
    v.fields(body,['operation_id','expected_version','expected_window_version','opens_at','closes_at','review_opens_at','review_closes_at','confirmation_opens_at','confirmation_closes_at']);
    if(!Number.isInteger(body.expected_window_version)||body.expected_window_version<0)throw new ValidationError('เวอร์ชันช่วงสมัครไม่ถูกต้อง');
    const value=domain.schedule(body);
    return this.command(actor,id,body,'schedule',async(db,replay)=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || $1::text,0))",[id]);
      const scope=await this.scheduleScope(db,actor,id,true);
      if(!scope.can_edit)throw new ForbiddenError('ต้องได้รับมอบหมายทั้งรอบ และรอบต้องยังเปิดอยู่');if(replay)return;
      const prior=(await db.query('SELECT version FROM coordinator_round_schedules WHERE cycle_id=$1 FOR UPDATE',[id])).rows[0];
      const window=(await db.query('SELECT version FROM phase1_cycle_windows WHERE cycle_id=$1 FOR UPDATE',[id])).rows[0];
      if(body.expected_version!==(prior?.version || 0)||body.expected_window_version!==(window?.version || 0))throw new ConflictError('กำหนดการเปลี่ยนแล้ว กรุณาโหลดล่าสุดก่อนบันทึก');
      await db.query(`INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,$2,$3)
        ON CONFLICT(cycle_id) DO UPDATE SET opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,version=phase1_cycle_windows.version+1`,[id,value.opens_at,value.closes_at]);
      await db.query(`INSERT INTO coordinator_round_schedules(cycle_id,review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(cycle_id) DO UPDATE SET review_opens_at=EXCLUDED.review_opens_at,
        review_closes_at=EXCLUDED.review_closes_at,confirmation_opens_at=EXCLUDED.confirmation_opens_at,
        confirmation_closes_at=EXCLUDED.confirmation_closes_at,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,
      [id,value.review_opens_at,value.review_closes_at,value.confirmation_opens_at,value.confirmation_closes_at,body.expected_version+1,actor.userId]);
      return {cycle_id:id,...value,version:body.expected_version+1,window_version:body.expected_window_version+1,can_edit:true,cycle_name:scope.cohorts[0].cycle_name};
    });
  }
}
module.exports={CoordinatorWorkspaceService,track,panelKey};
