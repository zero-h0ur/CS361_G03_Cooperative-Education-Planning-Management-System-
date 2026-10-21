import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { ThreeRoleService } = require('../src/api/services/three-role-service');
const { WorkflowService } = require('../src/api/services/workflow-service');
const { WorkflowRepository } = require('../src/db/repositories/workflow-repository');
const { AuthorizationService } = require('../src/api/services/authorization-service');
const v = require('../src/api/services/workflow-input');
const command = version => ({expected_version:version,operation_id:randomUUID()});
function operatorFunction(name, expression, payload) {
  const source=`import importlib.util,json,sys\ns=importlib.util.spec_from_file_location("ops", "scripts/operations/${name}.py")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nv=json.load(sys.stdin)\nprint(${expression})`;
  const result=spawnSync('python3',['-c',source],{input:JSON.stringify(payload),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
}

test('external references reject unsafe URLs, duplicate types and executable policy expressions', () => {
  for (const url of ['javascript:alert(1)','http://example.invalid','https://user:pass@example.invalid']) assert.throws(() => v.https(url));
  assert.equal(v.https('https://example.invalid/document'), 'https://example.invalid/document');
  assert.throws(() => v.references([{requirement_id:'x',filename:'a.pdf',format:'pdf',reference:'x'},{requirement_id:'x',filename:'a.pdf',format:'pdf',reference:'y'}]));
  assert.throws(() => v.requirements([{id:'x',title:'x',required:true,regex:'(a+)+'}]));
});

test('company matching ignores case and whitespace without merging distinct company names', () => {
  assert.equal(v.companyNameKey('  Actual   COMPANY  '),v.companyNameKey('actualcompany'));
  assert.equal(v.companyNameKey('บริษัท\u00a0ตัวอย่าง จำกัด'),v.companyNameKey('บริษัทตัวอย่างจำกัด'));
  assert.notEqual(v.companyNameKey('Example Bank'),v.companyNameKey('Example Bank Technology'));
});

test('three-role workflow on isolated PostgreSQL schema', {skip:!process.env.CO_ED_WORKFLOW_TEST_DATABASE_URL}, async t => {
  const url = new URL(process.env.CO_ED_WORKFLOW_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Use an explicitly disposable local test server.');
  const admin=new Pool({connectionString:url.href}), schema=`wf_${randomUUID().replaceAll('-','')}`;
  let pool;
  const legacyStudent=randomUUID(),legacyPlan=randomUUID();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const c=await admin.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum CHAR(64))');
      const files=(await readdir(new URL('../src/db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
      for (const [i,file] of files.entries()) {
        if (i===1) await c.query(`SET search_path TO "${schema}",public`);
        const sql=await readFile(new URL(`../src/db/migrations/${file}`,import.meta.url),'utf8');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);
        if(i===0) {
          await c.query(`INSERT INTO students(id,anonymous_ref,source,visibility,data_status) VALUES($1,'LEGACY-PRESERVE','test','private','mock')`,[legacyStudent]);
          await c.query(`INSERT INTO plans(id,student_id,source,visibility,data_status) VALUES($1,$2,'test','private','mock')`,[legacyPlan,legacyStudent]);
        }
      }
    } finally { await c.query('RESET search_path'); c.release(); }
    pool=new Pool({connectionString:url.href,options:`-c search_path=${schema},public`,max:12});
    const q=(sql,params=[])=>pool.query(sql,params);
    const staffId=randomUUID(),advisorId=randomUUID(),advisor2=randomUUID(),cycle=randomUUID(),company=randomUUID(),position=randomUUID();
    await q(`INSERT INTO users(id,role,display_name) VALUES ($1,'STAFF','Test Staff'),($2,'ADVISOR','Test Advisor'),($3,'ADVISOR','Test Advisor 2')`,[staffId,advisorId,advisor2]);
    await q(`INSERT INTO staff_scopes(id,staff_id,department,academic_year) VALUES($1,$2,'CPE',2569)`,[randomUUID(),staffId]);
    await q(`INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic cycle',2569,1,'OPEN','test','public','mock')`,[cycle]);
    await q(`INSERT INTO companies(id,name,source,visibility,data_status) VALUES($1,'Synthetic Company','test','public','mock')`,[company]);
    await q(`INSERT INTO positions(id,company_id,title,source,visibility,data_status) VALUES($1,$2,'Developer','test','public','mock')`,[position,company]);
    const staff={isAuthenticated:true,userId:staffId,role:'STAFF',accountStatus:'ACTIVE'};
    const advisor={...staff,userId:advisorId,role:'ADVISOR'};
    const service=new ThreeRoleService({pool});
    const workflow=new WorkflowService({repository:new WorkflowRepository({pool}),authorizationService:new AuthorizationService({pool})});
    const people=[];
    const adminId=randomUUID();
    await q("INSERT INTO users(id,role) VALUES($1,'ADMIN')",[adminId]);
    const adminActor={...staff,userId:adminId,role:'ADMIN'};
    await t.test('Admin reads account/master-data metadata but cannot act as Student or Staff',async()=>{
      const {AdminOperationsService}=require('../src/api/services/admin-operations-service');
      const adminService=new AdminOperationsService({pool});
      const result=await adminService.read(adminActor);
      assert.ok(result.accounts.some(row=>row.role==='ADMIN'));
      assert.equal(result.student_workflow_access,false);
      assert.equal(result.migrations.length,8);
      assert.ok(result.accounts.every(row=>Object.keys(row).sort().join(',')==='account_status,id,role,version'));
      for(const actor of [staff,advisor])await assert.rejects(adminService.read(actor),e=>e.statusCode===403);
      await assert.rejects(service.dashboard(adminActor),e=>e.statusCode===403);
      await assert.rejects(service.publish(adminActor,{}),e=>e.statusCode===403);
      await assert.rejects(service.assign(adminActor,{}),e=>e.statusCode===403);
    });
    await t.test('forward-only migrations retain legacy rows without inventing official data or project titles',async()=>{
      const row=(await q('SELECT legacy_compatibility,status,project_title FROM plans WHERE id=$1',[legacyPlan])).rows[0];
      assert.deepEqual(row,{legacy_compatibility:true,status:'DRAFT',project_title:null});
    });
    for(let i=0;i<8;i++) {
      const user=randomUUID(),student=randomUUID(),plan=randomUUID();
      await q(`INSERT INTO users(id,role) VALUES($1,'STUDENT')`,[user]);
      await q(`INSERT INTO students(id,anonymous_ref,source,visibility,data_status,user_id,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status)
        VALUES($1,$2,'test','private','mock',$3,$4,'Synthetic Student','test@example.invalid','CPE','CS','CS',2569,'ACTIVE')`,[student,student,user,`660900000${i}`]);
      await q(`INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,source,visibility,data_status,status)
        VALUES($1,$2,$3,$4,$5,'test','private','mock','DRAFT')`,[plan,student,cycle,company,position]);
      people.push({plan,student,actor:{...staff,userId:user,studentId:student,role:'STUDENT'}});
    }
    let policy;
    await t.test('Staff publishes scoped requirements; stale versions and wrong roles fail',async()=>{
      policy=await service.publish(staff,{...command(0),cycle_id:cycle,department:'CPE',program:'',requirements:[{id:'eligibility',title:'Eligibility evidence',required:true,format:'pdf',filename_pattern:'{student_number}.pdf'}]});
      await assert.rejects(service.publish(advisor,{...command(0),cycle_id:cycle}),e=>e.statusCode===403);
      await assert.rejects(service.publish(staff,{...command(0),cycle_id:cycle,department:'CPE',program:'',requirements:[]}),e=>e.statusCode===409);
    });
    await t.test('Student contact fields are mutable but TU identity and other Students remain protected',async()=>{
      const a=people[0].actor;
      const updated=await service.saveContact(a,{contact_address:'123 Synthetic Road',contact_phone:'+66 81 000 0000',version:1,operation_id:randomUUID()});
      assert.equal(updated.contact_phone,'+66 81 000 0000');
      await assert.rejects(service.saveContact(a,{contact_address:'Stale value',version:1,operation_id:randomUUID()}),e=>e.statusCode===409);
      await assert.rejects(service.saveContact(a,{contact_address:'No operation ID',version:2}),e=>e.statusCode===400);
      await assert.rejects(service.saveContact(a,{contact_address:'No version',operation_id:randomUUID()}),e=>e.statusCode===400);
      await assert.rejects(service.saveContact(a,{full_name:'Spoof',version:2,operation_id:randomUUID()}),e=>e.statusCode===400);
      await assert.rejects(service.getWorkflow(people[1].actor,people[0].plan),e=>e.statusCode===403);
    });
    await t.test('save references, submit, pin immutable requirements and reject editing/cancelling pending plan',async()=>{
      for(const p of people) {
        const body={...command(1),project_title:'Cooperative education portal',policy_id:policy.id,
          references:[{requirement_id:'eligibility',filename:`${p.actor.studentId ? `660900000${people.indexOf(p)}` : ''}.pdf`,format:'pdf',reference:'External evidence 01'}]};
        const saved=await service.saveWorkflow(p.actor,p.plan,body);
        const replay=await service.saveWorkflow(p.actor,p.plan,body); assert.equal(replay.idempotent_replay,true);
        assert.equal(saved.version,2);
        await workflow.submitPlan({actor:p.actor,plan_id:p.plan,...command(2)});
      }
      const p=people[0];
      await assert.rejects(service.saveWorkflow(p.actor,p.plan,{...command(3),project_title:'Changed',policy_id:policy.id,references:[]}),e=>e.statusCode===422);
      await assert.rejects(workflow.cancelPlan({actor:p.actor,plan_id:p.plan,...command(3)}),e=>e.statusCode===422);
      await service.publish(staff,{...command(1),cycle_id:cycle,department:'CPE',program:'',requirements:[]});
      const data=await service.getWorkflow(p.actor,p.plan); assert.equal(data.policy.version,1); assert.equal(data.submissions.length,1);
      await assert.rejects(q('UPDATE plan_submissions SET snapshot=\'{}\' WHERE plan_id=$1',[p.plan]),e=>e.code==='55000');
    });
    await t.test('revision and terminal rejection are distinct; final rejection cannot be cancelled or bypassed',async()=>{
      const p=people[7]; await workflow.startReview({actor:staff,plan_id:p.plan,...command(3)});
      await assert.rejects(workflow.approvePlan({actor:adminActor,plan_id:p.plan,...command(4)}),e=>e.statusCode===403);
      await assert.rejects(workflow.rejectPlan({actor:staff,plan_id:p.plan,...command(4),review_notes:' '}),e=>e.statusCode===400);
      await workflow.returnForRevision({actor:staff,plan_id:p.plan,...command(4),review_notes:'Correct external document'});
      assert.equal((await service.getWorkflow(p.actor,p.plan)).status,'NEEDS_REVISION');
      await assert.rejects(workflow.cancelPlan({actor:p.actor,plan_id:p.plan,...command(5)}),e=>e.statusCode===422);
      await assert.rejects(q("UPDATE plans SET status='CANCELLED' WHERE id=$1",[p.plan]),e=>e.constraint==='returned_plan_cannot_cancel');
      await workflow.submitPlan({actor:p.actor,plan_id:p.plan,...command(5)});
      await workflow.startReview({actor:staff,plan_id:p.plan,...command(6)});
      await workflow.rejectPlan({actor:staff,plan_id:p.plan,...command(7),review_notes:'Eligibility not met'});
      await assert.rejects(workflow.submitPlan({actor:p.actor,plan_id:p.plan,...command(8)}),e=>e.statusCode===422);
      await assert.rejects(workflow.cancelPlan({actor:p.actor,plan_id:p.plan,...command(8)}),e=>e.statusCode===422);
      await assert.rejects(q(`INSERT INTO plans(id,student_id,cycle_id,source,visibility,data_status) VALUES($1,$2,$3,'test','private','mock')`,[randomUUID(),p.student,cycle]),e=>e.code==='23505');
    });
    await t.test('FIFO uses latest submission time, not unrelated review/update timestamps',async()=>{
      const {StaffReviewRepository}=require('../src/db/repositories/staff-review-repository');
      const repository=new StaffReviewRepository({pool});
      const filters={staffUserId:staffId,reviewQueue:true,sort:'submitted_at',order:'asc',page:1,pageSize:100};
      const before=await repository.searchPlans(filters);
      const first=before.rows[0].id;
      await q("UPDATE plans SET updated_at=CURRENT_TIMESTAMP+interval '1 hour' WHERE id=$1",[first]);
      const after=await repository.searchPlans(filters);
      assert.equal(after.rows[0].id,first);
    });
    await t.test('approve eligibility without confirming company; Advisor cannot see unassigned student',async()=>{
      for(const p of people.slice(0,7)) {
        await workflow.startReview({actor:staff,plan_id:p.plan,...command(3)});
        await workflow.approvePlan({actor:staff,plan_id:p.plan,...command(4)});
      }
      await assert.rejects(service.getWorkflow(advisor,people[0].plan),e=>e.statusCode===403);
      assert.equal((await service.getWorkflow(people[0].actor,people[0].plan)).placement,null);
    });
    const assignments=[];
    await t.test('simultaneous fifth/sixth assignment: only one succeeds',async()=>{
      const end=new Date(Date.now()+86400000*90).toISOString();
      for(const p of people.slice(0,4)) assignments.push(await service.assign(staff,{...command(5),plan_id:p.plan,advisor_id:advisorId,effective_to:end}));
      const results=await Promise.allSettled(people.slice(4,6).map(p=>service.assign(staff,{...command(5),plan_id:p.plan,advisor_id:advisorId,effective_to:end})));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(results.find(x=>x.status==='rejected').reason.statusCode,409);
      const dashboard=await service.dashboard(staff); assert.equal(dashboard.advisors.find(a=>a.id===advisorId).active_count,5);
      assert.ok((await service.getWorkflow(advisor,people[0].plan)).advisor);
      await assert.rejects(service.assign(advisor,{...command(5),plan_id:people[6].plan,advisor_id:advisorId,effective_to:end}),e=>e.statusCode===403);
    });
    await t.test('atomic reassignment revokes old Advisor visibility and releases capacity',async()=>{
      await service.changeAssignment(staff,assignments[0].id,{...command(1),advisor_id:advisor2,effective_to:new Date(Date.now()+86400000*90).toISOString(),reason:'Matching project expertise'},true);
      await assert.rejects(service.getWorkflow(advisor,people[0].plan),e=>e.statusCode===403);
      assert.ok((await service.getWorkflow({...advisor,userId:advisor2},people[0].plan)).advisor);
      assert.equal((await service.dashboard(staff)).advisors.find(a=>a.id===advisorId).active_count,4);
    });
    await t.test('independent company confirmation requires sent form and exact Student/company match',async()=>{
      const p=people[0];
      await service.placement(p.actor,p.plan,'save',{...command(0),company_name:'Actual Company',position_title:'Developer',project_title:'Portal',accepted:true});
      await service.placement(p.actor,p.plan,'submit',command(1));
      await assert.rejects(service.placement(p.actor,p.plan,'save',{...command(2),company_name:'Changed',position_title:'x',project_title:'x',accepted:true}),e=>e.statusCode===422);
      await service.placement(staff,p.plan,'mark-sent',{...command(2),reference:'Sent form 42'});
      await assert.rejects(service.placement(staff,p.plan,'confirm',{...command(3),company_name:'Wrong Company',student_number:'6609000000',reference:'Return 42'}),e=>e.statusCode===400);
      const result=await service.placement(staff,p.plan,'confirm',{...command(3),company_name:'  actual  COMPANY ',student_number:'6609000000',reference:'Return 42'});
      assert.equal(result.status,'CONFIRMED'); assert.equal(result.confirmed_by,staffId);
      assert.equal((await service.getWorkflow(p.actor,p.plan)).status,'APPROVED');
    });
    await t.test('policy published after draft save requires refresh; new-cycle submission is separate',async()=>{
      const cycle2=randomUUID(),newPlan=randomUUID(),p=people[6];
      await q(`INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'New cycle',2569,2,'OPEN','test','public','mock')`,[cycle2]);
      await q(`INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,source,visibility,data_status) VALUES($1,$2,$3,$4,$5,'test','private','mock')`,[newPlan,p.student,cycle2,company,position]);
      const first=await service.publish(staff,{...command(0),cycle_id:cycle2,department:'CPE',program:'',requirements:[]});
      await service.saveWorkflow(p.actor,newPlan,{...command(1),project_title:'New project',policy_id:first.id,references:[]});
      await service.publish(staff,{...command(1),cycle_id:cycle2,department:'CPE',program:'',requirements:[]});
      await assert.rejects(workflow.submitPlan({actor:p.actor,plan_id:newPlan,...command(2)}),e=>e.statusCode===409);
      const data=await service.getWorkflow(p.actor,newPlan);assert.equal(data.policy.version,2);assert.equal(data.submissions.length,0);
      await service.saveWorkflow(p.actor,newPlan,{...command(2),project_title:'New project',policy_id:data.policy.id,references:[]});
      await workflow.submitPlan({actor:p.actor,plan_id:newPlan,...command(3)});
    });
    await t.test('direct SQL writers enforce future capacity across years/terms, including simultaneous fifth/sixth and touching boundaries',async()=>{
      const start=new Date(Date.now()+86400000*100).toISOString(),end=new Date(Date.now()+86400000*120).toISOString();
      const insert=(person,year=2570,from=start,to=end)=>q(`INSERT INTO advisor_assignments(id,advisor_id,student_id,academic_year,semester,effective_from,effective_to,assigned_by)
        VALUES($1,$2,$3,$4,2,$5,$6,$7)`,[randomUUID(),advisorId,person.student,year,from,to,staffId]);
      for(const p of people.slice(0,4))await insert(p);
      const result=await Promise.allSettled([insert(people[4]),insert(people[5],2571)]);
      assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(result.find(x=>x.status==='rejected').reason.constraint,'advisor_capacity_five');
      await assert.rejects(insert(people[6],2572,new Date(Date.now()+86400000*110).toISOString()),e=>e.constraint==='advisor_capacity_five');
      await insert(people[6],2572,end,new Date(Date.now()+86400000*130).toISOString());
    });
    await t.test('Lambda routes preserve central policy and no-store response contract',async()=>{
      const {createLambdaHandler}=require('../src/lambda');
      const {attachRequestContext}=require('../src/api/context');
      let actor=people[0].actor;
      const handler=createLambdaHandler({threeRoleService:service,workflowService:workflow,
        authOptions:{pool,authorizationService:new AuthorizationService({pool}),authMiddleware:async req=>attachRequestContext(req,actor)}});
      const request=(path,method='GET',body)=>handler({rawPath:path,body:body?JSON.stringify(body):undefined,requestContext:{http:{method}}});
      const response=await request(`/api/v3/plans/${people[0].plan}/workflow`);
      assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');
      assert.equal(JSON.parse(response.body).data.placement.status,'CONFIRMED');
      const profile=await request('/api/v3/students/me');assert.equal(profile.statusCode,200);
      const changed=await request('/api/v3/students/me','PATCH',{contact_address:'Synthetic address\nSecond line',version:JSON.parse(profile.body).data.version,operation_id:randomUUID()});
      assert.equal(changed.statusCode,200);assert.equal(JSON.parse(changed.body).data.contact_phone,'+66 81 000 0000');
      actor=advisor;
      assert.equal((await request(`/api/v3/plans/${people[0].plan}/workflow`)).statusCode,403);
      assert.equal((await request(`/api/v3/plans/${people[1].plan}/placement`,'PATCH',{})).statusCode,403);
      actor=staff;
      assert.equal((await request('/api/v3/staff/workflow')).statusCode,200);
      const page=await service.listAssignments(staff,{page:'1',pageSize:'1',advisor_id:advisorId});
      assert.equal(page.items.length,1);assert.equal(page.pagination.total,4);
      const next=await service.listAssignments(staff,{page:'2',pageSize:'1',advisor_id:advisorId});
      assert.notEqual(page.items[0].id,next.items[0].id);
      assert.equal((await request(`/api/v3/plans/${people[7].plan}/reject`,'POST',{...command(8),actor:{role:'STAFF'},review_notes:'spoof'})).statusCode,400);
    });
    await t.test('out-of-scope and disabled Staff are rejected before data or receipts are exposed',async()=>{
      const outside=randomUUID();await q(`INSERT INTO users(id,role) VALUES($1,'STAFF')`,[outside]);
      await q(`INSERT INTO staff_scopes(id,staff_id,department) VALUES($1,$2,'OTHER')`,[randomUUID(),outside]);
      const other={...staff,userId:outside};
      await assert.rejects(service.getWorkflow(other,people[0].plan),e=>e.statusCode===403);
      await assert.rejects(service.assign(other,{...command(5),plan_id:people[0].plan,advisor_id:advisorId,effective_to:'2027-01-01T00:00:00Z'}),e=>e.statusCode===403);
      await q(`UPDATE users SET account_status='DISABLED' WHERE id=$1`,[outside]);
      await assert.rejects(service.dashboard(other),e=>e.statusCode===403);
    });
    await t.test('runtime ACL permits scoped operations but denies official identity edits and immutable record writes',async()=>{
      const runtimeRole=`wf_runtime_${randomUUID().replaceAll('-','')}`;
      let runtimePool;
      try {
        await admin.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
        const script=(await readFile(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8'))
          .replace(/^\\set[^\n]*\n/m,'').replaceAll('public.',`${schema}.`).replaceAll('SCHEMA public',`SCHEMA ${schema}`)
          .replaceAll("'public'",`'${schema}'`).replaceAll('coed_app',runtimeRole);
        await q(script);
        runtimePool=new Pool({connectionString:url.href,options:`-c search_path=${schema},public`,max:3});
        const {ThreeRoleRepository}=require('../src/db/repositories/three-role-repository');
        const repository=new ThreeRoleRepository({pool:runtimePool});
        repository.getClient=async()=>{const c=await runtimePool.connect();await c.query(`SET ROLE ${runtimeRole}`);return c;};
        const runtime=new ThreeRoleService({threeRoleRepository:repository});
        assert.equal((await runtime.dashboard(staff)).advisors.length,2);
        assert.equal((await runtime.getWorkflow(people[0].actor,people[0].plan)).placement.status,'CONFIRMED');
        const profile=(await q('SELECT version FROM students WHERE id=$1',[people[0].student])).rows[0];
        const contact=await runtime.saveContact(people[0].actor,{contact_address:'Updated synthetic address',contact_phone:'0810000000',version:profile.version,operation_id:randomUUID()});
        assert.equal(contact.version,profile.version+1);
        const c=await repository.getClient();
        try {
          await assert.rejects(c.query(`UPDATE students SET full_name='Spoof' WHERE id=$1`,[people[0].student]),e=>e.code==='42501');
          await assert.rejects(c.query('DELETE FROM workflow_receipts'),e=>e.code==='42501');
          await assert.rejects(c.query('UPDATE document_policies SET version=999'),e=>e.code==='42501');
          await assert.rejects(c.query('UPDATE users SET role=\'ADMIN\''),e=>e.code==='42501');
        }finally{c.release();}
      } finally {
        await runtimePool?.end();
        // Drop only this test's isolated role and its grants; no application data reset.
        await admin.query(`DROP OWNED BY ${runtimeRole}`);
        await admin.query(`DROP ROLE ${runtimeRole}`);
      }
    });
    await t.test('challenge provisioning is INSERT-only/idempotent; Admin Ops writes versioned audited account changes only',async()=>{
      const manifest=JSON.parse(operatorFunction('live-challenge',
        'json.dumps({"marker":m.MARKER,"issuer":m.ISSUER,"accounts":[dict(r,sub=str(__import__("uuid").uuid4())) for r in m.roster()]})',{}));
      const rewrite=sql=>sql.replaceAll('public.',`${schema}.`).replaceAll('pg_catalog,public',`pg_catalog,${schema}`);
      const execute=async sql=>{const c=await pool.connect();try{return await c.query(rewrite(sql));}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
      const sql=operatorFunction('live-challenge','m.provisioning_sql(v)',manifest);
      await execute(sql);await execute(sql);
      assert.equal((await q("SELECT count(*)::int n FROM students WHERE source='CO-ED Live Challenge 135 synthetic'")).rows[0].n,3);
      assert.equal((await q("SELECT count(*)::int n FROM plans p JOIN students s ON s.id=p.student_id WHERE s.source='CO-ED Live Challenge 135 synthetic'")).rows[0].n,0);
      const owner=manifest.accounts.find(r=>r.role==='ADMIN').user_id;
      const target=manifest.accounts.find(r=>r.key==='advisor2').user_id;
      const body={user_id:target,role:'ADVISOR',account_status:'DISABLED',expected_version:1,operation_id:randomUUID(),reason:'Synthetic account maintenance'};
      const change=(actor,request)=>execute(operatorFunction('admin-account','m.statement(v["actor"],v["body"])',{actor,body:request}));
      await assert.rejects(change(staffId,body),e=>e.code==='42501');
      await change(owner,body);await change(owner,body);
      assert.deepEqual((await q('SELECT role,account_status,version FROM users WHERE id=$1',[target])).rows[0],{role:'ADVISOR',account_status:'DISABLED',version:2});
      assert.equal((await q('SELECT count(*)::int n FROM workflow_events WHERE operation_id=$1',[body.operation_id])).rows[0].n,1);
      await assert.rejects(change(owner,{...body,operation_id:randomUUID()}),e=>e.code==='40001');
      await assert.rejects(change(owner,{...body,reason:'Changed payload'}),e=>e.code==='23505');
      await assert.rejects(change(owner,{...body,user_id:owner,role:'ADMIN',operation_id:randomUUID()}),e=>e.code==='42501');
    });
  } finally {
    await pool?.end();
    if (/^wf_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
