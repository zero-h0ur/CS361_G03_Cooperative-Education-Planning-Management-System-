const {createHash}=require('node:crypto');
const {getPool}=require('../../db/connection');
const {UnauthorizedError,ForbiddenError,ValidationError,ConflictError,InvalidStateTransitionError}=require('../errors');
const v=require('./workflow-input');

const ALLOWED_STATES=new Set(['AWAITING_COORDINATOR','NEEDS_REVISION','UNDER_COMMITTEE_REVIEW','SELECTION_COMPLETE_PENDING_ANNOUNCEMENT']);
const CONTROL_CHAR_REGEX=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function stateFor(receipt,count,planStatus='SUBMITTED'){
  if(planStatus==='NEEDS_REVISION')return 'NEEDS_REVISION';
  return !receipt ? 'AWAITING_COORDINATOR' : count===3 ? 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT' : 'UNDER_COMMITTEE_REVIEW';
}
function roleGuard(actor,roles){
  if(!actor?.isAuthenticated || !actor.userId)throw new UnauthorizedError();
  if(actor.accountStatus!=='ACTIVE' || !roles.includes(actor.role))throw new ForbiddenError('Access denied.');
}
function command(body,opinion=false){
  v.fields(body,opinion?['operation_id','expected_version','selected','comment']:['operation_id','expected_version']);
  v.command(body);
  if(body.expected_version<1)throw new ValidationError('expected_version must be positive.');
  if(opinion){
    if(typeof body.selected!=='boolean')throw new ValidationError('selected must be a boolean.');
    if(typeof body.comment!=='string')throw new ValidationError('comment is required.');
    const comment=body.comment.replace(/\r\n?/g,'\n').trim();
    if(!comment||comment.length>2000||CONTROL_CHAR_REGEX.test(comment))
      throw new ValidationError('comment must be plain text between 1 and 2000 characters.');
    return {...body,comment};
  }
  return body;
}
function returnCommand(body){
  v.fields(body,['operation_id','expected_version','checklist','reason']);
  v.command(body);
  if(body.expected_version<1)throw new ValidationError('expected_version must be positive.');
  let checklist=[];
  if(body.checklist!==undefined){
    if(!Array.isArray(body.checklist)||body.checklist.length>10)
      throw new ValidationError('checklist must be an array of at most 10 items.');
    checklist=body.checklist.map(item=>{
      if(typeof item!=='string')throw new ValidationError('checklist items must be strings.');
      const trimmed=item.replace(/\r\n?/g,' ').trim();
      if(!trimmed||trimmed.length>200||CONTROL_CHAR_REGEX.test(trimmed))
        throw new ValidationError('checklist items must be plain text between 1 and 200 characters.');
      return trimmed;
    });
  }
  if(typeof body.reason!=='string')throw new ValidationError('reason is required.');
  const reason=body.reason.replace(/\r\n?/g,'\n').trim();
  if(!reason||reason.length>2000||CONTROL_CHAR_REGEX.test(reason))
    throw new ValidationError('reason must be plain text between 1 and 2000 characters.');
  const prefix=checklist.length?`[จุดที่ต้องแก้ไข: ${checklist.join(', ')}] `:'';
  const review_notes=(prefix+reason).slice(0,2000).trim();
  return {operation_id:body.operation_id,expected_version:body.expected_version,checklist,reason,review_notes};
}

