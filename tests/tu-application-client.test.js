/** @jest-environment jsdom */
const {randomUUID}=require('node:crypto');
const {createTuAuthClients}=require('../tmp/frontend-test-modules/tu-auth-fallback.cjs');
const {recoveryCandidates,createDraftRecovery,renderDraftRecovery}=require('../tmp/frontend-test-modules/student/application-recovery.cjs');
const {hasCommittedDelivery,assertCommittedDelivery}=require('../tmp/frontend-test-modules/student/application-receipt.cjs');
const form=require('../src/shared/application-form');
const sid=randomUUID(),cycle=randomUUID(),appId=randomUUID(),submission=randomUUID();
const official={student_id:sid,student_number:'9900000001',full_name:'Synthetic Student',institutional_email:'test@example.invalid'};
const cycles=[{id:cycle,name:'Synthetic round',status:'OPEN'}];
const old=()=>({id:randomUUID(),student_id:sid,cycle_id:cycle,status:'SUBMITTED',version:90,official:{...official,academic_verified:true},
  documents:[{filename:'metadata-only.pdf'}],payload:{skills_detail:'<b>Original text</b>\nFree text',contact_address:'Recovered address',verified:true,acknowledgements:{terms:true}}});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
test.each(['options','list','get','create','save','readiness','submit','upload','download'])('TU %s propagates API error without inventing browser success',async method=>{
  const record=old();localStorage.setItem('co-ed:tu-applications',JSON.stringify([record]));const error=Error('Synthetic API failure');
  const tuApplicationClient={[method]:jest.fn(async()=>{throw error;})},baseApplicationClient={[method]:jest.fn()};
  const client=createTuAuthClients({isTuAuthActive:()=>true,tuApplicationClient,baseApplicationClient}).applicationClient;
  await expect(client[method](appId)).rejects.toBe(error);expect(baseApplicationClient[method]).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('co-ed:tu-applications'))).toEqual([record]);
});
test('Cognito and TU use distinct real clients and switch at call time',async()=>{
  let active=false;const base={get:jest.fn(async()=>1)},tu={get:jest.fn(async()=>2)};
  const client=createTuAuthClients({isTuAuthActive:()=>active,baseApplicationClient:base,tuApplicationClient:tu}).applicationClient;
  expect(await client.get()).toBe(1);active=true;expect(await client.get()).toBe(2);
});
test.each([{},null,{...official,student_id:randomUUID()},{...official,student_number:'9900000002'}])('ambiguous or other-account browser data not shown: %j',profile=>{
  localStorage.setItem('co-ed:tu-applications',JSON.stringify([old()]));expect(recoveryCandidates(localStorage,profile,cycles)).toEqual([]);
});
test('recovery uses validated text only, never old state/files/official verification/declarations',()=>{
  const record=old();record.payload.gpax='99';record.payload.course_attempts=[{code:'CS101',points:'4',credits:999,attempt:1}];
  localStorage.setItem('co-ed:tu-applications',JSON.stringify([record]));const [candidate]=recoveryCandidates(localStorage,official,cycles);
  expect(candidate.payload).toEqual({skills_detail:record.payload.skills_detail,contact_address:'Recovered address'});
  expect(candidate.rejected).toContain('gpax');expect(candidate.rejected).toContain('course_attempts');expect(candidate.status).toBeUndefined();expect(candidate.documents).toBeUndefined();
});
test('oversized, invalid or contradictory legacy storage is ignored',()=>{
  for(const raw of ['invalid','null','{}','x'.repeat(2000001),JSON.stringify([{...old(),official:{...official,full_name:'Another Student'}}])]){
    localStorage.setItem('co-ed:tu-applications',raw);expect(recoveryCandidates(localStorage,official,cycles)).toEqual([]);
  }
});
function setup(list=[]) {
  const record=old();localStorage.setItem('co-ed:tu-applications',JSON.stringify([record]));
  const draft={id:appId,status:'DRAFT',version:2,policy:{id:randomUUID()},availability:{can_edit:true},payload:{contact_phone:'keep'}};
  const client={options:jest.fn(async()=>({official,cycles})),list:jest.fn(async()=>list),create:jest.fn(async()=>draft),get:jest.fn(async()=>draft),save:jest.fn(async(_id,body)=>({...draft,payload:body.payload}))};
  const candidate=recoveryCandidates(localStorage,official,cycles)[0];
  return {client,candidate,record,recover:createDraftRecovery({client,storage:localStorage,sessionStorage,randomUUID})};
}
test('explicit recovery creates/saves only a Draft, selects fields, clears seven acknowledgements and retains source',async()=>{
  const {client,candidate,recover,record}=setup();await recover(candidate,['skills_detail','status','documents']);
  expect(client.save.mock.calls[0][1].payload).toEqual({skills_detail:record.payload.skills_detail,acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k=>[k,false]))});
  expect(JSON.parse(localStorage.getItem('co-ed:tu-applications'))).toEqual([record]);expect(client.submit).toBeUndefined();
});
test('never imports over a server submission/correction',async()=>{
  for(const status of ['SUBMITTED','NEEDS_REVISION']) {
    const {client,candidate,recover}=setup([{id:appId,cycle_id:cycle,status}]);await expect(recover(candidate,['skills_detail'])).rejects.toThrow();expect(client.save).not.toHaveBeenCalled();expect(client.create).not.toHaveBeenCalled();
  }
});
test('existing Draft recovery is versioned and uncertain retry preserves the same body/key',async()=>{
  const {client,candidate,recover}=setup([{id:appId,cycle_id:cycle,status:'DRAFT'}]);
  client.save.mockRejectedValueOnce(Error('result unknown'));
  await expect(recover(candidate,['contact_address'],{expectedDraftVersion:2})).rejects.toThrow();await recover(candidate,['contact_address'],{expectedDraftVersion:2});
  expect(client.save.mock.calls[0][1]).toEqual(client.save.mock.calls[1][1]);expect(client.save.mock.calls[0][1].expected_version).toBe(2);expect(client.create).not.toHaveBeenCalled();
});
test('recovery never overwrites an edit made after the comparison preview',async()=>{
  const {client,candidate,recover}=setup([{id:appId,cycle_id:cycle,status:'DRAFT'}]);
  await expect(recover(candidate,['contact_address'],{expectedDraftVersion:1})).rejects.toThrow('เปลี่ยนหลังจาก');expect(client.save).not.toHaveBeenCalled();
});
test('account switch between preview and action prevents recovery',async()=>{
  const {client,candidate,recover}=setup();client.options.mockResolvedValue({official:{...official,student_id:randomUUID()},cycles});
  await expect(recover(candidate,['skills_detail'])).rejects.toThrow();expect(client.save).not.toHaveBeenCalled();
});
test('recovery UI is opt-in, text escaped, no fake attachment action or implicit write',()=>{
  const {client}=setup();const panel=renderDraftRecovery({client,official,cycles,list:[],onNavigate:jest.fn()});document.body.replaceChildren(panel);
  expect(panel.tagName).toBe('DETAILS');expect(panel.open).toBe(false);expect(panel.querySelector('b')).toBeNull();expect(panel.textContent).toContain('<b>Original text</b>');expect(client.create).not.toHaveBeenCalled();
});
test('receipt requires matching server submission, round and committed version',()=>{
  const app={id:appId,cycle_id:cycle,status:'SUBMITTED',version:4,submission:{id:submission},delivery_receipt:{status:'QUEUED_FOR_COORDINATOR',application_id:appId,submission_id:submission,application_version:4,cycle_id:cycle,department:'CS',program:'regular',submitted_at:'2026-11-04T00:00:00Z'}};
  expect(hasCommittedDelivery(app)).toBe(true);expect(()=>assertCommittedDelivery(app)).not.toThrow();
  for(const invalid of [{...app,status:'DRAFT'},{...app,delivery_receipt:null},{...app,version:5},{...app,submission:{id:randomUUID()}},{...app,cycle_id:randomUUID()}])expect(()=>assertCommittedDelivery(invalid)).toThrow();
});
