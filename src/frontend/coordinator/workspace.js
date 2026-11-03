import {renderStudentPageHeader} from '../student/workspace-components.js';
import {el,text,score,date,button,badge,field,select,table,note,dialog,bangkokInput,feedback} from './components.js';
import {renderDetail} from './detail.js';
const ROOT='/api/v4/coordinator';
const PAGE={review:['รับแผนสหกิจศึกษา','ตรวจใบสมัคร รับเรื่อง และส่งต่อกรรมการ'],tracking:['ติดตามการพิจารณา','ดูข้อมูลเรียงลำดับ และติดตามมติคณะกรรมการ'],schedule:['กำหนดการและช่วงเวลายืนยันสิทธิ์','ตั้งค่าวัน–เวลาของแต่ละช่วงในรอบสหกิจศึกษา']};
const WINDOWS=[['ช่วงรับสมัคร','opens_at','เปิดรับสมัคร','closes_at','ปิดรับสมัคร'],['ช่วงพิจารณาใบสมัคร','review_opens_at','เริ่มพิจารณา','review_closes_at','สิ้นสุดการพิจารณา'],['ช่วงยืนยันสิทธิ์','confirmation_opens_at','เริ่มยืนยันสิทธิ์','confirmation_closes_at','หมดเขตยืนยันสิทธิ์']];

