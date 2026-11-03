// Explicit upgrade-only library. No AWS calls, ambient DATABASE_URL, bootstrap,
// CLI apply mode or fallback lineage. Callers must supply an owned connection.
import {readFileSync} from 'node:fs';
import {readReviewedMigrations} from './reviewed-migrations.mjs';
import {ALIGNMENT_NAME,assertHistory,assertExternalCatalog,assertWorkspaceCatalog,assertExternalAlignedCatalog,catalog,catalogHash,LINEAGE_SUPPORT} from './coordinator-schema-lineages.mjs';
import contract from '../../src/db/coordinator-schema-contract.js';

const identifier=value=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw new Error('ALIGNMENT_INVALID_IDENTIFIER');return value;};
function runtimeACL(schema,role){
  return readFileSync(new URL('../../src/db/operations/016-coordinator-runtime-grants.sql',import.meta.url),'utf8')
    .replaceAll('public.',schema+'.').replaceAll("'public'","'"+schema+"'").replaceAll('coed_app',role);
}
async function assertRuntimeACL(db,schema,role){
  const acl=runtimeACL(schema,role),validation=acl.slice(acl.indexOf('DO $effective_acl$'));
  await db.query(validation);
  const r=(await db.query(`SELECT
    has_column_privilege($1,$2,'state','UPDATE') AND has_column_privilege($1,$2,'application_id','INSERT')
    AND has_column_privilege($1,$3,'review_closes_at','UPDATE') AND has_table_privilege($1,$4,'SELECT') AND has_table_privilege($1,$4,'INSERT')
    AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1 AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) AS ready`,
    [role,schema+'.coordinator_reviews',schema+'.phase1_cycle_windows',schema+'.coordinator_operations'])).rows[0];
  if(!r?.ready)throw new Error('ALIGNMENT_RUNTIME_ACL_NOT_READY');
}
export async function assertPostconditions(db,migration) {
  await contract.assertCoordinatorSchema(db);
  // Validate exact installed guard bodies rather than trusting trigger names.
  const functions=[...migration.sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/gi)];
  for(const [,name,body] of functions){
    const r=(await db.query(`SELECT prosrc,prosecdef FROM pg_proc WHERE oid=to_regprocedure($1)`,[name+'()'])).rows[0];
    if(!r || r.prosecdef || r.prosrc!==body)throw new Error('ALIGNMENT_GUARD_BODY_MISMATCH');
  }
  const invalid=(await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid=ANY(ARRAY[
    'coordinator_reviews'::regclass,'coordinator_operations'::regclass,'phase1_cycle_windows'::regclass]) AND NOT convalidated`)).rows[0].n;
  const keys=(await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='coordinator_reviews'::regclass AND contype='f'`)).rows[0].n;
  if(invalid || keys!==4)throw new Error('ALIGNMENT_POSTCONDITION_FAILED');
}
export async function upgradeCoordinatorSchema(db,{profile,mode='inspect',runtimeRole=null}={}) {
  if(!['workspace013','external015'].includes(profile) || !['inspect','trial','apply'].includes(mode))throw new Error('ALIGNMENT_EXPLICIT_PROFILE_AND_MODE_REQUIRED');
  const migration=readReviewedMigrations().find(r=>r.name===ALIGNMENT_NAME);
  if(!migration)throw new Error('ALIGNMENT_REVIEWED_SQL_MISSING');
  if(runtimeRole)identifier(runtimeRole);
  await db.query(mode==='inspect'?'BEGIN READ ONLY':'BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
    await db.query('SELECT pg_advisory_xact_lock(563003056)');
    const schema=identifier((await db.query('SELECT current_schema() AS name')).rows[0].name);
    if(mode!=='inspect'){
      // Prevent catalog/history drift between preflight and DDL. This includes
      // the ledger, but never changes an existing checksum or historical row.
      await db.query(`DO $locks$ DECLARE t record; BEGIN
        FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=current_schema() AND c.relkind='r' ORDER BY c.relname LOOP
          EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE',t.relname);
        END LOOP; END $locks$`);
    }
    // Do not let public fallback resolve another schema's history/tables.
    const tracking=(await db.query(`SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('schema_migrations')`)).rows[0];
    if(tracking?.schema!==schema)throw new Error('ALIGNMENT_BASELINE_REQUIRED');
    const rows=(await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
    const aligned=rows.some(r=>r.version===ALIGNMENT_NAME);
    assertHistory(rows,profile,{aligned,alignmentHash:migration.checksum});
    const before=await catalog(db);
    if(!aligned && profile==='external015')assertExternalCatalog(before);
    if(!aligned && profile==='workspace013')assertWorkspaceCatalog(before);
    if(aligned){await assertPostconditions(db,migration);if(profile==='external015')assertExternalAlignedCatalog(before);if(runtimeRole)await assertRuntimeACL(db,schema,runtimeRole);}
    if(mode==='inspect'){
      await db.query('ROLLBACK');
      return {mode,profile,aligned,catalogSha256:catalogHash(before),support:LINEAGE_SUPPORT,changed:false};
    }
    // DDL uses bounded write locks, and the runner never commits a partial ACL.
    if(!aligned){
      await db.query(migration.sql);
      await assertPostconditions(db,migration);
      if(profile==='external015')assertExternalAlignedCatalog(await catalog(db));
      if(runtimeRole){
        await db.query(runtimeACL(schema,runtimeRole));
        await assertRuntimeACL(db,schema,runtimeRole);
      }
      await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[migration.name,migration.checksum]);
    }
    assertHistory((await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,profile,{aligned:true,alignmentHash:migration.checksum});
    await db.query(mode==='apply'?'COMMIT':'ROLLBACK');
    return {mode,profile,changed:!aligned && mode==='apply',replay:aligned,rolledBack:mode==='trial',
      migration:{name:migration.name,checksum:migration.checksum},aclIncluded:Boolean(runtimeRole),support:LINEAGE_SUPPORT};
  } catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
}
