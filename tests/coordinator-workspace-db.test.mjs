import faculty from '../src/shared/faculty-criteria.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import application from '../src/api/services/application-service.js';
import coordinator from '../src/api/services/coordinator-workspace-service.js';
import committee from '../src/api/services/committee-workspace.js';
import form from '../src/shared/application-form.js';
const url=process.env.COORDINATOR_TEST_DATABASE_URL;

test('Coordinator Phase 1 review, retained corrections, schedule concurrency, scope and Committee bridge',{skip:!url},async t=>{
  const target=new URL(url);
  assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
  assert.match(target.pathname,/_test$/);assert.notEqual(url,process.env.DATABASE_URL);
  const schema='coord_'+randomUUID().replaceAll('-','');
  const runtimeRole='coord_runtime_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:url});let pool,runtime;
  const ids=()=>randomUUID(),actor=(userId,role,studentId)=>({isAuthenticated:true,userId,role,accountStatus:'ACTIVE',studentId});
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});
    for(const migration of readReviewedMigrations())await pool.query(migration.sql);
    // Exercise the service with the actual least-privilege runtime policy, not
    // the table owner's implicit permission to lock or modify every column.
    await pool.query('CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL)');
    await admin.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
    const grants=readFileSync(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8')
      .replace(/^\\set[^\n]*\n/m,'').replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema)
      .replaceAll("'public'","'"+schema+"'").replaceAll('coed_app',runtimeRole);
    await pool.query(grants);
    runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=${runtimeRole}`});
    const coordId=ids(),outsiderId=ids(),members=[ids(),ids(),ids()],studentId=ids(),studentUser=ids(),draftStudent=ids(),draftUser=ids(),cycle=ids();
    for(const [id,role] of [[coordId,'COORDINATOR'],[outsiderId,'COORDINATOR'],...members.map(id=>[id,'COMMITTEE']),[studentUser,'STUDENT'],[draftUser,'STUDENT']])
      await pool.query('INSERT INTO users(id,role) VALUES($1,$2)',[id,role]);
    await pool.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic review',2569,1,'OPEN','synthetic','public','mock')",[cycle]);
    for(const [sid,uid] of [[studentId,studentUser],[draftStudent,draftUser]])await pool.query(`INSERT INTO students
      (id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES($1,$2,$3,$3,'นักศึกษาสมมติ','test@example.invalid','CS','ภาคปกติ','CS',2569,'ACTIVE','synthetic','private','mock')`,[sid,uid,'S'+ids()]);
    const cohorts=[ids(),ids()];
    for(const [index,program] of ['ภาคปกติ','ภาคพิเศษ'].entries())await pool.query(`INSERT INTO selection_cohorts
      (id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS',$3,$4,$5,$6,$7)`,[cohorts[index],cycle,program,coordId,...members]);
    await pool.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[cycle]);
    await pool.query("INSERT INTO phase1_academic_profiles(student_id,curriculum,entry_year,institution,source,verified_by) VALUES($1,'66',2567,'TU_CS','synthetic',$2)",[studentId,coordId]);
    const policyId=ids();
    await pool.query(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data)
      VALUES($1,$2,'66',1,2568,'synthetic',true,true,$3)`,[policyId,cycle,JSON.stringify(faculty.policyData('66'))]);
    const coord=actor(coordId,'COORDINATOR'),student=actor(studentUser,'STUDENT',studentId),other=actor(outsiderId,'COORDINATOR');
    const appService=new application.ApplicationService({pool:runtime,allowSyntheticPolicy:true,documentStore:{downloadTarget:async()=>({url:'https://files.example.invalid/signed',method:'GET'})}});
    const review=new coordinator.CoordinatorWorkspaceService({pool:runtime,allowSyntheticPolicy:true});
    const board=new committee.CommitteeWorkspaceService({pool:runtime,allowSyntheticPolicy:true});
    const command=version=>({operation_id:ids(),expected_version:version});
    let app=await appService.create(student,{operation_id:ids(),cycle_id:cycle});
    const payload={academic_criteria_acknowledgement:faculty.ID,curriculum:'66',gpax:'3.12',declared_group_gpa:'2.8',gpax_reporting_term:'2/2568',name_prefix:'Mx',thai_full_name:'นักศึกษาสมมติ',english_full_name:'Synthetic Student',
      institutional_email:'test@example.invalid',contact_email:'contact@example.invalid',contact_address:'Original submitted address',contact_phone:'0000000000',major_group:'CIS',
      guardian_name:'Synthetic parent',guardian_relationship:'Parent',guardian_phone:'0000000000',guardian_address:'Synthetic address',interested_position_codes:['FRONTEND'],skills_detail:'คำตอบปลายเปิด\nJavaScript and testing',
      selected_courses:{alternative:'CS213'},course_attempts:form.GROUPS['66'].map(g=>({code:g[0],attempt:1,points:'3'})),additional_studies:{CS180:'ENROLLED',CS262:'STUDIED'},
      acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k=>[k,true]))};
    app=await appService.save(student,app.id,{...command(app.version),expected_policy_id:policyId,payload});
    const docs=[];
    for(const kind of ['resume','transcript','photo','conduct']){
      const id=ids(),ticket=ids(),filename=kind+'.'+(kind==='photo'?'png':'pdf'),contentType=kind==='photo'?'image/png':'application/pdf';docs.push(id);
      // Metadata fixtures only; byte/signature validation is covered by application upload tests.
      await pool.query(`INSERT INTO phase1_uploads(id,application_id,kind,filename,content_type,byte_size,checksum,staging_key,expected_version,status,expires_at)
        VALUES($1,$2,$3,$4,$5,10,$6,$7,$8,'ATTACHED',now()+interval '1 hour')`,[ticket,app.id,kind,filename,contentType,'0'.repeat(64),'staging/'+ticket,app.version]);
      await pool.query(`INSERT INTO phase1_documents(id,application_id,ticket_id,kind,filename,content_type,byte_size,checksum,object_key)
        VALUES($1,$2,$3,$4,$5,$6,10,$7,$8)`,[id,app.id,ticket,kind,filename,contentType,'0'.repeat(64),'final/'+id]);
      await pool.query('INSERT INTO phase1_attachments(application_id,kind,document_id) VALUES($1,$2,$3)',[app.id,kind,id]);
    }
    app=await appService.submit(student,app.id,{...command(app.version),expected_policy_id:policyId});
    const original=app.submission;
    const draftActor=actor(draftUser,'STUDENT',draftStudent);
    const draft=await appService.create(draftActor,{operation_id:ids(),cycle_id:cycle});
    const now=Date.now(),at=hours=>new Date(now+hours*3600000).toISOString();
    let schedule={...command(0),expected_window_version:1,opens_at:at(-24),closes_at:at(-2),review_opens_at:at(-1),review_closes_at:at(24),confirmation_opens_at:at(25),confirmation_closes_at:at(48)};
    await t.test('real assigned scope, complete filters/counts, no fabricated grades or applicant voting',async()=>{
      for(const sql of ["UPDATE selection_cohorts SET coordinator_id=coordinator_id WHERE false","UPDATE users SET role=role WHERE false","UPDATE phase1_submissions SET snapshot=snapshot WHERE false","DELETE FROM coordinator_operations WHERE false"])
        await assert.rejects(runtime.query(sql),e=>e.code==='42501');
      assert.equal((await review.options(coord)).cycles.length,1);
      const list=await review.list(coord,{search:'นักศึกษา',curriculum:'66',program_type:'regular',pageSize:'1'});
      assert.equal(list.total,1);assert.equal(list.counts.PENDING,1);assert.equal(list.applications[0].core,3);
      assert.equal((await review.detail(coord,app.id)).payload.skills_detail,payload.skills_detail);
      assert.equal((await review.list(other)).total,0);
      await assert.rejects(review.detail(other,app.id),e=>e.statusCode===404);
      await assert.rejects(review.options(student),e=>e.statusCode===403);
      await assert.rejects(review.list(coord,{state:'VOTED'}));
      const tracking=await review.tracking(coord,{cycle_id:cycle});assert.equal(tracking.meetings.length,1);assert.equal(tracking.meetings[0].members.length,3);
    });
    await t.test('audited idempotent schedule uses the real application window and stale writes fail',async()=>{
      const saved=await review.saveSchedule(coord,cycle,schedule);assert.equal(saved.version,1);
      assert.deepEqual(await review.saveSchedule(coord,cycle,schedule),saved);
      await assert.rejects(review.saveSchedule(coord,cycle,{...schedule,operation_id:ids()}),e=>e.statusCode===409);
      assert.equal((await review.getSchedule(coord,cycle)).window_version,2);
      assert.equal((await appService.get(draftActor,draft.id)).availability.can_edit,false);
      await assert.rejects(appService.create(draftActor,{operation_id:ids(),cycle_id:cycle}),e=>e.statusCode===422);
      await assert.rejects(appService.save(draftActor,draft.id,{...command(draft.version),expected_policy_id:policyId,payload:{contact_address:'blocked'}}),e=>e.statusCode===422);
    });
    let returnedBody;
    await t.test('return after initial closing unlocks only that correction and retains the submitted snapshot',async()=>{
      returnedBody={...command(0),submission_id:original.id,reason:'กรุณาตรวจที่อยู่\nและเอกสาร'};
      const result=await review.review(coord,app.id,returnedBody,'return');assert.equal(result.state,'RETURNED');
      assert.deepEqual(await review.review(coord,app.id,returnedBody,'return'),result);
      app=await appService.get(student,app.id);assert.equal(app.status,'NEEDS_REVISION');assert.equal(app.availability.can_edit,true);
      assert.equal(app.correction.reason,returnedBody.reason);
      app=await appService.save(student,app.id,{...command(app.version),expected_policy_id:policyId,payload:{contact_address:'Unsent corrected address'}});
      assert.equal(app.payload.contact_address,'Unsent corrected address');
      assert.equal((await review.detail(coord,app.id)).payload.contact_address,payload.contact_address);
      assert.equal((await appService.get(coord,app.id)).payload.contact_address,payload.contact_address);
      assert.equal((await pool.query('SELECT checksum FROM phase1_submissions WHERE id=$1',[original.id])).rows[0].checksum,original.checksum);
      await assert.rejects(pool.query("UPDATE phase1_submissions SET checksum=$2 WHERE id=$1",[original.id,'f'.repeat(64)]));
      await assert.rejects(pool.query('DELETE FROM coordinator_operations WHERE operation_id=$1',[returnedBody.operation_id]));
      assert.equal((await board.read(actor(members[0],'COMMITTEE'))).students.length,0);
    });
    await t.test('correction access closes at the consideration deadline, without opening ordinary Drafts',async()=>{
      await pool.query('UPDATE coordinator_round_schedules SET review_closes_at=clock_timestamp() WHERE cycle_id=$1',[cycle]);
      assert.equal((await appService.get(student,app.id)).availability.can_edit,false);
      assert.equal((await appService.readiness(student,app.id)).can_submit,false);
      await assert.rejects(appService.save(student,app.id,{...command(app.version),expected_policy_id:policyId,payload:{contact_address:'too late'}}),e=>e.statusCode===422);
      await assert.rejects(appService.submit(student,app.id,{...command(app.version),expected_policy_id:policyId}),e=>e.statusCode===422);
      await pool.query('UPDATE coordinator_round_schedules SET review_closes_at=$2 WHERE cycle_id=$1',[cycle,schedule.review_closes_at]);
      assert.equal((await appService.get(student,app.id)).availability.can_edit,true);
      assert.equal((await appService.get(draftActor,draft.id)).availability.can_edit,false);
    });
    await t.test('resubmit creates a new immutable version, returns to review, and rejects an old Coordinator command',async()=>{
      assert.equal((await appService.readiness(student,app.id)).can_submit,true);
      app=await appService.submit(student,app.id,{...command(app.version),expected_policy_id:policyId});
      assert.notEqual(app.submission.id,original.id);
      const detail=await review.detail(coord,app.id);assert.equal(detail.state,'PENDING');assert.equal(detail.submission_history.length,2);assert.equal(detail.review_version,2);
      assert.equal(detail.payload.contact_address,'Unsent corrected address');
      assert.equal(detail.review_history[0].result.reason,returnedBody.reason);
      await assert.rejects(review.review(coord,app.id,{...returnedBody,operation_id:ids()},'return'),e=>e.statusCode===409);
      assert.equal((await appService.get(student,app.id)).availability.can_edit,false);
    });
    await t.test('forwarding integrates genuine Phase 1 receipts, invalidates stale Committee state, never creates a legacy Plan',async()=>{
      const detail=await review.detail(coord,app.id),body={...command(detail.review_version),submission_id:detail.submission_id};
      await review.review(coord,app.id,body,'forward');
      const view=await board.read(actor(members[0],'COMMITTEE'));assert.equal(view.students.length,1);assert.equal(view.students[0].source,'PHASE1');assert.equal(view.students[0].core,3);
      assert.equal(view.version,1);assert.equal(Number((await pool.query('SELECT count(*) FROM plans')).rows[0].count),0);
      assert.equal((await review.tracking(coord,{cycle_id:cycle,sort:'core'})).total,1);
      await assert.rejects(review.review(coord,app.id,{...command(3),submission_id:app.submission.id,reason:'late'},'return'),e=>e.statusCode===422);
      await assert.rejects(board.mutate(actor(members[0],'COMMITTEE'),view.cohort_id,{...command(0),action:'propose',normal:1,special:0,reason:'stale'}),e=>e.statusCode===409);
    });
    await t.test('simultaneous schedule saves serialize, and a shared round does not grant cross-Coordinator write access',async()=>{
      const current=await review.getSchedule(coord,cycle);
      const body={...schedule,expected_version:current.version,expected_window_version:current.window_version};
      const results=await Promise.allSettled([review.saveSchedule(coord,cycle,{...body,operation_id:ids()}),review.saveSchedule(coord,cycle,{...body,operation_id:ids()})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.statusCode===409).length,1);
      await pool.query('UPDATE selection_cohorts SET coordinator_id=$2 WHERE id=$1',[cohorts[1],outsiderId]);
      const limited=(await review.tracking(coord,{cycle_id:cycle})).meetings[0];assert.equal(limited.scope_limited,true);assert.equal(limited.state,null);
      assert.equal((await review.getSchedule(coord,cycle)).can_edit,false);
      const latest=await review.getSchedule(coord,cycle);
      await assert.rejects(review.saveSchedule(coord,cycle,{...body,...command(latest.version),expected_window_version:latest.window_version}),e=>e.statusCode===403);
    });
  }finally{
    await runtime?.end();await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`);await admin.end();
  }
});
