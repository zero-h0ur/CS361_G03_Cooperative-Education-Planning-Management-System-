// Owner-confirmed department criteria, 2026-11-08. Publication to a real
// cycle's versioned phase1_policies remains a separately approved data action.
const {GROUPS}=require('./application-form');
const ID='TU_CS_2568_CONFIRMED_2026_11_08';
const SOURCE='เกณฑ์สาขาปี 2568 สำหรับรอบ 1/69 · เจ้าของโครงการยืนยัน 2026-11-08';
const TRACKS=Object.freeze({regular:{major:'CIS',course:'CS213'},special:{major:'ACS',course:'CS216'}});
function programType(official={},payload={}){
 if(official.registration?.program_type || official.program_type)return official.registration?.program_type || official.program_type;
 const program=typeof official.program==='string'?official.program.trim():'';
 if(/^(ภาคปกติ|หลักสูตรปกติ|regular|normal|CIS)$/i.test(program))return 'regular';
 if(/^(ภาคพิเศษ|หลักสูตรพิเศษ|special|ACS)$/i.test(program))return 'special';
 return payload.major_group==='CIS'?'regular':payload.major_group==='ACS'?'special':null;
}
function policyData(curriculum){return {criteria_id:ID,credits:Object.fromEntries((GROUPS[curriculum] || []).flat().map(c=>[c,'3'])),
 repeat_rule:'HIGHEST',alternative_rule:'PROGRAM_TYPE',course_grade_min:'2.00',grade_input:'HIGHEST_ONLY'};}
function snapshot(curriculum){return {id:ID,source_year:2568,source:SOURCE,gpax_min:'2.75',group_gpa_min:'2.50',entry_year_max:2567,
 course_grade_min:'2.00',repeat_rule:'HIGHEST',alternative_rule:'PROGRAM_TYPE',grade_input:'HIGHEST_ONLY',
 required_groups:(GROUPS[curriculum] || []).map(g=>[...g]),credits:policyData(curriculum).credits,
 program_courses:{regular:'CS213',special:'CS216'}};}
function policyMatches(policy,curriculum){const data=policy?.data,expected=policyData(curriculum);
 return Boolean(data && Object.entries(expected).every(([key,value])=>key==='credits'?
  Object.keys(value).every(code=>/^3(?:\.0{1,4})?$/.test(String(data.credits?.[code]))):
  data[key]===value));
}
module.exports={ID,SOURCE,TRACKS,programType,policyData,snapshot,policyMatches};