export function renderCoordinatorWorkspace({client,applicationClient,page='review',signal,onSessionExpired,onAccessDenied,setLeaveGuard}={}) {
  const root=el('div','coord-workspace');root.dataset.coordinatorPage='true';
  const content=el('div','coord-content'),status=el('p','coord-feedback');status.tabIndex=-1;status.setAttribute('role','status');
  let cycleId='',cycles=[],pageNo=1,selectedId=null,activeTab='summary',detailToken=0,queryToken=0,busy=false,dirty=false,currentSchedule=null,scheduleAttempt=null;
  let filters={search:'',state:'',curriculum:'',program_type:'',sort:page==='tracking'?'core':'newest'},searchTimer,requestController;
  const attempts=new Map(),urls=new Set();
  const canLeave=()=>!(dirty || busy) || window.confirm(busy?'กำลังทำรายการ ผลอาจถูกบันทึกแล้ว ต้องการออกจากหน้านี้หรือไม่?':'มีการแก้กำหนดการที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขหรือไม่?');setLeaveGuard?.(canLeave);
  const unload=e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
  signal?.addEventListener('abort',()=>{clearTimeout(searchTimer);requestController?.abort();detailToken++;queryToken++;window.removeEventListener('beforeunload',unload);for(const u of urls)URL.revokeObjectURL(u);},{once:true});
  const stopped=()=>signal?.aborted;
  function failure(error){if(stopped()||error.name==='AbortError')return;if(error.status===401||error.code==='SESSION_EXPIRED'){onSessionExpired?.();return;}
    if(error.status===403||error.code==='ACCESS_DENIED'){onAccessDenied?.('ไม่มีสิทธิ์ทำรายการในขอบเขตนี้');return;}feedback(status,error.message || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่',true);}
  function header(){const meta=el('div','student-page-header__meta'),picker=el('select','coord-cycle');picker.setAttribute('aria-label','รอบรับสมัคร');
    for(const cycle of cycles)picker.append(new Option(cycle.name,cycle.id));picker.value=cycleId;picker.disabled=!cycles.length || busy;
    picker.addEventListener('change',()=>{if(busy){picker.value=cycleId;feedback(status,'กรุณารอทำรายการปัจจุบันให้เสร็จก่อนเปลี่ยนรอบ');return;}if(dirty&&!canLeave()){picker.value=cycleId;return;}cycleId=picker.value;dirty=false;pageNo=1;selectedId=null;scheduleAttempt=null;attempts.clear();drawHeader();load();});
    meta.append(picker);return renderStudentPageHeader({title:PAGE[page][0],description:PAGE[page][1],meta});}
  let heading=header();root.append(heading,content);
  function drawHeader(){const next=header();heading.replaceWith(next);heading=next;}
  function request(path,options={}){return client.request(ROOT+path,{signal,...options});}
  function attempt(id,body){const signature=JSON.stringify(body),old=attempts.get(id);if(old?.signature===signature)return old.body;const value={...body,operation_id:crypto.randomUUID()};attempts.set(id,{signature,body:value});return value;}
  async function download(record,doc){if(!applicationClient?.download){feedback(status,'ไม่พร้อมเปิดเอกสาร กรุณาโหลดหน้าใหม่',true);return;}
    feedback(status,'กำลังเตรียมเอกสาร…');try{const blob=await applicationClient.download(record.id,doc.id,{signal});if(stopped())return;const url=URL.createObjectURL(blob);urls.add(url);
      const link=el('a','coord-button coord-button--outline','เปิดเอกสาร '+doc.filename);link.href=url;link.target='_blank';link.rel='noopener noreferrer';status.replaceChildren(el('span','','เตรียมเอกสารแล้ว '),link);link.click();
    }catch(e){failure(e);}}
  function paginate(host,data,refresh){const n=el('nav','coord-pagination');n.setAttribute('aria-label','หน้าใบสมัคร');const pages=Math.max(1,Math.ceil(data.total/data.pageSize));
    const previous=button('ก่อนหน้า',()=>{pageNo--;refresh();}),next=button('ถัดไป',()=>{pageNo++;refresh();});previous.disabled=pageNo<=1;next.disabled=pageNo>=pages;
    n.append(el('span','',data.total?`แสดง ${(pageNo-1)*data.pageSize+1}–${Math.min(pageNo*data.pageSize,data.total)} จาก ${data.total} รายการ`:'ไม่พบรายการ'),previous,el('span','',`${pageNo} / ${pages}`),next);host.append(n);}
  function filterBar(host,refresh){const bar=el('form','coord-filters');bar.setAttribute('aria-label','กรองใบสมัคร');bar.addEventListener('submit',e=>{e.preventDefault();clearTimeout(searchTimer);pageNo=1;refresh();});
    const search=el('input');search.type='search';search.placeholder='รหัสนักศึกษา หรือชื่อ–นามสกุล';search.value=filters.search;search.maxLength=200;
    search.addEventListener('input',()=>{filters.search=search.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{pageNo=1;refresh();},250);});bar.append(field('ค้นหานักศึกษา',search));
    const add=(key,label,choices)=>{const item=select(label,choices,filters[key],()=>{filters[key]=item.control.value;pageNo=1;refresh();});bar.append(item.element);return item.control;};
    let state;if(page==='review')state=add('state','สถานะใบสมัคร',[['','ทั้งหมด'],['PENDING','รอตรวจสอบ'],['RETURNED','ส่งกลับแก้ไข'],['FORWARDED','ส่งต่อกรรมการแล้ว']]);
    add('curriculum','หลักสูตร',[['','ทั้งหมด'],['66','หลักสูตร 66'],['61','หลักสูตร 61']]);
    add('program_type','ประเภทหลักสูตร',[['','ทั้งหมด'],['regular','ภาคปกติ'],['special','ภาคพิเศษ'],['unknown','รอยืนยันประเภท']]);
    add('sort','เรียงลำดับ',page==='tracking'?[['core','เฉลี่ยวิชาหลักมากไปน้อย'],['gpax','GPAX มากไปน้อย']]:[['newest','ส่งล่าสุดก่อน'],['oldest','ส่งเก่าสุดก่อน'],['name','ชื่อ–นามสกุล']]);
    if(page==='tracking'){bar.classList.add('coord-filters--tracking');bar.lastElementChild.append(el('small','coord-muted',filters.sort==='gpax'?'คะแนนเท่ากัน เรียงตามเฉลี่ยวิชาหลัก':'คะแนนเท่ากัน เรียงตาม GPAX'));}host.append(bar);return {state};}
  function query(){const q=new URLSearchParams({cycle_id:cycleId,page:String(pageNo),pageSize:page==='review'?'8':'20'});for(const [key,value] of Object.entries(filters))if(value.trim() && !(page==='tracking'&&key==='state'))q.set(key,value.trim());return q;}
  function returnForm(record,refresh){if(busy)return;const form=el('form','coord-return-form'),reason=el('textarea');reason.required=true;reason.maxLength=2000;reason.rows=4;form.append(field('เหตุผลที่ส่งกลับแก้ไข',reason),note('นักศึกษาที่ถูกส่งกลับแก้ไขและส่งซ้ำได้จนสิ้นสุดช่วงพิจารณา โดยเก็บฉบับเดิมไว้'));
    const message=el('p','coord-feedback');message.setAttribute('role','status');let pending=false;
    const confirm=button('ยืนยันส่งกลับแก้ไข',null,{primary:true});confirm.type='submit';form.append(message,confirm);
    const modal=dialog(root,'ส่งกลับแก้ไขใบสมัคร',form,{signal,canClose:()=>!pending});
    modal.addEventListener('cancel',e=>{if(pending)e.preventDefault();});
    form.addEventListener('submit',async e=>{e.preventDefault();if(pending||!reason.value.trim()){reason.focus();return;}pending=true;busy=true;confirm.disabled=true;reason.readOnly=true;
      const body=attempt('return-'+record.id,{expected_version:record.review_version,submission_id:record.submission_id,reason:reason.value.trim()});
      try{await request('/applications/'+record.id+'/return',{method:'POST',body});if(stopped())return;attempts.delete('return-'+record.id);modal.close();feedback(status,'ส่งกลับแก้ไขแล้ว');await refresh();}
      catch(error){if(!stopped()){feedback(message,(error.message || 'ยังยืนยันผลไม่ได้')+' · เหตุผลที่กรอกยังอยู่ ลองรายการเดิมซ้ำได้',true);message.tabIndex=-1;message.focus();if(error.status===401)onSessionExpired?.();if(error.status===403)onAccessDenied?.('ไม่มีสิทธิ์ทำรายการในขอบเขตนี้');}}
      finally{pending=false;busy=false;confirm.disabled=false;reason.readOnly=false;}
    });reason.focus();}
  async function forward(record,refresh){if(busy)return;
    const review=el('div','coord-forward-confirmation'),applicant=el('section','coord-confirm-applicant');
    applicant.append(el('span','coord-confirm-applicant__label','ใบสมัครที่จะรับเรื่องและส่งต่อ'),el('strong','coord-confirm-applicant__name',text(record.full_name)),el('span','coord-confirm-applicant__number','รหัสนักศึกษา '+text(record.student_number)));
    const question=el('p','coord-confirm-question','รับเรื่องและส่งใบสมัครของนักศึกษารายนี้ให้กรรมการพิจารณาหรือไม่?');
    review.append(applicant,question,note('การรับเรื่องไม่ใช่ผลคัดเลือก และไม่สามารถส่งกลับแก้ไขหลังส่งต่อแล้ว'));
    const confirm=button('รับเรื่องและส่งต่อกรรมการ',async()=>{if(busy)return;busy=true;confirm.disabled=true;
      try{await request('/applications/'+record.id+'/forward',{method:'POST',body:attempt('forward-'+record.id,{expected_version:record.review_version,submission_id:record.submission_id})});if(stopped())return;attempts.delete('forward-'+record.id);modal.close();feedback(status,'รับเรื่องและส่งต่อกรรมการแล้ว');await refresh();}
      catch(error){failure(error);review.append(note('ยังยืนยันผลไม่ได้ ลองรายการเดิมซ้ำหรือโหลดข้อมูลล่าสุดเพื่อตรวจสถานะ'));}
      finally{busy=false;confirm.disabled=false;}
    },{primary:true});review.append(confirm);const modal=dialog(root,'ยืนยันรับเรื่อง',review,{signal,canClose:()=>!busy});modal.classList.add('coord-dialog--confirmation');const descriptionId='coord-confirm-'+crypto.randomUUID();question.id=descriptionId+'-question';applicant.id=descriptionId+'-applicant';modal.setAttribute('aria-describedby',applicant.id+' '+question.id);modal.addEventListener('cancel',e=>{if(busy)e.preventDefault();});}
  async function showDetail(id,host,refresh,{modal=false}={}){const token=++detailToken;host.replaceChildren(el('p','coord-loading','กำลังโหลดใบสมัคร…'));
    try{const record=await request('/applications/'+id);if(stopped()||token!==detailToken)return;
      host.replaceChildren(renderDetail(record,{activeTab,onTab:key=>{activeTab=key;},onReturn:modal?undefined:()=>returnForm(record,refresh),onForward:modal?undefined:()=>forward(record,refresh),
        onDownload:doc=>download(record,doc),host:root,signal}));
    }catch(error){if(token!==detailToken)return;failure(error);if(!stopped())host.replaceChildren(note('โหลดใบสมัครไม่สำเร็จ'),button('ลองโหลดใบสมัครอีกครั้ง',()=>showDetail(id,host,refresh,{modal})));}}
  function reviewPage(){content.replaceChildren(status);const shortcuts=el('nav','coord-status-filters');shortcuts.setAttribute('aria-label','กรองใบสมัครตามสถานะ');content.append(shortcuts);
    const host=el('div'),layout=el('div','coord-review-layout'),queue=el('aside','coord-queue'),detail=el('div','coord-detail-host');
    const fields=filterBar(host,refresh);content.append(host,layout);layout.append(queue,detail);
    async function refresh(){if(!cycleId)return;const token=++queryToken;requestController?.abort();requestController=new AbortController();const abort=()=>requestController?.abort();signal?.addEventListener('abort',abort,{once:true});
      queue.setAttribute('aria-busy','true');detailToken++;detail.replaceChildren(el('p','coord-loading','กำลังโหลดข้อมูล…'));
      try{const data=await request('/applications?'+query(),{signal:requestController.signal});if(stopped()||token!==queryToken)return;
        shortcuts.replaceChildren();for(const [key,label] of [['','ทั้งหมด'],['PENDING','รอตรวจสอบ'],['RETURNED','ส่งกลับแก้ไข'],['FORWARDED','ส่งต่อกรรมการแล้ว']]){
          const b=button(label,()=>{filters.state=key;fields.state.value=key;pageNo=1;refresh();});b.className='coord-status-filter '+(key?'coord-status-filter--'+key.toLowerCase():'');b.setAttribute('aria-pressed',String(filters.state===key));b.append(el('span','coord-count',data.counts[key || 'all'] || 0));shortcuts.append(b);}
        if(!data.applications.length&&pageNo>1){pageNo--;return refresh();}queue.replaceChildren();const title=el('div','coord-queue-heading');title.append(el('h2','','รายชื่อผู้สมัครสหกิจศึกษา'),el('span','coord-count',`${data.total} คน`));queue.append(title);
        if(!data.applications.length){queue.append(note('ไม่พบใบสมัครตามตัวกรอง'),button('ล้างตัวกรอง',()=>{filters={search:'',state:'',curriculum:'',program_type:'',sort:'newest'};pageNo=1;reviewPage();}));detail.replaceChildren(note('เลือกตัวกรองอื่น หรือรอใบสมัครที่ส่งเข้ามาในรอบนี้'));return;}
        if(!data.applications.some(a=>a.id===selectedId))selectedId=data.applications[0].id;
        const choose=id=>{selectedId=id;for(const b of queue.querySelectorAll('[data-application]'))b.setAttribute('aria-pressed',String(b.dataset.application===id));showDetail(id,detail,refresh);};
        for(const app of data.applications){const b=button('',()=>choose(app.id));b.className='coord-queue-item';b.dataset.application=app.id;b.setAttribute('aria-pressed',String(app.id===selectedId));
          const top=el('span','coord-queue-item__top');top.append(el('strong','',text(app.student_number)),badge(app.state));b.append(top,el('strong','',text(app.full_name)),el('span','coord-muted',`หลักสูตร ${text(app.curriculum)} / ${text(app.major_group)}`));queue.append(b);}
        paginate(queue,data,refresh);await showDetail(selectedId,detail,refresh);
      }catch(error){if(token!==queryToken)return;failure(error);queue.replaceChildren(button('ลองโหลดรายการอีกครั้ง',refresh));}
      finally{if(token===queryToken)queue.setAttribute('aria-busy','false');signal?.removeEventListener('abort',abort);}
    }refresh();}
  function trackingPage(){content.replaceChildren(status);const heading=el('div','coord-section-heading'),intro=el('div'),actions=el('div','coord-tracking-actions');intro.append(el('h2','','รายชื่อที่ส่งให้กรรมการ'));heading.append(intro,actions);content.append(heading);
    const host=el('div'),records=el('div');filterBar(host,refresh);content.append(host,records);
    function meetingSummary(meetings){const body=el('div');for(const meeting of meetings){const state=meeting.state,p=state?.proposal;body.append(el('h3','',meeting.department),el('p','','กรรมการชุดเดียว 3 คน พิจารณาทั้งภาคปกติและภาคพิเศษ'));
      if(!p)body.append(note('ยังไม่มีข้อเสนอจำนวนรับที่บันทึกไว้'));
      else{body.append(el('h3','','จำนวนรับนักศึกษาตามข้อเสนอ'),rowsForMeeting(p),el('p','',p.status==='accepted'?'ตกลงจำนวนรับแล้ว':p.status==='rejected'?'ข้อเสนอนี้ถูกส่งกลับเพื่อปรับปรุง':'อยู่ระหว่างตกลงจำนวนรับ'));}
      body.append(note(state?.finalized?`กรรมการยืนยันรายชื่อแล้ว ${state.selected?.length || 0} คน · ยังไม่ใช่การประกาศผล`:'ยังไม่มีการยืนยันรายชื่อคัดเลือก'),note('หน้านี้อ่านอย่างเดียว Coordinator ไม่แก้ผลคัดเลือกหรือข้อเสนอจำนวนรับ'));
    }if(!meetings.length)body.append(note('ยังไม่มีข้อมูลมติในขอบเขตที่ได้รับมอบหมาย'));dialog(root,'มติและจำนวนรับ',body,{signal});}
    function rowsForMeeting(p){const dl=el('dl','coord-meeting-counts');for(const [label,value] of [['จำนวนรับภาคปกติ',p.normal],['จำนวนรับภาคพิเศษ',p.special],['เหตุผลที่เสนอ',p.reason]]){const item=el('div');item.append(el('dt','',label),el('dd','',text(value)));dl.append(item);}return dl;}
    async function refresh(){const token=++queryToken;records.setAttribute('aria-busy','true');
      try{const data=await request('/tracking?'+query());if(stopped()||token!==queryToken)return;
        intro.replaceChildren(el('h2','',`รายชื่อที่ส่งให้กรรมการ · ${data.total} รายการ`));const one=data.meetings?.length===1;
        intro.append(el('p','',one?'คณะกรรมการ 3 คน พิจารณาทั้งภาคปกติและภาคพิเศษ':'กรุณาตรวจการมอบหมายกรรมการของรอบนี้กับผู้ดูแลระบบ'));
        actions.replaceChildren(button('ดูมติและจำนวนรับ',()=>meetingSummary(data.meetings || []),{primary:true,icon:'file'}),badge('PENDING',data.meetings?.length && data.meetings.every(m=>m.state?.finalized)?'ยืนยันรายชื่อแล้ว · รอประกาศผล':'รอมติที่ประชุม'));
        records.replaceChildren();if(!data.applications.length){records.append(note('ยังไม่มีใบสมัครที่ส่งให้กรรมการตามตัวกรองนี้'));return;}
        const t=table(['ลำดับรายการ','นักศึกษา','ประเภทหลักสูตร','เฉลี่ยวิชาหลัก','GPAX','ดำเนินการ'],'รายชื่อที่ส่งให้กรรมการ เรียงตามตัวกรอง ไม่ใช่ผลคัดเลือก');
        data.applications.forEach((app,index)=>{const row=el('tr'),person=el('td');person.append(el('strong','',text(app.full_name)),el('small','coord-muted',text(app.student_number)));const action=el('td');
          action.append(button('ดูใบสมัคร',()=>{const body=el('div');dialog(root,'ใบสมัครฉบับที่ส่ง',body,{signal});showDetail(app.id,body,refresh,{modal:true});},{icon:'file'}));
          const cells=[el('td','coord-numeric',String((pageNo-1)*data.pageSize+index+1)),person,el('td','',app.program_type==='regular'?'ภาคปกติ':app.program_type==='special'?'ภาคพิเศษ':'รอยืนยันประเภท'),el('td','coord-numeric',score(app.core)),el('td','coord-numeric',score(app.gpax)),action];
          cells.forEach((cell,i)=>cell.dataset.label=['ลำดับรายการ','นักศึกษา','ประเภทหลักสูตร','เฉลี่ยวิชาหลัก','GPAX','ดำเนินการ'][i]);row.append(...cells);t.body.append(row);});records.append(t.table);paginate(records,data,refresh);
        records.append(note('การเรียงข้อมูลไม่เปลี่ยนสถานะใบสมัคร ผลคัดเลือกเป็นไปตามมติที่ประชุม · ข้อมูลที่ไม่ครบแสดง —'));
      }catch(error){if(token!==queryToken)return;failure(error);records.replaceChildren(button('ลองโหลดอีกครั้ง',refresh));}finally{if(token===queryToken)records.setAttribute('aria-busy','false');}
    }refresh();}
  function schedulePage(data){content.replaceChildren(status);const intro=el('div','coord-section-heading'),copy=el('div');copy.append(el('h2','','ตั้งค่ากำหนดการของรอบ'),el('p','','การเปลี่ยนแปลงมีผลกับรอบที่เลือก หลังบันทึกกำหนดการ'));intro.append(copy,el('span','','เวลาประเทศไทย (UTC+7)'));content.append(intro);
    const layout=el('div','coord-schedule-layout'),form=el('form','coord-schedule-form'),overview=el('aside','coord-schedule-overview'),fields={};layout.append(form,overview);content.append(layout);
    const value=key=>{const item=fields[key];return item?.date.value && item.time.value?`${item.date.value}T${item.time.value}:00+07:00`:null;};
    const preview=()=>{overview.replaceChildren(el('h2','','ภาพรวมกำหนดการ'),el('p','',data.cycle_name));if(dirty)overview.append(badge('PENDING','ค่าที่กำลังแก้ไข · ยังไม่บันทึก'));
      for(const [title,start,,end] of WINDOWS){const item=el('section');item.append(el('h3','',title),el('p','',date(value(start),true)+' – '+date(value(end),true)));overview.append(item);}
      const deadline=el('section','coord-deadline');deadline.append(el('h3','','หมดเขตยืนยันสิทธิ์'),el('strong','',date(value('confirmation_closes_at'))),el('p','',value('confirmation_closes_at')?new Intl.DateTimeFormat('th-TH',{timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value('confirmation_closes_at')))+' น.':'—'));overview.append(deadline);};
    const changed=()=>{dirty=true;scheduleAttempt=null;feedback(status,'มีการแก้กำหนดการที่ยังไม่บันทึก');preview();};
    for(const [title,start,startLabel,end,endLabel] of WINDOWS){const section=el('fieldset','coord-schedule-section');section.append(el('legend','',title));const pair=el('div','coord-schedule-pair');
      for(const [key,label] of [[start,startLabel],[end,endLabel]]){const values=bangkokInput(data[key]).split('T'),d=el('input'),time=el('input');d.type='date';time.type='time';d.value=values[0] || '';time.value=values[1] || '';d.required=true;time.required=true;d.disabled=!data.can_edit;time.disabled=!data.can_edit;d.addEventListener('input',changed);time.addEventListener('input',changed);fields[key]={date:d,time};
        const group=el('div','coord-datetime');group.append(field(label+' · วันที่',d),field(label+' · เวลา',time));pair.append(group);}section.append(pair);form.append(section);}
    form.append(note('วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น และแต่ละช่วงต้องเรียงตามลำดับ · ใบสมัครที่ถูกส่งกลับแก้ได้ถึงสิ้นสุดช่วงพิจารณา'));
    const actions=el('div','coord-schedule-actions'),cancel=button('ยกเลิกการแก้ไข',()=>{if(!dirty||window.confirm('ทิ้งการแก้กำหนดการที่ยังไม่บันทึกหรือไม่?')){dirty=false;scheduleAttempt=null;schedulePage(currentSchedule);feedback(status,'ยกเลิกการแก้ไขแล้ว');}}),save=button('บันทึกกำหนดการ',null,{primary:true,icon:'save'});save.type='submit';cancel.disabled=!data.can_edit;save.disabled=!data.can_edit;actions.append(cancel,save);form.append(actions);
    if(!data.can_edit)form.prepend(note('อ่านอย่างเดียว: รอบปิด หรือมีผู้ประสานงานอื่นได้รับมอบหมายในรอบเดียวกัน'));
    form.append(button('โหลดกำหนดการล่าสุด',()=>{if(!dirty||window.confirm('โหลดใหม่และทิ้งการแก้ไขที่ยังไม่บันทึกหรือไม่?')){dirty=false;scheduleAttempt=null;loadSchedule();}}));preview();
    form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!data.can_edit)return;
      const body={expected_version:data.version,expected_window_version:data.window_version};for(const key of Object.keys(fields)){const v=value(key);if(!v){feedback(status,'กรุณาระบุวันและเวลาให้ครบทุกช่วง',true);fields[key].date.focus();return;}body[key]=v;}
      const times=WINDOWS.flatMap(([,start,,end])=>[Date.parse(body[start]),Date.parse(body[end])]);if(!(times[0]<times[1]&&times[1]<=times[2]&&times[2]<times[3]&&times[3]<=times[4]&&times[4]<times[5])){feedback(status,'ตรวจลำดับช่วงเวลา: รับสมัคร → พิจารณา → ยืนยันสิทธิ์ โดยวันสิ้นสุดอยู่หลังวันเริ่ม',true);status.focus();return;}
      scheduleAttempt ||= {...body,operation_id:crypto.randomUUID()};busy=true;for(const control of form.querySelectorAll('input,button'))control.disabled=true;feedback(status,'กำลังบันทึกกำหนดการ…');
      try{const saved=await request('/schedules/'+cycleId,{method:'POST',body:scheduleAttempt});if(stopped())return;currentSchedule=saved;dirty=false;scheduleAttempt=null;schedulePage(saved);feedback(status,'บันทึกกำหนดการแล้ว');}
      catch(error){failure(error);if(!stopped()){status.append(el('span','',' · วันเวลาที่กรอกยังอยู่ หากข้อมูลขัดแย้งให้โหลดล่าสุดก่อนบันทึกใหม่'));status.focus();}}
      finally{busy=false;if(!stopped())for(const control of form.querySelectorAll('input,button'))control.disabled=false;}
    });}
  async function loadSchedule(){const token=++queryToken;content.replaceChildren(status,el('p','coord-loading','กำลังโหลดกำหนดการ…'));
    try{const data=await request('/schedules/'+cycleId);if(stopped()||token!==queryToken)return;currentSchedule=data;schedulePage(data);}catch(error){failure(error);if(!stopped()&&token===queryToken)content.append(button('ลองโหลดกำหนดการอีกครั้ง',loadSchedule));}}
  function load(){if(page==='schedule')loadSchedule();else if(page==='tracking')trackingPage();else reviewPage();}
  async function start(){feedback(status,'กำลังโหลดรอบที่ได้รับมอบหมาย…');content.append(status);
    try{const options=await request('/options');if(stopped())return;cycles=options.cycles || [];cycleId=cycles[0]?.id || '';drawHeader();feedback(status,'');if(!cycleId){content.append(note('ยังไม่มีรอบที่ได้รับมอบหมาย กรุณาติดต่อผู้ดูแลระบบ'));return;}load();}
    catch(error){failure(error);if(!stopped())content.append(button('ลองโหลดรอบอีกครั้ง',start));}}
  start();return root;
}
