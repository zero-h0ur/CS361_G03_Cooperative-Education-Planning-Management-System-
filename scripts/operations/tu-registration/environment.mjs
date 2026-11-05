// Pure configuration assembly: no AWS calls, secrets or account provisioning.
import {createPublicKey,createHash} from 'node:crypto';

function requireConfig(condition){
 if(!condition)throw Object.assign(Error('REGISTRATION_ENVIRONMENT_REJECTED'),{safeCode:'REGISTRATION_ENVIRONMENT_REJECTED'});
}
export function publicKeyFingerprint(value){
 try{
  requireConfig(typeof value==='string');
  const pem=value.replace(/\\n/g,'\n');
  requireConfig(pem.startsWith('-----BEGIN PUBLIC KEY-----')&&!pem.includes('PRIVATE KEY'));
  const key=createPublicKey(pem);
  requireConfig(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=2048);
  return createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
 }catch{requireConfig(false);}
}
export function issuerRegistrationEnvironment(issuer,verifier,registrationSecret){
 requireConfig(issuer?.NODE_ENV==='production'&&issuer.DB_USER==='coed_tu_login');
 for(const name of ['TU_AUTH_ISSUER','TU_AUTH_CLIENT_ID'])
  requireConfig(typeof issuer[name]==='string'&&issuer[name].length>0&&issuer[name]===verifier?.[name]);
 const kid=verifier.TU_AUTH_KEY_ID||'tu-key-1';
 requireConfig(typeof kid==='string'&&kid.length>0&&(issuer.TU_AUTH_KEY_ID||'tu-key-1')===kid);
 const fingerprint=publicKeyFingerprint(verifier.TU_AUTH_PUBLIC_KEY);
 if(issuer.TU_AUTH_PUBLIC_KEY!==undefined)requireConfig(publicKeyFingerprint(issuer.TU_AUTH_PUBLIC_KEY)===fingerprint);
 requireConfig(typeof registrationSecret==='string'&&/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:coed\/v4\/postgres\/tu-registration-[A-Za-z0-9]{6}$/.test(registrationSecret));
 if(issuer.TU_REGISTRATION_DB_SECRET_ARN!==undefined)requireConfig(issuer.TU_REGISTRATION_DB_SECRET_ARN===registrationSecret);
 return {...issuer,TU_ONBOARDING_ENABLED:'true',TU_AUTH_PUBLIC_KEY:issuer.TU_AUTH_PUBLIC_KEY??verifier.TU_AUTH_PUBLIC_KEY,
  TU_AUTH_KEY_ID:kid,TU_REGISTRATION_DB_SECRET_ARN:registrationSecret};
}
