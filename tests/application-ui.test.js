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
  const scroll=jest.fn();Element.prototype.scrollIntoView=scroll;
  root.querySelector('[aria-controls="application-documents"]').click();
  const section=root.querySelector('#application-documents');
  expect(section.hidden).toBe(false);expect(scroll).toHaveBeenCalledWith({behavior:'auto',block:'start'});expect(document.activeElement).toBe(section);
  delete Element.prototype.scrollIntoView;
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
test.each(['application-pending','application-ready','application-61','application-failed','application-conflict','application-submitted'])('actual preview composition boots %s without sending it into the old Plan fixture model',async scenario=>{
  const clients=createWorkspacePreviewClients({role:'STUDENT',scenario,delayMs:0});
  expect(await clients.loadSession()).toMatchObject({role:'STUDENT'});
  const root=document.createElement('div');document.body.append(root);
  const app=createShellApp({...clients,root,location:{hash:'#/student/application/'+ID},eventTarget:new EventTarget(),
    startLogin:async()=>{},restartLogin:async()=>{},logout:async()=>{}});
  try{await app.start();await flush();await flush();expect(root.querySelector('.application-editor')).not.toBeNull();expect(root.textContent).toContain('Local Preview');}
  finally{app.destroy();}
});

test('six visible navigation stages preserve Draft fields and move focus without changing the route',async()=>{
  const {root,client}=await editor('application-ready');
  expect(root.querySelectorAll('.application-step-button')).toHaveLength(6);
  expect(root.querySelectorAll('.application-step:not([hidden])')).toHaveLength(1);
  const input=root.querySelector('#application-contact_email');input.value='different@example.invalid';input.dispatchEvent(new Event('input'));
  button(root,'ถัดไป').click();expect(root.querySelector('#application-academic').hidden).toBe(false);
  expect(document.activeElement.id).toBe('application-academic');button(root,'ย้อนกลับ').click();
  expect(root.querySelector('#application-contact_email').value).toBe('different@example.invalid');
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  expect((await client.get(ID)).payload.contact_email).toBe('different@example.invalid');
});

test.each([['application-ready','CS261','CS301'],['application-61','CS264','CS302']])('curriculum-specific letter grades and declarations are shown: %s',async(scenario,last,future)=>{
  const {root,client}=await editor(scenario);root.querySelector('[aria-controls="application-academic"]').click();
  const grade=root.querySelector('#grade-'+last+'-1');expect(grade.tagName).toBe('SELECT');
  expect(Array.from(grade.options).map(o=>o.textContent)).toContain('B+ (3.5)');
  grade.value='3.5';grade.dispatchEvent(new Event('change'));
  const choice=root.querySelector('#application-selected_courses');choice.value='CS216';choice.dispatchEvent(new Event('change'));
  expect(root.textContent).toContain('ไม่คิดเป็น F');expect(root.querySelector('#grade-CS213-1')).toBeNull();
  root.querySelector('[aria-controls="application-interests"]').click();
  expect(root.querySelectorAll('[data-field^="acknowledgements."]')).toHaveLength(7);
  expect(root.querySelector('#application-acknowledgements-preplacement').parentElement.textContent).toContain(future.replace('CS','คพ.'));
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  const p=(await client.get(ID)).payload;expect(p.course_attempts.find(r=>r.code===last).points).toBe('3.5');expect(p.course_attempts.some(r=>r.code==='CS213')).toBe(true);
});

test('multiple job choices, Other and long skills round-trip safely to review',async()=>{
  const {root,client}=await editor('application-ready');root.querySelector('[aria-controls="application-interests"]').click();
  const backend=root.querySelector('input[value="BACKEND"]');backend.checked=true;backend.dispatchEvent(new Event('change'));
  const other=root.querySelector('#application-interested_position_other');other.value='Security engineer';other.dispatchEvent(new Event('input'));
  const skills=root.querySelector('#application-skills_detail');skills.value='<img src=x onerror=alert(1)>\n'+('JavaScript testing '.repeat(100));skills.dispatchEvent(new Event('input'));
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();root.querySelector('[aria-controls="application-review"]').click();
  const p=(await client.get(ID)).payload;expect(p.interested_position_codes).toEqual(expect.arrayContaining(['FRONTEND','SOFTWARE','BACKEND','OTHER']));
  expect(p.skills_detail.length).toBeGreaterThan(120);expect(root.querySelector('#application-review').textContent).toContain('Security engineer');expect(root.querySelector('#application-review img')).toBeNull();
});

