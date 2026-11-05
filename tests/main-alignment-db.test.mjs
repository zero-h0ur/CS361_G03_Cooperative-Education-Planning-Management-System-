import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import migration from '../src/db/migrate.js';
import schedule from '../src/api/services/phase1-schedule-service.js';
import coordinator from '../src/api/services/coordinator-workspace-service.js';

const url=process.env.COORDINATOR_TEST_DATABASE_URL;
test('main alignment: migration upgrade, runtime ACL, schedule consistency and owned decisions',
  {skip:!url && !process.env.CI},async t=>{
    const target=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
    assert.match(target.pathname,/_test$/);assert.equal(process.env.NODE_ENV,'test');assert.notEqual(url,process.env.DATABASE_URL);
    const admin=new pg.Pool({connectionString:url}),schemas=[],pools=[];
    const role='align_runtime_'+id().replaceAll('-','');let runtime;
    const logger={log(){},error(){}};
    try {
      const rows=readReviewedMigrations();let db;
      for(const mode of ['fresh','upgrade','delivery-upgrade'])await t.test(mode+' migration history is repeatable, concurrent and preserves data',async()=>{
        const schema='align_'+id().replaceAll('-','');schemas.push(schema);await admin.query(`CREATE SCHEMA ${schema}`);
        const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});pools.push(pool);
        let retained,oldCycle;
        if(mode!=='fresh'){
          await pool.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL)');
          for(const row of rows.filter(x=>mode==='upgrade'?x.name<'014_':!x.name.startsWith('014_'))){
            await pool.query(row.sql);await pool.query('INSERT INTO schema_migrations VALUES($1,$2)',[row.name,row.checksum]);
          }
          retained=id();await pool.query("INSERT INTO users(id,role) VALUES($1,'COORDINATOR')",[retained]);
          oldCycle=id();
          await pool.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic retained schedule',2569,1,'OPEN','synthetic','private','mock')",[oldCycle]);
          await pool.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,'2026-11-01Z','2026-11-02Z')",[oldCycle]);
          await pool.query(`INSERT INTO coordinator_round_schedules(cycle_id,review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by)
            VALUES($1,'2026-11-02Z','2026-11-04Z','2026-11-05Z','2026-11-10Z',1,$2)`,[oldCycle,retained]);
        }
        await Promise.all([migration.migrate({pool,logger}),migration.migrate({pool,logger})]);
        assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,
          rows.map(x=>({version:x.name,checksum:x.checksum})));
        if(retained){
          assert.equal((await pool.query('SELECT role FROM users WHERE id=$1',[retained])).rows[0].role,'COORDINATOR');
          const service=new schedule.Phase1ScheduleService({pool});
          const kept=await service.getSchedule(oldCycle,{isAuthenticated:true,userId:retained,role:'COORDINATOR'});
          assert.equal(kept.confirmation_window.closes_at,'2026-11-10T00:00:00.000Z');
          assert.equal((await pool.query('SELECT confirmation_closes_at FROM phase1_cycle_windows WHERE cycle_id=$1',[oldCycle])).rows[0].confirmation_closes_at,null);
        }
        if(mode==='fresh')db=pool;
      });
      const schema=schemas[0];await admin.query(`CREATE ROLE ${role} NOLOGIN`);
      const grants=readFileSync(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8')
        .replace(/^\\set[^\n]*\n/m,'').replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema)
        .replaceAll("'public'","'"+schema+"'").replaceAll('coed_app',role);
      await db.query(grants);await db.query(grants);
      runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=${role}`});
      const coord=id(),other=id(),members=[id(),id(),id()],studentUser=id(),otherUser=id(),sid=id(),otherSid=id(),cycle=id(),cohort=id();
      for(const [uid,r] of [[coord,'COORDINATOR'],[other,'COORDINATOR'],[studentUser,'STUDENT'],[otherUser,'STUDENT'],...members.map(x=>[x,'COMMITTEE'])])
        await db.query('INSERT INTO users(id,role) VALUES($1,$2)',[uid,r]);
      await db.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic alignment',2569,1,'OPEN','synthetic','public','mock')",[cycle]);
      for(const [student,user,num] of [[sid,studentUser,'9900000001'],[otherSid,otherUser,'9900000002']])await db.query(`INSERT INTO students
        (id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
        VALUES($1,$2,$3,$3,'Synthetic Student','test@example.invalid','CS','regular','CS',2569,'ACTIVE','synthetic','private','mock')`,[student,user,num]);
      await db.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS','regular',$3,$4,$5,$6)",[cohort,cycle,coord,...members]);
      const actor=(userId,role,studentId)=>({isAuthenticated:true,userId,role,studentId,accountStatus:'ACTIVE'});
      const owner=actor(coord,'COORDINATOR'),outsider=actor(other,'COORDINATOR'),student=actor(studentUser,'STUDENT',sid);
      const main=new schedule.Phase1ScheduleService({pool:runtime,now:()=>new Date('2026-11-04T01:00:00Z')});
      const legacy=new coordinator.CoordinatorWorkspaceService({pool:runtime});
      const dates={opens_at:'2026-11-01T00:00:00Z',closes_at:'2026-11-02T00:00:00Z',review_opens_at:'2026-11-02T00:00:00Z',
        review_closes_at:'2026-11-04T00:00:00Z',confirmation_opens_at:'2026-11-05T00:00:00Z',confirmation_closes_at:'2026-11-10T00:00:00Z'};
      await t.test('existing Coordinator UI writes confirmation dates readable by main',async()=>{
        await legacy.saveSchedule(owner,cycle,{...dates,operation_id:id(),expected_version:0,expected_window_version:0});
        const value=await main.getSchedule(cycle,student);
        assert.equal(value.confirmation_window.closes_at,new Date(dates.confirmation_closes_at).toISOString());
      });
      await t.test('main updates both models atomically and stale UI writes fail',async()=>{
        const current=await main.getSchedule(cycle,owner);
        await main.updateSchedule(owner,cycle,{...dates,confirmation_closes_at:'2026-11-12T00:00:00Z',operation_id:id(),expected_version:current.version});
        const ui=await legacy.getSchedule(owner,cycle);
        assert.equal(ui.confirmation_closes_at.toISOString(),'2026-11-12T00:00:00.000Z');
        await assert.rejects(legacy.saveSchedule(owner,cycle,{...dates,operation_id:id(),expected_version:1,expected_window_version:1}),e=>e.statusCode===409);
        await assert.rejects(main.updateSchedule(owner,cycle,{...dates,closes_at:'2026-11-06T00:00:00Z',expected_version:ui.window_version,operation_id:id()}),e=>e.statusCode===400);
      });
      await t.test('unassigned Coordinator cannot read or mutate round-wide confirmation data',async()=>{
        for(const run of [()=>main.updateSchedule(outsider,cycle,{}),()=>main.announceResults(outsider,cycle,{}),
          ()=>main.listConfirmations(outsider,cycle),()=>main.processExpiredConfirmations(outsider,cycle),()=>main.confirmTeamJoined(outsider,cycle,sid)])
          await assert.rejects(run(),e=>e.statusCode===403);
      });
      await t.test('concurrent writers across the two schedule APIs serialize',async()=>{
        const cur=await legacy.getSchedule(owner,cycle),current=await main.getSchedule(cycle,owner);
        const results=await Promise.allSettled([
          legacy.saveSchedule(owner,cycle,{...dates,operation_id:id(),expected_version:cur.version,expected_window_version:cur.window_version}),
          main.updateSchedule(owner,cycle,{...dates,operation_id:id(),expected_version:current.version})
        ]);
        assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
        assert.equal(results.find(x=>x.status==='rejected').reason.statusCode,409);
      });
      for(const studentId of [sid,otherSid])await db.query("INSERT INTO phase1_selection_results(id,cycle_id,student_id,outcome,confirmation_status) VALUES($1,$2,$3,'SELECTED','PENDING_CONFIRMATION')",[id(),cycle,studentId]);
      await t.test('announcement is audited and safely replayable under runtime grants',async()=>{
        const current=await main.getSchedule(cycle,owner);
        const body={operation_id:id(),expected_version:current.version,confirmation_opens_at:dates.confirmation_opens_at,confirmation_closes_at:dates.confirmation_closes_at};
        const result=await main.announceResults(owner,cycle,body);assert.equal(result.selected_count,2);
        const replay=await main.announceResults(owner,cycle,body);assert.equal(replay.replayed,true);
        assert.equal((await legacy.getSchedule(owner,cycle)).confirmation_closes_at.toISOString(),new Date(dates.confirmation_closes_at).toISOString());
      });
      await t.test('decision and confirmation use DB owner, not supplied studentId; no cross-owner notifications',async()=>{
        const during=new schedule.Phase1ScheduleService({pool:runtime,now:()=>new Date('2026-11-06T00:00:00Z')});
        const decision=await during.getStudentDecision({...student,studentId:otherSid},cycle);assert.equal(decision.student_id,sid);
        const body={operation_id:id(),expected_version:decision.version};
        assert.equal((await during.respondConfirmation(student,cycle,body,'CONFIRM')).confirmation_status,'CONFIRMED');
        assert.equal((await during.respondConfirmation(student,cycle,body,'CONFIRM')).replayed,true);
        assert.equal((await db.query('SELECT confirmation_status FROM phase1_selection_results WHERE student_id=$1',[otherSid])).rows[0].confirmation_status,'PENDING_CONFIRMATION');
        const before=(await main.listNotifications(owner)).notifications.length;
        const own=(await main.listNotifications(owner)).notifications[0];
        await main.markNotificationRead(owner,own.id);
        assert.equal((await main.listNotifications(owner,{unread_only:'false'})).notifications.length,before);
        assert.equal((await main.listNotifications(owner,{unread_only:'true'})).notifications.length,before-1);
        await assert.rejects(main.markNotificationRead(outsider,own.id),e=>e.statusCode===404);
      });
      await t.test('lazy expiry uses valid PostgreSQL placeholders and returns committed version',async()=>{
        const late=new schedule.Phase1ScheduleService({pool:runtime,now:()=>new Date('2026-11-11T00:00:00Z')});
        const result=await late.getStudentDecision(actor(otherUser,'STUDENT',otherSid),cycle);
        assert.equal(result.confirmation_status,'AUTO_WAIVED');assert.equal(result.version,2);
        assert.equal((await late.getStudentDecision(actor(otherUser,'STUDENT',otherSid),cycle)).version,2);
      });
      await t.test('runtime cannot create/change selection outcomes or rewrite audit events',async()=>{
        for(const sql of ["UPDATE phase1_selection_results SET outcome='NOT_SELECTED' WHERE false",'DELETE FROM phase1_schedule_events WHERE false',
          'UPDATE phase1_notifications SET recipient_user_id=recipient_user_id WHERE false','INSERT INTO phase1_selection_results(id) VALUES(gen_random_uuid())'])
          await assert.rejects(runtime.query(sql),e=>e.code==='42501');
      });
    } finally {
      await runtime?.end();for(const pool of pools)await pool.end();
      for(const schema of schemas){assert.match(schema,/^align_[a-f0-9]{32}$/);await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}
      assert.match(role,/^align_runtime_[a-f0-9]{32}$/);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();
    }
  });
