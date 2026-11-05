// Deployment control only. Missing flag preserves normal routing; unknown values
// fail closed. Verification permits only reviewed, authenticated, read-only paths.
const READ_PATHS=new Set(['/api/v3/me','/api/v3/students/me',
  '/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v3/students/me']);
const APPLICATION_READ_PATHS=new Set(['/api/tu-proxy/api/v4/application-options',
  '/api/tu-proxy/api/v4/applications']);
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const APPLICATION_DETAIL=new RegExp('^/api/tu-proxy/api/v4/applications/'+UUID+'$','i');
const PUBLIC_COMPANY_DETAIL=new RegExp('^/api/directory/companies/'+UUID+'$','i');
const PUBLIC_FILTERS=new Set(['q','location','page','pageSize']);
const {INTAKE_MODES}=require('./shared/application-access');
const STUDENT_APP='/api/tu-proxy/api/v4/applications';
const INTAKE_APP=new RegExp('^'+STUDENT_APP+'/'+UUID+'$','i');
const INTAKE_READY=new RegExp('^'+STUDENT_APP+'/'+UUID+'/readiness$','i');
const INTAKE_UPLOAD=new RegExp('^'+STUDENT_APP+'/'+UUID+'/uploads(?:/'+UUID+'/complete)?$','i');
const INTAKE_SUBMIT=new RegExp('^'+STUDENT_APP+'/'+UUID+'/submit$','i');
const INTAKE_DOWNLOAD=new RegExp('^/api/(?:tu-proxy/api/)?v4/applications/'+UUID+'/documents/'+UUID+'/download$','i');
const COORDINATOR_READ=new RegExp('^/api/v4/coordinator/(?:options|applications(?:/'+UUID+')?)$','i');
const COORDINATOR_FILTERS=new Set(['cycle_id','search','state','curriculum','program_type','sort','page','pageSize']);
function noQuery(event){return !event.rawQueryString && !Object.keys(event.queryStringParameters || {}).length;}
function publicQuery(event){
  const params=new URLSearchParams(event.rawQueryString || '');
  return [...params.keys()].every(key=>PUBLIC_FILTERS.has(key) && params.getAll(key).length===1) &&
    Object.keys(event.queryStringParameters || {}).every(key=>PUBLIC_FILTERS.has(key));
}
function browseRead(event,path){
  if(path==='/api/directory/companies')return publicQuery(event);
  return noQuery(event) && (APPLICATION_READ_PATHS.has(path) || APPLICATION_DETAIL.test(path) || PUBLIC_COMPANY_DETAIL.test(path));
}
function maintenanceResponse(event={},mode=process.env.COED_API_MAINTENANCE){
  if(!mode || mode==='off')return null;
  const method=event.requestContext?.http?.method || event.httpMethod;
  const path=event.rawPath || event.path;
  const intake=INTAKE_MODES.includes(mode);
  if(method==='GET' && (mode==='verify' || mode==='browse' || intake) &&
    (READ_PATHS.has(path) && noQuery(event) || (mode==='browse' || intake) && browseRead(event,path)))return null;
  if(intake){
    if(noQuery(event) && (method==='GET' && (INTAKE_READY.test(path) || COORDINATOR_READ.test(path)) ||
      method==='POST' && path===STUDENT_APP || method==='PATCH' && INTAKE_APP.test(path) ||
      mode!=='intake-draft' && method==='POST' && (INTAKE_UPLOAD.test(path) || INTAKE_DOWNLOAD.test(path)) ||
      mode==='intake-pilot' && method==='POST' && INTAKE_SUBMIT.test(path)))return null;
    if(method==='GET' && path==='/api/v4/coordinator/applications'){
      const params=new URLSearchParams(event.rawQueryString || '');
      if([...params.keys()].every(k=>COORDINATOR_FILTERS.has(k) && params.getAll(k).length===1) &&
        Object.keys(event.queryStringParameters || {}).every(k=>COORDINATOR_FILTERS.has(k)))return null;
    }
  }
  return {statusCode:503,isBase64Encoded:false,
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'120'},
    body:JSON.stringify({error:{code:'COED_MAINTENANCE',message:'ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง'}})};
}
module.exports={maintenanceResponse,READ_PATHS,APPLICATION_READ_PATHS};
