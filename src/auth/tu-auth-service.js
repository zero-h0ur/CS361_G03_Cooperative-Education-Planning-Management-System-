// Local/API compatibility adapter. Split production handlers do not import this
// module: broker has no DB/signing; issuer has no provider dependency.
const {ServiceUnavailableError}=require('../api/errors');
const {TuProviderVerifier,validateTuLogin,DEFAULT_TU_API_URL,TU_API_URLS}=require('./tu-provider-verifier');
const {getTuKeyPair,tuConfig,DEFAULT_TU_ISSUER}=require('./tu-keys');
const {TuSessionService}=require('./tu-session-service');
class TuAuthService extends TuProviderVerifier {
  constructor(options={}){
    super(options);const config=tuConfig();
    this.clientId=options.clientId || config.clientId;this.kid=options.kid || config.kid;this.keyPair=options.keyPair;
    this.session=new TuSessionService({...options,issuer:this.issuer,clientId:this.clientId,kid:this.kid});
    this.pool=this.session.pool;this.identityResolver=this.session.identityResolver;
  }
  async login(input={}){
    const studentId=validateTuLogin(input);
    if(!this.isRealApiConfigured())throw new ServiceUnavailableError('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ','TU_AUTH_UNAVAILABLE');
    const keys=getTuKeyPair(this.keyPair);this.limit(studentId);
    const proof=this.assertVerifiedProof(await this.verifyWithRealTuApi(studentId,input.password));
    return this.session.issue(proof.subject,async()=>keys);
  }
}
module.exports={TuAuthService,DEFAULT_TU_API_URL,TU_API_URLS,DEFAULT_TU_ISSUER};
