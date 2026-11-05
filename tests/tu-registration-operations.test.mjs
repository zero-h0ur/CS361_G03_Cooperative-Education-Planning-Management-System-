import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {T,validate,createHandler,scram} from '../scripts/operations/tu-registration/handler.mjs';
import {readRegistrationSql,SQL_SHA256,POST_SHA256} from '../scripts/operations/tu-registration-upgrade.mjs';
const now=Date.now(),runId='a'.repeat(32),context={functionVersion:'1',invokedFunctionArn:`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}:1`};
const env={NODE_ENV:'production',AWS_REGION:T.region,ENABLED:'true',MAINTENANCE_VERIFIED:'true',SNAPSHOT_VERIFIED:'true',RUN_ID:runId,
 EXPIRES_AT:new Date(now+60000).toISOString(),REGISTRATION_SECRET:`arn:aws:secretsmanager:${T.region}:${T.account}:secret:coed/v4/postgres/tu-registration-ABCdef`,TRIAL_PASSED:'true'};
const event=mode=>({contract:T.contract,runId,mode});
test('reviewed019 SQL is exact LF, pinned and does not touch historic migration files',()=>{
 const sql=readRegistrationSql();assert.match(SQL_SHA256,/^[a-f0-9]{64}$/);assert.match(POST_SHA256,/^[a-f0-9]{64}$/);
 assert.ok(!sql.includes('\r'));assert.match(sql,/NOLOGIN/);assert.match(sql,/REVOKE coed_tu_registration_owner FROM postgres/);
 assert.doesNotMatch(sql,/DELETE FROM|UPDATE public\.(?:users|students|external_identity_links)/);
});
test('fixed operator-only expiring request contract has no arbitrary SQL or account mode',()=>{
 assert.equal(validate(event('trial'),context,env,now),'trial');
 for(const bad of [{...event('trial'),sql:'SELECT 1'},event('register'),{...event('trial'),runId:'b'.repeat(32)}])assert.throws(()=>validate(bad,context,env,now));
 for(const patch of [{ENABLED:'false'},{TRIAL_PASSED:'false'},{EXPIRES_AT:new Date(now-1).toISOString()},{DATABASE_URL:'synthetic-canary'},{REGISTRATION_SECRET:T.owner}])
  assert.throws(()=>validate(event('apply'),context,{...env,...patch},now));
 assert.throws(()=>validate(event('trial'),{...context,functionVersion:'$LATEST'},env,now));
});
test('trial only calls the guarded upgrade and redacts secret/query details',async()=>{
 let ends=0,upgrades=0;const logs=[];
 const handler=createHandler({env,clock:()=>now,secrets:{send:async()=>({SecretString:JSON.stringify({username:'postgres',password:'SYNTHETIC_OWNER_CANARY'})})},
  connect:()=>({connect:async()=>{},query:async()=>{},end:async()=>{ends++;}}),
  upgrade:async input=>{upgrades++;assert.equal(input.mode,'trial');assert.equal(input.expectedDatabase,'coed');return {applied:false,preservationVerified:true};},logger:line=>logs.push(line)});
 const result=await handler(event('trial'),context);assert.equal(result.ok,true);assert.equal(upgrades,1);assert.equal(ends,1);
 assert.ok(!JSON.stringify([result,logs]).includes('SYNTHETIC_OWNER_CANARY'));
});
test('a denied Secret never reaches PostgreSQL and only returns a fixed safe error',async()=>{
 const handler=createHandler({env,clock:()=>now,secrets:{send:async()=>{throw Object.assign(Error('SECRET_CANARY'),{name:'AccessDeniedException'});}},
  connect:()=>{throw Error('MUST_NOT_CONNECT');},logger:()=>{}});
 const result=await handler(event('trial'),context);assert.equal(result.ok,false);assert.equal(result.error.code,'REGISTRATION_OWNER_SECRET_DENIED');assert.ok(!JSON.stringify(result).includes('CANARY'));
});
test('credential operation cannot run before verified019 Apply and does not create an account',async()=>{
 let provisions=0;const handler=createHandler({env,clock:()=>now,secrets:{send:async()=>({SecretString:JSON.stringify({username:'postgres',password:'SYNTHETIC_OWNER_CANARY'})})},
  connect:()=>({connect:async()=>{},query:async()=>{},end:async()=>{}}),upgrade:async()=>({idempotentReplay:false}),provision:async()=>{provisions++;},logger:()=>{}});
 const result=await handler(event('credential'),context);assert.equal(result.ok,false);assert.equal(provisions,0);
});
test('only a SCRAM verifier, not a clear password, enters the fixed ALTER ROLE statement',()=>{
 const value=randomBytes(48).toString('base64url'),encoded=scram(value);assert.match(encoded,/^SCRAM-SHA-256\$4096:/);assert.ok(!encoded.includes(value));assert.throws(()=>scram('short'));
 const source=readFileSync(new URL('../scripts/operations/tu-registration/handler.mjs',import.meta.url),'utf8');
 assert.ok(!source.includes('console.log(owner'));assert.ok(!source.includes('CREATE USER'));assert.ok(!source.includes('complete_tu_registration($'));
});
