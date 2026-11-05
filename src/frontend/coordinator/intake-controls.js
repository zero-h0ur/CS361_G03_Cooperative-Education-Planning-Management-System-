import {el,button,field,select,note,dialog,bangkokInput,date,feedback} from './components.js';
const LABELS={CLOSED:'ปิดรับสมัคร',MANUAL_OPEN:'เปิดรับจนกว่าจะสั่งปิด',SCHEDULED:'กำหนดวัน–เวลาอัตโนมัติ'};
export function renderIntakeControls({request,cycleId,signal,onBusy=()=>{}}){
  const root=el('section','coord-intake-controls');root.setAttribute('aria-label','ควบคุมการรับสมัคร');
  let data,dirty=false,busy=false,attempt,token=0;
  const status=el('p','coord-feedback');status.setAttribute('role','status');status.tabIndex=-1;
  const stopped=()=>signal?.aborted || !root.isConnected;
  function draw(){
    root.replaceChildren(el('h2','','การเปิดรับสมัคร'),el('p','coord-muted',data.cycle_name));
    const current=el('div','coord-intake-current'),state=data.control;
    current.append(el('strong','',state.is_open?'กำลังเปิดรับสมัคร':'ยังไม่เปิดรับสมัคร'),el('span','',LABELS[state.mode] || 'ยังไม่ได้จัดเตรียมรอบ'));
    if(state.mode==='SCHEDULED')current.append(el('span','',date(state.opens_at,true)+' – '+date(state.closes_at,true)+' (เวลาไทย)'));
    if(state.mode==='MANUAL_OPEN')current.append(el('span','','เปิดเมื่อ '+date(state.opens_at,true)+' · ไม่กำหนดวันสิ้นสุด'));
    root.append(current,note('ปิดรับจะหยุดสร้าง บันทึก แนบไฟล์ และส่งฉบับร่างทั่วไป ข้อมูลเดิมยังอยู่ · ใบส่งกลับแก้ไขยึดช่วงพิจารณาเดิม'));
    const form=el('form','coord-intake-form'),mode=select('วิธีเปิดรับสมัคร',Object.entries(LABELS),state.mode in LABELS?state.mode:'CLOSED'),range=el('div','coord-schedule-pair');
    const opens=el('input'),closes=el('input');for(const input of [opens,closes])input.type='datetime-local';
    opens.value=bangkokInput(state.opens_at);closes.value=bangkokInput(state.closes_at);
    range.append(field('เปิดรับ · วันเวลาไทย',opens),field('ปิดรับ · วันเวลาไทย',closes));
    const update=()=>{range.hidden=mode.control.value!=='SCHEDULED';opens.required=closes.required=!range.hidden;
      save.textContent=mode.control.value==='CLOSED'?'ปิดรับทันที':mode.control.value==='MANUAL_OPEN'?'เปิดรับจนกดปิด':'บันทึกช่วงรับสมัคร';};
    const changed=()=>{dirty=true;attempt=null;feedback(status,'ค่าที่เลือกยังไม่บันทึก');update();};
    for(const input of [mode.control,opens,closes])input.addEventListener('input',changed);
    const save=button('',null,{primary:true});save.type='submit';
    form.append(mode.element,range,status,save);root.append(form);
    const reload=button('โหลดสถานะรับสมัครล่าสุด',()=>{if(!busy && (!dirty || window.confirm('โหลดล่าสุดและทิ้งการตั้งค่ารับสมัครที่ยังไม่บันทึกหรือไม่?')))load();});root.append(reload);
    update();for(const control of form.querySelectorAll('input,select,button'))control.disabled=!data.can_control;
    if(!data.can_control)root.append(note('อ่านอย่างเดียว: ต้องจัดเตรียมรอบและมอบหมายทั้งรอบให้บัญชี Coordinator นี้ก่อน'));
    const history=el('details','coord-intake-history');history.append(el('summary','','ประวัติเปิด/ปิดรับสมัคร'));
    const list=el('ol');for(const event of data.history || [])list.append(el('li','',`${date(event.created_at,true)} · ${LABELS[event.previous_mode] || '—'} → ${LABELS[event.mode] || '—'} · รุ่น ${event.version}`));
    if(!list.children.length)history.append(el('p','','ยังไม่มีการเปลี่ยนสถานะ'));else history.append(list);root.append(history);
    form.addEventListener('submit',e=>{e.preventDefault();if(busy || !data.can_control || !form.reportValidity())return;
      const body={expected_version:state.version,mode:mode.control.value};
      if(body.mode==='SCHEDULED'){body.opens_at=opens.value+':00+07:00';body.closes_at=closes.value+':00+07:00';
        if(Date.parse(body.closes_at)<=Date.parse(body.opens_at)){feedback(status,'วันปิดต้องอยู่หลังวันเปิด',true);closes.focus();return;}}
      attempt ||= {...body,operation_id:crypto.randomUUID()};
      const copy=el('div'),round=el('strong','coord-intake-confirm-round',data.cycle_name);
      copy.append(el('p','','กำลังเปลี่ยนการรับสมัครของรอบ'),round,el('p','',LABELS[body.mode]),note('ไม่เปลี่ยนช่วงพิจารณา ยืนยันสิทธิ์ หรือข้อมูลใบสมัครเดิม'));
      const confirm=button('ยืนยัน'+(body.mode==='CLOSED'?'ปิดรับ':'เปลี่ยนการรับสมัคร'),async()=>{
        if(busy)return;busy=true;onBusy(true);confirm.disabled=true;
        for(const control of form.querySelectorAll('input,select,button'))control.disabled=true;reload.disabled=true;
        feedback(status,'กำลังบันทึกการเปิด/ปิด…');
        try{const saved=await request('/intake/'+cycleId,{method:'POST',body:attempt});if(stopped())return;
          data=saved;dirty=false;attempt=null;modal.close();draw();feedback(status,saved.idempotent_replay?'ยืนยันรายการเดิมแล้ว · โหลดสถานะล่าสุดก่อนเปลี่ยนอีกครั้ง':'บันทึกการรับสมัครแล้ว');status.focus();}
        catch(error){if(!stopped()){feedback(status,(error.message || 'บันทึกไม่สำเร็จ')+' · ค่าที่กรอกยังอยู่ กรุณาโหลดล่าสุดหากสถานะขัดแย้ง',true);modal.close();status.focus();}}
        finally{busy=false;onBusy(false);if(!stopped()){for(const control of form.querySelectorAll('input,select,button'))control.disabled=!data.can_control;reload.disabled=false;}}
      },{primary:true});copy.append(confirm);const modal=dialog(root,'ยืนยันการรับสมัคร',copy,{signal,canClose:()=>!busy});
    });
  }
  async function load(){const current=++token;root.replaceChildren(el('h2','','การเปิดรับสมัคร'),el('p','','กำลังโหลดสถานะ…'));
    try{const result=await request('/intake/'+cycleId);if(signal?.aborted || current!==token)return;data=result;dirty=false;attempt=null;draw();}
    catch{if(signal?.aborted || current!==token)return;root.replaceChildren(el('h2','','การเปิดรับสมัคร'),note('ยังโหลดสถานะรับสมัครไม่ได้ ปุ่มเปิด/ปิดยังไม่พร้อม'),button('ลองโหลดสถานะรับสมัครอีกครั้ง',load));}}
  load();return {element:root,cycleId,isDirty:()=>dirty,isBusy:()=>busy};
}
