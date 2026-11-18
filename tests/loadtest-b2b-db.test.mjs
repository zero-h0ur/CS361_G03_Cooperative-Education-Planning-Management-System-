import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { localTarget } from '../scripts/loadtest/database.mjs';
import { runSchema } from '../scripts/loadtest/b2-bootstrap.mjs';
import { readReviewedMigrations } from '../scripts/operations/reviewed-migrations.mjs';
import { importData, counts, snapshot, id } from '../scripts/loadtest/b2b-import.mjs';
import { runtimeCheck } from '../scripts/loadtest/b2b-runtime-check.mjs';
import { syntheticBindings } from './helpers/loadtest-b2b-fixture.mjs';
import { generateSyntheticDataset } from '../scripts/loadtest/vendor/pr178-generate-companies.mjs';
const url=process.env.LOADTEST_PREP_TEST_DATABASE_URL;localTarget(url);
const client=new pg.Client({connectionString:url}),bindings=syntheticBindings();
const migrations=readReviewedMigrations();
const history=migrations.map(({name,checksum})=>({version:name,checksum}));
const dataset=generateSyntheticDataset();
let baseline;
test.before(async()=>{
  await client.connect();
  await runSchema(client,{migrations,grants:readFileSync(new URL('../scripts/loadtest/runtime-grants.sql',import.meta.url),'utf8')},'a'.repeat(64),true);
});
test.after(async()=>client.end());
const run=command=>importData(client,{bindings,history,baseline,command,dataset});
test('retained B2a schema preflight and data trial rollback preserve all catalog/history/grants',async()=>{
  const result=await run('preflight');baseline=result.baseline;
  assert.equal((await run('trial')).committed,false);
  assert.ok(Object.values(await counts(client)).every(n=>n===0));
  assert.equal(await snapshot(client,history),baseline);
});
test('nonempty foreign target is rejected without overwrite, reset or mapping repair',async()=>{
  await client.query("INSERT INTO companies(id,name,source,visibility,data_status) VALUES($1,'FOREIGN','foreign','private','mock')",[id('foreign')]);
  try {await assert.rejects(run('apply'),/B2B_DATA_DRIFT/);assert.equal((await client.query('SELECT name FROM companies')).rows[0].name,'FOREIGN');}
  finally {await client.query('DELETE FROM companies WHERE id=$1',[id('foreign')]);}
});
test('late insert failure rolls the complete directory and identities back',async()=>{
  await client.query(`CREATE FUNCTION public.b2b_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;
    CREATE TRIGGER b2b_fail BEFORE INSERT ON plans FOR EACH ROW EXECUTE FUNCTION public.b2b_fail_test()`);
  try {
    const changed=await snapshot(client,history);
    await assert.rejects(importData(client,{bindings,history,baseline:changed,command:'apply',dataset}));
    assert.ok(Object.values(await counts(client)).every(n=>n===0));
  } finally {await client.query('DROP TRIGGER b2b_fail ON plans; DROP FUNCTION public.b2b_fail_test()');}
  assert.equal(await snapshot(client,history),baseline);
});
test('schema/history drift aborts before data insertion',async()=>{
  await assert.rejects(importData(client,{bindings,history:[],baseline,command:'apply',dataset}),/B2B_HISTORY_DRIFT/);
  await assert.rejects(importData(client,{bindings,history,baseline:'0'.repeat(64),command:'apply',dataset}),/B2B_BASELINE_DRIFT/);
  assert.ok(Object.values(await counts(client)).every(n=>n===0));
});
test('insert once creates 400 companies,800 positions,10 exact links and Drafts in an OPEN cycle',async()=>{
  const r=await run('apply');assert.equal(r.committed,true);assert.equal(r.idempotentReplay,false);
  assert.equal(r.companies,400);assert.equal(r.positions,800);assert.equal(r.links,10);assert.equal(r.drafts,10);assert.ok(r.allDraftsEditable);
  assert.equal((await run('apply')).idempotentReplay,true);assert.equal((await run('verify')).committed,false);
  assert.equal(await snapshot(client,history),baseline);
});
test('coed_app resolves ten subjects, reads only own Draft, PATCHes with receipts/audit and rolls every write back',async()=>{
  const runtimeUrl=new URL(url);runtimeUrl.username='coed_app';runtimeUrl.password='';
  const runtime=new pg.Client({connectionString:runtimeUrl.toString()});await runtime.connect();
  try {const r=await runtimeCheck(runtime,bindings);assert.equal(r.rollbackOnlyPatches,10);assert.equal(r.genuineCognitoAuthentication,false);}
  finally {await runtime.end();}
  await run('verify');assert.equal(await snapshot(client,history),baseline);
});
test('changed subject replay is rejected rather than re-linking an existing account',async()=>{
  const changed=structuredClone(bindings);changed.accounts[0].subject='99000000-0000-70a5-0000-000000000099';
  await assert.rejects(importData(client,{bindings:changed,history,baseline,command:'apply',dataset}),/B2B_DATA_DRIFT/);
  await run('verify');
});
