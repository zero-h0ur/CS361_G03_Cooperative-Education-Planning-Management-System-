import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { T, validateBindings, expectedRows, validateConfig, createImporter, hash } from '../scripts/loadtest/b2b-import.mjs';
import { validateInputs } from '../scripts/loadtest/database.mjs';
import { loadtestFixture } from './helpers/loadtest-fixture.mjs';
import { packageImporter, temporaryPolicy, retryablePreflight } from '../scripts/loadtest/b2b-operator.mjs';
import { readZipEntry } from '../scripts/operations/zip-archive.mjs';
import { generateSyntheticDataset } from '../scripts/loadtest/vendor/pr178-generate-companies.mjs';
import { syntheticBindings } from './helpers/loadtest-b2b-fixture.mjs';
const now=1700000000000,payload={history:Array(17).fill({version:'synthetic',checksum:'a'.repeat(64)}),dataset:generateSyntheticDataset()};
const config={host:T.host,database:T.database,owner:T.owner,ownerSecret:T.ownerSecret,appSecret:T.appSecret,
  startedAt:now,expiresAt:now+3600000,payloadHash:hash(payload),bindingHash:hash(syntheticBindings())};
test('provider subjects preserve non-RFC variant bits while internal fixture IDs stay UUIDs',()=>{
  const bindings=syntheticBindings();assert.deepEqual(validateBindings(bindings),bindings);
  const {manifest,dataset}=loadtestFixture();manifest.accounts=bindings.accounts;
  assert.equal(validateInputs(manifest,dataset).manifest.accounts[0].subject,bindings.accounts[0].subject);
  const rows=expectedRows(bindings,payload.dataset);assert.equal(rows.plans.length,10);
  for(const p of rows.plans){assert.match(p.id,/^[a-f0-9-]{36}$/);assert.equal(p.status,'DRAFT');assert.equal(p.version,1);assert.equal(p.cycle_id,rows.rounds[0].id);}
  assert.equal(rows.rounds[0].status,'OPEN');assert.equal(rows.rounds[0].visibility,'public');
});
test('PR178 generator is the exact pinned Git blob, not a substitute dataset',()=>{
  const bytes=readFileSync(new URL('../scripts/loadtest/vendor/pr178-generate-companies.mjs',import.meta.url));
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),'8cc5e0c6bead682ece0deca2197c600f408448d7');
  const rows=expectedRows(syntheticBindings(),payload.dataset);assert.equal(rows.companies.length,400);assert.equal(rows.positions.length,800);
  assert.ok(rows.companies.every(c=>c.name.startsWith('LOADTEST ') && c.data_status==='mock' && c.catalog_key==='loadtest-synthetic-2569'));
});
test('binding input rejects changed issuer, duplicates, extra secret keys and SQL without normalization',()=>{
  for(const mutate of [b=>b.issuer+='/',b=>b.accounts[0].subject+=' ',b=>b.accounts[0].subject="';DROP TABLE users;--",
    b=>b.accounts[0].password='CANARY',b=>b.accounts[1].subject=b.accounts[0].subject,b=>b.accounts.pop()]){
    const b=syntheticBindings();mutate(b);assert.throws(()=>validateBindings(b),/B2B_BINDINGS_REJECTED/);
  }
});
test('fixed target and <=1h expiry reject drift before Secrets/network',async()=>{
  validateConfig(config,now);
  for(const patch of [{host:'production'},{database:'coed'},{ownerSecret:T.appSecret},{appSecret:T.ownerSecret},
    {expiresAt:now},{expiresAt:now+3600001},{startedAt:now+10000}])assert.throws(()=>validateConfig({...config,...patch},now),/B2B_CONFIG_REJECTED/);
  let reads=0;
  const h=createImporter({config:{...config,expiresAt:now},payload,now:()=>now,secretReader:()=>{reads++;}});
  assert.equal((await h({})).code,'B2B_CONFIG_REJECTED');assert.equal(reads,0);
});
test('invocation refuses arbitrary SQL, commands and changed private bindings before Secret reads',async()=>{
  let reads=0;const h=createImporter({config,payload,now:()=>now,secretReader:()=>{reads++;}});
  const base={command:'preflight',payloadHash:config.payloadHash,baseline:null,bindings:syntheticBindings()};
  for(const event of [{...base,command:'reset'},{...base,sql:'DROP DATABASE coed'},
    {...base,payloadHash:'bad'},{...base,bindings:{...syntheticBindings(),accounts:syntheticBindings().accounts.map((a,i)=>i? a:{...a,subject:'99000000-0000-70a5-0000-000000000099'})}}]){
    assert.equal((await h(event)).ok,false);
  }assert.equal(reads,0);
});
test('driver/Secret error details do not escape in handler output',async()=>{
  const h=createImporter({config,payload,now:()=>now,secretReader:()=>{throw new Error('PRIVATE_CANARY');}});
  const result=await h({command:'preflight',payloadHash:config.payloadHash,baseline:null,bindings:syntheticBindings()});
  assert.equal(result.code,'B2B_DATABASE_OR_SECRET_FAILED');assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
});
test('temporary IAM reads exactly two test Secrets, denies every other Secret and code-level EC2 writes',()=>{
  const p=temporaryPolicy(`/aws/lambda/${T.fn}`);
  assert.deepEqual(p.Statement.find(s=>s.Effect==='Allow' && s.Action==='secretsmanager:GetSecretValue').Resource,[T.ownerSecret,T.appSecret]);
  assert.deepEqual(p.Statement.find(s=>s.NotResource).NotResource,[T.ownerSecret,T.appSecret]);
  assert.ok(p.Statement.some(s=>s.Effect==='Deny' && s.Condition?.ArnEquals?.['lambda:SourceFunctionArn'].endsWith(T.fn)));
  const src=readFileSync(new URL('../scripts/loadtest/b2b-operator.mjs',import.meta.url),'utf8');
  assert.ok(!/execute-api|productionProbe|create-secret|authorize-security-group|coed-api'/.test(src));
});
test('package excludes private bindings/credentials, allows only four files and loads as Lambda CJS',async()=>{
  const base=fileURLToPath(new URL('../tmp/loadtest/',import.meta.url));mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,'b2b-package-test-'));
  const {zip}=await packageImporter(config,payload,'SYNTHETIC_PUBLIC_CA',dir);
  const c=readZipEntry(zip,'config.json').toString();assert.deepEqual(JSON.parse(c),config);
  const bundled=readZipEntry(zip,'index.cjs').toString();
  for(const a of syntheticBindings().accounts)assert.ok(!bundled.includes(a.subject) && !c.includes(a.subject));
  const result=execFileSync(process.execPath,['-e',"const h=require(process.argv[1]); if(typeof h.handler!=='function')process.exit(1)",join(dir,'package','index.cjs')],
    {encoding:'utf8',env:{...process.env,LAMBDA_TASK_ROOT:join(dir,'package')},windowsHide:true});
  assert.equal(result,'');
});
test('wrong connected database is rejected before data writes and connection is closed',async()=>{
  const queries=[];let ended=false;
  const h=createImporter({config,payload,now:()=>now,
    secretReader:async()=>JSON.stringify({username:T.owner,password:'SYNTHETIC'}),
    connect:async()=>({query:async sql=>{queries.push(sql);return {rows:[{db:'wrong',usr:T.owner}]};},end:async()=>{ended=true;}})});
  const r=await h({command:'preflight',payloadHash:config.payloadHash,baseline:null,bindings:syntheticBindings()});
  assert.equal(r.code,'B2B_CONNECTED_TARGET_REJECTED');assert.equal(queries.length,1);assert.ok(ended);
});
test('propagation retries are bounded and ONLY before Secret reads permit any DB command',()=>{
  const r={ok:false,stage:'owner-secret',errorName:'AccessDeniedException',denialCategory:'VPC_ENDPOINT_POLICY'};
  assert.equal(retryablePreflight('preflight',r,0),true);assert.equal(retryablePreflight('preflight',r,24),false);
  for(const command of ['trial','apply','verify'])assert.equal(retryablePreflight(command,r,0),false);
  for(const patch of [{stage:'data-command'},{denialCategory:'SERVICE_CONTROL_POLICY'},{denialCategory:'PERMISSIONS_BOUNDARY'},
    {denialCategory:'KMS_POLICY'},{ok:true}])assert.equal(retryablePreflight('preflight',{...r,...patch},0),false);
});
test('authorization categories do not return raw messages/ARNs or credential-shaped fragments',async()=>{
  const h=createImporter({config,payload,now:()=>now,secretReader:()=>{throw Object.assign(new Error('PRIVATE_CANARY no VPC endpoint policy allows this action'),{name:'AccessDeniedException'});}});
  const r=await h({command:'preflight',payloadHash:config.payloadHash,baseline:null,bindings:syntheticBindings()});
  assert.equal(r.denialCategory,'VPC_ENDPOINT_POLICY');assert.equal(r.stage,'owner-secret');assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));
});
