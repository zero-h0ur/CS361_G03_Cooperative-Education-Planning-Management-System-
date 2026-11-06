import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import pg from 'pg';
import {createObservedFixture} from './helpers/present-schema-fixture.mjs';
import {upgradeObservedSchema} from '../scripts/operations/present-schema-upgrade.mjs';
import {PROFILE,identifier} from '../scripts/operations/present-schema-baseline.mjs';
import {upgradeRegistration} from '../scripts/operations/tu-registration-upgrade.mjs';
import {upgradeRegistrationIssuer,ISSUER,VERSION,SQL_SHA256} from '../scripts/operations/tu-registration-issuer-upgrade.mjs';
const require=createRequire(import.meta.url),{TuRegistrationService}=require('../src/auth/tu-registration-service'),{TuSessionService}=require('../src/auth/tu-session-service');
const {TuBrokerService}=require('../src/auth/tu-broker-service'),{createTuSessionIssuer}=require('../src/tu-session-issuer'),{REGISTRATION}=require('../src/auth/tu-registration-contract');
const {TokenValidator}=require('../src/auth/token-validator'),{IdentityResolver}=require('../src/auth/identity-resolver'),{createLambdaHandler}=require('../src/lambda');
const url=process.env.TU_REGISTRATION_TEST_DATABASE_URL;
test('real disposable PostgreSQL:020 exact issuer correction and non-default-config owner flow',{skip:!url&&!process.env.CI},async t=>{
 const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'15440');assert.equal(u.pathname,'/coed_registration_test');
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.TU_REGISTRATION_DISPOSABLE,'true');assert.notEqual(url,process.env.DATABASE_URL);
 const admin=new pg.Pool({connectionString:url}),schema='present_'+randomUUID().replaceAll('-',''),q=identifier(schema);
 const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});
 const previous=process.env.TU_ONBOARDING_ENABLED;process.env.TU_ONBOARDING_ENABLED='true';
 const identity=subject=>({subject,nameTh:'Synthetic Student',nameEn:null,email:subject+'@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'\u0e1b\u0e01\u0e15\u0e34',statusId:null});
 const call=async(subject,{issuer=ISSUER,jti=randomUUID(),operation=randomUUID(),year=2567,raw=identity(subject)}={})=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE coed_tu_registration');
   const result=await c.query(`SELECT * FROM ${q}.complete_tu_registration($1,$2,$3,$4,'special',$5,clock_timestamp()+interval '240 seconds')`,[issuer,jti,operation,raw,year]);
   await c.query('COMMIT');return result.rows[0];
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 };
 const upgrade=async mode=>{const c=await pool.connect();try{return await upgradeRegistrationIssuer({client:c,expectedDatabase:'coed_registration_test',expectedSchema:schema,mode,maintenanceApproved:true,expectedIssuer:ISSUER});}finally{c.release();}};
 try{
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist');await admin.query('CREATE ROLE coed_app NOLOGIN');await admin.query('CREATE SCHEMA '+q);
  const setup=await pool.connect();try{await createObservedFixture(setup,schema);await upgradeObservedSchema({client:setup,profile:PROFILE,expectedDatabase:'coed_registration_test',expectedSchema:schema,mode:'apply',maintenanceApproved:true});}finally{setup.release();}
  await pool.query(readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8').replaceAll('public.',q+'.').replaceAll('SCHEMA public','SCHEMA '+q).replaceAll("'public'","'"+schema+"'"));
  await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA '+q+' GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO coed_app');
  const setup019=await pool.connect();try{await upgradeRegistration({client:setup019,expectedDatabase:'coed_registration_test',expectedSchema:schema,mode:'apply',maintenanceApproved:true});}finally{setup019.release();}
  const history=(await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  await t.test('019 rejects the actual issuer before any account; inventory is read-only and trial rolls back',async()=>{
   await assert.rejects(call('9900000040'),e=>e.code==='P0001'&&/line 10 at RAISE/.test(e.where));
   const inventory=await upgrade('inventory');assert.equal(inventory.baselineVerified,true);assert.equal(inventory.idempotentReplay,false);
   const trial=await upgrade('trial');assert.equal(trial.applied,false);assert.equal(trial.onlyTwoIssuerLiteralsChanged,true);assert.equal(trial.ownersAclAndRolesPreserved,true);
   assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,history);
   await assert.rejects(call('9900000040'),e=>e.code==='P0001');
   assert.equal((await pool.query('SELECT count(*)::int n FROM tu_student_registrations')).rows[0].n,0);
  });
  await t.test('atomic apply appends020 only, creates no account, and exact replay verifies the new catalog',async()=>{
   const applied=await upgrade('apply');assert.equal(applied.applied,true);assert.equal(applied.preservationVerified,true);
   assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations WHERE version<>$1 ORDER BY version',[VERSION])).rows,history);
   assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations WHERE version=$1',[VERSION])).rows,[{version:VERSION,checksum:SQL_SHA256}]);
   assert.equal((await pool.query('SELECT count(*)::int n FROM tu_student_registrations')).rows[0].n,0);
   assert.equal((await upgrade('apply')).idempotentReplay,true);
  });
  await t.test('non-default issuer/client: registration -> private issuer -> broker -> /me -> own profile',async()=>{
   const login=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_tu_login`});
   const app=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_app`});
   const provision=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_tu_registration`});
   try{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048}),subject='9900000041',clientId='coed-api-production-shaped',targetArn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:live';
    const registration=new TuRegistrationService({pool:{query:(sql,args)=>login.query(sql.replaceAll('public.',q+'.'),args)},issuer:ISSUER,clientId,publicKey:keys.publicKey,
     provisionConnect:async()=>{const c=await provision.connect();return {query:(sql,args)=>c.query(sql.replaceAll('public.',q+'.'),args),end:async()=>c.release()};}});
    const begin=await registration.begin({subject,identity:identity(subject)},async()=>keys);
    const handler=createTuSessionIssuer({targetArn,getKeys:async()=>keys,registrationService:registration,
     sessionService:new TuSessionService({pool:login,issuer:ISSUER,clientId}),logger:()=>{}});
    const broker=new TuBrokerService({targetArn,publicKey:keys.publicKey,config:{issuer:ISSUER,clientId,kid:'tu-key-1'},client:{send:async command=>{
     const result=await handler(JSON.parse(Buffer.from(command.input.Payload)),{invokedFunctionArn:targetArn,functionVersion:'1'});
     return {StatusCode:200,ExecutedVersion:'1',Payload:Buffer.from(JSON.stringify(result))};
    }}});
    const session=await broker.register({registrationToken:begin.registrationToken,programType:'special',entryYear:2567,operationId:randomUUID()},randomUUID());
    const api=createLambdaHandler({authOptions:{pool:app,identityResolver:new IdentityResolver({pool:app}),tokenValidator:new TokenValidator({tuPublicKey:keys.publicKey,tuIssuer:ISSUER,tuClientId:clientId})}});
    for(const path of ['/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v3/students/me']){
     const response=await api({rawPath:path,requestContext:{http:{method:'GET'}},headers:{authorization:'Bearer '+session.accessToken}});assert.equal(response.statusCode,200);
     const data=JSON.parse(response.body).data;
     if(path.endsWith('/students/me')){assert.equal(data.id,session.user.studentId);assert.equal(data.student_number,subject);assert.equal(data.onboarding.study_source,'self_reported');assert.equal(data.academic_year,null);}
     else{assert.equal(data.user.id,session.user.id);assert.equal(data.studentId,session.user.studentId);}
    }
    assert.equal((await pool.query('SELECT count(*)::int n FROM audit_events WHERE resource_id=$1',[session.user.studentId])).rows[0].n,1);
    const maintenance=process.env.COED_API_MAINTENANCE;
    try{
     process.env.COED_API_MAINTENANCE='browse';
     for(const path of ['/api/tu-proxy/api/v4/application-options','/api/tu-proxy/api/v4/applications']){
      const response=await api({rawPath:path,requestContext:{http:{method:'GET'}},headers:{authorization:'Bearer '+session.accessToken}});
      assert.equal(response.statusCode,200);const data=JSON.parse(response.body).data;
      if(Array.isArray(data))assert.deepEqual(data,[]);
      else{assert.equal(data.access.read_only,true);assert.equal(data.official.academic_verified,false);assert.equal(data.official.program,null);assert.equal(data.official.department,null);}
     }
     assert.equal((await pool.query('SELECT count(*)::int n FROM phase1_applications WHERE student_id=$1',[session.user.studentId])).rows[0].n,0);
    }finally{if(maintenance===undefined)delete process.env.COED_API_MAINTENANCE;else process.env.COED_API_MAINTENANCE=maintenance;}
   }finally{await login.end();await app.end();await provision.end();}
  });
  await t.test('wrong/default issuer, status and injected fields cannot register or overwrite',async()=>{
   for(const issuer of ['urn:coed:tu-auth','urn:coed:tu-auth:OTHER'])await assert.rejects(call('9900000042',{issuer}),e=>e.code==='P0001');
   for(const patch of [{tuStatus:'unknown'},{statusId:'40'},{role:'ADMIN'},{email:null}])await assert.rejects(call('9900000042',{raw:{...identity('9900000042'),...patch}}));
   assert.equal((await pool.query("SELECT count(*)::int n FROM students WHERE student_number='9900000042'")).rows[0].n,0);
  });
  await t.test('exact idempotent retry returns same owner; conflicting input and races remain guarded',async()=>{
   const opts={jti:randomUUID(),operation:randomUUID()},a=await call('9900000043',opts);assert.deepEqual(await call('9900000043',opts),a);
   await assert.rejects(call('9900000043',{...opts,year:2568}));
   const race=await Promise.allSettled([call('9900000044'),call('9900000044')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
   assert.equal((await pool.query("SELECT count(*)::int n FROM students WHERE student_number='9900000044'")).rows[0].n,1);
  });
  await t.test('disabled/revoked/existing identity cannot be rewritten or relinked',async()=>{
   const r=await call('9900000045');await pool.query("UPDATE users SET account_status='DISABLED' WHERE id=$1",[r.user_id]);await assert.rejects(call('9900000045'));
   await pool.query("UPDATE external_identity_links SET status='REVOKED',revoked_at=now(),revoked_by=$1 WHERE user_id=$1",[r.user_id]);await assert.rejects(call('9900000045'));
   assert.equal((await pool.query('SELECT account_status FROM users WHERE id=$1',[r.user_id])).rows[0].account_status,'DISABLED');
  });
  await t.test('audit failure still rolls back account, profile, identity and receipt atomically',async()=>{
   await pool.query("CREATE FUNCTION fail_020_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$");
   await pool.query('CREATE TRIGGER fail_020_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_020_audit()');
   try{await assert.rejects(call('9900000046'));assert.equal((await pool.query("SELECT count(*)::int n FROM students WHERE student_number='9900000046'")).rows[0].n,0);}
   finally{await pool.query('DROP TRIGGER fail_020_audit ON audit_events');await pool.query('DROP FUNCTION fail_020_audit()');}
  });
  await t.test('capabilities remain EXECUTE-only; SELECT-only login and legacy completeness guards persist',async()=>{
   const c=await pool.connect();try{await c.query('SET ROLE coed_tu_registration');
    for(const sql of ['SELECT * FROM users','UPDATE students SET full_name=full_name','DELETE FROM external_identity_links','CREATE TABLE forged_020(id int)'])await assert.rejects(c.query(sql),e=>e.code==='42501');
   }finally{await c.query('RESET ROLE');c.release();}
   const id=randomUUID();await pool.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')",[id]);
   await assert.rejects(pool.query("INSERT INTO students(id,user_id,anonymous_ref,source,visibility,data_status,student_number,full_name,institutional_email,enrollment_status) VALUES(gen_random_uuid(),$1,'legacy-020','synthetic','private','mock','9900000047','Synthetic','test@example.invalid','ACTIVE')",[id]),e=>e.code==='23514');
   assert.equal((await pool.query("SELECT has_table_privilege('coed_tu_login',$1,'INSERT,UPDATE,DELETE') AS allowed",[schema+'.students'])).rows[0].allowed,false);
   assert.equal((await upgrade('inventory')).idempotentReplay,true);
  });
  await t.test('catalog drift stops replay instead of silently normalizing it',async()=>{
   await pool.query('CREATE TABLE unapproved_020_drift(id int)');try{await assert.rejects(upgrade('inventory'),e=>e.safeCode==='ISSUER020_BASELINE_DRIFT');}
   finally{await pool.query('DROP TABLE unapproved_020_drift');}
  });
 }finally{if(previous===undefined)delete process.env.TU_ONBOARDING_ENABLED;else process.env.TU_ONBOARDING_ENABLED=previous;await pool.end();await admin.end();}
});
