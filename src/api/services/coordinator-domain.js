const {ValidationError}=require('../errors');
const {readiness}=require('./application-policy');
const {ACKNOWLEDGEMENTS}=require('../../shared/application-form');

const STATES=Object.freeze(['PENDING','RETURNED','FORWARDED']);
function schedule(input) {
  const keys=['opens_at','closes_at','review_opens_at','review_closes_at','confirmation_opens_at','confirmation_closes_at'];
  const result={};
  for(const key of keys) {
    // Require an explicit UTC offset; never interpret a browser/host local datetime.
    const parts=typeof input[key]==='string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(input[key]);
    const [year,month,day,hour,minute,second]=parts?parts.slice(1,7).map(x=>Number(x || 0)):[];
    const days=[31,year%4===0 && (year%100!==0 || year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    if(!parts || year<1 || month<1 || month>12 || day<1 || day>days[month-1] || hour>23 || minute>59 || second>59 || !Number.isFinite(Date.parse(input[key])))
      throw new ValidationError('กรุณาระบุวันเวลาและเขตเวลาให้ครบ',[{field:key,message:'วันเวลาไม่ถูกต้อง'}]);
    result[key]=new Date(input[key]).toISOString();
  }
  const t=keys.map(key=>Date.parse(result[key]));
  if(!(t[0]<t[1] && t[1]<=t[2] && t[2]<t[3] && t[3]<=t[4] && t[4]<t[5]))
    throw new ValidationError('ช่วงเวลาต้องเรียง รับสมัคร → พิจารณา → ยืนยันสิทธิ์ และวันสิ้นสุดต้องอยู่หลังวันเริ่ม');
  return result;
}
function academic(snapshot,{allowSynthetic=false}={}) {
  if(!snapshot)return {core:null,gpax:null,declared_core:null};
  const p=snapshot.payload || {};
  const numeric=value=>value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=4?Number(value):null;
  if(snapshot.contract_version===2)return {core:numeric(snapshot.assessment?.group_gpa),gpax:numeric(p.gpax),declared_core:numeric(p.declared_group_gpa)};
  const check=readiness({app:{status:'DRAFT',payload:p},official:snapshot.official,policy:snapshot.policy,
    documents:snapshot.documents,window:{is_open:true},roundOpen:true,allowSynthetic});
  return {core:numeric(check.group_gpa),gpax:numeric(p.gpax),declared_core:numeric(p.declared_group_gpa)};
}
function declarations(snapshot) {
  return ACKNOWLEDGEMENTS.map(key=>({key,checked:snapshot?.payload?.acknowledgements?.[key]===true}));
}
module.exports={STATES,schedule,academic,declarations};
