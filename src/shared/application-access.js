const READ_ONLY_MESSAGE='ขณะนี้เปิดให้อ่านข้อมูลเท่านั้น ยังไม่เปิดสร้าง แก้ไข แนบไฟล์ หรือส่งใบสมัคร';
function stageMessage(access){
  if(access?.read_only)return READ_ONLY_MESSAGE;
  if(access?.can_upload===false)return 'ช่วงทดลองบันทึกร่าง: กรอกและบันทึกข้อมูลได้ ยังไม่เปิดแนบไฟล์หรือส่งใบสมัคร';
  if(access?.can_submit===false)return 'ช่วงทดลองแนบเอกสาร: บันทึกร่างและแนบไฟล์ได้ ยังไม่เปิดส่งใบสมัคร';
  return '';
}

const INTAKE_MODES=['intake-draft','intake-upload','intake-pilot'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function pilotScope(value){
  try{const s=typeof value==='string'?JSON.parse(value):value;
    if(!s || Object.keys(s).sort().join(',')!=='coordinator_user_id,cycle_id,student_user_id' ||
      !Object.values(s).every(x=>typeof x==='string' && UUID.test(x)) || s.student_user_id===s.coordinator_user_id)return null;
    return s;
  }catch{return null;}
}
function applicationAccess(mode,{actor,cycleId,scope,audience='pilot',routedStudent=false}={}) {
  const restricted=Boolean(mode && mode!=='off');
  if(INTAKE_MODES.includes(mode)){
    const s=pilotScope(scope),cycle=Boolean(s && (!cycleId || cycleId===s.cycle_id));
    const validAudience=['pilot','routed-tu-students'].includes(audience);
    // routedStudent is supplied only after server-side identity/routing checks.
    const student=Boolean(validAudience && cycle && actor?.isAuthenticated && actor.role==='STUDENT' && actor.accountStatus==='ACTIVE' &&
      (audience==='pilot'?actor.userId===s.student_user_id:routedStudent===true));
    const coordinator=Boolean(validAudience && cycle && actor?.isAuthenticated && actor.role==='COORDINATOR' && actor.accountStatus==='ACTIVE' && actor.userId===s.coordinator_user_id);
    return {read_only:!student,can_create:student,can_edit:student,can_upload:student && mode!=='intake-draft',
      can_submit:student && mode==='intake-pilot',can_download:(student || coordinator) && mode!=='intake-draft',
      reason:!student?'PILOT_SCOPE':mode!=='intake-pilot'?'PILOT_STAGE':null};
  }
  return {read_only:restricted,can_create:!restricted,can_edit:!restricted,
    can_upload:!restricted,can_submit:!restricted,can_download:!restricted,
    reason:restricted?'MAINTENANCE':null};
}

module.exports={applicationAccess,READ_ONLY_MESSAGE,stageMessage,INTAKE_MODES,pilotScope};
