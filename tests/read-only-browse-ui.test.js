/** @jest-environment jsdom */
const {renderApplicationWorkspace}=require('../tmp/frontend-test-modules/student/application-view.cjs');
const {renderApplicationEditor}=require('../tmp/frontend-test-modules/student/application-editor-view.cjs');
const {renderStudentProfile}=require('../tmp/frontend-test-modules/student/profile-view.cjs');
const {createApplicationClient}=require('../tmp/frontend-test-modules/student/application-client.cjs');
const {createApplicationPreview,APPLICATION_PREVIEW_ID:ID}=require('../tmp/frontend-test-modules/application-preview-fixtures.cjs');
const {applicationAccess,READ_ONLY_MESSAGE}=require('../src/shared/application-access');
const flush=()=>new Promise(r=>setTimeout(r,0));
let controller;
beforeEach(()=>{controller=new AbortController();document.body.replaceChildren();});
afterEach(()=>controller.abort());

test('read-only list shows actual empty state and no new-cycle or recovery creation controls',async()=>{
  const client={options:jest.fn(async()=>({access:applicationAccess('browse'),cycles:[],official:{}})),list:jest.fn(async()=>[]),create:jest.fn()};
  const root=renderApplicationWorkspace({client,signal:controller.signal});document.body.append(root);await flush();
  expect(root.querySelector('[role=status]').textContent).toBe(READ_ONLY_MESSAGE);
  expect(root.textContent).toContain('ยังไม่มีใบสมัครที่บันทึกไว้ในระบบ');
  expect(root.querySelector('select')).toBeNull();expect(root.textContent).not.toContain('เลือกรอบสมัครใหม่');expect(client.create).not.toHaveBeenCalled();
});

test('read-only editor retains saved draft values and does not claim the admission window expired',async()=>{
  const client=createApplicationPreview({scenario:'application-ready'}),app=await client.get(ID);
  app.access=applicationAccess('browse');app.availability={can_edit:false};
  app.documents=[{id:ID,kind:'resume',filename:'synthetic.pdf',byte_size:100}];
  const root=renderApplicationEditor({client,application:app,signal:controller.signal});document.body.append(root);
  expect(root.querySelector('#application-contact_address').value).toBe(app.payload.contact_address);
  expect(root.querySelector('#application-contact_address').readOnly).toBe(true);
  expect(root.textContent).toContain('โหมดอ่านอย่างเดียว');expect(root.textContent).toContain(READ_ONLY_MESSAGE);
  expect(root.textContent).not.toContain('รอบปิด / หมดเวลา');expect(root.textContent).not.toContain('รอบไม่เปิดให้แก้ไขแล้ว');
  expect(root.querySelector('input[type=file]')).toBeNull();
  const buttons=[...root.querySelectorAll('button')];
  expect(buttons.some(b=>b.textContent==='บันทึกฉบับร่าง'||b.textContent==='ส่งใบสมัคร'||b.textContent==='ตรวจความพร้อม')).toBe(false);
  expect(buttons.find(b=>b.textContent.startsWith('ดาวน์โหลด')).disabled).toBe(true);
});

test('profile shows an honest empty application card, keeps directory navigation and never invents academic values',async()=>{
  const profile={student_number:'9900000001',full_name:'Synthetic Student',institutional_email:'synthetic@example.invalid',version:1};
  const root=renderStudentProfile({profileClient:{getOwnProfile:async()=>profile},applicationClient:{
    options:async()=>({access:applicationAccess('browse'),official:{},cycles:[]}),list:async()=>[]},signal:controller.signal});
  document.body.append(root);await flush();await flush();
  expect(root.textContent).toContain('ยังไม่มีใบสมัครที่บันทึกไว้ในระบบ');expect(root.textContent).not.toContain('เลือกรอบแล้วทยอยกรอก');
  expect(root.querySelector('a[href="company-directory.html"]')).not.toBeNull();expect(root.textContent).toContain('ยังไม่มีข้อมูล');
});

test('client reports maintenance explicitly without falsely saying a GET saved or retained a draft',async()=>{
  const client=createApplicationClient({apiBaseUrl:'https://api.example.invalid',getAccessToken:async()=>'synthetic',fetchImpl:async()=>({
    ok:false,status:503,json:async()=>({error:{code:'COED_MAINTENANCE'}})})});
  await expect(client.options()).rejects.toMatchObject({code:'COED_MAINTENANCE',message:'ส่วนนี้ยังไม่เปิดให้ทำรายการ ระบบเปิดให้อ่านข้อมูลที่กำหนดไว้เท่านั้น'});
});
