import {studentElement as el,studentLink,renderStudentPageHeader,renderStudentCard} from './workspace-components.js';
import {renderApplicationFeature,latestApplication,renderStudentDirectoryLink} from './application-presentation.js';
import {createWorkspaceIcon} from '../ui/workspace-presentation.js';
import formContract from '../../shared/application-form.js';

const action=(label,fn)=>{const b=el('button','shell-button shell-button--secondary',label);b.type='button';b.addEventListener('click',fn);return b;};
const value=text=>text===null||text===undefined||text===''?'ยังไม่มีข้อมูล':String(text);
function rows(items) {
  const dl=el('dl','student-data-rows');
  for(const [label,text] of items){const row=el('div');row.append(el('dt','',label),el('dd','',value(text)));dl.append(row);}return dl;
}

export function renderStudentProfile({profileClient,applicationClient,workflowClient,signal,onNavigate,onSessionExpired,onAccessDenied,setLeaveGuard}={}) {
  const root=el('div','student-profile');root.dataset.studentPage='true';
  const content=el('div','student-page-content');
  const identity=el('section','student-identity');identity.setAttribute('aria-label','ข้อมูลประจำตัวนักศึกษา');
  const grid=el('div','student-profile-grid'),left=el('div','student-profile-column'),right=el('div','student-profile-column');
  const official=renderStudentCard('ข้อมูลจากมหาวิทยาลัย',{icon:'lock'});
  const contact=renderStudentCard('ข้อมูลติดต่อ',{icon:'user'});
  const latest=el('div','student-profile-latest');latest.setAttribute('aria-live','polite');
  const docs=renderStudentCard('เตรียมไว้ก่อนส่งใบสมัคร',{icon:'document'});
  docs.append(el('p','student-record-description','แนบเอกสารในใบสมัครของแต่ละรอบ'));
  const checklist=el('ul','student-document-checklist');
  for(const [label,icon] of [['Resume / CV','document'],['Transcript','document'],['รูปถ่ายนักศึกษา','image'],['ใบรับรองความประพฤติ','document']]){
    const item=el('li');item.append(createWorkspaceIcon(icon),el('span','',label));checklist.append(item);
  }
  docs.append(checklist,studentLink('ดูรายละเอียดในใบสมัคร','#/student/application',{onNavigate,icon:'arrow'}));
  left.append(official,contact);right.append(latest,docs);grid.append(left,right);
  content.append(identity,grid,renderStudentDirectoryLink(onNavigate));
  root.append(renderStudentPageHeader({title:'ข้อมูลของฉัน',description:'ตรวจสอบข้อมูลนักศึกษา อัปเดตช่องทางติดต่อ และกลับไปทำใบสมัครต่อ'}),content);
  let profile=null,options=null,editing=false,dirty=false,saving=false,attempt=null;
  const canLeave=()=>!(dirty||saving)||window.confirm('ยังมีข้อมูลติดต่อที่ไม่ได้ยืนยันการบันทึก ต้องการออกจากหน้านี้หรือไม่?');
  setLeaveGuard?.(canLeave);
  const beforeUnload=e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  signal?.addEventListener('abort',()=>{window.removeEventListener('beforeunload',beforeUnload);profile=null;attempt=null;},{once:true});
  function blocked(error) {
    if(signal?.aborted||error?.name==='AbortError')return true;
    if(error?.status===401||error?.code==='SESSION_EXPIRED'){root.replaceChildren();onSessionExpired?.();return true;}
    if(error?.status===403||error?.code==='ACCESS_DENIED'){root.replaceChildren();onAccessDenied?.('ไม่มีสิทธิ์เข้าถึงข้อมูลนักศึกษา');return true;}
    return false;
  }
  function loading(section,text){const p=el('p','student-record-description',text);p.setAttribute('role','status');section.append(p);}
  function renderIdentity() {
    if(!profile)return;
    const person=el('div','student-identity__person'),name=el('div');
    name.append(el('h2','',profile.full_name),el('span','student-identity__role','นักศึกษา'));
    person.append(el('div','student-identity__avatar','นศ'),name);
    identity.replaceChildren(person,rows([['รหัสนักศึกษา',profile.student_number],['หลักสูตร',options?.official?.curriculum?`หลักสูตร ${options.official.curriculum}`:profile.program],['กลุ่มวิชาเอก',profile.major]]));
  }
  function renderOfficial() {
    official.replaceChildren(renderStudentCard('ข้อมูลจากมหาวิทยาลัย',{icon:'lock'}).firstChild,
      el('p','student-record-description','อ่านอย่างเดียว · ใช้ตรวจสอบตัวตนและข้อมูลการศึกษา'),
      rows([['ภาควิชา',profile.department],['หลักสูตร / สาขา',profile.program],['ปีที่เข้าศึกษา',options?.official?.entry_year],['อีเมลมหาวิทยาลัย',profile.institutional_email]]),
      el('p','student-info-note','ข้อมูลไม่ถูกต้อง? ติดต่อผู้ประสานงานเพื่อตรวจสอบ'));
  }
  function renderContact({focus=false,message=''}={}) {
    const heading=renderStudentCard('ข้อมูลติดต่อ',{icon:'user'}).firstChild;
    contact.replaceChildren(heading,el('p','student-record-description','ข้อมูลส่วนนี้คุณสามารถอัปเดตเองได้'));
    if(!editing) {
      if(workflowClient){const edit=action('แก้ไขข้อมูล',()=>{editing=true;renderContact({focus:true});});edit.classList.add('student-contact-edit');edit.prepend(createWorkspaceIcon('edit'));heading.append(edit);}
      contact.append(rows([['อีเมลที่ติดต่อได้',profile.contact_email],['เบอร์โทรศัพท์',profile.contact_phone],['ที่อยู่ที่ติดต่อได้',profile.contact_address]]),
        el('p','student-info-note','การแก้ไขนี้ไม่เปลี่ยนข้อมูลในใบสมัครที่ส่งแล้ว'));
      if(message){const status=el('p','student-contact-status',message);status.setAttribute('role','status');contact.append(status);}
      if(focus)contact.querySelector('button')?.focus();return;
    }
    const form=el('form','student-contact-form');
    const fields=[['contact_email','อีเมลที่ติดต่อได้','email',254],['contact_phone','เบอร์โทรศัพท์','tel',40],['contact_address','ที่อยู่ที่ติดต่อได้','textarea',1000]];
    const controls={};
    for(const [key,label,type,maxLength] of fields) {
      const wrapper=el('div','application-field'),l=el('label','',label),input=el(type==='textarea'?'textarea':'input','application-input');
      input.id=`student-${key}`;l.htmlFor=input.id;input.name=key;input.value=profile[key]||'';input.maxLength=maxLength;
      if(type!=='textarea')input.type=type;
      input.autocomplete=key==='contact_email'?'email':key==='contact_phone'?'tel':'street-address';
      input.addEventListener('input',()=>{dirty=true;save.disabled=false;status.textContent='ยังไม่ได้บันทึกการเปลี่ยนแปลง';});
      controls[key]=input;wrapper.append(l,input);form.append(wrapper);
    }
    const status=el('p','student-contact-status','การแก้ไขจะมีผลกับโปรไฟล์เท่านั้น ใบสมัครที่ส่งแล้วไม่เปลี่ยน');
    status.id='student-contact-status';status.setAttribute('role','status');status.tabIndex=-1;
    const buttons=el('div','student-contact-actions');
    const save=action('บันทึกข้อมูลติดต่อ',()=>{});save.type='submit';save.classList.remove('shell-button--secondary');save.disabled=true;
    const cancel=action('ยกเลิก',()=>{if(!canLeave())return;editing=false;dirty=false;attempt=null;renderContact({focus:true});});
    const reload=action('โหลดข้อมูลล่าสุด',async()=>{if(canLeave())await loadProfile(true);});reload.hidden=true;
    buttons.append(save,cancel,reload);form.append(status,buttons);contact.append(form);
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(saving||!dirty||signal?.aborted)return;
      if(!form.reportValidity())return;
      const email=controls.contact_email.value.trim();
      if(email&&!formContract.EMAIL.test(email)){controls.contact_email.setCustomValidity('กรุณาตรวจสอบอีเมลติดต่อ');controls.contact_email.reportValidity();controls.contact_email.setCustomValidity('');return;}
      const body={version:profile.version,contact_email:email||null,contact_phone:controls.contact_phone.value.trim()||null,contact_address:controls.contact_address.value.trim()||null};
      const signature=JSON.stringify(body);if(attempt?.signature!==signature)attempt={signature,body:{...body,operation_id:crypto.randomUUID()}};
      saving=true;for(const control of form.elements)control.disabled=true;status.textContent='กำลังบันทึกข้อมูลติดต่อ…';
      try {
        const updated=await workflowClient.request('/api/v3/students/me',{method:'PATCH',body:attempt.body,signal});
        if(signal?.aborted)return;
        if(!Number.isInteger(updated?.version)||updated.version<1)throw new Error('ยังยืนยันผลบันทึกไม่ได้ กรุณาลองอีกครั้งด้วยข้อมูลเดิม');
        profile={...profile,...updated};dirty=false;editing=false;attempt=null;renderContact({focus:true,message:'บันทึกข้อมูลติดต่อแล้ว'});
      } catch(error) {
        if(blocked(error))return;
        status.textContent=error.message||'บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง';status.setAttribute('role','alert');
        reload.hidden=!(error.status===409||error.code==='STALE_RECORD_CONFLICT');status.focus();
      } finally {saving=false;for(const control of form.elements)control.disabled=false;}
    });
    if(focus)controls.contact_email.focus();
  }
  async function loadProfile(focus=false) {
    contact.setAttribute('aria-busy','true');
    try {
      const data=await profileClient.getOwnProfile({signal});if(signal?.aborted)return;
      profile=data;editing=false;dirty=false;attempt=null;renderIdentity();renderOfficial();renderContact({focus});
    } catch(error) {
      if(blocked(error))return;
      if(profile&&editing){const status=contact.querySelector('[role=status],[role=alert]');if(status)status.textContent='โหลดข้อมูลล่าสุดไม่สำเร็จ ข้อมูลที่กรอกยังอยู่';}
      else {identity.replaceChildren(el('p','application-error','โหลดข้อมูลนักศึกษาไม่สำเร็จ'),action('ลองโหลดข้อมูลอีกครั้ง',()=>loadProfile()));official.hidden=true;contact.hidden=true;}
    } finally {contact.setAttribute('aria-busy','false');if(profile){official.hidden=false;contact.hidden=false;}}
  }
  async function loadApplications() {
    latest.replaceChildren();loading(latest,'กำลังโหลดใบสมัครล่าสุด…');
    const [optionResult,listResult]=await Promise.allSettled([applicationClient.options({signal}),applicationClient.list({signal})]);
    if(signal?.aborted)return;
    for(const result of [optionResult,listResult])if(result.status==='rejected'&&blocked(result.reason))return;
    options=optionResult.status==='fulfilled'?optionResult.value:null;
    if(profile){renderIdentity();renderOfficial();}
    latest.replaceChildren();
    if(listResult.status==='rejected') {
      latest.className='student-profile-latest student-record-card';latest.append(el('p','','โหลดใบสมัครล่าสุดไม่สำเร็จ'),action('ลองโหลดใบสมัครอีกครั้ง',loadApplications));return;
    }
    const app=latestApplication(listResult.value);
    if(app)latest.append(renderApplicationFeature(app,{cycles:options?.cycles,onNavigate,compact:true}));
    else {latest.className='student-profile-latest student-record-card';latest.append(el('h2','','เริ่มสมัครเข้าแผนสหกิจ'),el('p','student-record-description','ยังไม่มีใบสมัคร เลือกรอบแล้วทยอยกรอกข้อมูลได้'),studentLink('เลือกรอบสมัคร','#/student/application',{onNavigate,className:'shell-button'}));}
  }
  loading(identity,'กำลังโหลดข้อมูลนักศึกษา…');loading(contact,'กำลังโหลดช่องทางติดต่อ…');
  loadProfile();loadApplications();return root;
}
