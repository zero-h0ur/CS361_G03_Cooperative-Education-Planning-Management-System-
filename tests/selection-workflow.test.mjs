import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Pool}=require('pg');
const {SelectionService,stateFor,command,returnCommand}=require('../src/api/services/selection-service');
const {ACTIONS,getPermissionScope,getRoleCapabilities}=require('../src/api/services/authorization-service');
const {IdentityResolver}=require('../src/auth/identity-resolver');
const {StudentPlanRepository}=require('../src/db/repositories/student-plan-repository');
const change=()=>({operation_id:randomUUID(),expected_version:1});

test('new roles are distinct policies, never Staff or Advisor aliases',()=>{
  for(const [role,allowed,other] of [
    ['COORDINATOR',[ACTIONS.COORDINATOR_SELECTION_READ,ACTIONS.COORDINATOR_ACKNOWLEDGE],ACTIONS.COMMITTEE_OPINION_CREATE],
    ['COMMITTEE',[ACTIONS.COMMITTEE_SELECTION_READ,ACTIONS.COMMITTEE_OPINION_CREATE],ACTIONS.COORDINATOR_ACKNOWLEDGE]
  ]){
    for(const a of allowed)assert.equal(getPermissionScope(role,a),'AUTHENTICATED');
    assert.equal(getPermissionScope(role,ACTIONS.SESSION_READ_ME),'AUTHENTICATED');
    for(const a of [other,ACTIONS.PLAN_APPROVE,ACTIONS.PLAN_REJECT,ACTIONS.WORKFLOW_STAFF_WRITE,ACTIONS.USER_CHANGE_ROLE,ACTIONS.STUDENT_READ_PROFILE,ACTIONS.ASSIGNMENT_MANAGE])
      assert.equal(getPermissionScope(role,a),'DENY');
    assert.equal(getRoleCapabilities(role).canReviewPlan,false);
  }
  for(const r of ['STUDENT','STAFF','ADVISOR','ADMIN','SYSTEM','PUBLIC','unknown']){
    assert.equal(getPermissionScope(r,ACTIONS.COORDINATOR_ACKNOWLEDGE),'DENY');
    assert.equal(getPermissionScope(r,ACTIONS.COMMITTEE_OPINION_CREATE),'DENY');
  }
});

test('three opinions mean pending announcement, never automatic approval or unanimity',()=>{
  assert.equal(stateFor(null,0),'AWAITING_COORDINATOR');
  assert.equal(stateFor(null,0,'NEEDS_REVISION'),'NEEDS_REVISION');
  for(const n of [0,1,2])assert.equal(stateFor('receipt',n),'UNDER_COMMITTEE_REVIEW');
  assert.equal(stateFor('receipt',3),'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT');
  assert.throws(()=>command({...change(),selected:'true',comment:'x'},true),e=>e.statusCode===400);
  assert.throws(()=>command({...change(),selected:true,comment:'x',committee_id:randomUUID()},true),e=>e.statusCode===400);
  assert.throws(()=>command({...change(),selected:true,comment:' '},true),e=>e.statusCode===400);
  assert.throws(()=>command({...change(),selected:true,comment:'x'.repeat(2001)},true),e=>e.statusCode===400);
  assert.equal(command({...change(),selected:true,comment:'Line one\r\nLine two'},true).comment,'Line one\nLine two');
  assert.throws(()=>command({...change(),selected:true,comment:'x\u0000y'},true),e=>e.statusCode===400);
});

test('returnCommand validates checklist and reason and formats review_notes safely',()=>{
  const valid=returnCommand({...change(),checklist:['ขาดลายเซ็นอาจารย์ที่ปรึกษา','ไฟล์ไม่ชัดเจน'],reason:'กรุณาแนบไฟล์ใหม่\r\nหน้า 2'});
  assert.deepEqual(valid.checklist,['ขาดลายเซ็นอาจารย์ที่ปรึกษา','ไฟล์ไม่ชัดเจน']);
  assert.equal(valid.reason,'กรุณาแนบไฟล์ใหม่\nหน้า 2');
  assert.ok(valid.review_notes.includes('[จุดที่ต้องแก้ไข: ขาดลายเซ็นอาจารย์ที่ปรึกษา, ไฟล์ไม่ชัดเจน]'));
  assert.ok(valid.review_notes.includes('กรุณาแนบไฟล์ใหม่\nหน้า 2'));

  assert.throws(()=>returnCommand({...change(),reason:' '}),e=>e.statusCode===400);
  assert.throws(()=>returnCommand({...change(),reason:'x'.repeat(2001)}),e=>e.statusCode===400);
  assert.throws(()=>returnCommand({...change(),reason:'bad\u0000char'}),e=>e.statusCode===400);
  assert.throws(()=>returnCommand({...change(),reason:'ok',checklist:'not-array'}),e=>e.statusCode===400);
  assert.throws(()=>returnCommand({...change(),reason:'ok',extra:'forbidden'}),e=>e.statusCode===400);
});

