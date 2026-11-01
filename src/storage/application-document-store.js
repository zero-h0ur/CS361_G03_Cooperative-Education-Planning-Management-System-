const {createHash}=require('node:crypto');
const {ValidationError,ServiceUnavailableError}=require('../api/errors');
const {FILES}=require('../api/services/application-input');
function validateBytes(bytes,ticket) {
  if(!Buffer.isBuffer(bytes) || bytes.length!==ticket.byte_size || bytes.length>FILES[ticket.kind]
    || createHash('sha256').update(bytes).digest('hex')!==ticket.checksum)throw new ValidationError('ขนาดหรือ checksum ไฟล์ไม่ตรง');
  let type=null;
  if(bytes.length>=20 && /^%PDF-(1\.[0-7]|2\.0)/.test(bytes.subarray(0,9).toString('ascii')) && bytes.subarray(-2048).includes(Buffer.from('%%EOF')))type='application/pdf';
  else if(bytes.length>=32 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.subarray(12,16).toString()==='IHDR' && bytes.readUInt32BE(16)>0 && bytes.readUInt32BE(20)>0
    && bytes.subarray(-8,-4).toString()==='IEND')type='image/png';
  else if(bytes.length>=6 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    && bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217)type='image/jpeg';
  const name=ticket.filename.toLowerCase();
  if(!type || type!==ticket.content_type || (type==='image/png' && !name.endsWith('.png'))
    || (type==='image/jpeg' && !/\.jpe?g$/.test(name)))throw new ValidationError('เนื้อหาไฟล์ไม่ตรงชนิดที่อนุญาต');
  return type;
}
function createDocumentStore(env=process.env) {
  if(env.CO_ED_APPLICATION_STORAGE==='local') {
    if(!['development','test'].includes(env.NODE_ENV) || env.AWS_LAMBDA_FUNCTION_NAME)throw new ServiceUnavailableError('ห้ามใช้ local document store บนระบบจริง');
    return new (require('./local-document-store').LocalDocumentStore)({root:env.CO_ED_APPLICATION_LOCAL_DIR});
  }
  if(env.CO_ED_APPLICATION_STORAGE==='s3')return new (require('./s3-document-store').S3DocumentStore)({bucket:env.CO_ED_APPLICATION_BUCKET,region:env.CO_ED_APPLICATION_REGION});
  throw new ServiceUnavailableError('ยังไม่ได้ตั้งค่าพื้นที่เก็บเอกสารส่วนตัว');
}
module.exports={validateBytes,createDocumentStore};
