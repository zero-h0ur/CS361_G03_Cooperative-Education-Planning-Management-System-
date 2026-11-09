import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import service from '../src/api/services/coordinator-workspace-service.js';
const url=process.env.COORDINATOR_TEST_DATABASE_URL;
test('review-only schedule under actual runtime grants: first setup, replay, concurrency, scope and atomic audit',{skip:!url},async t=>{
 const target=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.match(target.pathname,/_test$/);assert.notEqual(url,process.env.DATABASE_URL);
 const schema='coord_'+id().replaceAll('-',''),role='coord_runtime_'+id().replaceAll('-',''),admin=new pg.Pool({connectionString:url});let owner,runtime;
 const flags=['COED_API_MAINTENANCE','COED_COORDINATOR_REVIEW_ENABLED','COED_INTAKE_PILOT','COED_INTAKE_AUDIENCE'],old=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);owner=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});
  for(const migration of readReviewedMigrations())await owner.query(migration.sql);
  await owner.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL)');await admin.query(`CREATE ROLE ${role} NOLOGIN`);
  const grants=readFileSync(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8').replace(/^\\set[^\n]*\n/m,'').replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema).replaceAll("'public'","'"+schema+"'").replaceAll('coed_app',role);
  await owner.query(grants);runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=${role}`});
  const coord=id(),other=id(),members=[id(),id(),id()],cycle=id(),cohorts=[id(),id()];
  for(const [uid,r] of [[coord,'COORDINATOR'],[other,'COORDINATOR'],...members.map(m=>[m,'COMMITTEE'])])await owner.query('INSERT INTO users(id,role) VALUES($1,$2)',[uid,r]);
  await owner.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic review window',2569,1,'OPEN','synthetic','public','mock')",[cycle]);
  for(const [i,program] of ['ภาคปกติ','ภาคพิเศษ'].entries())await owner.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS',$3,$4,$5,$6,$7)",[cohorts[i],cycle,program,coord,...members]);
  await owner.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[cycle]);
  process.env.COED_API_MAINTENANCE='intake-pilot';process.env.COED_COORDINATOR_REVIEW_ENABLED='true';process.env.COED_INTAKE_AUDIENCE='routed-tu-students';
  process.env.COED_INTAKE_PILOT=JSON.stringify({student_user_id:id(),coordinator_user_id:coord,cycle_id:cycle});
  const actor={isAuthenticated:true,userId:coord,role:'COORDINATOR',accountStatus:'ACTIVE'},review=new service.CoordinatorWorkspaceService({pool:runtime});
  const at=hours=>new Date(Date.now()+hours*3600000).toISOString(),body=(version=0)=>({operation_id:id(),expected_version:version,review_opens_at:at(-1),review_closes_at:at(1)});
  const before=(await owner.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id=$1',[cycle])).rows[0];
  await t.test('initial setup needs no confirmation dates, preserves intake, has exactly one audited receipt on replay',async()=>{
   assert.equal((await review.getSchedule(actor,cycle)).can_edit_review,true);
   const b=body(),saved=await review.saveReviewSchedule(actor,cycle,b);assert.equal(saved.version,1);assert.deepEqual(await review.saveReviewSchedule(actor,cycle,b),saved);
   const row=(await owner.query('SELECT * FROM coordinator_round_schedules WHERE cycle_id=$1',[cycle])).rows[0];assert.equal(row.confirmation_opens_at,null);assert.equal(row.confirmation_closes_at,null);
   assert.deepEqual((await owner.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id=$1',[cycle])).rows[0],before);
   assert.equal((await owner.query("SELECT count(*)::int n FROM coordinator_operations WHERE action='review-schedule'")).rows[0].n,1);
   await assert.rejects(review.saveReviewSchedule(actor,cycle,{...b,review_closes_at:at(2)}),e=>e.statusCode===409);
   await assert.rejects(review.saveReviewSchedule(actor,cycle,body(0)),e=>e.statusCode===409);
   await assert.rejects(review.saveReviewSchedule(actor,cycle,{...body(1),opens_at:at(-2)}),e=>e.statusCode===400);
   await assert.rejects(owner.query('UPDATE coordinator_round_schedules SET confirmation_opens_at=$2 WHERE cycle_id=$1',[cycle,at(3)]),e=>e.code==='23514');
  });
  await t.test('simultaneous writers serialize and existing confirmation window is an upper bound',async()=>{
   const attempts=await Promise.allSettled([review.saveReviewSchedule(actor,cycle,body(1)),review.saveReviewSchedule(actor,cycle,body(1))]);
   assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.statusCode===409).length,1);
   const start=at(2),end=at(3);await owner.query('UPDATE coordinator_round_schedules SET confirmation_opens_at=$2,confirmation_closes_at=$3 WHERE cycle_id=$1',[cycle,start,end]);
   await assert.rejects(review.saveReviewSchedule(actor,cycle,{...body(2),review_closes_at:at(4)}),e=>e.statusCode===400);
   await review.saveReviewSchedule(actor,cycle,body(2));const row=(await owner.query('SELECT * FROM coordinator_round_schedules WHERE cycle_id=$1',[cycle])).rows[0];assert.equal(row.confirmation_opens_at.toISOString(),start);assert.equal(row.confirmation_closes_at.toISOString(),end);
  });
  await t.test('audit failure rolls back date and version, not just the receipt',async()=>{
   const previous=(await owner.query('SELECT * FROM coordinator_round_schedules WHERE cycle_id=$1',[cycle])).rows[0];
   await owner.query("CREATE FUNCTION reject_schedule_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='23514'; END $$;CREATE TRIGGER reject_schedule_audit BEFORE INSERT ON coordinator_operations FOR EACH ROW EXECUTE FUNCTION reject_schedule_audit()");
   await assert.rejects(review.saveReviewSchedule(actor,cycle,body(3)),e=>e.code==='23514');assert.deepEqual((await owner.query('SELECT * FROM coordinator_round_schedules WHERE cycle_id=$1',[cycle])).rows[0],previous);
   await owner.query('DROP TRIGGER reject_schedule_audit ON coordinator_operations;DROP FUNCTION reject_schedule_audit()');
  });
  await t.test('confirmation in the primary schedule also bounds review, and contradictory schedule sources fail closed',async()=>{
   const start=at(25),end=at(26);
   await owner.query('UPDATE phase1_cycle_windows SET confirmation_opens_at=$2,confirmation_closes_at=$3 WHERE cycle_id=$1',[cycle,start,end]);
   await owner.query('UPDATE coordinator_round_schedules SET confirmation_opens_at=NULL,confirmation_closes_at=NULL WHERE cycle_id=$1',[cycle]);
   await assert.rejects(review.saveReviewSchedule(actor,cycle,{...body(3),review_closes_at:at(27)}),e=>e.statusCode===400);
   const beforeWindow=(await owner.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id=$1',[cycle])).rows;
   await review.saveReviewSchedule(actor,cycle,body(3));assert.deepEqual((await owner.query('SELECT * FROM phase1_cycle_windows WHERE cycle_id=$1',[cycle])).rows,beforeWindow);
   await owner.query('UPDATE coordinator_round_schedules SET confirmation_opens_at=$2,confirmation_closes_at=$3 WHERE cycle_id=$1',[cycle,at(4),at(5)]);
   await assert.rejects(review.saveReviewSchedule(actor,cycle,body(4)),e=>e.code==='SCHEDULE_SOURCE_CONFLICT');
   await owner.query('UPDATE coordinator_round_schedules SET confirmation_opens_at=$2,confirmation_closes_at=$3 WHERE cycle_id=$1',[cycle,start,end]);
  });
  await t.test('wrong actor, round, disabled flag, closed or shared round cannot update',async()=>{
   await assert.rejects(review.saveReviewSchedule({...actor,userId:other},cycle,body(3)),e=>e.code==='COED_MAINTENANCE');
   await assert.rejects(review.saveReviewSchedule(actor,id(),body(3)),e=>e.code==='COED_MAINTENANCE');
   process.env.COED_COORDINATOR_REVIEW_ENABLED='false';await assert.rejects(review.saveReviewSchedule(actor,cycle,body(3)),e=>e.code==='COED_MAINTENANCE');process.env.COED_COORDINATOR_REVIEW_ENABLED='true';
   await owner.query("UPDATE rounds SET status='CLOSED' WHERE id=$1",[cycle]);assert.equal((await review.getSchedule(actor,cycle)).can_edit_review,false);await assert.rejects(review.saveReviewSchedule(actor,cycle,body(3)),e=>e.statusCode===403);
   await owner.query("UPDATE rounds SET status='OPEN' WHERE id=$1",[cycle]);await owner.query('UPDATE selection_cohorts SET coordinator_id=$2 WHERE id=$1',[cohorts[1],other]);
   assert.equal((await review.getSchedule(actor,cycle)).can_edit_review,false);await assert.rejects(review.saveReviewSchedule(actor,cycle,body(3)),e=>e.statusCode===403);
  });
 }finally{for(const key of flags)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];await runtime?.end();await owner?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();}
});
