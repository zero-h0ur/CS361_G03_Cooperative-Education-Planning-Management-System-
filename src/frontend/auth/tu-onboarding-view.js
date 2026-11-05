// Registration ticket lives in this view's memory only; never put it in DOM,
// location, logs or web storage. Leaving, expiry or refresh requires a new Login.
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
export function renderTuOnboarding({registration,onSubmit,onCancel,signal,clock=Date.now}={}){
 let ticket=registration.registrationToken,attempt=null,busy=false,interacted=false;
 const identity=registration.identity,expires=clock()+registration.expiresIn*1000;registration=null;
 const root=el('section','tu-onboarding'),title=el('h2','','ยินดีต้อนรับสู่ CO-ED');title.tabIndex=-1;
 const verified=el('div','tu-onboarding__verified');
 verified.append(el('p','tu-onboarding__eyebrow','ยืนยันตัวตนจาก TU แล้ว'),el('h3','',identity.nameTh));
 const details=el('dl','tu-onboarding__identity');
 for(const [label,text] of [['รหัสนักศึกษา',identity.subject],['อีเมลมหาวิทยาลัย',identity.email],['คณะ',identity.faculty],['สาขาจาก TU',identity.department],['สถานะจาก TU',identity.tuStatus]]){
  const row=el('div');row.append(el('dt','',label),el('dd','',text));details.append(row);
 }
 verified.append(details,el('p','tu-onboarding__hint','ข้อมูลจาก TU เป็นแบบอ่านอย่างเดียว หากไม่ถูกต้อง โปรดติดต่อผู้ประสานงาน'));
 const form=el('form','tu-onboarding__form');form.noValidate=true;
 const summary=el('div','tu-onboarding__errors');summary.hidden=true;summary.tabIndex=-1;summary.setAttribute('role','alert');
 const fields=el('fieldset');fields.append(el('legend','','เพิ่มข้อมูลการศึกษาของคุณ'));
 fields.append(el('p','tu-onboarding__hint','สองช่องนี้เป็นข้อมูลที่คุณกรอกเอง ผู้ประสานงานจะตรวจสอบตอนพิจารณาใบสมัคร'));
 const controls={},errors={};
 for(const [key,label] of [['programType','ภาคการศึกษา (จำเป็น)'],['entryYear','ปีที่เข้าศึกษา พ.ศ. (จำเป็น)']]){
  const wrap=el('div','tu-onboarding__field'),l=el('label','',label),input=el(key==='programType'?'select':'input'),error=el('p','tu-onboarding__field-error');
  input.id='tu-register-'+key;input.name=key;input.required=true;l.htmlFor=input.id;error.id=input.id+'-error';input.setAttribute('aria-describedby',error.id);
  if(key==='programType')for(const [v,t] of [['','เลือกภาคการศึกษา'],['regular','ภาคปกติ'],['special','ภาคพิเศษ']]){const o=el('option','',t);o.value=v;input.append(o);}
  else{input.type='text';input.inputMode='numeric';input.maxLength=4;input.placeholder='เช่น 2567';input.autocomplete='off';}
  controls[key]=input;errors[key]=error;input.addEventListener('blur',()=>validateField(key));wrap.append(l,input,error);fields.append(wrap);
 }
 const status=el('p','tu-onboarding__status');status.setAttribute('role','status');status.tabIndex=-1;
 const note=el('p','tu-onboarding__hint','การสร้างบัญชีไม่ใช่ผลรับเข้าแผนสหกิจ และยังต้องตรวจสอบหลักสูตร/คุณสมบัติก่อนส่งใบสมัคร');
 const actions=el('div','tu-onboarding__actions'),submit=el('button','shell-button','ยืนยันข้อมูลและเข้าใช้งาน'),cancel=el('button','shell-button shell-button--secondary','กลับไปเข้าสู่ระบบ');
 submit.type='submit';cancel.type='button';cancel.addEventListener('click',()=>{if(busy)return;dispose();onCancel();});actions.append(submit,cancel);
 form.append(summary,fields,note,status,actions);root.append(title,el('p','tu-onboarding__intro','อีกเพียง 2 ช่อง เพื่อสร้างบัญชีนักศึกษาของคุณ'),verified,form);
 function validateField(key){
  const value=controls[key].value;
  const valid=key==='programType'?['regular','special'].includes(value):/^\d{4}$/.test(value)&&Number(value)>=2500&&Number(value)<=2700;
  errors[key].textContent=valid?'':key==='programType'?'กรุณาเลือกภาคปกติหรือภาคพิเศษ':'กรุณากรอกปี พ.ศ. 4 หลัก ระหว่าง 2500–2700';
  controls[key].setAttribute('aria-invalid',String(!valid));return valid;
 }
 function dispose(){ticket=null;attempt=null;clearTimeout(timer);window.removeEventListener('pagehide',dispose);}
 const timer=setTimeout(()=>{ticket=null;submit.disabled=true;status.textContent='หมดเวลาลงทะเบียน กรุณากลับไปเข้าสู่ระบบด้วย TU ใหม่';},Math.max(0,expires-clock()));
 signal?.addEventListener('abort',dispose,{once:true});window.addEventListener('pagehide',dispose,{once:true});
 form.addEventListener('submit',async event=>{
  event.preventDefault();interacted=true;if(busy||signal?.aborted)return;
  const invalid=Object.keys(controls).filter(key=>!validateField(key));summary.replaceChildren();summary.hidden=!invalid.length;
  if(invalid.length){summary.append(el('p','','กรุณาตรวจสอบข้อมูลก่อนดำเนินการ'));
   for(const key of invalid){const link=el('a','',errors[key].textContent);link.href='#'+controls[key].id;link.addEventListener('click',e=>{e.preventDefault();controls[key].focus();});summary.append(link);}summary.focus();return;
  }
  if(!ticket||clock()>=expires){ticket=null;submit.disabled=true;status.textContent='หมดเวลาลงทะเบียน กรุณากลับไปเข้าสู่ระบบด้วย TU ใหม่';status.focus();return;}
  const data={programType:controls.programType.value,entryYear:Number(controls.entryYear.value)},signature=JSON.stringify(data);
  if(attempt?.signature!==signature)attempt={signature,operationId:crypto.randomUUID()};
  busy=true;for(const control of [submit,cancel,...Object.values(controls)])control.disabled=true;form.setAttribute('aria-busy','true');status.textContent='กำลังสร้างบัญชีและตรวจสอบสิทธิ์เข้าใช้งาน…';
  try{await onSubmit({registrationToken:ticket,...data,operationId:attempt.operationId});if(!signal?.aborted){dispose();status.textContent='ยืนยันบัญชีแล้ว กำลังเข้าสู่ระบบ…';}}
  catch(error){if(!signal?.aborted){status.textContent=error?.message||'ยังยืนยันผลไม่ได้ กรุณาลองส่งข้อมูลเดิมอีกครั้ง หรือกลับไปเข้าสู่ระบบใหม่';status.setAttribute('role','alert');status.focus();}}
  finally{busy=false;form.removeAttribute('aria-busy');if(!signal?.aborted)for(const control of [cancel,...Object.values(controls)])control.disabled=false;submit.disabled=!ticket;}
 });
 queueMicrotask(()=>{if(root.isConnected&&!interacted&&!signal?.aborted)title.focus();});return root;
}
