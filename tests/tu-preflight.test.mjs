import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {execFileSync} from 'node:child_process';
import reader from '../scripts/operations/tu-preflight/reader.js';
import {endpointPolicy,executionPolicy,invokePolicy,buildArtifact,hash} from '../scripts/operations/tu-preflight/operator.mjs';
import {readZipEntry,listZipEntries} from '../scripts/operations/zip-archive.mjs';
import {compareMetadata} from '../scripts/operations/tu-preflight/compare.mjs';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
const {TARGET:T,FUNCTION_ARN,SQL,validate,createReader}=reader;
const now=Date.now(),runId='a'.repeat(32);
const env={NODE_ENV:'production',AWS_REGION:T.region,PREFLIGHT_ENABLED:'true',PREFLIGHT_RUN_ID:runId,PREFLIGHT_EXPIRES_AT:new Date(now+600000).toISOString()};
const event={contract:T.contract,runId,mode:'metadata'},ctx={functionVersion:'1',invokedFunctionArn:FUNCTION_ARN+':1'};
const guards={database_matches:true,user_matches:true,read_only:true,repeatable_read:true,server_version_num:160015};
function fixture({badGuard=false,fail=false,slow=false}={}){
 const calls=[],logs=[];let released=0,ended=0,pools=0;
 const client={on(){},release(destroy){assert.equal(destroy,true);released++;},async query(sql,values){calls.push({sql,values});
  if(slow && sql===SQL.tables)await new Promise(r=>setTimeout(r,50));
  if(fail && sql===SQL.tables)throw Error('PRIVATE_PASSWORD_PROFILE_CANARY');
  if(sql===SQL.guard)return {rows:[{...guards,read_only:!badGuard}]};
  if(sql===SQL.tables)return {rows:[{name:'schema_migrations',can_select:true,kind:'r'}]};
  if(sql===SQL.migrations)return {rows:[{version:'001_initial_schema.sql',checksum:'b'.repeat(64)}]};
  if(sql===SQL.identity)return {rows:[{exact_links:1,active_links:1,linked_owners:1,active_matching_students:1,complete_single_owner:1}]};
  return {rows:[]};
 }};
 const createPool=()=>{pools++;return {on(){},async connect(){return client;},async end(){ended++;}};};
 return {calls,logs,createPool,get released(){return released;},get ended(){return ended;},get pools(){return pools;}};
}
test('exact account/version/expiry and enabled operator envelope is accepted',()=>{
 assert.equal(validate(event,ctx,env,now),'metadata');
 assert.equal(validate({...event,mode:'identity',subject:'9000000001'},ctx,env,now),'identity');
});
for(const [name,body,context,config] of [
 ['arbitrary SQL',{...event,sql:'DELETE FROM users'},ctx,env],
 ['HTTP shape',{...event,requestContext:{}},ctx,env],
 ['extra subject',{...event,subject:'9000000001'},ctx,env],
 ['wrong run',{...event,runId:'b'.repeat(32)},ctx,env],
 ['unsupported mode',{...event,mode:'migrate'},ctx,env],
 ['wrong function',event,{...ctx,invokedFunctionArn:FUNCTION_ARN.replace('readonly','other')+':1'},env],
 ['unqualified',event,{...ctx,invokedFunctionArn:FUNCTION_ARN},env],
 ['latest',event,{...ctx,functionVersion:'$LATEST',invokedFunctionArn:FUNCTION_ARN+':$LATEST'},env],
 ['expired',event,ctx,{...env,PREFLIGHT_EXPIRES_AT:new Date(now-1).toISOString()}],
 ['unbounded expiry',event,ctx,{...env,PREFLIGHT_EXPIRES_AT:new Date(now+7200001).toISOString()}],
 ['disabled',event,ctx,{...env,PREFLIGHT_ENABLED:'false'}],
 ['wrong region',event,ctx,{...env,AWS_REGION:'us-east-1'}],
 ['database URL',event,ctx,{...env,DATABASE_URL:'PRIVATE_CANARY'}],
 ['provider credential',event,ctx,{...env,TU_API_APP_KEY:'PRIVATE_CANARY'}],
 ['malformed identity',{...event,mode:'identity',subject:'not-an-id'},ctx,env]
])test(`denies ${name} before creating a DB pool`,async()=>{
 const f=fixture();const r=await createReader({env:config,clock:()=>now,createPool:f.createPool,logger:l=>f.logs.push(l)})(body,context);
 assert.equal(r.ok,false);assert.equal(f.pools,0);assert.equal(f.calls.length,0);
 assert.ok(!JSON.stringify({r,logs:f.logs}).includes('PRIVATE_CANARY'));
});
test('metadata transaction starts read only, guards it, never commits, and destroys connection',async()=>{
 const f=fixture();const r=await createReader({env,clock:()=>now,createPool:f.createPool,logger:l=>f.logs.push(l)})(event,ctx);
 assert.equal(r.ok,true);assert.equal(r.data.identity.status,'NOT_CHECKED');
 assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(f.calls[4].sql,SQL.guard);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 assert.ok(f.calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT)\b/i.test(c.sql)));
 assert.equal(f.released,1);assert.equal(f.ended,1);assert.equal(JSON.parse(f.logs[0]).code,'PREFLIGHT_OK');
});
test('false read-only guard prevents all metadata reads',async()=>{
 const f=fixture({badGuard:true});const r=await createReader({env,clock:()=>now,createPool:f.createPool,logger:()=>{}})(event,ctx);
 assert.equal(r.error.code,'PREFLIGHT_READONLY_GUARD_FAILED');assert.ok(!f.calls.some(c=>c.sql===SQL.tables));assert.equal(f.released,1);
});
test('raw database exception never reaches output/log and connection is destroyed',async()=>{
 const f=fixture({fail:true});const r=await createReader({env,clock:()=>now,createPool:f.createPool,logger:l=>f.logs.push(l)})(event,ctx);
 assert.equal(r.error.code,'PREFLIGHT_QUERY_UNAVAILABLE');assert.ok(!JSON.stringify({r,logs:f.logs}).includes('PRIVATE_PASSWORD_PROFILE_CANARY'));assert.equal(f.released,1);
});
test('late query cannot advance to additional reads after deadline',async()=>{
 const f=fixture({slow:true});const r=await createReader({env,clock:()=>now,createPool:f.createPool,logger:()=>{},deadlineMs:10})(event,ctx);
 assert.equal(r.error.code,'PREFLIGHT_DEADLINE');await new Promise(r=>setTimeout(r,70));
 assert.ok(!f.calls.some(c=>c.sql===SQL.migrations));assert.equal(f.released,1);
});
test('fixed SQL is a bounded SELECT-only allowlist without locking or caller object identifiers',()=>{
 for(const sql of Object.values(SQL)){
  const tokens=sql.replace(/'(?:''|[^'])*'/g,"''");
  assert.match(tokens,/^\s*(SELECT|WITH)\b/);assert.doesNotMatch(tokens,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|COPY|DO)\b/i);
  assert.doesNotMatch(tokens,/\bFOR\s+(?:UPDATE|SHARE)\b/i);
 }
 assert.match(SQL.migrations,/LIMIT 100/);assert.match(SQL.columns,/LIMIT 1500/);
});
test('optional identity is parameterized and result has no username/profile/token',async()=>{
 const f=fixture();const r=await createReader({env,clock:()=>now,createPool:f.createPool,logger:l=>f.logs.push(l)})({...event,mode:'identity',subject:'9000000001'},ctx);
 assert.equal(r.ok,true);const call=f.calls.find(c=>c.sql===SQL.identity);assert.equal(call.values[1],'9000000001');
 assert.ok(!JSON.stringify({r,logs:f.logs}).includes('9000000001'));assert.ok(!f.calls.some(c=>c.sql===SQL.migrations));
});
test('endpoint changes are additive/reversible and refuse a foreign same-Sid statement',()=>{
 const original={Version:'2012-10-17',Statement:[{Sid:'ExistingApp',Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.secret,Principal:'*'}]};
 const added=endpointPolicy(original,true);assert.deepEqual(added.Statement[0],original.Statement[0]);assert.equal(original.Statement.length,1);
 assert.equal(hash(endpointPolicy(added,false)),hash(original));assert.throws(()=>endpointPolicy(added,true));
 const changed=structuredClone(added);changed.Statement[1].Resource='*';assert.throws(()=>endpointPolicy(changed,false));
});
test('execution role reads one existing secret only; no S3/Invoke/IAM capabilities',()=>{
 const p=executionPolicy(),allow=p.Statement.filter(s=>s.Effect==='Allow');
 assert.deepEqual(allow[0].Resource,T.secret);assert.ok(!JSON.stringify(allow).match(/s3:|lambda:Invoke|iam:/));
 assert.equal(p.Statement.at(-1).Condition.ArnEquals['lambda:SourceFunctionArn'],FUNCTION_ARN);
});
test('qualified version policy targets only its version while the function policy covers qualifiers',()=>{
 assert.deepEqual(invokePolicy().Statement[0].Resource,[FUNCTION_ARN,FUNCTION_ARN+':*']);
 assert.deepEqual(invokePolicy(FUNCTION_ARN+':1').Statement[0].Resource,[FUNCTION_ARN+':1']);
 assert.throws(()=>invokePolicy(FUNCTION_ARN+':$LATEST'));assert.throws(()=>invokePolicy('arn:aws:lambda:us-east-1:111111111111:function:other:1'));
});
test('packaged helper has only the fixed reader and public CA, with no application entry point',async()=>{
 const built=await buildArtifact(Buffer.from(rootCertificates[0]+'\n')),zip=join(built.path,'..','diagnostic.zip');
 assert.deepEqual(listZipEntries(zip).sort(),['global-bundle.pem','handler.js']);
 assert.deepEqual(built.state.sourceInputs,['scripts/operations/tu-preflight/catalog.js','scripts/operations/tu-preflight/reader.js','src/db/rds-secret.js']);
 const source=readZipEntry(zip,'handler.js').toString();assert.ok(!source.includes('registerV3Routes'));assert.ok(!source.includes('PRIVATE_PASSWORD_PROFILE_CANARY'));
 assert.equal(hash(readFileSync(zip)),built.state.zipSha256);
 const out=execFileSync(process.execPath,['-e',`require(${JSON.stringify(join(built.path,'..','stage','handler.js'))}).handler({sql:'DROP TABLE users'},{}).then(r=>console.log(JSON.stringify(r)))`],{encoding:'utf8'});
 assert.ok(out.includes('PREFLIGHT_DENIED'));
});

