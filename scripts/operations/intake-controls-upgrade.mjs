// C7 fixed021+022 forward upgrade and explicitly approved isolated metadata.
// Dedicated connection only; no AWS/credential/implicit database access.
import {createHash} from 'node:crypto';
import {readPendingIntakeSql,VERSION as V21,SQL_SHA256 as S21} from './student-intake-contract.mjs';
import {readIntakeControlsSql,VERSION as V22,SQL_SHA256 as S22} from './intake-controls-contract.mjs';
import {identifier,captureCatalog,catalogHash} from './present-schema-baseline.mjs';
import {verifyRecordedHistory} from './present-schema-upgrade.mjs';
import catalogReader from './tu-preflight/catalog.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateManifest(m){
 if(!m || Object.keys(m).sort().join(',')!=='baselineCatalogHash,cohortId,coordinatorSubject,coordinatorUserId,cycleId,members,sourceCohortId,sourceCycleId,studentId,studentUserId,version' || m.version!==1 ||
  ![m.cohortId,m.coordinatorUserId,m.cycleId,m.sourceCohortId,m.sourceCycleId,m.studentId,m.studentUserId].every(x=>UUID.test(x)) ||
  !Array.isArray(m.members) || m.members.length!==3 || !m.members.every(x=>UUID.test(x)) || new Set(m.members).size!==3 || m.members.includes(m.coordinatorUserId) ||
  m.cycleId===m.sourceCycleId || m.cohortId===m.sourceCohortId || !/^[a-f0-9-]{36}$/.test(m.coordinatorSubject) || !/^[a-f0-9]{64}$/.test(m.baselineCatalogHash))fail('C7_MANIFEST_DENIED');
 return m;
}
function historyBefore(rows){
 verifyRecordedHistory(rows.filter(r=>!['019_tu_student_registration.sql','020_tu_registration_issuer_alignment.sql'].includes(r.version)),{upgraded:true});
 if(rows.find(r=>r.version==='019_tu_student_registration.sql')?.checksum!=='321f90ece54cca0d98f137b50813ca0dea4ba58f36b6166f0088475eae655f85' ||
  rows.find(r=>r.version==='020_tu_registration_issuer_alignment.sql')?.checksum!=='3ea3a1fc31ea7a839fff1d8fb94d3d8732d26042edc9dd4a03dbc62610082790')fail('C7_HISTORY_DRIFT');
}
async function postCatalog(client){
 const result={notice:'Observed present schema, NOT recovered historical SQL; no business rows',version:1};
 for(const [key,sql] of Object.entries(catalogReader.SQL)){
  result[key]=(await client.query(sql.replaceAll("'public'",'current_schema()'),['inventory','routine_acl','dependencies'].includes(key)?[]:
   [[...catalogReader.TABLES,'tu_student_registrations','tu_registration_receipts','phase1_intake_routes','phase1_intake_controls','phase1_intake_control_events']])).rows;
  if(result[key].length>catalogReader.LIMITS[key])fail('C7_CATALOG_LIMIT');
 }return catalogReader.assertSafeCatalog(result);
}
async function fingerprint(client,schema,names,m){
 const result=[];
 for(const name of names){const filter=name==='rounds'?' WHERE id<>$1':name==='selection_cohorts'?' WHERE id<>$1':'';
  const values=filter?[name==='rounds'?m.cycleId:m.cohortId]:[];
  result.push({name,...(await client.query(`SELECT count(*)::text n,md5(coalesce(string_agg(h,'' ORDER BY h),'')) fingerprint
   FROM (SELECT md5(to_jsonb(r)::text) h FROM ${identifier(schema)}.${identifier(name)} r${filter}) x`,values)).rows[0]});
 }return digest(result);
}
async function checkBindings(db,m){
 const cohort=(await db.query('SELECT * FROM selection_cohorts WHERE id=$1 FOR SHARE',[m.sourceCohortId])).rows[0];
 if(!cohort || cohort.cycle_id!==m.sourceCycleId || cohort.coordinator_id!==m.coordinatorUserId || cohort.department!=='CPE' || cohort.program!=='CS' || cohort.status!=='ACTIVE' ||
  JSON.stringify([cohort.committee_one,cohort.committee_two,cohort.committee_three])!==JSON.stringify(m.members))fail('C7_ASSIGNMENT_DRIFT');
 if((await db.query("SELECT count(*)::int n FROM users WHERE id=ANY($1::uuid[]) AND role='COMMITTEE' AND account_status='ACTIVE'",[m.members])).rows[0].n!==3)fail('C7_ASSIGNMENT_DRIFT');
 if((await db.query(`SELECT u.id FROM users u JOIN external_identity_links l ON l.user_id=u.id WHERE u.id=$1 AND u.role='COORDINATOR' AND u.account_status='ACTIVE'
  AND l.status='ACTIVE' AND l.external_issuer='https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Um6nksXa1' AND l.external_subject=$2`,[m.coordinatorUserId,m.coordinatorSubject])).rowCount!==1)fail('C7_COORDINATOR_DRIFT');
 const registration=(await db.query(`SELECT t.program_type,t.identity FROM tu_student_registrations t JOIN students s ON s.id=t.student_id AND s.user_id=t.user_id
  JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND u.id=$2 AND s.identity_source='TU_ONBOARDING' AND u.role='STUDENT' AND u.account_status='ACTIVE'
  AND EXISTS(SELECT 1 FROM external_identity_links l WHERE l.user_id=u.id AND l.external_issuer='urn:coed:tu-auth:130165494095' AND l.external_subject=s.student_number AND l.status='ACTIVE')`,[m.studentId,m.studentUserId])).rows;
 if(registration.length!==1 || !['regular','special'].includes(registration[0].program_type) || !registration[0].identity?.faculty?.trim() || !registration[0].identity?.department?.trim())fail('C7_STUDENT_DRIFT');
 return registration[0];
}
async function provision(db,m){
 const reg=await checkBindings(db,m);
 await db.query(`INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status)
  VALUES($1,'รอบทดสอบรับสมัคร CO-ED 2569/1 · เฉพาะบัญชีที่อนุมัติ',2569,1,'OPEN','isolated-intake-test','private','mock')`,[m.cycleId]);
 await db.query(`INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three)
  VALUES($1,$2,'CPE','CS',$3,$4,$5,$6)`,[m.cohortId,m.cycleId,m.coordinatorUserId,...m.members]);
 for(const curriculum of ['61','66'])await db.query(`INSERT INTO phase1_intake_routes(id,cycle_id,cohort_id,tu_faculty,tu_department,program_type,curriculum,version,source,approved_by)
  VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,1,'C7 owner-authorized test routing; responsible Coordinator; not academic certification',$7)`,
 [m.cycleId,m.cohortId,reg.identity.faculty,reg.identity.department,reg.program_type,curriculum,m.coordinatorUserId]);
 // Responsible Coordinator, not a fabricated interactive Coordinator command.
 // The actual AWS operator/approval is captured in the execution checkpoint.
 await db.query("INSERT INTO phase1_intake_controls(cycle_id,mode,version,updated_by) VALUES($1,'CLOSED',1,$2)",[m.cycleId,m.coordinatorUserId]);
}
export async function upgradeIntake({client,manifest,mode='trial',expectedDatabase='coed',expectedSchema='public',expectedPostHash}={}){
 const m=validateManifest(manifest),sql21=readPendingIntakeSql(),sql22=readIntakeControlsSql();
 if(!client || !['inventory','trial','apply'].includes(mode) ||
  !(expectedDatabase==='coed' && expectedSchema==='public' || process.env.NODE_ENV==='test' && expectedDatabase==='coed_intake_test' && /^present_[a-f0-9]+$/.test(expectedSchema)))fail('C7_OWNER_TARGET_REQUIRED');
 identifier(expectedSchema);let began=false;
 try{
  if((await client.query('SELECT transaction_timestamp()=statement_timestamp() AS idle')).rows[0]?.idle!==true)fail('C7_IDLE_REQUIRED');
  await client.query('BEGIN');began=true;await client.query("SET LOCAL statement_timeout='15000ms'");await client.query("SET LOCAL lock_timeout='1000ms'");
  await client.query(`SET LOCAL search_path TO ${identifier(expectedSchema)},public`);
  const context=(await client.query('SELECT current_user AS role,current_database() AS db,current_schema() AS schema')).rows[0];
  if(context.role!=='postgres' || context.db!==expectedDatabase || context.schema!==expectedSchema)fail('C7_OWNER_TARGET_REQUIRED');
  await client.query('SELECT pg_advisory_xact_lock(563003057)');
  await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE');
  const history=(await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  const replay=history.some(r=>r.version===V22);
  if(replay){historyBefore(history.filter(r=>![V21,V22].includes(r.version)));
   if(history.find(r=>r.version===V21)?.checksum!==S21 || history.find(r=>r.version===V22)?.checksum!==S22 || !expectedPostHash || catalogHash(await postCatalog(client),expectedSchema)!==expectedPostHash)fail('C7_REPLAY_DRIFT');
   await checkBindings(client,m);if(!(await client.query('SELECT cycle_id FROM phase1_intake_controls WHERE cycle_id=$1',[m.cycleId])).rowCount)fail('C7_METADATA_DRIFT');
   await client.query('ROLLBACK');began=false;return {idempotentReplay:true,preservationVerified:true};
  }
  historyBefore(history);const before=await captureCatalog(client);
  if(catalogHash(before,expectedSchema)!==m.baselineCatalogHash)fail('C7_BASELINE_DRIFT');
  await checkBindings(client,m);
  if(mode==='inventory'){await client.query('ROLLBACK');began=false;return {inventoryVerified:true,noDatabaseWrites:true};}
  const names=[...new Set([...before.tables.map(t=>t.name),'tu_student_registrations','tu_registration_receipts'])].filter(n=>n!=='schema_migrations').sort();
  for(const name of names)await client.query(`LOCK TABLE ${identifier(expectedSchema)}.${identifier(name)} IN SHARE ROW EXCLUSIVE MODE`);
  const preserved=await fingerprint(client,expectedSchema,names,m);
  await client.query("SET LOCAL coed.pending_intake_upgrade='observed020-to021'");await client.query(sql21);
  await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[V21,S21]);
  await client.query("SET LOCAL coed.intake_controls_upgrade='observed021-controls'");await client.query(sql22);
  await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[V22,S22]);
  await provision(client,m);
  if(await fingerprint(client,expectedSchema,names,m)!==preserved)fail('C7_PRESERVATION_FAILED');
  const afterHistory=(await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  if(digest(afterHistory)!==digest([...history,{version:V21,checksum:S21},{version:V22,checksum:S22}]))fail('C7_HISTORY_DRIFT');
  const postHash=catalogHash(await postCatalog(client),expectedSchema);
  if(mode==='apply' && (!expectedPostHash || postHash!==expectedPostHash))fail('C7_TRIAL_POSTCONDITION_REQUIRED');
  await client.query(mode==='apply'?'COMMIT':'ROLLBACK');began=false;
  return {applied:mode==='apply',preservationVerified:true,postCatalogHash:postHash,versions:[V21,V22],
   provisioned:{cycle_id:m.cycleId,cohort_id:m.cohortId,mode:'CLOSED',routeCount:2},noAccountChanges:true};
 }catch(error){if(began)await client.query('ROLLBACK').catch(()=>{});const e=Error(/^C7_[A-Z_]+$/.test(error.safeCode || '')?error.safeCode:'C7_UPGRADE_FAILED');e.safeCode=e.message;
  if(/^[A-Z0-9]{5}$/.test(error.code || ''))e.sqlState=error.code;throw e;}
}
