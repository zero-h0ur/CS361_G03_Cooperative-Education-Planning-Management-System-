import {createWorkspaceIcon} from '../ui/workspace-presentation.js';
export const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined && text!==null)n.textContent=String(text);return n;};
export const text=value=>value===null || value===undefined || value===''?'—':String(value);
export const score=value=>value===null || value===undefined || value==='' || !Number.isFinite(Number(value))?'—':Number(value).toFixed(2);
export const date=(value,time=false)=>value && Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',...(time?{timeStyle:'short'}:{}),timeZone:'Asia/Bangkok'}).format(new Date(value)):'—';
export const STATUS={PENDING:'รอตรวจสอบ',RETURNED:'ส่งกลับแก้ไข',FORWARDED:'ส่งต่อกรรมการแล้ว'};
export function button(label,handler,{primary=false,icon,cls=''}={}) {
  const b=el('button',`coord-button ${primary?'coord-button--primary':'coord-button--outline'} ${cls}`,label);b.type='button';
  if(icon)b.prepend(createWorkspaceIcon(icon));if(handler)b.addEventListener('click',handler);return b;
}
export function badge(state,label=STATUS[state]){return el('span',`coord-badge coord-badge--${state.toLowerCase()}`,label);}
export function field(label,control){const l=el('label','coord-field');l.append(el('span','',label),control);return l;}
export function select(label,choices,value='',onChange){const control=el('select');for(const [id,name] of choices)control.append(new Option(name,id));control.value=value;if(onChange)control.addEventListener('change',onChange);return {control,element:field(label,control)};}
export function rows(title,values){const section=el('section','coord-data');section.append(el('h3','',title));const dl=el('dl');
  for(const [label,value] of values){const row=el('div');row.append(el('dt','',label),el('dd','',text(value)));dl.append(row);}section.append(dl);return section;}
export function table(labels,caption){const t=el('table','coord-table');t.append(el('caption','shell-sr-only',caption));const head=el('thead'),tr=el('tr');
  for(const label of labels){const th=el('th','',label);th.scope='col';tr.append(th);}head.append(tr);t.append(head);const body=el('tbody');t.append(body);return {table:t,body};}
export function note(message){const p=el('p','coord-note',message);p.prepend(createWorkspaceIcon('help'));return p;}
export function dialog(host,title,content,{signal,onClose,canClose=()=>true}={}) {
  const previous=document.activeElement,d=el('dialog','coord-dialog'),heading=el('h2','',title),id='coord-dialog-'+crypto.randomUUID();heading.id=id;d.setAttribute('aria-labelledby',id);
  const header=el('header','coord-dialog__header'),close=button('ปิด',()=>{if(canClose())d.close();});header.append(heading,close);d.append(header,content);host.append(d);
  d.addEventListener('cancel',event=>{if(!canClose())event.preventDefault();});
  const cleanup=()=>{d.remove();onClose?.();if(!signal?.aborted && previous?.isConnected)previous.focus();};d.addEventListener('close',cleanup,{once:true});
  const cancel=()=>{if(d.open)d.close();else d.remove();};signal?.addEventListener('abort',cancel,{once:true});
  d.addEventListener('close',()=>signal?.removeEventListener('abort',cancel),{once:true});
  if(typeof d.showModal==='function')d.showModal();else{d.setAttribute('open','');close.focus();}
  return d;
}
export function bangkokInput(value){return value && Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+7*3600000).toISOString().slice(0,16):'';}
export function feedback(node,message,error=false){node.textContent=message;node.setAttribute('role',error?'alert':'status');node.classList.toggle('coord-feedback--error',error);}