function metadataFixture(data={}){
 return {ok:true,contract:T.contract,data:{guards,migrations:[],missingTables:[],roles:[],routines:[],
  identity:{status:'NOT_CHECKED'},columns:[],tables:[],triggers:[],privileges:[],...data}};
}

test('local comparison preserves recorded lineage names and flags unreviewed history',()=>{
 const local=readReviewedMigrations(),first=local[0],schedule=local.find(m=>m.name==='014_phase1_schedules_and_confirmations.sql');
 const actual=metadataFixture({migrations:[{version:first.name,checksum:first.checksum},
  {version:'013_phase1_schedules_and_confirmations.sql',checksum:schedule.checksum},
  {version:'014_external_lineage.sql',checksum:'0'.repeat(64)}],missingTables:['phase1_submission_deliveries']});
 const before=JSON.stringify(actual),result=compareMetadata(actual);
 assert.deepEqual(result.history.exact,[first.name]);
 assert.deepEqual(result.history.sameBytesDifferentRecordedName,[{recorded:'013_phase1_schedules_and_confirmations.sql',local:schedule.name,checksum:schedule.checksum}]);
 assert.equal(result.history.unreviewedExternal[0].version,'014_external_lineage.sql');
 assert.ok(result.history.localNamesAbsent.includes('017_tu_phase1_delivery.sql'));
 assert.deepEqual(result.missingTables,['phase1_submission_deliveries']);
 assert.equal(result.loginRolePresent,false);assert.equal(result.identity,'NOT_CHECKED');
 assert.equal(JSON.stringify(actual),before);
});

