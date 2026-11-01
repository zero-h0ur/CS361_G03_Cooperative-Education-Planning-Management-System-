// Source: user-supplied 2568 criteria, adopted by the team for 1/69.
// These templates intentionally contain NO invented credits or repeat rules.
const GROUPS=Object.freeze({
  '61':[['CS101'],['CS102'],['CS111'],['CS213','CS216'],['CS251'],['CS264']],
  '66':[['CS100'],['CS101'],['CS102'],['CS111'],['CS213','CS216'],['CS251'],['CS261']]
});
const EXTRA={'61':[['CS384'],['CS266','CS322','CS348']],'66':[['CS180'],['CS262','CS331','CS240']]};
const BASELINE=Object.freeze({id:'TU_CS_2568_TEAM_BASELINE_FOR_1_69',source_year:2568,gpax_min:'2.75',group_gpa_min:'2.50',entry_year_max:2567});
function effectiveCriteria(curriculum){return {...BASELINE,required_groups:(GROUPS[curriculum] || []).map(g=>[...g]),
  additional_groups:(EXTRA[curriculum] || []).map(g=>[...g]),future_course:curriculum==='61'?'CS302':'CS301'};}
function templates() {return Object.keys(GROUPS).map(curriculum=>({curriculum,source_year:2568,verified:false,groups:GROUPS[curriculum],additional:EXTRA[curriculum],future_course:curriculum==='61'?'CS302':'CS301',effective_criteria:effectiveCriteria(curriculum)}));}
function scaled(value) {
  const s=String(value ?? '');
  if (!/^\d+(?:\.\d{1,4})?$/.test(s)) return null;
  const [a,b='']=s.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'));
}
function readiness({app,official,policy,documents=[],window,roundOpen,allowSynthetic=false}) {
  const p=app.payload || {}, blockers=[];
  const add=(field,code,message)=>blockers.push({field,code,message});
  const curr=official?.curriculum || p.curriculum;
  if (!roundOpen) add('cycle_id','CYCLE_CLOSED','รอบนี้ปิดรับสมัครแล้ว');
  if (!window) add('cycle_id','SCHEDULE_PENDING','รอยืนยันกำหนดการของรอบสมัคร');
  else if (!window.is_open) add('cycle_id','WINDOW_CLOSED','ไม่อยู่ในช่วงเวลารับสมัคร');
  const data=policy?.data;
  const configured=policy?.verified && policy.source_year===BASELINE.source_year && (!policy.synthetic || allowSynthetic) && data && GROUPS[curr]
    && ['LATEST','HIGHEST','SELECTED'].includes(data.repeat_rule) && data.alternative_rule==='STUDENT_SELECTED';
  if (!configured) add('curriculum','POLICY_PENDING','รอยืนยันข้อมูลเกณฑ์');
  if (!official?.academic_verified) add('curriculum','IDENTITY_PENDING','รอยืนยันหลักสูตรและปีที่เข้าศึกษา');
  if (p.curriculum && official?.curriculum && p.curriculum!==official.curriculum) add('curriculum','CURRICULUM_MISMATCH','หลักสูตรที่เลือกไม่ตรงข้อมูลที่ยืนยัน');
  if (official?.academic_verified && official.entry_year>BASELINE.entry_year_max) add('curriculum','ENTRY_YEAR','รอบ 1/69 รับนักศึกษารหัส 67 ลงไป');
  for (const field of ['contact_address','contact_phone','major_group','guardian_name','guardian_relationship','guardian_address','guardian_phone']) if (!p[field]?.trim()) add(field,'REQUIRED','กรุณากรอกข้อมูลนี้');
  for (const field of ['contact_phone','guardian_phone']) if (p[field]?.trim() && !/^\+?\d{7,15}$/.test(p[field].replace(/[ ()-]/g,''))) add(field,'PHONE_FORMAT','กรุณาระบุเบอร์โทร 7–15 หลัก ใช้ + สำหรับรหัสประเทศได้');
  const email=official?.institutional_email || p.institutional_email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) add('institutional_email','REQUIRED','กรุณาระบุอีเมลมหาวิทยาลัย');
  if (!p.interested_positions?.length) add('interested_positions','REQUIRED','กรุณาระบุตำแหน่งที่สนใจอย่างน้อยหนึ่งตำแหน่ง');
  if (!p.skills?.length) add('skills','REQUIRED','กรุณาระบุทักษะหรือความถนัด');
  const gpax=scaled(p.gpax);
  if (gpax===null) add('gpax','REQUIRED','กรุณาระบุ GPAX');
  else if (gpax<scaled(BASELINE.gpax_min)) add('gpax','GPAX_BELOW_MINIMUM','GPAX ต้องไม่ต่ำกว่า 2.75');
  let numerator=0n,denominator=0n,valid=Boolean(configured);
  for (const group of GROUPS[curr] || []) {
    let code=group[0];
    if (group.length>1) {
      code=p.selected_courses?.alternative;
      if (!group.includes(code)) {add('selected_courses','COURSE_CHOICE','กรุณาเลือกวิชาทางเลือกที่นำมาคำนวณ');valid=false;continue;}
    }
    const credits=scaled(data?.credits?.[code]);
    if (credits===null || credits<=0n || credits>990000n) {if (configured) add('course_attempts','CREDITS_PENDING',`รอยืนยันหน่วยกิต ${code}`);valid=false;}
    let attempts=(p.course_attempts || []).filter(x=>x.code===code && x.points!==null);
    if (attempts.length>1 && configured) {
      if (data.repeat_rule==='LATEST') attempts=[attempts.reduce((a,b)=>a.attempt>b.attempt?a:b)];
      else if (data.repeat_rule==='HIGHEST') attempts=[attempts.reduce((a,b)=>scaled(a.points)>scaled(b.points)?a:b)];
      else {add('course_attempts','RETAKE_REVIEW','กรณีเรียนซ้ำต้องได้รับการยืนยันตามเกณฑ์');valid=false;continue;}
    }
    if (attempts.length!==1 || scaled(attempts[0]?.points)===null) {add('course_attempts','COURSE_REQUIRED',`กรุณาระบุผลการเรียน ${code}`);valid=false;continue;}
    const points=scaled(attempts[0].points);
    if (points<0n || points>40000n) {valid=false;add('course_attempts','INVALID_GRADE','เกรดต้องอยู่ระหว่าง 0 ถึง 4');continue;}
    if (credits!==null && credits>0n) {numerator+=points*credits;denominator+=credits;}
  }
  const groupGpa=valid && denominator>0n ? (Number(numerator)/Number(denominator)/10000).toFixed(4) : null;
  if (groupGpa!==null && numerator<scaled(BASELINE.group_gpa_min)*denominator) add('course_attempts','GROUP_GPA_BELOW_MINIMUM','เกรดเฉลี่ยกลุ่มวิชาต้องไม่ต่ำกว่า 2.50');
  for (const group of EXTRA[curr] || []) if (!group.some(code=>['ENROLLED','STUDIED'].includes(p.additional_studies?.[code]))) add('additional_studies','ADDITIONAL_REQUIRED',`ต้องกำลังศึกษาหรือเคยศึกษา ${group.join(' หรือ ')}`);
  for (const kind of ['resume','transcript','conduct','photo']) if (!documents.some(d=>d.kind===kind)) add(`documents.${kind}`,'DOCUMENT_REQUIRED','กรุณาแนบไฟล์ที่ผ่านการบันทึกแล้ว');
  for (const name of ['terms','conduct','preplacement']) if (p.acknowledgements?.[name]!==true) add(`acknowledgements.${name}`,'ACK_REQUIRED','กรุณารับทราบและยอมรับเงื่อนไข');
  return {can_submit:app.status==='DRAFT' && blockers.length===0,eligibility:!configured || !official?.academic_verified || !valid?'UNKNOWN':blockers.length?'FAIL':'PASS',group_gpa:groupGpa,blockers,preliminary:true};
}
module.exports={GROUPS,EXTRA,BASELINE,effectiveCriteria,templates,scaled,readiness};
