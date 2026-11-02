// This module is reachable only from Local UI Preview / tests, never production app.js.
import policyModule from '../../src/api/services/application-policy.js';
import form from '../../src/shared/application-form.js';
import inputModule from '../../src/api/services/application-input.js';
import { getStoredTuProfile, getStoredTuApiResponse } from './fixtures.js';
const {GROUPS,readiness}=policyModule;
const copy=v=>JSON.parse(JSON.stringify(v));
export const APPLICATION_SCENARIOS=Object.freeze({
  'application-pending':'ใบสมัคร · รอยืนยันเกณฑ์',
  'application-ready':'ใบสมัคร · พร้อมส่ง (เกณฑ์สมมติ)',
  'application-61':'ใบสมัคร · หลักสูตร 61 (ข้อมูลสมมติ)',
  'application-failed':'ใบสมัคร · บันทึกล้มเหลว (เก็บที่กรอก)',
  'application-conflict':'ใบสมัคร · ข้อมูลเปลี่ยนระหว่างใช้งาน',
  'application-submitted':'ใบสมัคร · ส่งแล้ว (อ่านอย่างเดียว)'
});
export const APPLICATION_PREVIEW_ID='14100000-0000-4000-8000-000000000001';
export function createApplicationPreview({scenario='application-pending'}={}) {
  const cycle='14100000-0000-4000-8000-000000000002',otherCycle='14100000-0000-4000-8000-000000000003';
  const verified=scenario!=='application-pending';
  const curriculum=scenario==='application-61'?'61':'66';
  const tuProf = getStoredTuProfile();
  const tuRaw = getStoredTuApiResponse();
  const official=tuProf ? {
    student_id:'14100000-0000-4000-8000-000000000004',
    full_name:tuProf.full_name,
    student_number:tuProf.student_number,
    institutional_email:tuProf.institutional_email,
    department:tuProf.department,
    program:tuProf.program,
    major:tuProf.major,
    curriculum,
    entry_year:tuProf.academic_year || (curriculum==='61'?2564:2566),
    academic_verified:true
  } : {student_id:'14100000-0000-4000-8000-000000000004',full_name:'ณัฐวดี ศิริกุล (ข้อมูลสมมติ)',student_number:curriculum==='61'?'6409612345':'6609612345',institutional_email:'nattawadee.s@example.invalid',
    department:'ภาควิชาวิทยาการคอมพิวเตอร์',program:'วิทยาศาสตรบัณฑิต',major:'วิทยาการคอมพิวเตอร์',curriculum,entry_year:curriculum==='61'?2564:2566,academic_verified:true};
  const policy={id:'14100000-0000-4000-8000-000000000005',version:1,curriculum,source_year:2568,source:'เกณฑ์และหน่วยกิตสมมติสำหรับ Preview เท่านั้น',verified,synthetic:true,
    data:{credits:verified?Object.fromEntries(GROUPS[curriculum].flat().map(c=>[c,'3'])):{},repeat_rule:verified?'LATEST':null,alternative_rule:'STUDENT_SELECTED'}};
  const data={curriculum,gpax:'3.24',declared_group_gpa:'3.00',gpax_reporting_term:'ภาคฤดูร้อน 3/2568 (ข้อมูลสมมติ)',major_group:'ACS',
    name_prefix:'นาย/นางสาว',
    thai_full_name:tuProf ? tuProf.full_name : 'ณัฐวดี ศิริกุล (ข้อมูลสมมติ)',
    english_full_name:tuRaw?.displayname_en || tuProf?.preferred_name || 'Nattawadee Sirikul (Fictional)',
    contact_email:tuProf ? tuProf.institutional_email : 'student-contact@example.invalid',
    contact_address:'99/1 ถนนตัวอย่าง ตำบลคลองหนึ่ง อำเภอคลองหลวง ปทุมธานี 12120 (สมมติ)',contact_phone:'0000000000',
    guardian_name:'วิภา ศิริกุล (สมมติ)',guardian_relationship:'มารดา',guardian_address:'99/1 ถนนตัวอย่าง ปทุมธานี (สมมติ)',guardian_phone:'0000000000',
    interested_position_codes:['FRONTEND','SOFTWARE','OTHER'],interested_position_other:'Accessibility engineer (ตัวอย่างสมมติ)',
    skills_detail:'ภาษาโปรแกรม: JavaScript, TypeScript, Python\nFrameworks: Vue, Express\nเครื่องมือ: Git, Docker, PostgreSQL\nทักษะ: ออกแบบหน้าจอที่เข้าถึงได้ ทดสอบซอฟต์แวร์ และทำงานร่วมกับทีม (ข้อมูลสมมติ)',
    course_attempts:GROUPS[curriculum].map(g=>({code:g[0],attempt:1,points:'3.00'})),selected_courses:{alternative:'CS213'},
    additional_studies:curriculum==='61'?{CS384:'STUDIED',CS266:'ENROLLED'}:{CS180:'STUDIED',CS262:'ENROLLED'},
    acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(key=>[key,true]))};
  const docs=Object.entries({resume:`CV-${official.student_number}.pdf`,transcript:`${official.student_number}.pdf`,conduct:`conduct-${official.student_number}.pdf`,photo:`${official.student_number}.png`}).map(([kind,filename],i)=>({
    id:`14100000-0000-4000-8000-00000000001${i}`,kind,filename,byte_size:2048,content_type:kind==='photo'?'image/png':'application/pdf',checksum:'a'.repeat(64)}));
  let apps=[{id:APPLICATION_PREVIEW_ID,cycle_id:cycle,student_id:official.student_id,cycle_name:'รอบ 1/2569 · ข้อมูลสมมติ',form_version:form.FORM_VERSION,status:scenario==='application-submitted'?'SUBMITTED':'DRAFT',version:1,payload:data,official,policy,
    documents:scenario==='application-pending'?[]:docs,submitted_at:scenario==='application-submitted'?new Date().toISOString():null,preview:true}];
  const cycles=[{id:cycle,name:'รอบ 1/2569 · ข้อมูลสมมติ',status:'OPEN',academic_year:2569,semester:1},
    {id:otherCycle,name:'รอบ 2/2569 · ข้อมูลสมมติ',status:'OPEN',academic_year:2569,semester:2}];
  const receipt=new Map();
  function get(id){const app=apps.find(a=>a.id===id);if(!app)throw new Error('ไม่พบใบสมัครจำลอง');return app;}
  function mutation(id,body,work){
    if(scenario==='application-failed')throw new Error('จำลองการบันทึกล้มเหลว ข้อมูลที่กรอกยังอยู่');
    if(scenario==='application-conflict')throw Object.assign(new Error('ข้อมูลเปลี่ยนจากอีกหน้าต่าง (จำลอง)'),{code:'STALE_RECORD_CONFLICT'});
    if(receipt.has(body.operation_id))return copy(receipt.get(body.operation_id));
    const app=get(id);if(app.status!=='DRAFT' || body.expected_version!==app.version)throw new Error('ไม่สามารถแก้ไขใบสมัครจำลองนี้');
    work(app);app.version++;receipt.set(body.operation_id,copy(app));return copy(app);
  }
  const check=app=>readiness({app,official:app.official,policy:app.policy,documents:app.documents,window:{is_open:true},roundOpen:true,allowSynthetic:true});
  return {
    async options(){return copy({official,cycles,criteria:policyModule.templates(),storage_configured:false,preview:true});},
    async list(){return copy(apps);},async get(id){return copy(get(id));},
    async create(body){if(receipt.has(body.operation_id))return copy(receipt.get(body.operation_id));
      if(apps.some(a=>a.cycle_id===body.cycle_id))throw new Error('มีใบสมัครในรอบนี้แล้ว');
      const app={id:crypto.randomUUID(),cycle_id:body.cycle_id,student_id:official.student_id,cycle_name:cycles.find(c=>c.id===body.cycle_id)?.name,form_version:form.FORM_VERSION,status:'DRAFT',version:1,payload:{},official,policy,documents:[],preview:true};
      apps.push(app);receipt.set(body.operation_id,copy(app));return copy(app);},
    async save(id,body){return mutation(id,body,a=>{a.payload={...a.payload,...inputModule.payload(copy(body.payload))};});},
    async readiness(id){return check(get(id));},
    async submit(id,body){return mutation(id,body,a=>{if(!check(a).can_submit)throw new Error('ใบสมัครจำลองยังไม่พร้อม');a.status='SUBMITTED';a.submitted_at=new Date().toISOString();});},
    async upload(id,kind,file,{version,operationId,onPhase=()=>{}}){onPhase('จำลองการอัปโหลด ไม่ส่งไฟล์ออกจากเครื่อง');return mutation(id,{expected_version:version,operation_id:operationId},a=>{
      a.documents=[...a.documents.filter(d=>d.kind!==kind),{id:crypto.randomUUID(),kind,filename:file.name,byte_size:file.size}];});},
    async download(){throw new Error('Preview มีเพียงข้อมูลเอกสารจำลอง ไม่ได้เก็บไฟล์จริง กรุณาทดสอบไฟล์จริงด้วยชุด integration');}
  };
}
