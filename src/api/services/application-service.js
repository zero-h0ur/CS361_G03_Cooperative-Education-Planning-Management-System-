const {randomUUID,createHash}=require('node:crypto');
const {ApplicationRepository}=require('../../db/repositories/application-repository');
const {UnauthorizedError,ForbiddenError,ConflictError,InvalidStateTransitionError,ValidationError,ServiceUnavailableError}=require('../errors');
const v=require('./application-input');
const {templates,readiness,effectiveCriteria}=require('./application-policy');
const {FORM_VERSION,DECLARED_IDENTITY}=require('../../shared/application-form');
const delivery=require('../../db/phase1-delivery');
const {INTAKE_MODES,pilotScope}=require('../../shared/application-access');
const intake=require('../../db/phase1-intake');
const {applicationBudget}=require('../../db/application-budget');
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function guard(actor,write=false) {
  if(!actor?.isAuthenticated)throw new UnauthorizedError();
  v.uuid(actor.userId,'actor');
  if(actor.accountStatus!=='ACTIVE' || !(write?['STUDENT']:['STUDENT','COORDINATOR']).includes(actor.role))throw new ForbiddenError();
}
const safePolicy=p=>p?{id:p.id,version:p.version,curriculum:p.curriculum,source_year:p.source_year,source:p.source,verified:p.verified,synthetic:p.synthetic,data:p.data,
  effective_criteria:p.effective_criteria || effectiveCriteria(p.curriculum)}:null;
