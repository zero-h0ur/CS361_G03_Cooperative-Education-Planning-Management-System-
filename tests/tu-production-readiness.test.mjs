import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {brokerEnvironment,assertBrokerReady,handledFailureCategories} from '../scripts/operations/tu-production/application.mjs';
import {ROOT,arn,PROVIDER} from '../scripts/operations/tu-production/common.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const api={TU_AUTH_PUBLIC_KEY:pair.publicKey.export({format:'pem',type:'spki'}),
 TU_AUTH_ISSUER:'urn:synthetic:tu',TU_AUTH_CLIENT_ID:'synthetic-api',
 DB_SECRET_ARN:'PRIVATE_CANARY',TU_AUTH_PRIVATE_KEY:'PRIVATE_CANARY',TU_API_APP_KEY:'PRIVATE_CANARY'};
test('broker configuration carries the public verifier but never private/DB capabilities',()=>{
 for(const alias of ['candidate','live'])for(const maintenance of [true,false]){
  const env=brokerEnvironment(api,alias,maintenance);
  assert.equal(env.TU_AUTH_PUBLIC_KEY,api.TU_AUTH_PUBLIC_KEY);
  assert.equal(env.TU_SESSION_FUNCTION_ARN,arn('coed-tu-session-issuer')+':'+alias);
  assert.equal(env.TU_API_SECRET_ARN,PROVIDER);assert.equal(env.TU_LOGIN_MAINTENANCE,String(maintenance));
  assert.ok(!JSON.stringify(env).includes('PRIVATE_CANARY'));
 }
 for(const value of [undefined,'','not a PEM'])assert.throws(()=>brokerEnvironment({...api,TU_AUTH_PUBLIC_KEY:value},'live',false));
 assert.throws(()=>brokerEnvironment(api,'$LATEST',false));
 assert.throws(()=>brokerEnvironment(api,'live','false'));
});
test('default production broker status detects the exact missing-public-key regression without credentials',()=>{
 const env=brokerEnvironment(api,'live',false);
 const code="const {createTuAuthBroker}=require('./src/tu-auth-broker'); createTuAuthBroker({logger:()=>{}})({rawPath:'/api/v3/auth/tu-status',httpMethod:'GET'}).then(r=>console.log(JSON.stringify(r)));";
 const status=variables=>JSON.parse(execFileSync(process.execPath,['-e',code],{cwd:ROOT,encoding:'utf8',env:{PATH:process.env.PATH,...variables}}));
 assert.doesNotThrow(()=>assertBrokerReady(status(env)));
 const broken={...env};delete broken.TU_AUTH_PUBLIC_KEY;
 assert.throws(()=>assertBrokerReady(status(broken)),/BROKER_NOT_CONFIGURED/);
});
test('readiness cannot be satisfied by an HTTP200 or negative-login response alone',()=>{
 const body=data=>({statusCode:200,body:JSON.stringify({data})});
 assert.doesNotThrow(()=>assertBrokerReady(body({configured:true,mode:'tu_api'})));
 for(const response of [null,{statusCode:400,body:'{}'},{statusCode:503,body:'{}'},
  {statusCode:200,body:'not json'},body({configured:false,mode:'tu_api'}),body({configured:true}),
  body({configured:true,mode:'mock'}),body({configured:true,mode:'tu_api',extra:'PRIVATE_CANARY'})])
   assert.throws(()=>assertBrokerReady(response),/BROKER_NOT_CONFIGURED/);
});
test('monitoring counts both raw and Lambda text-prefixed safe JSON without returning private log text',()=>{
 const row={requestId:'PRIVATE_CANARY',stage:'request',status:503,code:'TU_SIGNING_UNAVAILABLE',version:'3'};
 const lines=[JSON.stringify(row),'2026-11-04T20:16:02Z\tPRIVATE_CANARY\tINFO\t'+JSON.stringify(row)+'\n',
  'START RequestId: PRIVATE_CANARY',JSON.stringify({...row,status:200}),
  JSON.stringify({...row,stage:'PRIVATE_CANARY'}),JSON.stringify({...row,code:'PRIVATE_CANARY'}),'invalid { json'];
 assert.deepEqual(handledFailureCategories(lines),{TU_SIGNING_UNAVAILABLE:2});
 assert.ok(!JSON.stringify(handledFailureCategories(lines)).includes('PRIVATE_CANARY'));
});
