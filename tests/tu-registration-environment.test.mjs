import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {issuerRegistrationEnvironment,publicKeyFingerprint} from '../scripts/operations/tu-registration/environment.mjs';
const require=createRequire(import.meta.url);
const {TuRegistrationService}=require('../src/auth/tu-registration-service');
const {REGISTRATION}=require('../src/auth/tu-registration-contract');
const {createTuSessionIssuer}=require('../src/tu-session-issuer');
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=keys.publicKey.export({type:'spki',format:'pem'});
const verifier={TU_AUTH_PUBLIC_KEY:pem,TU_AUTH_ISSUER:'urn:coed:tu-auth',TU_AUTH_CLIENT_ID:'coed-api'};
const secret='arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:coed/v4/postgres/tu-registration-ABCdef';
const issuer={NODE_ENV:'production',DB_USER:'coed_tu_login',DB_POOL_MAX:'1',TU_SIGNING_SECRET_ARN:'SYNTHETIC_SECRET_REFERENCE',
 TU_AUTH_ISSUER:verifier.TU_AUTH_ISSUER,TU_AUTH_CLIENT_ID:verifier.TU_AUTH_CLIENT_ID,TU_SESSION_FUNCTION_ARN:'SYNTHETIC_PRIVATE_ALIAS'};
function withEnv(values,work){
 const names=['TU_AUTH_PUBLIC_KEY','TU_AUTH_ISSUER','TU_AUTH_CLIENT_ID','TU_AUTH_KEY_ID'],previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 for(const k of names)if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];
 return Promise.resolve().then(work).finally(()=>{for(const k of names)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];});
}
async function completionFixture(){
 const now=Date.now(),subject='9900000019';
 const identity={subject,nameTh:'Synthetic Student',nameEn:null,email:'student@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'\u0e1b\u0e01\u0e15\u0e34',statusId:null};
 const service=new TuRegistrationService({clock:()=>now,pool:{query:async()=>({rows:[{linked:false,student:false}]})}});
 const token=(await service.begin({contract:REGISTRATION,operation:'begin',subject,identity,verifiedAt:now,requestId:randomUUID()},async()=>keys)).registrationToken;
 return {now,subject,envelope:{ticket:token,study:{programType:'regular',entryYear:2567},operationId:randomUUID()}};
}

test('production-shaped old issuer reproduces signing503 before any database connection',()=>withEnv(issuer,async()=>{
 const fixture=await completionFixture();let connected=false;
 const service=new TuRegistrationService({clock:()=>fixture.now,provisionConnect:async()=>{connected=true;throw Error();}});
 await assert.rejects(service.complete(fixture.envelope),e=>e.code==='TU_SIGNING_UNAVAILABLE'&&e.statusCode===503);
 assert.equal(connected,false);
}));

test('assembled production environment completes valid proof without an injected service public key',()=>withEnv(issuerRegistrationEnvironment(issuer,verifier,secret),async()=>{
 const fixture=await completionFixture(),userId=randomUUID(),studentId=randomUUID();let queries=0,ends=0;
 const service=new TuRegistrationService({clock:()=>fixture.now,provisionConnect:async()=>({
  query:async(sql,args)=>{queries++;assert.match(sql,/^SELECT \* FROM public\.complete_tu_registration\(/);assert.equal(JSON.parse(args[3]).subject,fixture.subject);return {rows:[{user_id:userId,student_id:studentId}]};},
  end:async()=>{ends++;}
 })});
 assert.deepEqual(await service.complete(fixture.envelope),{subject:fixture.subject,userId,studentId});
 assert.equal(queries,1);assert.equal(ends,1);
}));

test('only verification/onboarding configuration is added; all existing fields and inputs are preserved',()=>{
 const before={...issuer},result=issuerRegistrationEnvironment(issuer,verifier,secret);
 assert.deepEqual(issuer,before);for(const [key,value] of Object.entries(issuer))assert.equal(result[key],value);
 assert.deepEqual(Object.keys(result).filter(k=>!Object.hasOwn(issuer,k)).sort(),['TU_AUTH_KEY_ID','TU_AUTH_PUBLIC_KEY','TU_ONBOARDING_ENABLED','TU_REGISTRATION_DB_SECRET_ARN']);
 assert.equal(result.TU_AUTH_KEY_ID,'tu-key-1');assert.equal(publicKeyFingerprint(pem),publicKeyFingerprint(pem.replace(/\n/g,'\\n')));
 assert.deepEqual(issuerRegistrationEnvironment(result,verifier,secret),result);
});

test('missing/mismatched identity, key ID, existing key and registration capability reject without raw values',()=>{
 const other=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'});
 for(const [a,b,c] of [
  [{...issuer,TU_AUTH_ISSUER:'wrong'},verifier,secret],[{...issuer,TU_AUTH_CLIENT_ID:'wrong'},verifier,secret],
  [{...issuer,TU_AUTH_KEY_ID:'wrong'},verifier,secret],[issuer,{...verifier,TU_AUTH_PUBLIC_KEY:undefined},secret],
  [{...issuer,TU_AUTH_PUBLIC_KEY:other},verifier,secret],[issuer,verifier,'SECRET_VALUE_CANARY'],
  [{...issuer,TU_REGISTRATION_DB_SECRET_ARN:'OTHER_REFERENCE'},verifier,secret],
  [{...issuer,DB_USER:'postgres'},verifier,secret],[undefined,verifier,secret],[issuer,undefined,secret]
 ])assert.throws(()=>issuerRegistrationEnvironment(a,b,c),e=>e.message==='REGISTRATION_ENVIRONMENT_REJECTED');
});

test('public verification configuration never accepts a private key, non-RSA or weak RSA key',()=>{
 const privatePem=keys.privateKey.export({type:'pkcs8',format:'pem'});
 const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'pem'});
 const weak=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({type:'spki',format:'pem'});
 for(const value of [privatePem,ec,weak,'not-a-key',null])assert.throws(()=>publicKeyFingerprint(value),/REGISTRATION_ENVIRONMENT_REJECTED/);
});

