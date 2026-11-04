import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../scripts/operations/tu-preflight/catalog.js';
import reader from '../scripts/operations/tu-preflight/reader.js';
const {SQL,TABLES,LIMITS,assertSafeCatalog,readCatalog}=catalog;

test('schema mode keeps the exact envelope, qualified context and read-only preconditions',()=>{
 const now=Date.now(),runId='a'.repeat(32),env={NODE_ENV:'production',AWS_REGION:reader.TARGET.region,
  PREFLIGHT_ENABLED:'true',PREFLIGHT_RUN_ID:runId,PREFLIGHT_EXPIRES_AT:new Date(now+10000).toISOString()};
 const event={contract:reader.TARGET.contract,runId,mode:'schema'},ctx={functionVersion:'1',invokedFunctionArn:reader.FUNCTION_ARN+':1'};
 assert.equal(reader.validate(event,ctx,env,now),'schema');
 assert.throws(()=>reader.validate({...event,sql:'SELECT * FROM users'},ctx,env,now));
 assert.throws(()=>reader.validate({...event,subject:'9000000001'},ctx,env,now));
});

test('catalog queries are fixed SELECTs over PostgreSQL catalogs, not application rows',()=>{
 for(const sql of Object.values(SQL)){
  const tokens=sql.replace(/'(?:''|[^'])*'/g,"''");
  assert.match(tokens,/^\s*SELECT\b/);assert.doesNotMatch(tokens,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|COPY|DO)\b/i);
  assert.doesNotMatch(tokens,/\b(?:FROM|JOIN)\s+(?:public\.|users\b|students\b|external_identity_links\b|phase1_)/i);
  assert.doesNotMatch(tokens,/pg_authid\b|rolpassword|FOR\s+(?:UPDATE|SHARE)/i);
 }
});

test('catalog reads only fixed target names and labels observed schema honestly',async()=>{
 const calls=[];
 const result=await readCatalog(async(sql,params)=>{calls.push({sql,params});return [];});
 assert.match(result.notice,/NOT recovered historical SQL/);
 assert.equal(calls.length,Object.keys(SQL).length);
 for(const call of calls)assert.ok(call.params.length===0 || call.params[0]===TABLES);
 assert.ok(TABLES.includes('phase1_submission_deliveries'));
 assert.deepEqual(result.routines,[]);
});

test('catalog refuses truncation instead of accepting an incomplete baseline',async()=>{
 let calls=0;
 await assert.rejects(readCatalog(async()=>{calls++;return Array.from({length:LIMITS.inventory+1},()=>({name:'synthetic'}));}),
  e=>e.safeCode==='PREFLIGHT_CATALOG_LIMIT');
 assert.equal(calls,1);
});

for(const canary of ['-----BEGIN PRIVATE KEY-----','AKIA'+'A'.repeat(16),'TU'+'a'.repeat(80),'Bearer '+'x'.repeat(30)])
 test('catalog rejects secret-shaped definitions before exposing any result: '+canary.slice(0,8),()=>{
  assert.throws(()=>assertSafeCatalog({routines:[{definition:canary}]}),e=>e.safeCode==='PREFLIGHT_UNSAFE_CATALOG_OUTPUT' && !e.message.includes(canary));
 });

test('catalog bounds individual routine bodies',()=>{
 assert.throws(()=>assertSafeCatalog({routines:[{definition:'x'.repeat(65001)}]}),e=>e.safeCode==='PREFLIGHT_OUTPUT_LIMIT');
});
