/** @jest-environment jsdom */
const {randomUUID}=require('node:crypto');
const {allowsTuBridge}=require('../src/auth/tu-bridge');
const {createWorkflowClient}=require('../tmp/frontend-test-modules/workflow/workflow-client.cjs');
const {renderStudentSelectionStatus}=require('../tmp/frontend-test-modules/selection/selection-view.cjs');
const {confirmationWindow}=require('../src/api/services/phase1-schedule-compat');
const id=randomUUID();
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('pre-014 confirmation dates remain readable without backfill; conflicting populated sources fail visibly',()=>{
  const legacy={confirmation_opens_at:'2026-11-05T00:00:00Z',confirmation_closes_at:'2026-11-10T00:00:00Z'};
  expect(confirmationWindow({},legacy)).toEqual(legacy);
  expect(confirmationWindow({...legacy,confirmation_closes_at:new Date(legacy.confirmation_closes_at)},legacy).confirmation_closes_at).toBeInstanceOf(Date);
  expect(()=>confirmationWindow({...legacy,confirmation_closes_at:'2026-11-11T00:00:00Z'},legacy)).toThrow('ไม่ตรงกัน');
});

test.each([
  ['GET','/api/v3/student/selection'],['GET',`/api/v4/cycles/${id}/schedule`],
  ['GET',`/api/v4/cycles/${id}/selection-decision`],['POST',`/api/v4/cycles/${id}/confirm`],
  ['POST',`/api/v4/cycles/${id}/waive`],['GET','/api/v4/notifications'],
  ['PATCH',`/api/v4/notifications/${id}/read`]
])('TU bridge permits only the intended Student transport: %s %s',(method,path)=>{
  expect(allowsTuBridge(method,path)).toBe(true);
});
test.each([
  ['PUT',`/api/v4/cycles/${id}/schedule`],['POST',`/api/v4/cycles/${id}/announce`],
  ['GET',`/api/v4/coordinator/cycles/${id}/confirmations`],['GET','/api/v3/admin/operations'],
  ['DELETE',`/api/v4/notifications/${id}/read`],['GET','/api/v4/cycles/not-a-uuid/selection-decision']
])('TU bridge does not expose administrative/workflow actions: %s %s',(method,path)=>{
  expect(allowsTuBridge(method,path)).toBe(false);
});
test('workflow client retains TU bridge prefix for newly merged v4 routes',async()=>{
  const fetchImpl=jest.fn(async()=>({ok:true,json:async()=>({data:{has_result:false}})}));
  const client=createWorkflowClient({apiBaseUrl:'https://api.example.invalid/api/tu-proxy',getAccessToken:async()=>'synthetic-only',fetchImpl});
  await client.request(`/api/v4/cycles/${id}/selection-decision`);
  expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.example.invalid/api/tu-proxy/api/v4/cycles/${id}/selection-decision`);
  for(const path of ['https://other.invalid/api/v3/me','//other.invalid/api/v3/me','/api/v4/unknown','/api/v4/notifications#other'])
    await expect(client.request(path)).rejects.toThrow('Unsupported API path');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
function render(decision,fail){
  const request=jest.fn(async path=>{
    if(path==='/api/v3/student/selection')return {applications:[{source:'phase1',application_id:id,cycle_id:id,cycle_name:'Synthetic round',state:'NEEDS_REVISION',revision_notes:'Fix attachment'}]};
    if(fail)throw fail;
    return decision;
  });
  const root=renderStudentSelectionStatus({client:{request}});document.body.replaceChildren(root);return root;
}
test('Phase1 corrections link to the actual application, not the legacy plan',async()=>{
  const root=render({has_result:false});await flush();
  expect(root.querySelector('a').getAttribute('href')).toBe(`#/student/application/${id}`);
  expect(root.textContent).toContain('จัดลำดับ');expect(root.textContent).not.toContain('undefined / 3');
});
test('selection-decision failures are visible and recoverable, not mistaken for no result',async()=>{
  const root=render(null,Object.assign(Error('Synthetic failure'),{status:500}));await flush();
  expect(root.querySelector('[role=alert]').textContent).toContain('รีเฟรช');
});
test('a not-yet-open confirmation window never claims the Student was auto-waived',async()=>{
  const root=render({has_result:true,outcome:'SELECTED',confirmation_status:'PENDING_CONFIRMATION',confirmation_window:{is_open:false,is_closed:false}});await flush();
  expect(root.textContent).toContain('ยังไม่ถึงช่วงเวลา');expect(root.textContent).not.toContain('(ระบบสละสิทธิโดยอัตโนมัติ)');
});
