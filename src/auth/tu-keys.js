const crypto = require('node:crypto');
const {ServiceUnavailableError} = require('../api/errors');

const {DEFAULT_TU_ISSUER,DEFAULT_TU_CLIENT_ID,tuConfig}=require('./tu-config');
const {pem,getTuPublicKey}=require('./tu-public-key');
function getTuKeyPair(values = {}) {
  try {
    const input=values.privateKey || process.env.TU_AUTH_PRIVATE_KEY;
    if(!input)throw Error();
    const privateKey=input.type==='private'?input:crypto.createPrivateKey(pem(input));
    const publicKey=getTuPublicKey(values.publicKey || process.env.TU_AUTH_PUBLIC_KEY);
    if(privateKey.asymmetricKeyType!=='rsa' || privateKey.asymmetricKeyDetails.modulusLength<2048 ||
      !crypto.createPublicKey(privateKey).export({format:'der',type:'spki'}).equals(publicKey.export({format:'der',type:'spki'})))throw Error();
    return {privateKey,publicKey};
  } catch {throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ','TU_SIGNING_UNAVAILABLE');}
}
function signTuJwt(payload,{privateKey,kid=tuConfig().kid}={}) {
  const key=privateKey || getTuKeyPair().privateKey;
  const input=[{alg:'RS256',typ:'JWT',kid},payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');
}
module.exports={getTuKeyPair,getTuPublicKey,signTuJwt,tuConfig,DEFAULT_TU_ISSUER,DEFAULT_TU_CLIENT_ID};