test('wrong public key still rejects valid registration proof before provisioning',()=>withEnv({...issuer,TU_AUTH_PUBLIC_KEY:generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'})},async()=>{
 const fixture=await completionFixture();let connected=false;
 const service=new TuRegistrationService({clock:()=>fixture.now,provisionConnect:async()=>{connected=true;throw Error();}});
 await assert.rejects(service.complete(fixture.envelope),e=>e.code==='TU_REGISTRATION_REJECTED'&&e.statusCode===403);
 assert.equal(connected,false);
}));

for(const restored of [false,true])test(`private handler completion with production-shaped configuration: restored=${restored}`,()=>withEnv(
 restored?issuerRegistrationEnvironment(issuer,verifier,secret):issuer,async()=>{
 const previous=process.env.TU_ONBOARDING_ENABLED;process.env.TU_ONBOARDING_ENABLED='true';
 try{
  const fixture=await completionFixture(),userId=randomUUID(),studentId=randomUUID(),logs=[];let connections=0,sessions=0;
  const targetArn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:live';
  const handler=createTuSessionIssuer({targetArn,clock:()=>fixture.now,logger:line=>logs.push(JSON.parse(line)),
   getKeys:async()=>keys,provisionConnect:async()=>{connections++;return {query:async()=>({rows:[{user_id:userId,student_id:studentId}]}),end:async()=>{}};},
   sessionService:{issue:async subject=>{sessions++;assert.equal(subject,fixture.subject);return {user:{id:userId,studentId}};}}
  });
  const result=await handler({contract:REGISTRATION,operation:'complete',...fixture.envelope,requestId:randomUUID()},
   {invokedFunctionArn:targetArn,functionVersion:'1'});
  assert.equal(result.ok,restored);assert.equal(connections,restored?1:0);assert.equal(sessions,restored?1:0);
  if(restored)assert.equal(result.session.user.studentId,studentId);
  else assert.deepEqual(result.error,{code:'TU_SIGNING_UNAVAILABLE',status:503});
  assert.equal(logs[0].code,restored?'OK':'TU_SIGNING_UNAVAILABLE');
  assert.ok(!JSON.stringify(logs).includes(fixture.envelope.ticket));
 }finally{if(previous===undefined)delete process.env.TU_ONBOARDING_ENABLED;else process.env.TU_ONBOARDING_ENABLED=previous;}
}));
