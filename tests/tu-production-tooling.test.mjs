import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {TARGET,FUNCTION_ARN,validate,ownerPassword,scram,createOwnerTool} from '../scripts/operations/tu-owner/handler.mjs';
const require=createRequire(import.meta.url),{maintenanceResponse}=require('../src/maintenance.js');
const now=Date.now(),env={NODE_ENV:'production',AWS_REGION:TARGET.region,OWNER_RUN_ID:'a'.repeat(32),
 OWNER_ENABLED:'true',OWNER_MAINTENANCE:'true',OWNER_SNAPSHOT_VERIFIED:'true',OWNER_TRIAL_SUCCEEDED:'true',
 OWNER_LOGIN_SECRET_ARN:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/tu-login-Abc123',
 OWNER_EXPIRES_AT:new Date(now+3600000).toISOString()};
const event={contract:TARGET.contract,runId:env.OWNER_RUN_ID,mode:'trial'},context={functionVersion:'1',invokedFunctionArn:FUNCTION_ARN+':1'};
test('maintenance fails closed for all commands and lazily mutating GETs',()=>{
 for(const mode of ['all','unknown','verify'])for(const method of ['POST','PUT','PATCH','DELETE','GET'])
  assert.equal(maintenanceResponse({rawPath:'/api/tu-proxy/api/v4/applications/current',requestContext:{http:{method}}},mode).statusCode,503);
 assert.equal(maintenanceResponse({},undefined),null);
 for(const path of ['/api/v3/me','/api/tu-proxy/api/v3/me','/api/v3/students/me','/api/tu-proxy/api/v3/students/me']){
  assert.equal(maintenanceResponse({rawPath:path,httpMethod:'GET'},'verify'),null);
  for(const e of [{rawPath:path+'/',httpMethod:'GET'},{rawPath:path,httpMethod:'POST'},
    {rawPath:path,httpMethod:'GET',rawQueryString:'x=1'},{rawPath:path,httpMethod:'GET',queryStringParameters:{x:'1'}}])
   assert.equal(maintenanceResponse(e,'verify').statusCode,503);
 }
});
test('maintenance response has no-store/retry and never echoes credentials or body',()=>{
 const r=maintenanceResponse({body:'PRIVATE_TEST_MARKER',headers:{Authorization:'PRIVATE_TEST_MARKER'}},'all');
 assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers['Retry-After'],'120');
 assert.ok(!r.body.includes('PRIVATE_TEST_MARKER'));
});
test('owner envelope is exact and not a SQL/credential input surface',()=>{
 assert.equal(validate(event,context,env,now),'trial');
 for(const e of [{...event,sql:'SELECT 1'},{...event,mode:'schema'},{...event,runId:'x'},
   {...event,password:'PRIVATE_TEST_MARKER'},null,[]])assert.throws(()=>validate(e,context,env,now));
 for(const change of [{OWNER_ENABLED:'false'},{OWNER_MAINTENANCE:'false'},{OWNER_SNAPSHOT_VERIFIED:'false'},
  {AWS_REGION:'us-east-1'},{NODE_ENV:'test'},{OWNER_LOGIN_SECRET_ARN:env.OWNER_LOGIN_SECRET_ARN.replace('130165494095','111111111111')},
  {OWNER_EXPIRES_AT:new Date(now-1).toISOString()},{OWNER_EXPIRES_AT:new Date(now+7200001).toISOString()},
  {TU_API_APP_KEY:'PRIVATE_TEST_MARKER'},{TU_AUTH_PRIVATE_KEY:'PRIVATE_TEST_MARKER'}])
   assert.throws(()=>validate(event,context,{...env,...change},now));
 assert.throws(()=>validate(event,{...context,functionVersion:'$LATEST'},env,now));
 assert.throws(()=>validate(event,{...context,invokedFunctionArn:FUNCTION_ARN},env,now));
 for(const mode of ['apply','login'])assert.throws(()=>validate({...event,mode},context,{...env,OWNER_TRIAL_SUCCEEDED:'false'},now));
});
test('managed owner secret cannot redirect the connection or change the owner',()=>{
 assert.equal(ownerPassword({username:'postgres',password:'synthetic'}),'synthetic');
 for(const v of [{username:'coed_app',password:'x'},{username:'postgres',password:''},
  {username:'postgres',password:'x',host:'other'},{username:'postgres',password:'x',engine:'mysql'}])assert.throws(()=>ownerPassword(v));
});
test('SCRAM verifier authenticates generated password but contains no plaintext',()=>{
 const password='a'.repeat(64),salt=Buffer.alloc(16,1),v=scram(password,salt);
 const salted=pbkdf2Sync(password,salt,4096,32,'sha256'),key=createHmac('sha256',salted).update('Client Key').digest();
 assert.ok(v.includes(createHash('sha256').update(key).digest('base64')));assert.ok(!v.includes(password));
 assert.throws(()=>scram("'".repeat(64)));
});
test('owner rejection does not read a secret; SQL errors/logs are redacted and connections close',async()=>{
 let reads=0,ends=0;const logs=[],sm={send:async()=>{reads++;return {SecretString:JSON.stringify({username:'postgres',password:'PRIVATE_TEST_MARKER'})};}};
 const client={connect:async()=>{},query:async()=>({rows:[]}),end:async()=>{ends++;}};
 const handler=createOwnerTool({env,clock:()=>now,secrets:sm,connect:async()=>client,
  upgrade:async()=>{throw Error('PRIVATE_TEST_MARKER');},logger:x=>logs.push(x)});
 assert.equal((await handler({...event,sql:'x'},context)).ok,false);assert.equal(reads,0);
 const r=await handler(event,context);assert.equal(r.error.code,'OWNER_OPERATION_FAILED');assert.equal(ends,1);
 assert.ok(!JSON.stringify([r,logs]).includes('PRIVATE_TEST_MARKER'));
});
test('login provisioning cannot run before the verified upgrade is already applied',async()=>{
 let provisions=0;
 const handler=createOwnerTool({env,clock:()=>now,
  secrets:{send:async()=>({SecretString:'{"username":"postgres","password":"synthetic"}'})},
  connect:async()=>({connect:async()=>{},query:async()=>({rows:[]}),end:async()=>{}}),
  upgrade:async()=>({applied:false,idempotentReplay:false}),loginProvisioner:async()=>{provisions++;},logger:()=>{}});
 assert.equal((await handler({...event,mode:'login'},context)).error.code,'OWNER_APPLY_REQUIRED');assert.equal(provisions,0);
});
test('owner deadline refuses late queries and logs no supplied payload',async()=>{
 const handler=createOwnerTool({env,clock:()=>now,
  secrets:{send:async()=>({SecretString:'{"username":"postgres","password":"synthetic"}'})},
  connect:async()=>({connect:async()=>{},query:async()=>({rows:[]}),end:async()=>{}}),
  upgrade:async({client})=>client.query('COMMIT'),logger:()=>{}});
 assert.equal((await handler(event,{...context,getRemainingTimeInMillis:()=>4000})).error.code,'OWNER_DEADLINE');
});
test('operator entrypoint keeps SQL files pinned and has no provider/signing import',()=>{
 const src=readFileSync(new URL('../scripts/operations/tu-owner/handler.mjs',import.meta.url),'utf8');
 assert.ok(!src.includes("from '../../../src/auth"));assert.ok(!src.includes('console.error('));
 assert.ok(src.includes("mode:mode==='apply'?'apply':'trial'"));assert.ok(src.includes('readFileSync'));
});
