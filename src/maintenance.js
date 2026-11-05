// Deployment control only. Missing flag preserves normal routing; unknown values
// fail closed. Verification permits only reviewed, authenticated, read-only paths.
const READ_PATHS=new Set(['/api/v3/me','/api/v3/students/me',
  '/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v3/students/me']);
function maintenanceResponse(event={},mode=process.env.COED_API_MAINTENANCE){
  if(!mode || mode==='off')return null;
  const method=event.requestContext?.http?.method || event.httpMethod;
  const path=event.rawPath || event.path;
  if(mode==='verify' && method==='GET' && READ_PATHS.has(path) &&
    !event.rawQueryString && !Object.keys(event.queryStringParameters || {}).length)return null;
  return {statusCode:503,isBase64Encoded:false,
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'120'},
    body:JSON.stringify({error:{code:'COED_MAINTENANCE',message:'ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง'}})};
}
module.exports={maintenanceResponse,READ_PATHS};
