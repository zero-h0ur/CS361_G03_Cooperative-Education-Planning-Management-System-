/** @jest-environment jsdom */
const {renderApplicationEditor}=require('../tmp/frontend-test-modules/student/application-editor-view.cjs');
const {createApplicationPreview,APPLICATION_PREVIEW_ID:ID}=require('../tmp/frontend-test-modules/application-preview-fixtures.cjs');
const {applicationAccess}=require('../src/shared/application-access');
const flush=()=>new Promise(r=>setTimeout(r,0));
const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
let controller;
beforeEach(()=>{controller=new AbortController();document.body.replaceChildren();});
afterEach(()=>controller.abort());
test.each(['intake-draft','intake-upload','intake-pilot'])('%s explains capabilities and never treats UNKNOWN as PASS',async mode=>{
 const client=createApplicationPreview({scenario:'application-ready'}),application=await client.get(ID);
 const scope={student_user_id:ID,coordinator_user_id:'14100000-0000-4000-8000-000000000099',cycle_id:application.cycle_id};
 application.access=applicationAccess(mode,{scope,actor:{isAuthenticated:true,userId:ID,role:'STUDENT',accountStatus:'ACTIVE'}});
 application.official.identity_source='TU_ONBOARDING';application.official.registration={study_source:'self_reported'};application.policy=null;
 client.readiness=jest.fn(async()=>({can_submit:true,eligibility:'UNKNOWN',group_gpa:null,blockers:[],review_flags:[{code:'POLICY_PENDING'}]}));
 const root=renderApplicationEditor({client,application,signal:controller.signal});document.body.append(root);
 expect(root.textContent).toContain('หลักสูตรและกลุ่มวิชาเป็นข้อมูลที่นักศึกษาแจ้ง');
 expect(root.querySelector('input[type=file]')!==null).toBe(mode!=='intake-draft');
 expect(button(root,'บันทึกฉบับร่าง')).toBeDefined();
 if(mode==='intake-draft')expect(root.textContent).toContain('ยังไม่เปิดแนบไฟล์หรือส่งใบสมัคร');
 if(mode==='intake-upload')expect(root.textContent).toContain('ยังไม่เปิดส่งใบสมัคร');
 button(root,'ตรวจความพร้อม').click();await flush();await flush();
 expect(root.textContent).toContain('ผลตรวจคุณสมบัติ: รอตรวจสอบ');
 expect(button(root,'ส่งใบสมัคร').disabled).toBe(mode!=='intake-pilot');
 if(mode==='intake-pilot'){
  button(root,'ส่งใบสมัคร').click();
  const confirmation=root.querySelector('.application-confirm');
  expect(confirmation.textContent).toContain('ส่งข้อมูลที่นักศึกษาแจ้งพร้อมหลักฐานเข้าคิวรอตรวจสอบ');
  expect(confirmation.textContent).not.toContain('ยืนยันใช้เกณฑ์');
 }
});
