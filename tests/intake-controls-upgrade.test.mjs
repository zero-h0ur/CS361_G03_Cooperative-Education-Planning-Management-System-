import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id,createHash} from 'node:crypto';
import {validateManifest} from '../scripts/operations/intake-controls-upgrade.mjs';
import {validate,createHandler} from '../scripts/operations/intake-controls-owner/upgrade-handler.mjs';
import reader from '../scripts/operations/intake-controls-owner/reader.js';
const now=Date.now(),runId='a'.repeat(32),manifest={version:1,baselineCatalogHash:'a'.repeat(64),cycleId:id(),cohortId:id(),sourceCycleId:id(),sourceCohortId:id(),
 coordinatorUserId:id(),coordinatorSubject:id(),members:[id(),id(),id()],studentId:id(),studentUserId:id()};
const bytes=Buffer.from(JSON.stringify(manifest)),env={NODE_ENV:'production',AWS_REGION:reader.T.region,ENABLED:'true',RUN_ID:runId,EXPIRES_AT:new Date(now+600000).toISOString(),
 MANIFEST_SHA256:createHash('sha256').update(bytes).digest('hex'),TRIAL_PASSED:'false',EXPECTED_POST_HASH:''};
const event={contract:'coed-intake-controls-upgrade-v1',mode:'trial',runId},context={functionVersion:'1',invokedFunctionArn:reader.ARN+':1'};
test('C7 write artifact rejects Apply before Trial, arbitrary SQL/bindings, reused source IDs and changed manifest',async()=>{
 validate(event,context,env,now);assert.throws(()=>validate({...event,mode:'apply'},context,env,now),/C7_TRIAL_REQUIRED/);
 assert.throws(()=>validate({...event,sql:'DELETE'},context,env,now),/C7_UPGRADE_DENIED/);
 assert.throws(()=>validateManifest({...manifest,cycleId:manifest.sourceCycleId}),/C7_MANIFEST_DENIED/);
 assert.throws(()=>validateManifest({...manifest,members:[manifest.members[0],manifest.members[0],manifest.members[2]]}),/C7_MANIFEST_DENIED/);
 let touched=false;const handler=createHandler({env,clock:()=>now,readManifest:()=>Buffer.from('{}'),secrets:{send:async()=>{touched=true;}}});
 assert.equal((await handler(event,context)).code,'C7_MANIFEST_DRIFT');assert.equal(touched,false);
});
test('C7 immutable artifact selects only the approved database upgrade and cleans a failed connection',async()=>{
 const queries=[];let ended=false,requested;
 const handler=createHandler({env,clock:()=>now,readManifest:()=>bytes,secrets:{send:async c=>{requested=c.input.SecretId;return {SecretString:JSON.stringify({username:'postgres',password:'synthetic-only',host:reader.T.host})};},destroy(){}},
  connect:()=>({connect:async()=>{},query:async sql=>{queries.push(sql);return {rows:[]};},end:async()=>{ended=true;}}),
  upgrade:async args=>{assert.deepEqual(args.manifest,manifest);assert.equal(args.mode,'trial');assert.equal(args.expectedPostHash,'');throw Object.assign(Error('private SQL detail'),{safeCode:'C7_BASELINE_DRIFT'});}});
 const result=await handler(event,context);assert.equal(result.code,'C7_BASELINE_DRIFT');assert.equal(requested,reader.T.secret);assert.equal(ended,true);assert.deepEqual(queries,['ROLLBACK']);
 assert.ok(!JSON.stringify(result).includes('private SQL detail'));assert.ok(!JSON.stringify(result).includes('synthetic-only'));
});
