/** @jest-environment jsdom */
const {webcrypto}=require('node:crypto');
const {TextEncoder}=require('node:util');
const {createApplicationClient}=require('../tmp/frontend-test-modules/student/application-client.cjs');
const {renderApplicationEditor}=require('../tmp/frontend-test-modules/student/application-editor-view.cjs');
const {renderApplicationWorkspace}=require('../tmp/frontend-test-modules/student/application-view.cjs');
const {createApplicationPreview,APPLICATION_PREVIEW_ID:ID}=require('../tmp/frontend-test-modules/application-preview-fixtures.cjs');
const {getRoute,canRoleAccessRoute}=require('../tmp/frontend-test-modules/routes.cjs');
const {createShellApp}=require('../tmp/frontend-test-modules/shell-app.cjs');
const {createWorkspacePreviewClients}=require('../tmp/frontend-test-modules/workspace-preview-fixtures.cjs');
const flush=()=>new Promise(r=>setTimeout(r,0));
const response=(data,status=200)=>({ok:status<300,status,json:async()=>status<300?{data}:{error:data}});
const button=(root,label)=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===label);
let controller;
beforeEach(()=>{controller=new AbortController();document.body.replaceChildren();window.confirm=jest.fn(()=>false);window.matchMedia=jest.fn(()=>({matches:false}));});
afterEach(()=>controller.abort());
async function editor(scenario='application-pending'){
  const client=createApplicationPreview({scenario}),application=await client.get(ID);let guard;
  const root=renderApplicationEditor({client,application,signal:controller.signal,setLeaveGuard:g=>guard=g,onBack:jest.fn()});document.body.append(root);
  return {root,client,guard};
}
test('real criteria pending, official identity locked, no fabricated credits or legacy company requirement',async()=>{
  const {root}=await editor();expect(root.textContent).toContain('รอยืนยันข้อมูลเกณฑ์');
  expect(root.textContent).toContain('Local Preview');expect(root.querySelector('#application-institutional_email').readOnly).toBe(true);
  expect(root.querySelector('[name=full_name]')).toBeNull();
  expect(root.querySelector('#application-curriculum').disabled).toBe(true);
  expect(root.textContent).not.toContain('company_id');
  button(root,'ตรวจความพร้อม').click();await flush();await flush();
  expect(root.querySelector('.application-error').textContent).toContain('รอยืนยันข้อมูลเกณฑ์');
  expect(button(root,'ส่งใบสมัคร').disabled).toBe(true);
});
test.each(['application-failed','application-conflict'])('failed save keeps typed personal fields and warns before navigation: %s',async scenario=>{
  const {root,guard}=await editor(scenario),input=root.querySelector('#application-contact_address');
  input.value='ยังไม่ได้บันทึก 141';input.dispatchEvent(new Event('input',{bubbles:true}));
  expect(guard()).toBe(false);expect(window.confirm).toHaveBeenCalled();
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  expect(root.querySelector('#application-contact_address').value).toBe('ยังไม่ได้บันทึก 141');
  expect(root.textContent).toContain('มีข้อมูลที่ยังไม่ได้บันทึก');
  expect(button(root,'ตรวจความพร้อม').disabled).toBe(true);
});
test('Draft save precedes readiness, confirmation is explicit and submitted data becomes read-only',async()=>{
  const {root,client}=await editor('application-ready');
  const address=root.querySelector('#application-contact_address');address.value='แก้ที่อยู่สมมติ';address.dispatchEvent(new Event('input',{bubbles:true}));
  expect(button(root,'ตรวจความพร้อม').disabled).toBe(true);
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  expect((await client.get(ID)).payload.contact_address).toBe('แก้ที่อยู่สมมติ');
  button(root,'ตรวจความพร้อม').click();await flush();await flush();
  expect(button(root,'ส่งใบสมัคร').disabled).toBe(false);
  button(root,'ส่งใบสมัคร').click();expect((await client.get(ID)).status).toBe('DRAFT');
  button(root,'ยกเลิกการส่ง').click();expect(button(root,'ยืนยันส่งและล็อกข้อมูล')).toBeUndefined();
  button(root,'ส่งใบสมัคร').click();button(root,'ยืนยันส่งและล็อกข้อมูล').click();await flush();await flush();
  expect((await client.get(ID)).status).toBe('SUBMITTED');
  expect(root.querySelector('#application-contact_address').readOnly).toBe(true);
  expect(root.querySelector('input[type=file]')).toBeNull();expect(button(root,'บันทึกฉบับร่าง')).toBeUndefined();
  expect(root.textContent).toContain('ยังไม่ใช่การได้รับคัดเลือก');
});
test('oversized/disguised file stays unselected, prior saved document is preserved',async()=>{
  const {root,client}=await editor('application-ready'),old=(await client.get(ID)).documents;
  const input=root.querySelector('#file-resume');
  Object.defineProperty(input,'files',{value:[new File(['bad'],'fake.exe',{type:'application/pdf'})]});input.dispatchEvent(new Event('change'));
  expect(root.textContent).toContain('ใช้ไฟล์ PDF เท่านั้น');expect((await client.get(ID)).documents).toEqual(old);
  expect(button(root,'อัปโหลด Resume').disabled).toBe(true);
});
test('upload version refresh keeps other unsaved field values and selected-file warning',async()=>{
  const {root,client,guard}=await editor('application-ready');
  const address=root.querySelector('#application-contact_address');address.value='ข้อมูลระหว่างอัปโหลด';address.dispatchEvent(new Event('input'));
  const input=root.querySelector('#file-resume');Object.defineProperty(input,'files',{value:[new File(['%PDF test'],'resume-new.pdf',{type:'application/pdf'})]});input.dispatchEvent(new Event('change'));
  expect(guard()).toBe(false);button(root,'อัปโหลด Resume').click();await flush();await flush();
  expect(root.querySelector('#application-contact_address').value).toBe('ข้อมูลระหว่างอัปโหลด');
  expect((await client.get(ID)).documents.find(d=>d.kind==='resume').filename).toBe('resume-new.pdf');
  expect(button(root,'ตรวจความพร้อม').disabled).toBe(true);
});
test('returning the alternative course to blank still permits an incomplete Draft save',async()=>{
  const {root,client}=await editor('application-ready'),choice=root.querySelector('#application-selected_courses');
  choice.value='';choice.dispatchEvent(new Event('change'));
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  expect((await client.get(ID)).payload.selected_courses.alternative).toBe('');
  button(root,'ตรวจความพร้อม').click();await flush();await flush();expect(button(root,'ส่งใบสมัคร').disabled).toBe(true);
});
test('closed round Draft is visible without masquerading as submitted or offering write controls',async()=>{
  const client=createApplicationPreview(),application=await client.get(ID);application.availability={can_edit:false};
  const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
  expect(root.textContent).toContain('ใบสมัครนี้ยังไม่ได้ส่ง');expect(root.querySelector('#application-contact_phone').readOnly).toBe(true);
  expect(root.querySelector('input[type=file]')).toBeNull();expect(button(root,'บันทึกฉบับร่าง')).toBeUndefined();
});
test('newly verified curriculum/email can be adopted explicitly without hidden immutable-field conflicts',async()=>{
  const client=createApplicationPreview(),application=await client.get(ID);application.payload.curriculum='61';application.payload.institutional_email='old@example.invalid';
  const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
  expect(root.textContent).toContain('ต่างจากฉบับร่างเดิม');
  button(root,'ใช้หลักสูตรที่ยืนยัน').click();button(root,'ใช้อีเมลมหาวิทยาลัยที่ยืนยัน').click();
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  const saved=await client.get(ID);expect(saved.payload.curriculum).toBe('66');expect(saved.payload.institutional_email).toBe(saved.official.institutional_email);
  expect(saved.payload.acknowledgements.preplacement).toBe(false);expect(saved.payload.course_attempts.length).toBeGreaterThan(0);
});
test('in-page links respect reduced motion without animations blocking focus',async()=>{
  window.matchMedia=jest.fn(()=>({matches:true}));const {root}=await editor();
  const section=root.querySelector('#application-documents');section.scrollIntoView=jest.fn();
  root.querySelector('a[href="#application-documents"]').click();
  expect(section.scrollIntoView).toHaveBeenCalledWith({behavior:'auto',block:'start'});expect(document.activeElement).toBe(section);
});
test('shell hash navigation cannot silently discard dirty input; session expiry still removes protected content',async()=>{
  const root=document.createElement('div');document.body.append(root);
  const location={hash:'#/student/application/'+ID},eventTarget=new EventTarget();
  const app=createShellApp({root,location,eventTarget,applicationClient:createApplicationPreview(),
    loadSession:async()=>({role:'STUDENT'}),startLogin:async()=>{},restartLogin:async()=>{},logout:async()=>{}});
  try{await app.start();await flush();await flush();
    const input=root.querySelector('#application-contact_address');input.value='ไม่ทิ้งเงียบ ๆ';input.dispatchEvent(new Event('input'));
    location.hash='#/student/profile';eventTarget.dispatchEvent(new Event('hashchange'));
    expect(location.hash).toBe('#/student/application/'+ID);expect(root.querySelector('#application-contact_address').value).toBe('ไม่ทิ้งเงียบ ๆ');
    app.expireSession();expect(root.querySelector('#application-contact_address')).toBeNull();expect(root.textContent).not.toContain('ไม่ทิ้งเงียบ ๆ');
  }finally{app.destroy();}
});
test('list binds each existing application to its own route and filters already-used cycles',async()=>{
  const client=createApplicationPreview(),navigate=jest.fn(),root=renderApplicationWorkspace({client,signal:controller.signal,onNavigate:navigate});
  document.body.append(root);await flush();await flush();
  expect(root.querySelector('#application-cycle').options.length).toBe(2);
  button(root,'เปิดฉบับร่าง').click();expect(navigate).toHaveBeenCalledWith('#/student/application/'+ID);
  expect(getRoute('#/student/application/'+ID).params.applicationId).toBe(ID);
  for(const role of ['STAFF','ADVISOR','COORDINATOR','COMMITTEE','ADMIN'])expect(canRoleAccessRoute(role,'#/student/application/'+ID)).toBe(false);
  expect(getRoute('#/student/application/not-a-uuid')).toBeNull();
});
test.each(['application-pending','application-ready','application-failed','application-conflict','application-submitted'])('actual preview composition boots %s without sending it into the old Plan fixture model',async scenario=>{
  const clients=createWorkspacePreviewClients({role:'STUDENT',scenario,delayMs:0});
  expect(await clients.loadSession()).toMatchObject({role:'STUDENT'});
  const root=document.createElement('div');document.body.append(root);
  const app=createShellApp({...clients,root,location:{hash:'#/student/application/'+ID},eventTarget:new EventTarget(),
    startLogin:async()=>{},restartLogin:async()=>{},logout:async()=>{}});
  try{await app.start();await flush();await flush();expect(root.querySelector('.application-editor')).not.toBeNull();expect(root.textContent).toContain('Local Preview');}
  finally{app.destroy();}
});
test('client uses protected API, no-store, no auth leakage to S3 and retries uncertain completion with same receipt',async()=>{
  const ticket='14100000-0000-4000-8000-000000000020',op='14100000-0000-4000-8000-000000000021',complete='14100000-0000-4000-8000-000000000022';
  let completions=0;
  const fetchImpl=jest.fn(async(url,options)=>{
    if(url.endsWith('/uploads'))return response({ticket_id:ticket,upload:{url:'https://private-s3.example.invalid',method:'POST',auth_required:false,fields:{key:'staging/test'}}});
    if(url.endsWith('/complete')){if(!completions++)throw new Error('network timeout after commit');return response({id:ID,version:2});}
    if(url==='https://private-s3.example.invalid/')return {ok:true};throw new Error('unexpected URL '+url);
  });
  const client=createApplicationClient({apiBaseUrl:'https://api.example.invalid',getAccessToken:async()=>'test-token',fetchImpl,cryptoImpl:webcrypto});
  const file={size:9,name:'resume.pdf',type:'application/pdf',arrayBuffer:async()=>new TextEncoder().encode('%PDF-test').buffer};
  const options={version:1,operationId:op,completeOperationId:complete};
  await expect(client.upload(ID,'resume',file,options)).rejects.toMatchObject({code:'RESULT_UNKNOWN'});
  await expect(client.upload(ID,'resume',file,options)).resolves.toMatchObject({version:2});
  expect(fetchImpl.mock.calls.filter(([u])=>u.endsWith('/uploads'))).toHaveLength(1);
  const s3=fetchImpl.mock.calls.find(([u])=>u.includes('private-s3'));expect(s3[1].headers.Authorization).toBeUndefined();
  expect(s3[1].credentials).toBe('omit');expect(s3[1].redirect).toBe('error');
  const api=fetchImpl.mock.calls.find(([u])=>u.endsWith('/uploads'));expect(api[1].headers.Authorization).toBe('Bearer test-token');expect(api[1].cache).toBe('no-store');
  expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).operation_id).toBe(complete);
});
test('local transfer target cannot send a token to a foreign origin or unrelated path',async()=>{
  const fetchImpl=jest.fn(async()=>response({ticket_id:ID,upload:{url:'https://evil.example.invalid/api/v4/applications/'+ID+'/uploads/'+ID+'/content',auth_required:true,method:'PUT'}}));
  const client=createApplicationClient({apiBaseUrl:'https://api.example.invalid',getAccessToken:async()=>'private-token',fetchImpl,cryptoImpl:webcrypto});
  const file={name:'x.pdf',size:1,type:'application/pdf',arrayBuffer:async()=>new TextEncoder().encode('1').buffer};
  await expect(client.upload(ID,'resume',file,{version:1,operationId:ID,completeOperationId:ID})).rejects.toMatchObject({code:'UNSAFE_TARGET'});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
