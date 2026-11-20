import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import workspace from '../src/api/services/committee-workspace.js';
import selection from '../src/api/services/selection-service.js';
import coordinatorWorkspace from '../src/api/services/coordinator-workspace-service.js';
const url=process.env.COMMITTEE_TEST_DATABASE_URL;
test('persisted proposals, simultaneous votes, stale versions, replay, scope and audit',{skip:!url},async()=>{
 const parsed=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));
 const pool=new pg.Pool({connectionString:url});
 const [student,coordinator,...members]=Array.from({length:5},randomUUID),cycle=randomUUID(),profile=randomUUID(),company=randomUUID(),position=randomUUID(),plan=randomUUID(),cohort=randomUUID();
 try{
  for(const [id,role] of [[student,'STUDENT'],[coordinator,'COORDINATOR'],...members.map(id=>[id,'COMMITTEE'])])await pool.query('INSERT INTO users(id,role) VALUES($1,$2)',[id,role]);
  await pool.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Committee test',2569,1,'OPEN','synthetic','private','mock')",[cycle]);
  await pool.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
   VALUES($1,$2,$3,$3,'Synthetic','no@example.invalid','CPE','CS','CS',2569,'ACTIVE','synthetic','private','mock')`,[profile,student,'TEST'+randomUUID()]);
  await pool.query("INSERT INTO companies(id,name,source,visibility,data_status) VALUES($1,'Synthetic','synthetic','public','mock')",[company]);
  await pool.query("INSERT INTO positions(id,company_id,title,source,visibility,data_status) VALUES($1,$2,'Synthetic','synthetic','public','mock')",[position,company]);
  await pool.query(`INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,status,version,project_title,source,visibility,data_status)
   VALUES($1,$2,$3,$4,$5,'SUBMITTED',1,'Synthetic','synthetic','private','mock')`,[plan,profile,cycle,company,position]);
  await pool.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CPE','CS',$3,$4,$5,$6)",[cohort,cycle,coordinator,...members]);
  const actor=(userId,role='COMMITTEE')=>({isAuthenticated:true,userId,role,accountStatus:'ACTIVE'});
  await new selection.SelectionService({pool}).mutate(actor(coordinator,'COORDINATOR'),plan,{operation_id:randomUUID(),expected_version:1});
  const service=new workspace.CommitteeWorkspaceService({pool});
  assert.equal((await service.read(actor(members[0]),cohort)).students.length,1);
  const proposal={action:'propose',normal:1,special:0,reason:'Test',operation_id:randomUUID(),expected_version:0};
  const created=await service.mutate(actor(members[0]),cohort,proposal);assert.equal(created.version,1);
  assert.deepEqual(await service.mutate(actor(members[0]),cohort,proposal),created);
  const votes=await Promise.allSettled(members.slice(1).map(id=>service.mutate(actor(id),cohort,{action:'accept',operation_id:randomUUID(),expected_version:1})));
  assert.equal(votes.filter(x=>x.status==='fulfilled').length,1);assert.equal(votes.filter(x=>x.status==='rejected'&&x.reason.statusCode===409).length,1);
  const view=await service.read(actor(members[0]),cohort);const remaining=members.find(id=>view.state.proposal.votes[id]==='pending');
  await service.mutate(actor(remaining),cohort,{action:'accept',operation_id:randomUUID(),expected_version:2});
  await assert.rejects(service.mutate(actor(members[0]),cohort,{action:'finalize',selected:[randomUUID()],ranking:'core',operation_id:randomUUID(),expected_version:3}));
  const result=await service.mutate(actor(members[0]),cohort,{action:'finalize',selected:[plan],ranking:'core',operation_id:randomUUID(),expected_version:3});assert.equal(result.state.finalized,true);
  const tracked=await new coordinatorWorkspace.CoordinatorWorkspaceService({pool}).tracking(actor(coordinator,'COORDINATOR'),{cycle_id:cycle});
  assert.equal(tracked.total,0);assert.equal(tracked.dashboard.selected,1);assert.equal(tracked.meetings[0].result.applicants[0].source,'LEGACY_PLAN');
  assert.equal(tracked.meetings[0].result.applicants[0].id,plan);assert.equal(tracked.meetings[0].result.applicants[0].outcome,'SELECTED');
  assert.equal(Number((await pool.query('SELECT count(*) FROM committee_workspace_events WHERE cohort_id=$1',[cohort])).rows[0].count),4);
  await assert.rejects(pool.query('DELETE FROM committee_workspace_events WHERE cohort_id=$1',[cohort]));
  await assert.rejects(service.read(actor(student),cohort),e=>e.statusCode===403);
 }finally{await pool.end();}
});
