import {studentElement as el,studentLink,formatStudentDate} from './workspace-components.js';
import {createWorkspaceIcon} from '../ui/workspace-presentation.js';
import accessMessages from '../../shared/application-access.js';
const {READ_ONLY_MESSAGE}=accessMessages;

export function applicationCycleLabel(application,cycles=[]) {
  return cycles.find(c=>c.id===application.cycle_id)?.name || application.cycle_name || 'รอบรับสมัครเดิม';
}

export function applicationEditState(application,cycles=[]) {
  if(application.access?.read_only===true || !['DRAFT','NEEDS_REVISION'].includes(application.status)||application.availability?.can_edit===false)return false;
  if(application.availability?.can_edit===true)return true;
  if(application.status==='NEEDS_REVISION')return null; // Only the server may authorize a correction exception.
  const cycle=cycles.find(c=>c.id===application.cycle_id);if(!cycle)return null;
  if(cycle.status!=='OPEN')return false;
  if(cycle.opens_at&&Date.now()<Date.parse(cycle.opens_at)||cycle.closes_at&&Date.now()>=Date.parse(cycle.closes_at))return false;
  return true;
}

export function latestApplication(applications,cycles=[]) {
  // Prefer a resumable draft. Preserve API order when timestamps are missing/equal.
  const priority=app=>!['DRAFT','NEEDS_REVISION'].includes(app.status)?0:applicationEditState(app,cycles)===false?1:app.status==='NEEDS_REVISION'?3:2;
  return [...applications].sort((a,b)=>priority(b)-priority(a) ||
    (Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0))[0] || null;
}

export function renderApplicationFeature(application,{cycles=[],onNavigate,compact=false}={}) {
  const card=el('section',`student-application-feature${compact?' student-application-feature--compact':''}`);
  const content=el('div','student-application-feature__content');
  const label=el('div','student-application-feature__label');
  label.append(createWorkspaceIcon('file'),el('h2','','ใบสมัครล่าสุด'));
  const title=el('h3','',applicationCycleLabel(application,cycles));
  const correction=application.status==='NEEDS_REVISION',draft=application.status==='DRAFT'||correction;
  const editable=applicationEditState(application,cycles);
  const badge=el('span','student-feature-badge',correction?'ส่งกลับแก้ไข':draft?'ฉบับร่าง':'ส่งแล้ว');
  const headline=el('div','student-application-feature__headline');headline.append(title,badge);
  content.append(label,headline);
  if(draft) {
    if(correction)content.append(el('p','',application.correction_reason || 'แก้ไขตามที่ผู้ประสานงานแจ้ง แล้วตรวจสอบและส่งใบสมัครอีกครั้ง'));
    content.append(el('p','','ใบสมัคร 6 ส่วน · ตรวจทานข้อมูลและเอกสารก่อนส่ง'));
    const steps=el('div','student-feature-sections');steps.setAttribute('aria-hidden','true');
    // Neutral sections, not a fabricated saved-step / completion percentage.
    for(let i=0;i<6;i++)steps.append(el('span'));
    content.append(steps);
  } else {
    const date=formatStudentDate(application.submitted_at);
    content.append(el('p','',date?`ส่งเมื่อ ${date}`:'เปิดดูข้อมูลฉบับที่ส่งแล้ว'));
  }
  const actions=el('div','student-application-feature__actions');
  const link=studentLink(draft?(editable===true?'กรอกใบสมัครต่อ':editable===false?'ดูฉบับร่าง':'เปิดใบสมัคร'):'ดูใบสมัคร',`#/student/application/${application.id}`,
    {onNavigate,className:'shell-button student-feature-action'});
  link.append(createWorkspaceIcon('arrow'));
  actions.append(link,el('p','',application.access?.read_only===true?READ_ONLY_MESSAGE:draft?(editable===true?'บันทึกฉบับร่างได้ แม้ยังกรอกไม่ครบ':editable===false?'รอบปิดรับ · ฉบับร่างยังไม่ได้ส่ง และแก้ไขไม่ได้':'เปิดใบสมัครเพื่อตรวจสอบช่วงรับสมัคร'):'ใบสมัครที่ส่งแล้วเปิดดูได้ แต่แก้ไขไม่ได้'));
  card.append(content,actions);return card;
}

export function renderStudentDirectoryLink(onNavigate) {
  const strip=el('aside','student-directory-strip');strip.append(createWorkspaceIcon('building'));
  const copy=el('div');copy.append(el('strong','','กำลังมองหาสถานประกอบการ?'),
    el('span','',' ค้นหาสถานประกอบการและข้อมูลตำแหน่งงาน'));
  strip.append(copy,studentLink('ดูสถานประกอบการ','company-directory.html',{onNavigate,icon:'arrow'}));return strip;
}
