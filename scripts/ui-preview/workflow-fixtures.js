/** Synthetic-only integration model. Never imported by the production entry point. */
export function enhanceWorkflowPreview(clients,{role,scenario}={}) {
  const copy=x=>JSON.parse(JSON.stringify(x)), records=new Map();
  const ids={cycle:'30000000-0000-4000-8000-000000000101',policy:'60000000-0000-4000-8000-000000000101',advisor:'70000000-0000-4000-8000-000000000101'};
  const requirement={id:'eligibility',title:'แบบฟอร์มตรวจคุณสมบัติ (สมมติ)',required:true,format:'pdf',filename_pattern:'{student_number}_eligibility.pdf'};
  const policy={id:ids.policy,cycle_id:ids.cycle,department:'ภาควิชาวิทยาการคอมพิวเตอร์',program:'',version:1,requirements:[requirement]};
  let policies=[policy], assignments=[],contact={contact_address:'99 ถนนตัวอย่าง ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120 (ข้อมูลสมมติ)',contact_phone:'0800000000',version:1};
  const original=clients.studentPlanClient?.getOwnPlan.bind(clients.studentPlanClient);
  const originalSave=clients.studentPlanClient?.saveDraft?.bind(clients.studentPlanClient);
  async function base(id){
    if(original){const bundle=await original({planId:id});return bundle.plan;}
    const plan=await clients.advisorClient.getPlan(id);return {...plan,company_name:plan.company?.name,position_title:plan.position?.title};
  }
  async function record(id){
    if(records.has(id))return records.get(id);
    const source=await base(id);if(!source)throw new Error('ยังไม่มีแผนจำลอง');
    const status=scenario==='rejected'?'REJECTED':['company-confirmed','company-pending','capacity-full'].includes(scenario)?'APPROVED':source.status;
    const value={...source,status,cycle_status:'OPEN',plan_id:id,student_number:'6609612345',student_id:'20000000-0000-4000-8000-000000000101',
      project_title:'ระบบติดตามงานสหกิจศึกษา (ข้อมูลสมมติ)',policy:scenario==='missing-policy'?null:policy,
      references:[{requirement_id:'eligibility',filename:'6609612345_eligibility.pdf',format:'pdf',reference:'DEMO-2569-001',url:null}],
      submissions:[],placement:null,advisor:null,legacy_submission:scenario==='legacy'};
    if(status!=='DRAFT' && scenario!=='legacy')value.submissions=[{id:'synthetic-submission',plan_version:source.version,created_at:source.updated_at,snapshot:{project_title:value.project_title,references:copy(value.references)}}];
    if(role==='ADVISOR' && scenario!=='unassign' && scenario!=='revoked')value.advisor={id:ids.advisor,name:'อาจารย์สมมติ กิตติ ตัวอย่าง',version:1,effective_to:'2027-05-31T16:59:59Z'};
    if(['company-confirmed','company-pending'].includes(scenario)) {
      const payload={company_name:'บริษัทตัวอย่างเพื่อทดสอบ จำกัด',position_title:'Software Developer',project_title:value.project_title,accepted:true};
      value.placement={status:scenario==='company-confirmed'?'CONFIRMED':'AWAITING_COMPANY',version:3,payload,submitted_payload:copy(payload),confirmed_at:scenario==='company-confirmed'?'2026-10-21T03:00:00Z':null};
    }
    records.set(id,value);return value;
  }
  function check(actual,body){if(actual!==body.expected_version)throw new Error('ข้อมูลจำลองเปลี่ยนแล้ว กรุณารีเฟรช');}
  if(original){
    clients.studentPlanClient.getOwnPlan=async options=>{
      const bundle=await original(options);
      for(const item of bundle.plans||[]){if(!records.has(item.id))await record(item.id);Object.assign(item,{status:records.get(item.id).status,version:records.get(item.id).version});}
      if(bundle.plan){const item=await record(bundle.plan.id);Object.assign(bundle.plan,{status:item.status,version:item.version});}
      return bundle;
    };
    clients.studentPlanClient.saveDraft=async({planId,expectedVersion,content})=>{
      if(!planId) {const saved=await originalSave({planId,expectedVersion,content});await record(saved.id);return copy(saved);}
      const data=await record(planId);check(data.version,{expected_version:expectedVersion});
      Object.assign(data,content,{version:data.version+1});return copy(data);
    };
    clients.studentPlanClient.submitPlan=async({planId,expectedVersion})=>{
      const data=await record(planId);check(data.version,{expected_version:expectedVersion});
      if(!data.policy || !data.references.length)throw new Error('กรุณาบันทึกเอกสารอ้างอิงก่อน');
      data.status='SUBMITTED';data.version++;data.submissions.unshift({id:crypto.randomUUID(),plan_version:data.version,created_at:new Date().toISOString(),snapshot:{project_title:data.project_title,references:copy(data.references)}});return copy(data);
    };
  }
  clients.workflowClient={async request(path,{method='GET',body,signal}={}){
    const parsed=new URL(path,'https://preview.invalid');path=parsed.pathname;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(['expired','forbidden','error'].includes(scenario))throw Object.assign(new Error('สถานการณ์จำลอง: อ่านข้อมูลไม่ได้'),{status:scenario==='expired'?401:scenario==='forbidden'?403:503});
    if(role==='ADVISOR' && scenario==='revoked')throw Object.assign(new Error('ยกเลิก Assignment แล้ว (จำลอง)'),{status:403});
    if(path==='/api/v3/students/me'){
      if(method==='GET')return copy(contact);
      Object.assign(contact,body,{version:contact.version+1});return copy(contact);
    }
    if(path==='/api/v3/staff/workflow')return copy({scopes:[{department:policy.department,program:null,academic_year:2569}],
      cycles:[{id:ids.cycle,name:'รอบที่ 1 ปีการศึกษา 2569 (สมมติ)',status:'OPEN'}],policies,
      advisors:[{id:ids.advisor,name:'อาจารย์สมมติ กิตติ ตัวอย่าง',active_count:scenario==='capacity-full'?5:assignments.length}],assignments});
    if(path==='/api/v3/staff/assignments' && method==='GET'){
      const page=Number(parsed.searchParams.get('page')||1),pageSize=Number(parsed.searchParams.get('pageSize')||20),advisor=parsed.searchParams.get('advisor_id');
      const items=assignments.filter(a=>a.status==='ACTIVE'&&(!advisor||a.advisor_id===advisor));
      return copy({items:items.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:items.length,totalPages:Math.ceil(items.length/pageSize)}});
    }
    if(path==='/api/v3/staff/document-policies'){
      const saved={...body,id:crypto.randomUUID(),version:body.expected_version+1};policies.unshift(saved);return copy(saved);
    }
    if(path==='/api/v3/staff/assignments'){
      if(scenario==='capacity-full')throw new Error('อาจารย์ดูแลครบ 5 คนแล้ว (จำลอง)');
      const data=await record(body.plan_id),assignment={id:crypto.randomUUID(),plan_id:body.plan_id,advisor_id:body.advisor_id,name:'อาจารย์สมมติ กิตติ ตัวอย่าง',advisor_name:'อาจารย์สมมติ กิตติ ตัวอย่าง',full_name:'ณัฐวดี ศิริกุล',student_number:data.student_number,effective_to:body.effective_to,status:'ACTIVE',version:1};
      assignments.push(assignment);data.advisor=assignment;return copy(assignment);
    }
    const assignmentMatch=path.match(/^\/api\/v3\/staff\/assignments\/([^/]+)\/(revoke|reassign)$/);
    if(assignmentMatch){const a=assignments.find(a=>a.id===assignmentMatch[1]);if(!a)throw new Error('ไม่พบรายการจำลอง');a.status='REVOKED';for(const data of records.values())if(data.advisor?.id===a.id)data.advisor=null;return copy(a);}
    const match=path.match(/^\/api\/v3\/plans\/([^/]+)\/(.+)$/);if(!match)throw new Error('Unsupported preview path');
    const data=await record(match[1]), action=match[2];
    if(method==='GET')return copy(data);
    if(action==='workflow'){check(data.version,body);Object.assign(data,{project_title:body.project_title,references:copy(body.references),version:data.version+1});return copy(data);}
    if(action==='cancel'||action==='reject'){data.status=action==='cancel'?'CANCELLED':'REJECTED';data.version++;return copy(data);}
    if(action==='placement') {data.placement={status:'DRAFT',version:(data.placement?.version||0)+1,payload:copy(body)};return copy(data.placement);}
    const p=data.placement;if(!p)throw new Error('ยังไม่มีข้อมูลตอบรับบริษัทจำลอง');check(p.version,body);
    if(action==='placement/submit'){p.status='SUBMITTED';p.submitted_payload=copy(p.payload);}
    if(action==='placement/mark-sent')p.status='AWAITING_COMPANY';
    if(action==='placement/return'){p.status='NEEDS_REVISION';p.feedback=body.reason;}
    if(action==='placement/confirm'){
      if(body.company_name!==p.payload.company_name||body.student_number!==data.student_number)throw new Error('บริษัทหรือรหัสนักศึกษาไม่ตรงกัน (จำลอง)');
      p.status='CONFIRMED';p.confirmed_at=new Date().toISOString();
    }
    p.version++;return copy(p);
  }};
  if(role==='STAFF' && original){
    clients.loadSession=async()=>({role,canReviewPlan:true});
    clients.staffReviewClient={
      async getPlanWithHistory(id){const p=await record(id);return {plan:{...p,student:{full_name:'ณัฐวดี ศิริกุล',student_number:p.student_number,department:policy.department,program:'วิทยาศาสตรบัณฑิต'},cycle:{id:ids.cycle,name:'รอบที่ 1 ปีการศึกษา 2569',status:'OPEN',academic_year:2569},company:{name:p.company_name},position:{title:p.position_title}},history:[]};},
      async getReviewQueue(){const bundle=await original();return {items:await Promise.all(bundle.plans.map(async p=>(await this.getPlanWithHistory(p.id)).plan)),pagination:{page:1,pageSize:20,total:bundle.plans.length,totalPages:1}};},
      async runReviewCommand({planId,command}){const p=await record(planId);p.status={'start-review':'UNDER_REVIEW',return:'NEEDS_REVISION',approve:'APPROVED'}[command];p.version++;return copy(p);}
    };
  }
  return clients;
}
