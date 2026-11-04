import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import normalMigration from '../src/db/migrate.js';
import {createObservedFixture} from './helpers/present-schema-fixture.mjs';
import {PROFILE,identifier,captureCatalog,catalogHash} from '../scripts/operations/present-schema-baseline.mjs';
import {upgradeObservedSchema,VERSION,BEFORE_CATALOG_SHA256,AFTER_CATALOG_SHA256} from '../scripts/operations/present-schema-upgrade.mjs';
const url=process.env.PRESENT_SCHEMA_TEST_DATABASE_URL;

test('observed production schema: owner-only atomic upgrade on populated disposable PostgreSQL',
 {skip:!url && !process.env.CI},async t=>{
  const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55440');
  assert.equal(target.pathname,'/coed_present_test');assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.PRESENT_SCHEMA_DISPOSABLE,'true');assert.notEqual(url,process.env.DATABASE_URL);
  const admin=new pg.Pool({connectionString:url}),schemas=[],pools=[],roles=[];
  try{
   await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
   if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'")).rowCount)await admin.query('CREATE ROLE coed_app NOLOGIN');
   const fixture=async(seedBeforeTriggers)=>{
    const schema='present_'+randomUUID().replaceAll('-','');schemas.push(schema);await admin.query('CREATE SCHEMA '+identifier(schema));
    const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});pools.push(pool);
    const client=await pool.connect();try{await createObservedFixture(client,schema,seedBeforeTriggers);}finally{client.release();}
    assert.equal(catalogHash(await captureCatalog(pool),schema),BEFORE_CATALOG_SHA256);
    return {schema,pool};
   };
   const run=async(fixture,extra={})=>{
    const client=await fixture.pool.connect();try{return await upgradeObservedSchema({client,profile:PROFILE,
     expectedDatabase:'coed_present_test',expectedSchema:fixture.schema,...extra});}finally{client.release();}
   };
   const studentUser=randomUUID(),sid=randomUUID(),coord=randomUUID(),members=[randomUUID(),randomUUID(),randomUUID()],cycle=randomUUID(),cohort=randomUUID();
   const policy=randomUUID(),app=randomUUID(),sub=randomUUID(),snapshot={official:{department:'CS',program:'regular'},payload:{skills_detail:'Synthetic original\nKeep exact text'},documents:[]};
   const f=await fixture(async pool=>{
   for(const [id,role] of [[studentUser,'STUDENT'],[coord,'COORDINATOR'],...members.map(id=>[id,'COMMITTEE'])])
    await pool.query('INSERT INTO users(id,role) VALUES($1,$2)',[id,role]);
   await pool.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
    VALUES($1,$2,'synthetic-retained','9900000001','Synthetic Student','test@example.invalid','CS','regular','CS',2567,'ACTIVE','synthetic','private','mock')`,[sid,studentUser]);
   await pool.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic preserved round',2569,1,'OPEN','synthetic','private','mock')",[cycle]);
   await pool.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS','regular',$3,$4,$5,$6)",[cohort,cycle,coord,...members]);
   await pool.query("INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data) VALUES($1,$2,'66',1,2568,'synthetic',true,true,'{}')",[policy,cycle]);
   await pool.query("INSERT INTO phase1_applications(id,student_id,cycle_id,payload,status,version,submitted_at) VALUES($1,$2,$3,$4,'SUBMITTED',2,now())",[app,sid,cycle,JSON.stringify(snapshot.payload)]);
   await pool.query('INSERT INTO phase1_submissions(id,application_id,application_version,submitted_by,snapshot,checksum,policy_id) VALUES($1,$2,2,$3,$4,$5,$6)',
    [sub,app,studentUser,JSON.stringify(snapshot),createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),policy]);
   });
   const originals=(await f.pool.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows;
   const originalSub=(await f.pool.query('SELECT * FROM phase1_submissions')).rows;
   await t.test('normal migrator still rejects the recorded external history without rewriting it',async()=>{
    await assert.rejects(normalMigration.migrate({pool:f.pool,logger:{log(){},error(){}}}),/missing from the migrations directory/);
    assert.deepEqual((await f.pool.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows,originals);
   });
   await t.test('reproduces the actual status/state trigger failure before the upgrade without persisting changes',async()=>{
    const client=await f.pool.connect();try{
     await client.query('BEGIN');await client.query("INSERT INTO phase1_reviews(application_id,submission_id,cohort_id,state,version,reason,actor_id) VALUES($1,$2,$3,'RETURNED',1,'Synthetic correction',$4)",[app,sub,cohort,coord]);
     await assert.rejects(client.query("UPDATE phase1_applications SET status='NEEDS_REVISION',version=3,submitted_at=NULL WHERE id=$1",[app]),e=>e.code==='42703');
    }finally{await client.query('ROLLBACK');client.release();}
   });
   await t.test('trial rolls back DDL, ACL, replacement routines and appended history',async()=>{
    const result=await run(f);assert.equal(result.applied,false);assert.equal(result.preservationVerified,true);
    assert.equal(catalogHash(await captureCatalog(f.pool),f.schema),BEFORE_CATALOG_SHA256);
    assert.deepEqual((await f.pool.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows,originals);
   });
   await t.test('apply preserves old rows/history/snapshots and only appends018; replay is verified',async()=>{
    const result=await run(f,{mode:'apply',maintenanceApproved:true});assert.equal(result.applied,true);
    assert.equal(catalogHash(await captureCatalog(f.pool),f.schema),AFTER_CATALOG_SHA256);
    assert.deepEqual((await f.pool.query('SELECT * FROM phase1_submissions')).rows,originalSub);
    assert.deepEqual((await f.pool.query('SELECT version,checksum,applied_at FROM schema_migrations WHERE version<>$1 ORDER BY version',[VERSION])).rows,originals);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM phase1_submission_deliveries')).rows[0].n,0);
    assert.equal((await run(f,{mode:'apply',maintenanceApproved:true})).idempotentReplay,true);
   });
   await t.test('legacy submission returns correctly after upgrade and its immutable snapshot remains exact',async()=>{
    const client=await f.pool.connect();try{
     await client.query('BEGIN');await client.query('SET LOCAL ROLE coed_app');
     await client.query("INSERT INTO phase1_reviews(application_id,submission_id,cohort_id,state,version,reason,actor_id) VALUES($1,$2,$3,'RETURNED',1,'Synthetic correction',$4)",[app,sub,cohort,coord]);
     await client.query("UPDATE phase1_applications SET status='NEEDS_REVISION',version=3,submitted_at=NULL WHERE id=$1",[app]);
     await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    assert.equal((await f.pool.query('SELECT status FROM phase1_applications WHERE id=$1',[app])).rows[0].status,'NEEDS_REVISION');
    assert.deepEqual((await f.pool.query('SELECT * FROM phase1_submissions')).rows,originalSub);
   });
   await t.test('targeted ACL retires provisioning and mutation rights but retains required commands and audit integrity',async()=>{
    const c=await captureCatalog(f.pool);
    assert.ok(!c.routine_acl.some(r=>r.grantee==='PUBLIC' || r.grantee==='coed_app'));
    assert.ok(c.triggers.some(r=>r.name==='phase1_schedule_events_immutable' && r.enabled==='O'));
    assert.ok(!c.effective_columns.some(r=>r.role==='coed_app' && r.table_name==='phase1_selection_results' && r.column_name==='outcome' && r.can_update));
    assert.ok(c.effective_columns.some(r=>r.role==='coed_app' && r.table_name==='phase1_reviews' && r.column_name==='state' && r.can_update));
    const client=await f.pool.connect();try{
     await client.query('BEGIN');await client.query('SET LOCAL ROLE coed_app');
     await assert.rejects(client.query('UPDATE committee_workspace_events SET result=result WHERE false'),e=>e.code==='42501');
    }finally{await client.query('ROLLBACK');client.release();}
   });
   await t.test('runtime role cannot act as an owner upgrader',async()=>{
    const other=await fixture(),client=await other.pool.connect();
    try{
     await client.query('SET ROLE coed_app');
     await assert.rejects(upgradeObservedSchema({client,profile:PROFILE,expectedDatabase:'coed_present_test',expectedSchema:other.schema}),
      e=>e.code==='OBSERVED_OWNER_TARGET_REQUIRED');
    }finally{await client.query('RESET ROLE');client.release();}
    assert.equal(catalogHash(await captureCatalog(other.pool),other.schema),BEFORE_CATALOG_SHA256);
   });
   await t.test('an existing caller transaction is neither committed nor rolled back by the upgrader',async()=>{
    const other=await fixture(),client=await other.pool.connect(),user=randomUUID();
    try{
     await client.query('BEGIN');await client.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')",[user]);
     await assert.rejects(upgradeObservedSchema({client,profile:PROFILE,expectedDatabase:'coed_present_test',expectedSchema:other.schema,mode:'apply',maintenanceApproved:true}),
      e=>e.code==='DEDICATED_IDLE_CONNECTION_REQUIRED');
     assert.equal((await client.query('SELECT count(*)::int AS n FROM users WHERE id=$1',[user])).rows[0].n,1);
    }finally{await client.query('ROLLBACK');client.release();}
    assert.equal((await other.pool.query('SELECT count(*)::int AS n FROM users WHERE id=$1',[user])).rows[0].n,0);
   });
   await t.test('SELECT-only issuer role is blocked by legacy PUBLIC provisioning, then passes after the exact upgrade',async()=>{
    const other=await fixture(),role='present_login_'+randomUUID().replaceAll('-','');roles.push(role);
    const sql=readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8')
     .replaceAll('coed_tu_login',role).replaceAll('public.',other.schema+'.').replaceAll('SCHEMA public','SCHEMA '+other.schema)
     .replaceAll("'public'","'"+other.schema+"'");
    const client=await other.pool.connect();try{
     await assert.rejects(client.query(sql),/Excess effective login-role privileges/);await client.query('ROLLBACK');
     assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount,0);
    }finally{client.release();}
    await run(other,{mode:'apply',maintenanceApproved:true});await other.pool.query(sql);
    assert.equal((await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[role])).rows[0].rolcanlogin,false);
    const checks=(await other.pool.query(`SELECT
      has_column_privilege($1,$2,'student_number','SELECT') AS can_read,
      has_column_privilege($1,$2,'student_number','UPDATE') AS can_write`,[role,other.schema+'.students'])).rows[0];
    assert.equal(checks.can_read,true);assert.equal(checks.can_write,false);
   });
   for(const mutation of ['unknown-history','disabled-trigger','partial-table','unexpected-elevated-function'])await t.test(mutation+' fails closed without altering history',async()=>{
    const other=await fixture();
    if(mutation==='unknown-history')await other.pool.query("INSERT INTO schema_migrations(version,checksum) VALUES('019_unknown.sql',$1)",['0'.repeat(64)]);
    if(mutation==='disabled-trigger')await other.pool.query('ALTER TABLE phase1_applications DISABLE TRIGGER phase1_application_guard');
    if(mutation==='partial-table')await other.pool.query('CREATE TABLE phase1_submission_deliveries(id uuid)');
    if(mutation==='unexpected-elevated-function')await other.pool.query("CREATE FUNCTION unexpected_capability() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'");
    const before=(await other.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
    await assert.rejects(run(other,{mode:'apply',maintenanceApproved:true}),e=>['OBSERVED_HISTORY_MISMATCH','OBSERVED_CATALOG_MISMATCH','OBSERVED_RUNTIME_CAPABILITY_MISMATCH'].includes(e.code));
    assert.deepEqual((await other.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows,before);
   });
   await t.test('error after schema changes rolls back all DDL and hides raw error contents',async()=>{
    const other=await fixture(),client=await other.pool.connect();
    try{
     const wrapper={query:async(sql,params)=>{const result=await client.query(sql,params);if(sql.startsWith('-- Upgrade-only targeted ACL'))throw Error('PRIVATE_CANARY');return result;}};
     await assert.rejects(upgradeObservedSchema({client:wrapper,profile:PROFILE,expectedDatabase:'coed_present_test',expectedSchema:other.schema,mode:'apply',maintenanceApproved:true}),
      e=>e.code==='OBSERVED_UPGRADE_SQL_FAILED' && !e.message.includes('PRIVATE_CANARY'));
    }finally{client.release();}
    assert.equal(catalogHash(await captureCatalog(other.pool),other.schema),BEFORE_CATALOG_SHA256);
   });
   await t.test('concurrent callers produce one upgrade and a verified replay',async()=>{
    const other=await fixture();const results=await Promise.all([run(other,{mode:'apply',maintenanceApproved:true}),run(other,{mode:'apply',maintenanceApproved:true})]);
    assert.equal(results.filter(r=>r.applied).length,1);assert.equal(results.filter(r=>r.idempotentReplay).length,1);
   });
  }finally{
   for(const pool of pools)await pool.end();
   for(const schema of schemas)await admin.query('DROP SCHEMA '+identifier(schema)+' CASCADE');
   for(const role of roles)if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){
    await admin.query('REVOKE CONNECT ON DATABASE coed_present_test FROM '+identifier(role));await admin.query('DROP ROLE '+identifier(role));
   }
   await admin.end();
  }
 });