class ApplicationService {
  constructor(options={}) {
    this.repository=options.repository || new ApplicationRepository(options);
    this.store=options.documentStore;
    // Test injection only; production configuration cannot turn synthetic eligibility on.
    this.allowSynthetic=process.env.NODE_ENV==='test' && options.allowSyntheticPolicy===true;
  }
  documentStore() {
    if(!this.store)this.store=require('../../storage/application-document-store').createDocumentStore();
    return this.store;
  }
  async official(db,actor,app,lock=false) {
    if(actor.role==='STUDENT')return this.repository.profile(db,actor,lock);
    const user=(await db.query('SELECT user_id FROM students WHERE id=$1',[app.student_id])).rows[0];
    return this.repository.profile(db,{studentId:app.student_id,userId:user.user_id},lock);
  }
  async detail(db,actor,app) {
    const access=intake.access(actor,app.cycle_id);
    const retained=(await db.query('SELECT id,policy_id,snapshot,checksum,submitted_at FROM phase1_submissions WHERE application_id=$1 ORDER BY application_version DESC LIMIT 1',[app.id])).rows[0] || null;
    // Coordinator sees the last submitted snapshot, never the student's unsent correction.
    const submission=app.status==='SUBMITTED' || actor.role==='COORDINATOR'?retained:null;
    const official=submission?.snapshot.official || await this.official(db,actor,app);
    const policy=submission?submission.snapshot.policy:await this.repository.policy(db,app,official);
    const documents=submission?.snapshot.documents || await this.repository.documents(db,app.id);
    const cycle=(await db.query(`SELECT r.name,r.status,w.opens_at,w.closes_at,
      (clock_timestamp()>=w.opens_at AND clock_timestamp()<w.closes_at) AS window_open,w.cycle_id AS scheduled_cycle
      FROM rounds r LEFT JOIN phase1_cycle_windows w ON w.cycle_id=r.id WHERE r.id=$1`,[app.cycle_id])).rows[0];
    const effective=app.status==='NEEDS_REVISION'?await this.repository.cycleForApplication(db,app,official):null;
    const correction=app.status==='NEEDS_REVISION'?(await db.query('SELECT reason,version FROM phase1_reviews WHERE application_id=$1 AND state=\'RETURNED\'',[app.id])).rows[0]:null;
    return {id:app.id,student_id:app.student_id,cycle_id:app.cycle_id,status:app.status,version:app.version,
      payload:submission?.snapshot.payload || app.payload,form_version:submission ? submission.snapshot.form_version || 1 : FORM_VERSION,
      official:submission?.snapshot.official || official,policy:safePolicy(policy),documents,
      assessment:submission?.snapshot.assessment || null,
      access,cycle_name:submission?.snapshot.cycle?.name || cycle.name,availability:{can_edit:Boolean(!access.read_only && actor.role==='STUDENT' &&
        (app.status==='DRAFT' && cycle.status==='OPEN' && (cycle.window_open || !intake.pendingAcademic(official) && !cycle.scheduled_cycle) || app.status==='NEEDS_REVISION' && effective?.status==='OPEN' && effective.window?.is_open)),
        opens_at:cycle.opens_at,closes_at:effective?.window?.closes_at || cycle.closes_at},
      correction:correction?{...correction,closes_at:effective?.window?.closes_at}:null,
      last_submission:retained?{id:retained.id,checksum:retained.checksum,submitted_at:retained.submitted_at}:null,
      submitted_at:app.submitted_at,submission,
      delivery_receipt:await delivery.receipt(db,retained?.id)};
  }
  async options(actor) {
    guard(actor,true);const db=this.repository.pool,official=await this.repository.profile(db,actor);
    const intakeCycles=await intake.visibleCycles(db,official);
    let cycles=(await db.query(`SELECT r.id,r.name,r.academic_year,r.semester,r.status,w.opens_at,w.closes_at
      FROM rounds r LEFT JOIN phase1_cycle_windows w ON w.cycle_id=r.id WHERE r.visibility='public' OR EXISTS
      (SELECT 1 FROM selection_cohorts c WHERE c.cycle_id=r.id AND c.status='ACTIVE' AND c.department=$1 AND c.program=$2)
      OR r.id=ANY($3::uuid[]) ORDER BY r.academic_year DESC,r.semester DESC NULLS LAST,r.id LIMIT 100`,[official.department,official.program,intakeCycles])).rows;
    if(INTAKE_MODES.includes(process.env.COED_API_MAINTENANCE)){
      const pilot=pilotScope(process.env.COED_INTAKE_PILOT);cycles=cycles.filter(c=>pilot && c.id===pilot.cycle_id);
    }
    return {official,cycles,criteria:templates(),storage_configured:Boolean(this.store || process.env.CO_ED_APPLICATION_STORAGE),
      access:intake.access(actor),pending_academic_submission:intake.pendingAcademic(official)};
  }
  async list(actor) {
    guard(actor,true);const db=this.repository.pool;await this.repository.profile(db,actor);
    const rows=(await db.query(`SELECT a.id,a.cycle_id,a.status,a.version,a.submitted_at,a.updated_at,rv.reason AS correction_reason,
      CASE WHEN a.status='NEEDS_REVISION' THEN jsonb_build_object('can_edit',r.status='OPEN' AND rv.state='RETURNED'
        AND clock_timestamp()>=w.opens_at AND clock_timestamp()<COALESCE(s.review_closes_at,w.closes_at)) ELSE NULL END AS availability
      FROM phase1_applications a JOIN rounds r ON r.id=a.cycle_id LEFT JOIN phase1_reviews rv ON rv.application_id=a.id
      LEFT JOIN phase1_cycle_windows w ON w.cycle_id=a.cycle_id LEFT JOIN coordinator_round_schedules s ON s.cycle_id=a.cycle_id
      WHERE a.student_id=$1 ORDER BY a.created_at DESC,a.id LIMIT 100`,[actor.studentId])).rows;
    return rows.map(row=>{const access=intake.access(actor,row.cycle_id);return {...row,access,...(access.read_only?{availability:{...row.availability,can_edit:false}}:{})};});
  }
  async get(actor,id) {
    guard(actor);v.uuid(id);const db=await this.repository.pool.connect();
    try {await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await this.repository.active(db,actor);
      const app=await this.repository.application(db,id,actor);if(actor.role==='COORDINATOR')intake.staffScope(actor,app.cycle_id);
      const result=await this.detail(db,actor,app);await db.query('COMMIT');return result;
    } catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  }
  async check(db,actor,app) {
    const official=await this.official(db,actor,app),policy=await this.repository.policy(db,app,official);
    const cycle=await this.repository.cycleForApplication(db,app,official,true);
    const result=readiness({app,official,policy,documents:await this.repository.documents(db,app.id),window:cycle.window,roundOpen:cycle.status==='OPEN',allowSynthetic:this.allowSynthetic,allowPendingAcademic:intake.pendingAcademic(official)});
    const receiver=await delivery.destination(db,app,official);
    result.destination={ready:receiver.ready,department:receiver.department || official.department,program:receiver.program || official.program};
    if(!receiver.ready){result.can_submit=false;result.blockers.push({field:'destination',code:receiver.code,message:receiver.message});}
    return {policy,cycle,result};
  }
  async readiness(actor,id) {
    guard(actor,true);v.uuid(id);intake.requireCapability(actor,null,'can_edit');const db=await this.repository.pool.connect();
    try{await db.query('BEGIN');await this.repository.active(db,actor,true);const app=await this.repository.application(db,id,actor,true);
      intake.requireCapability(actor,app.cycle_id,'can_edit');const {result}=await this.check(db,actor,app);await db.query('COMMIT');return result;
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  }
  async mutate(actor,id,input,action,work,{create=false}={}) {
    guard(actor,true);if(id)v.uuid(id);v.uuid(input.operation_id,'operation_id');
    const capability={APPLICATION_CREATED:'can_create',APPLICATION_DRAFT_SAVED:'can_edit',APPLICATION_SUBMITTED:'can_submit',
      APPLICATION_UPLOAD_STARTED:'can_upload',APPLICATION_DOCUMENT_ATTACHED:'can_upload'}[action];
    if(!capability)throw new ForbiddenError();intake.requireCapability(actor,create?input.cycle_id:null,capability);
    const connection=await this.repository.pool.connect(),db=applicationBudget(connection);
    try {
      await connection.query('BEGIN');await this.repository.active(db,actor,true);
      await db.query("SET LOCAL lock_timeout='1000ms'");
      const official=await this.repository.profile(db,actor,true);
      // Serialize an operation globally before looking for its receipt, including create retries.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.operation_id]);
      const old=(await db.query('SELECT * FROM phase1_operations WHERE operation_id=$1',[input.operation_id])).rows[0];
      const requestHash=hash({id,input,action});
      if(old) {
        if(old.actor_id!==actor.userId || old.action!==action || old.request_hash!==requestHash)throw new ConflictError('Operation ID ถูกใช้กับข้อมูลอื่นแล้ว','IDEMPOTENCY_KEY_REUSED');
        const prior=await this.repository.application(db,old.application_id,actor,true);intake.requireCapability(actor,prior.cycle_id,capability);
        await db.query('COMMIT');return {...old.result,idempotent_replay:true};
      }
      let app=create?null:await this.repository.application(db,id,actor,true);
      if(app)intake.requireCapability(actor,app.cycle_id,capability);
      if(app && app.version!==input.expected_version)throw new ConflictError('ข้อมูลเปลี่ยนไปแล้ว ข้อมูลที่คุณกรอกยังไม่ถูกบันทึก','STALE_RECORD_CONFLICT');
      const result=await work(db,app,official);
      const appId=result.id || id;
      await db.query(`INSERT INTO phase1_operations(operation_id,application_id,actor_id,action,request_hash,result)
        VALUES($1,$2,$3,$4,$5,$6)`,[input.operation_id,appId,actor.userId,action,requestHash,JSON.stringify(result)]);
      await db.query(`INSERT INTO phase1_events(id,operation_id,application_id,actor_id,action,application_version)
        VALUES($1,$2,$3,$4,$5,$6)`,[randomUUID(),input.operation_id,appId,actor.userId,action,result.version || app?.version || 1]);
      await db.query('COMMIT');return result;
    } catch(e) {
      await connection.query('ROLLBACK');
      if(e.code==='23505')throw new ConflictError('มีใบสมัครหรือรายการนี้อยู่แล้ว','APPLICATION_ALREADY_EXISTS');
      throw e;
    } finally {connection.release();}
  }
  async create(actor,input) {
    v.command(input,['cycle_id'],false);v.uuid(input.cycle_id,'cycle_id');
    return this.mutate(actor,null,input,'APPLICATION_CREATED',async(db,_app,official)=>{
      const cycle=await this.repository.cycle(db,input.cycle_id,official,true);
      if(cycle.status!=='OPEN' || (cycle.window && !cycle.window.is_open) || intake.pendingAcademic(official) && !cycle.window)throw new InvalidStateTransitionError('รอบสมัครไม่เปิดหรือยังไม่มีกำหนดการ');
      const app=(await db.query(`INSERT INTO phase1_applications(id,student_id,cycle_id) VALUES($1,$2,$3) RETURNING *`,[randomUUID(),actor.studentId,input.cycle_id])).rows[0];
      return this.detail(db,actor,app);
    },{create:true});
  }
  async save(actor,id,input) {
    v.command(input,['payload','expected_policy_id']);const data=v.payload(input.payload);
    if(input.expected_policy_id!==null)v.uuid(input.expected_policy_id,'expected_policy_id');
    return this.mutate(actor,id,input,'APPLICATION_DRAFT_SAVED',async(db,app,official)=>{
      await this.repository.editable(db,app,official);
      if(data.institutional_email && official.institutional_email && data.institutional_email!==official.institutional_email)throw new ValidationError('อีเมลทางการแก้ไขไม่ได้');
      for(const field of DECLARED_IDENTITY)if(data[field] && official[field] && data[field]!==official[field])
        throw new ValidationError('ข้อมูลทางการแก้ไขไม่ได้',[{field,message:'กรุณาใช้ข้อมูลทางการที่ยืนยันแล้ว'}]);
      const merged={...app.payload,...data};
      const policy=await this.repository.policy(db,{...app,payload:merged},official);
      if((policy?.id || null)!==input.expected_policy_id)throw new ConflictError('เกณฑ์เปลี่ยน กรุณาโหลดเกณฑ์ล่าสุด โดยข้อมูลที่กรอกยังอยู่','POLICY_CHANGED');
      const updated=(await db.query(`UPDATE phase1_applications SET payload=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[id,JSON.stringify(merged)])).rows[0];
      return this.detail(db,actor,updated);
    });
  }
  async submit(actor,id,input) {
    v.command(input,['expected_policy_id']);if(input.expected_policy_id!==null)v.uuid(input.expected_policy_id,'expected_policy_id');
    return this.mutate(actor,id,input,'APPLICATION_SUBMITTED',async(db,app,official)=>{
      await this.repository.editable(db,app,official);
      const receiver=await delivery.requireDestination(db,app,official);
      const {policy,cycle,result}=await this.check(db,actor,app);
      if((policy?.id || null)!==input.expected_policy_id)throw new ConflictError('เกณฑ์เปลี่ยน กรุณาตรวจสอบใหม่','POLICY_CHANGED');
      if(!result.can_submit)throw new ValidationError('ใบสมัครยังไม่พร้อมส่ง',result.blockers,'APPLICATION_NOT_READY');
      const documents=await this.repository.documents(db,id);
      const destination={cohort_id:receiver.cohort_id,coordinator_id:receiver.coordinator_id,department:receiver.department,program:receiver.program};
      const pending=intake.pendingAcademic(official),contractVersion=pending?2:1;
      const snapshot={form_version:FORM_VERSION,...(pending?{contract_version:2,intake:{route_id:receiver.route_id,route_version:receiver.route_version},
        assessment:{eligibility:result.eligibility,group_gpa:result.group_gpa,review_required:true,review_flags:result.review_flags,source:'STUDENT_DECLARED'},
        declared_academic:{curriculum:app.payload.curriculum,major_group:app.payload.major_group,entry_year:official.registration.entry_year,program_type:official.registration.program_type,source:'STUDENT_DECLARED'}}:{}),
        official,payload:app.payload,policy:safePolicy(policy),documents,delivery:destination,
        cycle:{id:cycle.id,name:cycle.name,academic_year:cycle.academic_year,semester:cycle.semester,
          opens_at:cycle.window.opens_at,closes_at:cycle.window.closes_at,window_version:cycle.window.version},
        acknowledgements:{actor_id:actor.userId,policy_id:policy?.id || null,accepted_at:new Date().toISOString()}};
      const submissionId=randomUUID();
      if(pending)await db.query(`INSERT INTO phase1_submissions(id,application_id,application_version,policy_id,snapshot,checksum,submitted_by,contract_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[submissionId,id,app.version+1,policy?.id || null,JSON.stringify(snapshot),hash(snapshot),actor.userId,contractVersion]);
      else await db.query(`INSERT INTO phase1_submissions(id,application_id,application_version,policy_id,snapshot,checksum,submitted_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[submissionId,id,app.version+1,policy.id,JSON.stringify(snapshot),hash(snapshot),actor.userId]);
      await db.query(`INSERT INTO phase1_submission_deliveries(submission_id,application_id,application_version,cohort_id,
        coordinator_id_at_send,department,program,snapshot_checksum) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [submissionId,id,app.version+1,receiver.cohort_id,receiver.coordinator_id,receiver.department,receiver.program,hash(snapshot)]);
      if(app.status==='NEEDS_REVISION')await db.query(`UPDATE phase1_reviews SET submission_id=$2,state='PENDING',reason=NULL,
        version=version+1,actor_id=$3,updated_at=clock_timestamp() WHERE application_id=$1 AND state='RETURNED'`,[id,submissionId,actor.userId]);
      const updated=(await db.query(`UPDATE phase1_applications SET status='SUBMITTED',submitted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[id])).rows[0];
      return this.detail(db,actor,updated);
    });
  }
  async beginUpload(actor,id,input) {
    const data=v.upload(input);const store=this.documentStore();
    const receipt=await this.mutate(actor,id,input,'APPLICATION_UPLOAD_STARTED',async(db,app,official)=>{
      await this.repository.editable(db,app,official);
      const ticketId=randomUUID(),key=`staging/${randomUUID()}`,expires=new Date(Date.now()+300000);
      await db.query(`INSERT INTO phase1_uploads(id,application_id,kind,filename,content_type,byte_size,checksum,staging_key,expected_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[ticketId,id,data.kind,data.filename,data.content_type,data.byte_size,data.checksum,key,app.version,expires]);
      return {id,version:app.version,ticket_id:ticketId,expires_at:expires};
    });
    const {ticket}=await this.ticket(this.repository.pool,actor,id,receipt.ticket_id);
    const target=await store.uploadTarget({key:ticket.staging_key,ticketId:ticket.id,applicationId:id,size:ticket.byte_size,contentType:ticket.content_type,checksum:ticket.checksum});
    return {...receipt,upload:target}; // Bearer URLs never enter operation receipts.
  }
  async ticket(db,actor,id,ticketId) {
    await this.repository.active(db,actor,true);
    const app=await this.repository.application(db,id,actor,true);
    const official=await this.repository.profile(db,actor,true);await this.repository.editable(db,app,official);
    const ticket=(await db.query('SELECT * FROM phase1_uploads WHERE id=$1 AND application_id=$2',[ticketId,id])).rows[0];
    if(!ticket || ticket.status!=='PENDING' || new Date(ticket.expires_at)<=new Date())throw new ConflictError('การอัปโหลดหมดอายุหรือใช้งานแล้ว','UPLOAD_EXPIRED');
    if(app.version!==ticket.expected_version)throw new ConflictError('ใบสมัครเปลี่ยนระหว่างอัปโหลด','STALE_RECORD_CONFLICT');
    return {app,ticket};
  }
  async completeUpload(actor,id,ticketId,input) {
    v.uuid(ticketId);v.command(input);
    return this.mutate(actor,id,{...input,ticket_id:ticketId},'APPLICATION_DOCUMENT_ATTACHED',async(db,app,official)=>{
      await this.repository.editable(db,app,official);
      const {ticket}=await this.ticket(db,actor,id,ticketId);
      const signal=db.signal(),store=this.documentStore(),bytes=await store.readStaging(ticket.staging_key,ticket.byte_size,{signal});
      const {validateBytes}=require('../../storage/application-document-store');validateBytes(bytes,ticket);
      // A distinct, write-once key closes the reusable presigned-upload overwrite hole.
      const key=`final/${randomUUID()}`;await store.writeFinal(key,bytes,{signal});
      if(signal.aborted)throw new ServiceUnavailableError('ตรวจเอกสารเกินเวลาที่กำหนด ไฟล์เดิมยังอยู่','APPLICATION_STORAGE_TIMEOUT');
      await this.repository.editable(db,app,official); // Time window may have closed during storage I/O.
      const docId=randomUUID();
      await db.query(`INSERT INTO phase1_documents(id,application_id,ticket_id,kind,filename,content_type,byte_size,checksum,object_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[docId,id,ticketId,ticket.kind,ticket.filename,ticket.content_type,ticket.byte_size,ticket.checksum,key]);
      await db.query(`INSERT INTO phase1_attachments(application_id,kind,document_id) VALUES($1,$2,$3)
        ON CONFLICT(application_id,kind) DO UPDATE SET document_id=excluded.document_id`,[id,ticket.kind,docId]);
      await db.query("UPDATE phase1_uploads SET status='ATTACHED' WHERE id=$1",[ticketId]);
      const updated=(await db.query('UPDATE phase1_applications SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[id])).rows[0];
      return this.detail(db,actor,updated);
    });
  }
  async download(actor,id,documentId) {
    guard(actor);v.uuid(id);v.uuid(documentId);const db=this.repository.pool;
    await this.repository.active(db,actor);
    const app=await this.repository.application(db,id,actor);intake.requireCapability(actor,app.cycle_id,'can_download');
    const doc=(await db.query(`SELECT d.* FROM phase1_documents d WHERE d.id=$1 AND d.application_id=$2 AND
      (($3='STUDENT' AND EXISTS(SELECT 1 FROM phase1_attachments a WHERE a.document_id=d.id)) OR
      EXISTS(SELECT 1 FROM phase1_submissions s,jsonb_array_elements(s.snapshot->'documents') x WHERE s.application_id=$2 AND x->>'id'=d.id::text))`,[documentId,id,actor.role])).rows[0];
    if(!doc)throw new ForbiddenError();
    return {document:doc,download:await this.documentStore().downloadTarget({key:doc.object_key,applicationId:id,documentId})};
  }
  async localContent(actor,id,resourceId,bytes=null) {
    guard(actor,bytes!==null);v.uuid(id);v.uuid(resourceId);
    const store=this.documentStore();if(!store.local)throw new ServiceUnavailableError();
    if(bytes===null){const {document}=await this.download(actor,id,resourceId);return {bytes:await store.readFinal(document.object_key,document.byte_size),contentType:document.content_type};}
    intake.requireCapability(actor,null,'can_upload');const db=await this.repository.pool.connect();
    try{await db.query('BEGIN');const {app,ticket}=await this.ticket(db,actor,id,resourceId);intake.requireCapability(actor,app.cycle_id,'can_upload');if(bytes.length!==ticket.byte_size)throw new ValidationError('ขนาดไฟล์ไม่ตรง');
      await store.writeStaging(ticket.staging_key,bytes);await db.query('COMMIT');return {uploaded:true};
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  }
}
module.exports={ApplicationService,hash};
