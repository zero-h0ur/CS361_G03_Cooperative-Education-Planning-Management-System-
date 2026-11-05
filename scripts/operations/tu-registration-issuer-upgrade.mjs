// Fixed observed019 ->020 owner operation; never opens a DB or reads credentials.
import {readFileSync} from 'node:fs';
import {identifier,sha256} from './present-schema-baseline.mjs';
import {verifyRecordedHistory} from './present-schema-upgrade.mjs';
import {VERSION as PREVIOUS,SQL_SHA256 as PREVIOUS_SHA,POST_SHA256 as PREVIOUS_CATALOG,
 registrationCatalog,registrationCatalogHash} from './tu-registration-upgrade.mjs';
export const VERSION='020_tu_registration_issuer_alignment.sql';
export const ISSUER='urn:coed:tu-auth:130165494095';
export const SQL_SHA256='3ea3a1fc31ea7a839fff1d8fb94d3d8732d26042edc9dd4a03dbc62610082790';
const targets=['complete_tu_registration','guard_tu_registration_profile'];
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
export function readIssuerSql(){
 const bytes=readFileSync(new URL('../../src/db/upgrades/'+VERSION,import.meta.url));
 if(bytes.includes(13)||sha256(bytes)!==SQL_SHA256)fail('ISSUER020_SOURCE_INTEGRITY');return bytes.toString('utf8');
}
export function transformedCatalog(catalog,reverse=false){
 const value=structuredClone(catalog),from="'"+(reverse?ISSUER:'urn:coed:tu-auth')+"'",to="'"+(reverse?'urn:coed:tu-auth':ISSUER)+"'";
 const found=value.routines.filter(r=>targets.includes(r.name));
 if(found.length!==2||new Set(found.map(r=>r.name)).size!==2)fail('ISSUER020_ROUTINE_DRIFT');
 for(const r of found){
  if(r.definition.split(from).length!==2||r.definition.includes(to))fail('ISSUER020_ROUTINE_DRIFT');
  r.definition=r.definition.replace(from,to);
 }
 return value;
}
async function roleMetadata(client){
 return (await client.query(`SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
  has_schema_privilege(r.oid,current_schema(),'CREATE') AS schema_create,
  (SELECT coalesce(jsonb_agg(jsonb_build_array(parent.rolname,member.rolname,m.grantor::regrole::text,m.admin_option,m.inherit_option,m.set_option)
   ORDER BY parent.rolname,member.rolname),'[]'::jsonb) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
   JOIN pg_roles member ON member.oid=m.member WHERE m.member=r.oid OR m.roleid=r.oid) AS memberships
  FROM pg_roles r WHERE r.rolname IN ('coed_app','coed_tu_login','coed_tu_registration','coed_tu_registration_owner') ORDER BY r.rolname`)).rows;
}
async function routineMetadata(client){
 return (await client.query(`SELECT p.oid::text,p.proname,p.proowner::regrole::text AS owner,p.proacl::text AS acl,
  p.prosecdef,p.proconfig,p.prorettype::regtype::text AS returns,p.proargnames,p.proargmodes,p.proargtypes::text,
  p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.proname=ANY($1::text[]) ORDER BY p.proname,p.oid`,[targets])).rows;
}
async function rowsFingerprint(client,schema,names){
 const result=[];
 for(const name of names){const r=(await client.query(`SELECT count(*)::text AS n,
  md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS hash FROM
  (SELECT md5(to_jsonb(r)::text) AS h FROM ${identifier(schema)}.${identifier(name)} r) x`)).rows[0];result.push({name,...r});}
 return sha256(JSON.stringify(result));
}
function historyCheck(history,replay){
 verifyRecordedHistory(history.filter(r=>![VERSION,PREVIOUS].includes(r.version)),{upgraded:true});
 if(history.filter(r=>r.version===PREVIOUS).length!==1||history.find(r=>r.version===PREVIOUS)?.checksum!==PREVIOUS_SHA ||
  replay&&(history.find(r=>r.version===VERSION)?.checksum!==SQL_SHA256))fail('ISSUER020_HISTORY_DRIFT');
}
export async function upgradeRegistrationIssuer({client,expectedDatabase,expectedSchema='public',mode='trial',maintenanceApproved=false,expectedIssuer}={}){
 if(!client||!/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabase||'')||!['inventory','trial','apply'].includes(mode)||!maintenanceApproved||expectedIssuer!==ISSUER)
  fail('ISSUER020_EXPLICIT_CONTEXT_REQUIRED');
 identifier(expectedSchema);const sql=readIssuerSql();let began=false;
 try{
  if((await client.query('SELECT transaction_timestamp()=statement_timestamp() AS idle')).rows[0]?.idle!==true)fail('ISSUER020_IDLE_REQUIRED');
  await client.query('BEGIN');began=true;
  await client.query("SET LOCAL statement_timeout='15000ms'");await client.query("SET LOCAL lock_timeout='1000ms'");
  await client.query(`SET LOCAL search_path TO ${identifier(expectedSchema)},public`);
  const context=(await client.query('SELECT current_user AS role,current_database() AS db,current_schema() AS schema')).rows[0];
  if(context.role!=='postgres'||context.db!==expectedDatabase||context.schema!==expectedSchema)fail('ISSUER020_TARGET_REQUIRED');
  if(expectedSchema!=='public'&&(process.env.NODE_ENV!=='test'||!expectedDatabase.endsWith('_test')||!/^present_[a-f0-9]+$/.test(expectedSchema)))fail('ISSUER020_TARGET_REQUIRED');
  await client.query('SELECT pg_advisory_xact_lock(563003057)');
  const history=(await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,replay=history.some(r=>r.version===VERSION);historyCheck(history,replay);
  const before=await registrationCatalog(client),beforeHash=registrationCatalogHash(before,expectedSchema);
  const baseline=replay?transformedCatalog(before,true):before;
  if(registrationCatalogHash(baseline,expectedSchema)!==PREVIOUS_CATALOG)fail('ISSUER020_BASELINE_DRIFT');
  const expectedHash=registrationCatalogHash(transformedCatalog(baseline),expectedSchema);
  const roles=await roleMetadata(client),routines=await routineMetadata(client);
  const owner=roles.find(r=>r.rolname==='coed_tu_registration_owner');
  if(roles.length!==4||!owner||owner.rolcanlogin||owner.rolsuper||owner.schema_create||owner.memberships.length||
   routines.length!==2||routines.some(r=>r.owner!=='coed_tu_registration_owner'||!r.prosecdef))fail('ISSUER020_CAPABILITY_DRIFT');
  if(replay||mode==='inventory'){
   if(replay&&beforeHash!==expectedHash)fail('ISSUER020_POSTCONDITION');
   await client.query('ROLLBACK');began=false;return {version:VERSION,applied:false,idempotentReplay:replay,baselineVerified:true,catalogSha256:beforeHash,expectedCatalogSha256:expectedHash,noAccountCreated:true};
  }
  const names=before.tables.map(r=>r.name).sort();
  for(const name of names)await client.query(`LOCK TABLE ${identifier(expectedSchema)}.${identifier(name)} IN SHARE ROW EXCLUSIVE MODE`);
  const preserved=await rowsFingerprint(client,expectedSchema,names);
  await client.query("SET LOCAL coed.registration_issuer_upgrade='observed019-to020'");
  const adapted=expectedSchema==='public'?sql:sql.replaceAll('public.',identifier(expectedSchema)+'.');await client.query(adapted);
  const after=await registrationCatalog(client),afterHash=registrationCatalogHash(after,expectedSchema),afterRoutines=await routineMetadata(client);
  const expectedRoutines=routines.map(r=>({...r,prosrc:r.prosrc.replace("'urn:coed:tu-auth'","'"+ISSUER+"'")}));
  if(afterHash!==expectedHash||JSON.stringify(afterRoutines)!==JSON.stringify(expectedRoutines)||JSON.stringify(await roleMetadata(client))!==JSON.stringify(roles))fail('ISSUER020_POSTCONDITION');
  if(await rowsFingerprint(client,expectedSchema,names)!==preserved||JSON.stringify((await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows)!==JSON.stringify(history))fail('ISSUER020_PRESERVATION_FAILED');
  await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[VERSION,SQL_SHA256]);
  await client.query(mode==='apply'?'COMMIT':'ROLLBACK');began=false;
  return {version:VERSION,applied:mode==='apply',idempotentReplay:false,preservationVerified:true,onlyTwoIssuerLiteralsChanged:true,ownersAclAndRolesPreserved:true,sqlSha256:SQL_SHA256,postCatalogSha256:afterHash,noAccountCreated:true};
 }catch(error){if(began)await client.query('ROLLBACK').catch(()=>{});const safe=Object.assign(Error(error.safeCode||'ISSUER020_UPGRADE_FAILED'),{safeCode:error.safeCode||'ISSUER020_UPGRADE_FAILED'});
  if(/^[A-Z0-9]{5}$/.test(error.code||''))safe.sqlState=error.code;throw safe;}
}
