import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REVIEWED_MIGRATIONS} from './reviewed-migrations.mjs';

export const ALIGNMENT_NAME='016_coordinator_schema_alignment.sql';
export const EXTERNAL_HISTORY=Object.freeze([...REVIEWED_MIGRATIONS.slice(0,12),
  ['013_phase1_schedules_and_confirmations.sql','91466678848777ebe71759f178eaa35b7d51ccc9bff5367dd52159f5ad573396'],
  ['014_phase1_review_handoff.sql','9d84f1351bd8a0188ce4a7dbed6c03b225715136534d697590f995b782c8aba8'],
  ['015_phase1_schedule_audit_integrity.sql','feb09714f156e35c9b337caf4421691bc37329583efc37f90b61d2faa3847433']
].map(row=>Object.freeze(row)));
export const LINEAGE_SUPPORT=Object.freeze({fresh:'workspace013-plus016',external:'recorded015-upgrade-only',
  authentic014015SourceVerified:false,productionBaselineAdoptionApproved:false});
export const recordedCatalog=JSON.parse(readFileSync(new URL('./coordinator-schema-external015.json',import.meta.url),'utf8'));
export const workspaceCatalog=JSON.parse(readFileSync(new URL('./coordinator-schema-workspace013.json',import.meta.url),'utf8'));
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const same=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
export function assertHistory(rows,profile,{aligned=false,alignmentHash}={}) {
  if(!['external015','workspace013'].includes(profile))throw new Error('ALIGNMENT_UNKNOWN_PROFILE');
  const expected=[...(profile==='external015'?EXTERNAL_HISTORY:REVIEWED_MIGRATIONS.filter(([n])=>n!==ALIGNMENT_NAME)),
    ...(aligned?[[ALIGNMENT_NAME,alignmentHash]]:[])];
  if(!same(rows.map(r=>[r.version,r.checksum]),expected))throw new Error('ALIGNMENT_HISTORY_MISMATCH');
}

// Metadata-only; normalize the schema qualifier, never SQL bodies/checksums.
export async function catalog(db) {
  const tables=(await db.query(`SELECT c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()
    AND (c.relname LIKE 'phase1\\_%' ESCAPE '\\' OR c.relname LIKE 'coordinator\\_%' ESCAPE '\\' OR c.relname LIKE 'committee\\_%' ESCAPE '\\'
      OR c.relname IN ('selection_cohorts','rounds','students','users','audit_events')) AND c.relkind IN ('r','p','v') ORDER BY c.relname`)).rows;
  const names=tables.map(t=>t.name),result={tables};
  const queries={
    columns:`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
    constraints:`SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,k.convalidated,k.condeferrable,k.condeferred,
      pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`,
    indexes:`SELECT c.relname AS table_name,i.relname AS name,pg_get_indexdef(x.indexrelid) AS definition,x.indisvalid,x.indisunique
      FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname,i.relname`,
    triggers:`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,p.proname AS function_name
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions:`SELECT DISTINCT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef AS security_definer,
      p.proconfig AS settings,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE pn.nspname=current_schema() AND p.prokind='f' AND (p.oid IN (SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal)
      OR p.proname IN ('guard_phase1_application','guard_phase1_attachment','guard_phase1_review','reject_immutable_row_mutation')) ORDER BY name,arguments`
  };
  const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
  for(const [key,sql] of Object.entries(queries))result[key]=(await db.query(sql,[names])).rows.map(row=>Object.fromEntries(Object.entries(row)
    .map(([k,v])=>[k,typeof v==='string'?v.replaceAll(schema+'.','public.'):v])));
  const owner=(await db.query(`SELECT count(*)::int AS invalid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND (c.relowner<>(SELECT usesysid FROM pg_user WHERE usename=current_user)
      OR c.relrowsecurity OR c.relforcerowsecurity)`,[names])).rows[0].invalid;
  if(owner)throw new Error('ALIGNMENT_OWNER_OR_RLS_DRIFT');
  return result;
}
export function assertExternalCatalog(actual) {
  for(const key of ['tables','columns','constraints','indexes','triggers','functions']) {
    if(!same(actual[key],recordedCatalog[key]))throw new Error('ALIGNMENT_EXTERNAL_CATALOG_MISMATCH:'+key);
  }
}
export function assertWorkspaceCatalog(actual){
  for(const key of ['tables','columns','constraints','indexes','triggers','functions']){
    if(!same(actual[key],workspaceCatalog[key]))throw new Error('ALIGNMENT_WORKSPACE_CATALOG_MISMATCH:'+key);
  }
}
export function assertExternalAlignedCatalog(actual){
  const newTables=new Set(['coordinator_reviews','coordinator_operations']);
  const changedFunctions=new Set(['guard_phase1_application','guard_phase1_attachment']);
  const newFunctions=new Set(['guard_coordinator_review','guard_coordinator_window','reject_coordinator_archive_write']);
  const filtered={
    tables:actual.tables.filter(r=>!newTables.has(r.name)),
    columns:actual.columns.filter(r=>!newTables.has(r.table_name) && !(r.table_name==='phase1_cycle_windows' && ['review_opens_at','review_closes_at'].includes(r.column_name))),
    constraints:actual.constraints.filter(r=>!newTables.has(r.table_name) && !['coordinator_window_order','coordinator_submission_identity'].includes(r.name)),
    indexes:actual.indexes.filter(r=>!newTables.has(r.table_name) && r.name!=='coordinator_submission_identity'),
    triggers:actual.triggers.filter(r=>!newTables.has(r.table_name) && !['coordinator_window_guard','coordinator_review_archive'].includes(r.name)),
    functions:actual.functions.filter(r=>!newFunctions.has(r.name) && !changedFunctions.has(r.name))
  };
  for(const key of ['tables','columns','constraints','indexes','triggers','functions']){
    const expected=key==='functions'?recordedCatalog[key].filter(r=>!changedFunctions.has(r.name)):recordedCatalog[key];
    if(!same(filtered[key],expected))throw new Error('ALIGNMENT_REPLAY_EXTERNAL_DRIFT:'+key);
  }
}
export const catalogHash=value=>createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