class SelectionService {
  constructor({pool}={}){this.pool=pool||null;}
  db(){return this.pool||getPool();}
  async active(client,actor,role){
    const rows=(await client.query('SELECT role,account_status FROM users WHERE id=$1',[actor.userId])).rows;
    if(rows.length!==1 || rows[0].role!==role || rows[0].account_status!=='ACTIVE')throw new ForbiddenError('Access denied.');
  }
  async list(actor,filters={}){
    roleGuard(actor,['COORDINATOR','COMMITTEE']);
    const isCoordinator=actor.role==='COORDINATOR';
    v.fields(filters,isCoordinator?['department','program','state','search','page','pageSize']:['department','program','page','pageSize']);
    const department=filters.department===undefined?null:v.text(filters.department,'department',200);
    const program=filters.program===undefined?null:v.text(filters.program,'program',200);
    const stateFilter=isCoordinator&&filters.state!==undefined?v.text(filters.state,'state',64):null;
    if(stateFilter&&!ALLOWED_STATES.has(stateFilter))throw new ValidationError('Invalid state filter.');
    const searchFilter=isCoordinator&&filters.search!==undefined?v.text(filters.search,'search',200):null;
    const page=filters.page===undefined?1:Number(filters.page), pageSize=filters.pageSize===undefined?25:Number(filters.pageSize);
    if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new ValidationError('Invalid pagination.');
    const db=this.db();await this.active(db,actor,actor.role);
    const member=isCoordinator?'c.coordinator_id=$1':'$1 IN (c.committee_one,c.committee_two,c.committee_three)';
    const cohorts=(await db.query(`SELECT c.id,c.cycle_id,c.department,c.program,r.name AS cycle_name,r.status AS cycle_status
      FROM selection_cohorts c JOIN rounds r ON r.id=c.cycle_id WHERE c.status='ACTIVE' AND ${member}
      AND ($2::text IS NULL OR c.department=$2) AND ($3::text IS NULL OR c.program=$3)
      ORDER BY r.academic_year DESC,r.name,c.department,c.program`,[actor.userId,department,program])).rows;
    const rows=(await db.query(`SELECT p.id AS plan_id,p.version AS plan_version,p.status AS plan_status,
      p.project_title,p.notes AS plan_notes,p.document_references,p.created_at AS submitted_at,p.updated_at,
      co.name AS company_name,pos.title AS position_title,
      s.student_number,s.full_name,s.institutional_email,s.department,s.program,s.major,s.academic_year,
      s.contact_address,s.contact_phone,
      c.id AS cohort_id,c.cycle_id,r.name AS cycle_name,
      a.id AS receipt_id,a.acknowledged_at,
      (SELECT count(*)::int FROM selection_opinions o WHERE o.receipt_id=a.id) AS opinion_count,
      (SELECT ae.notes FROM audit_events ae WHERE ae.plan_id=p.id AND ae.to_state='NEEDS_REVISION' ORDER BY ae.created_at DESC LIMIT 1) AS revision_notes,
      (SELECT ae.created_at FROM audit_events ae WHERE ae.plan_id=p.id AND ae.to_state='NEEDS_REVISION' ORDER BY ae.created_at DESC LIMIT 1) AS returned_at,
      o.selected AS own_selected,o.comment AS own_comment,o.submitted_at AS own_submitted_at
      FROM selection_cohorts c JOIN rounds r ON r.id=c.cycle_id
      JOIN plans p ON p.cycle_id=c.cycle_id JOIN students s ON s.id=p.student_id
      LEFT JOIN companies co ON co.id=p.company_id
      LEFT JOIN positions pos ON pos.id=p.position_id
      LEFT JOIN selection_receipts a ON a.plan_id=p.id AND a.cohort_id=c.id
      LEFT JOIN selection_opinions o ON o.receipt_id=a.id AND o.committee_id=$1
      WHERE c.status='ACTIVE' AND ${member} AND s.department=c.department AND s.program=c.program
        AND NOT p.legacy_compatibility
        AND (($4::boolean AND p.status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_REVISION'))
             OR (NOT $4::boolean AND a.id IS NOT NULL AND p.status IN ('SUBMITTED','UNDER_REVIEW')))
        AND ($2::text IS NULL OR c.department=$2) AND ($3::text IS NULL OR c.program=$3)
      ORDER BY a.acknowledged_at NULLS FIRST,p.created_at,p.id LIMIT $5 OFFSET $6`,[actor.userId,department,program,isCoordinator,pageSize+1,(page-1)*pageSize])).rows;
    let mapped=rows.map(x=>{
      const computedState=stateFor(x.receipt_id,x.opinion_count,x.plan_status);
      return {
        plan_id:x.plan_id,plan_version:x.plan_version,
        student_number:x.student_number,full_name:x.full_name,department:x.department,program:x.program,
        cohort_id:x.cohort_id,cycle_id:x.cycle_id,cycle_name:x.cycle_name,
        state:computedState,opinion_count:x.opinion_count,required_opinions:3,
        acknowledged_at:x.acknowledged_at,grades_available:false,
        ...(isCoordinator?{
          plan_status:x.plan_status,
          major:x.major||x.program,
          academic_year:x.academic_year||null,
          institutional_email:x.institutional_email||null,
          contact_phone:x.contact_phone||null,
          contact_address:x.contact_address||null,
          company_name:x.company_name||null,
          position_title:x.position_title||null,
          project_title:x.project_title||null,
          plan_notes:x.plan_notes||null,
          document_references:Array.isArray(x.document_references)?x.document_references:[],
          submitted_at:x.submitted_at||null,
          updated_at:x.updated_at||null,
          revision_notes:x.revision_notes||null,
          returned_at:x.returned_at||null
        }:{}),
        ...(actor.role==='COMMITTEE'?{own_opinion:x.own_submitted_at?{selected:x.own_selected,comment:x.own_comment,submitted_at:x.own_submitted_at}:null}:{})
      };
    });
    if(stateFilter)mapped=mapped.filter(x=>x.state===stateFilter);
    if(searchFilter){
      const q=searchFilter.toLocaleLowerCase('th');
      mapped=mapped.filter(x=>`${x.student_number} ${x.full_name}`.toLocaleLowerCase('th').includes(q));
    }
    const applications=mapped.slice(0,pageSize);
    return {cohorts,applications,page,pageSize,has_more:rows.length>pageSize,grade_ranking_available:false,
      announcement_available:false,notice:'Three completed opinions are not an approval or a published selection result.'};
  }
  async studentStatus(actor,planId){
    roleGuard(actor,['STUDENT']);v.uuid(planId,'plan_id');const db=this.db();await this.active(db,actor,'STUDENT');
    const result=(await db.query(`SELECT p.id,p.status,a.id AS receipt_id,a.acknowledged_at,
      (SELECT count(*)::int FROM selection_opinions o WHERE o.receipt_id=a.id) AS opinion_count,
      (SELECT ae.notes FROM audit_events ae WHERE ae.plan_id=p.id AND ae.to_state='NEEDS_REVISION' ORDER BY ae.created_at DESC LIMIT 1) AS revision_notes
      FROM plans p JOIN students s ON s.id=p.student_id
      JOIN selection_cohorts c ON c.cycle_id=p.cycle_id AND c.department=s.department AND c.program=s.program AND c.status='ACTIVE'
      LEFT JOIN selection_receipts a ON a.plan_id=p.id AND a.cohort_id=c.id
      WHERE p.id=$1 AND s.user_id=$2`,[planId,actor.userId])).rows[0];
    if(!result)throw new ForbiddenError('Access denied.');
    const state=stateFor(result.receipt_id,result.opinion_count,result.status);
    return {plan_id:planId,state,
      acknowledged_at:result.acknowledged_at,opinion_count:result.opinion_count,required_opinions:3,announcement_available:false,
      ...(state==='NEEDS_REVISION'&&result.revision_notes?{revision_notes:result.revision_notes}:{})};
  }
  async studentList(actor){
    roleGuard(actor,['STUDENT']);const db=this.db();await this.active(db,actor,'STUDENT');
    const rows=(await db.query(`SELECT p.id,p.cycle_id,p.status,r.name AS cycle_name,a.id AS receipt_id,a.acknowledged_at,
      (SELECT count(*)::int FROM selection_opinions o WHERE o.receipt_id=a.id) AS opinion_count,
      (SELECT ae.notes FROM audit_events ae WHERE ae.plan_id=p.id AND ae.to_state='NEEDS_REVISION' ORDER BY ae.created_at DESC LIMIT 1) AS revision_notes
      FROM plans p JOIN students s ON s.id=p.student_id JOIN rounds r ON r.id=p.cycle_id
      JOIN selection_cohorts c ON c.cycle_id=p.cycle_id AND c.department=s.department AND c.program=s.program AND c.status='ACTIVE'
      LEFT JOIN selection_receipts a ON a.plan_id=p.id AND a.cohort_id=c.id
      WHERE s.user_id=$1 AND NOT p.legacy_compatibility AND p.status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_REVISION')
      ORDER BY p.created_at DESC,p.id LIMIT 100`,[actor.userId])).rows;
    return {applications:rows.map(x=>{
      const state=stateFor(x.receipt_id,x.opinion_count,x.status);
      return {plan_id:x.id,cycle_id:x.cycle_id,cycle_name:x.cycle_name,state,
        acknowledged_at:x.acknowledged_at,opinion_count:x.opinion_count,required_opinions:3,announcement_available:false,
        ...(state==='NEEDS_REVISION'&&x.revision_notes?{revision_notes:x.revision_notes}:{})};
    })};
  }
  async mutate(actor,planId,input,opinion=false){
    const role=opinion?'COMMITTEE':'COORDINATOR';roleGuard(actor,[role]);v.uuid(planId,'plan_id');const body=command(input,opinion);
    const client=await this.db().connect();
    try{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['coed-selection:'+planId]);
      await this.active(client,actor,role);
      const member=opinion?'$2 IN (c.committee_one,c.committee_two,c.committee_three)':'c.coordinator_id=$2';
      const row=(await client.query(`SELECT p.id,p.version,p.status,r.status AS cycle_status,c.id AS cohort_id,
        a.id AS receipt_id,a.plan_version AS received_version
        FROM plans p JOIN students s ON s.id=p.student_id JOIN rounds r ON r.id=p.cycle_id
        JOIN selection_cohorts c ON c.cycle_id=p.cycle_id AND c.department=s.department AND c.program=s.program
        LEFT JOIN selection_receipts a ON a.plan_id=p.id AND a.cohort_id=c.id
        WHERE p.id=$1 AND c.status='ACTIVE' AND NOT p.legacy_compatibility AND ${member}`,[planId,actor.userId])).rows[0];
      if(!row)throw new ForbiddenError('Access denied.');
      const requestHash=createHash('sha256').update(JSON.stringify([opinion?'opinion':'acknowledge',actor.userId,planId,
        body.operation_id,body.expected_version,...(opinion?[body.selected,body.comment]:[])])).digest('hex');
      const table=opinion?'selection_opinions':'selection_receipts';
      const prior=(await client.query(`SELECT request_hash FROM ${table} WHERE id=$1`,[body.operation_id])).rows[0];
      if(prior){
        if(prior.request_hash!==requestHash)throw new ConflictError('Operation id already used.');
        const count=Number((await client.query('SELECT count(*)::int AS n FROM selection_opinions WHERE receipt_id=$1',[row.receipt_id])).rows[0].n);
        await client.query('COMMIT');return {plan_id:planId,state:stateFor(row.receipt_id,count),opinion_count:count,required_opinions:3,replayed:true};
      }
      if(row.cycle_status!=='OPEN')throw new InvalidStateTransitionError('Application cycle is closed.');
      if(row.version!==body.expected_version)throw new ConflictError('Application changed; refresh before continuing.');
      if(opinion){
        if(!row.receipt_id || !['SUBMITTED','UNDER_REVIEW'].includes(row.status) || row.version!==row.received_version)
          throw new InvalidStateTransitionError('The unchanged application must first be received by its Coordinator.');
        if((await client.query('SELECT 1 FROM selection_opinions WHERE receipt_id=$1 AND committee_id=$2',[row.receipt_id,actor.userId])).rowCount)
          throw new ConflictError('Your opinion was already submitted.');
        await client.query('INSERT INTO selection_opinions(id,receipt_id,committee_id,selected,comment,request_hash) VALUES($1,$2,$3,$4,$5,$6)',
          [body.operation_id,row.receipt_id,actor.userId,body.selected,body.comment,requestHash]);
      }else{
        if(row.receipt_id)throw new ConflictError('This application was already received.');
        if(row.status!=='SUBMITTED')throw new InvalidStateTransitionError('Only submitted applications can be received.');
        await client.query('INSERT INTO selection_receipts(id,plan_id,cohort_id,acknowledged_by,plan_version,request_hash) VALUES($1,$2,$3,$4,$5,$6)',
          [body.operation_id,planId,row.cohort_id,actor.userId,row.version,requestHash]);
        row.receipt_id=body.operation_id;
      }
      await client.query(`INSERT INTO audit_events(event_id,plan_id,actor_id,actor_role,action,resource_type,resource_id,notes,correlation_id)
        VALUES($1,$2,$3,$4,$5,'PLAN',$2,$6,$1)`,[body.operation_id,planId,actor.userId,role,
          opinion?'COMMITTEE_OPINION_SUBMITTED':'COORDINATOR_ACKNOWLEDGED',opinion?'Individual opinion recorded; no admission decision or result published.':'Application received for three independent committee opinions.']);
      const count=Number((await client.query('SELECT count(*)::int AS n FROM selection_opinions WHERE receipt_id=$1',[row.receipt_id])).rows[0].n);
      await client.query('COMMIT');return {plan_id:planId,state:stateFor(row.receipt_id,count),opinion_count:count,required_opinions:3,replayed:false};
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      if(error.code==='23505')throw new ConflictError('This operation was already recorded.');
      if(error.code==='23514')throw new InvalidStateTransitionError('The application or its three-member panel changed; refresh before continuing.');
      throw error;
    }
    finally{client.release();}
  }
  async returnForRevision(actor,planId,input){
    roleGuard(actor,['COORDINATOR']);v.uuid(planId,'plan_id');const body=returnCommand(input);
    const client=await this.db().connect();
    try{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['coed-selection:'+planId]);
      await this.active(client,actor,'COORDINATOR');
      const row=(await client.query(`SELECT p.id,p.version,p.status,r.status AS cycle_status,c.id AS cohort_id,
        a.id AS receipt_id
        FROM plans p JOIN students s ON s.id=p.student_id JOIN rounds r ON r.id=p.cycle_id
        JOIN selection_cohorts c ON c.cycle_id=p.cycle_id AND c.department=s.department AND c.program=s.program
        LEFT JOIN selection_receipts a ON a.plan_id=p.id AND a.cohort_id=c.id
        WHERE p.id=$1 AND c.status='ACTIVE' AND NOT p.legacy_compatibility AND c.coordinator_id=$2 FOR UPDATE OF p`,[planId,actor.userId])).rows[0];
      if(!row)throw new ForbiddenError('Access denied.');
      const requestHash=createHash('sha256').update(JSON.stringify([
        'coordinator_return',actor.userId,planId,body.operation_id,body.expected_version,body.checklist,body.reason
      ])).digest('hex');
      const prior=(await client.query('SELECT request_hash,result FROM workflow_receipts WHERE operation_id=$1',[body.operation_id])).rows[0];
      if(prior){
        if(prior.request_hash!==requestHash)throw new ConflictError('Operation id already used.');
        await client.query('COMMIT');return {...prior.result,replayed:true};
      }
      if(row.cycle_status!=='OPEN')throw new InvalidStateTransitionError('Application cycle is closed.');
      if(row.version!==body.expected_version)throw new ConflictError('Application changed; refresh before continuing.');
      if(row.receipt_id)throw new ConflictError('This application was already received and forwarded to Committee.');
      if(row.status!=='SUBMITTED')throw new InvalidStateTransitionError('Only submitted applications awaiting Coordinator review can be returned for revision.');
      const updated=(await client.query(
        "UPDATE plans SET status='NEEDS_REVISION',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING version",
        [planId]
      )).rows[0];
      const result={
        plan_id:planId,plan_version:updated.version,state:'NEEDS_REVISION',
        checklist:body.checklist,reason:body.reason,review_notes:body.review_notes,
        opinion_count:0,required_opinions:3
      };
      await client.query(
        'INSERT INTO workflow_receipts(operation_id,actor_id,action,resource_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',
        [body.operation_id,actor.userId,'COORDINATOR_RETURNED_FOR_REVISION',planId,requestHash,JSON.stringify(result)]
      );
      await client.query(
        `INSERT INTO audit_events(event_id,plan_id,actor_id,actor_role,action,resource_type,resource_id,from_state,to_state,notes,correlation_id)
         VALUES($1,$2,$3,'COORDINATOR','COORDINATOR_RETURNED_FOR_REVISION','PLAN',$2,'SUBMITTED','NEEDS_REVISION',$4,$1)`,
        [body.operation_id,planId,actor.userId,body.review_notes]
      );
      await client.query('COMMIT');
      return {...result,replayed:false};
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      if(error.code==='23505')throw new ConflictError('This operation was already recorded.');
      if(error.code==='23514')throw new InvalidStateTransitionError('The application cannot be returned in its current state.');
      throw error;
    }
    finally{client.release();}
  }
}
module.exports={SelectionService,stateFor,roleGuard,command,returnCommand};
