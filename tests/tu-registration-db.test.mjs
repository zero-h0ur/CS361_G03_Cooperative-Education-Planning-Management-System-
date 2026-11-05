import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createObservedFixture} from './helpers/present-schema-fixture.mjs';
import {upgradeObservedSchema} from '../scripts/operations/present-schema-upgrade.mjs';
import {PROFILE,identifier} from '../scripts/operations/present-schema-baseline.mjs';
import identityModule from '../src/auth/identity-resolver.js';
import {upgradeRegistration} from '../scripts/operations/tu-registration-upgrade.mjs';
import sessionModule from '../src/auth/tu-session-service.js';
import tokenModule from '../src/auth/token-validator.js';
import lambdaModule from '../src/lambda.js';
const url=process.env.TU_REGISTRATION_TEST_DATABASE_URL;
test('real disposable PostgreSQL: observed018 registration, atomicity, concurrency and minimum privileges',{skip:!url && !process.env.CI},async t=>{
 const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'15440');assert.equal(u.pathname,'/coed_registration_test');
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.TU_REGISTRATION_DISPOSABLE,'true');assert.notEqual(url,process.env.DATABASE_URL);
 const admin=new pg.Pool({connectionString:url}),schema='present_'+randomUUID().replaceAll('-',''),q=identifier(schema);
 const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});let previous=process.env.TU_ONBOARDING_ENABLED;
 try{
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist');await admin.query('CREATE ROLE coed_app NOLOGIN');
  await admin.query('CREATE SCHEMA '+q);const client=await pool.connect();
  try{await createObservedFixture(client,schema);await upgradeObservedSchema({client,profile:PROFILE,expectedDatabase:'coed_registration_test',expectedSchema:schema,mode:'apply',maintenanceApproved:true});}finally{client.release();}
  const login=readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8')
   .replaceAll('public.',q+'.').replaceAll('SCHEMA public','SCHEMA '+q).replaceAll("'public'","'"+schema+"'");
  await pool.query(login);
  // Actual RDS default ACL discovered by rollback-only trial;019 must neutralize
  // it on the two new tables, never by changing global/default permissions.
  await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA '+q+' GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO coed_app');
  const history=(await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
  const upgrade=async mode=>{const c=await pool.connect();try{return await upgradeRegistration({client:c,expectedDatabase:'coed_registration_test',expectedSchema:schema,mode,maintenanceApproved:true});}finally{c.release();}};
  await t.test('owner trial rolls back DDL/roles/history; apply preserves history and verifies replay',async()=>{
   const trial=await upgrade('trial');assert.equal(trial.applied,false);assert.equal(trial.preservationVerified,true);
   assert.equal((await pool.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='coed_tu_registration'")).rows[0].n,0);
   assert.deepEqual((await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows,history);
   assert.equal((await upgrade('apply')).applied,true);assert.equal((await upgrade('apply')).idempotentReplay,true);
   assert.deepEqual((await pool.query("SELECT * FROM schema_migrations WHERE version<>'019_tu_student_registration.sql' ORDER BY version")).rows,history);
  });
  const identity=subject=>({subject,nameTh:'Synthetic Student',nameEn:null,email:subject+'@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'ปกติ',statusId:null});
  const call=async(subject,{jti=randomUUID(),operation=randomUUID(),program='regular',year=2567,raw=identity(subject)}={})=>{
   const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE coed_tu_registration');
    const r=await c.query(`SELECT * FROM ${q}.complete_tu_registration($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '240 seconds')`,['urn:coed:tu-auth',jti,operation,raw,program,year]);
    await c.query('COMMIT');return r.rows[0];
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  };
  await t.test('creates exact one owner, real provenance and audit without academic verification or placeholders',async()=>{
   const r=await call('9900000019');const s=(await pool.query('SELECT * FROM students WHERE id=$1',[r.student_id])).rows[0];
   assert.equal(s.user_id,r.user_id);assert.equal(s.identity_source,'TU_ONBOARDING');assert.equal(s.data_status,'to_validate');
   for(const k of ['department','program','major','academic_year'])assert.equal(s[k],null);
   assert.equal((await pool.query('SELECT count(*)::int n FROM audit_events WHERE resource_id=$1',[s.id])).rows[0].n,1);
   assert.equal((await pool.query('SELECT count(*)::int n FROM phase1_academic_profiles WHERE student_id=$1',[s.id])).rows[0].n,0);
   process.env.TU_ONBOARDING_ENABLED='true';
   const resolved=await new identityModule.IdentityResolver({pool}).resolveIdentity('urn:coed:tu-auth','9900000019');
   assert.equal(resolved.studentId,s.id);assert.equal(resolved.onboarding.study_source,'self_reported');
  });
  await t.test('idempotent exact retries return the same owner; changed study data stops',async()=>{
   const opts={jti:randomUUID(),operation:randomUUID()},a=await call('9900000020',opts),b=await call('9900000020',opts);
   assert.deepEqual(a,b);await assert.rejects(call('9900000020',{...opts,year:2568}));
  });
  await t.test('normal SELECT-only issuer session -> /me -> own profile works with pending academic scope',async()=>{
   const login=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_tu_login`});
   const app=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_app`});
   try{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});
    const session=await new sessionModule.TuSessionService({pool:login}).issue('9900000019',async()=>keys);
    assert.equal(session.profile.onboarding.academic_verification,'pending');assert.equal(session.profile.academic_year,null);
    const handler=lambdaModule.createLambdaHandler({authOptions:{pool:app,identityResolver:new identityModule.IdentityResolver({pool:app}),
     tokenValidator:new tokenModule.TokenValidator({tuPublicKey:keys.publicKey})}});
    for(const path of ['/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v3/students/me']){
     const response=await handler({rawPath:path,requestContext:{http:{method:'GET'}},headers:{authorization:'Bearer '+session.accessToken}});
     assert.equal(response.statusCode,200,response.body);const data=JSON.parse(response.body).data;
     if(path.endsWith('/students/me')){assert.equal(data.id,session.user.studentId);assert.equal(data.student_number,'9900000019');assert.equal(data.onboarding.study_source,'self_reported');}
     else{assert.equal(data.user.id,session.user.id);assert.equal(data.studentId,session.user.studentId);}
    }
   }finally{await login.end();await app.end();}
  });
  await t.test('concurrent same-owner attempts never duplicate or overwrite',async()=>{
   const all=await Promise.allSettled([call('9900000021'),call('9900000021')]);assert.equal(all.filter(r=>r.status==='fulfilled').length,1);
   assert.equal((await pool.query("SELECT count(*)::int n FROM students WHERE student_number='9900000021'")).rows[0].n,1);
  });
  await t.test('existing, disabled and revoked identities stop without changing original rows',async()=>{
   const r=await call('9900000022');await pool.query("UPDATE users SET account_status='DISABLED' WHERE id=$1",[r.user_id]);
   await assert.rejects(call('9900000022'));
   assert.equal((await pool.query('SELECT account_status FROM users WHERE id=$1',[r.user_id])).rows[0].account_status,'DISABLED');
   await pool.query("UPDATE external_identity_links SET status='REVOKED',revoked_at=now(),revoked_by=$1 WHERE user_id=$1",[r.user_id]);
   await assert.rejects(call('9900000022'));
  });
  await t.test('malformed provider fields, overrides and non-normal enrollment cannot create anything',async()=>{
   const before=(await pool.query('SELECT count(*)::int n FROM users')).rows[0].n;
   for(const patch of [{tuStatus:'สำเร็จการศึกษา'},{statusId:'40'},{email:null},{role:'ADMIN'},{subject:'other'}])
    await assert.rejects(call('9900000023',{raw:{...identity('9900000023'),...patch}}));
   assert.equal((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n,before);
  });
  await t.test('audit failure rolls back the entire account/link/profile/receipt',async()=>{
   await pool.query("CREATE FUNCTION fail_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$");
   await pool.query('CREATE TRIGGER fail_registration_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_registration_audit()');
   try{await assert.rejects(call('9900000024'));assert.equal((await pool.query("SELECT count(*)::int n FROM students WHERE student_number='9900000024'")).rows[0].n,0);}
   finally{await pool.query('DROP TRIGGER fail_registration_audit ON audit_events');}
  });
  await t.test('runtime may execute only the fixed function, not read identities or mutate tables directly',async()=>{
   const c=await pool.connect();try{await c.query('SET ROLE coed_tu_registration');
    for(const sql of ['SELECT * FROM users','INSERT INTO users(id,role) VALUES(gen_random_uuid(),\'ADMIN\')','UPDATE students SET full_name=full_name','DELETE FROM external_identity_links','CREATE TABLE forged(id int)'])await assert.rejects(c.query(sql),e=>e.code==='42501');
   }finally{await c.query('RESET ROLE');c.release();}
   assert.equal((await pool.query("SELECT has_function_privilege('coed_app',$1,'EXECUTE') AS allowed",[schema+'.complete_tu_registration(text,uuid,uuid,jsonb,text,integer,timestamptz)'])).rows[0].allowed,false);
   assert.equal((await pool.query("SELECT has_table_privilege('coed_tu_login',$1,'INSERT,UPDATE,DELETE') AS allowed",[schema+'.students'])).rows[0].allowed,false);
  });
  await t.test('legacy linked profiles cannot exploit nullable new-profile fields',async()=>{
   const id=randomUUID();await pool.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')",[id]);
   await assert.rejects(pool.query("INSERT INTO students(id,user_id,anonymous_ref,source,visibility,data_status,student_number,full_name,institutional_email,enrollment_status) VALUES(gen_random_uuid(),$1,'legacy-incomplete','synthetic','private','mock','9900000025','Synthetic','test@example.invalid','ACTIVE')",[id]),e=>e.code==='23514');
  });
 }finally{
  if(previous===undefined)delete process.env.TU_ONBOARDING_ENABLED;else process.env.TU_ONBOARDING_ENABLED=previous;
  await pool.end();await admin.end();
  // The enclosing --rm, task-labelled disposable container owns this entire DB.
 }
});
