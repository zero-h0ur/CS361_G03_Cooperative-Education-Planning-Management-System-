import {T,safeFlags} from './contract.mjs';
// ECMAScript trim characters: match the runtime completeness rule without
// returning student text to the diagnostic operator.
const trimChars='\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
export const LOOKUP=`WITH tu AS (
 SELECT id,user_id,status FROM public.external_identity_links WHERE external_issuer=$2 AND external_subject=$1
), tu_user AS (SELECT DISTINCT user_id FROM tu), matched AS (
 SELECT id,user_id FROM public.students WHERE student_number=$1
), candidates AS (SELECT user_id FROM tu_user UNION SELECT user_id FROM matched), profiles AS (
 SELECT s.user_id,s.student_number=$1 AS subject_matches,s.version>0 AS version_valid,
   s.academic_year>0 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[s.student_number,s.full_name,
    s.institutional_email,s.department,s.program,s.major,s.enrollment_status]) field
    WHERE field IS NULL OR field='' OR field<>btrim(field,$3)) AS complete
 FROM public.students s JOIN tu_user t ON t.user_id=s.user_id
), active AS (
 SELECT l.external_issuer FROM public.external_identity_links l JOIN candidates c ON c.user_id=l.user_id WHERE l.status='ACTIVE'
)
SELECT
 (SELECT least(count(*),2)::int FROM tu) AS tu_links,
 (SELECT least(count(*),2)::int FROM matched) AS matching_students,
 (SELECT least(count(*),2)::int FROM candidates) AS candidate_users,
 (SELECT least(count(*),2)::int FROM public.external_identity_links l JOIN tu_user t ON t.user_id=l.user_id WHERE l.status='ACTIVE') AS active_links,
 (SELECT least(count(*),2)::int FROM profiles) AS canonical_students,
 coalesce((SELECT bool_and(status='ACTIVE') FROM tu),false) AS tu_link_active,
 EXISTS(SELECT 1 FROM public.users u JOIN tu_user t ON t.user_id=u.id) AS canonical_user_exists,
 coalesce((SELECT bool_and(u.role='STUDENT') FROM public.users u JOIN tu_user t ON t.user_id=u.id),false) AS student_role,
 coalesce((SELECT bool_and(u.account_status='ACTIVE') FROM public.users u JOIN tu_user t ON t.user_id=u.id),false) AS account_active,
 coalesce((SELECT bool_and(complete) FROM profiles),false) AS profile_complete,
 coalesce((SELECT bool_and(subject_matches) FROM profiles),false) AS subject_owner_matches,
 coalesce((SELECT bool_and(version_valid) FROM profiles),false) AS profile_version_valid,
 EXISTS(SELECT 1 FROM active WHERE external_issuer ~ '^https://cognito-idp[.][a-z0-9-]+[.]amazonaws[.]com/[A-Za-z0-9_-]+$') AS active_cognito_link,
 EXISTS(SELECT 1 FROM active WHERE external_issuer=$2) AS active_tu_link,
 EXISTS(SELECT 1 FROM active WHERE external_issuer<>$2 AND external_issuer !~ '^https://cognito-idp[.][a-z0-9-]+[.]amazonaws[.]com/[A-Za-z0-9_-]+$') AS active_other_link`;
export async function inspectIdentity(client,subject){
 await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const check=(await client.query("SELECT current_user=$1 AND session_user=$1 AND current_database()=$2 AND current_setting('transaction_read_only')='on' AS ok",[T.user,T.database])).rows[0];
  if(check?.ok!==true){const e=Error();e.safeCode='DIAG_CONNECTION_INVALID';throw e;}
  const result=await client.query(LOOKUP,[subject,T.issuer,trimChars]);
  if(result.rows.length!==1){const e=Error();e.safeCode='DIAG_RESULT_INVALID';throw e;}
  return safeFlags(result.rows[0]);
 }finally{await client.query('ROLLBACK');}
}
