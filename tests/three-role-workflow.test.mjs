import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { ThreeRoleService } = require('../src/api/services/three-role-service');
const { WorkflowService } = require('../src/api/services/workflow-service');
const { WorkflowRepository } = require('../src/db/repositories/workflow-repository');
const { AuthorizationService } = require('../src/api/services/authorization-service');
const v = require('../src/api/services/workflow-input');
const command = version => ({expected_version:version,operation_id:randomUUID()});

test('external references reject unsafe URLs, duplicate types and executable policy expressions', () => {
  for (const url of ['javascript:alert(1)','http://example.invalid','https://user:pass@example.invalid']) assert.throws(() => v.https(url));
  assert.equal(v.https('https://example.invalid/document'), 'https://example.invalid/document');
  assert.throws(() => v.references([{requirement_id:'x',filename:'a.pdf',format:'pdf',reference:'x'},{requirement_id:'x',filename:'a.pdf',format:'pdf',reference:'y'}]));
  assert.throws(() => v.requirements([{id:'x',title:'x',required:true,regex:'(a+)+'}]));
});

test('three-role workflow on isolated PostgreSQL schema', {skip:!process.env.CO_ED_WORKFLOW_TEST_DATABASE_URL}, async t => {
  const url = new URL(process.env.CO_ED_WORKFLOW_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Use an explicitly disposable local test server.');
  const admin=new Pool({connectionString:url.href}), schema=`wf_${randomUUID().replaceAll('-','')}`;
  let pool;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const c=await admin.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      const files=(await readdir(new URL('../src/db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
      for (const [i,file] of files.entries()) {
        if (i===1) await c.query(`SET search_path TO "${schema}",public`);
        await c.query(await readFile(new URL(`../src/db/migrations/${file}`,import.meta.url),'utf8'));
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
      await workflow.returnForRevision({actor:staff,plan_id:p.plan,...command(4),review_notes:'Correct external document'});
      assert.equal((await service.getWorkflow(p.actor,p.plan)).status,'NEEDS_REVISION');
      await workflow.submitPlan({actor:p.actor,plan_id:p.plan,...command(5)});
      await workflow.startReview({actor:staff,plan_id:p.plan,...command(6)});
      await workflow.rejectPlan({actor:staff,plan_id:p.plan,...command(7),review_notes:'Eligibility not met'});
      await assert.rejects(workflow.cancelPlan({actor:p.actor,plan_id:p.plan,...command(8)}),e=>e.statusCode===422);
      await assert.rejects(q(`INSERT INTO plans(id,student_id,cycle_id,source,visibility,data_status) VALUES($1,$2,$3,'test','private','mock')`,[randomUUID(),p.student,cycle]),e=>e.code==='23505');
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
    await t.test('simultaneous fifth/sixth assignment: only one succeeds, even across terms',async()=>{
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
      const result=await service.placement(staff,p.plan,'confirm',{...command(3),company_name:'Actual Company',student_number:'6609000000',reference:'Return 42'});
      assert.equal(result.status,'CONFIRMED'); assert.equal(result.confirmed_by,staffId);
      assert.equal((await service.getWorkflow(p.actor,p.plan)).status,'APPROVED');
    });
  } finally {
    await pool?.end();
    if (/^wf_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
