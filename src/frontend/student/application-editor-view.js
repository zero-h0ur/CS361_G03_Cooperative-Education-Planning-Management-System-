import {FILE_KINDS,validateApplicationFile} from './application-client.js';
import form from '../../shared/application-form.js';
import {createWorkspaceIcon} from '../ui/workspace-presentation.js';
const {GROUPS,EXTRAS,GRADES,MAJORS,POSITIONS,EMAIL}=form;
const STEPS=[['identity','ข้อมูลผู้สมัคร'],['academic','ผลการเรียน'],['interests','ความสนใจและคำรับรอง'],['documents','เอกสารแนบ'],['guardian','ผู้ติดต่อฉุกเฉิน'],['review','ตรวจทานและส่ง']];
const copy=v=>JSON.parse(JSON.stringify(v));
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(label,fn,secondary=true)=>{const b=node('button',`shell-button${secondary?' shell-button--secondary':''}`,label);b.type='button';b.addEventListener('click',fn);return b;};
const gradeLabel=value=>GRADES.find(([points])=>Number(points)===Number(value))?.[1] || String(value);

export function renderApplicationEditor({client,application,signal,onSessionExpired,onBack,setLeaveGuard}={}) {
  const root=node('div','application-editor');let app=application,draft=copy(app.payload || {}),dirty=false,busy=false,result=null;
  let activeStep=app.status==='SUBMITTED'?5:0,message='',errors=[],confirming=false,hasError=false;
  const selectedFiles=new Map(),attempts=new Map();
  const readOnly=()=>app.status!=='DRAFT' || app.availability?.can_edit===false;
  const canLeave=()=>!(dirty || busy || selectedFiles.size) || window.confirm(busy?'กำลังทำรายการ ผลอาจถูกบันทึกแล้ว ต้องการออกจากหน้านี้หรือไม่?':'ยังมีข้อมูลหรือไฟล์ที่ไม่ได้บันทึก ต้องการออกจากหน้านี้และทิ้งข้อมูลที่กรอกหรือไม่?');
  setLeaveGuard?.(canLeave);
  const beforeUnload=e=>{if(dirty || busy || selectedFiles.size){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  signal?.addEventListener('abort',()=>{window.removeEventListener('beforeunload',beforeUnload);selectedFiles.clear();attempts.clear();},{once:true});
  const current=()=>app.official.curriculum || draft.curriculum || '';
  const display=key=>app.official[key] || draft[key] || '';
  function setCurriculum(value){draft.curriculum=value;draft.acknowledgements ||= {};for(const key of ['required_courses','additional_courses','preplacement'])draft.acknowledgements[key]=false;}
  function changed(){
    dirty=true;result=null;confirming=false;
    for(const status of root.querySelectorAll('[data-save-state]'))status.textContent='มีข้อมูลที่ยังไม่ได้บันทึก';
    for(const b of root.querySelectorAll('[data-requires-saved]'))b.disabled=true;
    root.querySelector('.application-confirm')?.remove();
  }
  function operation(key,body){const signature=JSON.stringify(body);if(attempts.get(key)?.signature!==signature)attempts.set(key,{signature,body:{...body,operation_id:crypto.randomUUID()}});return attempts.get(key).body;}
  function fail(e){
    if(e.name==='AbortError' || signal?.aborted)return;
    if(e.code==='SESSION_EXPIRED'){onSessionExpired?.();return;}
    hasError=true;message=e.message || 'ทำรายการไม่สำเร็จ ข้อมูลที่กรอกยังอยู่';errors=Array.isArray(e.details)?e.details:[];
    if(['STALE_RECORD_CONFLICT','POLICY_CHANGED'].includes(e.code))message+=' — โหลดข้อมูลล่าสุดได้ด้านล่าง โดยระบบจะถามก่อนทิ้งข้อมูลที่คุณกรอก';
  }
  async function run(work){
    if(busy || signal?.aborted)return;
    const focused=document.activeElement,focusId=focused?.id,focusText=focused?.tagName==='BUTTON'?focused.textContent:null;
    busy=true;confirming=false;hasError=false;render();
    try{await work();}catch(e){fail(e);}finally{
      busy=false;if(!signal?.aborted){render();
        if(errors.length || hasError)root.querySelector('[data-feedback]')?.focus({preventScroll:true});
        else (Array.from(root.querySelectorAll('[id]')).find(e=>focusId && e.id===focusId && !e.closest('[hidden]')) || Array.from(root.querySelectorAll('button')).find(b=>b.textContent===focusText && !b.disabled && !b.closest('[hidden]')))?.focus({preventScroll:true});
      }
    }
  }
  function focusTarget(target){target?.scrollIntoView?.({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});target?.focus({preventScroll:true});}
  function showStep(index,field){
    if(busy)return;activeStep=Math.max(0,Math.min(5,index));confirming=false;render();
    const panel=root.querySelector('#application-'+STEPS[activeStep][0]);panel?.classList.add('application-step--enter');
    const target=field?Array.from(root.querySelectorAll('[data-field]')).find(x=>x.dataset.field===field):panel;focusTarget(target || panel);
  }
  function errorStep(key){
    key=typeof key==='string'?key:'';
    if(key.startsWith('documents.'))return 3;if(key.startsWith('guardian_'))return 4;
    if(key.startsWith('acknowledgements.') || key.startsWith('interested_') || key==='skills' || key==='skills_detail')return 2;
    if(['curriculum','gpax','gpax_reporting_term','declared_group_gpa','selected_courses','course_attempts','additional_studies','cycle_id'].includes(key))return 1;return 0;
  }
  function feedback(){
    const area=node('div',errors.length || hasError?'application-error':'application-notice');area.dataset.feedback='';area.tabIndex=-1;
    area.setAttribute('role',errors.length || hasError?'alert':'status');area.setAttribute('aria-atomic','true');
    area.append(node('p','',message || (app.preview?'Local Preview · ข้อมูลสมมติ ไม่ใช่ใบสมัครจริง':'กรอกทีละส่วน บันทึกฉบับร่างได้แม้ยังไม่ครบ ช่องที่มี * จำเป็นเมื่อส่งใบสมัคร')));
    if(errors.length){const list=node('ul');for(const error of errors){const li=node('li'),link=node('a','',error.message || 'กรุณาตรวจข้อมูล'),key=error.field || '';
      link.href='#application-'+STEPS[errorStep(key)][0];link.addEventListener('click',e=>{e.preventDefault();showStep(errorStep(key),key==='cycle_id'?'curriculum':key);});li.append(link);list.append(li);}area.append(list);}return area;
  }
  function card(id,title,subtitle){const s=node('section','application-card'),heading=node('h2','',title);s.id=id;s.tabIndex=-1;heading.id=id+'-heading';s.setAttribute('aria-labelledby',heading.id);s.append(heading);if(subtitle)s.append(node('p','application-help',subtitle));return s;}
  function markError(wrap,input,key){
    const matches=errors.filter(e=>e.field===key);if(!matches.length)return;
    const e=node('p','application-field-error',matches.map(x=>x.message).join(' · '));e.id=input.id+'-error';input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),e.id].filter(Boolean).join(' '));wrap.append(e);
  }
  function hint(input,text){const h=node('p','application-help',text);h.id=input.id+'-hint';input.parentElement.append(h);input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),h.id].filter(Boolean).join(' '));}
  function field(parent,key,label,{textarea=false,type='text',max=200,readonly=false,value,required=true,autocomplete}={}){
    const wrap=node('div','application-field'),l=node('label','',label+(required?' *':'')),input=node(textarea?'textarea':'input','application-input');input.id='application-'+key.replaceAll('.','-');input.dataset.field=key;l.htmlFor=input.id;
    if(!textarea)input.type=type;input.maxLength=max;if(type==='number'){input.min='0';input.max='4';input.step='0.0001';}
    if(autocomplete)input.autocomplete=autocomplete;input.setAttribute('aria-required',String(required));input.value=value ?? draft[key] ?? '';input.readOnly=readonly || readOnly();input.disabled=busy;
    input.addEventListener('input',()=>{if(input.readOnly)return;draft[key]=input.value;changed();});
    input.addEventListener('blur',()=>{
      if(input.readOnly || busy)return;let error='';const v=input.value.trim();
      if(v && type==='email' && !EMAIL.test(v))error='กรุณาระบุอีเมลให้ครบ เช่น name@example.com';
      if(v && type==='tel' && !/^\+?\d{7,15}$/.test(v.replace(/[ ()-]/g,'')))error='ใช้เบอร์โทร 7–15 หลัก และ + สำหรับรหัสประเทศได้';
      if(v && type==='number' && (!/^\d(?:\.\d{1,4})?$/.test(v) || Number(v)>4))error='ระบุค่าระหว่าง 0 ถึง 4 ทศนิยมไม่เกิน 4 ตำแหน่ง';
      errors=errors.filter(e=>e.field!==key);if(error)errors.push({field:key,message:error});wrap.querySelector('.application-field-error')?.remove();input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');
      if(wrap.querySelector('#'+input.id+'-hint'))input.setAttribute('aria-describedby',input.id+'-hint');markError(wrap,input,key);
    });wrap.append(l,input);markError(wrap,input,key);parent.append(wrap);return input;
  }
  function selectField(parent,key,label,options,value,onChange,{required=true}={}){
    const wrap=node('div','application-field'),l=node('label','',label+(required?' *':'')),select=node('select','application-input');select.id='application-'+key.replaceAll('.','-');select.dataset.field=key;l.htmlFor=select.id;
    for(const [v,text] of options)select.append(new Option(text,v));select.value=value || '';select.setAttribute('aria-required',String(required));select.disabled=readOnly() || busy;
    select.addEventListener('change',()=>{onChange(select.value);changed();render();root.querySelector('#'+select.id)?.focus({preventScroll:true});});wrap.append(l,select);markError(wrap,select,key);parent.append(wrap);return select;
  }
  function reuseField(input,label,value,{showEmpty=false}={}){
    if(readOnly() || (!value && !showEmpty))return;
    const row=node('div','application-field-action'),status=node('span','application-field-action__status');
    const action=button(label,()=>{
      if(busy || readOnly() || signal?.aborted || !value)return;
      const key=input.dataset.field;
      if(!input.readOnly && draft[key] && draft[key]!==value && !window.confirm('ต้องการแทนที่ข้อมูลที่กรอกในช่องนี้ด้วยข้อมูลต้นทางหรือไม่?'))return;
      draft[key]=value;input.value=value;changed();
      errors=errors.filter(e=>e.field!==key);input.parentElement.querySelector('.application-field-error')?.remove();input.removeAttribute('aria-invalid');
      const described=(input.getAttribute('aria-describedby') || '').split(' ').filter(id=>id!==input.id+'-error');
      if(described.length)input.setAttribute('aria-describedby',described.join(' '));else input.removeAttribute('aria-describedby');
      status.textContent='เติมข้อมูลแล้ว · ยังไม่ได้บันทึก';input.focus({preventScroll:true});
    });
    action.className='application-inline-action';action.prepend(createWorkspaceIcon('copy'));
    action.setAttribute('aria-controls',input.id);action.disabled=busy || !value;
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    input.addEventListener('input',()=>{status.textContent='';});
    if(!value && showEmpty)status.textContent='กรอกที่อยู่นักศึกษาในขั้นที่ 1 ก่อน';
    row.append(action,status);input.parentElement.append(row);
  }
  function header(){
    const top=card('application-summary',app.cycle_name || 'ใบสมัครเข้าแผนสหกิจศึกษา','เตรียมใบสมัครของคุณทีละส่วน แล้วตรวจทานก่อนส่งให้ผู้ประสานงาน');top.classList.add('application-intro');
    const state=node('p','application-badge',app.status==='SUBMITTED'?'ส่งแล้ว · รอผู้ประสานงานตรวจสอบ':readOnly()?'รอบปิด / หมดเวลา · อ่านอย่างเดียว':'ฉบับร่าง · ยังไม่ได้ส่ง');
    const saved=node('p','application-help',dirty?'มีข้อมูลที่ยังไม่ได้บันทึก':'ข้อมูลตรงกับฉบับที่บันทึกแล้ว');saved.dataset.saveState='';top.append(state,saved);
    if(app.availability?.closes_at){const format=value=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value));top.append(node('p','application-help',`กำหนดรับสมัคร ${format(app.availability.opens_at)} – ${format(app.availability.closes_at)} (เวลาไทย)`));}
    if(readOnly())top.append(node('p','application-notice',app.status==='SUBMITTED'?'ข้อมูลและเอกสารถูกล็อกไว้ตามฉบับที่ส่ง การส่งใบสมัครยังไม่ใช่การได้รับคัดเลือกเข้าแผน':'ใบสมัครนี้ยังไม่ได้ส่ง แต่รอบไม่เปิดให้แก้ไขแล้ว ข้อมูลที่บันทึกยังดูและดาวน์โหลดได้'));
    const nav=node('nav','application-steps');nav.setAttribute('aria-label','ขั้นตอนใบสมัคร');
    STEPS.forEach(([id,label],index)=>{const b=button('',()=>showStep(index));b.className='application-step-button';b.setAttribute('aria-controls','application-'+id);if(activeStep===index)b.setAttribute('aria-current','step');b.append(node('span','application-step-number',String(index+1)),node('span','',label));nav.append(b);});
    const progress=node('p','application-step-progress',`ขั้นที่ ${activeStep+1} จาก 6 · ${STEPS[activeStep][1]}`);progress.setAttribute('role','status');top.append(nav,progress);return top;
  }
  function identity(){
    const s=card('application-identity','ข้อมูลนักศึกษาและการติดต่อ','ข้อมูลจากมหาวิทยาลัยอ่านอย่างเดียว ส่วนที่ยังไม่มีข้อมูลทางการแยกช่อง ให้กรอกตามเอกสารและตรวจสอบอีกครั้ง');
    const official=node('dl','application-official application-grid');for(const [key,label] of [['full_name','ชื่อ-นามสกุลทางการ (ข้อมูลต้นทาง)'],['student_number','รหัสนักศึกษา'],['department','ภาควิชา'],['program','หลักสูตร'],['entry_year','ปีที่เข้าศึกษา']]){const d=node('div');d.append(node('dt','',label),node('dd','',String(app.official[key] || 'รอยืนยันข้อมูล')));official.append(d);}s.append(official);const grid=node('div','application-grid');
    for(const [key,label] of [['name_prefix','คำนำหน้าชื่อ'],['thai_full_name','ชื่อ-นามสกุล ภาษาไทย'],['english_full_name','ชื่อ-นามสกุล ภาษาอังกฤษ']]){
      const trusted=Boolean(app.official[key]),input=field(grid,key,label,{max:key==='name_prefix'?100:200,readonly:trusted,value:display(key)});hint(input,trusted?'ข้อมูลทางการ · อ่านอย่างเดียว':'ข้อมูลที่คุณแจ้งสำหรับใบสมัครนี้ · ไม่เปลี่ยนข้อมูลทางการ');
      if(key==='name_prefix' && !trusted){const options=node('datalist');options.id='application-prefix-options';for(const title of ['นาย','นาง','นางสาว'])options.append(new Option(title,title));input.setAttribute('list',options.id);grid.append(options);}
      if(trusted && draft[key] && draft[key]!==app.official[key])reuseField(input,'ใช้ข้อมูลทางการ',app.official[key]);
      if(key==='thai_full_name' && !draft[key] && !trusted && /[\u0E00-\u0E7F]/.test(app.official.full_name || ''))reuseField(input,'ใช้ชื่อทางการ',app.official.full_name);
    }
    const uni=field(grid,'institutional_email','อีเมลมหาวิทยาลัย (Dome)',{type:'email',max:254,readonly:Boolean(app.official.institutional_email),value:app.official.institutional_email || draft.institutional_email});hint(uni,app.official.institutional_email?'ข้อมูลทางการ · อ่านอย่างเดียว':'ระบุอีเมลมหาวิทยาลัยตามเอกสาร');
    if(app.official.institutional_email && draft.institutional_email && draft.institutional_email!==app.official.institutional_email)reuseField(uni,'ใช้อีเมลมหาวิทยาลัยที่ยืนยัน',app.official.institutional_email);
    const contact=field(grid,'contact_email','อีเมลที่ติดต่อได้',{type:'email',max:254,autocomplete:'email'});if(!draft.contact_email)reuseField(contact,'ใช้อีเมลมหาวิทยาลัย',app.official.institutional_email);
    const major=draft.major_group || '',majorOptions=[['','เลือกกลุ่มวิชาเอก'],...MAJORS];if(major && !MAJORS.some(([code])=>code===major))majorOptions.push([major,'ข้อมูลเดิม: '+major+' (โปรดเลือก CIS / ACS)']);selectField(grid,'major_group','กลุ่มวิชาเอก',majorOptions,major,value=>{draft.major_group=value;});
    field(grid,'contact_phone','เบอร์โทรติดต่อ',{type:'tel',max:40,autocomplete:'tel'});field(grid,'contact_address','ที่อยู่ที่ติดต่อได้',{textarea:true,max:1000,autocomplete:'street-address'});s.append(grid);return s;
  }
  function academic(){
    const s=card('application-academic','ผลการเรียนและเกณฑ์สมัคร','แจ้งผลการเรียนตาม Transcript ผู้ประสานงานยังต้องตรวจเอกสาร ไม่ใช่ผลการศึกษาที่ยืนยันจาก TU API');
    if(app.official.curriculum && draft.curriculum && draft.curriculum!==app.official.curriculum && !readOnly()){
      const notice=node('div','application-warning');notice.append(node('p','',`หลักสูตรที่ยืนยันคือ ${app.official.curriculum} ต่างจากฉบับร่างเดิม ${draft.curriculum} กรุณาตรวจเกรดและรับรองข้อที่อ้างหลักสูตรใหม่ ข้อมูลเกรดเดิมจะยังอยู่`),button('ใช้หลักสูตรที่ยืนยัน',()=>{setCurriculum(app.official.curriculum);changed();render();}));s.append(notice);
    }
    const policy=node('div',app.policy?.verified && !app.policy.synthetic?'application-notice':'application-warning');policy.id='application-policy';policy.tabIndex=-1;policy.append(node('strong','',!app.policy?.verified?'รอยืนยันข้อมูลเกณฑ์':app.policy.synthetic?'ข้อมูลสมมติสำหรับ Preview / Tests เท่านั้น':'ใช้เกณฑ์ที่ยืนยันแล้ว'),node('p','','GPAX ≥ 2.75 · ค่าเฉลี่ยกลุ่มวิชา ≥ 2.50 แบบถ่วงหน่วยกิต · รหัส 67 ลงไป'),node('p','application-help','เกณฑ์ต้นทางปี 2568 ที่ทีมใช้เป็นฐานสำหรับ 1/69 ไม่ใช่ประกาศทางการปี 2569 หรือ 2570'));
    policy.append(node('p','',app.policy?`ที่มา: ${app.policy.source} · ปีต้นทาง ${app.policy.source_year} · เกณฑ์ v${app.policy.version}`:'ยังไม่มีหน่วยกิตและกติกาเรียนซ้ำที่ทีมยืนยัน บันทึก Draft และอัปโหลดได้ แต่ยังส่งใบสมัครจริงไม่ได้'));s.append(policy);
    const details=node('details','application-criteria'),criteria=node('ol');details.append(node('summary','','อ่านเกณฑ์และเงื่อนไขการสมัคร'));
    declarations().forEach(([,label])=>criteria.append(node('li','',label)));details.append(criteria,node('p','application-help','นักศึกษาที่ผ่านคุณสมบัติมีสิทธิสมัครเพื่อคัดเลือกเท่านั้น การคัดเลือกขึ้นอยู่กับคณะกรรมการบริหารสหกิจศึกษาและภาระงานอาจารย์ ผลคัดเลือกของคณะกรรมการถือเป็นที่สิ้นสุด'));s.append(details);const grid=node('div','application-grid');
    selectField(grid,'curriculum','หลักสูตร',[['','เลือกหลักสูตร'],['61','หลักสูตร 2561'],['66','หลักสูตร 2566']],current(),setCurriculum).disabled=Boolean(app.official.curriculum) || readOnly() || busy;
    field(grid,'gpax','เกรดเฉลี่ยสะสม (GPAX)',{type:'number'});hint(field(grid,'gpax_reporting_term','GPAX ถึงภาคการศึกษาใด',{max:100}),'กรอกตาม Transcript เช่น ภาคฤดูร้อน 3/2568 · เป็นข้อมูลที่คุณแจ้ง ไม่ใช่กำหนดการรับสมัคร');hint(field(grid,'declared_group_gpa','ค่าเฉลี่ยกลุ่มวิชาที่คุณแจ้ง',{type:'number'}),'ค่านี้แยกจากผลคำนวณถ่วงหน่วยกิตของระบบ และไม่ใช้ข้ามเกณฑ์ที่ยังไม่ยืนยัน');s.append(grid);
    const curriculum=current(),groups=GROUPS[curriculum] || [];if(!groups.length){s.append(node('p','application-help','เลือกหลักสูตรเพื่อแสดงกลุ่มวิชา'));return s;}
    selectField(s,'selected_courses','เลือกวิชาทางเลือกที่ใช้ตามหลักสูตร',[['','เลือกวิชา'],['CS213','คพ.213'],['CS216','คพ.216']],draft.selected_courses?.alternative,value=>{draft.selected_courses={alternative:value};});const alternative=draft.selected_courses?.alternative;
    if(alternative)s.append(node('p','application-help',`${alternative==='CS213'?'คพ.216':'คพ.213'}: ไม่ต้องลงทะเบียนตามทางเลือกนี้ ไม่คิดเป็น F หรือศูนย์ ข้อมูลเดิมของอีกวิชายังเก็บอยู่`));
    const grades=node('div','application-grades');grades.id='application-course-attempts';grades.tabIndex=-1;grades.dataset.field='course_attempts';grades.append(node('h3','','รายวิชาที่เคยศึกษา'),node('p','application-help','A=4 · B+=3.5 · B=3 · C+=2.5 · C=2 · D+=1.5 · D=1 · F=0 ระบุทุกครั้งที่เคยเรียน หน่วยกิตแก้ไขเองไม่ได้'));
    for(const group of groups){const code=group.length>1?alternative:group[0];if(!code)continue;const attemptsForCode=(draft.course_attempts || []).filter(x=>x.code===code),records=attemptsForCode.length?attemptsForCode:[{code,attempt:1,points:null}],course=node('section','application-course');course.append(node('h3','',code.replace('CS','คพ.')),node('p','application-help',`หน่วยกิต ${app.policy?.data?.credits?.[code] || 'รอยืนยัน'}`));
      for(const record of records){const row=node('div','application-grade-row'),l=node('label','',`เกรด ${code} ครั้งที่ ${record.attempt} *`),select=node('select','application-input');select.id=`grade-${code}-${record.attempt}`;l.htmlFor=select.id;select.append(new Option('เลือกเกรด',''));for(const [points,letter] of GRADES)select.append(new Option(`${letter} (${points})`,points));
        const value=record.points===null?'':String(record.points),known=GRADES.find(([points])=>value!=='' && Number(points)===Number(value));if(value && !known)select.append(new Option('ค่าที่บันทึกเดิม: '+value,value));select.value=known?known[0]:value;select.disabled=readOnly() || busy;select.setAttribute('aria-required','true');
        select.addEventListener('change',()=>{draft.course_attempts ||= [];let r=draft.course_attempts.find(x=>x.code===code && x.attempt===record.attempt);if(!r){r={...record};draft.course_attempts.push(r);}r.points=select.value===''?null:select.value;changed();});row.append(l,select);
        if(record.attempt>1 && !readOnly())row.append(button(`ลบรายการ ${code} ครั้งที่ ${record.attempt}`,()=>{if(record.points!==null && !window.confirm('ลบผลการเรียนครั้งนี้จากฉบับร่างหรือไม่?'))return;draft.course_attempts=(draft.course_attempts || []).filter(x=>x.code!==code || x.attempt!==record.attempt);changed();render();}));course.append(row);
      }
      if(!readOnly()){const add=button(`เพิ่มครั้งที่เรียน ${code}`,()=>{draft.course_attempts ||= [];if(!attemptsForCode.length)draft.course_attempts.push({...records[0]});draft.course_attempts.push({code,attempt:Math.max(...records.map(x=>x.attempt))+1,points:null});changed();render();});add.disabled=busy || Math.max(...records.map(x=>x.attempt))>=20 || (draft.course_attempts || []).length>=100;course.append(add);}grades.append(course);
    }
    markError(grades,grades,'course_attempts');s.append(grades);if(curriculum==='61')s.append(node('p','application-help','หลักสูตร 61 ใช้ คพ.264 ตามเกณฑ์ข้อความที่ทีมยืนยัน (ตารางอ้างอิงบางภาพพิมพ์ คพ.261 ไม่ตรงกัน)'));
    const extra=node('div','application-grid');extra.id='application-additional-studies';extra.dataset.field='additional_studies';extra.tabIndex=-1;extra.append(node('p','application-help',curriculum==='61'?'ต้องกำลังศึกษา/เคยศึกษา คพ.384 และอย่างน้อยหนึ่งวิชา คพ.266 / 322 / 348':'ต้องกำลังศึกษา/เคยศึกษา คพ.180 และอย่างน้อยหนึ่งวิชา คพ.262 / 331 / 240'));
    for(const code of EXTRAS[curriculum])selectField(extra,'extra-'+code,code.replace('CS','คพ.'),[['NOT_STUDIED','ยังไม่ได้ศึกษา'],['ENROLLED','กำลังศึกษา'],['STUDIED','เคยศึกษา']],draft.additional_studies?.[code] || 'NOT_STUDIED',value=>{draft.additional_studies ||= {};draft.additional_studies[code]=value;});markError(extra,extra,'additional_studies');s.append(extra);return s;
  }
  function declarations(){return [
    ['program','ข้าพเจ้าเป็นนักศึกษาสาขาวิชาวิทยาการคอมพิวเตอร์ คณะวิทยาศาสตร์และเทคโนโลยี มหาวิทยาลัยธรรมศาสตร์'],
    ['required_courses',`ข้าพเจ้าเคยศึกษารายวิชาตามเกณฑ์หลักสูตร ${current() || 'ที่เลือก'} และค่าเฉลี่ยกลุ่มวิชาไม่ต่ำกว่า 2.50`],
    ['additional_courses',current()==='61'?'ข้าพเจ้ากำลังศึกษาหรือเคยศึกษา คพ.384 และอย่างน้อยหนึ่งวิชา คพ.266 / 322 / 348':'ข้าพเจ้ากำลังศึกษาหรือเคยศึกษา คพ.180 และอย่างน้อยหนึ่งวิชา คพ.262 / 331 / 240'],
    ['preplacement',`ข้าพเจ้ารับทราบว่าต้องสอบผ่าน ${current()==='61'?'คพ.302':'คพ.301'} ก่อนออกปฏิบัติงานจริง (ไม่ต้องผ่านแล้วตอนสมัคร)`],
    ['gpax','ข้าพเจ้ามี GPAX เมื่อสิ้นภาคการศึกษาสุดท้ายก่อนสมัครไม่ต่ำกว่า 2.75'],['conduct','ข้าพเจ้ามีความประพฤติเรียบร้อย และไม่เคยถูกลงโทษทางวินัยนักศึกษา'],['terms','ข้าพเจ้ารับทราบเกณฑ์และยอมรับว่าจะปฏิบัติตามเงื่อนไขและกระบวนการสหกิจศึกษาอย่างครบถ้วน']
  ];}
  function interests(){
    const s=card('application-interests','ความสนใจ ทักษะ และคำรับรอง','เลือกตำแหน่งที่สนใจได้มากกว่า 1 ตำแหน่ง เพื่อใช้เป็นข้อมูลประกอบ ไม่ใช่การยืนยันรับเข้าทำงาน'),positions=node('fieldset','application-choice-group');positions.id='application-interested_position_codes';positions.dataset.field='interested_position_codes';positions.tabIndex=-1;positions.append(node('legend','','ตำแหน่งงานที่สนใจ *'));const choices=node('div','application-choice-grid');
    for(const [code,label] of [...POSITIONS,['OTHER','อื่น ๆ']]){const l=node('label','application-checkbox application-position'),input=node('input');input.type='checkbox';input.value=code;input.checked=draft.interested_position_codes?.includes(code) || false;input.disabled=readOnly() || busy;input.addEventListener('change',()=>{const selected=new Set(draft.interested_position_codes || []);input.checked?selected.add(code):selected.delete(code);draft.interested_position_codes=[...selected];changed();const other=root.querySelector('[data-other-position]');if(other)other.hidden=!selected.has('OTHER');});l.append(input,node('span','',label));choices.append(l);}positions.append(choices);markError(positions,positions,'interested_position_codes');s.append(positions);
    if(draft.interested_positions?.length){const legacy=node('div','application-notice');legacy.append(node('p','','ตำแหน่งที่เคยกรอกไว้: '+draft.interested_positions.join(' · ')),node('p','application-help','ข้อมูลเดิมยังอยู่ กรุณาเลือกตัวเลือกด้านบนให้ตรงกันก่อนส่ง ระบบไม่จับคู่ให้เอง'));s.append(legacy);}
    const other=node('div');other.dataset.otherPosition='';other.hidden=!draft.interested_position_codes?.includes('OTHER');field(other,'interested_position_other','ตำแหน่งอื่นที่สนใจ',{max:500});s.append(other);
    const skills=field(s,'skills_detail','ทักษะและความถนัด',{textarea:true,max:5000,value:Object.hasOwn(draft,'skills_detail')?draft.skills_detail:(draft.skills || []).join('\n')});hint(skills,'ระบุภาษาโปรแกรม Frameworks เครื่องมือ ทักษะเฉพาะด้าน หรือทักษะการทำงานร่วมกันได้ ไม่เกิน 5,000 ตัวอักษร');
    s.append(node('h3','application-subheading','ตรวจสอบและรับรองคุณสมบัติ 7 ข้อ'),node('p','application-help','โปรดรับรองตามความจริงด้วยตนเองทุกข้อ การผ่านเกณฑ์เป็นเพียงสิทธิสมัคร ผลคัดเลือกขึ้นอยู่กับคณะกรรมการและภาระงานอาจารย์ การให้ข้อมูลเท็จอาจถูกตัดสิทธิ์'));
    declarations().forEach(([key,label],index)=>{const wrap=node('div'),l=node('label','application-checkbox'),input=node('input');input.type='checkbox';input.id='application-acknowledgements-'+key;input.dataset.field='acknowledgements.'+key;input.checked=draft.acknowledgements?.[key]===true;input.disabled=readOnly() || busy;input.setAttribute('aria-required','true');input.addEventListener('change',()=>{draft.acknowledgements ||= {};draft.acknowledgements[key]=input.checked;changed();});l.append(input,node('span','',`${index+1}. ${label} *`));wrap.append(l);markError(wrap,input,'acknowledgements.'+key);s.append(wrap);});return s;
  }
  function documents(){
    const s=card('application-documents','เอกสารประกอบใบสมัคร','เอกสารบังคับ 4 ประเภท อย่างละ 1 ไฟล์ เปลี่ยนได้ขณะเป็น Draft โดยไฟล์เดิมยังอยู่จนกว่าไฟล์ใหม่บันทึกสำเร็จ');if(app.preview)s.append(node('p','application-warning','Local Preview: เอกสารและการอัปโหลดเป็นข้อมูลจำลอง ไม่ได้ส่งหรือเก็บไฟล์จริง'));const grid=node('div','application-grid'),student=app.official.student_number || 'รหัสนักศึกษา';
    for(const kind of ['photo','transcript','resume','conduct']){const label=FILE_KINDS[kind],c=node('section','application-file');c.id='application-documents-'+kind;c.dataset.field='documents.'+kind;c.tabIndex=-1;const doc=app.documents.find(x=>x.kind===kind),selected=selectedFiles.get(kind),filename=kind==='resume'?`CV-${student}.pdf`:kind==='photo'?`${student}.jpg`:kind==='conduct'?`conduct-${student}.pdf`:`${student}.pdf`;
      c.append(node('h3','',label+' *'),node('p','application-help',kind==='photo'?'JPG / PNG · ไม่เกิน 5 MiB':'PDF · ไม่เกิน 10 MiB'),node('p','application-help','ชื่อไฟล์แนะนำ: '+filename),node('p','application-file-state',doc?`บันทึกแล้ว: ${doc.filename} (${(doc.byte_size/1024).toFixed(1)} KiB)`:'ยังไม่ได้แนบไฟล์'));if(kind==='transcript')c.append(node('p','application-help','แสดงผลการศึกษาตั้งแต่ภาคแรกจนถึงภาคล่าสุด รวมไว้ใน PDF เดียว'));
      if(doc)c.append(button('ดาวน์โหลด '+label,()=>run(async()=>{const blob=await client.download(app.id,doc.id,{signal});if(signal?.aborted)return;const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=doc.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);message='ดาวน์โหลดเอกสารแล้ว';})));
      if(!readOnly()){const l=node('label','',doc?'เลือกไฟล์ใหม่แทน '+label:'เลือกไฟล์ '+label),input=node('input','application-file-input');input.type='file';input.id='file-'+kind;l.htmlFor=input.id;input.accept=kind==='photo'?'.jpg,.jpeg,.png':'application/pdf';input.disabled=busy;
        input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;try{validateApplicationFile(kind,file);selectedFiles.set(kind,file);result=null;confirming=false;message=`เลือก ${file.name} แล้ว กรุณากดอัปโหลด`;errors=[];hasError=false;}catch(e){message=e.message;hasError=true;errors=[{field:'documents.'+kind,message:e.message}];}render();root.querySelector('[data-feedback]')?.focus({preventScroll:true});});c.append(l,input);if(selected)c.append(node('p','application-help','เลือกไว้: '+selected.name+' (ยังไม่ได้บันทึก)'));
        const upload=button('อัปโหลด '+label,()=>run(async()=>{const file=selectedFiles.get(kind);if(!file)return;const op=operation('file-'+kind,{expected_version:app.version,filename:file.name,size:file.size,modified:file.lastModified}),complete=operation('complete-'+kind,{upload_operation:op.operation_id});let updated;
          try{updated=await client.upload(app.id,kind,file,{version:app.version,operationId:op.operation_id,completeOperationId:complete.operation_id,signal,onPhase:phase=>{const status=root.querySelector('[data-upload-status]');if(status)status.textContent=phase;}});}catch(e){if(e.code==='UPLOAD_EXPIRED'){attempts.delete('file-'+kind);attempts.delete('complete-'+kind);}throw e;}
          if(signal?.aborted)return;app=updated;selectedFiles.delete(kind);attempts.delete('file-'+kind);attempts.delete('complete-'+kind);result=null;errors=[];message=`บันทึก ${label} สำเร็จ ข้อมูลที่กรอกในส่วนอื่นยังอยู่`;
        }));upload.disabled=busy || !selected;c.append(upload);
      }markError(c,c,'documents.'+kind);grid.append(c);
    }const status=node('p','application-upload-status',busy?'กำลังทำรายการ…':'');status.dataset.uploadStatus='';status.setAttribute('role','status');s.append(grid,status);return s;
  }
  function guardian(){
    const s=card('application-guardian','ผู้ติดต่อกรณีฉุกเฉิน','กรอกข้อมูลผู้ปกครองที่เป็นปัจจุบันและติดต่อได้จริง'),grid=node('div','application-grid');field(grid,'guardian_name','ชื่อ-นามสกุลผู้ปกครอง');field(grid,'guardian_relationship','ความสัมพันธ์กับนักศึกษา',{max:100});field(grid,'guardian_phone','เบอร์โทรผู้ปกครอง',{type:'tel',max:40});const address=field(grid,'guardian_address','ที่อยู่ผู้ปกครองที่ติดต่อได้',{textarea:true,max:1000});reuseField(address,'ใช้ที่อยู่เดียวกับนักศึกษา',draft.contact_address,{showEmpty:true});s.append(grid);return s;
  }
  function reviewGroup(parent,index,rows){
    const group=node('section','application-review-group'),heading=node('div','application-review-heading'),edit=button(readOnly()?'ดูส่วนนี้':'แก้ไขส่วนนี้',()=>showStep(index));edit.setAttribute('aria-label',(readOnly()?'ดู':'แก้ไข')+STEPS[index][1]);heading.append(node('h3','',STEPS[index][1]),edit);group.append(heading);const dl=node('dl','application-review-values');for(const [label,value] of rows){const item=node('div');item.append(node('dt','',label),node('dd','',value || (readOnly()?'ไม่ได้เก็บข้อมูลนี้ในฉบับที่ส่ง':'ยังไม่ได้กรอก')));dl.append(item);}group.append(dl);parent.append(group);
  }
  function review(){
    const s=card('application-review','ตรวจทานก่อนส่งใบสมัคร','ตรวจข้อมูลและเอกสารให้ครบ การส่งใบสมัครไม่ใช่การได้รับคัดเลือกเข้าแผนสหกิจศึกษา');if(app.status==='SUBMITTED' && (app.form_version || 1)<2)s.append(node('p','application-notice','ใบสมัครนี้ใช้แบบฟอร์มฉบับเดิม ช่องใหม่และคำรับรองเพิ่มเติมจะไม่ถูกเติมย้อนหลัง'));
    reviewGroup(s,0,[['ชื่อทางการ',app.official.full_name],['รหัสนักศึกษา',app.official.student_number],['คำนำหน้า',display('name_prefix')],['ชื่อภาษาไทย',display('thai_full_name')],['ชื่อภาษาอังกฤษ',display('english_full_name')],['อีเมลมหาวิทยาลัย',app.official.institutional_email || draft.institutional_email],['อีเมลติดต่อ',draft.contact_email],['กลุ่มวิชาเอก',MAJORS.find(([code])=>code===draft.major_group)?.[1] || draft.major_group],['โทรศัพท์',draft.contact_phone],['ที่อยู่',draft.contact_address]]);
    const grades=(draft.course_attempts || []).map(r=>`${r.code} ครั้งที่ ${r.attempt}: ${r.points===null?'ยังไม่ระบุ':gradeLabel(r.points)}`).join('\n'),studies=Object.entries(draft.additional_studies || {}).map(([code,status])=>`${code}: ${{ENROLLED:'กำลังศึกษา',STUDIED:'เคยศึกษา',NOT_STUDIED:'ยังไม่ได้ศึกษา'}[status] || status}`).join('\n');reviewGroup(s,1,[['หลักสูตร',current()],['GPAX ที่แจ้ง',draft.gpax],['ภาคการศึกษาตาม Transcript ที่แจ้ง',draft.gpax_reporting_term],['ค่าเฉลี่ยกลุ่มวิชาที่แจ้ง',draft.declared_group_gpa],['วิชาทางเลือก',draft.selected_courses?.alternative],['ผลการเรียนที่แจ้ง',grades],['รายวิชาเพิ่มเติม',studies]]);
    const positions=(draft.interested_position_codes || []).map(code=>code==='OTHER'?'อื่น ๆ: '+(draft.interested_position_other || 'ยังไม่ได้ระบุ'):POSITIONS.find(([key])=>key===code)?.[1] || code).join('\n');reviewGroup(s,2,[['ตำแหน่งที่สนใจ',positions],['ตำแหน่งจากฉบับร่างเดิม',(draft.interested_positions || []).join('\n')],['ทักษะและความถนัด',Object.hasOwn(draft,'skills_detail')?draft.skills_detail:(draft.skills || []).join('\n')],...declarations().map(([key,label])=>[label,draft.acknowledgements?.[key]===true?'รับรองแล้ว':readOnly()?'ไม่ได้รับรองในฉบับนี้':'ยังไม่ได้รับรอง'])]);
    reviewGroup(s,3,Object.entries(FILE_KINDS).map(([kind,label])=>[label,(selectedFiles.has(kind)?'มีไฟล์ใหม่ที่ยังไม่ได้อัปโหลด · ':'')+(app.documents.find(d=>d.kind===kind)?.filename || 'ยังไม่ได้แนบไฟล์')]));reviewGroup(s,4,[['ชื่อผู้ปกครอง',draft.guardian_name],['ความสัมพันธ์',draft.guardian_relationship],['โทรศัพท์',draft.guardian_phone],['ที่อยู่',draft.guardian_address]]);
    if(selectedFiles.size)s.append(node('p','application-warning','ยังมีไฟล์ที่เลือกแต่ไม่ได้อัปโหลด กรุณากลับไปขั้นเอกสารและอัปโหลดให้สำเร็จก่อนส่ง'));
    if(result){const readiness=node('div',result.can_submit?'application-notice':'application-warning');readiness.append(node('h3','',result.can_submit?'ข้อมูลพร้อมสำหรับส่งตรวจ':'ยังมีรายการที่ต้องตรวจสอบ'),node('p','',result.group_gpa?`ค่าเฉลี่ยกลุ่มวิชาที่ระบบคำนวณ ${result.group_gpa} (ถ่วงน้ำหนัก)`:'ยังยืนยันค่าเฉลี่ยกลุ่มวิชาไม่ได้'));s.append(readiness);}
    if(readOnly()){s.append(node('p','application-help',app.status==='SUBMITTED'?`ส่งเมื่อ ${new Date(app.submitted_at).toLocaleString('th-TH')} · ล็อกเอกสาร ${app.documents.length} รายการ`:'รอบปิดรับ ใบสมัครฉบับร่างยังไม่ได้ส่ง'));return s;}
    const actions=node('div','application-actions'),ready=button('ตรวจความพร้อม',()=>run(async()=>{result=await client.readiness(app.id,{signal});errors=result.blockers;message=result.can_submit?'ตรวจข้อมูลเรียบร้อย กรุณาตรวจทานก่อนยืนยันส่ง':'ตรวจพบรายการที่ต้องแก้ไขหรือรอยืนยัน';}));ready.dataset.requiresSaved='';ready.disabled=dirty || busy;actions.append(ready);
    const submit=button('ส่งใบสมัคร',()=>{confirming=true;render();},false);submit.dataset.requiresSaved='';submit.dataset.submit='';submit.disabled=dirty || busy || selectedFiles.size>0 || !result?.can_submit;actions.append(submit);s.append(actions);if(dirty)s.append(node('p','application-help','บันทึกข้อมูลที่แก้ไขก่อนตรวจความพร้อมหรือส่งใบสมัคร'));
    if(confirming){const confirm=node('section','application-confirm');confirm.setAttribute('role','group');confirm.setAttribute('aria-label','ยืนยันส่งใบสมัคร');confirm.append(node('h3','','ยืนยันส่งใบสมัครฉบับนี้หรือไม่?'),node('p','','เมื่อส่งแล้ว ข้อมูลและชุดเอกสารจะถูกล็อกและส่งให้ผู้ประสานงานตรวจสอบ ไม่สามารถแก้ไขเองได้'),node('p','',`ยืนยันใช้เกณฑ์หลักสูตร ${current()} ปีต้นทาง ${app.policy?.source_year || 'รอยืนยัน'} ฉบับ v${app.policy?.version || 'รอยืนยัน'} และรับทราบว่าต้องผ่าน ${current()==='61'?'คพ.302':'คพ.301'} ก่อนออกฝึก`),button('ยืนยันส่งและล็อกข้อมูล',()=>run(async()=>{const body=operation('submit',{expected_version:app.version,expected_policy_id:app.policy?.id || null});const sent=await client.submit(app.id,body,{signal});if(signal?.aborted)return;app=sent;draft=copy(sent.payload);activeStep=5;dirty=false;errors=[];result=null;selectedFiles.clear();message='ส่งใบสมัครสำเร็จ รอผู้ประสานงานตรวจสอบ';}),false),button('ยกเลิกการส่ง',()=>{confirming=false;render();root.querySelector('[data-submit]')?.focus();}));s.append(confirm);queueMicrotask(()=>confirm.querySelector('button')?.focus());}return s;
  }
  function footer(){
    const f=node('div','application-footer');if(!readOnly()){
      const controls=node('div','application-save-controls'),status=node('p','application-help',dirty?'มีข้อมูลที่ยังไม่ได้บันทึก':'ข้อมูลตรงกับฉบับที่บันทึกแล้ว');status.dataset.saveState='';
      controls.append(button('บันทึกฉบับร่าง',()=>run(async()=>{const body=operation('save',{expected_version:app.version,expected_policy_id:app.policy?.id || null,payload:copy(draft)});const saved=await client.save(app.id,body,{signal});if(signal?.aborted)return;app=saved;draft=copy(saved.payload);dirty=false;result=null;attempts.delete('save');errors=[];message='บันทึกฉบับร่างสำเร็จ ยังไม่ได้ส่งใบสมัคร';}),false),status);f.append(controls);
    }
    const nav=node('div','application-footer-navigation');if(activeStep>0)nav.append(button('ย้อนกลับ',()=>showStep(activeStep-1)));if(activeStep<5)nav.append(button(activeStep===4?'ไปตรวจทานใบสมัคร':'ถัดไป',()=>showStep(activeStep+1)));f.append(nav);return f;
  }
  function render(){
    root.replaceChildren();root.setAttribute('aria-busy',String(busy));const back=button('← ใบสมัครทั้งหมด',onBack);back.disabled=busy;root.append(back,header(),feedback());const panels=[identity(),academic(),interests(),documents(),guardian(),review()];panels.forEach((panel,index)=>{panel.classList.add('application-step');panel.hidden=index!==activeStep;panel.dataset.step=String(index+1);root.append(panel);});root.append(footer());
    const reload=button('โหลดข้อมูลล่าสุด',async()=>{if((dirty || selectedFiles.size) && !window.confirm('การโหลดใหม่จะทิ้งข้อมูลและไฟล์ที่เลือกแต่ยังไม่ได้บันทึก ต้องการโหลดฉบับล่าสุดหรือไม่?'))return;await run(async()=>{const fresh=await client.get(app.id,{signal});if(signal?.aborted)return;app=fresh;draft=copy(fresh.payload);dirty=false;result=null;errors=[];selectedFiles.clear();message='โหลดข้อมูลล่าสุดแล้ว';attempts.clear();});});reload.disabled=busy;root.append(reload);if(busy)for(const b of root.querySelectorAll('button'))b.disabled=true;
  }
  render();return root;
}