test('readiness errors focus the summary then reveal and focus a field in another step',async()=>{
  const client=createApplicationPreview({scenario:'application-ready'}),application=await client.get(ID);delete application.payload.guardian_phone;
  client.readiness=async()=>({can_submit:false,blockers:[{field:'guardian_phone',message:'กรุณาระบุเบอร์ผู้ปกครอง'}]});
  const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
  root.querySelector('[aria-controls="application-review"]').click();button(root,'ตรวจความพร้อม').click();await flush();await flush();
  expect(document.activeElement).toBe(root.querySelector('[data-feedback]'));
  root.querySelector('[data-feedback] a').click();expect(root.querySelector('#application-guardian').hidden).toBe(false);
  const input=root.querySelector('#application-guardian_phone');expect(document.activeElement).toBe(input);expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toContain('เบอร์ผู้ปกครอง');
});

test('legacy Draft text is retained and new attestations are not automatically accepted',async()=>{
  const client=createApplicationPreview(),application=await client.get(ID);application.payload.major_group='Legacy major';
  application.payload.skills=['Legacy framework'];delete application.payload.skills_detail;application.payload.interested_positions=['Legacy position'];delete application.payload.interested_position_codes;
  application.payload.acknowledgements={conduct:true,terms:true,preplacement:true};
  const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
  expect(root.querySelector('#application-major_group').value).toBe('Legacy major');
  root.querySelector('[aria-controls="application-interests"]').click();expect(root.textContent).toContain('Legacy position');expect(root.querySelector('#application-skills_detail').value).toBe('Legacy framework');
  expect(root.querySelector('#application-acknowledgements-program').checked).toBe(false);
  button(root,'บันทึกฉบับร่าง').click();await flush();await flush();
  const p=(await client.get(ID)).payload;expect(p.interested_positions).toEqual(['Legacy position']);expect(p.acknowledgements.program).toBeUndefined();
});

test('guardian address copy is explicit and does not overwrite an existing address without confirmation',async()=>{
  const {root}=await editor('application-ready');root.querySelector('[aria-controls="application-guardian"]').click();const original=root.querySelector('#application-guardian_address').value;
  button(root,'ใช้ที่อยู่เดียวกับนักศึกษา').click();expect(root.querySelector('#application-guardian_address').value).toBe(original);
  window.confirm.mockReturnValue(true);button(root,'ใช้ที่อยู่เดียวกับนักศึกษา').click();expect(root.querySelector('#application-guardian_address').value).toBe(root.querySelector('#application-contact_address').value);
});

test('blur validation keeps helper text and explicit saved values while marking invalid email',async()=>{
  const {root}=await editor();const input=root.querySelector('#application-contact_email');input.value='bad';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('blur'));
  expect(input.getAttribute('aria-invalid')).toBe('true');expect(input.parentElement.textContent).toContain('กรุณาระบุอีเมล');
  input.value='fixed@example.invalid';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('blur'));expect(input.hasAttribute('aria-invalid')).toBe(false);
});

test('trusted language-specific names stay read-only; changing curriculum resets only affected declarations',async()=>{
  const client=createApplicationPreview(),application=await client.get(ID);application.official.english_full_name='Verified Fictional Name';delete application.official.curriculum;
  const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
  expect(root.querySelector('#application-english_full_name').readOnly).toBe(true);
  root.querySelector('[aria-controls="application-academic"]').click();const choice=root.querySelector('#application-curriculum');choice.value='61';choice.dispatchEvent(new Event('change'));
  expect(root.querySelector('#application-acknowledgements-required_courses').checked).toBe(false);expect(root.querySelector('#application-acknowledgements-additional_courses').checked).toBe(false);
  expect(root.querySelector('#application-acknowledgements-preplacement').checked).toBe(false);expect(root.querySelector('#application-acknowledgements-conduct').checked).toBe(true);
});

test('old submitted form is readable without fabricating new declarations or edit actions',async()=>{
  const client=createApplicationPreview({scenario:'application-submitted'}),application=await client.get(ID);application.form_version=1;
  application.payload.acknowledgements={terms:true,conduct:true,preplacement:true};delete application.payload.contact_email;
  const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
  expect(root.querySelector('#application-review').hidden).toBe(false);expect(root.textContent).toContain('จะไม่ถูกเติมย้อนหลัง');
  expect(root.querySelector('#application-acknowledgements-program').checked).toBe(false);expect(button(root,'บันทึกฉบับร่าง')).toBeUndefined();
});

test('selected document survives Next/Back and reload requires consent before discarding it',async()=>{
  const {root,guard}=await editor('application-ready');root.querySelector('[aria-controls="application-documents"]').click();
  const input=root.querySelector('#file-conduct');Object.defineProperty(input,'files',{value:[new File(['%PDF test'],'conduct-new.pdf',{type:'application/pdf'})]});input.dispatchEvent(new Event('change'));
  button(root,'ถัดไป').click();button(root,'ย้อนกลับ').click();expect(root.querySelector('#application-documents').textContent).toContain('conduct-new.pdf');
  button(root,'โหลดข้อมูลล่าสุด').click();await flush();expect(root.querySelector('#application-documents').textContent).toContain('conduct-new.pdf');expect(guard()).toBe(false);
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
