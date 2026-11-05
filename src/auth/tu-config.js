const DEFAULT_TU_ISSUER='urn:coed:tu-auth';
const DEFAULT_TU_CLIENT_ID='coed-api';
const tuConfig=()=>({issuer:process.env.TU_AUTH_ISSUER || DEFAULT_TU_ISSUER,
  clientId:process.env.TU_AUTH_CLIENT_ID || DEFAULT_TU_CLIENT_ID,
  kid:process.env.TU_AUTH_KEY_ID || 'tu-key-1'});
module.exports={DEFAULT_TU_ISSUER,DEFAULT_TU_CLIENT_ID,tuConfig};
