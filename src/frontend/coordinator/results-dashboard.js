import {el,text,date,button,badge,table,note} from './components.js';
const OUTCOMES={SELECTED:'ผ่านการคัดเลือก',NOT_SELECTED:'ไม่ผ่านการคัดเลือก'};
const STATUS={PENDING:'รอกรรมการยืนยันผล',CONFIRMED:'กรรมการยืนยันผลแล้ว',INCOMPLETE:'ต้องตรวจสอบข้อมูลผลคัดเลือก',SCOPE_LIMITED:'ผลอยู่นอกขอบเขตที่ได้รับมอบหมาย'};
const PAGE_SIZE=10;
// This is a read-only view of server-confirmed results. Never infer a cutoff.
export function renderResultsDashboard({dashboard,meetings=[],onOpen,state=new Map()}){
  const root=el('section','coord-results-dashboard');root.setAttribute('aria-label','สรุปผลการคัดเลือก');
  root.append(el('h2','','สรุปผลการคัดเลือก'),el('p','coord-muted','ผลทั้งรอบที่เลือก ไม่เปลี่ยนตามตัวกรองรายชื่อที่ส่งต่อด้านล่าง'));
  if(!dashboard){root.append(note('ยังโหลดสรุปผลไม่ได้ กรุณาโหลดข้อมูลล่าสุด'));return root;}
  const metrics=el('dl','coord-result-metrics');
  for(const [key,label] of [['forwarded','ส่งให้กรรมการ'],['capacity','จำนวนรับที่ตกลงแล้ว'],['selected','ผ่านการคัดเลือก'],['not_selected','ไม่ผ่านการคัดเลือก']]){
    const cell=el('div'),value=dashboard[key];cell.append(el('dt','',label),el('dd','',text(value)),el('span','coord-muted',value===null?'ยังไม่ยืนยันครบทุกชุด':'รายการ'));metrics.append(cell);
  }
  root.append(metrics,note('ผลที่กรรมการยืนยันยังแยกจากการประกาศผลให้นักศึกษา หน้านี้อ่านอย่างเดียว'));
  if(!meetings.length){root.append(note('ยังไม่มีชุดกรรมการในรอบที่ได้รับมอบหมาย'));return root;}
  for(const meeting of meetings){
    const result=meeting.result,panel=el('section','coord-result-panel'),title=el('div','coord-section-heading');
    title.append(el('h3','',`${meeting.department} · ${meeting.cycle_name || ''}`));panel.append(title);root.append(panel);
    if(!result){panel.append(note('ยังไม่มีข้อมูลสรุปผล กรุณาโหลดข้อมูลล่าสุด'));continue;}
    title.append(badge(result.status==='CONFIRMED'?'FORWARDED':'PENDING',STATUS[result.status] || STATUS.INCOMPLETE));
    if(result.status==='SCOPE_LIMITED'){panel.append(note('ตรวจสอบการมอบหมายกับผู้ดูแลระบบก่อนดูผลของชุดกรรมการนี้'));continue;}
    if(result.capacity!==null)panel.append(el('p','coord-muted',`จำนวนรับตามข้อเสนอ ${result.capacity} รายการ · ${result.proposal_status==='accepted'?'ตกลงจำนวนรับแล้ว':result.proposal_status==='rejected'?'ส่งกลับปรับข้อเสนอ':'อยู่ระหว่างตกลงจำนวนรับ'}`));
    if(result.status!=='CONFIRMED'){
      panel.append(note(result.status==='INCOMPLETE'?'ข้อมูลรายชื่อหรือฉบับใบสมัครไม่ตรงกับผลที่ยืนยัน กรุณาให้ผู้รับผิดชอบตรวจสอบก่อนใช้ผล':'ยังไม่แสดงรายชื่อผ่าน/ไม่ผ่านจนกว่ากรรมการจะยืนยันผลครบ'));continue;
    }
    panel.append(el('p','coord-muted',`ยืนยันผลเมื่อ ${date(result.finalized_at,true)} · ผ่าน ${result.selected} / ไม่ผ่าน ${result.not_selected} รายการ`));
    const key=meeting.cohort_id || `${meeting.cycle_id}:${meeting.department}`,view=state.get(key)||{filter:'ALL',page:1};state.set(key,view);
    const filters=el('div','coord-status-filters'),records=el('div');filters.setAttribute('role','group');filters.setAttribute('aria-label','กรองผลคัดเลือก '+meeting.department);
    const choices=[['ALL','ทั้งหมด',result.applicants.length],['SELECTED',OUTCOMES.SELECTED,result.selected],['NOT_SELECTED',OUTCOMES.NOT_SELECTED,result.not_selected]];
    panel.append(filters,records);
    function draw(){
      filters.replaceChildren();for(const [value,label,count] of choices){const control=button(`${label} (${count})`,()=>{view.filter=value;view.page=1;draw();[...filters.children].find(b=>b.dataset.filter===value)?.focus();});
        control.className='coord-status-filter';control.dataset.filter=value;control.setAttribute('aria-pressed',String(view.filter===value));filters.append(control);}
      const rows=result.applicants.filter(a=>view.filter==='ALL'||a.outcome===view.filter),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));view.page=Math.min(view.page,pages);
      records.replaceChildren();if(!rows.length){records.append(note('ไม่มีรายชื่อในผลคัดเลือกที่เลือก'));return;}
      const t=table(['ลำดับ','นักศึกษา','หลักสูตร / ภาค','ผลคัดเลือก','ดำเนินการ'],'รายชื่อจากผลที่กรรมการยืนยัน ไม่ใช่ลำดับคะแนน');
      rows.slice((view.page-1)*PAGE_SIZE,view.page*PAGE_SIZE).forEach((row,index)=>{
        const tr=el('tr'),person=el('td');person.append(el('strong','',text(row.full_name)),el('small','coord-muted',text(row.student_number)));
        const program=row.program_type==='regular'?'ภาคปกติ':row.program_type==='special'?'ภาคพิเศษ':'รอยืนยันภาค';
        const outcome=el('td');outcome.append(badge(row.outcome==='SELECTED'?'FORWARDED':'RETURNED',OUTCOMES[row.outcome]));
        const action=el('td');if(row.source==='PHASE1')action.append(button('ดูใบสมัคร',()=>onOpen?.(row.id),{icon:'file'}));else action.append(el('span','coord-muted','แผนเดิม'));
        const cells=[el('td','coord-numeric',(view.page-1)*PAGE_SIZE+index+1),person,el('td','',`หลักสูตร ${text(row.curriculum)} · ${program}`),outcome,action];
        cells.forEach((cell,i)=>cell.dataset.label=['ลำดับ','นักศึกษา','หลักสูตร / ภาค','ผลคัดเลือก','ดำเนินการ'][i]);tr.append(...cells);t.body.append(tr);
      });records.append(t.table);
      const pagination=el('nav','coord-pagination');pagination.setAttribute('aria-label','หน้าผลคัดเลือก '+meeting.department);
      const change=delta=>{view.page+=delta;draw();records.querySelector('.coord-pagination-summary')?.focus();};
      const prev=button('ก่อนหน้า',()=>change(-1)),next=button('ถัดไป',()=>change(1)),summary=el('span','coord-pagination-summary',`หน้า ${view.page} / ${pages} · ${rows.length} รายการ`);summary.tabIndex=-1;
      prev.disabled=view.page===1;next.disabled=view.page===pages;pagination.append(summary,prev,next);records.append(pagination);
    }draw();
  }
  return root;
}
