const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {ServiceUnavailableError}=require('../api/errors');
const {getTuKeyPair}=require('./tu-keys');
function createTuSigningKeyProvider({secretArn=process.env.TU_SIGNING_SECRET_ARN,client,clock=Date.now}={}){
  let cached,until=0,pending;
  return async function getKeys(){
    if(cached && until>clock())return cached;
    if(pending)return pending;
    pending=(async()=>{
      let timer;const abort=new AbortController();
      try{
        const match=typeof secretArn==='string' && secretArn.match(/^arn:aws:secretsmanager:([a-z0-9-]+):\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/);
        if(!match)throw Error();
        const secrets=client || new SecretsManagerClient({region:match[1],maxAttempts:1,
          requestHandler:{connectionTimeout:1000,requestTimeout:2000,throwOnRequestTimeout:true}});
        const response=await Promise.race([
          secrets.send(new GetSecretValueCommand({SecretId:secretArn,VersionStage:'AWSCURRENT'}),{abortSignal:abort.signal}),
          new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error());},2500);})]);
        if(typeof response.SecretString!=='string' || response.SecretString.length>32768)throw Error();
        const value=JSON.parse(response.SecretString);
        if(!value || Object.keys(value).length!==2 || typeof value.privateKey!=='string' || typeof value.publicKey!=='string')throw Error();
        cached=getTuKeyPair(value);until=clock()+60000;return cached;
      }catch{cached=null;until=0;throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ','TU_SIGNING_UNAVAILABLE');}
      finally{clearTimeout(timer);}
    })();
    try{return await pending;}finally{pending=null;}
  };
}
module.exports={createTuSigningKeyProvider};
