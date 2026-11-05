const {metadata}=require('./tu-registration-contract');
// This query is gated until019 is deployed. Never infer the new profile variant
// merely from missing canonical fields on an existing account.
async function loadRegistrationProfile(pool,studentId,userId,profile){
 const row=(await pool.query(`SELECT r.identity,r.program_type,r.entry_year,r.study_source,r.academic_verification
  FROM tu_student_registrations r JOIN students s ON s.id=r.student_id AND s.user_id=r.user_id
  WHERE r.student_id=$1 AND r.user_id=$2 AND s.identity_source='TU_ONBOARDING'`,[studentId,userId])).rows[0];
 return row?metadata(row,profile):null;
}
module.exports={loadRegistrationProfile};
