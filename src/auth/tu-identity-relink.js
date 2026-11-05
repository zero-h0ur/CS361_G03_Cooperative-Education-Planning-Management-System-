// Controlled operator library, intentionally NOT an HTTP route/CLI or login hook.
// A caller must supply an approved admin connection and fresh server TU proof.
const {randomUUID,createHash}=require('node:crypto');
const {TuAuthService}=require('./tu-auth-service');
const {uuid}=require('../api/services/application-input');
const {ForbiddenError,ConflictError}=require('../api/errors');

async function relinkTuIdentity({connection,verifier,proof,operatorId,userId,studentId,oldLinkId,oldIssuer,operationId,apply=false}) {
  if(!(verifier instanceof TuAuthService))throw new ForbiddenError();
  const verified=verifier.assertVerifiedProof(proof);
  for(const id of [operatorId,userId,studentId,oldLinkId,operationId])uuid(id);
  if(!/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/.test(oldIssuer || '') || oldIssuer===verified.issuer)throw new ForbiddenError();
  const requestHash=createHash('sha256').update(JSON.stringify({operatorId,userId,studentId,oldLinkId,oldIssuer,issuer:verified.issuer,subject:verified.subject})).digest('hex');
  const db=connection;
  await db.query('BEGIN');
  try {
    // Separate privileged operator, never runtime coed_app or user-controlled JWT role.
    const owner=(await db.query(`SELECT EXISTS(SELECT 1 FROM pg_class WHERE oid='tu_identity_link_events'::regclass
      AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS allowed`)).rows[0];
    if(!owner?.allowed)throw new ForbiddenError();
    const operator=(await db.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' FOR SHARE",[operatorId])).rows[0];
    if(!operator)throw new ForbiddenError();
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operationId]);
    const student=(await db.query(`SELECT s.id,s.student_number FROM students s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND u.id=$2 AND u.role='STUDENT' AND u.account_status='ACTIVE' FOR UPDATE OF u,s`,[studentId,userId])).rows[0];
    if(!student || student.student_number!==verified.subject)throw new ForbiddenError('ยืนยันเจ้าของบัญชีไม่สำเร็จ','TU_LINK_OWNER_MISMATCH');
    const previous=(await db.query('SELECT * FROM tu_identity_link_events WHERE operation_id=$1',[operationId])).rows[0];
    if(previous) {
      if(previous.request_hash!==requestHash)throw new ConflictError('Operation ID ถูกใช้แล้ว','IDEMPOTENCY_KEY_REUSED');
      const active=(await db.query("SELECT id FROM external_identity_links WHERE user_id=$1 AND status='ACTIVE'",[userId])).rows;
      if(active.length!==1 || active[0].id!==previous.new_link_id)throw new ConflictError('บัญชีมีการเปลี่ยนแปลงภายหลัง');
      await db.query('ROLLBACK');return {userId,studentId,newLinkId:previous.new_link_id,applied:true,idempotentReplay:true};
    }
    const links=(await db.query('SELECT * FROM external_identity_links WHERE user_id=$1 OR (external_issuer=$2 AND external_subject=$3) FOR UPDATE',[userId,verified.issuer,verified.subject])).rows;
    const active=links.filter(link=>link.user_id===userId && link.status==='ACTIVE');
    if(active.length!==1 || active[0].id!==oldLinkId || active[0].external_issuer!==oldIssuer ||
      links.some(link=>link.external_issuer===verified.issuer && link.external_subject===verified.subject))throw new ConflictError('การผูกบัญชีไม่ตรงกับรายการที่อนุมัติ','TU_LINK_CONFLICT');
    const newLinkId=randomUUID();
    await db.query("UPDATE external_identity_links SET status='REVOKED',revoked_at=clock_timestamp(),revoked_by=$2,updated_at=clock_timestamp() WHERE id=$1",[oldLinkId,operatorId]);
    await db.query('INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,$3,$4)',[newLinkId,userId,verified.issuer,verified.subject]);
    await db.query(`INSERT INTO tu_identity_link_events(operation_id,operator_id,user_id,student_id,old_link_id,new_link_id,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[operationId,operatorId,userId,studentId,oldLinkId,newLinkId,requestHash]);
    await db.query(apply?'COMMIT':'ROLLBACK');
    return {userId,studentId,newLinkId,applied:apply,idempotentReplay:false};
  } catch(error) {await db.query('ROLLBACK');if(error.code==='23505')throw new ConflictError('บัญชีถูกผูกแล้ว','TU_LINK_CONFLICT');throw error;}
}
module.exports={relinkTuIdentity};
