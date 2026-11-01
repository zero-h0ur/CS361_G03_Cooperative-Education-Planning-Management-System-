const { ValidationError } = require('../errors');
const {POSITIONS,ACKNOWLEDGEMENTS}=require('../../shared/application-form');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILES = Object.freeze({resume:10485760,transcript:10485760,conduct:10485760,photo:5242880});
function fail(field, message='ข้อมูลไม่ถูกต้อง') { throw new ValidationError(message,[{field,message}]); }
function fields(value, allowed) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype) fail('body');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(key,'ไม่อนุญาตให้แก้ไขข้อมูลนี้');
}
function uuid(value, field='id') { if (!UUID.test(value || '')) fail(field); return value.toLowerCase(); }
function text(value, field, max=200, multiline=false) {
  if (typeof value!=='string' || value.length>max || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) fail(field);
  return value.trim();
}
function decimal(value, field) {
  if (value===null || value==='') return null;
  if (typeof value!=='string' && typeof value!=='number') fail(field);
  const s=String(value);
  if (!/^\d(?:\.\d{1,4})?$/.test(s) || Number(s)>4) fail(field,'เกรดต้องอยู่ระหว่าง 0 ถึง 4');
  return s;
}
function command(input, extra=[], version=true) {
  fields(input,['operation_id',...(version?['expected_version']:[]),...extra]);
  uuid(input.operation_id,'operation_id');
  if (version && (!Number.isSafeInteger(input.expected_version) || input.expected_version<1)) fail('expected_version');
  return input;
}
const STRINGS={contact_address:1000,contact_phone:40,institutional_email:254,contact_email:254,major_group:100,
  name_prefix:100,thai_full_name:200,english_full_name:200,gpax_reporting_term:100,skills_detail:5000,interested_position_other:500,
  guardian_name:200,guardian_relationship:100,guardian_address:1000,guardian_phone:40};
function payload(value) {
  fields(value,[...Object.keys(STRINGS),'curriculum','gpax','declared_group_gpa','interested_position_codes','interested_positions','skills','course_attempts','selected_courses','additional_studies','acknowledgements']);
  const out={};
  for (const [key,max] of Object.entries(STRINGS)) if (Object.hasOwn(value,key)) out[key]=text(value[key],key,max,key.endsWith('address') || key==='skills_detail');
  if (value.curriculum!==undefined) {if (!['','61','66'].includes(value.curriculum)) fail('curriculum');out.curriculum=value.curriculum;}
  if (value.gpax!==undefined) out.gpax=decimal(value.gpax,'gpax');
  if (value.declared_group_gpa!==undefined) out.declared_group_gpa=decimal(value.declared_group_gpa,'declared_group_gpa');
  if (value.interested_position_codes!==undefined) {
    const allowed=new Set([...POSITIONS.map(([code])=>code),'OTHER']);
    if (!Array.isArray(value.interested_position_codes) || value.interested_position_codes.length>allowed.size || value.interested_position_codes.some(code=>!allowed.has(code))) fail('interested_position_codes');
    out.interested_position_codes=[...new Set(value.interested_position_codes)];
  }
  for (const key of ['interested_positions','skills']) if (value[key]!==undefined) {
    if (!Array.isArray(value[key]) || value[key].length>30) fail(key);
    out[key]=[...new Set(value[key].map(x=>text(x,key,120)).filter(Boolean))];
  }
  if (value.course_attempts!==undefined) {
    if (!Array.isArray(value.course_attempts) || value.course_attempts.length>100) fail('course_attempts');
    const seen=new Set();
    out.course_attempts=value.course_attempts.map(x=>{
      fields(x,['code','attempt','points']);
      if (!/^CS\d{3}$/.test(x.code) || !Number.isInteger(x.attempt) || x.attempt<1 || x.attempt>20) fail('course_attempts');
      const key=`${x.code}:${x.attempt}`;if (seen.has(key)) fail('course_attempts','รายการผลการเรียนซ้ำกัน');seen.add(key);
      return {code:x.code,attempt:x.attempt,points:decimal(x.points,'course_attempts')};
    });
  }
  if (value.selected_courses!==undefined) {
    fields(value.selected_courses,['alternative']);
    if (value.selected_courses.alternative!==undefined && value.selected_courses.alternative!=='' && !/^CS\d{3}$/.test(value.selected_courses.alternative)) fail('selected_courses');
    out.selected_courses={...value.selected_courses};
  }
  if (value.additional_studies!==undefined) {
    fields(value.additional_studies,['CS384','CS266','CS322','CS348','CS180','CS262','CS331','CS240']);
    for (const x of Object.values(value.additional_studies)) if (!['NOT_STUDIED','ENROLLED','STUDIED'].includes(x)) fail('additional_studies');
    out.additional_studies={...value.additional_studies};
  }
  if (value.acknowledgements!==undefined) {
    fields(value.acknowledgements,ACKNOWLEDGEMENTS);
    for (const x of Object.values(value.acknowledgements)) if (typeof x!=='boolean') fail('acknowledgements');
    out.acknowledgements={...value.acknowledgements};
  }
  return out;
}
function upload(value) {
  command(value,['kind','filename','content_type','byte_size','checksum']);
  if (!Object.hasOwn(FILES,value.kind)) fail('kind');
  const filename=text(value.filename,'filename',200);
  if (!filename || /[/\\]/.test(filename) || !Number.isInteger(value.byte_size) || value.byte_size<1 || value.byte_size>FILES[value.kind]) fail('file','ชนิดหรือขนาดไฟล์ไม่ตรงข้อกำหนด');
  const valid=value.kind==='photo' ? /\.(jpe?g|png)$/i.test(filename) && ['image/jpeg','image/png'].includes(value.content_type)
    : /\.pdf$/i.test(filename) && value.content_type==='application/pdf';
  if (!valid || !/^[a-f0-9]{64}$/.test(value.checksum || '')) fail('file','ชนิดหรือ checksum ของไฟล์ไม่ถูกต้อง');
  return {...value,filename};
}
module.exports={UUID,FILES,fields,uuid,text,decimal,command,payload,upload,fail};
