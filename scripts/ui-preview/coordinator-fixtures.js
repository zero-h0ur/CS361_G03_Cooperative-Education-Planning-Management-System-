// Synthetic local presentation only; not imported by the production entry point.
import form from '../../src/shared/application-form.js';
const copy=value=>JSON.parse(JSON.stringify(value));
const uuid=n=>'16500000-0000-4000-8000-'+String(n).padStart(12,'0');
export const COORDINATOR_SCENARIOS=Object.freeze({pending:'ตรวจใบสมัคร · 3 สถานะ',ranking:'ติดตามผล · เรียงเกรดทั้งสองภาค',revision:'ใบสมัครที่ส่งกลับแก้ไข',complete:'กรรมการยืนยันรายชื่อแล้ว',
  'missing-data':'ข้อมูล / เอกสารไม่ครบ','long-text':'ชื่อและทักษะยาว','failed-command':'บันทึกล้มเหลว · เก็บข้อมูลเดิม',conflict:'ข้อมูลเปลี่ยนระหว่างใช้งาน','readonly-schedule':'กำหนดการอ่านอย่างเดียว','intake-controls':'เปิด/ปิดรับสมัคร · ข้อมูลจำลอง',empty:'ยังไม่มีใบสมัคร',loading:'กำลังโหลด',error:'โหลดไม่สำเร็จ',forbidden:'ถูกถอนสิทธิ์',expired:'Session หมดอายุ'});
