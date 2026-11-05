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
  if(method==='GET' && (mode==='verify' || mode==='browse') &&
    (READ_PATHS.has(path) && noQuery(event) || mode==='browse' && browseRead(event,path)))return null;
  return {statusCode:503,isBase64Encoded:false,
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'120'},
    body:JSON.stringify({error:{code:'COED_MAINTENANCE',message:'ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง'}})};
}
module.exports={maintenanceResponse,READ_PATHS,APPLICATION_READ_PATHS};
