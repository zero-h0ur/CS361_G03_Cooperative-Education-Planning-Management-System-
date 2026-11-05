// Explicit owner connection only; no ambient URL, AWS, credentials or CLI Apply.
import {readFileSync} from 'node:fs';
import reader from './tu-preflight/catalog.js';
import {identifier,sha256,captureCatalog,catalogHash,normalizedCatalog} from './present-schema-baseline.mjs';
import {verifyRecordedHistory,AFTER_CATALOG_SHA256} from './present-schema-upgrade.mjs';
export const VERSION='019_tu_student_registration.sql';
export const SQL_SHA256='30b9028755dbfafa89619cbe04ecf27333b4af80673f251824baa832497a8443';
export const POST_SHA256='ea3ff238c1c10aaa5d32253b894c0541246ef1e04c775effffcd15ad1d0889d1';
const fail=code=>{const e=Error(code);e.safeCode=code;throw e;};
export function readRegistrationSql(){
 const bytes=readFileSync(new URL('../../src/db/upgrades/'+VERSION,import.meta.url));
 if(bytes.includes(13)||sha256(bytes)!==SQL_SHA256)fail('REGISTRATION_SOURCE_INTEGRITY');return bytes.toString('utf8');
}
export async function registrationCatalog(client){
 const result={notice:'Observed present schema, NOT recovered historical SQL; no business rows',version:1};
 for(const [key,sql] of Object.entries(reader.SQL)){
  const query=sql.replaceAll("'public'",'current_schema()').replace("p.proname='upsert_tu_student_identity'","p.proname IN ('upsert_tu_student_identity','complete_tu_registration')");
  result[key]=(await client.query(query,['inventory','routine_acl','dependencies'].includes(key)?[]:[[...reader.TABLES,'tu_student_registrations','tu_registration_receipts']])).rows;
  if(result[key].length>reader.LIMITS[key])fail('REGISTRATION_CATALOG_LIMIT');
 }
 return reader.assertSafeCatalog(result);
}
export function normalizedRegistrationCatalog(value,schema='public'){
 const normalized=normalizedCatalog(value,schema);
 // PostgreSQL retains optional identifier quotes in proconfig. Fixture schemas
 // and public must represent the same fixed, trusted search_path semantically.
 for(const r of normalized.routines){
  if(r.settings)r.settings=r.settings.map(s=>['search_path=pg_catalog, '+schema,'search_path=pg_catalog, "'+schema+'"'].includes(s)?'search_path=pg_catalog, __schema__':s);
  r.definition=r.definition.replace("SET search_path TO 'pg_catalog', '"+schema+"'","SET search_path TO 'pg_catalog', '__schema__'");
 }
 // Never replace bare words globally: public_url and visibility='public' are
 // real identifiers/data predicates, not schema qualifiers.
 return normalized;
}
export const registrationCatalogHash=(value,schema='public')=>sha256(JSON.stringify(normalizedRegistrationCatalog(value,schema)));
async function capabilities(client){
 const roles=(await client.query(`SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
  EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS memberships,
  has_schema_privilege(r.oid,current_schema(),'CREATE') AS schema_create FROM pg_roles r
  WHERE rolname IN ('coed_tu_registration','coed_tu_registration_owner','coed_tu_login') ORDER BY rolname`)).rows;
 if(roles.length!==3 || roles.some(r=>r.rolsuper||r.rolinherit||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.rolbypassrls||r.memberships||r.schema_create) ||
  roles.find(r=>r.rolname==='coed_tu_registration_owner').rolcanlogin)fail('REGISTRATION_ROLE_CAPABILITY');
 const bad=(await client.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','f') AND
   (has_table_privilege('coed_tu_registration',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('coed_tu_registration',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_table_privilege('coed_tu_login',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('coed_tu_login',c.oid,'INSERT,UPDATE,REFERENCES'))`)).rows[0];
 if(bad.n!==0)fail('REGISTRATION_ROLE_CAPABILITY');
 const callable=(await client.query(`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.prorettype<>'trigger'::regtype AND
  (p.prosecdef OR NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  AND has_function_privilege('coed_tu_registration',p.oid,'EXECUTE') ORDER BY p.proname`)).rows;
 if(JSON.stringify(callable)!==JSON.stringify([{name:'complete_tu_registration'}]))fail('REGISTRATION_ROLE_CAPABILITY');
}
async function fingerprint(client,schema,names){
 const values=[];for(const name of names){
  const {rows}=await client.query(`SELECT count(*)::text n,md5(coalesce(string_agg(h,'' ORDER BY h),'')) fingerprint
   FROM (SELECT md5((to_jsonb(r)-'identity_source')::text) h FROM ${identifier(schema)}.${identifier(name)} r) x`);
  values.push({name,...rows[0]});
 }return JSON.stringify(values);
}
export async function upgradeRegistration({client,expectedDatabase,expectedSchema='public',mode='trial',maintenanceApproved=false}={}){
 if(!client||!/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabase||'')||!['trial','apply'].includes(mode)||!maintenanceApproved)fail('REGISTRATION_EXPLICIT_OWNER_CONTEXT');
 identifier(expectedSchema);const sql=readRegistrationSql();let began=false;
 try{
  if((await client.query('SELECT transaction_timestamp()=statement_timestamp() AS idle')).rows[0]?.idle!==true)fail('REGISTRATION_IDLE_CONNECTION_REQUIRED');
  await client.query('BEGIN');began=true;
  await client.query("SET LOCAL statement_timeout='15000ms'");await client.query("SET LOCAL lock_timeout='1000ms'");
  await client.query(`SET LOCAL search_path TO ${identifier(expectedSchema)},public`);
  const c=(await client.query('SELECT current_user AS role,current_database() AS db,current_schema() AS schema')).rows[0];
  if(c.role!=='postgres'||c.db!==expectedDatabase||c.schema!==expectedSchema)fail('REGISTRATION_OWNER_TARGET_REQUIRED');
  await client.query('SELECT pg_advisory_xact_lock(563003057)');
  const history=(await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,replay=history.some(r=>r.version===VERSION);
  verifyRecordedHistory(history.filter(r=>r.version!==VERSION),{upgraded:true});
  if(replay){
   if(history.find(r=>r.version===VERSION).checksum!==SQL_SHA256 || registrationCatalogHash(await registrationCatalog(client),expectedSchema)!==POST_SHA256)fail('REGISTRATION_POSTCONDITION');
   await capabilities(client);await client.query('ROLLBACK');began=false;return {applied:false,idempotentReplay:true,version:VERSION};
  }
  const before=await captureCatalog(client);
  if(catalogHash(before,expectedSchema)!==AFTER_CATALOG_SHA256)fail('REGISTRATION_BASELINE_DRIFT');
  if((await client.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('coed_tu_registration','coed_tu_registration_owner')")).rows[0].n!==0)fail('REGISTRATION_EXISTING_ROLE');
  const names=before.tables.map(r=>r.name).sort();
  for(const name of names)await client.query(`LOCK TABLE ${identifier(expectedSchema)}.${identifier(name)} IN SHARE ROW EXCLUSIVE MODE`);
  const preserved=await fingerprint(client,expectedSchema,names);
  await client.query("SET LOCAL coed.registration_upgrade='observed018-to019'");
  // Only a disposable fixture schema can adapt fixed public identifiers locally.
  if(expectedSchema!=='public' && (process.env.NODE_ENV!=='test'||!expectedDatabase.endsWith('_test')||!/^present_[a-f0-9]+$/.test(expectedSchema)))fail('REGISTRATION_OWNER_TARGET_REQUIRED');
  const adapted=expectedSchema==='public'?sql:sql.replaceAll('public.',identifier(expectedSchema)+'.').replaceAll('SCHEMA public','SCHEMA '+identifier(expectedSchema)).replaceAll('pg_catalog,public','pg_catalog,'+identifier(expectedSchema));
  await client.query(adapted);await capabilities(client);
  const postCatalog=await registrationCatalog(client),postHash=registrationCatalogHash(postCatalog,expectedSchema);
  if(postHash!==POST_SHA256){const e=Error('REGISTRATION_POSTCONDITION');e.safeCode=e.message;
   e.safeMetadata={postCatalogSha256:postHash,sections:Object.fromEntries(Object.entries(normalizedRegistrationCatalog(postCatalog,expectedSchema)).map(([k,v])=>[k,sha256(JSON.stringify(v))]))};throw e;}
  if(await fingerprint(client,expectedSchema,names)!==preserved)fail('REGISTRATION_PRESERVATION_FAILED');
  await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[VERSION,SQL_SHA256]);
  await client.query(mode==='apply'?'COMMIT':'ROLLBACK');began=false;
  return {applied:mode==='apply',idempotentReplay:false,preservationVerified:true,version:VERSION,sqlSha256:SQL_SHA256,postCatalogSha256:POST_SHA256};
 }catch(e){if(began)await client.query('ROLLBACK').catch(()=>{});const error=Error(e.safeCode||'REGISTRATION_UPGRADE_FAILED');error.safeCode=error.message;
  if(/^[A-Z0-9]{5}$/.test(e.code||''))error.sqlState=e.code;if(e.safeMetadata)error.safeMetadata=e.safeMetadata;throw error;}
}
