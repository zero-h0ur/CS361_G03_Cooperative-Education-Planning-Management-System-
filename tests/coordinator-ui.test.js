/** @jest-environment jsdom */
const {renderCoordinatorWorkspace}=require('../tmp/frontend-test-modules/coordinator/workspace.cjs');
const {createWorkspacePreviewClients}=require('../tmp/frontend-test-modules/workspace-preview-fixtures.cjs');
const {canRoleAccessRoute,getNavigationRoutesForRole}=require('../tmp/frontend-test-modules/routes.cjs');
const flush=()=>new Promise(r=>setTimeout(r,20));
const find=(root,label)=>[...root.querySelectorAll('button')].find(b=>[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('')===label || b.getAttribute('aria-label')===label);
let controller;
beforeEach(()=>{document.body.replaceChildren();window.sessionStorage.clear();controller=new AbortController();HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};});
afterEach(()=>{controller.abort();jest.restoreAllMocks();});
async function setup({page='review',scenario='pending',wrap,applicationClient}={}) {
  const clients=createWorkspacePreviewClients({role:'COORDINATOR',scenario});const request=jest.fn(clients.workflowClient.request);clients.workflowClient.request=wrap?wrap(request):request;
  const root=renderCoordinatorWorkspace({client:clients.workflowClient,applicationClient:applicationClient || clients.applicationClient,page,signal:controller.signal});document.body.append(root);await flush();return {root,request};
}
test('three Coordinator routes are allowlisted only for Coordinator and replace the company menu',()=>{
  const routes=getNavigationRoutesForRole('COORDINATOR');expect(routes.map(r=>r.hash)).toEqual(['#/coordinator/applications','#/coordinator/tracking','#/coordinator/schedule']);
  for(const route of routes){expect(canRoleAccessRoute('COORDINATOR',route.hash)).toBe(true);for(const role of ['STUDENT','COMMITTEE','STAFF','ADVISOR','ADMIN'])expect(canRoleAccessRoute(role,route.hash)).toBe(false);}
});
test.each(['assigned-second','unassigned-stale'])('remembered round %s is used only when returned by assigned options',async saved=>{
  window.sessionStorage.setItem('coed:coordinator:cycleId',saved);
  const cycles=[{id:'assigned-first',name:'รอบ 1/2569'},{id:'assigned-second',name:'รอบ 2/2569'}];
  const {root}=await setup({wrap:request=>async(path,options)=>path.endsWith('/options')?{cycles}:request(path,options)});
  const expected=saved==='assigned-second'?saved:'assigned-first';
  expect(root.querySelector('.coord-cycle').value).toBe(expected);
  expect(window.sessionStorage.getItem('coed:coordinator:cycleId')).toBe(expected);
});
test('review has compact filters, consistent status shortcuts and five keyboard-accessible sections, no opinion counter',async()=>{
  const {root}=await setup();expect(root.querySelectorAll('.coord-filters .coord-field')).toHaveLength(5);expect(root.querySelectorAll('.coord-queue-item')).toHaveLength(3);
  expect(root.textContent).not.toContain('ความเห็นกรรมการ');expect(root.textContent).not.toContain('0 / 3');
  const tabs=root.querySelectorAll('[role=tab]');expect(tabs).toHaveLength(5);expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  tabs[0].focus();tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  expect(document.activeElement).toBe(tabs[1]);expect(tabs[1].getAttribute('aria-selected')).toBe('true');expect(root.querySelectorAll('[role=tabpanel]:not([hidden])')).toHaveLength(1);
  const forwarded=[...root.querySelectorAll('.coord-status-filter')].find(b=>b.textContent.includes('ส่งต่อกรรมการแล้ว'));forwarded.click();await flush();
  expect(root.querySelectorAll('.coord-queue-item')).toHaveLength(1);expect(root.querySelectorAll('.coord-filters select')[0].value).toBe('FORWARDED');
});
test('grades carry textual colored status cells, documents use exact kind matching, and skills remain free text',async()=>{
  const {root}=await setup();find(root,'ผลการเรียน').click();
  const courses=root.querySelector('[data-panel=grades] .coord-table');expect([...courses.querySelectorAll('th')].map(n=>n.textContent)).toEqual(['รายวิชา','ภาคการศึกษา','สถานะการเรียน','เกรด']);
  for(const row of courses.querySelectorAll('tbody tr')){expect(row.children).toHaveLength(4);expect(row.children[1].textContent).toBe('—');expect(row.children[3].textContent).toBe('—');expect([...row.children].every(cell=>cell.dataset.label)).toBe(true);}
  expect(root.querySelector('.coord-course-status--enrolled').textContent).toBe('กำลังศึกษา');expect(root.querySelector('.coord-course-status--not_studied').textContent).toBe('ยังไม่เรียน');expect(root.querySelector('.coord-course-status--studied').textContent).toBe('เรียนแล้ว');
  expect(root.textContent).toContain('ไม่ระบุในใบสมัคร');find(root,'งานและทักษะ').click();expect(root.querySelector('.coord-free-text').textContent).toContain('Frameworks: Vue, Express\n');
  expect(root.querySelectorAll('.coord-free-text .coord-badge')).toHaveLength(0);
  find(root,'เอกสารแนบ').click();const panel=root.querySelector('[data-panel=documents]');expect(panel.querySelectorAll('tbody tr')).toHaveLength(4);expect(panel.querySelectorAll('.coord-badge--forwarded')).toHaveLength(4);
  find(root,'คุณสมบัติ 7 ข้อ').click();expect(root.querySelectorAll('.coord-declarations input:checked:disabled')).toHaveLength(7);expect(root.querySelectorAll('.coord-declarations input:checked + .coord-declaration-marker svg[aria-hidden=true]')).toHaveLength(7);expect(root.textContent).toContain('ไม่ใช่ผลตรวจอัตโนมัติ');
});
test('course grades use only an unambiguous submitted result, never the GPAX reporting term',async()=>{
  const {root}=await setup({wrap:request=>async(path,options)=>{const data=await request(path,options);if(data.payload){data.payload.course_attempts.push({code:'CS262',attempt:1,points:'3'});data.payload.gpax_reporting_term='2/2568';}return data;}});
  const rows=root.querySelectorAll('[data-panel=grades] tbody tr');const learned=[...rows].find(row=>row.children[0].textContent==='คพ.262');
  expect(learned.children[1].textContent).toBe('—');expect(learned.children[3].textContent).toBe('B');
});
test('Coordinator colors isolate a gray-white canvas and visible green read-only checkmarks',()=>{
  const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/frontend/coordinator/workspace.css'),'utf8');
  expect(css).toMatch(/\.protected-shell\.coordinator-portal\s*\{[^}]*--coord-canvas:#f3f5f7;/);
  expect(css).toMatch(/input:checked \+ \.coord-declaration-marker\s*\{[^}]*background:#08783e;/);
  expect(css).toMatch(/\.coord-declaration-marker \.workspace-icon\s*\{[^}]*visibility:hidden;/);
  expect(css).toMatch(/input:checked \+ \.coord-declaration-marker \.workspace-icon\s*\{visibility:visible;/);
});
test('missing documents, grades, and declarations are explicit and never fabricated',async()=>{
  const {root}=await setup({scenario:'missing-data'});expect(root.querySelector('[data-panel=grades]').textContent).toContain('—');
  const docs=root.querySelector('[data-panel=documents]');expect(docs.querySelectorAll('.coord-badge--returned')).toHaveLength(2);expect(docs.querySelectorAll('button:disabled')).toHaveLength(4);
  expect(root.querySelectorAll('.coord-declarations input:not(:checked)')).toHaveLength(1);
});
test('whitespace-only searches are cleared before requesting the API',async()=>{
  const {root,request}=await setup();const search=root.querySelector('input[type=search]');search.value='   ';search.dispatchEvent(new Event('input',{bubbles:true}));
  root.querySelector('.coord-filters').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  const calls=request.mock.calls.filter(([path])=>path.includes('/applications?'));expect(calls.length).toBeGreaterThan(1);expect(new URL(calls.at(-1)[0],'https://test.invalid').searchParams.has('search')).toBe(false);
});
test('return form retains reason and operation id after uncertain failure, then retries the same command',async()=>{
  let fail=true;const captured=[];const {root,request}=await setup({wrap:request=>async(path,options)=>{if(options?.method==='POST'){captured.push(options.body);if(fail)throw new Error('Network result unknown');}return request(path,options);}});
  find(root.querySelector('.coord-detail-actions'),'ส่งกลับแก้ไข').click();const form=root.querySelector('.coord-return-form'),reason=form.querySelector('textarea');reason.value='แก้ที่อยู่';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();expect(reason.value).toBe('แก้ที่อยู่');expect(form.textContent).toContain('เหตุผลที่กรอกยังอยู่');
  fail=false;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();expect(root.querySelector('dialog')).toBeNull();
  expect(captured[0].operation_id).toBe(captured[1].operation_id);
  const post=request.mock.calls.find(([,opts])=>opts?.method==='POST');expect(post[1].body.reason).toBe('แก้ที่อยู่');expect(post[1].body.submission_id).toBeTruthy();
});
test('forward action requires explicit confirmation and exposes no publish/admit action',async()=>{
  const {root,request}=await setup();find(root,'รับเรื่องและส่งต่อกรรมการ').click();expect(request.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
  const modal=root.querySelector('dialog');expect(modal.classList.contains('coord-dialog--confirmation')).toBe(true);
  expect(modal.querySelector('.coord-confirm-applicant__name').textContent).toBe('นักศึกษาตัวอย่าง 01');expect(modal.querySelector('.coord-confirm-applicant__number').textContent).toContain('6700000001');
  expect(modal.querySelector('.coord-confirm-question').textContent).toContain('ให้กรรมการพิจารณาหรือไม่?');expect(modal.textContent).not.toContain('3 คน');
  for(const id of modal.getAttribute('aria-describedby').split(' '))expect(document.getElementById(id)).not.toBeNull();
  find(modal,'รับเรื่องและส่งต่อกรรมการ').click();await flush();expect(request.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
  expect(root.textContent).not.toContain('ประกาศผลการคัดเลือก');
});
test('pending academic evidence cannot be forwarded with a one-checkbox confirmation',async()=>{
  const {root,request}=await setup({wrap:request=>async(path,options)=>{
    const data=await request(path,options);
    if(path.includes('/applications/') && !options?.method){
      data.assessment={eligibility:'UNKNOWN',review_required:true};data.can_forward=false;
    }
    return data;
  }});
  const forward=find(root,'รับเรื่องและส่งต่อกรรมการ');expect(forward.disabled).toBe(true);forward.click();
  expect(root.querySelector('dialog')).toBeNull();expect(root.querySelector('.coord-confirm-academic')).toBeNull();
  expect(request.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});
test('tracking shows one three-member panel, plain sequential row positions, real secondary sorting, and read-only meeting summary',async()=>{
  const {root}=await setup({page:'tracking',scenario:'ranking'});expect(root.textContent).toContain('คณะกรรมการ 3 คน');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(6);expect([...root.querySelectorAll('tbody tr td:first-child')].map(n=>n.textContent)).toEqual(['1','2','3','4','5','6']);
  expect(root.textContent).not.toContain('ร่วม');expect(root.textContent).not.toContain('0 / 3');
  find(root,'ดูมติและจำนวนรับ').click();const modal=root.querySelector('dialog');expect(modal.textContent).toContain('ยังไม่มีข้อเสนอจำนวนรับ');expect(modal.querySelector('input')).toBeNull();
});
test('partially assigned meeting scope is not presented as an empty or pending meeting result',async()=>{
  const {root}=await setup({page:'tracking',scenario:'ranking',wrap:request=>async(path,options)=>{const data=await request(path,options);if(data.meetings)data.meetings=data.meetings.map(m=>({...m,scope_limited:true,state:null}));return data;}});
  expect(root.textContent).toContain('ตรวจสอบขอบเขตการมอบหมาย');find(root,'ดูมติและจำนวนรับ').click();const modal=root.querySelector('dialog');expect(modal.textContent).toContain('นอกขอบเขตที่ได้รับมอบหมาย');expect(modal.textContent).not.toContain('ยังไม่มีข้อเสนอจำนวนรับ');
});
test('schedule edits represent Bangkok time and survive failure; read-only schedules have no editable fields',async()=>{
  const {root}=await setup({page:'schedule',scenario:'failed-command'});expect(root.querySelector('input[type=time]').value).toBe('09:00');
  const date=root.querySelector('input[type=date]');date.value='2026-11-03';date.dispatchEvent(new Event('input',{bubbles:true}));
  root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();expect(date.value).toBe('2026-11-03');expect(root.textContent).toContain('วันเวลาที่กรอกยังอยู่');
  const second=await setup({page:'schedule',scenario:'readonly-schedule'});expect([...second.root.querySelectorAll('input')].every(n=>n.disabled)).toBe(true);
});
test('schedule stale state is not silently overwritten; only explicit reload discards unsaved fields',async()=>{
  const {root,request}=await setup({page:'schedule',scenario:'conflict'}),form=root.querySelector('form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  const post=request.mock.calls.find(([,o])=>o?.method==='POST');expect(post[1].body.opens_at).toBe('2026-11-02T09:00:00+07:00');expect(post[1].body.expected_window_version).toBe(1);
  expect(root.querySelectorAll('input')).toHaveLength(12);expect(root.querySelector('.coord-feedback').getAttribute('role')).toBe('alert');
});
test('abort fences late options responses and renders no private records after leaving',async()=>{
  let resolve;const root=renderCoordinatorWorkspace({client:{request:()=>new Promise(r=>{resolve=r;})},signal:controller.signal});document.body.append(root);controller.abort();resolve({cycles:[{id:'late',name:'Late data'}]});await flush();expect(root.textContent).not.toContain('Late data');
});

describe('Coordinator named document downloads',()=>{
  let createDescriptor,revokeDescriptor,clicks;
  beforeEach(()=>{createDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL');revokeDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:jest.fn(()=>'blob:https://example.invalid/random-uuid')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:jest.fn()});clicks=[];
    jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){clicks.push({name:this.download,target:this.target,href:this.href});});});
  afterEach(()=>{controller.abort();if(createDescriptor)Object.defineProperty(URL,'createObjectURL',createDescriptor);else delete URL.createObjectURL;
    if(revokeDescriptor)Object.defineProperty(URL,'revokeObjectURL',revokeDescriptor);else delete URL.revokeObjectURL;});
  const withDoc=(kind,filename,content_type)=>request=>async(path,options)=>{const data=await request(path,options);
    if(data.documents)data.documents=data.documents.map(doc=>doc.kind===kind?{...doc,filename,content_type}:doc);return data;};
  test.each([['resume','Resume / CV','Resume final.pdf','application/pdf'],['transcript','Transcript','ผลการเรียน 2569.pdf','application/pdf'],
    ['photo','รูปถ่ายนักศึกษา','รูปนักศึกษา.jpg','image/jpeg'],['photo','รูปถ่ายนักศึกษา','student photo.PNG','image/png'],
    ['conduct','ใบรับรองความประพฤติ','ใบรับรอง "ฉบับจริง".pdf','application/pdf']])('downloads %s with its original name/extension and restores a safe preview MIME',async(kind,label,name,type)=>{
    const download=jest.fn(async()=>new Blob(['synthetic bytes'],{type:'application/octet-stream'}));
    const {root}=await setup({wrap:withDoc(kind,name,type),applicationClient:{download}});find(root,'เอกสารแนบ').click();
    find(root,'ดาวน์โหลด '+label).click();await flush();expect(download).toHaveBeenCalledTimes(1);
    expect(clicks.at(-1)).toEqual({name,target:'',href:'blob:https://example.invalid/random-uuid'});
    expect(URL.createObjectURL.mock.calls[0][0].type).toBe(type);
    find(root,'เปิดดู '+label).click();await flush();expect(clicks.at(-1).target).toBe('_blank');expect(clicks.at(-1).name).toBe('');
    expect([...root.querySelectorAll('a[download]')].at(-1).download).toBe(name);
    controller.abort();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://example.invalid/random-uuid');
  });
  test('missing permission disables both actions and unknown MIME is never previewed',async()=>{
    const download=jest.fn(async()=>new Blob(['synthetic']));
    const denied=await setup({applicationClient:{download},wrap:request=>async(path,options)=>{const data=await request(path,options);if(data.documents)data.access={can_download:false};return data;}});
    find(denied.root,'เอกสารแนบ').click();expect(denied.root.querySelectorAll('[data-panel=documents] button:disabled')).toHaveLength(8);expect(download).not.toHaveBeenCalled();
    const {root}=await setup({applicationClient:{download},wrap:withDoc('resume','original.pdf','text/html')});find(root,'เอกสารแนบ').click();find(root,'เปิดดู Resume / CV').click();await flush();
    expect(clicks.at(-1).name).toBe('original.pdf');expect(URL.createObjectURL.mock.calls[0][0].type).toBe('application/octet-stream');expect(root.querySelector('.coord-feedback a[target]')).toBeNull();
  });
  test('failed or aborted document requests never start a download',async()=>{
    let resolve;const download=jest.fn().mockRejectedValueOnce(new Error('DOWNLOAD_FAILED')).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    const {root}=await setup({applicationClient:{download}});find(root,'เอกสารแนบ').click();find(root,'ดาวน์โหลด Resume / CV').click();await flush();
    expect(root.textContent).toContain('DOWNLOAD_FAILED');expect(clicks).toHaveLength(0);
    find(root,'ดาวน์โหลด Resume / CV').click();controller.abort();resolve(new Blob(['synthetic']));await flush();
    expect(clicks).toHaveLength(0);expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

test('academic review requires every manual check, retains an uncertain retry operation and unlocks forward after saved confirmation',async()=>{
  let failOnce=true;const attempted=[];
  const {root,request}=await setup({scenario:'academic-review',wrap:original=>async(path,options)=>{
    if(path.endsWith('/academic-review'))attempted.push(options.body.operation_id);
    if(path.endsWith('/academic-review') && failOnce){failOnce=false;throw new Error('Synthetic uncertain network failure');}
    return original(path,options);
  }});
  const forward=find(root,'รับเรื่องและส่งต่อกรรมการ');expect(forward.disabled).toBe(true);
  const form=root.querySelector('.coord-academic-form');expect(form).not.toBeNull();expect(form.querySelectorAll('input[type=checkbox]')).toHaveLength(6);
  expect(form.textContent).toContain('เกรดสูงสุดตั้งแต่ C และ GPAX ตรงกับ Transcript');expect(form.textContent).not.toContain('ไม่มีเรียนซ้ำหลังผ่าน C');
  for(const check of form.querySelectorAll('input')){check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));}
  const notes=form.querySelector('textarea');notes.value='Synthetic Transcript checked';notes.dispatchEvent(new Event('input',{bubbles:true}));
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));find(root,'ยืนยันบันทึกผลรับรอง').click();await flush();
  expect(notes.value).toBe('Synthetic Transcript checked');expect(root.textContent).toContain('ผลตรวจที่กรอกยังอยู่');
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));find(root,'ยืนยันบันทึกผลรับรอง').click();await flush();await flush();
  const calls=request.mock.calls.filter(([path])=>path.endsWith('/academic-review'));
  // The wrapper's first failure happened before the underlying fake server.
  expect(calls).toHaveLength(1);expect(attempted).toHaveLength(2);expect(attempted[0]).toBe(attempted[1]);expect(calls[0][1].body.checks.grades).toBe(true);
  expect(find(root,'รับเรื่องและส่งต่อกรรมการ').disabled).toBe(false);expect(root.textContent).toContain('ตรวจรับรองแล้ว');
});
test('missing verified policy keeps academic certification and forwarding disabled',async()=>{
 const {root,request}=await setup({scenario:'academic-policy-pending'});
 expect(root.textContent).toContain('ต้องมีเกณฑ์หลักสูตรที่ยืนยันแล้ว');expect(find(root,'ตรวจทานและบันทึกผลรับรอง').disabled).toBe(true);
 expect(find(root,'รับเรื่องและส่งต่อกรรมการ').disabled).toBe(true);
 expect(request.mock.calls.some(([path])=>path.endsWith('/academic-review'))).toBe(false);
});
test('canceling a filter change preserves unsaved academic notes and restores the displayed filter',async()=>{
 const {root,request}=await setup({scenario:'academic-review'}),confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 const notes=root.querySelector('.coord-academic-form textarea');notes.value='Synthetic unsaved evidence';notes.dispatchEvent(new Event('input',{bubbles:true}));
 const before=request.mock.calls.length,filter=root.querySelector('.coord-filters select');filter.value='FORWARDED';filter.dispatchEvent(new Event('change',{bubbles:true}));await flush();
 expect(confirm).toHaveBeenCalled();expect(request.mock.calls).toHaveLength(before);expect(filter.value).toBe('');expect(root.querySelector('.coord-academic-form textarea')).toBe(notes);expect(notes.value).toBe('Synthetic unsaved evidence');
 confirm.mockReturnValue(true);filter.value='FORWARDED';filter.dispatchEvent(new Event('change',{bubbles:true}));await flush();expect(request.mock.calls.length).toBeGreaterThan(before);
});

function setReviewDates(root,values=['2026-11-10','09:00','2026-11-20','16:30']){
 const inputs=['review_opens_at','review_closes_at'].flatMap(key=>[...root.querySelectorAll('.coord-schedule-form [data-schedule-field='+key+']')]);inputs.forEach((input,i)=>{input.value=values[i];input.dispatchEvent(new Event('input',{bubbles:true}));});return inputs;
}
const submitReview=root=>root.querySelector('.coord-schedule-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
test('existing three-window form edits only review fields in restricted mode without touching intake or confirmation',async()=>{
 const {root,request}=await setup({page:'schedule',scenario:'review-window'});expect(root.querySelectorAll('.coord-schedule-form input')).toHaveLength(12);expect(root.querySelectorAll('.coord-schedule-form input:not(:disabled)')).toHaveLength(4);expect([...root.querySelectorAll('.coord-schedule-section legend')].map(n=>n.textContent)).toEqual(['ช่วงรับสมัคร','ช่วงพิจารณาใบสมัคร','ช่วงยืนยันสิทธิ์']);expect(root.textContent).not.toContain('ตั้งช่วงตรวจรับใบสมัคร');
 expect(root.textContent).toContain('ยังไม่กำหนดช่วงพิจารณาใบสมัคร');setReviewDates(root);submitReview(root);await flush();
 const [path,{body}]=request.mock.calls.find(([,options])=>options?.method==='POST');expect(path).toMatch(/\/review$/);
 expect(body).toEqual({expected_version:0,operation_id:expect.any(String),review_opens_at:'2026-11-10T09:00:00+07:00',review_closes_at:'2026-11-20T16:30:00+07:00'});
 expect(root.textContent).toContain('บันทึกกำหนดการแล้ว');expect(root.querySelector('.coord-schedule-form [data-schedule-field=review_opens_at]').value).toBe('2026-11-10');
});
test('review-only validation focuses missing and reversed date without a POST; missing upgrade stays readonly',async()=>{
 const {root,request}=await setup({page:'schedule',scenario:'review-window'});submitReview(root);expect(document.activeElement.type).toBe('date');expect(document.activeElement.getAttribute('aria-invalid')).toBe('true');
 setReviewDates(root,['2026-11-20','09:00','2026-11-10','16:30']);submitReview(root);expect(root.textContent).toContain('วันสิ้นสุดช่วงพิจารณาต้องอยู่หลัง');expect(request.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
 controller.abort();controller=new AbortController();const readonly=await setup({page:'schedule',scenario:'review-window-upgrade'});expect(find(readonly.root,'บันทึกกำหนดการ').disabled).toBe(true);expect(readonly.root.textContent).toContain('ต้องอัปเกรด');
});
test.each(['review-window-failed','review-window-conflict'])('review-only %s retains values and operation id; reload cancel preserves dirty input',async scenario=>{
 const {root,request}=await setup({page:'schedule',scenario});const inputs=setReviewDates(root);submitReview(root);await flush();submitReview(root);await flush();
 const posts=request.mock.calls.filter(([,o])=>o?.method==='POST');expect(posts).toHaveLength(2);expect(posts[0][1].body).toEqual(posts[1][1].body);expect(inputs[0].value).toBe('2026-11-10');
 find(root,'โหลดกำหนดการล่าสุด').click();expect(root.querySelector('dialog[open]')).not.toBeNull();find(root,'แก้ไขต่อ').click();expect(inputs[0].value).toBe('2026-11-10');
 find(root,'โหลดกำหนดการล่าสุด').click();find(root,'ทิ้งการแก้ไข').click();await flush();expect(root.querySelector('.coord-schedule-form [data-schedule-field=review_opens_at]').value).toBe('');
});
test('review-only pending save disables intake controls and duplicate submits; late abort does not render success',async()=>{
 let resolve;const {root,request}=await setup({page:'schedule',scenario:'review-window',wrap:req=>(path,options)=>options?.method==='POST'?new Promise(r=>{resolve=r;}):req(path,options)});
 setReviewDates(root);submitReview(root);submitReview(root);expect(root.querySelector('.coord-schedule-form').getAttribute('aria-busy')).toBe('true');
 expect([...root.querySelectorAll('.coord-intake-controls button')].every(b=>b.disabled)).toBe(true);
 controller.abort();resolve({version:1});await flush();expect(root.textContent).not.toContain('บันทึกกำหนดการแล้ว');expect(request.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});

test('results dashboard shows saved winners/losers separately, independent of forwarded-list filters and without writes',async()=>{
 const {root,request}=await setup({page:'tracking',scenario:'results-complete'}),dashboard=root.querySelector('.coord-results-dashboard');
 expect([...dashboard.querySelectorAll('.coord-result-metrics dd')].map(n=>n.textContent)).toEqual(['3','2','2','1']);expect(dashboard.querySelectorAll('tbody tr')).toHaveLength(3);
 find(dashboard,'ไม่ผ่านการคัดเลือก (1)').click();expect(dashboard.querySelectorAll('tbody tr')).toHaveLength(1);expect(dashboard.querySelector('tbody').textContent).toContain('นักศึกษาตัวอย่าง 02');
 const curriculum=root.querySelector('.coord-filters select');curriculum.value='61';curriculum.dispatchEvent(new Event('change',{bubbles:true}));await flush();
 const updated=root.querySelector('.coord-results-dashboard');expect([...updated.querySelectorAll('.coord-result-metrics dd')].map(n=>n.textContent)).toEqual(['3','2','2','1']);
 expect(updated.querySelector('tbody').textContent).toContain('นักศึกษาตัวอย่าง 02');expect(updated.textContent).toContain('ยังแยกจากการประกาศผล');
 find(updated,'ดูใบสมัคร').click();await flush();expect(root.querySelector('dialog').textContent).toContain('นักศึกษาตัวอย่าง 02');
 expect(request.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});
test.each(['results-pending','results-incomplete','results-scoped'])('%s never labels current applicants as rejected or leaks a result roster',async scenario=>{
 const {root}=await setup({page:'tracking',scenario}),dashboard=root.querySelector('.coord-results-dashboard');
 expect(dashboard.querySelectorAll('tbody tr')).toHaveLength(0);expect([...dashboard.querySelectorAll('.coord-result-metrics dd')].slice(2).map(n=>n.textContent)).toEqual(['—','—']);
 expect(dashboard.textContent).toContain(scenario==='results-pending'?'รอกรรมการยืนยันผล':scenario==='results-incomplete'?'ข้อมูลรายชื่อหรือฉบับใบสมัครไม่ตรง':'ตรวจสอบการมอบหมาย');
 if(scenario==='results-incomplete'){expect(root.querySelector('.coord-tracking-actions').textContent).toContain('ตรวจสอบข้อมูลผลคัดเลือก');find(root,'ดูมติและจำนวนรับ').click();expect(root.querySelector('dialog').textContent).toContain('กรุณาตรวจสอบก่อนใช้ผล');}
});
test('result roster pagination remains separate and filters restore keyboard focus',async()=>{
 const {root}=await setup({page:'tracking',scenario:'results-many'}),dashboard=root.querySelector('.coord-results-dashboard');
 expect(dashboard.querySelectorAll('tbody tr')).toHaveLength(10);find(dashboard,'ถัดไป').click();expect(dashboard.querySelector('tbody tr td').textContent).toBe('11');
 expect(document.activeElement.textContent).toContain('หน้า 2 / 3');find(dashboard,'ผ่านการคัดเลือก (13)').click();expect(dashboard.querySelector('tbody tr td').textContent).toBe('1');
 expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');expect(dashboard.textContent).toContain('หน้า 1 / 2');
});
test('result refresh failure clears stale dashboard, allows retry, and does not render after unmount',async()=>{
 let failed=false;const {root}=await setup({page:'tracking',scenario:'results-complete',wrap:req=>(path,o)=>failed&&path.includes('/tracking?')?Promise.reject(new Error('Synthetic load failure')):req(path,o)});
 failed=true;find(root,'โหลดผลล่าสุด').click();await flush();expect(root.querySelector('.coord-results-dashboard')).toBeNull();expect(root.textContent).toContain('โหลดผลการคัดเลือกไม่สำเร็จ');
 failed=false;find(root,'ลองโหลดอีกครั้ง').click();await flush();expect(root.querySelector('.coord-results-dashboard')).not.toBeNull();
 let done;controller.abort();controller=new AbortController();const next=await setup({page:'tracking',scenario:'results-complete',wrap:req=>(path,o)=>path.includes('/tracking?')?new Promise(r=>{done=()=>req(path,o).then(r);}):req(path,o)});
 controller.abort();await done();await flush();expect(next.root.querySelector('.coord-results-dashboard')).toBeNull();
});

test('shared Coordinator table captions remain semantic without occupying the mobile card layout',()=>{
 const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/frontend/coordinator/workspace.css'),'utf8');
 expect(css).toMatch(/\.coord-table > caption\.shell-sr-only\s*\{[^}]*clip-path:inset\(50%\)/);
});
