const {readiness,scaled,BASELINE}=require('./application-policy');
const {GROUPS}=require('../../shared/application-form');
const {CHECKS}=require('../../shared/academic-review');
const faculty=require('../../shared/faculty-criteria');
function assessment(snapshot,policy,{allowSynthetic=false}={}){
 const s=snapshot || {},p=s.payload || {},declared=s.declared_academic || {},curriculum=declared.curriculum || p.curriculum;
 const missing=[];
 const problem=(field,code,message)=>missing.push({field,code,message});
 if(!policy || policy.curriculum!==curriculum || policy.verified!==true || policy.source_year!==BASELINE.source_year || policy.synthetic && !allowSynthetic || !policy.source?.trim())
  problem('policy','POLICY_PENDING','ต้องมีเกณฑ์หลักสูตรที่ยืนยันแล้ว พร้อมแหล่งอ้างอิง');
 for(const code of (GROUPS[curriculum] || []).flat()){
  const credit=scaled(policy?.data?.credits?.[code]);if(credit===null || credit<=0n || credit>990000n)problem('policy','CREDITS_PENDING','ยังไม่ยืนยันหน่วยกิต '+code);
 }
 if(!faculty.policyMatches(policy,curriculum))problem('policy','CONFIRMED_CRITERIA_REQUIRED','ต้องเผยแพร่เกณฑ์ที่ยืนยันล่าสุด: วิชาละ 3 หน่วยกิต ใช้เกรดสูงสุดขั้นต่ำ C และ CS213/CS216 ตามภาค');
 if(!['61','66'].includes(curriculum))problem('curriculum','CURRICULUM_PENDING','ยังยืนยันหลักสูตรไม่ได้');
 const programType=declared.program_type || s.official?.registration?.program_type;
 const entryYear=declared.entry_year || s.official?.registration?.entry_year || s.official?.entry_year;
 if(!['regular','special'].includes(programType))problem('program_type','PROGRAM_TYPE_PENDING','ยังยืนยันภาคการศึกษาไม่ได้');
 if(programType && p.major_group!==({regular:'CIS',special:'ACS'})[programType])problem('major_group','PROGRAM_MAJOR_MISMATCH','กลุ่มวิชาและภาคการศึกษาที่แจ้งไม่ตรงกัน ต้องส่งกลับแก้ไข');
 if(!Number.isInteger(entryYear))problem('entry_year','ENTRY_YEAR_PENDING','ยังยืนยันปีที่เข้าศึกษาไม่ได้');
 // This is a review-local calculation, never an UPDATE to official identity,
 // the original submission, its policy:null, or self-reported provenance.
 const official={...s.official,curriculum,entry_year:entryYear,academic_verified:true};
 const result=readiness({app:{status:'DRAFT',payload:p},official,policy,documents:s.documents || [],window:{is_open:true},roundOpen:true,allowSynthetic,facultyConfirmed:true,requireCriteriaAcknowledgement:s.academic_criteria?.id===faculty.ID});
 const blockers=[...missing,...result.blockers];
 return {eligibility:missing.length?'UNKNOWN':result.eligibility,group_gpa:missing.length?null:result.group_gpa,
  gpax:p.gpax ?? null,blockers,can_confirm:!blockers.length && result.eligibility==='PASS',
  curriculum,program_type:programType || null,entry_year:entryYear || null,criteria:faculty.snapshot(curriculum),
  policy:policy?{id:policy.id,version:policy.version,curriculum:policy.curriculum,source_year:policy.source_year,source:policy.source,verified:policy.verified,synthetic:policy.synthetic}:null};
}
module.exports={CHECKS,assessment};
