import {FILE_KINDS,validateApplicationFile} from './application-client.js';
const GROUPS={'61':[['CS101'],['CS102'],['CS111'],['CS213','CS216'],['CS251'],['CS264']],
  '66':[['CS100'],['CS101'],['CS102'],['CS111'],['CS213','CS216'],['CS251'],['CS261']]};
const EXTRAS={'61':['CS384','CS266','CS322','CS348'],'66':['CS180','CS262','CS331','CS240']};
const copy=v=>JSON.parse(JSON.stringify(v));
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function button(label,fn,secondary=true){const b=node('button',`shell-button${secondary?' shell-button--secondary':''}`,label);b.type='button';b.addEventListener('click',fn);return b;}
export function renderApplicationEditor({client,application,signal,onSessionExpired,onBack,setLeaveGuard}={}) {
  const root=node('div','application-editor');let app=application,draft=copy(app.payload),dirty=false,busy=false,result=null;
  const selectedFiles=new Map(),attempts=new Map();let message='',errors=[],confirming=false,hasError=false;
  const readOnly=()=>app.status!=='DRAFT' || app.availability?.can_edit===false;
  const canLeave=()=>!(dirty || busy || selectedFiles.size) || window.confirm(busy?'กำลังทำรายการ ผลอาจถูกบันทึกแล้ว ต้องการออกจากหน้านี้หรือไม่?':'ยังมีข้อมูลหรือไฟล์ที่ไม่ได้บันทึก ต้องการออกจากหน้านี้และทิ้งข้อมูลที่กรอกหรือไม่?');
  setLeaveGuard?.(canLeave);
  const beforeUnload=e=>{if(dirty || busy || selectedFiles.size){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  signal?.addEventListener('abort',()=>{window.removeEventListener('beforeunload',beforeUnload);selectedFiles.clear();attempts.clear();},{once:true});
  const current=()=>app.official.curriculum || draft.curriculum || '';
  function changed(){dirty=true;result=null;confirming=false;root.querySelector('[data-save-state]').textContent='มีข้อมูลที่ยังไม่ได้บันทึก';
    for(const b of root.querySelectorAll('[data-requires-saved]'))b.disabled=true;}
  function operation(key,body){const signature=JSON.stringify(body);if(attempts.get(key)?.signature!==signature)attempts.set(key,{signature,body:{...body,operation_id:crypto.randomUUID()}});return attempts.get(key).body;}
  function fail(e){
    if(e.name==='AbortError' || signal?.aborted)return;
    if(e.code==='SESSION_EXPIRED'){onSessionExpired?.();return;}
    hasError=true;
    message=e.message || 'ทำรายการไม่สำเร็จ ข้อมูลที่กรอกยังอยู่';errors=Array.isArray(e.details)?e.details:[];
    if(['STALE_RECORD_CONFLICT','POLICY_CHANGED'].includes(e.code))message+=' — โหลดข้อมูลล่าสุดได้ด้านล่าง โดยระบบจะถามก่อนทิ้งข้อมูลที่คุณกรอก';
  }
  async function run(work){if(busy || signal?.aborted)return;busy=true;confirming=false;hasError=false;render();
    try{await work();}catch(e){fail(e);}finally{busy=false;if(!signal?.aborted){render();if(errors.length || message)root.querySelector('[data-feedback]')?.focus({preventScroll:true});}}}
  function feedback(){const area=node('div',errors.length || hasError?'application-error':'application-notice');area.dataset.feedback='';area.tabIndex=-1;
    area.setAttribute('role',errors.length || hasError?'alert':'status');area.append(node('p','',message || 'ข้อมูลทางการอ่านอย่างเดียว บันทึกฉบับร่างได้แม้ยังกรอกไม่ครบ'));
    if(errors.length){const list=node('ul');for(const error of errors){const li=node('li'),link=node('a','',error.message || 'กรุณาตรวจข้อมูล');
      const key=error.field || '',find=()=>Array.from(root.querySelectorAll('[data-field]')).find(x=>x.dataset.field===key),target=find();
      link.href=target?`#${target.id}`:'#application-policy';link.addEventListener('click',e=>{e.preventDefault();(find() || root.querySelector('#application-policy'))?.focus();});
      li.append(link);list.append(li);}area.append(list);}return area;}
  function card(id,title,subtitle){const s=node('section','application-card');s.id=id;s.tabIndex=-1;
    s.append(node('h2','',title));if(subtitle)s.append(node('p','application-help',subtitle));return s;}
  function field(parent,key,label,{textarea=false,type='text',max=200,readonly=false,value}={}){
    const wrap=node('div','application-field'),l=node('label','',label),i=node(textarea?'textarea':'input','application-input');
    i.id='application-'+key.replaceAll('.','-');i.dataset.field=key;l.htmlFor=i.id;
    if(!textarea)i.type=type;i.maxLength=max;if(type==='number'){i.min='0';i.max='4';i.step='0.0001';}
    i.value=value ?? draft[key] ?? '';i.readOnly=readonly || readOnly();i.disabled=busy;
    i.addEventListener('input',()=>{draft[key]=i.value;changed();});
    wrap.append(l,i);markError(wrap,i,key);parent.append(wrap);return i;
  }
  function markError(wrap,i,key){const matches=errors.filter(e=>e.field===key);if(matches.length){const e=node('p','application-field-error',matches.map(x=>x.message).join(' · '));
    e.id=i.id+'-error';i.setAttribute('aria-invalid','true');i.setAttribute('aria-describedby',e.id);wrap.append(e);}}
  function selectField(parent,key,label,options,value,onChange){const wrap=node('div','application-field'),l=node('label','',label),s=node('select','application-input');
    s.id='application-'+key.replaceAll('.','-');s.dataset.field=key;l.htmlFor=s.id;for(const [v,text] of options)s.append(new Option(text,v));s.value=value || '';
    s.disabled=readOnly() || busy;s.addEventListener('change',()=>{onChange(s.value);changed();render();});wrap.append(l,s);markError(wrap,s,key);parent.append(wrap);return s;}
  function header(){const top=card('application-summary',app.cycle_name || 'ใบสมัครเข้าแผนสหกิจศึกษา',`รหัสใบสมัคร ${app.id} · เวอร์ชัน ${app.version}`);
    const state=node('p','application-badge',app.status==='SUBMITTED'?'ส่งแล้ว · รอผู้ประสานงานตรวจสอบ':readOnly()?'รอบปิด / หมดเวลา · อ่านอย่างเดียว':'ฉบับร่าง · ยังไม่ได้ส่ง');
    const saved=node('p','application-help',dirty?'มีข้อมูลที่ยังไม่ได้บันทึก':'ข้อมูลตรงกับฉบับที่บันทึกแล้ว');saved.dataset.saveState='';
    top.append(state,saved);
    if(readOnly())top.append(node('p','application-notice',app.status==='SUBMITTED'?'ข้อมูลและเอกสารถูกล็อกไว้ตามฉบับที่ส่ง การส่งใบสมัครยังไม่ใช่การได้รับคัดเลือกเข้าแผน':'ใบสมัครนี้ยังไม่ได้ส่ง แต่รอบไม่เปิดให้แก้ไขแล้ว ข้อมูลที่บันทึกยังดูและดาวน์โหลดได้'));
    const nav=node('nav','application-steps');nav.setAttribute('aria-label','ส่วนของใบสมัคร');
    for(const [id,label] of [['identity','1 ข้อมูล'],['academic','2 ผลการเรียน'],['documents','3 เอกสาร'],['consent','4 ตรวจและส่ง']]){
      const a=node('a','',label);a.href='#application-'+id;a.addEventListener('click',e=>{e.preventDefault();const target=root.querySelector(a.getAttribute('href'));target?.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});target?.focus({preventScroll:true});});nav.append(a);}
    top.append(nav);return top;
  }
  function identity(){const s=card('application-identity','01 · ข้อมูลผู้สมัคร','ตรวจสอบชื่อ รหัสนักศึกษา และข้อมูลมหาวิทยาลัย หากไม่ถูกต้องให้ติดต่อผู้ประสานงาน');
    const official=node('dl','application-official application-grid');
    for(const [key,label] of [['full_name','ชื่อ-นามสกุลทางการ'],['student_number','รหัสนักศึกษา'],['department','ภาควิชา'],['program','หลักสูตร'],['entry_year','ปีที่เข้าศึกษา']]){
      const d=node('div');d.append(node('dt','',label),node('dd','',String(app.official[key] || 'รอยืนยันข้อมูล')));official.append(d);}
    s.append(official);const grid=node('div','application-grid');
    field(grid,'institutional_email','อีเมลมหาวิทยาลัย',{type:'email',max:254,readonly:Boolean(app.official.institutional_email),value:app.official.institutional_email || draft.institutional_email});
    field(grid,'major_group','กลุ่มวิชา / สาขาที่เรียน',{max:100});
    field(grid,'contact_phone','เบอร์โทรติดต่อ',{type:'tel',max:40});
    field(grid,'contact_address','ที่อยู่ที่ติดต่อได้',{textarea:true,max:1000});
    field(grid,'guardian_name','ชื่อ-นามสกุลผู้ปกครอง');field(grid,'guardian_relationship','ความสัมพันธ์กับผู้สมัคร',{max:100});
    field(grid,'guardian_phone','เบอร์โทรผู้ปกครอง',{type:'tel',max:40});field(grid,'guardian_address','ที่อยู่ผู้ปกครอง',{textarea:true,max:1000});
    for(const [key,label] of [['interested_positions','ตำแหน่งงานที่สนใจ'],['skills','ทักษะ / ความถนัด']]){
      const i=field(grid,key,label,{textarea:true,max:3600,value:(draft[key] || []).join('\n')});
      i.addEventListener('input',()=>{draft[key]=i.value.split('\n').map(x=>x.trim()).filter(Boolean);});
      const hint=node('p','application-help','แยกแต่ละรายการด้วยการขึ้นบรรทัดใหม่ ไม่เกิน 30 รายการ รายการละ 120 ตัวอักษร');hint.id=i.id+'-hint';i.setAttribute('aria-describedby',hint.id);i.parentElement.append(hint);
    }
    s.append(grid);return s;
  }
  function academic(){const s=card('application-academic','02 · ผลการเรียนและเกณฑ์เบื้องต้น','เกณฑ์ต้นทางปี 2568 ที่ทีมใช้เป็นฐานสำหรับ 1/69 ไม่ใช่ประกาศทางการปี 2569');
    const policy=node('div',app.policy?.verified && !app.policy.synthetic?'application-notice':'application-warning');policy.id='application-policy';policy.tabIndex=-1;
    policy.append(node('strong','',!app.policy?.verified?'รอยืนยันข้อมูลเกณฑ์':app.policy.synthetic?'ข้อมูลสมมติสำหรับ Preview / Tests เท่านั้น':'ใช้เกณฑ์ที่ยืนยันแล้ว'),
      node('p','','GPAX ≥ 2.75 · ค่าเฉลี่ยกลุ่มวิชา ≥ 2.50 แบบถ่วงหน่วยกิต · รหัส 67 ลงไป'));
    policy.append(node('p','',app.policy?`ที่มา: ${app.policy.source} · ปีต้นทาง ${app.policy.source_year} · เกณฑ์ v${app.policy.version}`:'ยังไม่มีหน่วยกิตและกติกาเรียนซ้ำที่ทีมยืนยัน บันทึก Draft และอัปโหลดได้ แต่ยังส่งใบสมัครจริงไม่ได้'));
    s.append(policy);const grid=node('div','application-grid');
    selectField(grid,'curriculum','หลักสูตร',[['','เลือกหลักสูตร'],['61','หลักสูตร 2561'],['66','หลักสูตร 2566']],current(),value=>draft.curriculum=value).disabled=Boolean(app.official.curriculum) || readOnly() || busy;
    field(grid,'gpax','GPAX ณ สิ้นภาคก่อนสมัคร',{type:'number'});s.append(grid);
    const curriculum=current(),groups=GROUPS[curriculum] || [];
    if(!groups.length){s.append(node('p','application-help','เลือกหลักสูตรเพื่อแสดงกลุ่มวิชา'));return s;}
    selectField(s,'selected_courses','วิชาทางเลือกที่จะนำมาคำนวณ',[['','เลือกวิชา'],['CS213','คพ.213'],['CS216','คพ.216']],draft.selected_courses?.alternative,value=>draft.selected_courses={alternative:value});
    const grades=node('div','application-grades');grades.id='application-course-attempts';grades.tabIndex=-1;grades.dataset.field='course_attempts';
    grades.append(node('p','application-help','ระบุเกรด 0–4 ของทุกครั้งที่เคยเรียน หน่วยกิตไม่สามารถแก้ไขเองได้ และจะไม่คำนวณว่าผ่านหากเกณฑ์ยังไม่ยืนยัน'));
    for(const group of groups){const code=group.length>1?draft.selected_courses?.alternative:group[0];if(!code)continue;
      const attemptsForCode=(draft.course_attempts || []).filter(x=>x.code===code);
      const records=attemptsForCode.length?attemptsForCode:[{code,attempt:1,points:null}];
      for(const record of records){const row=node('div','application-grade-row');row.append(node('strong','',`${code} · ครั้งที่ ${record.attempt}`),node('span','application-help',`หน่วยกิต ${app.policy?.data?.credits?.[code] || 'รอยืนยัน'}`));
        const label=node('label','',`เกรด ${code} ครั้งที่ ${record.attempt}`),i=node('input','application-input');i.id=`grade-${code}-${record.attempt}`;label.htmlFor=i.id;
        i.type='number';i.min='0';i.max='4';i.step='0.0001';i.value=record.points ?? '';i.readOnly=readOnly();i.disabled=busy;
        i.addEventListener('input',()=>{draft.course_attempts ||= [];let r=draft.course_attempts.find(x=>x.code===code && x.attempt===record.attempt);
          if(!r){r={...record};draft.course_attempts.push(r);}r.points=i.value===''?null:i.value;changed();});row.append(label,i);grades.append(row);}
      if(!readOnly()){
        for(const record of records.filter(x=>x.attempt>1))grades.append(button(`ลบรายการ ${code} ครั้งที่ ${record.attempt}`,()=>{
          draft.course_attempts=(draft.course_attempts || []).filter(x=>x.code!==code || x.attempt!==record.attempt);changed();render();
        }));
        const add=button(`เพิ่มครั้งที่เรียน ${code}`,()=>{draft.course_attempts ||= [];if(!attemptsForCode.length)draft.course_attempts.push({...records[0]});
          draft.course_attempts.push({code,attempt:Math.max(...records.map(x=>x.attempt))+1,points:null});changed();render();});
        add.disabled=busy || Math.max(...records.map(x=>x.attempt))>=20 || (draft.course_attempts || []).length>=100;grades.append(add);
      }
    }
    s.append(grades);const extra=node('div','application-grid');extra.id='application-additional-studies';extra.dataset.field='additional_studies';extra.tabIndex=-1;
    extra.append(node('p','application-help',curriculum==='61'?'ต้องกำลังศึกษา/เคยศึกษา CS384 และอย่างน้อยหนึ่งวิชา CS266 / CS322 / CS348':'ต้องกำลังศึกษา/เคยศึกษา CS180 และอย่างน้อยหนึ่งวิชา CS262 / CS331 / CS240'));
    for(const code of EXTRAS[curriculum])selectField(extra,'extra-'+code,code,[['NOT_STUDIED','ยังไม่ได้ศึกษา'],['ENROLLED','กำลังศึกษา'],['STUDIED','เคยศึกษา']],draft.additional_studies?.[code] || 'NOT_STUDIED',value=>{draft.additional_studies ||= {};draft.additional_studies[code]=value;});
    s.append(extra);return s;
  }
  function documents(){const s=card('application-documents','03 · เอกสารประกอบใบสมัคร','หนึ่งไฟล์ต่อประเภท เปลี่ยนได้ขณะเป็น Draft โดยไฟล์เดิมยังอยู่จนกว่าไฟล์ใหม่จะบันทึกสำเร็จ');
    if(app.preview)s.append(node('p','application-warning','Local Preview: เอกสารและการอัปโหลดเป็นข้อมูลจำลอง ไม่ได้ส่งหรือเก็บไฟล์จริง'));
    const grid=node('div','application-grid');
    for(const [kind,label] of Object.entries(FILE_KINDS)){
      const c=node('section','application-file');c.id='application-documents-'+kind;c.dataset.field='documents.'+kind;c.tabIndex=-1;
      const doc=app.documents.find(x=>x.kind===kind),selected=selectedFiles.get(kind);
      c.append(node('h3','',label),node('p','application-help',kind==='photo'?'JPG / PNG · ไม่เกิน 5 MiB':'PDF · ไม่เกิน 10 MiB'),
        node('p','',doc?`บันทึกแล้ว: ${doc.filename} (${(doc.byte_size/1024).toFixed(1)} KiB)`:'ยังไม่ได้แนบไฟล์'));
      if(doc)c.append(button('ดาวน์โหลด '+label,()=>run(async()=>{const blob=await client.download(app.id,doc.id,{signal});if(signal?.aborted)return;
        const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=doc.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);message='ดาวน์โหลดเอกสารแล้ว';})));
      if(!readOnly()){
        const l=node('label','',doc?'เลือกไฟล์ใหม่แทน '+label:'เลือกไฟล์ '+label),i=node('input','application-file-input');i.type='file';i.id='file-'+kind;l.htmlFor=i.id;
        i.accept=kind==='photo'?'.jpg,.jpeg,.png':'application/pdf';i.disabled=busy;
        i.addEventListener('change',()=>{const file=i.files?.[0];if(!file)return;
          try{validateApplicationFile(kind,file);selectedFiles.set(kind,file);message=`เลือก ${file.name} แล้ว กรุณากดอัปโหลด`;errors=[];}
          catch(e){selectedFiles.delete(kind);message=e.message;errors=[{field:'documents.'+kind,message:e.message}];}render();});c.append(l,i);
        if(selected)c.append(node('p','application-help','เลือกไว้: '+selected.name+' (ยังไม่ได้บันทึก)'));
        const upload=button('อัปโหลด '+label,()=>run(async()=>{
          const file=selectedFiles.get(kind);if(!file)return;
          const op=operation('file-'+kind,{expected_version:app.version,filename:file.name,size:file.size,modified:file.lastModified});
          const complete=operation('complete-'+kind,{upload_operation:op.operation_id});
          let updated;try{updated=await client.upload(app.id,kind,file,{version:app.version,operationId:op.operation_id,completeOperationId:complete.operation_id,signal,
            onPhase:phase=>{const status=root.querySelector('[data-upload-status]');if(status)status.textContent=phase;}});}
          catch(e){if(e.code==='UPLOAD_EXPIRED'){attempts.delete('file-'+kind);attempts.delete('complete-'+kind);}throw e;}
          if(signal?.aborted)return;app=updated;selectedFiles.delete(kind);attempts.delete('file-'+kind);attempts.delete('complete-'+kind);result=null;message=`บันทึก ${label} สำเร็จ ข้อมูลที่กรอกในส่วนอื่นยังอยู่`;
        }));upload.disabled=busy || !selected;c.append(upload);
      }grid.append(c);
    }
    const uploadStatus=node('p','application-help');uploadStatus.dataset.uploadStatus='';uploadStatus.setAttribute('role','status');s.append(grid,uploadStatus);return s;
  }
  function consent(){const s=card('application-consent','04 · รับทราบและตรวจความพร้อม','ผลคำนวณเป็นการตรวจเบื้องต้น สิทธิสมัครไม่ใช่การได้รับคัดเลือก ผลคัดเลือกเป็นไปตามคณะกรรมการและภาระงานอาจารย์');
    for(const [key,label] of [['conduct','ข้าพเจ้ามีความประพฤติเรียบร้อย และไม่เคยถูกลงโทษทางวินัยนักศึกษา'],
      ['terms','ข้าพเจ้ารับทราบเกณฑ์และยอมรับว่าจะปฏิบัติตามเงื่อนไขและกระบวนการสหกิจศึกษาอย่างครบถ้วน'],
      ['preplacement',`ข้าพเจ้ารับทราบว่าต้องสอบผ่าน ${current()==='61'?'คพ.302':'คพ.301'} ก่อนออกปฏิบัติงานจริง (ไม่ต้องผ่านแล้วตอนสมัคร)`]]){
      const l=node('label','application-checkbox'),i=node('input');i.type='checkbox';i.id='application-acknowledgements-'+key;i.dataset.field='acknowledgements.'+key;
      i.checked=draft.acknowledgements?.[key]===true;i.disabled=readOnly() || busy;
      i.addEventListener('change',()=>{draft.acknowledgements ||= {};draft.acknowledgements[key]=i.checked;changed();});l.append(i,node('span','',label));s.append(l);}
    if(result){const readiness=node('div',result.can_submit?'application-notice':'application-warning');
      readiness.append(node('h3','',result.can_submit?'ข้อมูลพร้อมสำหรับส่งตรวจ':'ยังมีรายการที่ต้องตรวจสอบ'),
        node('p','',result.group_gpa?`ค่าเฉลี่ยกลุ่มวิชา ${result.group_gpa} (ถ่วงน้ำหนัก)`:'ยังยืนยันค่าเฉลี่ยกลุ่มวิชาไม่ได้'));
      s.append(readiness);}
    if(readOnly()){s.append(node('p','application-help',app.status==='SUBMITTED'?`ส่งเมื่อ ${new Date(app.submitted_at).toLocaleString('th-TH')} · ล็อกเอกสาร ${app.documents.length} รายการ`:'รอบปิดรับ ใบสมัครฉบับร่างยังไม่ได้ส่ง'));return s;}
    const actions=node('div','application-actions');
    actions.append(button('บันทึกฉบับร่าง',()=>run(async()=>{
      const body=operation('save',{expected_version:app.version,expected_policy_id:app.policy?.id || null,payload:copy(draft)});
      const saved=await client.save(app.id,body,{signal});if(signal?.aborted)return;app=saved;draft=copy(saved.payload);dirty=false;result=null;attempts.delete('save');errors=[];message='บันทึกฉบับร่างสำเร็จ ยังไม่ได้ส่งใบสมัคร';
    }),false));
    const ready=button('ตรวจความพร้อม',()=>run(async()=>{result=await client.readiness(app.id,{signal});errors=result.blockers;message=result.can_submit?'ตรวจข้อมูลเรียบร้อย กรุณาตรวจทานก่อนยืนยันส่ง':'ตรวจพบรายการที่ต้องแก้ไขหรือรอยืนยัน';}));
    ready.dataset.requiresSaved='';ready.disabled=dirty || busy;actions.append(ready);
    const submit=button('ส่งใบสมัคร',()=>{confirming=true;render();},false);submit.dataset.requiresSaved='';submit.disabled=dirty || busy || selectedFiles.size>0 || !result?.can_submit;actions.append(submit);s.append(actions);
    if(dirty)s.append(node('p','application-help','บันทึกข้อมูลที่แก้ไขก่อนตรวจความพร้อมหรือส่งใบสมัคร'));
    if(confirming){const confirm=node('section','application-confirm');confirm.setAttribute('role','group');confirm.setAttribute('aria-label','ยืนยันส่งใบสมัคร');
      confirm.append(node('h3','','ยืนยันส่งใบสมัครฉบับนี้หรือไม่?'),node('p','','เมื่อส่งแล้ว ข้อมูลและชุดเอกสารจะถูกล็อกและส่งให้ผู้ประสานงานตรวจสอบ ไม่สามารถแก้ไขเองได้'),
        button('ยืนยันส่งและล็อกข้อมูล',()=>run(async()=>{const body=operation('submit',{expected_version:app.version,expected_policy_id:app.policy?.id || null});
          const sent=await client.submit(app.id,body,{signal});if(signal?.aborted)return;app=sent;draft=copy(sent.payload);dirty=false;errors=[];result=null;selectedFiles.clear();message='ส่งใบสมัครสำเร็จ รอผู้ประสานงานตรวจสอบ';}),false),
        button('ยกเลิกการส่ง',()=>{confirming=false;render();}));s.append(confirm);queueMicrotask(()=>confirm.querySelector('button')?.focus());}
    return s;
  }
  function render(){root.replaceChildren();root.setAttribute('aria-busy',String(busy));
    const back=button('← ใบสมัครทั้งหมด',onBack);back.disabled=busy;root.append(back,header(),identity(),academic(),documents(),consent());
    root.insertBefore(feedback(),root.children[2]);
    const reload=button('โหลดข้อมูลล่าสุด',async()=>{
      if(dirty && !window.confirm('การโหลดใหม่จะทิ้งข้อมูลที่ยังไม่ได้บันทึก ต้องการโหลดฉบับล่าสุดหรือไม่?'))return;
      await run(async()=>{const fresh=await client.get(app.id,{signal});if(signal?.aborted)return;app=fresh;draft=copy(fresh.payload);dirty=false;result=null;errors=[];message='โหลดข้อมูลล่าสุดแล้ว';attempts.clear();});
    });reload.disabled=busy;root.append(reload);
    if(busy)for(const b of root.querySelectorAll('button'))b.disabled=true;
  }
  render();return root;
}
