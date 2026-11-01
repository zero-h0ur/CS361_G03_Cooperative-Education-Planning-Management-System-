import {renderApplicationEditor} from './application-editor-view.js';
export function node(tag,cls,text) {const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
export function button(text,action,secondary=false) {
  const b=node('button',`shell-button${secondary?' shell-button--secondary':''}`,text);b.type='button';b.addEventListener('click',action);return b;
}
export function renderApplicationWorkspace({client,applicationId,signal,onNavigate,onSessionExpired,setLeaveGuard}={}) {
  const root=node('div','application-workspace');let busy=false,createAttempt;
  const status=node('p','application-notice','กำลังโหลดใบสมัคร…');status.setAttribute('role','status');root.append(status);
  async function load() {
    if(busy)return;busy=true;root.setAttribute('aria-busy','true');
    try{
      if(applicationId){const app=await client.get(applicationId,{signal});if(signal?.aborted)return;
        root.replaceChildren(renderApplicationEditor({client,application:app,signal,onSessionExpired,setLeaveGuard,
          onBack:()=>onNavigate('#/student/application')}));return;}
      const [options,list]=await Promise.all([client.options({signal}),client.list({signal})]);if(signal?.aborted)return;
      root.replaceChildren();
      const intro=node('section','application-card application-intro');
      intro.append(node('p','application-eyebrow','PHASE 1 · เตรียมใบสมัคร'),node('h2','','เริ่มต้นแผนสหกิจของคุณ'),
        node('p','','เลือกช่วงรับสมัคร กรอกข้อมูลและแนบเอกสาร แล้วตรวจความพร้อมก่อนส่งให้ผู้ประสานงาน'));
      intro.append(node('p','application-notice','ยังไม่ต้องมีบริษัทตอบรับหรือหัวข้อ Project ในขั้นสมัครเข้าแผน ข้อมูลจากมหาวิทยาลัยแก้ไขไม่ได้'));
      root.append(intro);
      const section=node('section','application-card');section.append(node('h2','','ใบสมัครของฉัน'));
      if(!list.length)section.append(node('p','','ยังไม่มีใบสมัคร เริ่มจากเลือกรอบด้านล่าง'));
      const cards=node('div','application-grid');
      for(const app of list){const c=node('article','application-cycle');
        c.append(node('h3','',options.cycles.find(x=>x.id===app.cycle_id)?.name || 'รอบสมัครเดิม'),
          node('p','application-badge',app.status==='DRAFT'?'ฉบับร่าง · แก้ไขได้':'ส่งแล้ว · รอผู้ประสานงานตรวจ'),
          button(app.status==='DRAFT'?'เปิดฉบับร่าง':'ดูใบสมัครที่ส่ง',()=>onNavigate(`#/student/application/${app.id}`),true));cards.append(c);}
      section.append(cards);root.append(section);
      const create=node('section','application-card');create.append(node('h2','','สร้างใบสมัครในรอบใหม่'));
      const label=node('label','','รอบรับสมัคร'),select=node('select','application-input');select.id='application-cycle';label.htmlFor=select.id;
      select.append(new Option('เลือกรอบรับสมัคร',''));
      for(const cycle of options.cycles.filter(c=>c.status==='OPEN' && !list.some(a=>a.cycle_id===c.id)))select.append(new Option(cycle.name,cycle.id));
      const message=node('p','application-notice');message.setAttribute('role','status');
      const start=button('สร้างฉบับร่าง',async()=>{
        if(!select.value){message.textContent='กรุณาเลือกรอบรับสมัคร';select.focus();return;}
        if(!createAttempt || createAttempt.cycle_id!==select.value)createAttempt={cycle_id:select.value,operation_id:crypto.randomUUID()};
        start.disabled=true;select.disabled=true;message.textContent='กำลังสร้างฉบับร่าง…';
        try{const result=await client.create(createAttempt,{signal});if(!signal?.aborted)onNavigate(`#/student/application/${result.id}`);}
        catch(e){if(e.code==='SESSION_EXPIRED')onSessionExpired?.();else if(e.name!=='AbortError')message.textContent=e.message;}
        finally{start.disabled=false;select.disabled=false;}
      });
      create.append(label,select,node('p','application-help','หนึ่งใบสมัครต่อคนต่อรอบ ข้อมูลและไฟล์แนบไม่ปะปนข้ามรอบ'),message,start);root.append(create);
    }catch(e){if(signal?.aborted || e.name==='AbortError')return;if(e.code==='SESSION_EXPIRED'){onSessionExpired?.();return;}
      root.replaceChildren(node('p','application-error',e.message || 'โหลดใบสมัครไม่สำเร็จ'),button('ลองโหลดอีกครั้ง',load,true));}
    finally{busy=false;root.setAttribute('aria-busy','false');}
  }
  load();return root;
}
