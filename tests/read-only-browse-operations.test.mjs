import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {approvedEnvironment,probe,within} from '../scripts/operations/read-only-browse.mjs';
const id='11111111-1111-4111-8111-111111111111';
function transport(change=()=>null){const calls=[];return {calls,call:async event=>{
  calls.push(event);const replaced=change(event);if(replaced)return replaced;
  const path=event.rawPath,method=event.requestContext.http.method;
  if(method==='GET' && path==='/api/directory/companies')return {statusCode:200,body:JSON.stringify({data:[{id,name:'Synthetic Company',details_available:false}]})};
  if(method==='GET' && path==='/api/directory/companies/'+id)return {statusCode:200,body:JSON.stringify({data:{id,details_available:false}})};
  if(method==='GET' && !path.endsWith('/readiness'))return {statusCode:401,body:'{}'};
  return {statusCode:503,body:JSON.stringify({error:{code:'COED_MAINTENANCE'}})};
}};}
test('only verify -> browse changes; all unrelated configuration remains identical',()=>{
  const old={COED_API_MAINTENANCE:'verify',TU_ONBOARDING_ENABLED:'true',OTHER:'synthetic-only'};
  assert.deepEqual(approvedEnvironment(old),{...old,COED_API_MAINTENANCE:'browse'});assert.equal(old.COED_API_MAINTENANCE,'verify');
  for(const mode of ['off','browse',undefined])assert.throws(()=>approvedEnvironment({...old,COED_API_MAINTENANCE:mode}));
});
test('numeric/public smoke requires real nonempty public reads and denied anonymous/private/write requests',async()=>{
  const t=transport(),result=await probe(t.call);assert.equal(result.writesBlocked,true);assert.equal(result.ownerPositivePending,true);
  assert.ok(t.calls.some(e=>e.rawQueryString==='page=1&pageSize=1'));
  assert.ok(t.calls.some(e=>e.requestContext.http.method==='PATCH'));
  assert.ok(t.calls.every(e=>!e.headers));
});
test('empty catalogue, exposed recruitment fields, owner-read bypass and open writes stop activation',async()=>{
  for(const change of [
    e=>e.rawPath==='/api/directory/companies'?{statusCode:200,body:'{"data":[]}'}:null,
    e=>e.rawPath==='/api/directory/companies'?{statusCode:200,body:JSON.stringify({data:[{id,details_available:false,positions:[]}]})}:null,
    e=>e.rawPath==='/api/tu-proxy/api/v4/applications' && e.requestContext.http.method==='GET'?{statusCode:200,body:'{"data":[]}'}:null,
    e=>e.requestContext.http.method==='POST'?{statusCode:400,body:'{}'}:null
  ]){const t=transport(change);await assert.rejects(probe(t.call));}
});
test('operation checkpoint/candidate bounds reject workspace roots, parents and other drives',()=>{
  const parent=resolve('tmp/read-only-operation-test');assert.equal(within(parent,join(parent,'child')),join(parent,'child'));
  for(const path of [parent,resolve(parent,'..'),resolve('other-task')])assert.throws(()=>within(parent,path));
  if(process.platform==='win32')assert.throws(()=>within('C:/task','D:/task/child'));
});
