import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id,generateKeyPairSync,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import pg from 'pg';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import api from '../src/api/app.js';
import auth from '../src/auth/index.js';
import tu from '../src/auth/tu-auth-service.js';
import relink from '../src/auth/tu-identity-relink.js';
import application from '../src/api/services/application-service.js';
import coordinator from '../src/api/services/coordinator-workspace-service.js';
import selection from '../src/api/services/selection-service.js';
import schedules from '../src/api/services/phase1-schedule-service.js';
import form from '../src/shared/application-form.js';
import splitIssuer from '../src/tu-session-issuer.js';
import splitBroker from '../src/auth/tu-broker-service.js';
import {createObservedFixture} from './helpers/present-schema-fixture.mjs';
import {upgradeObservedSchema} from '../scripts/operations/present-schema-upgrade.mjs';
import {PROFILE} from '../scripts/operations/present-schema-baseline.mjs';

const url=process.env.TU_DELIVERY_TEST_DATABASE_URL;
test('TU Student to Cognito Coordinator: real HTTP, isolated PostgreSQL and least privilege',{skip:!url && !process.env.CI},async t=>{
  const target=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.match(target.pathname,/_test$/);assert.notEqual(url,process.env.DATABASE_URL);
  assert.equal(process.env.NODE_ENV,'test');
  const observed=process.env.TU_DELIVERY_TEST_BASELINE==='observed-current';
  const schema=(observed?'present_':'tu_delivery_')+id().replaceAll('-',''),role='tu_runtime_'+id().replaceAll('-','');
  const admin=new pg.Pool({connectionString:url});let db,runtime,server,connection;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);db=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});
    if(observed){
      assert.equal(target.port,'55440');assert.equal(target.pathname,'/coed_present_test');
      assert.equal(process.env.PRESENT_SCHEMA_DISPOSABLE,'true');
      await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
      if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'")).rowCount)await admin.query('CREATE ROLE coed_app NOLOGIN');
      const bootstrap=await db.connect();try{
        await createObservedFixture(bootstrap,schema);
        await upgradeObservedSchema({client:bootstrap,profile:PROFILE,expectedDatabase:'coed_present_test',expectedSchema:schema,mode:'apply',maintenanceApproved:true});
      }finally{bootstrap.release();}
    }else{
      for(const migration of readReviewedMigrations())await db.query(migration.sql);
      await db.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL)');
    }
    await admin.query(`CREATE ROLE ${role} NOLOGIN`);
    const grants=readFileSync(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8').replace(/^\\set[^\n]*\n/m,'')
      .replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema).replaceAll("'public'","'"+schema+"'").replaceAll('coed_app',role);
    await db.query(grants);runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=${role}`});
    const studentUser=id(),sid=id(),otherUser=id(),otherSid=id(),coord=id(),outsider=id(),operator=id(),members=[id(),id(),id()],cycle=id(),cohort=id(),policy=id(),oldLink=id();
    const cognitoIssuer='https://cognito-idp.ap-southeast-2.amazonaws.com/synthetic_pool',tuIssuer='urn:coed:tu-auth',number='9900000001';
    for(const [uid,r] of [[studentUser,'STUDENT'],[otherUser,'STUDENT'],[coord,'COORDINATOR'],[outsider,'COORDINATOR'],[operator,'ADMIN'],...members.map(x=>[x,'COMMITTEE'])])await db.query('INSERT INTO users(id,role) VALUES($1,$2)',[uid,r]);
    for(const [student,user,n] of [[sid,studentUser,number],[otherSid,otherUser,'9900000002']])await db.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES($1,$2,$3,$3,'นักศึกษาสมมติ','test@example.invalid','CS','regular','CS',2567,'ACTIVE','synthetic','private','mock')`,[student,user,n]);
    await db.query('INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,$3,$4)',[oldLink,studentUser,cognitoIssuer,'old-synthetic-student']);
    for(const [user,issuer,sub] of [[otherUser,tuIssuer,'9900000002'],[coord,cognitoIssuer,'coordinator'],[outsider,cognitoIssuer,'outsider']])await db.query('INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,$3,$4)',[id(),user,issuer,sub]);
    await db.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic delivery',2569,1,'OPEN','synthetic','public','mock')",[cycle]);
    await db.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS','regular',$3,$4,$5,$6)",[cohort,cycle,coord,...members]);
    await db.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[cycle]);
    await db.query("INSERT INTO phase1_academic_profiles(student_id,curriculum,entry_year,institution,source,verified_by) VALUES($1,'66',2567,'TU_CS','synthetic',$2)",[sid,operator]);
    await db.query(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data) VALUES($1,$2,'66',1,2568,'synthetic',true,true,$3)`,[policy,cycle,JSON.stringify({credits:Object.fromEntries(form.GROUPS['66'].flat().map(c=>[c,'3'])),repeat_rule:'LATEST',alternative_rule:'STUDENT_SELECTED'})]);
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});
    const login=new tu.TuAuthService({pool:runtime,keyPair:keys,tuAppKey:'synthetic-only',tuSecretArn:'',issuer:tuIssuer,clientId:'coed-api',fetchImpl:async(_url,request)=>({ok:true,json:async()=>({status:true,type:'student',username:JSON.parse(request.body).UserName})})});
    connection=await db.connect();
    await t.test('controlled relink: trial rollback, forged proof rejection, audited apply and idempotent replay preserve UUIDs',async()=>{
      const proof=await login.verifyWithRealTuApi(number,'synthetic'),args={connection,verifier:login,proof,operatorId:operator,userId:studentUser,studentId:sid,oldLinkId:oldLink,oldIssuer:cognitoIssuer,operationId:id()};
      const before=(await db.query('SELECT * FROM students WHERE id=$1',[sid])).rows[0];
      assert.equal((await relink.relinkTuIdentity(args)).applied,false);
      assert.equal((await db.query('SELECT status FROM external_identity_links WHERE id=$1',[oldLink])).rows[0].status,'ACTIVE');
      await assert.rejects(relink.relinkTuIdentity({...args,proof:{...proof}}),e=>e.code==='TU_PROOF_REQUIRED');
      await assert.rejects(relink.relinkTuIdentity({...args,studentId:otherSid}),e=>e.statusCode===403);
      await assert.rejects(relink.relinkTuIdentity({...args,oldLinkId:id()}),e=>e.code==='TU_LINK_CONFLICT');
      await db.query("UPDATE users SET account_status='DISABLED' WHERE id=$1",[studentUser]);
      await assert.rejects(relink.relinkTuIdentity({...args,apply:true}),e=>e.statusCode===403);
      await db.query("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[studentUser]);
      const failingConnection={query:(sql,...params)=>{if(sql.includes('INSERT INTO tu_identity_link_events'))throw Error('synthetic relink audit failure');return connection.query(sql,...params);}};
      await assert.rejects(relink.relinkTuIdentity({...args,connection:failingConnection,apply:true}),/synthetic relink audit failure/);
      assert.equal((await db.query('SELECT status FROM external_identity_links WHERE id=$1',[oldLink])).rows[0].status,'ACTIVE');
      const linked=await relink.relinkTuIdentity({...args,apply:true});assert.equal(linked.applied,true);
      assert.equal((await relink.relinkTuIdentity({...args,apply:true})).idempotentReplay,true);
      await assert.rejects(relink.relinkTuIdentity({...args,operationId:id(),apply:true}),e=>e.code==='TU_LINK_CONFLICT');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM tu_identity_link_events')).rows[0].n,1);
      assert.deepEqual((await db.query('SELECT * FROM students WHERE id=$1',[sid])).rows[0],before);
      await assert.rejects(new auth.IdentityResolver({pool:runtime}).resolveIdentity(cognitoIssuer,'old-synthetic-student'),e=>e.statusCode===403);
      await assert.rejects(runtime.query('DELETE FROM tu_identity_link_events WHERE false'),e=>e.code==='42501');
    });
    // Write-once byte store: no fixture metadata masquerading as uploaded files.
    const staging=new Map(),final=new Map();
    const store={local:true,uploadTarget:async({applicationId,ticketId})=>({url:`/api/v4/applications/${applicationId}/uploads/${ticketId}/content`,method:'PUT',auth_required:true}),
      downloadTarget:async({applicationId,documentId})=>({url:`/api/v4/applications/${applicationId}/documents/${documentId}/content`,method:'GET',auth_required:true}),
      writeStaging:async(k,b)=>{if(staging.has(k))assert.deepEqual(staging.get(k),b);staging.set(k,b);},readStaging:async k=>staging.get(k),
      writeFinal:async(k,b)=>{assert.equal(final.has(k),false);final.set(k,b);},readFinal:async k=>final.get(k)};
    const service=new application.ApplicationService({pool:runtime,documentStore:store,allowSyntheticPolicy:true});
    const validator=new auth.TokenValidator({expectedIssuer:cognitoIssuer,expectedClientId:'cognito-client',tuIssuer,tuClientId:'coed-api',tuPublicKey:keys.publicKey});
    // Actual split broker/issuer logic with a synthetic IAM transport and real DB.
    const issuerArn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:candidate';
    const issuer=splitIssuer.createTuSessionIssuer({pool:runtime,targetArn:issuerArn,getKeys:async()=>keys,logger:()=>{}});
    const broker=new splitBroker.TuBrokerService({verifier:login,targetArn:issuerArn,publicKey:keys.publicKey,
      client:{send:async command=>({StatusCode:200,ExecutedVersion:'1',Payload:Buffer.from(JSON.stringify(await issuer(
        JSON.parse(Buffer.from(command.input.Payload).toString()),{invokedFunctionArn:issuerArn,functionVersion:'1'})))})}});
    const handler=api.createRequestHandler(undefined,{tuAuthService:{isRealApiConfigured:()=>broker.isRealApiConfigured(),login:body=>broker.login(body,id())},applicationService:service,
      selectionService:new selection.SelectionService({pool:runtime}),
      phase1ScheduleService:new schedules.Phase1ScheduleService({pool:runtime}),
      coordinatorWorkspaceService:new coordinator.CoordinatorWorkspaceService({pool:runtime,allowSyntheticPolicy:true}),
      authOptions:{pool:runtime,tokenValidator:validator,identityResolver:new auth.IdentityResolver({pool:runtime})}});
    server=http.createServer((req,res)=>{
      // Simulate only the Gateway's trusted Cognito authorizer output, not a role bypass.
      const sub={'Bearer synthetic-coordinator':'coordinator','Bearer synthetic-outsider':'outsider'}[req.headers.authorization];
      if(sub)req.requestContext={authorizer:{jwt:{claims:{iss:cognitoIssuer,sub,client_id:'cognito-client',token_use:'access',scope:'coed-api/access',exp:Math.floor(Date.now()/1000)+600},scopes:['coed-api/access']}}};
      handler(req,res);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const request=async(path,{method='GET',body,token,expected=200,bytes}={})=>{
      const res=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:bytes || (body?JSON.stringify(body):undefined)});
      const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data.data;
    };
    const logged=await request('/api/v3/auth/tu-login',{method:'POST',body:{studentId:number,password:'synthetic'}}),token=logged.accessToken;
    assert.equal(logged.profile.program,'regular');const proxy='/api/tu-proxy/api/v4/applications';
    const session=await request('/api/tu-proxy/api/v3/me',{token});assert.equal(session.studentId,sid);assert.equal(session.role,'STUDENT');
    const cmd=version=>({operation_id:id(),expected_version:version});
    let app=await request(proxy,{method:'POST',token,body:{operation_id:id(),cycle_id:cycle}});
    const payload={curriculum:'66',gpax:'3.12',declared_group_gpa:'2.8',gpax_reporting_term:'2/2568',name_prefix:'Mx',thai_full_name:'นักศึกษาสมมติ',english_full_name:'Synthetic Student',institutional_email:'test@example.invalid',contact_email:'contact@example.invalid',contact_address:'Synthetic address',contact_phone:'0000000000',major_group:'CIS',guardian_name:'Synthetic parent',guardian_relationship:'Parent',guardian_phone:'0000000000',guardian_address:'Synthetic address',interested_position_codes:['FRONTEND'],skills_detail:'Free text\nTesting',selected_courses:{alternative:'CS213'},course_attempts:form.GROUPS['66'].map(g=>({code:g[0],attempt:1,points:'3'})),additional_studies:{CS180:'ENROLLED',CS262:'STUDIED'},acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k=>[k,true]))};
    app=await request(`${proxy}/${app.id}`,{method:'PATCH',token,body:{...cmd(app.version),expected_policy_id:policy,payload}});
    const pdf=Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    await t.test('all four actual uploads complete through the TU bridge',async()=>{
      for(const kind of ['resume','transcript','conduct','photo']) {
        const bytes=kind==='photo'?png:pdf;
        const ticket=await request(`${proxy}/${app.id}/uploads`,{method:'POST',token,body:{...cmd(app.version),kind,filename:kind+(kind==='photo'?'.png':'.pdf'),content_type:kind==='photo'?'image/png':'application/pdf',byte_size:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')}});
        assert.ok(ticket.upload.url.startsWith('/api/tu-proxy/'));
        await request(ticket.upload.url,{method:'PUT',token,bytes});
        app=await request(`${proxy}/${app.id}/uploads/${ticket.ticket_id}/complete`,{method:'POST',token,body:cmd(app.version)});
      }
      assert.equal(app.documents.length,4);assert.equal(final.size,4);
    });
    await t.test('receiver unavailable blocks Submit, not Draft persistence or academic result',async()=>{
      await db.query("UPDATE users SET account_status='DISABLED',version=version+1 WHERE id=$1",[coord]);
      const ready=await request(`${proxy}/${app.id}/readiness`,{token});assert.equal(ready.can_submit,false);assert.ok(ready.blockers.some(b=>b.field==='destination'));
      await request(`${proxy}/${app.id}/submit`,{method:'POST',token,body:{...cmd(app.version),expected_policy_id:policy},expected:409});
      assert.equal((await request(`${proxy}/${app.id}`,{token})).status,'DRAFT');
      await db.query("UPDATE users SET account_status='ACTIVE',version=version+1 WHERE id=$1",[coord]);
    });
    const submissionCommand={...cmd(app.version),expected_policy_id:policy};
    await t.test('failure after snapshot/delivery rolls back everything; retry and concurrent duplicate commit once',async()=>{
      const failPool={connect:async()=>{const c=await runtime.connect();return {release:()=>c.release(),query:(sql,...args)=>{if(sql.includes('INSERT INTO phase1_events'))throw Error('synthetic fault after receipt');return c.query(sql,...args);}};}};
      await assert.rejects(new application.ApplicationService({pool:failPool,documentStore:store,allowSyntheticPolicy:true}).submit({isAuthenticated:true,userId:studentUser,studentId:sid,role:'STUDENT',accountStatus:'ACTIVE'},app.id,submissionCommand));
      for(const table of ['phase1_submissions','phase1_submission_deliveries'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
      const results=await Promise.all([request(`${proxy}/${app.id}/submit`,{method:'POST',token,body:submissionCommand}),request(`${proxy}/${app.id}/submit`,{method:'POST',token,body:submissionCommand})]);
      app=results[0];assert.equal(app.status,'SUBMITTED');assert.equal(app.delivery_receipt.application_id,app.id);assert.equal(app.delivery_receipt.submission_id,app.submission.id);
      assert.equal(app.delivery_receipt.application_version,app.version);assert.equal(results[1].submission.id,app.submission.id);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM phase1_submission_deliveries')).rows[0].n,1);
      // Lost response after COMMIT: replay the exact command, not a new browser submission.
      assert.equal((await request(`${proxy}/${app.id}/submit`,{method:'POST',token,body:submissionCommand})).submission.id,app.submission.id);
    });
    await t.test('a separate Cognito Coordinator refreshes the same ID and byte-verified documents',async()=>{
      const list=await request('/api/v4/coordinator/applications',{token:'synthetic-coordinator'});assert.equal(list.total,1);assert.equal(list.applications[0].id,app.id);
      const detail=await request('/api/v4/coordinator/applications/'+app.id,{token:'synthetic-coordinator'});assert.equal(detail.submission_id,app.submission.id);
      for(const doc of app.documents) {
        const link=await request(`/api/v4/applications/${app.id}/documents/${doc.id}/download`,{method:'POST',token:'synthetic-coordinator',body:{}});
        const response=await fetch(base+link.download.url,{headers:{Authorization:'Bearer synthetic-coordinator'}});assert.equal(response.status,200);
        assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),doc.checksum);
      }
      const refreshed=await request(`${proxy}/${app.id}`,{token});assert.equal(refreshed.delivery_receipt.submission_id,app.submission.id);
    });
    await t.test('main selection and schedule endpoints traverse TU bridge with real DB ownership',async()=>{
      const list=await request('/api/tu-proxy/api/v3/student/selection',{token});
      assert.equal(list.applications.length,1);assert.equal(list.applications[0].application_id,app.id);
      assert.equal(list.applications[0].source,'phase1');assert.equal(list.applications[0].state,'AWAITING_COORDINATOR');
      assert.equal((await request(`/api/tu-proxy/api/v4/cycles/${cycle}/selection-decision`,{token})).has_result,false);
      assert.equal((await request(`/api/tu-proxy/api/v4/cycles/${cycle}/schedule`,{token})).cycle_id,cycle);
      assert.deepEqual((await request('/api/tu-proxy/api/v4/notifications?unread_only=false',{token})).notifications,[]);
      await request(`/api/tu-proxy/api/v4/cycles/${cycle}/announce`,{method:'POST',token,body:{},expected:404});
      await request(`/api/tu-proxy/api/v4/cycles/${cycle}/schedule`,{method:'PUT',token,body:{},expected:404});
    });
    await t.test('ownership, bridge roles and current assignment remain enforced after profile change/reassignment',async()=>{
      await request(`${proxy}/${app.id}`,{expected:401});
      const other=await login.login({studentId:'9900000002',password:'synthetic'});
      await request(`${proxy}/${app.id}`,{token:other.accessToken,expected:404});
      await request('/api/tu-proxy/api/v4/coordinator/applications',{token,expected:404});
      await request('/api/tu-proxy/api/v3/plans',{token,expected:404});
      await request('/api/v4/coordinator/applications/'+app.id,{token:'synthetic-outsider',expected:404});
      await db.query("UPDATE students SET program='special',version=version+1 WHERE id=$1",[sid]);
      assert.equal((await request('/api/v4/coordinator/applications',{token:'synthetic-coordinator'})).total,1);
      await db.query('UPDATE selection_cohorts SET coordinator_id=$2 WHERE id=$1',[cohort,outsider]);
      assert.equal((await request('/api/v4/coordinator/applications',{token:'synthetic-coordinator'})).total,0);
      await request(`/api/v4/applications/${app.id}`,{token:'synthetic-coordinator',expected:404});
      assert.equal((await request('/api/v4/coordinator/applications',{token:'synthetic-outsider'})).total,1);
      await assert.rejects(runtime.query('UPDATE phase1_submission_deliveries SET program=program WHERE false'),e=>e.code==='42501');
      await assert.rejects(runtime.query("INSERT INTO tu_identity_link_events(operation_id) VALUES($1)",[id()]),e=>e.code==='42501');
    });
    await t.test('return remains in original scope; conflicting profile blocks resubmit; corrected revision retains old evidence',async()=>{
      const first=app,detail=await request('/api/v4/coordinator/applications/'+app.id,{token:'synthetic-outsider'});
      await request(`/api/v4/coordinator/applications/${app.id}/return`,{method:'POST',token:'synthetic-outsider',body:{operation_id:id(),expected_version:detail.review_version,submission_id:app.submission.id,reason:'Synthetic correction'}});
      app=await request(`${proxy}/${app.id}`,{token});assert.equal(app.status,'NEEDS_REVISION');
      const readiness=await request(`${proxy}/${app.id}/readiness`,{token});assert.equal(readiness.can_submit,false);assert.ok(readiness.blockers.some(b=>b.code==='APPLICATION_DESTINATION_CHANGED'));
      await request(`${proxy}/${app.id}/submit`,{method:'POST',token,body:{...cmd(app.version),expected_policy_id:policy},expected:409});
      await db.query("UPDATE students SET program='regular',version=version+1 WHERE id=$1",[sid]);
      app=await request(`${proxy}/${app.id}`,{method:'PATCH',token,body:{...cmd(app.version),expected_policy_id:policy,payload:{contact_address:'New unsent correction'}}});
      const before=await request('/api/v4/coordinator/applications/'+app.id,{token:'synthetic-outsider'});assert.equal(before.payload.contact_address,payload.contact_address);
      app=await request(`${proxy}/${app.id}/submit`,{method:'POST',token,body:{...cmd(app.version),expected_policy_id:policy}});
      assert.notEqual(app.submission.id,first.submission.id);assert.equal(app.submission.snapshot.delivery.cohort_id,cohort);
      assert.equal(app.submission.snapshot.delivery.coordinator_id,outsider);
      assert.equal((await db.query('SELECT checksum FROM phase1_submissions WHERE id=$1',[first.submission.id])).rows[0].checksum,first.submission.checksum);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM phase1_submission_deliveries')).rows[0].n,2);
      assert.equal((await request('/api/v4/coordinator/applications/'+app.id,{token:'synthetic-outsider'})).state,'PENDING');
    });
    await t.test('missing delivery upgrade returns an explicit 503 without inventing application data',async()=>{
      await db.query('ALTER TABLE phase1_submission_deliveries RENAME TO held_delivery_test');
      try {
        await request(`${proxy}/${app.id}`,{token,expected:503});
        await request('/api/v4/coordinator/applications',{token:'synthetic-outsider',expected:503});
        assert.equal((await db.query('SELECT count(*)::int AS n FROM held_delivery_test')).rows[0].n,2);
      } finally {await db.query('ALTER TABLE held_delivery_test RENAME TO phase1_submission_deliveries');}
    });
    await t.test('concurrent reassignment fails safely; same-operation retry uses the fresh Coordinator',async()=>{
      const round=id(),receiver=id(),criteria=id();
      await db.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic assignment race',2569,2,'OPEN','synthetic','public','mock')",[round]);
      await db.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS','regular',$3,$4,$5,$6)",[receiver,round,coord,...members]);
      await db.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[round]);
      await db.query('INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data) SELECT $1,$2,curriculum,version,source_year,source,verified,synthetic,data FROM phase1_policies WHERE id=$3',[criteria,round,policy]);
      let race=await request(proxy,{method:'POST',token,body:{operation_id:id(),cycle_id:round}});
      race=await request(`${proxy}/${race.id}`,{method:'PATCH',token,body:{...cmd(race.version),expected_policy_id:criteria,payload}});
      for(const kind of ['resume','transcript','conduct','photo']) {
        const bytes=kind==='photo'?png:pdf;
        const ticket=await request(`${proxy}/${race.id}/uploads`,{method:'POST',token,body:{...cmd(race.version),kind,filename:kind+(kind==='photo'?'.png':'.pdf'),content_type:kind==='photo'?'image/png':'application/pdf',byte_size:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')}});
        await request(ticket.upload.url,{method:'PUT',token,bytes});
        race=await request(`${proxy}/${race.id}/uploads/${ticket.ticket_id}/complete`,{method:'POST',token,body:cmd(race.version)});
      }
      const locker=await db.connect(),submitBody={...cmd(race.version),expected_policy_id:criteria};let pending,observed=false;
      try {
        await locker.query('BEGIN');await locker.query('SELECT id FROM selection_cohorts WHERE id=$1 FOR UPDATE',[receiver]);
        // Capture result instead of throwing while the test deliberately holds a lock.
        pending=fetch(base+`${proxy}/${race.id}/submit`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(submitBody)})
          .then(async response=>({status:response.status,body:await response.json()}));
        const until=Date.now()+5000;
        while(Date.now()<until) {
          const wait=await db.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM selection_cohorts c JOIN users u%'");
          if(wait.rows[0].n){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
        }
        await locker.query('UPDATE selection_cohorts SET coordinator_id=$2 WHERE id=$1',[receiver,outsider]);await locker.query('COMMIT');
      } finally {await locker.query('ROLLBACK');locker.release();}
      const outcome=await pending;assert.equal(observed,true,'Submit must wait for the assigned cohort row lock');
      assert.equal(outcome.status,409);assert.equal(outcome.body.error.code,'APPLICATION_DESTINATION_UNAVAILABLE');
      assert.equal((await request(`${proxy}/${race.id}`,{token})).status,'DRAFT');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM phase1_submissions WHERE application_id=$1',[race.id])).rows[0].n,0);
      const retried=await request(`${proxy}/${race.id}/submit`,{method:'POST',token,body:submitBody});
      assert.equal(retried.submission.snapshot.delivery.coordinator_id,outsider);
      const receipt=(await db.query('SELECT coordinator_id_at_send FROM phase1_submission_deliveries WHERE submission_id=$1',[retried.submission.id])).rows[0];
      assert.equal(receipt.coordinator_id_at_send,outsider);
    });
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));connection?.release();await runtime?.end();await db?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();
  }
});
