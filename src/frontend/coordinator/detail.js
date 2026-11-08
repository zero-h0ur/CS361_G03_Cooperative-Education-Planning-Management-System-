import {renderAcademicReview} from './academic-review.js';
import form from '../../shared/application-form.js';
import {createWorkspaceIcon} from '../ui/workspace-presentation.js';
import {el,text,score,date,button,badge,rows,table,note,dialog} from './components.js';
const {GROUPS,EXTRAS,GRADES,POSITIONS}=form;
export const TABS=[['summary','สรุปใบสมัคร'],['grades','ผลการเรียน'],['documents','เอกสารแนบ'],['skills','งานและทักษะ'],['declarations','คุณสมบัติ 7 ข้อ']];
const documentKinds=[['resume','Resume / CV'],['transcript','Transcript'],['photo','รูปถ่ายนักศึกษา'],['conduct','ใบรับรองความประพฤติ']];
const grade=value=>value===null || value===undefined || value===''?'—':GRADES.find(([p])=>Number(p)===Number(value))?.[1] || text(value);

export function summaryPanel(record) {
  const {official:o={},payload:p={}}=record,root=el('div','coord-summary');
  root.append(rows('ข้อมูลนักศึกษา',[
    ['ชื่อ–นามสกุล ภาษาไทย',o.full_name || p.thai_full_name],['ชื่อ–นามสกุล ภาษาอังกฤษ',o.english_full_name || p.english_full_name],
    ['คณะ',o.institution==='TU_CS'?'วิทยาศาสตร์และเทคโนโลยี · มหาวิทยาลัยธรรมศาสตร์':o.faculty],
    ['สาขาวิชา',o.department],['หลักสูตร / กลุ่มวิชาเอก',[record.curriculum?'หลักสูตร '+record.curriculum:null,p.major_group].filter(Boolean).join(' / ')],['ปีที่เข้าศึกษา',o.entry_year]]));
  const contact=el('div');contact.append(rows('ข้อมูลการติดต่อ',[
    ['อีเมลมหาวิทยาลัย',o.institutional_email || p.institutional_email],['อีเมลที่ติดต่อได้',p.contact_email],['เบอร์โทรศัพท์',p.contact_phone],['ที่อยู่ที่ติดต่อได้',p.contact_address]]),
    rows('ผู้ปกครอง / ผู้ติดต่อฉุกเฉิน',[['ชื่อผู้ติดต่อ',p.guardian_name],['ความสัมพันธ์',p.guardian_relationship],['เบอร์โทรศัพท์',p.guardian_phone],['ที่อยู่ผู้ปกครอง',p.guardian_address]]));root.append(contact);return root;
}
export function gradesPanel(record,{all=false,onAll}={}) {
  const {payload:p={}}=record,root=el('div'),heading=el('div','coord-section-heading');
  const intro=el('div');intro.append(el('h3','','ผลการเรียนประกอบการสมัคร'),el('p','coord-muted',`ข้อมูลที่นักศึกษาแจ้ง · GPAX ถึง ${text(p.gpax_reporting_term)}`));heading.append(intro);
  if(onAll)heading.append(button('ดูผลการเรียนทั้งหมด',onAll,{icon:'file'}));root.append(heading);
  const metrics=el('div','coord-grades-summary');
  for(const [label,value] of [['GPAX ก่อนสมัคร',record.gpax],['ค่าเฉลี่ยกลุ่มวิชา (คำนวณ)',record.core]]){const item=el('div');item.append(el('span','',label),el('strong','',score(value)));metrics.append(item);}root.append(metrics);
  root.append(el('p','coord-muted',`ค่าเฉลี่ยกลุ่มวิชาที่นักศึกษาแจ้ง: ${score(record.declared_core)} · เกรดและค่าเฉลี่ยยังต้องตรวจเทียบ Transcript`));
  if(all) {
    root.append(el('h3','','รายวิชาหลักตามหลักสูตร'));
    const core=table(['รายวิชา','ครั้งที่เรียน','เกรด'],'ผลการเรียนรายวิชาหลักที่นักศึกษาระบุ');
    for(const group of GROUPS[record.curriculum] || []){
      const code=group.length>1?p.selected_courses?.alternative:group[0],attempts=(p.course_attempts || []).filter(a=>a.code===code);
      for(const a of attempts.length?attempts:[{attempt:null,points:null}]){const tr=el('tr');tr.append(el('td','',code?.replace('CS','คพ.') || group.map(x=>x.replace('CS','คพ.')).join(' / ')),el('td','',text(a.attempt)),el('td','',grade(a.points)));core.body.append(tr);}
    }root.append(core.table);
  }
  root.append(el('h3','','รายวิชาที่เกี่ยวข้องกับคุณสมบัติ'));
  const columns=['รายวิชา','ภาคการศึกษา','สถานะการเรียน','เกรด'];
  const courses=table(columns,'สถานะรายวิชาเพิ่มเติมตามใบสมัคร');
  for(const code of [...(EXTRAS[record.curriculum] || []),record.curriculum==='61'?'CS302':'CS301']){
    const state=p.additional_studies?.[code],labels={ENROLLED:'กำลังศึกษา',STUDIED:'เรียนแล้ว',NOT_STUDIED:'ยังไม่เรียน'},tr=el('tr');
    // The submitted form does not capture a semester per course. Never copy the
    // GPAX reporting semester here or choose an arbitrary grade from retakes.
    const attempts=(p.course_attempts || []).filter(a=>a.code===code);
    const cells=[el('td','',code.replace('CS','คพ.')),el('td','coord-numeric','—'),
      el('td',`coord-course-status${labels[state]?' coord-course-status--'+state.toLowerCase():''}`,labels[state] || 'ไม่ระบุในใบสมัคร'),
      el('td','coord-numeric',state==='STUDIED' && attempts.length===1?grade(attempts[0].points):'—')];
    cells.forEach((cell,i)=>cell.dataset.label=columns[i]);tr.append(...cells);courses.body.append(tr);
  }root.append(courses.table,el('p','coord-muted','— หมายถึงไม่มีข้อมูลในฉบับที่ส่ง หรือยังระบุผลการเรียนไม่ได้ กรุณาตรวจเทียบ Transcript'),note(`${record.curriculum==='61'?'คพ.302':'คพ.301'} ต้องผ่านก่อนออกปฏิบัติงานจริง ไม่จำเป็นต้องผ่านแล้วตอนสมัคร`));return root;
}
export function documentsPanel(record,onDownload) {
  const root=el('div'),heading=el('div','coord-section-heading'),intro=el('div');intro.append(el('h3','','เอกสารประกอบการสมัคร'),el('p','coord-muted','เปิดเอกสารแต่ละรายการเพื่อตรวจสอบ'));
  const count=documentKinds.filter(([kind])=>(record.documents || []).some(d=>d.kind===kind)).length;heading.append(intro,el('p','',`แนบแล้ว ${count} จาก 4 รายการ`));root.append(heading);
  const docs=table(['เอกสาร','ไฟล์แนบ','สถานะ','ดำเนินการ'],'เอกสารในฉบับที่นักศึกษาส่ง');
  for(const [kind,title] of documentKinds){const doc=(record.documents || []).find(d=>d.kind===kind),tr=el('tr');
    const name=el('td','',title),meta=el('td'),status=el('td'),action=el('td');meta.append(el('strong','',doc?.filename || '—'));
    if(doc)meta.append(el('small','coord-muted',`${doc.content_type || ''}${doc.byte_size?' · '+Math.ceil(doc.byte_size/1024)+' KB':''}`));
    status.append(badge(doc?'FORWARDED':'RETURNED',doc?'แนบแล้ว':'ยังไม่แนบ'));
    const actions=el('div','coord-document-actions');
    for(const [label,download] of [['เปิดดู',false],['ดาวน์โหลด',true]]){const control=button(label,()=>onDownload?.(doc,{download}),{icon:'file'});
      control.disabled=!doc || !onDownload || record.access?.can_download===false;control.setAttribute('aria-label',`${label} ${title}`);actions.append(control);}action.append(actions);
    [name,meta,status,action].forEach((td,i)=>td.dataset.label=['เอกสาร','ไฟล์แนบ','สถานะ','ดำเนินการ'][i]);tr.append(name,meta,status,action);docs.body.append(tr);
  }root.append(docs.table,note(record.access?.can_download===false?'ช่วงทดลองนี้ยังไม่เปิดดาวน์โหลดเอกสาร':'แนบไฟล์ครบ ไม่ได้หมายถึงเอกสารผ่านการตรวจสอบ'));return root;
}
export function skillsPanel(record) {
  const p=record.payload || {},root=el('div','coord-skills'),positions=el('section');positions.append(el('h3','','งานและทักษะของนักศึกษา'),el('p','coord-muted','ข้อมูลที่นักศึกษาระบุในใบสมัคร'),el('h3','','ตำแหน่งงานที่สนใจ'));
  const list=el('ul','coord-position-list');
  const names=(p.interested_position_codes || []).map(code=>code==='OTHER'?p.interested_position_other:POSITIONS.find(([id])=>id===code)?.[1] || code);
  for(const title of names.length?names:p.interested_positions || [])list.append(el('li','',title));
  if(!list.children.length)positions.append(el('p','','ไม่ระบุตำแหน่งในฉบับนี้'));else positions.append(list);
  const skills=el('section');skills.append(el('h3','','ทักษะและความถนัด'),el('p','coord-muted','คำตอบตามที่นักศึกษาระบุ'),el('div','coord-free-text',Object.hasOwn(p,'skills_detail')?p.skills_detail:(p.skills || []).join('\n')));
  root.append(positions,skills,note('แสดงคำตอบตามต้นฉบับ ไม่จัดหมวดหมู่หรือประเมินทักษะอัตโนมัติ'));return root;
}
export function declarationsPanel(record) {
  const is61=record.curriculum==='61',labels=[
    ['program','ข้าพเจ้าเป็นนักศึกษาสาขาวิชาวิทยาการคอมพิวเตอร์ คณะวิทยาศาสตร์และเทคโนโลยี มหาวิทยาลัยธรรมศาสตร์'],
    ['required_courses',`ข้าพเจ้าเคยศึกษารายวิชาตามเกณฑ์หลักสูตร ${is61?'61':'66'} และค่าเฉลี่ยกลุ่มวิชาไม่ต่ำกว่า 2.50`],
    ['additional_courses',`ข้าพเจ้ากำลังศึกษาหรือเคยศึกษา ${is61?'คพ.384 และอย่างน้อยหนึ่งวิชา คพ.266 / 322 / 348':'คพ.180 และอย่างน้อยหนึ่งวิชา คพ.262 / 331 / 240'}`],
    ['preplacement',`ข้าพเจ้ารับทราบว่าต้องสอบผ่าน ${is61?'คพ.302':'คพ.301'} ก่อนออกปฏิบัติงานจริง (ไม่ต้องผ่านแล้วตอนสมัคร)`],
    ['gpax','ข้าพเจ้ามี GPAX เมื่อสิ้นภาคการศึกษาสุดท้ายก่อนสมัครไม่ต่ำกว่า 2.75'],
    ['conduct','ข้าพเจ้ามีความประพฤติเรียบร้อย และไม่เคยถูกลงโทษทางวินัยนักศึกษา'],
    ['terms','ข้าพเจ้ารับทราบเกณฑ์และยอมรับว่าจะปฏิบัติตามเงื่อนไขและกระบวนการสหกิจศึกษาอย่างครบถ้วน']];
  const root=el('div'),header=el('div','coord-section-heading'),intro=el('div');intro.append(el('h3','','คำรับรองคุณสมบัติ 7 ข้อ'),el('p','coord-muted','แสดงคำตอบที่นักศึกษารับรองไว้ในใบสมัคร'));header.append(intro,badge('READONLY','อ่านอย่างเดียว'));root.append(header);
  const answers=record.payload?.acknowledgements || {};root.append(el('p','coord-declaration-count',`นักศึกษารับรอง ${labels.filter(([key])=>answers[key]===true).length} จาก 7 ข้อ`));
  const list=el('ol','coord-declarations');for(const [key,label] of labels){const item=el('li'),l=el('label'),check=el('input','shell-sr-only');check.type='checkbox';check.checked=answers[key]===true;check.disabled=true;
    const marker=el('span','coord-declaration-marker');marker.setAttribute('aria-hidden','true');marker.append(createWorkspaceIcon('check'));
    l.append(check,marker,el('span','coord-declaration-text',label));if(!check.checked)l.append(el('small','coord-muted','ไม่ได้รับรองในฉบับนี้'));item.append(l);list.append(item);}root.append(list,note('เครื่องหมายถูกเป็นคำรับรองของนักศึกษา ไม่ใช่ผลตรวจอัตโนมัติหรือผลคัดเลือก'));return root;
}
export function renderDetail(record,{activeTab='summary',onTab,onReturn,onForward,onConfirmAcademics,onAcademicDirty,onDownload,host,signal,full=false}={}) {
  const root=el('article','coord-detail'),header=el('header','coord-detail-header'),title=el('div');
  title.append(el('p','coord-muted',`${record.cycle_name || 'รอบรับสมัคร'} · ใบสมัครฉบับที่ส่ง v${record.submitted_version}`),el('h2','',`${text(record.student_number)} · ${text(record.full_name)}`),
    el('p','',`${text(record.official?.department)} / หลักสูตร ${text(record.curriculum)} / ${text(record.major_group)}`),badge(record.state));
  header.append(title);if(!full)header.append(button('เปิดใบสมัครเต็ม',()=>{
    const body=el('div','coord-full-application');for(const panel of [summaryPanel(record),gradesPanel(record,{all:true}),documentsPanel(record,onDownload),skillsPanel(record),declarationsPanel(record)])body.append(panel);
    body.prepend(note('ฉบับที่ส่งเมื่อ '+date(record.submitted_at,true)+' · ไม่แสดงการแก้ไขที่ยังไม่ได้ส่ง'));dialog(host,'ใบสมัครฉบับที่ส่ง',body,{signal});
  },{icon:'file'}));root.append(header);
  if(record.reason)root.append(note('ส่งกลับแก้ไข: '+record.reason));
  if(record.academic_source==='STUDENT_DECLARED')root.append(note('หลักสูตร กลุ่มวิชา และผลการเรียนเป็นข้อมูลที่นักศึกษาแจ้ง · รอตรวจหลักฐาน ไม่ใช่ข้อมูลการศึกษาที่ TU ยืนยัน'));
  if(record.assessment?.review_required)root.append(note('ผลตรวจคุณสมบัติ: ผลในใบสมัครต้นฉบับยังรอตรวจสอบ · ผลรับรองของ Coordinator จะแสดงแยกจากต้นฉบับ'));
  const tablist=el('div','coord-tabs');tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','รายละเอียดใบสมัคร');
  const panels=el('div','coord-panels'),prefix='coord-'+crypto.randomUUID();
  const content={summary:()=>summaryPanel(record),grades:()=>gradesPanel(record,{onAll:()=>dialog(host,'ผลการเรียนทั้งหมด',gradesPanel(record,{all:true}),{signal})}),
    documents:()=>documentsPanel(record,onDownload),skills:()=>skillsPanel(record),declarations:()=>declarationsPanel(record)};
  const activate=(key,focus=false)=>{
    activeTab=key;for(const b of tablist.children){const selected=b.dataset.tab===key;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;if(selected&&focus)b.focus();}
    for(const panel of panels.children)panel.hidden=panel.dataset.panel!==key;onTab?.(key);
  };
  for(const [key,label] of TABS){const b=button(label,()=>activate(key));b.className='coord-tab';b.dataset.tab=key;b.setAttribute('role','tab');b.id=prefix+'-'+key;b.setAttribute('aria-controls',b.id+'-panel');
    if(key==='documents')b.append(el('span','coord-tab-count',String((record.documents || []).filter(d=>documentKinds.some(([k])=>k===d.kind)).length)));
    b.addEventListener('keydown',event=>{let index=TABS.findIndex(([id])=>id===activeTab);if(event.key==='ArrowRight')index=(index+1)%TABS.length;else if(event.key==='ArrowLeft')index=(index+TABS.length-1)%TABS.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=TABS.length-1;else return;event.preventDefault();activate(TABS[index][0],true);});
    tablist.append(b);const panel=el('section','coord-tab-panel');panel.id=b.id+'-panel';panel.dataset.panel=key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);panel.tabIndex=0;panel.append(content[key]());panels.append(panel);
  }activate(activeTab);root.append(tablist,panels);
  if(record.academic_review)root.append(renderAcademicReview(record,{onConfirm:onConfirmAcademics,onDirty:onAcademicDirty,signal}));
  const footer=el('footer','coord-detail-actions');
  if(record.can_review && onReturn && onForward){const forward=button('รับเรื่องและส่งต่อกรรมการ',onForward,{primary:true,icon:'arrow'});forward.disabled=record.can_forward===false;
    if(forward.disabled)forward.title='ต้องตรวจรับรองหลักฐานตามเกณฑ์ที่ยืนยันล่าสุดก่อน';
    footer.append(button('ส่งกลับแก้ไข',onReturn,{icon:'return'}),forward,el('small','coord-action-note','การรับเรื่องยังไม่ใช่การประกาศผลคัดเลือก'));}
  else footer.append(note(record.access?.read_only?'ช่วงทดลองนี้เปิดให้อ่านใบสมัครเท่านั้น ยังไม่เปิดรับเรื่อง ส่งกลับ หรือส่งต่อกรรมการ':record.state==='RETURNED'?'รอนักศึกษาแก้ไขและส่งฉบับใหม่ ข้อมูลด้านบนเป็นฉบับที่ส่งล่าสุด':record.state==='FORWARDED'?'ส่งให้กรรมการแล้ว ติดตามข้อมูลได้ที่ “ติดตามการพิจารณา”':'รอบนี้ไม่เปิดให้ทำรายการ ตรวจสอบกำหนดการหรือโหลดข้อมูลล่าสุด'));
  root.append(footer);return root;
}