test('SelectionService.returnForRevision enforces Coordinator role, state, version, idempotency and audit trail',async()=>{
  const coordinatorId=randomUUID(),planId=randomUUID(),cohortId=randomUUID(),opId=randomUUID();
  let planStatus='SUBMITTED',planVersion=1,receiptRow=null,acknowledged=null;
  const audits=[];
  const client={
    query:async(sql,params=[])=>{
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]};
      if(sql.includes('FROM users WHERE id=$1'))return {rows:[{role:'COORDINATOR',account_status:'ACTIVE'}]};
      if(sql.includes('FROM workflow_receipts'))return {rows:receiptRow&&params[0]===receiptRow.operation_id?[receiptRow]:[]};
      if(sql.includes('FROM plans p'))return {rows:[{
        id:planId,status:planStatus,version:planVersion,cycle_status:'OPEN',cohort_id:cohortId,
        receipt_id:acknowledged
      }]};
      if(sql.includes("UPDATE plans SET status='NEEDS_REVISION'")){
        planStatus='NEEDS_REVISION';planVersion+=1;return {rows:[{version:planVersion}]};
      }
      if(sql.includes('INSERT INTO workflow_receipts')){
        receiptRow={operation_id:params[0],request_hash:params[4],result:JSON.parse(params[5])};
        return {rows:[]};
      }
      if(sql.includes('INSERT INTO audit_events')){
        audits.push({plan_id:params[1],actor_id:params[2],notes:params[3]});
        return {rows:[]};
      }
      return {rows:[]};
    },
    release:()=>{}
  };
  const service=new SelectionService({pool:{connect:async()=>client}});
  const coord={isAuthenticated:true,userId:coordinatorId,role:'COORDINATOR',accountStatus:'ACTIVE'};
  const payload={operation_id:opId,expected_version:1,checklist:['ขาดลายเซ็นอาจารย์ที่ปรึกษา'],reason:'กรุณาให้อาจารย์ที่ปรึกษาเซ็นรับรอง'};

  // Non-coordinator roles are rejected
  await assert.rejects(service.returnForRevision({...coord,role:'COMMITTEE'},planId,payload),e=>e.statusCode===403);
  await assert.rejects(service.returnForRevision({...coord,role:'STAFF'},planId,payload),e=>e.statusCode===403);

  // Version mismatch -> 409 Conflict
  await assert.rejects(service.returnForRevision(coord,planId,{...payload,expected_version:9}),e=>e.statusCode===409);

  // First return succeeds -> transitions to NEEDS_REVISION and records audit event
  const res=await service.returnForRevision(coord,planId,payload);
  assert.equal(res.state,'NEEDS_REVISION');
  assert.equal(res.plan_version,2);
  assert.equal(planStatus,'NEEDS_REVISION');
  assert.equal(audits.length,1);
  assert.ok(audits[0].notes.includes('ขาดลายเซ็นอาจารย์ที่ปรึกษา'));

  // Idempotent replay with identical operation_id and payload
  const replay=await service.returnForRevision(coord,planId,payload);
  assert.equal(replay.replayed,true);
  assert.equal(replay.state,'NEEDS_REVISION');

  // Replay with different payload under same operation_id -> 409 Conflict
  await assert.rejects(service.returnForRevision(coord,planId,{...payload,reason:'เปลี่ยนเหตุผลใหม่'}),e=>e.statusCode===409);

  // New operation_id while already in NEEDS_REVISION -> 422 InvalidStateTransition
  await assert.rejects(service.returnForRevision(coord,planId,{...payload,operation_id:randomUUID(),expected_version:2}),e=>e.statusCode===422);

  // Student resubmits (planStatus becomes SUBMITTED, version=3), then Coordinator acknowledges -> cannot return after acknowledge
  planStatus='SUBMITTED';planVersion=3;acknowledged=randomUUID();
  await assert.rejects(service.returnForRevision(coord,planId,{...payload,operation_id:randomUUID(),expected_version:3}),e=>e.statusCode===409);
});

