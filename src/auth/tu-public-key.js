const crypto=require('node:crypto');
const {ServiceUnavailableError}=require('../api/errors');
const pem=value=>typeof value==='string'?value.replace(/\\n/g,'\n'):value;
function getTuPublicKey(value=process.env.TU_AUTH_PUBLIC_KEY) {
  try {
    if(!value)throw Error();
    const key=value.type==='public'?value:crypto.createPublicKey(pem(value));
    if(key.asymmetricKeyType!=='rsa' || key.asymmetricKeyDetails.modulusLength<2048)throw Error();
    return key;
  }catch{throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ','TU_SIGNING_UNAVAILABLE');}
}
module.exports={pem,getTuPublicKey};
