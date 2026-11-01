const LABELS=Object.freeze({
  AWAITING_COORDINATOR:'รอผู้ประสานงานรับเรื่อง',
  UNDER_COMMITTEE_REVIEW:'ได้รับแผนแล้ว อยู่ระหว่างการคัดเลือก',
  SELECTION_COMPLETE_PENDING_ANNOUNCEMENT:'ครบสามความเห็นแล้ว รอประกาศผล'
});
function el(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
export function renderSelectionWorkspace({client,role,signal,onSessionExpired,onAccessDenied}={}){
  const root=el('section','workflow-stack selection-workspace'),intro=el('section','workflow-card');
  const coordinator=role==='COORDINATOR';
  if(!coordinator&&role!=='COMMITTEE'){
    root.append(el('p',null,'ไม่มีสิทธิ์เปิดพื้นที่นี้'));return root;
  }
  intro.append(el('h2',null,coordinator?'รับเรื่องและส่งต่อกรรมการ':'บันทึกความเห็นแยกรายบุคคล'),
    el('p','shell-muted','กรรมการสามคนต้องบันทึกความเห็นแยกกันต่อผู้สมัครแต่ละคน ครบสามความเห็นไม่ใช่ผลผ่าน/ไม่ผ่าน และระบบยังไม่ประกาศผล'),
    el('p','shell-muted','ยังไม่มีข้อมูลเกรด GPAX/7 วิชาในระบบส่วนนี้ จึงยังไม่จัดอันดับหรือสร้างคะแนนสมมติ'));
  const feedback=el('p','workflow-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const filter=el('form','workflow-form selection-filters');filter.setAttribute('aria-label','กรองผู้สมัครในขอบเขตที่ได้รับมอบหมาย');
  const department=el('select'),program=el('select');
  function selectField(title,input){const label=el('label',null,title);label.append(input);filter.append(label);}
  selectField('ภาควิชา',department);selectField('หลักสูตร',program);
  const apply=el('button','shell-button','กรองรายการ');apply.type='submit';filter.append(apply);
  const content=el('div','workflow-stack selection-applications'),pager=el('div','shell-actions');
  const previous=el('button','shell-button shell-button--secondary','หน้าก่อน'),next=el('button','shell-button shell-button--secondary','หน้าถัดไป');
  previous.type=next.type='button';pager.append(previous,next);root.append(intro,filter,feedback,content,pager);
  let page=1,generation=0,filtersReady=false;
  const pending=new Map(),base=`/api/v3/${coordinator?'coordinator':'committee'}`;
  function options(select,values){
    select.append(el('option',null,'ทั้งหมด'));select.firstChild.value='';
    for(const value of [...new Set(values)].sort()){const option=el('option',null,value);option.value=value;select.append(option);}
  }
  function failure(error){
    if(signal?.aborted||error.name==='AbortError')return;
    if([401,403].includes(error.status))content.replaceChildren();
    feedback.textContent=error.status===409?'ข้อมูลเปลี่ยนหรือบันทึกไปแล้ว กรุณาโหลดรายการใหม่':
      error.status===422?'สถานะแผนหรือคณะกรรมการเปลี่ยนแล้ว กรุณาติดต่อผู้ประสานงาน':
      'ทำรายการไม่สำเร็จ กรุณาลองใหม่ โดยใช้ข้อมูลเดิม';
    if(error.status===401)onSessionExpired?.();if(error.status===403)onAccessDenied?.('ไม่มีสิทธิ์หรือถูกถอนการมอบหมายแล้ว');
  }
  async function send(row,body,button){
    if(signal?.aborted)return;button.disabled=true;
    const signature=JSON.stringify(body),old=pending.get(row.plan_id);
    const command=old?.signature===signature?old.command:{operation_id:globalThis.crypto.randomUUID(),expected_version:row.plan_version,...body};
    pending.set(row.plan_id,{signature,command});feedback.textContent='กำลังบันทึก…';
    try{
      await client.request(`${base}/plans/${row.plan_id}/${coordinator?'acknowledge':'opinion'}`,{method:'POST',body:command,signal});
      pending.delete(row.plan_id);if(signal?.aborted)return;
      await refresh('บันทึกเรียบร้อยแล้ว — ยังไม่ใช่การประกาศผล');
    }catch(error){failure(error);}
    finally{if(!signal?.aborted)button.disabled=false;}
  }
  function card(row){
    const box=el('section','workflow-card');
    box.append(el('h3',null,`${row.student_number} · ${row.full_name}`),
      el('p','shell-muted',`${row.department} / ${row.program} · ${row.cycle_name}`),
      el('p',null,LABELS[row.state]||'สถานะไม่พร้อม กรุณารีเฟรช'),
      el('p',null,`บันทึกความเห็นแล้ว ${row.opinion_count} / 3 คน`));
    if(coordinator&&row.state==='AWAITING_COORDINATOR'){
      const button=el('button','shell-button','ยืนยันรับแผนและส่งต่อกรรมการ');button.type='button';
      button.addEventListener('click',()=>send(row,{},button));box.append(button);
    }
    if(!coordinator&&row.own_opinion){
      box.append(el('p',null,`ความเห็นของคุณ: ${row.own_opinion.selected?'เห็นควรเลือก':'ไม่เลือก'}`),
        el('p',null,row.own_opinion.comment),el('p','shell-muted','บันทึกแล้ว ไม่แก้ไขทับประวัติเดิม'));
    }else if(!coordinator&&row.state==='UNDER_COMMITTEE_REVIEW'){
      const form=el('form','workflow-form selection-opinion-form');form.setAttribute('aria-label',`ความเห็นของคุณสำหรับ ${row.student_number}`);
      const choice=el('select');choice.required=true;
      for(const [value,label] of [['','เลือกความเห็นของคุณ'],['yes','เห็นควรเลือก'],['no','ไม่เลือก']]){
        const option=el('option',null,label);option.value=value;choice.append(option);
      }
      const choiceLabel=el('label',null,'ความเห็นรายบุคคล');choiceLabel.append(choice);
      const comment=el('textarea');comment.required=true;comment.maxLength=2000;comment.rows=3;
      const commentLabel=el('label',null,'เหตุผล / ความเห็น (ไม่เกิน 2,000 ตัวอักษร)');commentLabel.append(comment);
      const button=el('button','shell-button','ยืนยันบันทึกความเห็น');button.type='submit';
      form.append(choiceLabel,commentLabel,el('p','shell-muted','ส่งแล้วจะไม่แก้ไขทับความเห็นเดิม โปรดตรวจสอบก่อนยืนยัน'),button);
      form.addEventListener('submit',event=>{
        event.preventDefault();if(!['yes','no'].includes(choice.value)||!comment.value.trim())return;
        void send(row,{selected:choice.value==='yes',comment:comment.value.trim()},button);
      });box.append(form);
    }
    return box;
  }
  async function refresh(message=''){
    const current=++generation;content.setAttribute('aria-busy','true');feedback.textContent='กำลังโหลด…';
    const query=new URLSearchParams({page:String(page),pageSize:'25'});
    if(filtersReady&&department.value)query.set('department',department.value);
    if(filtersReady&&program.value)query.set('program',program.value);
    try{
      const data=await client.request(`${base}/applications?${query}`,{signal});
      if(signal?.aborted||current!==generation)return;
      if(!filtersReady){options(department,data.cohorts.map(x=>x.department));options(program,data.cohorts.map(x=>x.program));filtersReady=true;}
      content.replaceChildren();
      if(!data.applications.length)content.append(el('p','shell-muted',data.cohorts.length?'ยังไม่มีแผนในขอบเขตนี้':'ยังไม่ได้รับมอบหมายรอบ/หลักสูตร กรุณาติดต่อผู้ดูแลระบบ'));
      for(const row of data.applications)content.append(card(row));
      previous.disabled=page===1;next.disabled=!data.has_more;feedback.textContent=message;
    }catch(error){if(current===generation)failure(error);}
    finally{if(current===generation)content.setAttribute('aria-busy','false');}
  }
  filter.addEventListener('submit',event=>{event.preventDefault();page=1;void refresh();});
  previous.addEventListener('click',()=>{if(page>1){page--;void refresh();}});
  next.addEventListener('click',()=>{page++;void refresh();});
  void refresh();return root;
}
export function renderStudentSelectionStatus({client,signal,onSessionExpired,onAccessDenied}={}){
  const root=el('section','workflow-card');root.setAttribute('aria-busy','true');
  root.append(el('p',null,'กำลังโหลดสถานะ…'));
  void client.request('/api/v3/student/selection',{signal}).then(data=>{
    if(signal?.aborted)return;root.replaceChildren();
    root.append(el('h2',null,'สถานะการคัดเลือกของคุณ'),el('p','shell-muted','ครบสามความเห็นไม่ใช่ผลผ่าน/ไม่ผ่าน ระบบยังรอประกาศผล'));
    if(!data.applications.length)root.append(el('p',null,'ยังไม่มีแผนที่ส่งเข้ารอบการคัดเลือกนี้'));
    for(const row of data.applications){const card=el('section','workflow-card');card.append(el('h3',null,row.cycle_name),
      el('p',null,LABELS[row.state]||'ยังไม่พร้อม'),el('p',null,`บันทึกความเห็นแล้ว ${row.opinion_count} / 3 คน`));root.append(card);}
  }).catch(error=>{
    if(signal?.aborted||error.name==='AbortError')return;root.replaceChildren(el('p',null,'โหลดสถานะไม่สำเร็จ กรุณารีเฟรช'));
    if(error.status===401)onSessionExpired?.();if(error.status===403)onAccessDenied?.('ไม่มีสิทธิ์ดูข้อมูลนี้');
  }).finally(()=>{if(!signal?.aborted)root.setAttribute('aria-busy','false');});
  return root;
}
