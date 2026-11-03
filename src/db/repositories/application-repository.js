const {getPool}=require('../connection');
const {assertCoordinatorSchema}=require('../coordinator-schema-contract');
const {ForbiddenError,NotFoundError,InvalidStateTransitionError}=require('../../api/errors');
class ApplicationRepository {
  constructor({pool}={}) {this.injectedPool=pool;}
  get pool(){return this.injectedPool || getPool();}
  async profile(db,actor,lock=false) {
    if(lock)await db.query("SELECT pg_advisory_xact_lock(hashtextextended('phase1:profile:' || $1::text,0))",[actor.studentId]);
    const row=(await db.query(`SELECT s.id AS student_id,s.student_number,s.full_name,s.institutional_email,
      s.department,s.program,s.major,s.academic_year FROM students s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.user_id=$2 AND u.role='STUDENT' AND u.account_status='ACTIVE'
      ${lock?'FOR SHARE OF u,s':''}`,[actor.studentId,actor.userId])).rows[0];
    if(!row)throw new ForbiddenError();
    const verified=(await db.query(`SELECT curriculum,entry_year,institution,source,verified_by,verified_at
      FROM phase1_academic_profiles WHERE student_id=$1`,[row.student_id])).rows[0];
    return {...row,...verified,academic_verified:Boolean(verified)};
  }
  async active(db,actor,lock=false) {
    const user=(await db.query(`SELECT role FROM users WHERE id=$1 AND account_status='ACTIVE' ${lock?'FOR SHARE':''}`,[actor.userId])).rows[0];
    if(!user || user.role!==actor.role)throw new ForbiddenError();
    await assertCoordinatorSchema(db);
  }
  async cycle(db,id,profile,lock=false) {
    if(lock)await db.query("SELECT pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || $1::text,0))",[id]);
    const row=(await db.query(`SELECT r.id,r.name,r.status,r.academic_year,r.semester FROM rounds r
      WHERE r.id=$1 AND (r.visibility='public' OR EXISTS(SELECT 1 FROM selection_cohorts c
      WHERE c.cycle_id=r.id AND c.status='ACTIVE' AND c.department=$2 AND c.program=$3))`,
    [id,profile.department,profile.program])).rows[0];
    if(!row)throw new NotFoundError('ไม่พบรอบที่คุณมีสิทธิ์สมัคร');
    const window=(await db.query(`SELECT *,clock_timestamp()>=opens_at AND clock_timestamp()<closes_at AS is_open
      FROM phase1_cycle_windows WHERE cycle_id=$1`,[id])).rows[0] || null;
    return {...row,window};
  }
  async application(db,id,actor,lock=false) {
    const row=(await db.query(`SELECT a.* FROM phase1_applications a JOIN students s ON s.id=a.student_id
      WHERE a.id=$1 AND (($2='STUDENT' AND s.user_id=$3 AND s.id=$4) OR
        ($2='COORDINATOR' AND a.status IN ('SUBMITTED','NEEDS_REVISION') AND EXISTS(SELECT 1 FROM selection_cohorts c
          WHERE c.cycle_id=a.cycle_id AND c.department=s.department AND c.program=s.program
          AND c.status='ACTIVE' AND c.coordinator_id=$3))) ${lock?'FOR UPDATE OF a':''}`,
    [id,actor.role,actor.userId,actor.studentId || null])).rows[0];
    if(!row)throw new NotFoundError('ไม่พบใบสมัครที่คุณมีสิทธิ์อ่าน');
    return row;
  }
  async policy(db,app,official) {
    const curriculum=official.curriculum || app.payload.curriculum;
    return (await db.query(`SELECT * FROM phase1_policies WHERE cycle_id=$1 AND curriculum=$2 ORDER BY version DESC LIMIT 1`,[app.cycle_id,curriculum || ''])).rows[0] || null;
  }
  async documents(db,id) {
    return (await db.query(`SELECT d.id,d.kind,d.filename,d.content_type,d.byte_size,d.checksum,d.created_at
      FROM phase1_attachments a JOIN phase1_documents d ON d.id=a.document_id WHERE a.application_id=$1 ORDER BY d.kind`,[id])).rows;
  }
  async editable(db,app,official) {
    if(!['DRAFT','NEEDS_REVISION'].includes(app.status))throw new InvalidStateTransitionError('ใบสมัครที่ส่งแล้วแก้ไขไม่ได้');
    const cycle=await this.cycleForApplication(db,app,official,true);
    if(cycle.status!=='OPEN' || (cycle.window && !cycle.window.is_open))throw new InvalidStateTransitionError('รอบสมัครนี้ไม่เปิดให้แก้ไขแล้ว');
    return cycle;
  }
  async cycleForApplication(db,app,official,lock=false) {
    const cycle=await this.cycle(db,app.cycle_id,official,lock);
    if(app.status!=='NEEDS_REVISION')return cycle;
    const window=(await db.query(`SELECT w.review_opens_at AS opens_at,w.review_closes_at AS closes_at,w.version,
      clock_timestamp()>=w.review_opens_at AND clock_timestamp()<w.review_closes_at AS is_open
      FROM coordinator_reviews rv JOIN selection_cohorts c ON c.id=rv.cohort_id AND c.status='ACTIVE'
      JOIN phase1_cycle_windows w ON w.cycle_id=c.cycle_id
      WHERE rv.application_id=$1 AND rv.state='RETURNED' AND c.cycle_id=$2
        AND c.department=$3 AND c.program=$4`,[app.id,app.cycle_id,official.department,official.program])).rows[0];
    // A correction never creates an exception without a recorded return and a stored deadline.
    return {...cycle,window:window || {is_open:false}};
  }
}
module.exports={ApplicationRepository};
