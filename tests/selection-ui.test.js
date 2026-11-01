/** @jest-environment jsdom */
const {renderSelectionWorkspace,renderStudentSelectionStatus}=require('../tmp/frontend-test-modules/selection/selection-view.cjs');
const {canRoleAccessRoute,getDefaultRoute}=require('../tmp/frontend-test-modules/routes.cjs');
const flush=()=>new Promise(resolve=>setTimeout(resolve,15));
const plan='50000000-0000-4000-8000-000000000101';
const application=(more={})=>({plan_id:plan,plan_version:1,student_number:'TEST361001',full_name:'Synthetic Student',
  department:'CPE',program:'CS',cycle_name:'Synthetic cycle',state:'UNDER_COMMITTEE_REVIEW',opinion_count:0,own_opinion:null,...more});
const result=(rows=[])=>({cohorts:[{department:'CPE',program:'CS'}],applications:rows,page:1,pageSize:25,has_more:false});
beforeEach(()=>document.body.replaceChildren());
test.each(['COORDINATOR','COMMITTEE'])('%s cannot navigate into Staff, Advisor or Admin areas',role=>{
  expect(getDefaultRoute(role)).toMatch(role==='COORDINATOR'?/coordinator/:/committee/);
  for(const path of ['#/staff/review','#/staff/workflow','#/advisor/students','#/admin/operations','#/student/profile'])
    expect(canRoleAccessRoute(role,path)).toBe(false);
});
test('Coordinator acknowledges only a pending application, never gets an approval/grade form',async()=>{
  const request=jest.fn(async(_path,opts)=>opts?.method==='POST'?{}:result([application({state:'AWAITING_COORDINATOR'})]));
  const root=renderSelectionWorkspace({client:{request},role:'COORDINATOR'});document.body.append(root);await flush();
  expect(root.textContent).toContain('ยังไม่จัดอันดับ');expect(root.querySelector('textarea')).toBeNull();
  const button=[...root.querySelectorAll('button')].find(x=>x.textContent==='ยืนยันรับแผนและส่งต่อกรรมการ');
  button.click();await flush();
  expect(request.mock.calls.find(([,o])=>o.method==='POST')).toEqual([
    `/api/v3/coordinator/plans/${plan}/acknowledge`,expect.objectContaining({body:{operation_id:expect.any(String),expected_version:1}})]);
  expect(root.textContent).not.toContain('อนุมัติแผน');
});
test('Committee records only its own explicit choice and comment; duplicate requests reuse operation id',async()=>{
  const request=jest.fn(async(_path,opts)=>{
    if(opts?.method==='POST')throw new Error('Synthetic unavailable');return result([application()]);
  });
  const root=renderSelectionWorkspace({client:{request},role:'COMMITTEE'});document.body.append(root);await flush();
  let form=[...root.querySelectorAll('form')].find(x=>x.querySelector('textarea'));
  form.querySelector('select').value='no';form.querySelector('textarea').value='Synthetic independent opinion';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  const first=request.mock.calls.find(([,o])=>o.method==='POST');
  expect(first[0]).toBe(`/api/v3/committee/plans/${plan}/opinion`);
  expect(first[1].body).toEqual({operation_id:expect.any(String),expected_version:1,selected:false,comment:'Synthetic independent opinion'});
  expect(Object.keys(first[1].body)).not.toContain('committee_id');
  expect(root.querySelector('textarea').value).toBe('Synthetic independent opinion');
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  const posts=request.mock.calls.filter(([,o])=>o.method==='POST');
  expect(posts).toHaveLength(2);expect(posts[1][1].body.operation_id).toBe(first[1].body.operation_id);
});
test('completed own opinion and names are text, not HTML; no editable form overwrites history',async()=>{
  const xss='<img src=x onerror=alert(1)>';
  const root=renderSelectionWorkspace({role:'COMMITTEE',client:{request:async()=>result([application({
    full_name:xss,state:'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT',opinion_count:3,
    own_opinion:{selected:true,comment:xss,submitted_at:'2026-10-31T00:00:00Z'}})])}});
  document.body.append(root);await flush();
  expect(root.textContent).toContain(xss);expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('textarea')).toBeNull();expect(root.textContent).toContain('รอประกาศผล');
});
test('scope revocation removes old details and informs the shell',async()=>{
  const denied=jest.fn();let calls=0;
  const root=renderSelectionWorkspace({role:'COMMITTEE',onAccessDenied:denied,client:{request:async()=>{
    if(++calls>1)throw Object.assign(new Error('Denied'),{status:403});return result([application()]);
  }}});document.body.append(root);await flush();
  root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  expect(root.textContent).not.toContain('TEST361001');expect(denied).toHaveBeenCalled();
});
test('Student sees only progress, never Committee choices or individual comments',async()=>{
  const root=renderStudentSelectionStatus({client:{request:async()=>result([application({opinion_count:3,state:'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT'})])}});
  document.body.append(root);await flush();
  expect(root.textContent).toContain('3 / 3');expect(root.textContent).toContain('รอประกาศผล');
  expect(root.querySelector('form,input,select,textarea')).toBeNull();
});
