import test from 'node:test';
import assert from 'node:assert/strict';
import {smoke,ORIGIN} from '../scripts/operations/tu-production/smoke.mjs';
test('owner smoke uses only fixed-origin Login and authenticated owner-only reads; returns no profile/token',async()=>{
 const calls=[],studentId='9900000001',password='SYNTHETIC_PASSWORD',token='SYNTHETIC_TOKEN';
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});assert.ok(url.startsWith(ORIGIN+'/'));assert.equal(options.redirect,'error');
  if(url.endsWith('/auth/tu-login'))return {ok:true,json:async()=>({data:{accessToken:token,user:{id:'u1',studentId:'s1',role:'STUDENT'}}})};
  assert.equal(options.headers.Authorization,'Bearer '+token);
  return {ok:true,json:async()=>({data:url.endsWith('/students/me')?{id:'s1',student_number:studentId,full_name:'PRIVATE_CANARY'}:
   {role:'STUDENT',user:{id:'u1'},studentId:'s1'}})};
 };
 const result=await smoke({studentId,password,fetchImpl});
 assert.equal(result.status,'OWNER_SMOKE_PASSED');assert.equal(calls.length,3);
 assert.equal(calls[0].options.method,'POST');assert.ok(calls.slice(1).every(c=>!c.options.method));
 assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));assert.ok(!JSON.stringify(result).includes(token));
});
test('owner smoke stops on provider or identity failure without performing a write',async()=>{
 await assert.rejects(smoke({studentId:'9900000001',password:'synthetic',fetchImpl:async()=>({ok:false,status:403,
  json:async()=>({error:{code:'TU_ACCOUNT_UNAVAILABLE',message:'PRIVATE_CANARY'}})})}),e=>e.status===403 && e.safeCode==='TU_ACCOUNT_UNAVAILABLE' && !e.message.includes('PRIVATE_CANARY'));
 await assert.rejects(smoke({studentId:'9900000001',password:'synthetic',fetchImpl:async()=>({ok:true,json:async()=>({data:{user:{role:'STUDENT'}}})})}),/SMOKE_IDENTITY_MISMATCH/);
});
