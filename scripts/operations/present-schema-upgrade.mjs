// Explicit owner-connection library ONLY. No CLI Apply, AWS, ambient URL or login.
import {readFileSync} from 'node:fs';
import {PROFILE,readObservedBaseline,identifier,sha256,captureCatalog,catalogHash} from './present-schema-baseline.mjs';
export const VERSION='018_observed_tu_delivery.sql';
export const SQL_SHA256='1b5712d287ad44ef745a0f4c862df53b17aa9586329aa5487faf8d1bb65109e0';
export const ACL_SHA256='53d375ac7a7ec4b277b9371b0518fd8ce734f6348552eef1cdd74b9a1a4cc73a';
export const BEFORE_CATALOG_SHA256='2988bfe6ed37d7622c457e08a9696fc51bf6772675817b1a58d4a023a2f7d59c';
export const AFTER_CATALOG_SHA256='d916231f32114e668fb5b7720e8739833716f5d21c3653001974a60e39e63b0a';
const fail=code=>{const error=new Error(code);error.safeCode=code;throw error;};
export function readUpgradeFiles(){
 const sql=readFileSync(new URL('../../src/db/upgrades/'+VERSION,import.meta.url));
 const acl=readFileSync(new URL('../../src/db/operations/018-observed-runtime-grants.sql',import.meta.url));
 if(sql.includes(13) || acl.includes(13) || sha256(sql)!==SQL_SHA256 || sha256(acl)!==ACL_SHA256)fail('UPGRADE_SOURCE_INTEGRITY');
 return {sql:sql.toString('utf8'),acl:acl.toString('utf8')};
}
export function verifyRecordedHistory(actual,{upgraded=false}={}){
 const expected=[...readObservedBaseline().migrations,...(upgraded?[{version:VERSION,checksum:SQL_SHA256}]:[])];
 if(JSON.stringify(actual)!==JSON.stringify(expected))fail('OBSERVED_HISTORY_MISMATCH');
}
async function runtimeCapabilities(client,upgraded){
 const row=(await client.query(`SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
    OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    OR has_schema_privilege(r.oid,current_schema(),'CREATE') AS elevated,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.prorettype<>'trigger'::regtype AND has_function_privilege(r.oid,p.oid,'EXECUTE')
      AND (p.prosecdef OR NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')))
      AS callable FROM pg_roles r WHERE r.rolname='coed_app'`)).rows[0];
 if(!row || row.elevated || row.callable!==(upgraded?0:1))fail('OBSERVED_RUNTIME_CAPABILITY_MISMATCH');
}
async function preservedRows(client,schema,names){
 const result=[];
 for(const name of names){
  // Values/hashes stay internal. No records, counts or per-table hashes are returned.
  const row=(await client.query(`SELECT count(*)::text AS n,md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS fingerprint
    FROM (SELECT md5(to_jsonb(r)::text) AS h FROM ${identifier(schema)}.${identifier(name)} r) fingerprints`)).rows[0];
  result.push({name,...row});
 }
 return JSON.stringify(result);
}
export async function upgradeObservedSchema({client,profile,expectedDatabase,expectedSchema='public',mode='trial',maintenanceApproved=false}={}){
 if(!client || typeof client.query!=='function' || profile!==PROFILE ||
   typeof expectedDatabase!=='string' || !/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabase) || !['trial','apply'].includes(mode))
  fail('EXPLICIT_OBSERVED_UPGRADE_CONTEXT_REQUIRED');
 identifier(expectedSchema);
 if(mode==='apply' && maintenanceApproved!==true)fail('MAINTENANCE_APPROVAL_REQUIRED');
 const files=readUpgradeFiles(),baseline=readObservedBaseline();
 if(catalogHash(baseline.catalog)!==BEFORE_CATALOG_SHA256)fail('OBSERVED_BASELINE_INTEGRITY');
 let began=false;
 try{
  // BEGIN inside an existing transaction would otherwise commit/rollback caller
  // work. A dedicated idle connection must start its own statement transaction.
  const idle=(await client.query('SELECT transaction_timestamp()=statement_timestamp() AS standalone')).rows[0];
  if(idle?.standalone!==true)fail('DEDICATED_IDLE_CONNECTION_REQUIRED');
  await client.query('BEGIN');began=true;
  await client.query("SET LOCAL lock_timeout='1000ms'");
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
  await client.query(`SET LOCAL search_path TO ${identifier(expectedSchema)},public`);
  const context=(await client.query('SELECT current_database() AS database,current_schema() AS schema,current_user AS role')).rows[0];
  if(context.database!==expectedDatabase || context.schema!==expectedSchema || context.role!=='postgres')fail('OBSERVED_OWNER_TARGET_REQUIRED');
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)',['563003056']);
  const history=(await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  const replay=history.some(row=>row.version===VERSION);verifyRecordedHistory(history,{upgraded:replay});
  const names=baseline.catalog.tables.map(row=>row.name).sort();
  // This is a write-blocking owner upgrade, NOT the read-only diagnostic helper.
  // Its production use requires an explicit maintenance/backup/cutover decision.
  for(const name of names)await client.query(`LOCK TABLE ${identifier(expectedSchema)}.${identifier(name)} IN SHARE ROW EXCLUSIVE MODE`);
  const before=await captureCatalog(client);
  if(catalogHash(before,expectedSchema)!==(replay?AFTER_CATALOG_SHA256:BEFORE_CATALOG_SHA256))fail('OBSERVED_CATALOG_MISMATCH');
  await runtimeCapabilities(client,replay);
  if(replay){await client.query('ROLLBACK');began=false;return {applied:false,idempotentReplay:true,version:VERSION,profile};}
  const fingerprint=await preservedRows(client,expectedSchema,names);
  await client.query("SELECT set_config('coed.present_upgrade_profile',$1,true)",[PROFILE]);
  await client.query(files.sql);await client.query(files.acl);
  if(catalogHash(await captureCatalog(client),expectedSchema)!==AFTER_CATALOG_SHA256)fail('OBSERVED_POSTCONDITION_FAILED');
  await runtimeCapabilities(client,true);
  if(await preservedRows(client,expectedSchema,names)!==fingerprint)fail('OBSERVED_PRESERVATION_FAILED');
  verifyRecordedHistory((await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows);
  await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[VERSION,SQL_SHA256]);
  verifyRecordedHistory((await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,{upgraded:true});
  await client.query(mode==='apply'?'COMMIT':'ROLLBACK');began=false;
  return {applied:mode==='apply',idempotentReplay:false,version:VERSION,profile,preservationVerified:true,
    sqlSha256:SQL_SHA256,aclSha256:ACL_SHA256,postCatalogSha256:AFTER_CATALOG_SHA256};
 }catch(error){
  if(began)await client.query('ROLLBACK').catch(()=>{});began=false;
  const safe=error.safeCode || 'OBSERVED_UPGRADE_SQL_FAILED',wrapped=new Error(safe);wrapped.code=safe;
  if(/^[0-9A-Z]{5}$/.test(error.code || ''))wrapped.sqlState=error.code;
  throw wrapped;
 }
}
