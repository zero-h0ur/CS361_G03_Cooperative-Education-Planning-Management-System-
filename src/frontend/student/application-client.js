const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class ApplicationError extends Error {
  constructor(code,message,details=[]) {super(message);this.code=code;this.details=details;}
}
export const FILE_KINDS=Object.freeze({resume:'Resume',transcript:'Transcript',conduct:'ใบรับรองความประพฤติ',photo:'รูปนักศึกษา'});
export function validateApplicationFile(kind,file) {
  const photo=kind==='photo',max=(photo?5:10)*1024*1024;
  if(!Object.hasOwn(FILE_KINDS,kind) || !file || !Number.isInteger(file.size) || file.size<1 || file.size>max)
    throw new ApplicationError('FILE_INVALID',`ไฟล์ต้องไม่ว่าง และไม่เกิน ${photo?5:10} MiB`);
  const valid=photo?/\.(?:jpe?g|png)$/i.test(file.name) && ['image/jpeg','image/png'].includes(file.type):/\.pdf$/i.test(file.name) && file.type==='application/pdf';
  if(!valid)throw new ApplicationError('FILE_INVALID',photo?'ใช้ไฟล์ JPG หรือ PNG เท่านั้น':'ใช้ไฟล์ PDF เท่านั้น');
}
export function createApplicationClient({apiBaseUrl,getAccessToken,fetchImpl=globalThis.fetch,currentOrigin=globalThis.location?.origin,cryptoImpl=globalThis.crypto}={}) {
  const uploads=new Map(); // In-memory retry state only; never persisted in browser storage.
  const id=value=>{if(!UUID.test(value || ''))throw new ApplicationError('INVALID_ID','รหัสใบสมัครไม่ถูกต้อง');return value;};
  const path=appId=>`/api/v4/applications/${id(appId)}`;
  function url(suffix) {
    const allowed=/^\/api\/v4\/(?:application-options|applications(?:\/[a-f0-9-]{36}(?:\/(?:readiness|submit|uploads(?:\/[a-f0-9-]{36}\/(?:complete|content))?|documents\/[a-f0-9-]{36}\/(?:download|content)))?)?)$/i;
    if(!apiBaseUrl || !allowed.test(suffix))throw new ApplicationError('CONFIGURATION','ตั้งค่า API ไม่ครบ');
    const base=new URL(apiBaseUrl,currentOrigin);
    if(base.username || base.password || !['https:','http:'].includes(base.protocol) || (base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname)))throw new ApplicationError('CONFIGURATION','API ต้องใช้ HTTPS');
    base.pathname=base.pathname.replace(/\/$/,'')+suffix;base.search='';base.hash='';return base.href;
  }
  async function auth() {
    const token=await getAccessToken();if(!token)throw new ApplicationError('SESSION_EXPIRED','Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
    return {Authorization:`Bearer ${token}`};
  }
  async function request(suffix,method='GET',body,signal) {
    let response;
    try{response=await fetchImpl(url(suffix),{method,headers:{...await auth(),...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,signal,cache:'no-store',credentials:'omit',redirect:'error'});}
    catch(e){if(e.name==='AbortError' || e instanceof ApplicationError)throw e;
      throw new ApplicationError(method==='GET'?'NETWORK_ERROR':'RESULT_UNKNOWN',method==='GET'?'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่':'ยังยืนยันผลบันทึกไม่ได้ ข้อมูลที่กรอกยังอยู่ โปรดลองรายการเดิมซ้ำ');}
    let json;try{json=await response.json();}catch{throw new ApplicationError('INVALID_RESPONSE','ยังยืนยันผลรายการไม่ได้ กรุณาลองใหม่');}
    if(!response.ok)throw new ApplicationError(response.status===401?'SESSION_EXPIRED':response.status===403?'ACCESS_DENIED':json.error?.code || 'REQUEST_FAILED',
      response.status>=500?'ระบบยังไม่พร้อม ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง':json.error?.message || 'ทำรายการไม่สำเร็จ',json.error?.details || []);
    if(!Object.hasOwn(json,'data'))throw new ApplicationError('INVALID_RESPONSE','ข้อมูลตอบกลับไม่ครบ');return json.data;
  }
  function storageURL(target,expectedPath) {
    if(!target || typeof target.url!=='string')throw new ApplicationError('INVALID_RESPONSE','ไม่มีช่องทางรับส่งเอกสาร');
    const api=new URL(url(expectedPath)),dest=new URL(target.url,api.origin);
    if(target.auth_required===true) {
      if(dest.href!==api.href)throw new ApplicationError('UNSAFE_TARGET','ไม่สามารถส่งข้อมูลยืนยันตัวตนไปปลายทางนี้');
    }else if(target.auth_required!==false || dest.protocol!=='https:' || dest.username || dest.password || dest.hash)
      throw new ApplicationError('UNSAFE_TARGET','ปลายทางเอกสารไม่ปลอดภัย');
    return dest.href;
  }
  return Object.freeze({
    options:({signal}={})=>request('/api/v4/application-options','GET',null,signal),
    list:({signal}={})=>request('/api/v4/applications','GET',null,signal),
    get:(appId,{signal}={})=>request(path(appId),'GET',null,signal),
    create:(body,{signal}={})=>request('/api/v4/applications','POST',body,signal),
    save:(appId,body,{signal}={})=>request(path(appId),'PATCH',body,signal),
    readiness:(appId,{signal}={})=>request(path(appId)+'/readiness','GET',null,signal),
    submit:(appId,body,{signal}={})=>request(path(appId)+'/submit','POST',body,signal),
    async upload(appId,kind,file,{version,operationId,completeOperationId,signal,onPhase=()=>{}}={}) {
      validateApplicationFile(kind,file);onPhase('กำลังตรวจไฟล์');
      const bytes=await file.arrayBuffer(),sum=await cryptoImpl.subtle.digest('SHA-256',bytes);
      const checksum=Array.from(new Uint8Array(sum),b=>b.toString(16).padStart(2,'0')).join('');
      const signature=JSON.stringify({appId,version,kind,name:file.name,size:file.size,checksum,completeOperationId});
      let attempt=uploads.get(operationId);
      if(attempt && attempt.signature!==signature)throw new ApplicationError('IDEMPOTENCY_KEY_REUSED','กรุณาเริ่มรายการใหม่สำหรับไฟล์ที่เปลี่ยน');
      if(!attempt){attempt={signature};uploads.set(operationId,attempt);if(uploads.size>20)uploads.delete(uploads.keys().next().value);}
      const ticket=attempt.ticket || await request(path(appId)+'/uploads','POST',{operation_id:operationId,expected_version:version,kind,filename:file.name,
        content_type:file.type,byte_size:file.size,checksum},signal);
      attempt.ticket=ticket;
      const target=ticket.upload,dest=storageURL(target,`${path(appId)}/uploads/${id(ticket.ticket_id)}/content`);
      const local=target.auth_required===true;
      if(target.method!==(local?'PUT':'POST'))throw new ApplicationError('UNSAFE_TARGET','รูปแบบรับไฟล์ไม่ถูกต้อง');
      let body=file;if(!local){body=new FormData();for(const [k,v] of Object.entries(target.fields || {}))body.append(k,v);body.append('file',file);}
      onPhase('กำลังอัปโหลดไฟล์');
      if(!attempt.transferred){
        let response;try{response=await fetchImpl(dest,{method:target.method,headers:local?await auth():{},body,signal,cache:'no-store',credentials:'omit',redirect:'error'});}
        catch(e){if(e.name==='AbortError')throw e;throw new ApplicationError('UPLOAD_FAILED','ยังยืนยันผลอัปโหลดไม่ได้ ไฟล์เดิมยังอยู่ โปรดลองไฟล์เดิมซ้ำ');}
        if(!response.ok)throw new ApplicationError('UPLOAD_FAILED','อัปโหลดไม่สำเร็จ ไฟล์เดิมยังอยู่ กรุณาเลือกไฟล์แล้วลองใหม่');
        attempt.transferred=true;
      }
      onPhase('กำลังตรวจเนื้อหาและบันทึกไฟล์');
      let result;try{result=await request(`${path(appId)}/uploads/${ticket.ticket_id}/complete`,'POST',{operation_id:completeOperationId,expected_version:version},signal);}
      catch(e){if(e.code==='UPLOAD_EXPIRED')uploads.delete(operationId);throw e;}
      uploads.delete(operationId);return result;
    },
    async download(appId,documentId,{signal}={}) {
      const {download}=await request(`${path(appId)}/documents/${id(documentId)}/download`,'POST',{},signal);
      const dest=storageURL(download,`${path(appId)}/documents/${documentId}/content`);
      if(download.method!=='GET')throw new ApplicationError('UNSAFE_TARGET','รูปแบบดาวน์โหลดไม่ถูกต้อง');
      const response=await fetchImpl(dest,{method:'GET',headers:download.auth_required?await auth():{},signal,cache:'no-store',credentials:'omit',redirect:'error'});
      if(!response.ok)throw new ApplicationError('DOWNLOAD_FAILED','ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่');
      return response.blob();
    }
  });
}