export function coordinatorPreview(scenario='pending') {
  const cycle=uuid(100),receipts=new Map(),members=[uuid(201),uuid(202),uuid(203)];
  let applications=Array.from({length:scenario==='ranking'?6:3},(_,i)=>{
    const state=scenario==='ranking' || scenario==='complete'?'FORWARDED':scenario==='revision'?'RETURNED':['PENDING','RETURNED','FORWARDED'][i];
    const curriculum=i===2 && scenario!=='ranking'?'61':'66',program_type=i%2?'special':'regular';
    const official={student_number:'670000000'+(i+1),full_name:'นักศึกษาตัวอย่าง '+String(i+1).padStart(2,'0'),department:'วิทยาการคอมพิวเตอร์',
      institutional_email:`student${i+1}@example.invalid`,curriculum,entry_year:2567,institution:'TU_CS',academic_verified:true};
    const payload={name_prefix:'นาย',thai_full_name:official.full_name,english_full_name:'Example Student '+(i+1),major_group:program_type==='special'?'ACS':'CIS',
      contact_email:`contact${i+1}@example.invalid`,contact_phone:'0000000000',contact_address:'ที่อยู่ตัวอย่าง จ.ปทุมธานี 12120',guardian_name:'ผู้ปกครองตัวอย่าง',guardian_relationship:'มารดา',guardian_phone:'0000000000',guardian_address:'ที่อยู่ผู้ปกครองตัวอย่าง',
      interested_position_codes:['FRONTEND','FULLSTACK','SOFTWARE'],skills_detail:'ภาษาโปรแกรม: JavaScript, TypeScript, Python\nFrameworks: Vue, Express\nเครื่องมือ: Git, Docker, PostgreSQL\nทักษะ: ออกแบบหน้าจอที่เข้าถึงได้ ทดสอบซอฟต์แวร์ และทำงานร่วมกับทีม (ข้อมูลสมมติ)',
      gpax_reporting_term:'2/2568 (ข้อมูลสมมติ)',selected_courses:{alternative:'CS213'},course_attempts:form.GROUPS[curriculum].map(g=>({code:g[0],attempt:1,points:'3'})),
      additional_studies:curriculum==='61'?{CS384:'ENROLLED',CS266:'STUDIED',CS322:'NOT_STUDIED',CS348:'NOT_STUDIED'}:{CS180:'ENROLLED',CS262:'STUDIED',CS331:'NOT_STUDIED',CS240:'NOT_STUDIED'},acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k=>[k,true]))};
    return {id:uuid(i+1),cycle_id:cycle,cycle_name:'ปีการศึกษา 2569 · รอบที่ 1 (ข้อมูลสมมติ)',cohort_id:uuid(101),application_version:3,submitted_version:3,submission_id:uuid(300+i),review_version:state==='PENDING'?0:1,
      student_number:official.student_number,full_name:official.full_name,curriculum,program_type,program:program_type==='special'?'ภาคพิเศษ':'ภาคปกติ',major_group:payload.major_group,
      core:[3.8,3.65,3.5,3.5,3.5,3.25][i],declared_core:2.8,gpax:[3.65,3.72,3.4,3.35,3.2,3.3][i],state,can_review:state==='PENDING',reason:state==='RETURNED'?'กรุณาตรวจสอบที่อยู่และเอกสารให้ครบถ้วน':null,
      submitted_at:'2026-11-02T0'+(6-i)+':15:00Z',official,payload,
      documents:['resume','transcript','photo','conduct'].map((kind,j)=>({id:uuid(400+i*4+j),kind,filename:kind+(kind==='photo'?'.jpg':'.pdf'),content_type:kind==='photo'?'image/jpeg':'application/pdf',byte_size:[245,812,180,320][j]*1024}))};
  });
  if(scenario==='empty')applications=[];
  if(scenario==='missing-data'){applications[0].documents=applications[0].documents.slice(0,2);applications[0].core=null;applications[0].gpax=null;applications[0].payload.acknowledgements.conduct=false;}
  if(scenario==='long-text'){applications[0].full_name=applications[0].official.full_name='นักศึกษาข้อมูลชื่อยาวสำหรับทดสอบการตัดบรรทัดบนโทรศัพท์มือถือ';applications[0].payload.skills_detail='คำตอบปลายเปิดที่นักศึกษากรอกไว้ตามต้นฉบับ\n'.repeat(100);}
  let schedule={cycle_id:cycle,cycle_name:'ปีการศึกษา 2569 · รอบที่ 1 (ข้อมูลสมมติ)',version:1,window_version:1,can_edit:scenario!=='readonly-schedule',
    opens_at:'2026-11-02T02:00:00Z',closes_at:'2026-11-20T09:30:00Z',review_opens_at:'2026-11-23T02:00:00Z',review_closes_at:'2026-11-27T09:30:00Z',confirmation_opens_at:'2026-12-01T02:00:00Z',confirmation_closes_at:'2026-12-07T09:30:00Z'};
  let intake={cycle_id:cycle,cycle_name:schedule.cycle_name,can_control:true,control:{mode:'CLOSED',version:1,is_open:false,reason:'CLOSED',opens_at:null,closes_at:null},history:[]};
  if(scenario==='intake-controls'){schedule.can_edit=false;schedule.intake=intake.control;}
  const meeting={cycle_id:cycle,department:'วิทยาการคอมพิวเตอร์',members,version:1,state:scenario==='complete'?{proposal:{normal:2,special:1,reason:'จำนวนรับสมมติจากมติที่ประชุม',status:'accepted'},finalized:true,selected:applications.map(a=>a.id)}:{proposal:null,finalized:false,selected:[]}};
  function failure(options){if(scenario==='loading')return new Promise(()=>{});if(scenario==='error')throw new Error('จำลองโหลดข้อมูลไม่สำเร็จ');if(scenario==='expired')throw Object.assign(new Error('Session หมดอายุ (จำลอง)'),{status:401});if(scenario==='forbidden')throw Object.assign(new Error('ถูกถอนสิทธิ์ (จำลอง)'),{status:403});
    if(options.method==='POST' && ['failed-command','conflict'].includes(scenario))throw Object.assign(new Error('จำลองการบันทึกล้มเหลว ข้อมูลที่กรอกยังอยู่'),{status:scenario==='conflict'?409:503});}
  return {loadSession:async()=>({role:'COORDINATOR',canReviewPlan:false}),applicationClient:{download:async()=>{throw new Error('Preview มีเฉพาะ metadata ไม่ได้เก็บหรือดาวน์โหลดไฟล์จริง');}},
    workflowClient:{request:async(path,options={})=>{
      const fault=failure(options);if(fault)return fault;
      const u=new URL(path,'https://preview.invalid'),body=options.body || {},last=u.pathname.split('/').at(-1);
      if(u.pathname.endsWith('/options'))return {cycles:[{id:cycle,name:schedule.cycle_name,status:'OPEN'}]};
      if(scenario==='intake-controls' && u.pathname.includes('/intake/')){
        if(options.method==='POST'){
          if(receipts.has(body.operation_id))return copy(receipts.get(body.operation_id));
          if(body.expected_version!==intake.control.version)throw Object.assign(new Error('สถานะเปลี่ยนแล้ว (จำลอง)'),{status:409});
          const previous=intake.control,now=new Date().toISOString(),scheduled=body.mode==='SCHEDULED';
          intake={...intake,control:{mode:body.mode,version:previous.version+1,opens_at:scheduled?body.opens_at:body.mode==='MANUAL_OPEN'?now:null,closes_at:scheduled?body.closes_at:null,
            is_open:body.mode==='MANUAL_OPEN'||scheduled&&Date.parse(body.opens_at)<=Date.now()&&Date.now()<Date.parse(body.closes_at)},
            history:[{created_at:now,previous_mode:previous.mode,mode:body.mode,version:previous.version+1},...intake.history]};receipts.set(body.operation_id,copy(intake));
        }return copy(intake);
      }
      if(u.pathname.includes('/schedules/')){
        if(options.method==='POST'){
          if(receipts.has(body.operation_id))return copy(receipts.get(body.operation_id));
          if(body.expected_version!==schedule.version)throw Object.assign(new Error('กำหนดการเปลี่ยนแล้ว (จำลอง)'),{status:409});
          schedule={...schedule,...body,version:schedule.version+1,window_version:schedule.window_version+1};receipts.set(body.operation_id,copy(schedule));
        }return copy(schedule);
      }
      const match=/\/applications\/([^/]+)(?:\/(return|forward))?$/.exec(u.pathname);
      if(match){const record=applications.find(a=>a.id===match[1]);if(!record)throw new Error('ไม่พบใบสมัครจำลอง');
        if(options.method==='POST'){
          if(receipts.has(body.operation_id))return copy(receipts.get(body.operation_id));
          if(record.review_version!==body.expected_version || record.submission_id!==body.submission_id || record.state!=='PENDING')throw Object.assign(new Error('ใบสมัครเปลี่ยนแล้ว (จำลอง)'),{status:409});
          Object.assign(record,{state:match[2]==='return'?'RETURNED':'FORWARDED',reason:body.reason || null,can_review:false,review_version:record.review_version+1});receipts.set(body.operation_id,copy(record));
        }return copy(record);
      }
      if(['applications','tracking'].includes(last)){
        const q=u.searchParams;let list=applications.filter(a=>(!q.get('search')||`${a.full_name} ${a.student_number}`.includes(q.get('search')))&&(!q.get('curriculum')||a.curriculum===q.get('curriculum'))&&(!q.get('program_type')||a.program_type===q.get('program_type')));
        const counts={all:list.length,...Object.fromEntries(['PENDING','RETURNED','FORWARDED'].map(s=>[s,list.filter(a=>a.state===s).length]))};
        if(last==='tracking')list=list.filter(a=>a.state==='FORWARDED');else if(q.get('state'))list=list.filter(a=>a.state===q.get('state'));
        const sort=q.get('sort');if(['core','gpax'].includes(sort))list.sort((a,b)=>(b[sort]??-1)-(a[sort]??-1)||(b[sort==='core'?'gpax':'core']??-1)-(a[sort==='core'?'gpax':'core']??-1));
        else if(sort==='oldest')list.sort((a,b)=>Date.parse(a.submitted_at)-Date.parse(b.submitted_at));else if(sort==='name')list.sort((a,b)=>a.full_name.localeCompare(b.full_name,'th'));else list.sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at));
        const page=Number(q.get('page') || 1),pageSize=Number(q.get('pageSize') || 10);return copy({applications:list.slice((page-1)*pageSize,page*pageSize),total:list.length,counts,page,pageSize,...(last==='tracking'?{meetings:[meeting]}:{})});
      }throw new Error('Preview ไม่รองรับเส้นทางนี้');
    }}};
}
