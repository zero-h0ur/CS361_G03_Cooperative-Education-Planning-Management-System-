import {renderApplicationEditor} from './application-editor-view.js';
import {studentElement as node,renderStudentPageHeader,formatStudentDate} from './workspace-components.js';
import {applicationCycleLabel,applicationEditState,latestApplication,renderApplicationFeature} from './application-presentation.js';
import {createWorkspaceIcon} from '../ui/workspace-presentation.js';
export {node};
export function button(text,action,secondary=false) {
  const b=node('button',`shell-button${secondary?' shell-button--secondary':''}`,text);
  b.type='button';b.addEventListener('click',action);return b;
}
export function renderApplicationWorkspace({client,applicationId,signal,onNavigate,onSessionExpired,setLeaveGuard}={}) {
  const root=node('div','application-workspace student-applications');root.dataset.studentPage='true';
  let busy=false,createAttempt;
  const pageHeader=()=>renderStudentPageHeader({title:'ใบสมัครทั้งหมด',description:'กรอกต่อใบสมัครเดิม หรือเปิดดูใบสมัครที่ส่งแล้ว'});
  function expired(error) {
    if(error?.code==='SESSION_EXPIRED') {root.replaceChildren();onSessionExpired?.();return true;}
    return false;
  }
  function cyclePicker(options,list) {
    const picker=node('details','student-cycle-picker');
    const summary=node('summary','shell-button shell-button--secondary','เลือกรอบสมัครใหม่');
    summary.prepend(createWorkspaceIcon('plus'));picker.append(summary);
    const panel=node('div','student-cycle-picker__panel');panel.append(node('h3','','เริ่มใบสมัครในรอบใหม่'));
    const label=node('label','','รอบรับสมัคร'),select=node('select','application-input');
    select.id='application-cycle';label.htmlFor=select.id;select.append(new Option('เลือกรอบรับสมัคร',''));
    for(const cycle of options.cycles.filter(c=>c.status==='OPEN'&&!list.some(a=>a.cycle_id===c.id))) {
      const unavailable=cycle.opens_at&&Date.now()<Date.parse(cycle.opens_at)||cycle.closes_at&&Date.now()>=Date.parse(cycle.closes_at);
      const option=new Option(cycle.name+(unavailable?' · ไม่อยู่ในช่วงรับสมัคร':''),cycle.id);
      option.disabled=Boolean(unavailable);select.append(option);
    }
    const message=node('p','student-record-description');message.setAttribute('role','status');
    const start=button('สร้างฉบับร่าง',async()=>{
      if(!select.value){message.textContent='กรุณาเลือกรอบรับสมัคร';select.focus();return;}
      if(!createAttempt||createAttempt.cycle_id!==select.value)createAttempt={cycle_id:select.value,operation_id:crypto.randomUUID()};
      start.disabled=true;select.disabled=true;message.textContent='กำลังสร้างฉบับร่าง…';
      try {const result=await client.create(createAttempt,{signal});if(!signal?.aborted)onNavigate?.(`#/student/application/${result.id}`);}
      catch(e){if(!signal?.aborted&&!expired(e)&&e.name!=='AbortError')message.textContent=e.message||'สร้างไม่สำเร็จ กรุณาลองอีกครั้ง';}
      finally{start.disabled=!available;select.disabled=false;}
    });
    const available=Array.from(select.options).some(o=>o.value&&!o.disabled);
    if(!available){message.textContent='ยังไม่มีรอบใหม่ที่เปิดรับสมัคร หรือคุณมีใบสมัครในรอบนั้นแล้ว';start.disabled=true;}
    panel.append(label,select,node('p','student-record-description','หนึ่งใบสมัครต่อคนต่อรอบ ข้อมูลและไฟล์ไม่ปะปนข้ามรอบ'),message,start);
    picker.append(panel);return picker;
  }
  function applicationTable(list,cycles) {
    const section=node('section','student-application-history');
    section.append(node('h2','student-section-title',`${list.some(a=>a.status==='DRAFT')?'ใบสมัครอื่น':'ใบสมัครก่อนหน้า'} · ${list.length} รายการ`));
    const table=node('table','student-application-table');table.append(node('caption','shell-sr-only','รายการใบสมัครอื่นและการทำรายการ'));
    const head=node('thead'),header=node('tr');
    for(const name of ['รอบสมัคร','สถานะ','ทำรายการ']){const th=node('th','',name);th.scope='col';header.append(th);}head.append(header);table.append(head);
    const body=node('tbody');
    for(const app of list) {
      const row=node('tr'),cycle=node('td'),status=node('td'),action=node('td'),correction=app.status==='NEEDS_REVISION',draft=app.status==='DRAFT'||correction;
      const editable=applicationEditState(app,cycles),label=draft?(editable===true?'กรอกต่อ':editable===false?'ดูฉบับร่าง':'เปิดใบสมัคร'):'ดูใบสมัคร';
      cycle.dataset.label='รอบสมัคร';status.dataset.label='สถานะ';action.dataset.label='ทำรายการ';
      cycle.append(node('h3','',applicationCycleLabel(app,cycles)));
      const date=formatStudentDate(draft?app.updated_at:app.submitted_at);
      if(date)cycle.append(node('p','student-record-description',`${draft?'แก้ไขล่าสุด':'ส่งเมื่อ'} ${date}`));
      status.append(node('span',`student-status-badge${draft?' student-status-badge--draft':''}`,correction?'ส่งกลับแก้ไข':draft?'ยังไม่ได้ส่ง':'ส่งแล้ว'),
        node('p','student-record-description',draft?(editable===true?'แก้ไขข้อมูลและเอกสารได้':editable===false?'รอบปิด · อ่านอย่างเดียว':'ตรวจสอบช่วงรับสมัครในใบสมัคร'):'เปิดดูฉบับที่ส่ง'));
      const open=button(label,()=>onNavigate?.(`#/student/application/${app.id}`),true);
      open.setAttribute('aria-label',`${label} ${applicationCycleLabel(app,cycles)}`);
      open.append(createWorkspaceIcon('arrow'));action.append(open);row.append(cycle,status,action);body.append(row);
    }
    table.append(body);section.append(table);return section;
  }
  async function load() {
    if(busy||signal?.aborted)return;busy=true;root.setAttribute('aria-busy','true');
    const loading=node('p','student-page-content','กำลังโหลดใบสมัคร…');loading.setAttribute('role','status');
    root.replaceChildren(...(applicationId?[]:[pageHeader()]),loading);
    try {
      if(applicationId) {
        const app=await client.get(applicationId,{signal});if(signal?.aborted)return;
        root.replaceChildren(renderApplicationEditor({client,application:app,signal,onSessionExpired,setLeaveGuard,
          onBack:()=>onNavigate?.('#/student/application')}));return;
      }
      const [optionResult,listResult]=await Promise.allSettled([client.options({signal}),client.list({signal})]);
      if(signal?.aborted)return;
      for(const result of [optionResult,listResult])if(result.status==='rejected'&&expired(result.reason))return;
      if(listResult.status==='rejected')throw listResult.reason;
      const options=optionResult.status==='fulfilled'?optionResult.value:null,list=listResult.value;
      const content=node('div','student-page-content'),toolbar=node('div','student-list-toolbar');
      toolbar.append(node('h2','student-section-title',`ใบสมัครของคุณ · ${list.length} รายการ`));
      if(options)toolbar.append(cyclePicker(options,list));content.append(toolbar);
      if(!options)content.append(node('p','application-warning','โหลดข้อมูลรอบสมัครไม่สำเร็จ แต่ยังเปิดใบสมัครเดิมได้'),button('ลองโหลดรอบสมัครอีกครั้ง',load,true));
      if(!list.length) {
        const empty=node('section','student-empty-state');empty.append(createWorkspaceIcon('document'),node('h3','','ยังไม่มีใบสมัคร'),
          node('p','','เริ่มจาก “เลือกรอบสมัครใหม่” ด้านบน แล้วบันทึกข้อมูลทีละส่วนได้'));content.append(empty);
      } else {
        const latest=latestApplication(list,options?.cycles);content.append(renderApplicationFeature(latest,{cycles:options?.cycles,onNavigate}));
        const others=list.filter(app=>app.id!==latest.id);if(others.length)content.append(applicationTable(others,options?.cycles));
        const note=node('p','student-list-note','ใบสมัครที่ส่งแล้วเปิดดูได้ แต่แก้ไขไม่ได้');note.prepend(createWorkspaceIcon('lock'));content.append(note);
      }
      root.replaceChildren(pageHeader(),content);
    } catch(e) {
      if(signal?.aborted||e.name==='AbortError'||expired(e))return;
      const error=node('div','student-page-content');error.append(node('p','application-error',e.message||'โหลดใบสมัครไม่สำเร็จ'),button('ลองโหลดอีกครั้ง',load,true));
      root.replaceChildren(pageHeader(),error);
    } finally{busy=false;root.setAttribute('aria-busy','false');}
  }
  load();return root;
}
