const {ForbiddenError}=require('../api/errors');
const {getPool}=require('../db/connection');
const {IdentityResolver}=require('./identity-resolver');
const {tuConfig}=require('./tu-config');
const {signTuJwt}=require('./tu-keys');
class TuSessionService {
  constructor(options={}){
    Object.assign(this,tuConfig(),options);this.clock=options.clock || Date.now;
    this.identityResolver=options.identityResolver || new IdentityResolver({pool:options.pool});
  }
  // Trusted server callers only; not a route or provider-proof factory.
  async issue(subject,getKeys){
    if(!/^\d{10}$/.test(subject))throw new ForbiddenError();
    const identity=await this.identityResolver.resolveIdentity(this.issuer,subject);
    if(identity.role!=='STUDENT' || identity.accountStatus!=='ACTIVE')throw new ForbiddenError();
    const pool=this.pool || getPool();
    const profile=(await pool.query(`SELECT s.id,s.student_number,s.full_name,s.preferred_name,s.institutional_email,
      s.department,s.program,s.major,s.academic_year,s.enrollment_status,s.version,
      s.contact_email,s.contact_phone,s.contact_address FROM students s JOIN users u ON u.id=s.user_id
      JOIN external_identity_links l ON l.user_id=u.id AND l.external_issuer=$4 AND l.external_subject=$3 AND l.status='ACTIVE'
      WHERE s.id=$1 AND s.user_id=$2 AND s.student_number=$3 AND u.role='STUDENT' AND u.account_status='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM external_identity_links other WHERE other.user_id=u.id AND other.status='ACTIVE' AND other.id<>l.id)`,
    [identity.studentId,identity.userId,subject,this.issuer])).rows[0];
    if(!profile || profile.student_number!==subject)throw new ForbiddenError('บัญชียังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล','TU_LINK_REQUIRED');
    if(identity.onboarding)profile.onboarding=require('./tu-registration-contract').metadata(identity.onboarding,profile);
    const keys=await getKeys(),now=Math.floor(this.clock()/1000),expiresIn=900;
    const accessToken=signTuJwt({sub:subject,iss:this.issuer,client_id:this.clientId,token_use:'access',scope:'coed-api/access',iat:now,nbf:now,exp:now+expiresIn},{privateKey:keys.privateKey,kid:this.kid});
    return {accessToken,tokenType:'Bearer',expiresIn,mode:'tu_api',user:{id:identity.userId,role:'STUDENT',studentId:profile.id},profile};
  }
}
module.exports={TuSessionService};
