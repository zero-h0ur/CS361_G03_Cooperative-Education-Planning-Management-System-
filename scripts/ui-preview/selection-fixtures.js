// Synthetic presentation only. Never import into production or call an AWS API.
export const SELECTION_SCENARIOS=Object.freeze({pending:'รอรับเรื่อง / เริ่มให้ความเห็น',review:'บันทึกแล้วหนึ่งความเห็น',
  complete:'ครบสามความเห็น รอประกาศผล (ไม่ใช่อนุมัติ)',empty:'ยังไม่มีผู้สมัคร',loading:'กำลังโหลด',
  forbidden:'ถูกถอนสิทธิ์',expired:'Session หมดอายุ',error:'เชื่อมต่อไม่สำเร็จ'});
export function selectionPreview(role,scenario){
  const coordinator=role==='COORDINATOR';let count=scenario==='complete'?3:scenario==='review'?1:0;
  let received=!coordinator||scenario==='review'||scenario==='complete',own=scenario==='complete';
  return {loadSession:async()=>({role,canReviewPlan:false}),workflowClient:{request:async(path,options={})=>{
    if(scenario==='loading')return new Promise(()=>{});
    if(scenario==='forbidden')throw Object.assign(new Error('Synthetic forbidden'),{status:403});
    if(scenario==='expired')throw Object.assign(new Error('Synthetic expired'),{status:401});
    if(scenario==='error')throw new Error('Synthetic unavailable');
    if(options.method==='POST'){
      if(coordinator)received=true;else{own=true;count=Math.min(3,count+1);}
      return {opinion_count:count};
    }
    const row={plan_id:'50000000-0000-4000-8000-000000000101',plan_version:1,
      student_number:'DEMO361001',full_name:'นักศึกษาสมมติ สำหรับทดสอบหน้าจอ',department:'ภาควิชาทดสอบ',program:'หลักสูตรสมมติ',
      cycle_name:'รอบสาธิต — ไม่ใช่ข้อมูลจริง',opinion_count:count,
      state:!received?'AWAITING_COORDINATOR':count===3?'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT':'UNDER_COMMITTEE_REVIEW',
      own_opinion:own?{selected:true,comment:'ความเห็นสมมติ ไม่ใช่ผลตัดสินจริง',submitted_at:'2026-10-31T00:00:00Z'}:null};
    return {cohorts:[{department:'ภาควิชาทดสอบ',program:'หลักสูตรสมมติ'}],applications:scenario==='empty'?[]:[row],page:1,pageSize:25,has_more:false};
  }}};
}
