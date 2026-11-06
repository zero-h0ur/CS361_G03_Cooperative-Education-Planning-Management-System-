import test from 'node:test';
import assert from 'node:assert/strict';
import reader from '../scripts/operations/intake-readiness/reader.js';
import {executionPolicy,endpointGrant,waitForPropagation} from '../scripts/operations/intake-readiness/operator.mjs';
const {T,ARN,SQL,createReader}=reader,runId='a'.repeat(32),now=Date.now();
const env={NODE_ENV:'production',AWS_REGION:T.region,INTAKE_ENABLED:'true',INTAKE_RUN_ID:runId,INTAKE_EXPIRES_AT:new Date(now+600000).toISOString()};
const event={contract:T.contract,runId},context={functionVersion:'1',invokedFunctionArn:ARN+':1'};
function fixture({bad=false,error=false}={}){let pools=0,released=0;const calls=[],logs=[];
 const client={on(){},release(destroy){assert.equal(destroy,true);released++;},async query(sql){calls.push(sql);
  if(sql===SQL.guard)return {rows:[{database_matches:true,user_matches:true,read_only:!bad,repeatable_read:true}]};
  if(error && sql===SQL.rounds)throw Error('PRIVATE_CANARY');return {rows:[]};}};
 return {calls,logs,poolFactory:()=>{pools++;return {on(){},connect:async()=>client,end:async()=>{}};},get pools(){return pools;},get released(){return released;}};
}
for(const [name,body,ctx,config] of [
 ['SQL',{...event,sql:'DELETE FROM students'},context,env],['HTTP',{...event,requestContext:{}},context,env],
 ['owner override',{...event,studentId:'9000000001'},context,env],['expired',event,context,{...env,INTAKE_EXPIRES_AT:new Date(now-1).toISOString()}],
 ['latest',event,{functionVersion:'$LATEST',invokedFunctionArn:ARN+':$LATEST'},env],
 ['private key',event,context,{...env,TU_AUTH_PRIVATE_KEY:'PRIVATE_CANARY'}]
])test(`intake diagnostic denies ${name} before DB`,async()=>{const f=fixture();const r=await createReader({env:config,clock:()=>now,poolFactory:f.poolFactory,logger:x=>f.logs.push(x)})(body,ctx);
 assert.equal(r.ok,false);assert.equal(f.pools,0);assert.ok(!JSON.stringify({r,logs:f.logs}).includes('PRIVATE_CANARY'));});
test('intake diagnostic rolls back fixed SELECT transaction and never dumps identities',async()=>{const f=fixture();
 const r=await createReader({env,clock:()=>now,poolFactory:f.poolFactory,logger:x=>f.logs.push(x)})(event,context);
 assert.equal(r.ok,true);assert.match(f.calls[0],/BEGIN.*READ ONLY/);assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.released,1);
 for(const sql of Object.values(SQL)){assert.match(sql,/^SELECT/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|FOR SHARE|COMMIT)\b/);}
 assert.doesNotMatch(SQL.cohorts,/SELECT[^;]*(?:full_name|email|external_subject)/i);
});
test('read-only guard and raw DB failure stop safely',async()=>{for(const options of [{bad:true},{error:true}]){const f=fixture(options);
 const r=await createReader({env,clock:()=>now,poolFactory:f.poolFactory,logger:x=>f.logs.push(x)})(event,context);
 assert.equal(r.ok,false);assert.equal(f.released,1);assert.ok(!JSON.stringify({r,logs:f.logs}).includes('PRIVATE_CANARY'));}});
test('A0 temporary policy has exact app Secret, no data writes or other Secrets',()=>{
 const p=executionPolicy();assert.equal(p.Statement[0].Resource,T.secret);assert.equal(p.Statement[0].Action,'secretsmanager:GetSecretValue');
 assert.doesNotMatch(JSON.stringify(p),/s3:|PutSecretValue|RotateSecret|tu-login|provider|signing/);
 assert.equal(endpointGrant().Resource,T.secret);assert.ok(endpointGrant().Condition.ArnEquals['aws:PrincipalArn'].endsWith(T.role));
});
test('endpoint propagation waits in bounded intervals and cancellation stops without replay',async()=>{
 const waits=[];await waitForPropagation({wait:async ms=>waits.push(ms),progress:()=>{}});assert.equal(waits.length,10);assert.ok(waits.every(x=>x===30000));
 let n=0;await assert.rejects(waitForPropagation({wait:async()=>{},progress:()=>{},check:()=>{if(++n===2)throw Error('cancel');}}),/cancel/);
});