test('trusted identity resolution accepts the two new database roles without a Student profile',async()=>{
  for(const role of ['COORDINATOR','COMMITTEE']){
    const id=randomUUID();
    const pool={query:async()=>({rows:[{user_id:id,role,account_status:'ACTIVE',link_status:'ACTIVE',active_link_count:1,student_id:null}]})};
    assert.equal((await new IdentityResolver({pool}).resolveIdentity('https://issuer.example','subject')).role,role);
  }
});

test('Coordinator and three independent Committee opinions on isolated PostgreSQL',
 {skip:!process.env.CO_ED_SELECTION_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.CO_ED_SELECTION_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/coed_selection_test');
  const admin=new Pool({connectionString:url.href}),schema='sel_'+randomUUID().replaceAll('-','');
  const runtime='sel_role_'+randomUUID().replaceAll('-','');let pool;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const c=await admin.connect();
    try{
      await c.query(`SET search_path TO "${schema}",public`);
      await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum char(64))');
      for(const file of (await readdir(new URL('../src/db/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()){
        const sql=await readFile(new URL('../src/db/migrations/'+file,import.meta.url),'utf8');
        await c.query(sql);await c.query('INSERT INTO schema_migrations VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);
      }
    }finally{await c.query('RESET search_path');c.release();}
    pool=new Pool({connectionString:url.href,options:`-c search_path=${schema},public`,max:8});
    const q=(sql,params=[])=>pool.query(sql,params);
    const student=randomUUID(),otherStudent=randomUUID(),coordinator=randomUUID(),outsider=randomUUID(),staff=randomUUID();
    const reviewers=Array.from({length:4},()=>randomUUID()),cycle=randomUUID(),profile=randomUUID(),otherProfile=randomUUID(),plan=randomUUID(),cohort=randomUUID();
    for(const [id,role] of [[student,'STUDENT'],[otherStudent,'STUDENT'],[coordinator,'COORDINATOR'],[outsider,'COORDINATOR'],[staff,'STAFF'],...reviewers.map(id=>[id,'COMMITTEE'])])
      await q('INSERT INTO users(id,role) VALUES($1,$2)',[id,role]);
    await q("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Selection test only',2569,1,'OPEN','synthetic test','private','mock')",[cycle]);
    for(const [id,user,number] of [[profile,student,'TEST361001'],[otherProfile,otherStudent,'TEST361002']])
      await q(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
        VALUES($1,$2,$3,$3,'Synthetic Student','non-delivery@example.invalid','CPE','CS','CS',2569,'ACTIVE','synthetic test','private','mock')`,[id,user,number]);
    const company=randomUUID(),position=randomUUID();
    await q("INSERT INTO companies(id,name,source,visibility,data_status) VALUES($1,'Synthetic company','synthetic test','public','mock')",[company]);
    await q("INSERT INTO positions(id,company_id,title,source,visibility,data_status) VALUES($1,$2,'Synthetic position','synthetic test','public','mock')",[position,company]);
    await q(`INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,status,version,project_title,source,visibility,data_status)
      VALUES($1,$2,$3,$4,$5,'SUBMITTED',1,'Synthetic test only','synthetic test','private','mock')`,[plan,profile,cycle,company,position]);
    await q(`INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three)
      VALUES($1,$2,'CPE','CS',$3,$4,$5,$6)`,[cohort,cycle,coordinator,...reviewers.slice(0,3)]);
    const actor=(id,role)=>({isAuthenticated:true,userId:id,role,accountStatus:'ACTIVE'});
    const coord=actor(coordinator,'COORDINATOR'),members=reviewers.map(id=>actor(id,'COMMITTEE'));
    const service=new SelectionService({pool});
    const planBefore=(await q('SELECT row_to_json(p) AS value FROM plans p WHERE id=$1',[plan])).rows[0].value;
    let ack;
    await t.test('Student cycle options include their private cohort without exposing other private cycles',async()=>{
      const repository=new StudentPlanRepository({pool}),unassigned=randomUUID(),publicCycle=randomUUID();
      await q(`INSERT INTO rounds(id,name,academic_year,status,source,visibility,data_status) VALUES
        ($1,'Unassigned private cycle',2569,'OPEN','synthetic test','private','mock'),
        ($2,'Public cycle',2569,'OPEN','synthetic test','public','mock')`,[unassigned,publicCycle]);
      const options=()=>repository.listCycleOptions({userId:student,studentId:profile});
      const ids=(await options()).map(x=>x.id);
      assert.ok(ids.includes(cycle));assert.ok(ids.includes(publicCycle));assert.ok(!ids.includes(unassigned));
      assert.deepEqual(await repository.listCycleOptions({userId:otherStudent,studentId:profile}),[]);
      await q("UPDATE students SET department='OTHER' WHERE id=$1",[profile]);
      assert.deepEqual((await options()).map(x=>x.id),[publicCycle]);
      await q("UPDATE students SET department='CPE' WHERE id=$1",[profile]);
      await q("UPDATE selection_cohorts SET status='INACTIVE' WHERE id=$1",[cohort]);
      assert.deepEqual((await options()).map(x=>x.id),[publicCycle]);
      await q("UPDATE selection_cohorts SET status='ACTIVE' WHERE id=$1",[cohort]);
      await q("UPDATE users SET account_status='DISABLED' WHERE id=$1",[student]);
      assert.deepEqual(await options(),[]);
      await q("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[student]);
    });
    await t.test('only scoped Coordinator sees pending applications; Committee cannot see them before receipt',async()=>{
      assert.equal((await service.list(coord)).applications.length,1);
      assert.equal((await service.list(members[0])).applications.length,0);
      assert.equal((await service.list(actor(outsider,'COORDINATOR'))).applications.length,0);
      assert.equal((await service.list(coord,{department:'OTHER'})).applications.length,0);
      await assert.rejects(service.mutate(actor(outsider,'COORDINATOR'),plan,change()),e=>e.statusCode===403);
      await assert.rejects(service.mutate(actor(staff,'STAFF'),plan,change()),e=>e.statusCode===403);
      await assert.rejects(service.mutate(members[0],plan,{...change(),selected:true,comment:'Test'},true),e=>e.statusCode===422);
      await assert.rejects(service.list(coord,{page:'0'}),e=>e.statusCode===400);
    });
    await t.test('receipt is audited, idempotent and does not approve or modify the Plan',async()=>{
      ack=change();const first=await service.mutate(coord,plan,ack);
      assert.equal(first.state,'UNDER_COMMITTEE_REVIEW');assert.equal(first.opinion_count,0);
      assert.equal((await service.mutate(coord,plan,{expected_version:1,operation_id:ack.operation_id})).replayed,true);
      await assert.rejects(service.mutate(coord,plan,change()),e=>e.statusCode===409);
      assert.equal((await service.list(members[0])).applications.length,1);
      assert.deepEqual((await q('SELECT row_to_json(p) AS value FROM plans p WHERE id=$1',[plan])).rows[0].value,planBefore);
    });
    await t.test('one opinion per panel member, three distinct opinions including a negative choice complete review only',async()=>{
      const first={...change(),selected:false,comment:'Synthetic independent opinion one'};
      assert.equal((await service.mutate(members[0],plan,first,true)).opinion_count,1);
      assert.equal((await service.mutate(members[0],plan,first,true)).replayed,true);
      await assert.rejects(service.mutate(members[0],plan,{...change(),selected:true,comment:'Second vote'},true),e=>e.statusCode===409);
      await assert.rejects(service.mutate(members[3],plan,{...change(),selected:true,comment:'Not on panel'},true),e=>e.statusCode===403);
      const rows=await Promise.all(members.slice(1,3).map((a,i)=>service.mutate(a,plan,{...change(),selected:true,comment:'Synthetic independent opinion '+(i+2)},true)));
      assert.deepEqual(rows.map(x=>x.opinion_count).sort(),[2,3]);
      assert.ok(rows.some(x=>x.state==='SELECTION_COMPLETE_PENDING_ANNOUNCEMENT'));
      const studentView=await service.studentStatus(actor(student,'STUDENT'),plan);
      assert.equal(studentView.opinion_count,3);assert.equal(studentView.announcement_available,false);
      assert.equal(Object.hasOwn(studentView,'selected'),false);assert.equal(Object.hasOwn(studentView,'comment'),false);
      await assert.rejects(service.studentStatus(actor(otherStudent,'STUDENT'),plan),e=>e.statusCode===403);
      for(const [i,a] of members.slice(0,3).entries()){
        const row=(await service.list(a)).applications[0];assert.equal(row.opinion_count,3);
        assert.equal(row.own_opinion.selected,i!==0);assert.equal(Object.hasOwn(row,'opinions'),false);
        assert.ok(!JSON.stringify(row).includes('Synthetic independent opinion '+((i+1)%3+1)));
      }
      assert.equal((await q('SELECT count(*)::int AS n FROM audit_events')).rows[0].n,4);
      assert.deepEqual((await q('SELECT row_to_json(p) AS value FROM plans p WHERE id=$1',[plan])).rows[0].value,planBefore);
    });
    await t.test('revocation is rechecked even for a replayed operation',async()=>{
      await q("UPDATE users SET account_status='DISABLED' WHERE id=$1",[coordinator]);
      await assert.rejects(service.mutate(coord,plan,ack),e=>e.statusCode===403);
      await q("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[coordinator]);
      await q("UPDATE selection_cohorts SET status='INACTIVE' WHERE id=$1",[cohort]);
      assert.equal((await service.list(members[0])).applications.length,0);
      await assert.rejects(service.mutate(coord,plan,ack),e=>e.statusCode===403);
      await q("UPDATE selection_cohorts SET status='ACTIVE' WHERE id=$1",[cohort]);
    });
    await t.test('runtime cannot change panel membership, identity roles or overwrite immutable opinions',async()=>{
      await admin.query(`CREATE ROLE "${runtime}" NOLOGIN`);
      let policy=await readFile(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8');
      policy=policy.replace(/^\\set[^\n]*\n/m,'').replaceAll('public.',`"${schema}".`).replaceAll('SCHEMA public',`SCHEMA "${schema}"`).replaceAll('coed_app',runtime);
      await q(policy);
      const client=await pool.connect();
      try{
        for(const sql of ["UPDATE users SET role='ADMIN' WHERE false",'DELETE FROM selection_opinions WHERE false',
          'UPDATE selection_opinions SET selected=true WHERE false','INSERT INTO selection_cohorts SELECT * FROM selection_cohorts WHERE false']){
          await client.query('BEGIN');await client.query(`SET LOCAL ROLE "${runtime}"`);
          await assert.rejects(client.query(sql),e=>e.code==='42501');await client.query('ROLLBACK');
        }
      }finally{client.release();}
      await assert.rejects(q('UPDATE selection_opinions SET selected=NOT selected'),e=>e.code==='55000');
      assert.equal((await q('SELECT count(*)::int AS n FROM selection_opinions')).rows[0].n,3);
      const limited=new Pool({connectionString:url.href,options:`-c role=${runtime} -c search_path=${schema},public`,max:3});
      try{
        const limitedService=new SelectionService({pool:limited}),secondPlan=randomUUID();
        await q(`INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,status,version,project_title,source,visibility,data_status)
          VALUES($1,$2,$3,$4,$5,'SUBMITTED',1,'Second synthetic test','synthetic test','private','mock')`,[secondPlan,otherProfile,cycle,company,position]);
        assert.equal((await limitedService.mutate(coord,secondPlan,change())).state,'UNDER_COMMITTEE_REVIEW');
        for(const member of members.slice(0,3))await limitedService.mutate(member,secondPlan,{...change(),selected:true,comment:'Runtime privilege test only'},true);
        assert.equal((await limitedService.studentStatus(actor(otherStudent,'STUDENT'),secondPlan)).opinion_count,3);
        assert.equal((await limitedService.list(members[0])).applications.length,2);
      }finally{await limited.end();}
    });
  }finally{
    if(pool)await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const exists=(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[runtime])).rowCount;
    if(exists)await admin.query(`DROP ROLE "${runtime}"`);
    await admin.end();
  }
});
