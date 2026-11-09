// Source: user-supplied 2568 criteria, adopted by the team for 1/69.
// These templates intentionally contain NO invented credits or repeat rules.
const {GROUPS,MAJORS,POSITIONS,ACKNOWLEDGEMENTS,DECLARED_IDENTITY,EMAIL}=require('../../shared/application-form');
const faculty=require('../../shared/faculty-criteria');
const EXTRA={'61':[['CS384'],['CS266','CS322','CS348']],'66':[['CS180'],['CS262','CS331','CS240']]};
const BASELINE=Object.freeze({id:'TU_CS_2568_TEAM_BASELINE_FOR_1_69',source_year:2568,gpax_min:'2.75',group_gpa_min:'2.50',entry_year_max:2567});
function effectiveCriteria(curriculum,data){return {...(data?.criteria_id===faculty.ID?faculty.snapshot(curriculum):BASELINE),required_groups:(GROUPS[curriculum] || []).map(g=>[...g]),
  additional_groups:(EXTRA[curriculum] || []).map(g=>[...g]),future_course:curriculum==='61'?'CS302':'CS301'};}
function templates() {return Object.keys(GROUPS).map(curriculum=>({curriculum,source_year:2568,source:faculty.SOURCE,owner_confirmed:true,verified:false,
 groups:GROUPS[curriculum],additional:EXTRA[curriculum],future_course:curriculum==='61'?'CS302':'CS301',
 data:faculty.policyData(curriculum),effective_criteria:effectiveCriteria(curriculum,faculty.policyData(curriculum))}));}
