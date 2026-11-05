import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import reader from '../scripts/operations/intake-readiness/reader.js';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
const url=process.env.INTAKE_READINESS_TEST_DATABASE_URL;
test('A0 actual disposable PostgreSQL: least privilege fixed read-only inventory, zero business DML',{skip:!url&&!process.env.CI},async()=>{
 const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'15440');assert.equal(target.pathname,'/coed');
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.INTAKE_DISPOSABLE,'true');assert.notEqual(url,process.env.DATABASE_URL);
 const admin=new pg.Pool({connectionString:url}),schema='intake_a0_'+randomUUID().replaceAll('-','');let runtime,setup;
 try{
  if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'")).rowCount)await admin.query('CREATE ROLE coed_app NOLOGIN');
  await admin.query('CREATE SCHEMA '+schema);setup=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});
  for(const m of readReviewedMigrations())await setup.query(m.sql);
  await setup.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL)');
  for(const m of readReviewedMigrations())await setup.query('INSERT INTO schema_migrations VALUES($1,$2)',[m.name,m.checksum]);
  const adapt=sql=>sql.replaceAll('public.',schema+'.').replaceAll("'public'","'"+schema+"'").replaceAll('SCHEMA public','SCHEMA '+schema);
  const grants=readFileSync(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8').replace(/^\\set[^\n]*\n/m,'');await setup.query(adapt(grants));
  await setup.query('GRANT SELECT ON schema_migrations TO coed_app');
  runtime=new pg.Pool({connectionString:url,options:`-c role=coed_app -c search_path=${schema},public -c default_transaction_read_only=on`});
  const before=(await setup.query('SELECT count(*)::int n FROM phase1_applications')).rows[0].n;
  const runId='a'.repeat(32),logs=[];
  const env={NODE_ENV:'production',AWS_REGION:reader.T.region,INTAKE_ENABLED:'true',INTAKE_RUN_ID:runId,INTAKE_EXPIRES_AT:new Date(Date.now()+600000).toISOString()};
  const result=await reader.createReader({env,poolFactory:()=>({on(){},end:()=>runtime.end(),connect:async()=>{
   const c=await runtime.connect();return {on(){},release:x=>c.release(x),query:(sql,args)=>c.query(adapt(sql),args)};
  }}),logger:x=>logs.push(x)})({contract:reader.T.contract,runId},{functionVersion:'1',invokedFunctionArn:reader.ARN+':1'});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.guard.read_only,true);assert.deepEqual(result.data.rounds,[]);
  assert.ok(result.data.catalog.tables.some(x=>x.name==='phase1_submission_deliveries'));
  assert.equal((await setup.query('SELECT count(*)::int n FROM phase1_applications')).rows[0].n,before);
  const denied=new pg.Client({connectionString:url,options:`-c role=coed_app -c search_path=${schema},public -c default_transaction_read_only=on`});await denied.connect();
  try{await assert.rejects(denied.query('INSERT INTO users(id,role) VALUES(gen_random_uuid(),\'STUDENT\')'),e=>e.code==='25006');}finally{await denied.end();}
  assert.equal(logs.length,1);assert.ok(!logs[0].includes('catalog'));
 }finally{if(runtime && !runtime.ending)await runtime.end();if(setup)await setup.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
