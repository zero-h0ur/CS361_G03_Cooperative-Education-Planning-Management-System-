import test from 'node:test';
import assert from 'node:assert/strict';
import {readIssuerSql,transformedCatalog,ISSUER,SQL_SHA256} from '../scripts/operations/tu-registration-issuer-upgrade.mjs';
import {T,validate,createHandler} from '../scripts/operations/tu-registration-issuer/handler.mjs';
import {executionPolicy,endpointStatement} from '../scripts/operations/tu-registration-issuer/operator.mjs';
const now=Date.now(),runId='a'.repeat(32),env={NODE_ENV:'production',AWS_REGION:T.region,ENABLED:'true',MAINTENANCE_VERIFIED:'true',EXPECTED_ISSUER:ISSUER,RUN_ID:runId,EXPIRES_AT:new Date(now+60000).toISOString(),TRIAL_PASSED:'true'};
const context={functionVersion:'1',invokedFunctionArn:`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}:1`};
const event=mode=>({contract:T.contract,runId,mode});
test('020 is fixed-LF checksum verified and contains no row or historical migration rewrite',()=>{
 const sql=readIssuerSql();assert.match(SQL_SHA256,/^[a-f0-9]{64}$/);assert.ok(!sql.includes('\r'));
 assert.match(sql,/GRANT coed_tu_registration_owner TO postgres/);assert.match(sql,/REVOKE coed_tu_registration_owner FROM postgres/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE ROLE|ALTER TABLE)\b/);
 assert.ok(sql.includes(ISSUER));assert.ok(sql.includes('guard_tu_registration_profile'));
});
test('only two exact literals transform; foreign/missing/duplicate namespaces fail closed',()=>{
 const input={routines:[{name:'complete_tu_registration',definition:"SELECT 'urn:coed:tu-auth'"},{name:'guard_tu_registration_profile',definition:"SELECT 'urn:coed:tu-auth'"},{name:'untouched',definition:'SELECT 1'}]};
 const changed=transformedCatalog(input);assert.deepEqual(transformedCatalog(changed,true),input);assert.equal(input.routines[0].definition,"SELECT 'urn:coed:tu-auth'");
 assert.equal(changed.routines[2].definition,'SELECT 1');assert.throws(()=>transformedCatalog(changed));
 assert.throws(()=>transformedCatalog({routines:input.routines.slice(1)}));
 assert.throws(()=>transformedCatalog({routines:input.routines.map(r=>({...r,definition:r.definition+" 'urn:coed:tu-auth'"}))}));
});
test('expiring qualified owner contract rejects SQL, account operations, wrong issuer and unapproved apply',()=>{
 assert.equal(validate(event('trial'),context,env,now),'trial');assert.equal(validate(event('apply'),context,env,now),'apply');
 for(const value of [{...event('trial'),sql:'SELECT 1'},event('credential'),event('register'),{...event('trial'),runId:'b'.repeat(32)}])assert.throws(()=>validate(value,context,env,now));
 for(const patch of [{EXPECTED_ISSUER:'urn:coed:tu-auth'},{TRIAL_PASSED:'false'},{ENABLED:'false'},{EXPIRES_AT:new Date(now-1).toISOString()},{REGISTRATION_SECRET:'canary'}])assert.throws(()=>validate(event('apply'),context,{...env,...patch},now));
 assert.throws(()=>validate(event('trial'),{...context,functionVersion:'$LATEST'},env,now));
});
test('handler reads only fixed owner secret, calls fixed upgrade and never reveals credentials',async()=>{
 const logs=[];let closed=0;
 const handler=createHandler({env,clock:()=>now,secrets:{send:async command=>{assert.equal(command.input.SecretId,T.owner);return {SecretString:JSON.stringify({username:'postgres',password:'SYNTHETIC_OWNER_CANARY'})};}},
  connect:password=>{assert.equal(password,'SYNTHETIC_OWNER_CANARY');return {connect:async()=>{},query:async()=>{},end:async()=>{closed++;}};},
  upgrade:async options=>{assert.equal(options.mode,'trial');assert.equal(options.expectedIssuer,ISSUER);return {preservationVerified:true};},logger:x=>logs.push(x)});
 const result=await handler(event('trial'),context);assert.equal(result.ok,true);assert.equal(closed,1);assert.ok(!JSON.stringify([result,logs]).includes('SYNTHETIC_OWNER_CANARY'));
});
test('denied secret or unsafe request never connects; raw errors stay private',async()=>{
 let reads=0;const handler=createHandler({env,clock:()=>now,secrets:{send:async()=>{reads++;throw Object.assign(Error('RAW_CANARY'),{name:'AccessDeniedException'});}},connect:()=>{throw Error('MUST_NOT_CONNECT');},logger:()=>{}});
 const rejected=await handler({...event('trial'),subject:'9900000019'},context);assert.equal(rejected.ok,false);assert.equal(reads,0);
 const denied=await handler(event('trial'),context);assert.equal(denied.error.code,'ISSUER020_SECRET_DENIED');assert.ok(!JSON.stringify(denied).includes('RAW_CANARY'));
});
test('temporary tool can read only the existing owner Secret; no password rotation or provider/signing access',()=>{
 const policy=executionPolicy(),secret=policy.Statement.filter(s=>s.Action==='secretsmanager:GetSecretValue');
 assert.equal(secret.length,1);assert.equal(secret[0].Resource,T.owner);
 assert.ok(!JSON.stringify(policy).includes('PutSecretValue'));assert.ok(!JSON.stringify(policy).includes('coed/v4/tu/'));
 const statement=endpointStatement({runId});assert.equal(statement.Resource,T.owner);assert.equal(statement.Condition.ArnEquals['aws:PrincipalArn'],`arn:aws:iam::${T.account}:role/${T.role}`);
 assert.equal(statement.Action,'secretsmanager:GetSecretValue');
});