function scaled(value) {
  const s=String(value ?? '');
  if (!/^\d+(?:\.\d{1,4})?$/.test(s)) return null;
  const [a,b='']=s.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'));
}
function readiness({app,official,policy,documents=[],window,roundOpen,allowSynthetic=false,allowPendingAcademic=false,facultyConfirmed=false,requireCriteriaAcknowledgement=false}) {
  const p=app.payload || {}, blockers=[],review_flags=[];
  const add=(field,code,message)=>blockers.push({field,code,message});
  const pending=(field,code,message)=>(allowPendingAcademic?review_flags:blockers).push({field,code,message});
  const curr=official?.curriculum || p.curriculum;
  if (!roundOpen) add('cycle_id','CYCLE_CLOSED','รอบนี้ปิดรับสมัครแล้ว');
  if (!window) add('cycle_id','SCHEDULE_PENDING','รอยืนยันกำหนดการของรอบสมัคร');
  else if (!window.is_open) add('cycle_id','WINDOW_CLOSED','ไม่อยู่ในช่วงเวลารับสมัคร');
  const data=policy?.data;
  const configured=policy?.verified && policy.source_year===BASELINE.source_year && (!policy.synthetic || allowSynthetic) && data && GROUPS[curr]
    && (facultyConfirmed?faculty.policyMatches(policy,curr):['LATEST','HIGHEST','SELECTED'].includes(data.repeat_rule) && data.alternative_rule==='STUDENT_SELECTED');
  const programType=faculty.programType(official,p),track=faculty.TRACKS[programType];
  if(requireCriteriaAcknowledgement && p.academic_criteria_acknowledgement!==faculty.ID)add('acknowledgements.required_courses','CRITERIA_ACK_REQUIRED','กรุณารับรองเงื่อนไขรายวิชาตามเกณฑ์ที่ยืนยันล่าสุดด้วยตนเอง');
  if(facultyConfirmed && (!track || p.major_group!==track.major))add('major_group','PROGRAM_MAJOR_MISMATCH','ภาคปกติต้องเป็น CIS ภาคพิเศษต้องเป็น ACS กรุณาตรวจข้อมูลตามหลักฐาน');
  if (!configured) pending('curriculum','POLICY_PENDING','รอยืนยันข้อมูลเกณฑ์');
  if (!official?.academic_verified) pending('curriculum','IDENTITY_PENDING','รอยืนยันหลักสูตรและปีที่เข้าศึกษา');
  if(allowPendingAcademic && !GROUPS[curr])add('curriculum','REQUIRED','กรุณาเลือกหลักสูตรตาม Transcript');
  if(allowPendingAcademic && official?.registration?.entry_year>BASELINE.entry_year_max)add('entry_year','ENTRY_YEAR','รอบ 1/69 รับนักศึกษารหัส 67 ลงไป');
  if (p.curriculum && official?.curriculum && p.curriculum!==official.curriculum) add('curriculum','CURRICULUM_MISMATCH','หลักสูตรที่เลือกไม่ตรงข้อมูลที่ยืนยัน');
  if (official?.academic_verified && official.entry_year>BASELINE.entry_year_max) add('curriculum','ENTRY_YEAR','รอบ 1/69 รับนักศึกษารหัส 67 ลงไป');
  for (const field of DECLARED_IDENTITY) {
    if (!(official?.[field] || p[field])?.trim()) add(field,'REQUIRED','กรุณาระบุข้อมูลนี้ หากยังไม่มีข้อมูลทางการแยกช่องให้กรอกตามเอกสาร');
    if (official?.[field] && p[field] && p[field]!==official[field]) add(field,'OFFICIAL_MISMATCH','ข้อมูลฉบับร่างต่างจากข้อมูลทางการ กรุณาใช้ค่าที่ยืนยัน');
  }
  for (const field of ['contact_address','contact_phone','major_group','guardian_name','guardian_relationship','guardian_address','guardian_phone']) if (!p[field]?.trim()) add(field,'REQUIRED','กรุณากรอกข้อมูลนี้');
  if (p.major_group && !MAJORS.some(([code])=>code===p.major_group)) add('major_group','MAJOR_CHOICE','กรุณาเลือก CIS หรือ ACS โดยข้อมูลเดิมยังไม่ถูกลบ');
  for (const field of ['contact_phone','guardian_phone']) if (p[field]?.trim() && !/^\+?\d{7,15}$/.test(p[field].replace(/[ ()-]/g,''))) add(field,'PHONE_FORMAT','กรุณาระบุเบอร์โทร 7–15 หลัก ใช้ + สำหรับรหัสประเทศได้');
  const email=official?.institutional_email || p.institutional_email;
  if (!email || !EMAIL.test(email)) add('institutional_email','REQUIRED','กรุณาระบุอีเมลมหาวิทยาลัย');
  if (!p.contact_email || !EMAIL.test(p.contact_email)) add('contact_email','EMAIL_FORMAT','กรุณาระบุอีเมลที่ติดต่อได้ให้ครบถ้วน');
  const codes=p.interested_position_codes || [];
  if (!codes.length) add('interested_position_codes','REQUIRED','กรุณาเลือกตำแหน่งที่สนใจอย่างน้อยหนึ่งตำแหน่ง');
  if (codes.some(code=>code!=='OTHER' && !POSITIONS.some(([key])=>key===code))) add('interested_position_codes','POSITION_CHOICE','กรุณาเลือกตำแหน่งจากรายการที่กำหนด');
  if (codes.includes('OTHER') && !p.interested_position_other?.trim()) add('interested_position_other','REQUIRED','กรุณาระบุตำแหน่งอื่นที่สนใจ');
  if (!(Object.hasOwn(p,'skills_detail') ? p.skills_detail?.trim() : p.skills?.length)) add('skills_detail','REQUIRED','กรุณาระบุทักษะหรือความถนัด');
  if (!p.gpax_reporting_term?.trim()) add('gpax_reporting_term','REQUIRED','กรุณาระบุภาคการศึกษาที่ใช้รายงาน GPAX ตาม Transcript');
  if (scaled(p.declared_group_gpa)===null) add('declared_group_gpa','REQUIRED','กรุณาระบุค่าเฉลี่ยกลุ่มวิชาที่คุณแจ้ง');
  const gpax=scaled(p.gpax);
  if (gpax===null) add('gpax','REQUIRED','กรุณาระบุ GPAX');
  else if (gpax<scaled(BASELINE.gpax_min)) add('gpax','GPAX_BELOW_MINIMUM','GPAX ต้องไม่ต่ำกว่า 2.75');
  let numerator=0n,denominator=0n,valid=Boolean(configured);
  for (const group of GROUPS[curr] || []) {
    let code=group[0];
    if (group.length>1) {
      code=facultyConfirmed?track?.course:p.selected_courses?.alternative;
      if (!group.includes(code)) {add('selected_courses','COURSE_CHOICE','กรุณาเลือกวิชาทางเลือกที่นำมาคำนวณ');valid=false;continue;}
      if(facultyConfirmed && p.selected_courses?.alternative!==code)add('selected_courses','PROGRAM_COURSE_MISMATCH',`ภาค${programType==='regular'?'ปกติใช้ CS213':'พิเศษใช้ CS216'} กรุณายืนยันรายวิชาตามภาค`);
    }
    const credits=scaled(data?.credits?.[code]);
    if (credits===null || credits<=0n || credits>990000n) {if (configured) pending('course_attempts','CREDITS_PENDING',`รอยืนยันหน่วยกิต ${code}`);valid=false;}
    if(allowPendingAcademic && (p.course_attempts || []).some(x=>x.code===code && x.points===null))add('course_attempts','COURSE_REQUIRED',`กรุณากรอกเกรดทุกครั้งที่เรียน ${code}`);
    let attempts=(p.course_attempts || []).filter(x=>x.code===code && x.points!==null);
    if(allowPendingAcademic && !facultyConfirmed && attempts.length>1 && (!configured || data.repeat_rule==='SELECTED')){
      pending('course_attempts','RETAKE_REVIEW','รอตรวจผลการเรียนซ้ำตามหลักฐาน');valid=false;
      if(attempts.some(x=>scaled(x.points)===null || scaled(x.points)>40000n))add('course_attempts','INVALID_GRADE','เกรดต้องอยู่ระหว่าง 0 ถึง 4');
      continue;
    }
    if (attempts.length>1 && (configured || facultyConfirmed)) {
      if(attempts.some(x=>scaled(x.points)===null || scaled(x.points)>40000n)){add('course_attempts','INVALID_GRADE','เกรดต้องอยู่ระหว่าง 0 ถึง 4');valid=false;continue;}
      if (!facultyConfirmed && data.repeat_rule==='LATEST') attempts=[attempts.reduce((a,b)=>a.attempt>b.attempt?a:b)];
      else if (facultyConfirmed || data.repeat_rule==='HIGHEST') attempts=[attempts.reduce((a,b)=>scaled(a.points)>scaled(b.points)?a:b)];
      else {add('course_attempts','RETAKE_REVIEW','กรณีเรียนซ้ำต้องได้รับการยืนยันตามเกณฑ์');valid=false;continue;}
    }
    if (attempts.length!==1 || scaled(attempts[0]?.points)===null) {add('course_attempts','COURSE_REQUIRED',`กรุณาระบุผลการเรียน ${code}`);valid=false;continue;}
    const points=scaled(attempts[0].points);
    if (points<0n || points>40000n) {valid=false;add('course_attempts','INVALID_GRADE','เกรดต้องอยู่ระหว่าง 0 ถึง 4');continue;}
    if(facultyConfirmed && points<20000n)add('course_attempts','COURSE_BELOW_C',`${code} ต้องได้ C (2.00) ขึ้นไป หากยังต่ำกว่า C ต้องเรียนใหม่ก่อน`);
    if (credits!==null && credits>0n) {numerator+=points*credits;denominator+=credits;}
  }
  const groupGpa=valid && denominator>0n ? (Number(numerator)/Number(denominator)/10000).toFixed(4) : null;
  if (groupGpa!==null && numerator<scaled(BASELINE.group_gpa_min)*denominator) add('course_attempts','GROUP_GPA_BELOW_MINIMUM','เกรดเฉลี่ยกลุ่มวิชาต้องไม่ต่ำกว่า 2.50');
  for (const group of EXTRA[curr] || []) if (!group.some(code=>['ENROLLED','STUDIED'].includes(p.additional_studies?.[code]))) add('additional_studies','ADDITIONAL_REQUIRED',`ต้องกำลังศึกษาหรือเคยศึกษา ${group.join(' หรือ ')}`);
  for (const kind of ['resume','transcript','conduct','photo']) if (!documents.some(d=>d.kind===kind)) add(`documents.${kind}`,'DOCUMENT_REQUIRED','กรุณาแนบไฟล์ที่ผ่านการบันทึกแล้ว');
  for (const name of ACKNOWLEDGEMENTS) if (p.acknowledgements?.[name]!==true) add(`acknowledgements.${name}`,'ACK_REQUIRED','กรุณาตรวจสอบและรับรองเงื่อนไขข้อนี้ด้วยตนเอง');
  return {can_submit:['DRAFT','NEEDS_REVISION'].includes(app.status) && blockers.length===0,eligibility:!configured || !official?.academic_verified || !valid?'UNKNOWN':blockers.length?'FAIL':'PASS',group_gpa:groupGpa,blockers,review_flags,preliminary:true};
}
module.exports={GROUPS,EXTRA,BASELINE,effectiveCriteria,templates,scaled,readiness};
