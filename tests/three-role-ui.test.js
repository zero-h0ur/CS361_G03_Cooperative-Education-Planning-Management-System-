/** @jest-environment jsdom */
const {renderPlanWorkflow,renderContactPanel,renderStaffWorkflow}=require('../tmp/frontend-test-modules/workflow/workflow-views.cjs');
const {createWorkflowClient}=require('../tmp/frontend-test-modules/workflow/workflow-client.cjs');
const {enhanceWorkflowPreview}=require('../tmp/frontend-test-modules/workflow-preview-fixtures.cjs');
const {createPreviewClients}=require('../tmp/frontend-test-modules/preview-fixtures.cjs');
const {renderAdminOperations}=require('../tmp/frontend-test-modules/workflow/admin-operations-view.cjs');
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
const planId='50000000-0000-4000-8000-000000000101';
const state=(status='DRAFT')=>({plan_id:planId,status,version:2,project_title:'Synthetic portal',student_number:'6609612345',references:[],submissions:[],advisor:null,placement:null,policy:{id:'30000000-0000-4000-8000-000000000101',version:1,requirements:[]}});
beforeEach(()=>document.body.replaceChildren());
test('Admin operation view does not expose Student or Staff workflow forms',async()=>{
  const request=jest.fn(async()=>({accounts:[{id:'test-user',role:'ADMIN',account_status:'ACTIVE',version:1}],pagination:{page:1,total:1,totalPages:1},migrations:['008_returned_plan_cancellation.sql'],catalogue:{companies:103,positions:56}}));
  const root=renderAdminOperations({client:{request}});document.body.append(root);await flush();
  expect(request).toHaveBeenCalledWith('/api/v3/admin/operations?page=1',expect.anything());
  expect(root.textContent).toContain('103 บริษัท / 56 ตำแหน่ง');
  expect(root.querySelector('form,input,textarea,select')).toBeNull();
  expect(root.textContent).toContain('ไม่มีสิทธิ์อนุมัติ');
});
test('integration client uses bearer auth, no-store and no role/body authentication shortcuts',async()=>{
  const fetchImpl=jest.fn(async()=>({ok:true,status:200,json:async()=>({data:state()})}));
  const client=createWorkflowClient({apiBaseUrl:'https://api.example.invalid',getAccessToken:async()=>'synthetic-token',fetchImpl});
  await client.request(`/api/v3/plans/${planId}/workflow`);
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({cache:'no-store',headers:{Authorization:'Bearer synthetic-token'}});
  expect(fetchImpl.mock.calls[0][0]).not.toContain('role=');
  await client.request('/api/v3/staff/assignments?page=2&pageSize=20');
  expect(fetchImpl.mock.calls[1][0]).toBe('https://api.example.invalid/api/v3/staff/assignments?page=2&pageSize=20');
});
test('Advisor integration is read-only and external executable links are not rendered',async()=>{
  const data={...state('APPROVED'),references:[{filename:'Evidence.pdf',reference:'EXT-01',url:'javascript:alert(1)'}]};
  const root=renderPlanWorkflow({client:{request:async()=>data},planId,role:'ADVISOR'});document.body.append(root);await flush();
  expect(root.querySelector('form,input,textarea,select')).toBeNull();
  expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(root.textContent).toContain('ผ่านเกณฑ์สหกิจ ≠ บริษัทยืนยันรับ');
});
test('Student saves reference/project changes with version and receives loading feedback',async()=>{
  let resolveWrite;
  const request=jest.fn(async(_path,opts)=>opts?.method==='PATCH'?await new Promise(resolve=>{resolveWrite=resolve;}):state());
  const dirty=jest.fn(), root=renderPlanWorkflow({client:{request},planId,role:'STUDENT',onDirtyChange:dirty});document.body.append(root);await flush();
  const form=root.querySelector('form');form.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}));
  expect(dirty).toHaveBeenCalledWith(true);
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  expect(form.getAttribute('aria-busy')).toBe('true');expect(form.querySelector('button').disabled).toBe(true);
  const call=request.mock.calls.find(([,opts])=>opts?.method==='PATCH');expect(call[1].body).toMatchObject({expected_version:2,project_title:'Synthetic portal'});
  expect(call[1].body.operation_id).toMatch(/^[a-f0-9-]{36}$/);
  resolveWrite({});await flush();expect(dirty).toHaveBeenCalledWith(false);
});
test.each(['SUBMITTED','UNDER_REVIEW','REJECTED','CANCELLED'])('Student cannot mutate %s eligibility',async status=>{
  const root=renderPlanWorkflow({client:{request:async()=>state(status)},planId,role:'STUDENT'});document.body.append(root);await flush();
  expect(root.querySelector('form,input,textarea,select')).toBeNull();
});
test('returned submissions remain editable but have no cancellation control',async()=>{
  const root=renderPlanWorkflow({client:{request:async()=>state('NEEDS_REVISION')},planId,role:'STUDENT'});
  document.body.append(root);await flush();
  expect(root.querySelector('form')).not.toBeNull();
  expect(root.textContent).not.toContain('ยกเลิกฉบับร่าง');
});
test('a revoked Advisor response clears old details and informs the shell',async()=>{
  const denied=jest.fn();
  const root=renderPlanWorkflow({client:{request:async()=>{throw Object.assign(new Error('No assignment'),{status:403});}},planId,role:'ADVISOR',onAccessDenied:denied});document.body.append(root);await flush();
  expect(denied).toHaveBeenCalled();expect(root.textContent).toContain('ไม่มีสิทธิ์');expect(root.querySelector('form')).toBeNull();
});
test('contact card exposes only contact fields, not a preferred-name or TU identity editor',async()=>{
  const root=renderContactPanel({client:{request:async()=>({contact_address:'Synthetic address',contact_phone:'0810000000',version:1})}});document.body.append(root);await flush();
  expect(root.querySelector('textarea').value).toBe('Synthetic address');expect(root.querySelector('input[type=tel]')).not.toBeNull();
  expect(root.querySelectorAll('input,textarea')).toHaveLength(2);
});
test('Staff requirements and Advisor occupancy share a scoped hub with explicit controls',async()=>{
  const data={scopes:[{department:'CPE',program:null,academic_year:2569}],cycles:[{id:'cycle',name:'Synthetic cycle',status:'OPEN'}],policies:[],advisors:[{id:'advisor',name:'Synthetic Advisor',active_count:5}],assignments:[]};
  const root=renderStaffWorkflow({client:{request:async()=>data}});document.body.append(root);await flush();
  expect(root.textContent).toContain('5 / 5 คน');expect(root.textContent).toContain('ข้อกำหนดเอกสารรายรอบ');
  expect(root.querySelector('form')).not.toBeNull();expect(root.textContent).toContain('เพิ่มรายการเอกสาร');
});
test.each(['draft','revision','submitted','review','approved','rejected','company-confirmed','company-pending','missing-policy','legacy'])('enhanced Preview renders Student workflow scenario %s without network',async scenario=>{
  const clients=enhanceWorkflowPreview(createPreviewClients({scenario,role:'STUDENT',delayMs:0}),{scenario,role:'STUDENT'});
  const root=renderPlanWorkflow({client:clients.workflowClient,planId,role:'STUDENT'});document.body.append(root);await flush();await flush();
  expect(root.querySelector('.workflow-card')).not.toBeNull();
  if(['submitted','review','rejected'].includes(scenario))expect(root.querySelector('form')).toBeNull();
  if(scenario==='missing-policy')expect(root.textContent).toContain('ยังไม่ได้ตั้งข้อกำหนด');
  if(scenario==='company-confirmed')expect(root.textContent).toContain('บริษัทยืนยันแล้ว');
});
test('enhanced Staff Preview exposes requirements/roster and simulated review, never AWS',async()=>{
  const clients=enhanceWorkflowPreview(createPreviewClients({scenario:'capacity-full',role:'STAFF',delayMs:0}),{scenario:'capacity-full',role:'STAFF'});
  expect((await clients.loadSession()).canReviewPlan).toBe(true);
  const root=renderStaffWorkflow({client:clients.workflowClient});document.body.append(root);await flush();
  expect(root.textContent).toContain('5 / 5 คน');
  expect((await clients.staffReviewClient.getPlanWithHistory(planId)).plan.status).toBe('APPROVED');
});
test('Admin Preview uses synthetic operation metadata without calling AWS',async()=>{
  const clients=enhanceWorkflowPreview(createPreviewClients({scenario:'draft',role:'ADMIN',delayMs:0}),{scenario:'draft',role:'ADMIN'});
  const root=renderAdminOperations({client:clients.workflowClient});document.body.append(root);await flush();
  expect(root.textContent).toContain('103 บริษัท');expect(root.querySelector('form')).toBeNull();
});
