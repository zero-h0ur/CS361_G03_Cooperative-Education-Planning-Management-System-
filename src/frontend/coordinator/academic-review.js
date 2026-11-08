import {CHECK_LABELS} from '../../shared/academic-review.js';
import {el,field,note,button,dialog,feedback,score,date} from './components.js';
export function renderAcademicReview(record,{onConfirm,onDirty=()=>{},signal}={}){
 const root=el('section','coord-academic-review'),state=record.academic_review;
 root.append(el('h3','','ตรวจรับรองหลักฐานการศึกษา'));
 if(!state){root.append(note('ข้อมูลฉบับนี้ไม่ต้องใช้การตรวจรับรองเพิ่มเติม'));return root;}
 const preview=state.preview,policy=preview.policy;
 root.append(note('ผลตรวจนี้แยกจากใบสมัครต้นฉบับ และไม่ใช่ผลคัดเลือกสหกิจ'));
 if(policy)root.append(el('p','',`เกณฑ์หลักสูตร ${policy.curriculum} · รุ่น ${policy.version} · แหล่งอ้างอิง: ${policy.source}`));
 if(state.confirmed){
  root.append(el('p','coord-academic-confirmed',`ตรวจรับรองแล้ว ${date(state.record.created_at,true)} · ค่าเฉลี่ยกลุ่มวิชา ${score(preview.group_gpa)} · GPAX ${score(preview.gpax)}`));
  const retained=el('div','coord-academic-form');for(const [key,label] of CHECK_LABELS){const input=el('input');input.type='checkbox';input.checked=state.record.checks?.[key]===true;input.disabled=true;retained.append(field(label,input));}
  retained.append(el('p','',state.record.note || ''));root.append(retained);return root;
 }
 else root.append(el('p','',`ผลคำนวณจากข้อมูลในฉบับที่ส่ง (ยังไม่รับรอง): ค่าเฉลี่ยกลุ่มวิชา ${score(preview.group_gpa)} · GPAX ${score(preview.gpax)}`));
 if(state.record)root.append(note('ผลตรวจเดิมยังเก็บไว้ ต้องตรวจรับรองตามเกณฑ์และผู้รับผิดชอบล่าสุดอีกครั้ง'));
 if(!state.schema_ready)root.append(note('ระบบตรวจรับรองยังไม่พร้อม กรุณาติดต่อผู้ดูแลเพื่ออัปเกรดระบบ'));
 if(preview.blockers?.length){const list=el('ul','coord-review-blockers');for(const message of new Set(preview.blockers.map(x=>x.message)))list.append(el('li','',message));root.append(list);}
 if(!record.can_review || !onConfirm){root.append(note('อ่านผลตรวจได้เท่านั้น ตรวจสอบสิทธิ์และช่วงพิจารณาก่อนทำรายการ'));return root;}
 const form=el('form','coord-academic-form'),status=el('p','coord-feedback'),checks=new Map();status.tabIndex=-1;let pending=false,attempt=null;
 const change=()=>{attempt=null;onDirty(true);feedback(status,'ผลตรวจที่เลือกยังไม่บันทึก');};
 for(const [key,label] of CHECK_LABELS){const input=el('input');input.type='checkbox';input.required=true;input.disabled=!record.can_confirm_academics;input.addEventListener('change',change);checks.set(key,input);form.append(field(label,input));}
 const notes=el('textarea');notes.required=true;notes.maxLength=2000;notes.rows=3;notes.disabled=!record.can_confirm_academics;notes.addEventListener('input',change);
 form.append(field('บันทึกหลักฐานและผลตรวจ',notes),note('หากข้อมูลไม่ตรงหลักฐาน ให้ส่งกลับแก้ไขก่อน ไม่แก้ต้นฉบับแทนนักศึกษา'),status);
 const save=button('ตรวจทานและบันทึกผลรับรอง',null,{primary:true,icon:'check'});save.type='submit';save.disabled=!record.can_confirm_academics;form.append(save);root.append(form);
 form.addEventListener('submit',event=>{
  event.preventDefault();if(pending || !record.can_confirm_academics || !form.reportValidity())return;
  const body={expected_version:state.version,submission_id:record.submission_id,expected_policy_id:policy.id,
   checks:Object.fromEntries([...checks].map(([key,input])=>[key,input.checked])),note:notes.value.trim()};
  if(!body.note){feedback(status,'กรุณาบันทึกหลักฐานและผลตรวจ',true);notes.focus();return;}
  attempt ||= {...body,operation_id:crypto.randomUUID()};
  const content=el('div');content.append(el('p','',`${record.full_name} · ${record.student_number}`),el('p','',`ใบสมัครฉบับ ${record.submitted_version} · เกณฑ์หลักสูตร ${policy.curriculum} รุ่น ${policy.version}`),note('ยืนยันว่าได้ตรวจหลักฐานทุกหัวข้อแล้ว ระบบจะเก็บผลตรวจแยกจากใบสมัครต้นฉบับ'));
  const confirm=button('ยืนยันบันทึกผลรับรอง',async()=>{
   if(pending)return;pending=true;confirm.disabled=true;for(const input of form.querySelectorAll('input,textarea,button'))input.disabled=true;
   feedback(status,'กำลังบันทึกผลตรวจ…');
   try{await onConfirm(attempt);onDirty(false);if(signal?.aborted)return;modal.close();feedback(status,'บันทึกผลรับรองแล้ว');}
   catch(error){if(!signal?.aborted){modal.close();feedback(status,(error.message || 'บันทึกไม่สำเร็จ')+' · ผลตรวจที่กรอกยังอยู่ หากข้อมูลเปลี่ยนให้โหลดฉบับล่าสุด',true);status.focus();}}
   finally{pending=false;if(!signal?.aborted){confirm.disabled=false;for(const input of form.querySelectorAll('input,textarea,button'))input.disabled=!record.can_confirm_academics;}}
  },{primary:true});content.append(confirm);const modal=dialog(root,'ยืนยันผลตรวจหลักฐาน',content,{signal,canClose:()=>!pending});
 });
 return root;
}
