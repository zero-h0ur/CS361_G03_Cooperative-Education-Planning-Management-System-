import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createObservedFixture} from './helpers/present-schema-fixture.mjs';
import {upgradeObservedSchema} from '../scripts/operations/present-schema-upgrade.mjs';
import {PROFILE,identifier,captureCatalog,catalogHash} from '../scripts/operations/present-schema-baseline.mjs';
import {SQL_SHA256 as s19} from '../scripts/operations/tu-registration-upgrade.mjs';
import {SQL_SHA256 as s20,ISSUER} from '../scripts/operations/tu-registration-issuer-upgrade.mjs';
import {upgradeIntake,validateManifest} from '../scripts/operations/intake-controls-upgrade.mjs';
import applications from '../src/api/services/application-service.js';
import controls from '../src/api/services/intake-control-service.js';
const url=process.env.STUDENT_INTAKE_TEST_DATABASE_URL;
test('C7 exact021+022: trial rollback, metadata/capability preservation, hash-bound Apply and replay',{skip:!url&&!process.env.CI},async()=>{
 const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,'/coed_intake_test');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.INTAKE_DISPOSABLE,'true');
 const admin=new pg.Pool({connectionString:url}),schema='present_'+id().replaceAll('-',''),q=identifier(schema),suffix=id().replaceAll('-',''),regRole='c7_reg_'+suffix,regOwner='c7_owner_'+suffix;
 const owner=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});let runtime;
 try{
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist');if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'")).rowCount)await admin.query('CREATE ROLE coed_app NOLOGIN');
  await admin.query('CREATE SCHEMA '+q);const setup=await owner.connect();try{await createObservedFixture(setup,schema);await upgradeObservedSchema({client:setup,profile:PROFILE,expectedDatabase:'coed_intake_test',expectedSchema:schema,mode:'apply',maintenanceApproved:true});}finally{setup.release();}
  await owner.query(readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8').replaceAll('public.',q+'.').replaceAll('SCHEMA public','SCHEMA '+q).replaceAll("'public'","'"+schema+"'"));
  for(const [version,setting,value,checksum] of [['019_tu_student_registration.sql','coed.registration_upgrade','observed018-to019',s19],['020_tu_registration_issuer_alignment.sql','coed.registration_issuer_upgrade','observed019-to020',s20]]){
   const source=readFileSync(new URL('../src/db/upgrades/'+version,import.meta.url),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),checksum);
   const sql=source.replaceAll('coed_tu_registration_owner',regOwner).replaceAll('coed_tu_registration',regRole).replaceAll('public.',q+'.').replaceAll('SCHEMA public','SCHEMA '+q).replaceAll('pg_catalog,public','pg_catalog,'+q);
   const c=await owner.connect();try{await c.query('BEGIN');await c.query('SELECT set_config($1,$2,true)',[setting,value]);await c.query(sql);await c.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();}
  }
  const coord=id(),members=[id(),id(),id()],sourceCycle=id(),sourceCohort=id(),cognitoSubject=id();
  for(const [uid,role] of [[coord,'COORDINATOR'],...members.map(uid=>[uid,'COMMITTEE'])])await owner.query('INSERT INTO users(id,role) VALUES($1,$2)',[uid,role]);
  await owner.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic retained source',2569,1,'OPEN','synthetic','private','mock')",[sourceCycle]);
  await owner.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CPE','CS',$3,$4,$5,$6)",[sourceCohort,sourceCycle,coord,...members]);
  await owner.query("INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Um6nksXa1',$3)",[id(),coord,cognitoSubject]);
  const student=(await owner.query(`SELECT * FROM ${q}.complete_tu_registration($1,$2,$3,$4,'special',2567,clock_timestamp()+interval '240 seconds')`,
   [ISSUER,id(),id(),{subject:'9900000071',nameTh:'Synthetic Student',nameEn:null,email:'synthetic@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'ปกติ',statusId:null}])).rows[0];
  const c=await owner.connect();let manifest,trial;
  try{
   manifest={version:1,baselineCatalogHash:catalogHash(await captureCatalog(c),schema),cycleId:id(),cohortId:id(),sourceCycleId:sourceCycle,sourceCohortId:sourceCohort,
    coordinatorUserId:coord,coordinatorSubject:cognitoSubject,members,studentId:student.student_id,studentUserId:student.user_id};
   const context={client:c,manifest,expectedDatabase:'coed_intake_test',expectedSchema:schema};
   assert.throws(()=>validateManifest({...manifest,sql:'SELECT 1'}),/C7_MANIFEST_DENIED/);
   assert.equal((await upgradeIntake({...context,mode:'inventory'})).noDatabaseWrites,true);
   const before=(await c.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
   trial=await upgradeIntake({...context,mode:'trial'});assert.equal(trial.preservationVerified,true);assert.equal(trial.provisioned.mode,'CLOSED');
   assert.deepEqual((await c.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,before);
   assert.equal((await c.query('SELECT count(*)::int n FROM rounds WHERE id=$1',[manifest.cycleId])).rows[0].n,0);
   await assert.rejects(upgradeIntake({...context,mode:'apply',expectedPostHash:'0'.repeat(64)}),/C7_TRIAL_POSTCONDITION_REQUIRED/);
   assert.deepEqual((await c.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,before);
   assert.equal((await upgradeIntake({...context,mode:'apply',expectedPostHash:trial.postCatalogHash})).applied,true);
   assert.equal((await upgradeIntake({...context,mode:'apply',expectedPostHash:trial.postCatalogHash})).idempotentReplay,true);
   assert.equal((await c.query('SELECT count(*)::int n FROM rounds WHERE id=$1',[manifest.cycleId])).rows[0].n,1);
   assert.equal((await c.query('SELECT count(*)::int n FROM phase1_intake_routes WHERE cycle_id=$1',[manifest.cycleId])).rows[0].n,2);
   assert.equal((await c.query('SELECT name FROM rounds WHERE id=$1',[sourceCycle])).rows[0].name,'Synthetic retained source');
  }finally{c.release();}
  runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=coed_app`});
  const service=new applications.ApplicationService({pool:runtime}),control=new controls.IntakeControlService({pool:runtime});
  const actor={isAuthenticated:true,role:'STUDENT',accountStatus:'ACTIVE',userId:student.user_id,studentId:student.student_id},staff={...actor,role:'COORDINATOR',userId:coord};
  await assert.rejects(service.create(actor,{operation_id:id(),cycle_id:manifest.cycleId}),e=>e.statusCode===422);
  await control.set(staff,manifest.cycleId,{operation_id:id(),expected_version:1,mode:'MANUAL_OPEN'});
  const app=await service.create(actor,{operation_id:id(),cycle_id:manifest.cycleId});assert.equal(app.availability.can_edit,true);assert.equal(app.availability.closes_at,null);
 }finally{
  if(runtime)await runtime.end();await owner.end();await admin.query('DROP SCHEMA IF EXISTS '+q+' CASCADE');
  for(const role of [regRole,regOwner])if((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){await admin.query('DROP OWNED BY '+identifier(role));await admin.query('DROP ROLE '+identifier(role));}await admin.end();
 }
});
