import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import domain from '../src/api/services/academic-review-domain.js';
import form from '../src/shared/application-form.js';
import maintenance from '../src/maintenance.js';
import faculty from '../src/shared/faculty-criteria.js';
import policyModule from '../src/api/services/application-policy.js';
const snapshot=()=>({contract_version:2,policy:null,official:{academic_verified:false,registration:{program_type:'special',entry_year:2567}},declared_academic:{curriculum:'66',program_type:'special',entry_year:2567,source:'STUDENT_DECLARED'},assessment:{eligibility:'UNKNOWN',group_gpa:null,review_required:true},documents:['resume','transcript','photo','conduct'].map(kind=>({kind})),payload:{curriculum:'66',name_prefix:'Mx',thai_full_name:'Synthetic Student',english_full_name:'Synthetic Student',major_group:'ACS',institutional_email:'student@example.invalid',contact_email:'contact@example.invalid',contact_address:'Synthetic address',contact_phone:'0800000000',guardian_name:'Synthetic contact',guardian_relationship:'Parent',guardian_address:'Synthetic address',guardian_phone:'0800000001',gpax:'3.2',gpax_reporting_term:'2/2568',declared_group_gpa:'3.0',interested_position_codes:['SOFTWARE'],skills_detail:'Synthetic skill',selected_courses:{alternative:'CS216'},course_attempts:form.GROUPS['66'].map(g=>({code:g.length>1?'CS216':g[0],attempt:1,points:'3'})),additional_studies:{CS180:'ENROLLED',CS262:'STUDIED'},acknowledgements:Object.fromEntries(form.ACKNOWLEDGEMENTS.map(k=>[k,true]))}});
const policy=()=>({id:randomUUID(),cycle_id:randomUUID(),version:1,curriculum:'66',verified:true,synthetic:false,source_year:2568,source:'Synthetic reviewed policy fixture',data:faculty.policyData('66')});
test('complete verified policy calculates PASS without changing pending snapshot/provenance',()=>{
 const s=snapshot(),before=structuredClone(s),result=domain.assessment(s,policy());assert.equal(result.can_confirm,true,JSON.stringify(result));assert.equal(result.eligibility,'PASS');assert.equal(result.group_gpa,'3.0000');assert.deepEqual(s,before);assert.equal(s.policy,null);assert.equal(s.official.academic_verified,false);
});
test('missing/unverified/synthetic/partial policies cannot be certified',()=>{
 for(const edit of [()=>null,p=>({...p,verified:false}),p=>({...p,synthetic:true}),p=>({...p,source_year:2569}),p=>({...p,source:''}),p=>({...p,data:{...p.data,credits:{CS100:'3'}}}),p=>({...p,data:{...p.data,repeat_rule:null}})]){
  const r=domain.assessment(snapshot(),edit(policy()));assert.equal(r.can_confirm,false);assert.equal(r.eligibility,'UNKNOWN');assert.equal(r.group_gpa,null);
 }
});
test('known failures, inconsistent track, missing files and ambiguous repeated attempts block confirmation',()=>{
 for(const change of [s=>{s.payload.gpax='2.0';},s=>{s.payload.major_group='CIS';},s=>{s.documents=[];},s=>{s.declared_academic.entry_year=2569;}]){
  const s=snapshot();change(s);assert.equal(domain.assessment(s,policy()).can_confirm,false);
 }
 const s=snapshot(),p=policy();s.payload.course_attempts.push({code:'CS100',attempt:2,points:'0'});p.data.repeat_rule='SELECTED';assert.equal(domain.assessment(s,p).can_confirm,false);
});
test('confirmed 61/66 criteria use 3 credits and the course assigned to each program, including enrolled extras',()=>{
 for(const template of policyModule.templates()){assert.equal(template.verified,false);assert.equal(template.owner_confirmed,true);assert.equal(template.effective_criteria.id,faculty.ID);assert.equal(faculty.policyMatches(template,template.curriculum),true);}
 assert.equal(faculty.programType({program:'ภาคปกติ'},{major_group:'ACS'}),'regular');
 assert.equal(faculty.programType({program:'ภาคพิเศษ'},{major_group:'CIS'}),'special');
 for(const curriculum of ['61','66'])for(const program of ['regular','special']){
  const s=snapshot(),p=policy(),track=faculty.TRACKS[program];p.curriculum=curriculum;p.data=faculty.policyData(curriculum);
  Object.assign(s.declared_academic,{curriculum,program_type:program});s.official.registration.program_type=program;
  Object.assign(s.payload,{curriculum,major_group:track.major,selected_courses:{alternative:track.course},course_attempts:form.GROUPS[curriculum].map(g=>({code:g.length>1?track.course:g[0],attempt:1,points:'3'})),
   additional_studies:curriculum==='61'?{CS384:'ENROLLED',CS266:'ENROLLED'}:{CS180:'ENROLLED',CS262:'ENROLLED'}});
  const result=domain.assessment(s,p);assert.equal(result.can_confirm,true,JSON.stringify(result.blockers));assert.equal(result.group_gpa,'3.0000');assert.equal(result.criteria.id,faculty.ID);
  s.payload.selected_courses.alternative=program==='regular'?'CS216':'CS213';assert.ok(domain.assessment(s,p).blockers.some(b=>b.code==='PROGRAM_COURSE_MISMATCH'));
 }
});
test('C per-course minimum blocks a high overall average; C itself passes when the group minimum is met',()=>{
 const s=snapshot();s.payload.course_attempts.forEach(r=>r.points='4');s.payload.course_attempts[0].points='1.5';
 let r=domain.assessment(s,policy());assert.ok(Number(r.group_gpa)>2.5);assert.equal(r.can_confirm,false);assert.ok(r.blockers.some(b=>b.code==='COURSE_BELOW_C'));
 s.payload.course_attempts[0].points='2';assert.equal(domain.assessment(s,policy()).can_confirm,true);
 s.payload.course_attempts.forEach(r=>r.points='2.5');assert.equal(domain.assessment(s,policy()).can_confirm,true);
 s.payload.course_attempts[0].points='2';assert.ok(domain.assessment(s,policy()).blockers.some(b=>b.code==='GROUP_GPA_BELOW_MINIMUM'));
});
test('highest grade applies to retained attempts without rechecking university registration eligibility',()=>{
 const s=snapshot();s.payload.course_attempts=s.payload.course_attempts.filter(r=>r.code!=='CS100').concat([{code:'CS100',attempt:1,points:'0'},{code:'CS100',attempt:2,points:'1.5'},{code:'CS100',attempt:3,points:'3'}]);
 assert.equal(domain.assessment(s,policy()).group_gpa,'3.0000');assert.equal(domain.assessment(s,policy()).can_confirm,true);
 for(const points of ['0','3.5']){const retained=structuredClone(s);retained.payload.course_attempts.push({code:'CS100',attempt:4,points});const before=structuredClone(retained),r=domain.assessment(retained,policy());assert.equal(r.can_confirm,true);assert.deepEqual(retained,before);assert.equal(r.group_gpa,points==='0'?'3.0000':'3.0714');}
});
test('old published rules and contradictory credits cannot certify under the confirmed contract',()=>{
 for(const mutate of [p=>p.data.repeat_rule='LATEST',p=>p.data.alternative_rule='STUDENT_SELECTED',p=>p.data.credits.CS213='4',p=>p.data.credits.CS100='3e0',p=>p.data.grade_input='ALL_ATTEMPTS',p=>delete p.data.criteria_id]){
  const p=policy();mutate(p);const r=domain.assessment(snapshot(),p);assert.equal(r.eligibility,'UNKNOWN');assert.equal(r.group_gpa,null);assert.equal(r.can_confirm,false);
 }
});
test('new submitted criteria require explicit versioned acknowledgement; historical evidence is not relabeled',()=>{
 const s=snapshot();s.academic_criteria=faculty.snapshot('66');
 assert.ok(domain.assessment(s,policy()).blockers.some(b=>b.code==='CRITERIA_ACK_REQUIRED'));
 s.payload.academic_criteria_acknowledgement=faculty.ID;assert.equal(domain.assessment(s,policy()).can_confirm,true);
 delete s.academic_criteria;delete s.payload.academic_criteria_acknowledgement;assert.equal(domain.assessment(s,policy()).can_confirm,true);
});
test('review/handoff flags admit only the intended stage and paths, never Committee votes or TU staff calls',()=>{
 const names=['COED_API_MAINTENANCE','COED_COORDINATOR_REVIEW_ENABLED','COED_COMMITTEE_HANDOFF_ENABLED','COED_INTAKE_PILOT'],old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const path='/api/v4/coordinator/applications/'+randomUUID()+'/academic-review';
 const call=(method,rawPath,rawQueryString='')=>maintenance.maintenanceResponse({rawPath,rawQueryString,requestContext:{http:{method}}});
 try{
  process.env.COED_API_MAINTENANCE='intake-pilot';delete process.env.COED_COORDINATOR_REVIEW_ENABLED;assert.equal(call('POST',path).statusCode,503);
  process.env.COED_COORDINATOR_REVIEW_ENABLED='true';assert.equal(call('POST',path),null);assert.equal(call('POST',path,'role=ADMIN').statusCode,503);
  process.env.COED_COMMITTEE_HANDOFF_ENABLED='true';process.env.COED_INTAKE_PILOT=JSON.stringify({student_user_id:randomUUID(),coordinator_user_id:randomUUID(),cycle_id:randomUUID()});
  assert.equal(call('GET','/api/v3/committee/workspace'),null);
  for(const [method,p] of [['POST','/api/v3/committee/workspaces/'+randomUUID()],['GET','/api/tu-proxy/api/v3/committee/workspace'],['POST','/api/v4/coordinator/schedules/'+randomUUID()]])assert.equal(call(method,p).statusCode,503);
  process.env.COED_API_MAINTENANCE='intake-upload';assert.equal(call('POST',path).statusCode,503);assert.equal(call('GET','/api/v3/committee/workspace').statusCode,503);
 }finally{for(const key of names)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
});
