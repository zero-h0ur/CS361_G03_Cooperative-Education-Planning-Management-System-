// Fixed messages/codes only. Never serialize an arbitrary error, body or SDK result.
const ERRORS=Object.freeze({
  VALIDATION_ERROR:[400,'กรุณากรอกข้อมูลเข้าสู่ระบบให้ถูกต้อง'],
  INVALID_CREDENTIALS:[401,'ไม่สามารถยืนยันตัวตนได้ กรุณาตรวจสอบบัญชีและรหัสผ่าน'],
  TU_ACCOUNT_UNAVAILABLE:[403,'บัญชียังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล'],
  TU_ATTESTATION_REJECTED:[403,'Access denied.'],
  TU_LOGIN_RATE_LIMIT:[429,'กรุณารอสักครู่แล้วลองเข้าสู่ระบบใหม่'],
  TU_API_RATE_LIMIT:[429,'ระบบมหาวิทยาลัยจำกัดจำนวนคำขอ กรุณารอสักครู่'],
  TU_AUTH_UNAVAILABLE:[503,'ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ'],
  TU_API_UNAVAILABLE:[503,'ติดต่อระบบมหาวิทยาลัยไม่สำเร็จ กรุณาลองใหม่'],
  TU_API_ACCESS_DENIED:[503,'ระบบมหาวิทยาลัยไม่อนุญาตคำขอ กรุณาติดต่อผู้ดูแล'],
  TU_API_INVALID_RESPONSE:[503,'อ่านผลจากระบบมหาวิทยาลัยไม่สำเร็จ'],
  TU_API_REQUEST_REJECTED:[503,'ระบบมหาวิทยาลัยไม่สามารถอ่านคำขอยืนยันตัวตน'],
  TU_SESSION_UNAVAILABLE:[503,'ระบบบัญชียังไม่พร้อม กรุณาลองใหม่'],
  TU_SIGNING_UNAVAILABLE:[503,'ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ'],
  TU_LOGIN_MAINTENANCE:[503,'ระบบเข้าสู่ระบบนักศึกษาปิดปรับปรุงชั่วคราว'],
  NOT_FOUND:[404,'Not found.'],METHOD_NOT_ALLOWED:[405,'Method not allowed.']
});
function safeError(error){
  const code=error?.statusCode===403 && error?.code!=='TU_ATTESTATION_REJECTED'?'TU_ACCOUNT_UNAVAILABLE':
    Object.hasOwn(ERRORS,error?.code)?error.code:'TU_SESSION_UNAVAILABLE';
  return {code,status:ERRORS[code][0],message:ERRORS[code][1]};
}
function safeLog(logger,fields){
  try{
    logger(JSON.stringify({requestId:/^[0-9a-f-]{36}$/i.test(fields.requestId)?fields.requestId:'unavailable',
      stage:['request','provider','invoke','identity','signing'].includes(fields.stage)?fields.stage:'request',
      code:fields.code==='OK' || Object.hasOwn(ERRORS,fields.code)?fields.code:'TU_SESSION_UNAVAILABLE',
      status:Number.isInteger(fields.status)?fields.status:503,
      durationMs:Math.max(0,Math.min(20000,Math.trunc(fields.durationMs || 0))),
      version:/^[1-9][0-9]*$/.test(fields.version)?fields.version:'local'}));
  }catch{/* A log sink must not leak a raw exception or change authentication. */}
}
module.exports={ERRORS,safeError,safeLog};
