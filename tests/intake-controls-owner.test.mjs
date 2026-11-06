import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import reader from '../scripts/operations/intake-controls-owner/reader.js';
import {policy,statement} from '../scripts/operations/intake-controls-owner/operator.mjs';
const now=Date.now(),runId='a'.repeat(32),env={NODE_ENV:'production',AWS_REGION:reader.T.region,ENABLED:'true',RUN_ID:runId,
 EXPIRES_AT:new Date(now+600000).toISOString(),STUDENT_NUMBER:'9900000001',COORDINATOR_SUBJECT:randomUUID()};
const event={contract:reader.T.contract,runId},context={functionVersion:'1',invokedFunctionArn:reader.ARN+':1'};
test('C7 temporary capability accepts only fixed, expiring, published READ ONLY inventory',()=>{
 reader.validate(event,context,env,now);
 for(const [e,c,v] of [[{...event,mode:'apply'},context,env],[{...event,sql:'SELECT 1'},context,env],[event,{...context,functionVersion:'$LATEST'},env],
  [event,context,{...env,ENABLED:'false'}],[event,context,{...env,EXPIRES_AT:new Date(now+3600001).toISOString()}],[event,context,{...env,TU_API_APP_KEY:'synthetic'}]])
  assert.throws(()=>reader.validate(e,c,v,now),/C7_INVENTORY_DENIED/);
});
test('C7 Secret failure never leaks values or connects to the database',async()=>{
 let connected=false;const values=[];
 const handler=reader.createReader({env,clock:()=>now,secrets:{send:async()=>{throw Object.assign(new Error('private provider detail'),{name:'AccessDeniedException'});},destroy(){}},
  clientFactory:()=>{connected=true;throw Error('should not connect');},logger:x=>values.push(x)});
 const result=await handler(event,context);assert.equal(result.code,'C7_SECRET_DENIED');assert.equal(connected,false);assert.ok(!JSON.stringify([result,values]).includes('private provider detail'));
});
test('temporary role cannot retrieve app/provider/signing Secrets or invoke another Lambda',()=>{
 const p=policy(),allow=p.Statement.filter(s=>s.Effect==='Allow');
 assert.equal(allow.filter(s=>s.Action==='secretsmanager:GetSecretValue').length,1);assert.equal(allow.find(s=>s.Action==='secretsmanager:GetSecretValue').Resource,reader.T.secret);
 assert.ok(!JSON.stringify(p).includes('lambda:InvokeFunction'));assert.equal(statement().Resource,reader.T.secret);
 assert.ok(p.Statement.some(s=>s.Effect==='Deny' && s.Condition?.ArnEquals?.['lambda:SourceFunctionArn']===reader.ARN));
});
