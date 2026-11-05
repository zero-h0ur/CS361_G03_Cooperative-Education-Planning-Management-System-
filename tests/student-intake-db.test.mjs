import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id,createHash,generateKeyPairSync} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import pg from 'pg';
import {createObservedFixture} from './helpers/present-schema-fixture.mjs';
import {upgradeObservedSchema} from '../scripts/operations/present-schema-upgrade.mjs';
import {SQL_SHA256 as registrationSha} from '../scripts/operations/tu-registration-upgrade.mjs';
import {SQL_SHA256 as issuerSha,ISSUER} from '../scripts/operations/tu-registration-issuer-upgrade.mjs';
import {PROFILE,identifier} from '../scripts/operations/present-schema-baseline.mjs';
import applications from '../src/api/services/application-service.js';
import coordinators from '../src/api/services/coordinator-workspace-service.js';
import local from '../src/storage/local-document-store.js';
import form from '../src/shared/application-form.js';
import auth from '../src/auth/index.js';
import tu from '../src/auth/tu-auth-service.js';
import lambda from '../src/lambda.js';
import {readPendingIntakeSql} from '../scripts/operations/student-intake-contract.mjs';
import {readIntakeControlsSql} from '../scripts/operations/intake-controls-contract.mjs';
import controls from '../src/api/services/intake-control-service.js';
const url=process.env.STUDENT_INTAKE_TEST_DATABASE_URL;
test('pending TU identity: actual019/020 database, real files, pilot gates and immutable Coordinator delivery',{skip:!url&&!process.env.CI},async t=>{
 const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,'/coed_intake_test');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.INTAKE_DISPOSABLE,'true');
 const admin=new pg.Pool({connectionString:url}),schema='present_'+id().replaceAll('-',''),q=identifier(schema);
 const suffix=id().replaceAll('-',''),registrationOwner='intake_reg_owner_'+suffix,registrationRole='intake_reg_'+suffix;
 const owner=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});let runtime;
 const oldMode=process.env.COED_API_MAINTENANCE,oldPilot=process.env.COED_INTAKE_PILOT,oldOnboarding=process.env.TU_ONBOARDING_ENABLED,dir=mkdtempSync(join(tmpdir(),'coed-intake-test-'));
 const cycle=id(),cohort=id(),coord=id(),operator=id(),members=[id(),id(),id()];let actor,app;
 const command=()=>({operation_id:id(),expected_version:app.version});
 const restore=(key,value)=>{if(value===undefined)delete process.env[key];else process.env[key]=value;};
 try{
  process.env.TU_ONBOARDING_ENABLED='true';
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist');if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'")).rowCount)await admin.query('CREATE ROLE coed_app NOLOGIN');
  await admin.query('CREATE SCHEMA '+q);const setup=await owner.connect();
  try{await createObservedFixture(setup,schema);await upgradeObservedSchema({client:setup,profile:PROFILE,expectedDatabase:'coed_intake_test',expectedSchema:schema,mode:'apply',maintenanceApproved:true});}finally{setup.release();}
  await owner.query(readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8').replaceAll('public.',q+'.').replaceAll('SCHEMA public','SCHEMA '+q).replaceAll("'public'","'"+schema+"'"));
  // Only this disposable fixture adapts schema/role identifiers. The production
  // runners retain their strict fixed-role and catalog guards, unchanged.
  for(const [version,setting,value,checksum] of [
   ['019_tu_student_registration.sql','coed.registration_upgrade','observed018-to019',registrationSha],
   ['020_tu_registration_issuer_alignment.sql','coed.registration_issuer_upgrade','observed019-to020',issuerSha]]){
   const source=readFileSync(new URL('../src/db/upgrades/'+version,import.meta.url),'utf8');
   assert.equal(createHash('sha256').update(source).digest('hex'),checksum);
   const adapted=source.replaceAll('coed_tu_registration_owner',registrationOwner).replaceAll('coed_tu_registration',registrationRole)
    .replaceAll('public.',q+'.').replaceAll('SCHEMA public','SCHEMA '+q).replaceAll('pg_catalog,public','pg_catalog,'+q);
   const c=await owner.connect();try{
    await c.query('BEGIN');await c.query('SELECT set_config($1,$2,true)',[setting,value]);await c.query(adapted);
    await c.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  let history=(await owner.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
  const sql=readPendingIntakeSql();
  // Live rollout is NOT authorized; exercise both rollback trial and local apply.
  await assert.rejects(owner.query(sql),/PENDING_INTAKE_REVIEWED_OWNER_GATE_REQUIRED/);
  await owner.query('BEGIN');await owner.query("SET LOCAL coed.pending_intake_upgrade='observed020-to021'");await owner.query(sql);await owner.query('ROLLBACK');
  assert.equal((await owner.query("SELECT to_regclass(current_schema() || '.phase1_intake_routes') AS t")).rows[0].t,null);
  await owner.query('BEGIN');await owner.query("SET LOCAL coed.pending_intake_upgrade='observed020-to021'");await owner.query(sql);await owner.query('COMMIT');
  assert.deepEqual((await owner.query('SELECT * FROM schema_migrations ORDER BY version')).rows,history);
  for(const [uid,role] of [[coord,'COORDINATOR'],[operator,'ADMIN'],...members.map(x=>[x,'COMMITTEE'])])await owner.query('INSERT INTO users(id,role) VALUES($1,$2)',[uid,role]);
  await owner.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic pending intake',2569,1,'OPEN','synthetic','private','mock')",[cycle]);
  await owner.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CPE','CS',$3,$4,$5,$6)",[cohort,cycle,coord,...members]);
  await owner.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[cycle]);
  const identity={subject:'9900000061',nameTh:'Synthetic Student',nameEn:null,email:'student@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'ปกติ',statusId:null};
  const registered=(await owner.query(`SELECT * FROM ${q}.complete_tu_registration($1,$2,$3,$4,'special',2567,clock_timestamp()+interval '240 seconds')`,[ISSUER,id(),id(),identity])).rows[0];
  actor={isAuthenticated:true,userId:registered.user_id,studentId:registered.student_id,role:'STUDENT',accountStatus:'ACTIVE'};
  runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_app`});
  const store=new local.LocalDocumentStore({root:dir}),service=new applications.ApplicationService({pool:runtime,documentStore:store}),staff=new coordinators.CoordinatorWorkspaceService({pool:runtime});
  process.env.COED_INTAKE_PILOT=JSON.stringify({student_user_id:actor.userId,coordinator_user_id:coord,cycle_id:cycle});process.env.COED_API_MAINTENANCE='intake-draft';
  await t.test('private cycle stays hidden until owner publishes exact TU-source route; student cannot publish it',async()=>{
   assert.deepEqual((await service.options(actor)).cycles,[]);
   await assert.rejects(service.create(actor,{operation_id:id(),cycle_id:cycle}),e=>e.statusCode===404);
   await owner.query(`INSERT INTO phase1_intake_routes(id,cycle_id,cohort_id,tu_faculty,tu_department,program_type,curriculum,version,source,approved_by)
    VALUES($1,$2,$3,'Science','Computer Science','special','66',1,'synthetic reviewed source',$4)`,[id(),cycle,cohort,operator]);
   assert.equal((await service.options(actor)).cycles[0].id,cycle);
   await assert.rejects(runtime.query('UPDATE phase1_intake_routes SET active=false'),e=>e.code==='42501');
   await assert.rejects(runtime.query("UPDATE selection_cohorts SET created_at=clock_timestamp() WHERE id=$1",[cohort]),e=>e.code==='42501');
   await owner.query('DELETE FROM phase1_cycle_windows WHERE cycle_id=$1',[cycle]);
   try{await assert.rejects(service.create(actor,{operation_id:id(),cycle_id:cycle}),e=>e.statusCode===422);}
   finally{await owner.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[cycle]);}
  });
  const controller=new controls.IntakeControlService({pool:runtime}),coordinator={isAuthenticated:true,userId:coord,role:'COORDINATOR',accountStatus:'ACTIVE'};
  let controlState;
  const change=async(mode,extra={})=>{controlState=await controller.set(coordinator,cycle,{operation_id:id(),expected_version:controlState.control.version,mode,...extra});return controlState;};
  await t.test('forward controls proposal: owner gate, rolled-back trial, closed provisioning and no new runtime provisioning privilege',async()=>{
   await owner.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',['021_phase1_pending_intake.sql',createHash('sha256').update(sql).digest('hex')]);
   history=(await owner.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
   const controlsSql=readIntakeControlsSql();await assert.rejects(owner.query(controlsSql),/INTAKE_CONTROLS_OWNER_GATE_REQUIRED/);
   const c=await owner.connect();try{await c.query('BEGIN');await c.query("SET LOCAL coed.intake_controls_upgrade='observed021-controls'");await c.query(controlsSql);await c.query('ROLLBACK');
    assert.equal((await c.query("SELECT to_regclass(current_schema() || '.phase1_intake_controls') t")).rows[0].t,null);
    await c.query('BEGIN');await c.query("SET LOCAL coed.intake_controls_upgrade='observed021-controls'");await c.query(controlsSql);await c.query('COMMIT');
   }finally{c.release();}
   await owner.query("INSERT INTO phase1_intake_controls(cycle_id,mode,version,updated_by) VALUES($1,'CLOSED',1,$2)",[cycle,operator]);
   await assert.rejects(runtime.query("INSERT INTO phase1_intake_controls(cycle_id,mode,version,updated_by) VALUES($1,'CLOSED',1,$2)",[id(),coord]),e=>e.code==='42501');
   controlState=await controller.get(coordinator,cycle);assert.equal(controlState.control.is_open,false);assert.equal(controlState.can_control,true);
   await assert.rejects(service.create(actor,{operation_id:id(),cycle_id:cycle}),e=>e.statusCode===422);
   await assert.rejects(controller.set(actor,cycle,{operation_id:id(),expected_version:1,mode:'MANUAL_OPEN'}),e=>e.statusCode===403);
   await assert.rejects(controller.get({...coordinator,userId:id()},cycle),e=>e.statusCode===503);
  });
  await t.test('manual open uses server time and null deadline; retry replays one event; stale/scope failures cannot change it',async()=>{
   const body={operation_id:id(),expected_version:1,mode:'MANUAL_OPEN'};
   const results=await Promise.all([controller.set(coordinator,cycle,body),controller.set(coordinator,cycle,body)]);controlState=results[0];
   assert.equal(results[1].idempotent_replay,true);assert.equal(controlState.control.version,2);assert.equal(controlState.control.is_open,true);assert.equal(controlState.control.closes_at,null);
   assert.equal((await owner.query('SELECT count(*)::int n FROM phase1_intake_control_events WHERE cycle_id=$1',[cycle])).rows[0].n,1);
   await assert.rejects(controller.set(coordinator,cycle,{...body,operation_id:id()}),e=>e.code==='STALE_RECORD_CONFLICT');
   await assert.rejects(controller.set(coordinator,cycle,{...body,mode:'CLOSED'}),e=>e.code==='IDEMPOTENCY_KEY_REUSED');
   await assert.rejects(runtime.query('DELETE FROM phase1_intake_control_events'),e=>e.code==='42501');
   await assert.rejects(runtime.query(`INSERT INTO phase1_intake_control_events(cycle_id,operation_id,actor_id,previous_state,next_state) VALUES($1,$2,$3,'{}','{}')`,[cycle,id(),coord]),e=>e.code==='42501');
   assert.equal((await service.options(actor)).cycles[0].intake.mode,'MANUAL_OPEN');
   await owner.query("UPDATE phase1_cycle_windows SET closes_at=clock_timestamp()-interval '1 hour',opens_at=clock_timestamp()-interval '1 day' WHERE cycle_id=$1",[cycle]);
  });
  await t.test('partial assignment cannot control the whole round; required missing control fails closed, not legacy-open',async()=>{
   const outsider=id(),otherCohort=id();await owner.query("INSERT INTO users(id,role) VALUES($1,'COORDINATOR')",[outsider]);
   await owner.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CPE','CIS',$3,$4,$5,$6)",[otherCohort,cycle,outsider,...members]);
   try{assert.equal((await controller.get(coordinator,cycle)).can_control,false);await assert.rejects(change('CLOSED'),e=>e.statusCode===403);}
   finally{await owner.query('DELETE FROM selection_cohorts WHERE id=$1',[otherCohort]);}
   const required=process.env.COED_INTAKE_CONTROLS_REQUIRED;
   process.env.COED_INTAKE_CONTROLS_REQUIRED='true';
   const fakeDb={query:async sql=>({rows:sql.includes('to_regclass')?[{ready:true}]:[]})};
   try{const gate=await (await import('../src/db/intake-control.js')).default.effective(fakeDb,cycle,{is_open:true});assert.equal(gate.is_open,false);assert.equal(gate.intake.reason,'UNCONFIGURED');}
   finally{restore('COED_INTAKE_CONTROLS_REQUIRED',required);}
  });
  await t.test('Draft saves partial data, does not certify academics and is scoped before business writes',async()=>{
   const op={operation_id:id(),cycle_id:cycle};app=await service.create(actor,op);assert.equal((await service.create(actor,op)).id,app.id);
   app=await service.save(actor,app.id,{...command(),expected_policy_id:null,payload:{contact_address:'Synthetic address'}});
   assert.equal(app.official.academic_verified,false);assert.equal(app.official.program,null);assert.equal(app.official.registration.entry_year,2567);
   await assert.rejects(service.create({...actor,userId:id()},{operation_id:id(),cycle_id:cycle}),e=>e.code==='COED_MAINTENANCE');
   await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.code==='COED_MAINTENANCE');
   assert.equal((await owner.query('SELECT count(*)::int n FROM phase1_academic_profiles WHERE student_id=$1',[actor.studentId])).rows[0].n,0);
  });
  process.env.COED_API_MAINTENANCE='intake-upload';
  await t.test('close blocks ordinary Draft save/readiness/new upload; retained data and manual reopen are intact',async()=>{
   await change('CLOSED');const old=await service.get(actor,app.id);assert.equal(old.availability.can_edit,false);assert.equal(old.availability.intake.reason,'CLOSED');
   assert.equal((await service.list(actor))[0].availability.can_edit,false);
   await assert.rejects(service.save(actor,app.id,{...command(),expected_policy_id:null,payload:{skills_detail:'not saved'}}),e=>e.statusCode===422);
   assert.equal((await service.readiness(actor,app.id)).can_submit,false);
   await change('MANUAL_OPEN');assert.equal((await service.get(actor,app.id)).availability.can_edit,true);
  });
  const payload={curriculum:'66',name_prefix:'Mr',thai_full_name:'Synthetic Student',english_full_name:'Synthetic Student',contact_address:'Synthetic address',contact_phone:'0800000000',
   contact_email:'contact@example.invalid',major_group:'ACS',gpax:'3.2',declared_group_gpa:'3.0',gpax_reporting_term:'2/2568',interested_position_codes:['SOFTWARE'],skills_detail:'Synthetic skill',
   guardian_name:'Synthetic contact',guardian_relationship:'Parent',guardian_address:'Synthetic address',guardian_phone:'0800000001',
   selected_courses:{alternative:'CS213'},course_attempts:form.GROUPS['66'].map(g=>({code:g[0],attempt:1,points:'3'})),
   additional_studies:{CS180:'ENROLLED',CS262:'STUDIED'},acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k=>[k,true]))};
  await t.test('four real byte uploads finalize before policy exists; complete data is UNKNOWN not PASS',async()=>{
   app=await service.save(actor,app.id,{...command(),expected_policy_id:null,payload});
   for(const kind of ['resume','transcript','conduct','photo']){
    const bytes=kind==='photo'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5l0AAAAASUVORK5CYII=','base64'):Buffer.from('%PDF-1.4\nSynthetic document only\n%%EOF\n');
    const ticket=await service.beginUpload(actor,app.id,{...command(),kind,filename:kind+(kind==='photo'?'.png':'.pdf'),content_type:kind==='photo'?'image/png':'application/pdf',byte_size:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')});
    await service.localContent(actor,app.id,ticket.ticket_id,bytes);
    if(kind==='resume'){await change('CLOSED');await assert.rejects(service.completeUpload(actor,app.id,ticket.ticket_id,command()),e=>e.statusCode===422);await change('MANUAL_OPEN');}
    app=await service.completeUpload(actor,app.id,ticket.ticket_id,command());
   }
   const ready=await service.readiness(actor,app.id);assert.equal(ready.can_submit,true,JSON.stringify(ready));assert.equal(ready.eligibility,'UNKNOWN');assert.equal(ready.group_gpa,null);assert.equal(ready.destination.ready,true);
   await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.code==='COED_MAINTENANCE');
  });
  process.env.COED_API_MAINTENANCE='intake-pilot';
  await t.test('control audit failure rolls back state/receipt; scheduled future is closed; cycle lock serializes Close with Draft writes',async()=>{
   await owner.query(`CREATE FUNCTION reject_control_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic control audit failure' USING ERRCODE='23514';END $$;
    CREATE TRIGGER reject_control_audit BEFORE INSERT ON phase1_intake_control_events FOR EACH ROW EXECUTE FUNCTION reject_control_audit()`);
   await assert.rejects(change('CLOSED'),e=>e.code==='23514');assert.equal((await controller.get(coordinator,cycle)).control.version,controlState.control.version);
   await owner.query('DROP TRIGGER reject_control_audit ON phase1_intake_control_events;DROP FUNCTION reject_control_audit()');
   await change('SCHEDULED',{opens_at:new Date(Date.now()+3600000).toISOString(),closes_at:new Date(Date.now()+7200000).toISOString()});
   assert.equal((await service.options(actor)).cycles[0].intake.reason,'UPCOMING');
   await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.statusCode===422);
   await change('MANUAL_OPEN');
   const lock=await owner.connect();try{await lock.query('BEGIN');await lock.query("SELECT pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || $1::text,0))",[cycle]);
    const closing=change('CLOSED');await new Promise(r=>setTimeout(r,40));
    assert.equal((await controller.get(coordinator,cycle)).control.mode,'MANUAL_OPEN');await lock.query('COMMIT');await closing;
   }finally{await lock.query('ROLLBACK');lock.release();}
   await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.statusCode===422);await change('MANUAL_OPEN');
  });
  await t.test('route revocation fails closed; an audit failure rolls back the entire submission',async()=>{
   const publish=active=>owner.query(`INSERT INTO phase1_intake_routes(id,cycle_id,cohort_id,tu_faculty,tu_department,program_type,curriculum,version,active,source,approved_by)
    SELECT $1,$2,$3,'Science','Computer Science','special','66',max(version)+1,$4,'synthetic reviewed source',$5 FROM phase1_intake_routes WHERE cycle_id=$2`,[id(),cycle,cohort,active,operator]);
   await publish(false);await assert.rejects(service.readiness(actor,app.id),e=>e.statusCode===404);
   await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.statusCode===404);
   await publish(true);
   await owner.query(`CREATE FUNCTION reject_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     IF NEW.action='APPLICATION_SUBMITTED' THEN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='23514'; END IF;RETURN NEW;END $$;
     CREATE TRIGGER reject_intake_audit BEFORE INSERT ON phase1_events FOR EACH ROW EXECUTE FUNCTION reject_intake_audit()`);
   const op={...command(),expected_policy_id:null};
   await assert.rejects(service.submit(actor,app.id,op),e=>e.code==='23514');
   assert.equal((await service.get(actor,app.id)).status,'DRAFT');
   assert.equal((await owner.query('SELECT count(*)::int n FROM phase1_submissions WHERE application_id=$1',[app.id])).rows[0].n,0);
   assert.equal((await owner.query('SELECT count(*)::int n FROM phase1_submission_deliveries WHERE application_id=$1',[app.id])).rows[0].n,0);
   assert.equal((await owner.query('SELECT count(*)::int n FROM phase1_operations WHERE operation_id=$1',[op.operation_id])).rows[0].n,0);
   await owner.query('DROP TRIGGER reject_intake_audit ON phase1_events;DROP FUNCTION reject_intake_audit()');
  });
  await t.test('retry/racing identical Submit commits one unknown assessment and exact Coordinator receipt',async()=>{
   const op={...command(),expected_policy_id:null};const results=await Promise.all([service.submit(actor,app.id,op),service.submit(actor,app.id,op)]);app=results[0];
   assert.equal(app.status,'SUBMITTED');assert.equal(app.policy,null);assert.equal(app.assessment.eligibility,'UNKNOWN');assert.equal(app.submission.snapshot.contract_version,2);
   assert.equal(app.submission.snapshot.intake_control.mode,'MANUAL_OPEN');assert.equal(app.submission.snapshot.intake_control.closes_at,null);
   assert.equal(results[1].submission.id,app.submission.id);assert.equal(app.delivery_receipt.submission_id,app.submission.id);
   assert.equal((await owner.query('SELECT count(*)::int n FROM phase1_submissions WHERE application_id=$1',[app.id])).rows[0].n,1);
   const co={isAuthenticated:true,userId:coord,role:'COORDINATOR',accountStatus:'ACTIVE'},listed=await staff.list(co,{cycle_id:cycle});
   assert.equal(listed.applications[0].id,app.id);assert.equal(listed.applications[0].curriculum,'66');assert.equal(listed.applications[0].academic_source,'STUDENT_DECLARED');
   const detail=await staff.detail(co,app.id);assert.equal(detail.submission_id,app.submission.id);assert.equal(detail.checksum,app.submission.checksum);assert.equal(detail.can_review,false);assert.equal(detail.documents.length,4);
   await assert.rejects(staff.list({...co,userId:id()}),e=>e.code==='COED_MAINTENANCE');
   await assert.rejects(service.save(actor,app.id,{...command(),expected_policy_id:null,payload:{skills_detail:'tamper'}}),e=>e.statusCode===422);
  });
  await t.test('later policy publication cannot replace explicit null submitted policy; new pending record cannot be forwarded',async()=>{
   await owner.query(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data)
    VALUES($1,$2,'66',1,2568,'synthetic unverified',false,true,'{}')`,[id(),cycle]);
   assert.equal((await service.get(actor,app.id)).policy,null);
   process.env.COED_API_MAINTENANCE='off';
   await assert.rejects(staff.review({isAuthenticated:true,userId:coord,role:'COORDINATOR',accountStatus:'ACTIVE'},app.id,
    {operation_id:id(),expected_version:0,submission_id:app.submission.id},'forward'),e=>e.code==='ACADEMIC_REVIEW_REQUIRED');
   process.env.COED_API_MAINTENANCE='intake-pilot';
  });
  await t.test('real HTTP/Lambda adapter validates TU token and scoped Cognito claims against this pending submission',async()=>{
   const keys=generateKeyPairSync('rsa',{modulusLength:2048}),cognitoIssuer='https://cognito-idp.ap-southeast-2.amazonaws.com/synthetic_pool';
   await owner.query('INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,$3,$4)',[id(),coord,cognitoIssuer,'synthetic-coordinator']);
   const login=new tu.TuAuthService({pool:runtime,keyPair:keys,tuAppKey:'synthetic-only',tuSecretArn:'',issuer:ISSUER,clientId:'coed-api',
    fetchImpl:async()=>({ok:true,json:async()=>({status:true,type:'student',username:identity.subject})})});
   const token=(await login.login({studentId:identity.subject,password:'synthetic-only'})).accessToken;
   const validator=new auth.TokenValidator({expectedIssuer:cognitoIssuer,expectedClientId:'cognito-client',tuIssuer:ISSUER,tuClientId:'coed-api',tuPublicKey:keys.publicKey});
   const handler=lambda.createLambdaHandler({applicationService:service,coordinatorWorkspaceService:staff,
    authOptions:{pool:runtime,tokenValidator:validator,identityResolver:new auth.IdentityResolver({pool:runtime})}});
   const server=http.createServer(async(req,res)=>{
    try{
     const chunks=[];for await(const bytes of req)chunks.push(bytes);const u=new URL(req.url,'http://localhost');
     const context={http:{method:req.method}};
     // Models ONLY Gateway's trusted Cognito claims; this is not a live AWS login.
     if(req.headers.authorization==='Bearer synthetic-coordinator')context.authorizer={jwt:{claims:{iss:cognitoIssuer,sub:'synthetic-coordinator',client_id:'cognito-client',token_use:'access',scope:'coed-api/access',exp:Math.floor(Date.now()/1000)+600},scopes:['coed-api/access']}};
     const result=await handler({rawPath:u.pathname,rawQueryString:u.search.slice(1),requestContext:context,headers:req.headers,body:Buffer.concat(chunks).toString() || undefined});
     res.writeHead(result.statusCode,result.headers);res.end(result.body);
    }catch{res.writeHead(500);res.end('{}');}
   });
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,proxy='/api/tu-proxy/api/v4/applications';
   const request=async(path,bearer=token,method='GET',body,expected=200)=>{
    const response=await fetch(base+path,{method,headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result.data;
   };
   try{
    assert.equal((await request('/api/tu-proxy/api/v3/me')).studentId,actor.studentId);
    assert.equal((await request(proxy))[0].id,app.id);
    assert.equal((await request(proxy+'/'+app.id)).submission.id,app.submission.id);
    const listed=await request('/api/v4/coordinator/applications?cycle_id='+cycle,'synthetic-coordinator');assert.equal(listed.applications[0].id,app.id);
    assert.equal((await request('/api/v4/coordinator/applications/'+app.id,'synthetic-coordinator')).checksum,app.submission.checksum);
    await request(proxy+'/'+app.id,null,'GET',undefined,401);
    await request('/api/v4/coordinator/applications',token,'GET',undefined,401);
    await request('/api/v4/coordinator/applications/'+app.id+'/forward','synthetic-coordinator','POST',{},503);
    assert.equal((await request('/api/v4/coordinator/intake/'+cycle,'synthetic-coordinator')).control.mode,'MANUAL_OPEN');
    await request('/api/tu-proxy/api/v4/coordinator/intake/'+cycle,token,'POST',{},503);
    await request(proxy+'/'+app.id,token,'PATCH',{...command(),expected_policy_id:null,payload:{}},422);
   }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
  });
  await t.test('SQL rejects pretending pending study data is official or bypassing the legacy nonnull policy contract',async()=>{
   const forged=structuredClone(app.submission.snapshot);forged.official.program='CS';
   for(const [snapshot,contract] of [[forged,2],[app.submission.snapshot,1]]){
    await assert.rejects(runtime.query(`INSERT INTO phase1_submissions(id,application_id,application_version,policy_id,snapshot,checksum,submitted_by,contract_version)
      VALUES($1,$2,$3,NULL,$4,$5,$6,$7)`,[id(),app.id,app.version+1,snapshot,'a'.repeat(64),actor.userId,contract]),e=>e.code==='23514');
   }
   assert.deepEqual((await owner.query('SELECT * FROM schema_migrations ORDER BY version')).rows,history);
  });
  await t.test('canonical returned corrections ignore manual Close but never outlive the original review deadline; snapshots stay immutable',async()=>{
   const oldPilot=process.env.COED_INTAKE_PILOT,oldMode=process.env.COED_API_MAINTENANCE;
   const uid=id(),sid=id(),policyId=id();
   await owner.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')",[uid]);
   await owner.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
    VALUES($1,$2,$3,$3,'Synthetic Student','canonical@example.invalid','CPE','CS','ACS',2567,'ACTIVE','synthetic','private','mock')`,[sid,uid,'S'+id()]);
   await owner.query("INSERT INTO phase1_academic_profiles(student_id,curriculum,entry_year,institution,source,verified_by) VALUES($1,'66',2567,'TU_CS','synthetic',$2)",[sid,coord]);
   await owner.query(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data) VALUES($1,$2,'66',2,2568,'synthetic',true,true,$3)`,[policyId,cycle,
    {credits:Object.fromEntries(form.GROUPS['66'].flat().map(c=>[c,'3'])),repeat_rule:'LATEST',alternative_rule:'STUDENT_SELECTED'}]);
   await owner.query(`INSERT INTO coordinator_round_schedules(cycle_id,review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by)
    VALUES($1,now()-interval '1 hour',now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours',1,$2)`,[cycle,coord]);
   const student={...actor,userId:uid,studentId:sid},canonicalService=new applications.ApplicationService({pool:runtime,allowSyntheticPolicy:true,documentStore:store});
   try{process.env.COED_API_MAINTENANCE='off';
    let draft=await canonicalService.create(student,{operation_id:id(),cycle_id:cycle});
    draft=await canonicalService.save(student,draft.id,{operation_id:id(),expected_version:draft.version,expected_policy_id:policyId,payload:{...payload,institutional_email:'canonical@example.invalid'}});
    for(const kind of ['resume','transcript','conduct','photo']){
     const bytes=kind==='photo'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5l0AAAAASUVORK5CYII=','base64'):Buffer.from('%PDF-1.4\nSynthetic only\n%%EOF\n');
     const ticket=await canonicalService.beginUpload(student,draft.id,{operation_id:id(),expected_version:draft.version,kind,filename:kind+(kind==='photo'?'.png':'.pdf'),content_type:kind==='photo'?'image/png':'application/pdf',byte_size:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')});
     await canonicalService.localContent(student,draft.id,ticket.ticket_id,bytes);draft=await canonicalService.completeUpload(student,draft.id,ticket.ticket_id,{operation_id:id(),expected_version:draft.version});
    }
    draft=await canonicalService.submit(student,draft.id,{operation_id:id(),expected_version:draft.version,expected_policy_id:policyId});const original=draft.submission;
    await staff.review(coordinator,draft.id,{operation_id:id(),expected_version:0,submission_id:original.id,reason:'Synthetic correction'},'return');
    await change('CLOSED');draft=await canonicalService.get(student,draft.id);assert.equal(draft.availability.can_edit,true);assert.equal(draft.availability.intake.mode,'CLOSED');assert.equal(draft.availability.exception,'RETURNED');
    draft=await canonicalService.save(student,draft.id,{operation_id:id(),expected_version:draft.version,expected_policy_id:policyId,payload:{skills_detail:'Synthetic corrected skill'}});
    draft=await canonicalService.submit(student,draft.id,{operation_id:id(),expected_version:draft.version,expected_policy_id:policyId});
    assert.equal(draft.submission.snapshot.intake_control.exception,'RETURNED');assert.equal(draft.submission.snapshot.intake_control.mode,'CLOSED');
    assert.equal((await owner.query('SELECT checksum FROM phase1_submissions WHERE id=$1',[original.id])).rows[0].checksum,original.checksum);
    await staff.review(coordinator,draft.id,{operation_id:id(),expected_version:2,submission_id:draft.submission.id,reason:'Synthetic second correction'},'return');
    await owner.query("UPDATE coordinator_round_schedules SET review_opens_at=now()-interval '2 hours',review_closes_at=now()-interval '1 hour',version=version+1 WHERE cycle_id=$1",[cycle]);
    await change('MANUAL_OPEN');draft=await canonicalService.get(student,draft.id);assert.equal(draft.availability.can_edit,false);
    await assert.rejects(canonicalService.save(student,draft.id,{operation_id:id(),expected_version:draft.version,expected_policy_id:policyId,payload:{skills_detail:'late'}}),e=>e.statusCode===422);
   }finally{restore('COED_API_MAINTENANCE',oldMode);restore('COED_INTAKE_PILOT',oldPilot);}
  });
  await t.test('compatible browse fallback retains pending evidence and closes all writes and staff reads',async()=>{
   process.env.COED_API_MAINTENANCE='browse';
   const retained=await service.get(actor,app.id);
   assert.equal(retained.access.read_only,true);assert.equal(retained.policy,null);
   assert.equal(retained.submission.checksum,app.submission.checksum);assert.equal(retained.documents.length,4);
   await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.code==='COED_MAINTENANCE');
   await assert.rejects(staff.detail({isAuthenticated:true,userId:coord,role:'COORDINATOR',accountStatus:'ACTIVE'},app.id),e=>e.code==='COED_MAINTENANCE');
  });
 }finally{
  restore('COED_API_MAINTENANCE',oldMode);restore('COED_INTAKE_PILOT',oldPilot);restore('TU_ONBOARDING_ENABLED',oldOnboarding);
  if(runtime)await runtime.end();await owner.end();await admin.query('DROP SCHEMA IF EXISTS '+q+' CASCADE');
  for(const role of [registrationRole,registrationOwner])if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){
   await admin.query('DROP OWNED BY '+identifier(role));await admin.query('DROP ROLE '+identifier(role));
  }
  await admin.end();rmSync(dir,{recursive:true,force:true});
 }
});
