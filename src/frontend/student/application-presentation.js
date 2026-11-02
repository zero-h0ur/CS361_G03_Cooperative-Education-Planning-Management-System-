import {studentElement as el,studentLink,formatStudentDate} from './workspace-components.js';
import {createWorkspaceIcon} from '../ui/workspace-presentation.js';

export function applicationCycleLabel(application,cycles=[]) {
  return cycles.find(c=>c.id===application.cycle_id)?.name || application.cycle_name || 'รอบรับสมัครเดิม';
}

export function latestApplication(applications) {
  // Prefer a resumable draft. Preserve API order when timestamps are missing/equal.
  return [...applications].sort((a,b)=>Number(b.status==='DRAFT')-Number(a.status==='DRAFT') ||
    (Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0))[0] || null;
}

export function renderApplicationFeature(application,{cycles=[],onNavigate,compact=false}={}) {
  const card=el('section',`student-application-feature${compact?' student-application-feature--compact':''}`);
  const content=el('div','student-application-feature__content');
  const label=el('div','student-application-feature__label');
  label.append(createWorkspaceIcon('document'),el('h2','','ใบสมัครล่าสุด'));
  const title=el('h3','',applicationCycleLabel(application,cycles));
  const draft=application.status==='DRAFT';
  const badge=el('span','student-feature-badge',draft?'ฉบับร่าง':'ส่งแล้ว');
  const headline=el('div','student-application-feature__headline');headline.append(title,badge);
  content.append(label,headline);
  if(draft) {
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
  const link=studentLink(draft?'กรอกใบสมัครต่อ':'ดูใบสมัคร',`#/student/application/${application.id}`,
    {onNavigate,className:'shell-button student-feature-action'});
  link.append(createWorkspaceIcon('arrow'));
  actions.append(link,el('p','',draft?'บันทึกฉบับร่างได้ แม้ยังกรอกไม่ครบ':'ใบสมัครที่ส่งแล้วเปิดดูได้ แต่แก้ไขไม่ได้'));
  card.append(content,actions);return card;
}

export function renderStudentDirectoryLink(onNavigate) {
  const strip=el('aside','student-directory-strip');strip.append(createWorkspaceIcon('building'));
  const copy=el('div');copy.append(el('strong','','กำลังมองหาสถานประกอบการ?'),
    el('span','',' ค้นหาสถานประกอบการและข้อมูลตำแหน่งงาน'));
  strip.append(copy,studentLink('ดูสถานประกอบการ','company-directory.html',{onNavigate,icon:'arrow'}));return strip;
}
