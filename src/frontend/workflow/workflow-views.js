import { createWorkspaceIcon } from '../ui/workspace-presentation.js';
const stateLabels={DRAFT:'ฉบับร่าง',SUBMITTED:'ส่งแล้ว รอ Staff ตรวจ',UNDER_REVIEW:'กำลังตรวจคุณสมบัติ',NEEDS_REVISION:'ส่งกลับแก้ไข',APPROVED:'ผ่านเกณฑ์สหกิจ',REJECTED:'ไม่ผ่านเกณฑ์ในรอบนี้',CANCELLED:'ยกเลิกแล้ว',AWAITING_COMPANY:'รอแบบฟอร์มตอบกลับจากบริษัท',CONFIRMED:'บริษัทยืนยันแล้ว'};
const canEdit=s=>['DRAFT','NEEDS_REVISION'].includes(s);
function el(tag,cls,text) { const node=document.createElement(tag); if(cls) node.className=cls; if(text!=null) node.textContent=String(text); return node; }
function card(title,icon='clipboard') {
  const section=el('section','student-card workflow-card');
  const header=el('div','workflow-card__header'); header.append(createWorkspaceIcon(icon),el('h2','student-card__title',title));
  section.append(header); return section;
}
function field(form,label,value='',{type='text',required=true,maxLength=300}={}) {
  const wrapper=el('label','workflow-field'), input=el(type==='textarea'?'textarea':'input','student-form__input');
  wrapper.append(el('span','student-form__label',label));
  if(type!=='textarea') input.type=type;
  if(type==='checkbox') input.checked=Boolean(value); else input.value=value || '';
  input.required=required; if(type!=='checkbox') input.maxLength=maxLength;
  wrapper.append(input); form.append(wrapper); return input;
}
function select(form,label,options,value) {
  const wrapper=el('label','workflow-field'), input=el('select','student-form__input');
  input.required=true;
  wrapper.append(el('span','student-form__label',label));
  for(const [id,text] of options) { const option=el('option',null,text); option.value=id; input.append(option); }
  if(value!=null) input.value=value; wrapper.append(input); form.append(wrapper); return input;
}
function note(parent,text) { parent.append(el('p','workflow-note',text)); }
function badge(parent,status) { parent.append(el('span',`student-badge ${['REJECTED','NEEDS_REVISION'].includes(status)?'student-badge--warning':'student-badge--neutral'}`,stateLabels[status] || status)); }
function refList(parent,items=[]) {
  const list=el('ul','workflow-reference-list');
  for(const ref of items) {
    const item=el('li'); item.append(el('strong',null,ref.filename || ref.requirement_id),el('span',null,ref.reference || 'เลขอ้างอิงไม่ได้ระบุ'));
    if(ref.url) { try {
      const url=new URL(ref.url); if(url.protocol==='https:' && !url.username && !url.password) {
        const link=el('a','advisor-link','เปิดเอกสารต้นทาง'); link.href=url.href; link.target='_blank'; link.rel='noopener noreferrer'; link.referrerPolicy='no-referrer'; item.append(link);
      }
    } catch { /* Malformed historical external link is never clickable. */ } }
    list.append(item);
  }
  if(!items.length) note(parent,'ยังไม่มีเอกสารอ้างอิง'); else parent.append(list);
}
function controls(form,label,action,{danger=false,onDirtyChange}={}) {
  const feedback=el('p','workflow-feedback'); feedback.setAttribute('role','status'); feedback.setAttribute('aria-live','polite');
  const button=el('button',`shell-button${danger?' workflow-danger':''}`,label); button.type='submit';
  form.append(button,feedback);
  let busy=false,pending=null,signature=null;
  form.addEventListener('input',()=>onDirtyChange?.(true));
  form.addEventListener('submit',async event=>{
    event.preventDefault(); if(busy || !form.reportValidity()) return;
    busy=true; form.setAttribute('aria-busy','true'); feedback.textContent='กำลังบันทึก…';
    const disabled=Array.from(form.elements).map(node=>[node,node.disabled]);
    // Build body before disabling controls, and retain the same key on uncertain retries.
    const getOperation=body=>{const next=JSON.stringify(body); if(signature!==next){pending=globalThis.crypto.randomUUID();signature=next;} return {...body,operation_id:pending};};
    disabled.forEach(([node])=>{node.disabled=true;});
    try { await action(getOperation); onDirtyChange?.(false); feedback.textContent='บันทึกเรียบร้อยแล้ว'; }
    catch(error) { if(error.name!=='AbortError') {feedback.setAttribute('role','alert');feedback.textContent=error.message || 'ทำรายการไม่สำเร็จ';feedback.tabIndex=-1;feedback.focus();} }
    finally {busy=false;form.setAttribute('aria-busy','false');disabled.forEach(([node,was])=>{node.disabled=was;});}
  });
  return button;
}
function errorHandler(root,options) {
  return error=>{
    if(error.name==='AbortError' || options.signal?.aborted) return;
    const expired=error.status===401||error.code==='SESSION_EXPIRED';
    const denied=error.status===403||['ACCESS_DENIED','NOT_IN_SCOPE'].includes(error.code);
    if(expired || denied) {
      root.replaceChildren(el('p','workflow-feedback',expired?'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่':'ไม่มีสิทธิ์อ่านข้อมูลนี้แล้ว'));
      if(expired) options.onSessionExpired?.(); else options.onAccessDenied?.('ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
    }
    throw error;
  };
}

export function renderContactPanel(options) {
  const {client,signal}=options, root=card('ข้อมูลติดต่อที่คุณแก้ไขได้','user');
  const outcome=el('p','workflow-feedback');outcome.setAttribute('role','status');root.append(outcome);
  const error=errorHandler(root,options);
  async function load(){
    try {
      const data=await client.request('/api/v3/students/me',{signal}); if(signal?.aborted) return;
      const form=el('form','workflow-form');
      note(form,'แก้ไขเฉพาะที่อยู่และเบอร์โทร ชื่อ-นามสกุล รหัสนักศึกษา และข้อมูล TU ยังคงอ่านอย่างเดียว');
      const address=field(form,'ที่อยู่ติดต่อ',data.contact_address,{type:'textarea',required:false,maxLength:1000});
      const phone=field(form,'เบอร์โทรศัพท์',data.contact_phone,{type:'tel',required:false,maxLength:40});
      address.autocomplete='street-address';phone.autocomplete='tel';
      controls(form,'บันทึกข้อมูลติดต่อ',async op=>{
        await client.request('/api/v3/students/me',{method:'PATCH',signal,body:op({contact_address:address.value,contact_phone:phone.value,version:data.version})}).catch(error);
        await load();
        outcome.textContent='บันทึกข้อมูลติดต่อเรียบร้อยแล้ว';
      });
      root.querySelector('form')?.remove();root.append(form);
    } catch(e){if(e.name!=='AbortError' && !signal?.aborted){note(root,e.message);try{error(e);}catch{/* Session/permission callbacks clear stale content. */}}}
  }
  load(); return root;
}

export function renderPlanWorkflow(options) {
  const {client,planId,role,signal,onChanged,onDirtyChange,onReady}=options;
  const root=el('div','workflow-stack'); let sequence=0;
  const error=errorHandler(root,options), path=`/api/v3/plans/${encodeURIComponent(planId)}`;
  async function refresh(message=''){
    const request=++sequence; root.setAttribute('aria-busy','true');
    try {
      const data=await client.request(`${path}/workflow`,{signal});
      if(signal?.aborted || request!==sequence) return;
      render(data); onReady?.(data); root.setAttribute('aria-busy','false');
      if(message){const feedback=el('p','workflow-feedback',message);feedback.setAttribute('role','status');root.prepend(feedback);}
    } catch(e) {
      if(signal?.aborted || request!==sequence || e.name==='AbortError') return;
      root.replaceChildren(el('p','workflow-feedback',e.message)); root.setAttribute('aria-busy','false');
      const retry=el('button','shell-button shell-button--secondary','ลองโหลด Workflow อีกครั้ง');retry.type='button';retry.addEventListener('click',()=>refresh());root.append(retry);
      try{error(e);}catch{/* Feedback stays visible; no stale data remains. */}
    }
  }
  async function send(suffix,method,body){
    await client.request(`${path}${suffix}`,{method,body,signal}).catch(error);
    onDirtyChange?.(false);
    if(onChanged) await onChanged({tone:'status',message:'บันทึกข้อมูล Workflow เรียบร้อยแล้ว'}); else await refresh('บันทึกเรียบร้อยแล้ว');
  }
  function render(data){
    const documents=card('Project และเอกสารอ้างอิง');badge(documents,data.status);
    note(documents,'ส่งเอกสารผ่านช่องทางเดิม แล้วบันทึกเลขอ้างอิง/ลิงก์ที่นี่ ระบบไม่ได้อัปโหลดหรืออ่านเนื้อหาไฟล์ให้โดยอัตโนมัติ');
    note(documents,'ลิงก์ต้นทางต้องตั้งสิทธิ์ให้ผู้ตรวจเข้าถึงได้ การตั้งสิทธิ์ใน CO-ED ไม่ได้เปลี่ยนสิทธิ์ของเอกสารต้นทาง');
    if(data.policy) {
      const requirements=el('details','workflow-disclosure'); requirements.append(el('summary',null,`ข้อกำหนดเอกสารฉบับที่ ${data.policy.version}`));
      for(const rule of data.policy.requirements) note(requirements,`${rule.title}${rule.required?' (ต้องส่ง)':' (ถ้ามี)'}${rule.format?` · ${rule.format}`:''}${rule.filename_pattern?` · ชื่อไฟล์ ${rule.filename_pattern.replaceAll('{student_number}',data.student_number)}`:''}`);
      documents.append(requirements);
    } else note(documents,'Staff ยังไม่ได้ตั้งข้อกำหนดเอกสารในรอบนี้ กรุณาติดต่อเจ้าหน้าที่ก่อนส่งแผน');
    if(role==='STUDENT' && canEdit(data.status) && data.policy) {
      const form=el('form','workflow-form'), project=field(form,'หัวข้อ Project ที่สนใจ',data.project_title,{maxLength:300});
      const inputs=data.policy.requirements.map(rule=>{
        const old=data.references.find(ref=>ref.requirement_id===rule.id)||{};
        const group=el('fieldset','workflow-document'); group.append(el('legend',null,`${rule.title}${rule.required?' *':''}`));
        const filename=field(group,'ชื่อไฟล์ที่ส่งจริง',old.filename,{required:rule.required,maxLength:255});
        const format=field(group,'นามสกุลไฟล์ เช่น pdf',old.format||rule.format,{required:rule.required,maxLength:40});
        const reference=field(group,'เลขอ้างอิงเอกสาร (หรือระบุลิงก์ด้านล่าง)',old.reference,{required:false});
        const url=field(group,'ลิงก์เอกสาร HTTPS',old.url,{type:'url',required:false,maxLength:2048});
        form.append(group); return {rule,filename,format,reference,url};
      });
      controls(form,'บันทึก Project และเอกสารอ้างอิง',async op=>{
        const references=inputs.filter(x=>x.rule.required || x.reference.value.trim() || x.url.value.trim()).map(x=>({requirement_id:x.rule.id,filename:x.filename.value,format:x.format.value,reference:x.reference.value,url:x.url.value}));
        await send('/workflow','PATCH',op({project_title:project.value,references,policy_id:data.policy.id,expected_version:data.version}));
      },{onDirtyChange}); documents.append(form);
      if (data.status === 'DRAFT') {
      const cancel=el('details','workflow-disclosure');cancel.append(el('summary',null,'ยกเลิกฉบับร่างนี้'));
      const cancelForm=el('form','workflow-form');note(cancelForm,'รายการจะถูกยกเลิก แต่ประวัติการทำรายการยังถูกเก็บไว้');
      field(cancelForm,'ยืนยันยกเลิกฉบับร่าง',false,{type:'checkbox'});
      controls(cancelForm,'ยืนยันยกเลิกฉบับร่าง',op=>send('/cancel','POST',op({expected_version:data.version})),{danger:true});cancel.append(cancelForm);documents.append(cancel);
      }
    } else {note(documents,`Project: ${data.project_title || 'รายการเก่ายังไม่ระบุ'}`);refList(documents,data.references);}
    if(data.legacy_submission) note(documents,'รายการก่อนเริ่มระบบข้อกำหนดเอกสาร: ไม่มี snapshot ย้อนหลัง ไม่ใช่การยืนยันว่าไม่มีเอกสาร');
    if(data.submissions.length) {
      const history=el('details','workflow-disclosure');history.append(el('summary',null,'ข้อมูลที่ส่งตรวจแต่ละครั้ง (อ่านอย่างเดียว)'));
      for(const submission of data.submissions) {const section=el('section','workflow-document');note(section,`แผนเวอร์ชัน ${submission.plan_version} · ${new Date(submission.created_at).toLocaleString('th-TH')}`);note(section,submission.snapshot.project_title);refList(section,submission.snapshot.references);history.append(section);}
      documents.append(history);
    }
    const assignment=card('อาจารย์ที่ปรึกษา','user');
    note(assignment,data.advisor?`${data.advisor.name} · ดูแลถึง ${new Date(data.advisor.effective_to).toLocaleDateString('th-TH')}`:'ยังไม่ได้รับมอบหมายอาจารย์ที่ปรึกษา Staff จะเป็นผู้มอบหมายหลังผ่านเกณฑ์สหกิจ');
    if(role==='STAFF' && data.status==='APPROVED') {
      const form=el('form','workflow-form');
      const advisor=select(form,'อาจารย์ที่ปรึกษา',[]), end=field(form,'วันสิ้นสุดการดูแล','',{type:'date'});
      end.min=new Date().toISOString().slice(0,10);
      client.request('/api/v3/staff/workflow',{signal}).then(d=>{if(signal?.aborted)return;for(const a of d.advisors){const option=el('option',null,`${a.name} · ดูแลขณะนี้ ${a.active_count}/5 คน`);option.value=a.id;advisor.append(option);}}).catch(()=>note(form,'โหลดรายชื่ออาจารย์ไม่สำเร็จ กรุณารีเฟรช'));
      const reason=data.advisor?field(form,'เหตุผลเปลี่ยนอาจารย์','',{maxLength:2000}):null;
      controls(form,data.advisor?'เปลี่ยนอาจารย์ที่ปรึกษา':'มอบหมายอาจารย์ที่ปรึกษา',async op=>{
        const body=op({advisor_id:advisor.value,effective_to:new Date(`${end.value}T23:59:59+07:00`).toISOString(),expected_version:data.advisor?.version||data.version,...(reason?{reason:reason.value}:{plan_id:planId})});
        await client.request(data.advisor?`/api/v3/staff/assignments/${data.advisor.id}/reassign`:'/api/v3/staff/assignments',{method:'POST',signal,body}).catch(error);await refresh('บันทึกการมอบหมายอาจารย์แล้ว');
      });assignment.append(form);
    }
    const placement=card('การตอบรับและยืนยันจากบริษัท','building');
    const current=data.placement || {status:'DRAFT',version:0,payload:{}};
    note(placement,'ผ่านเกณฑ์สหกิจ ≠ บริษัทยืนยันรับ ต้องสมัครบริษัทและตกลงกับบริษัทผ่านช่องทางเดิมก่อน');
    if(data.status!=='APPROVED') note(placement,'ส่วนนี้จะดำเนินการได้หลัง Staff อนุมัติคุณสมบัติ');
    else {
      badge(placement,current.status);if(current.feedback) note(placement,`สิ่งที่ต้องแก้ไข: ${current.feedback}`);
      if(role==='STUDENT' && canEdit(current.status)) {
        const form=el('form','workflow-form');
        const company=field(form,'ชื่อบริษัทที่ตอบรับจริง',current.payload.company_name), position=field(form,'ตำแหน่งงานจริง',current.payload.position_title), project=field(form,'Project ที่ตกลงกับบริษัท',current.payload.project_title);
        const accepted=field(form,'บริษัทตอบรับแล้ว และฉันตกลงฝึกสหกิจกับบริษัทนี้',current.payload.accepted,{type:'checkbox'});
        controls(form,'บันทึกข้อมูลตอบรับบริษัท',op=>send('/placement','PATCH',op({company_name:company.value,position_title:position.value,project_title:project.value,accepted:accepted.checked,expected_version:current.version})));
        placement.append(form);
        if(current.payload.accepted) {const submit=el('form','workflow-form');controls(submit,'ส่งข้อมูลบริษัทให้ Staff',op=>send('/placement/submit','POST',op({expected_version:current.version})));placement.append(submit);}
      } else {const p=current.submitted_payload||current.payload;note(placement,`บริษัท: ${p.company_name||'ยังไม่ระบุ'} · ตำแหน่ง: ${p.position_title||'ยังไม่ระบุ'}`);note(placement,`Project: ${p.project_title||'ยังไม่ระบุ'}`);}
      if(role==='STAFF' && current.status==='SUBMITTED') {
        const form=el('form','workflow-form'), reference=field(form,'เลขอ้างอิงการส่งแบบฟอร์มให้บริษัท');
        note(form,'ส่งแบบฟอร์มผ่านช่องทางเดิมก่อน แล้วบันทึกการส่งที่นี่');
        controls(form,'บันทึกว่าส่งแบบฟอร์มให้บริษัทแล้ว',op=>send('/placement/mark-sent','POST',op({expected_version:current.version,reference:reference.value})));placement.append(form);
      }
      if(role==='STAFF' && current.status==='AWAITING_COMPANY') {
        const form=el('form','workflow-form');note(form,'กรอกข้อมูลตามแบบฟอร์มที่บริษัทส่งกลับจริง ระบบจะตรวจให้ตรงกับข้อมูลที่นักศึกษาส่ง ไม่ใช่การยืนยันบริษัทอัตโนมัติ');
        const company=field(form,'ชื่อบริษัทตามเอกสารตอบกลับ'), number=field(form,'รหัสนักศึกษาตามเอกสารตอบกลับ','',{maxLength:100}), reference=field(form,'เลขอ้างอิงหลักฐานตอบกลับ','',{required:false}), url=field(form,'ลิงก์หลักฐานตอบกลับ HTTPS','',{type:'url',required:false,maxLength:2048});
        field(form,'ฉันตรวจสอบเอกสารตอบกลับและคู่บริษัท/นักศึกษาแล้ว',false,{type:'checkbox'});
        controls(form,'ยืนยันผลตอบรับบริษัท',op=>send('/placement/confirm','POST',op({expected_version:current.version,company_name:company.value,student_number:number.value,reference:reference.value,url:url.value})));placement.append(form);
      }
      if(role==='STAFF' && ['SUBMITTED','AWAITING_COMPANY'].includes(current.status)) {
        const form=el('form','workflow-form'), reason=field(form,'เหตุผลส่งข้อมูลบริษัทกลับให้แก้ไข','',{maxLength:2000});
        controls(form,'ส่งข้อมูลบริษัทกลับให้แก้ไข',op=>send('/placement/return','POST',op({expected_version:current.version,reason:reason.value})));placement.append(form);
      }
      if(current.confirmed_at) note(placement,`Staff ยืนยันเมื่อ ${new Date(current.confirmed_at).toLocaleString('th-TH')}`);
    }
    const reload=el('details','workflow-disclosure');reload.append(el('summary',null,'โหลดข้อมูล Workflow ล่าสุด'));
    note(reload,'การโหลดใหม่จะละทิ้งข้อมูลบนหน้านี้ที่ยังไม่ได้บันทึก');
    const reloadButton=el('button','shell-button shell-button--secondary','ยืนยันโหลดข้อมูลล่าสุด');reloadButton.type='button';
    reloadButton.addEventListener('click',async()=>{onDirtyChange?.(false);if(onChanged)await onChanged();else await refresh();});reload.append(reloadButton);
    root.replaceChildren(reload,documents,assignment,placement);
    if(role==='STAFF' && data.status==='UNDER_REVIEW' && data.cycle_status==='OPEN') {
      const rejection=card('ไม่ผ่านคุณสมบัติในรอบสมัครนี้','warning'), form=el('form','workflow-form');
      note(form,'ใช้สำหรับไม่ผ่านเกณฑ์เท่านั้น หากเอกสารผิดให้ใช้ “ส่งกลับให้แก้ไข” ในส่วนตรวจแผนแทน');
      const reason=field(form,'เหตุผลปฏิเสธแบบสิ้นสุด','',{type:'textarea',maxLength:2000});
      field(form,'ยืนยันว่านักศึกษาจะไม่สามารถแก้ไขหรือยื่นใหม่ในรอบนี้ได้',false,{type:'checkbox'});
      controls(form,'ยืนยันไม่ผ่านคุณสมบัติในรอบนี้',op=>send('/reject','POST',op({expected_version:data.version,review_notes:reason.value})),{danger:true});rejection.append(form);root.append(rejection);
    }
  }
  root.append(card('กำลังโหลด Project เอกสาร และการมอบหมาย…'));
  refresh();return root;
}

export function renderStaffWorkflow(options) {
  const {client,signal}=options, root=el('div','workflow-stack'), error=errorHandler(root,options);
  let loadSequence=0;
  async function load(message=''){
    const currentLoad=++loadSequence;
    root.setAttribute('aria-busy','true');
    try {
      const data=await client.request('/api/v3/staff/workflow',{signal});if(signal?.aborted||currentLoad!==loadSequence)return;
      const requirements=card('ข้อกำหนดเอกสารรายรอบ'), form=el('form','workflow-form');
      note(form,'ฉบับใหม่ใช้กับแผนใหม่ ไม่เปลี่ยนข้อกำหนดของรายการที่ส่งตรวจแล้ว ชื่อไฟล์รองรับ {student_number} แทนรหัสนักศึกษา');
      const cycle=select(form,'รอบสมัคร',data.cycles.map(c=>[c.id,`${c.name} · ${c.status==='OPEN'?'เปิด':'ปิด'}`]));
      const scope=select(form,'ขอบเขตที่รับผิดชอบ',data.scopes.map((s,i)=>[String(i),`${s.department} / ${s.program||'ทุกหลักสูตร'} / ${s.academic_year||'ทุกปี'}`]));
      const rows=el('div','workflow-stack');form.append(rows);let inputs=[];
      function add(rule={}){
        const group=el('fieldset','workflow-document');group.append(el('legend',null,'รายการเอกสาร'));
        const title=field(group,'ชื่อเอกสาร',rule.title), format=field(group,'นามสกุลไฟล์ เช่น pdf',rule.format,{required:false,maxLength:40}), filename=field(group,'ชื่อไฟล์ที่กำหนด (เว้นว่างได้)',rule.filename_pattern,{required:false,maxLength:255}), required=field(group,'ต้องส่งเอกสารนี้',rule.required??true,{type:'checkbox',required:false});
        const item={id:rule.id||`doc_${globalThis.crypto.randomUUID().replaceAll('-','')}`,title,format,filename,required}; inputs.push(item);
        const remove=el('button','shell-button shell-button--secondary','นำรายการนี้ออก');remove.type='button';remove.addEventListener('click',()=>{inputs=inputs.filter(x=>x!==item);group.remove();});group.append(remove);rows.append(group);
      }
      function current(){const s=data.scopes[Number(scope.value)];return data.policies.filter(p=>p.cycle_id===cycle.value && p.department===s.department && p.program===(s.program||'')).sort((a,b)=>b.version-a.version)[0];}
      function choose(){rows.replaceChildren();inputs=[];for(const rule of current()?.requirements||[])add(rule);}
      cycle.addEventListener('change',choose);scope.addEventListener('change',choose);choose();
      const addButton=el('button','shell-button shell-button--secondary','เพิ่มรายการเอกสาร');addButton.type='button';addButton.addEventListener('click',()=>add());form.append(addButton);
      const acknowledgement=field(form,'ยืนยันเผยแพร่ข้อกำหนดฉบับนี้ (ไม่มีรายการหมายถึงไม่บังคับแนบเอกสาร)',false,{type:'checkbox'});
      controls(form,'เผยแพร่ข้อกำหนดฉบับใหม่',async op=>{
        if(!acknowledgement.checked)return;
        const s=data.scopes[Number(scope.value)];
        await client.request('/api/v3/staff/document-policies',{method:'POST',signal,body:op({cycle_id:cycle.value,department:s.department,program:s.program||'',expected_version:current()?.version||0,
          requirements:inputs.map(x=>({id:x.id,title:x.title.value,format:x.format.value,filename_pattern:x.filename.value,required:x.required.checked}))})}).catch(error);await load('เผยแพร่ข้อกำหนดฉบับใหม่แล้ว');
      });requirements.append(form);
      const advisors=card('อาจารย์และจำนวนที่ดูแลพร้อมกัน','user');
      note(advisors,'สูงสุด 5 คนรวมทุกปี/เทอม จำนวนนี้เป็นข้อมูลปัจจุบัน ระบบตรวจช่วงเวลาทับซ้อนอีกครั้งก่อนบันทึก');
      note(advisors,'จำนวนดูแลนับรวมทุกขอบเขต แต่รายชื่อนักศึกษาด้านล่างจะแสดงเฉพาะขอบเขตที่คุณมีสิทธิ์');
      const grid=el('div','workflow-grid');for(const a of data.advisors){const item=el('article','workflow-document');item.append(el('h3',null,a.name),el('strong',a.active_count>=5?'workflow-capacity--full':'',`${a.active_count} / 5 คน`));grid.append(item);}advisors.append(grid);
      const roster=card('นักศึกษาและอาจารย์ที่ได้รับมอบหมาย','clipboard');
      note(roster,'เปิดแผนที่ผ่านเกณฑ์จาก “ค้นหาแผนสหกิจ” เพื่อมอบหมายหรือเปลี่ยนอาจารย์ ดูเฉพาะรายชื่อนักศึกษาในขอบเขตของคุณ');
      const advisorFilter=select(roster,'กรองนักศึกษาตามอาจารย์',[['','อาจารย์ทุกคน'],...data.advisors.map(a=>[a.id,a.name])]);advisorFilter.required=false;
      const list=el('div','workflow-stack');roster.append(list);let listSequence=0;
      async function rosterPage(page=1){
        const current=++listSequence;list.setAttribute('aria-busy','true');
        try{
          const params=new URLSearchParams({page:String(page),pageSize:'20',...(advisorFilter.value?{advisor_id:advisorFilter.value}:{})});
          const result=await client.request(`/api/v3/staff/assignments?${params}`,{signal});
          if(signal?.aborted||current!==listSequence||currentLoad!==loadSequence)return;
          const items=result.items||[];list.replaceChildren();
          if(!items.length)note(list,'ยังไม่มีนักศึกษาที่อยู่ระหว่างดูแลในขอบเขตนี้');
          for(const a of items){
        const item=el('article','workflow-document');item.append(el('h3',null,`${a.full_name} (${a.student_number})`));note(item,`อาจารย์: ${a.advisor_name} · ${a.status==='ACTIVE'&&new Date(a.effective_to)>new Date()?'อยู่ระหว่างดูแล':'สิ้นสุด/ยกเลิก/ยังไม่เริ่ม'} · ถึง ${new Date(a.effective_to).toLocaleDateString('th-TH')}`);
        if(a.plan_id){const link=el('a','advisor-link','เปิดแผนและการมอบหมาย');link.href=`#/staff/plans/${encodeURIComponent(a.plan_id)}`;item.append(link);}
        if(a.status==='ACTIVE'){const form=el('form','workflow-form'),reason=field(form,'เหตุผลยกเลิกการมอบหมาย','',{maxLength:2000});controls(form,'ยกเลิกการมอบหมายและคืนโควตา',async op=>{await client.request(`/api/v3/staff/assignments/${a.id}/revoke`,{method:'POST',signal,body:op({reason:reason.value,expected_version:a.version})}).catch(error);await load('ยกเลิกการมอบหมายและคืนโควตาแล้ว');},{danger:true});item.append(form);}
        list.append(item);
          }
          const paging=el('div','workflow-paging');
          for(const [label,target,disabled] of [['ก่อนหน้า',page-1,page<=1],['ถัดไป',page+1,page>=(result.pagination?.totalPages||1)]]){
            const button=el('button','shell-button shell-button--secondary',label);button.type='button';button.disabled=disabled;button.addEventListener('click',()=>rosterPage(target));paging.append(button);
          }
          note(paging,`หน้า ${page} · พบ ${result.pagination?.total||0} รายการในขอบเขตที่คุณอ่านได้`);list.append(paging);list.setAttribute('aria-busy','false');
        }catch(e){if(e.name!=='AbortError'&&!signal?.aborted&&current===listSequence&&currentLoad===loadSequence){list.replaceChildren(el('p','workflow-feedback',e.message));list.setAttribute('aria-busy','false');try{error(e);}catch{/* Scope feedback visible. */}}}
      }
      advisorFilter.addEventListener('change',()=>rosterPage(1));rosterPage();
      root.replaceChildren(requirements,advisors,roster);root.setAttribute('aria-busy','false');
      if(message){const feedback=el('p','workflow-feedback',message);feedback.setAttribute('role','status');root.prepend(feedback);}
    }catch(e){if(e.name!=='AbortError'&&!signal?.aborted&&currentLoad===loadSequence){root.replaceChildren(el('p','workflow-feedback',e.message));root.setAttribute('aria-busy','false');try{error(e);}catch{/* Error visible. */}}}
  }
  load();return root;
}