test('comparison distinguishes missing tables, application columns, ACL and extra integrity triggers',()=>{
 const privilege={role:'coed_app',table_name:'phase1_reviews',select_table:true,insert_table:true,update_table:false,delete_table:false,truncate_table:false};
 const reference={tables:[{name:'phase1_reviews'}],columns:[{table_name:'schema_migrations',name:'synthetic_bookkeeping',type:'text',not_null:false},
  {table_name:'phase1_reviews',name:'state',type:'text',not_null:true},
  {table_name:'phase1_submission_deliveries',name:'id',type:'uuid',not_null:true}],
  triggers:[],routines:[],privileges:[privilege]};
 const actual=metadataFixture({missingTables:['phase1_submission_deliveries'],columns:[{table_name:'phase1_reviews',name:'state',type:'text',not_null:true}],
  triggers:[{table_name:'phase1_schedule_events',name:'phase1_schedule_events_immutable'}],
  privileges:[{...privilege,delete_table:true}],
  routines:[{name:'synthetic_elevated_function',security_definer:true,runtime_can_execute:true}]});
 const result=compareMetadata(actual,reference);
 assert.deepEqual(result.columnDifferences,[]);assert.deepEqual(result.extraProductionColumns,[]);
 assert.equal(result.extraProductionTriggers[0].name,'phase1_schedule_events_immutable');
 assert.deepEqual(result.tableGrantDifferences,[{role:'coed_app',table:'phase1_reviews',privilege:'delete_table',actual:true,local:false}]);
 assert.equal(result.executableSecurityDefiners[0].name,'synthetic_elevated_function');
});

test('local comparison refuses failed or non-read-only reader artifacts',()=>{
 assert.throws(()=>compareMetadata({...metadataFixture(),ok:false}));
 assert.throws(()=>compareMetadata(metadataFixture({guards:{...guards,read_only:false}})));
 assert.throws(()=>compareMetadata({...metadataFixture(),contract:'unreviewed'}));
});
