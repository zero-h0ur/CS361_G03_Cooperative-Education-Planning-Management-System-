/** @jest-environment jsdom */
const {renderIntakeControls}=require('../tmp/frontend-test-modules/coordinator/intake-controls.cjs');
const flush=()=>new Promise(r=>setTimeout(r,10));
const button=(root,label)=>[...root.querySelectorAll('button')].find(b=>b.textContent===label);
let signal;
beforeEach(()=>{document.body.replaceChildren();signal=new AbortController();HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};});
afterEach(()=>{signal.abort();jest.restoreAllMocks();});
function data(extra={}){return {cycle_id:'cycle',cycle_name:'รอบทดสอบเฉพาะบัญชี',can_control:true,control:{mode:'CLOSED',version:1,is_open:false,opens_at:null,closes_at:null},history:[],...extra};}
async function setup(request){const panel=renderIntakeControls({request,cycleId:'cycle',signal:signal.signal});document.body.append(panel.element);await flush();return panel;}
test('manual mode needs no artificial date, confirms the exact round, then shows committed state and history',async()=>{
 const request=jest.fn(async(_path,options)=>options?.method==='POST'?data({control:{...data().control,mode:'MANUAL_OPEN',is_open:true,version:2,opens_at:'2026-11-05T12:00:00Z'},history:[{created_at:'2026-11-05T12:00:00Z',previous_mode:'CLOSED',mode:'MANUAL_OPEN',version:2}]}):data());
 const panel=await setup(request),root=panel.element,mode=root.querySelector('select');mode.value='MANUAL_OPEN';mode.dispatchEvent(new Event('input'));
 expect(panel.isDirty()).toBe(true);expect(root.querySelector('[type=datetime-local]').required).toBe(false);
 root.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));expect(request).toHaveBeenCalledTimes(1);
 expect(root.querySelector('dialog strong').textContent).toBe('รอบทดสอบเฉพาะบัญชี');button(root,'ยืนยันเปลี่ยนการรับสมัคร').click();await flush();
 const sent=request.mock.calls[1][1].body;expect(sent.mode).toBe('MANUAL_OPEN');expect(sent.opens_at).toBeUndefined();expect(sent.closes_at).toBeUndefined();
 expect(root.textContent).toContain('เปิดรับจนกว่าจะสั่งปิด');expect(root.textContent).toContain('ไม่กำหนดวันสิ้นสุด');expect(root.textContent).toContain('รุ่น 2');expect(panel.isDirty()).toBe(false);
});
test('scheduled invalid ordering is blocked; uncertain failure retains times and retries same operation',async()=>{
 const request=jest.fn(async(_path,options)=>{if(options?.method==='POST')throw new Error('Network result unknown');return data();});
 const panel=await setup(request),root=panel.element,mode=root.querySelector('select');mode.value='SCHEDULED';mode.dispatchEvent(new Event('input'));
 const [open,close]=root.querySelectorAll('[type=datetime-local]');open.value='2026-11-05T09:00';close.value='2026-11-04T09:00';open.dispatchEvent(new Event('input'));close.dispatchEvent(new Event('input'));
 root.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));expect(root.querySelector('dialog')).toBeNull();expect(root.textContent).toContain('วันปิดต้องอยู่หลังวันเปิด');
 close.value='2026-11-06T09:00';close.dispatchEvent(new Event('input'));
 for(let n=0;n<2;n++){root.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));button(root,'ยืนยันเปลี่ยนการรับสมัคร').click();await flush();}
 const posts=request.mock.calls.filter(([,o])=>o?.method==='POST');expect(posts[0][1].body.operation_id).toBe(posts[1][1].body.operation_id);
 expect(posts[0][1].body.opens_at).toBe('2026-11-05T09:00:00+07:00');expect(open.value).toBe('2026-11-05T09:00');expect(panel.isDirty()).toBe(true);expect(root.textContent).toContain('ค่าที่กรอกยังอยู่');
});
test('partial scope and missing configuration never offer an enabled control',async()=>{
 const request=jest.fn(async()=>data({can_control:false}));const {element:root}=await setup(request);
 expect([...root.querySelectorAll('form input,form select,form button')].every(n=>n.disabled)).toBe(true);
 expect(root.textContent).toContain('มอบหมายทั้งรอบ');expect(request).toHaveBeenCalledTimes(1);
});
