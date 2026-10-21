import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","''")+"'";

export function workflowMigrationSQL() {
  const migrations=readdirSync(join(root,'src/db/migrations')).filter(name=>/^00[1-8]_[a-z0-9_]+\.sql$/.test(name)).sort()
    .map(name=>({name,sql:readFileSync(join(root,'src/db/migrations',name),'utf8')}));
  if(migrations.length!==8)throw new Error('Expected exactly eight reviewed migrations.');
  const expected=migrations.map(row=>`(${quote(row.name)},${quote(hash(row.sql))})`).join(',');
  const tables=['users','external_identity_links','students','plans','advisor_assignments','staff_scopes','rounds','companies','positions','audit_events','plan_operations'];
  const key=table=>({audit_events:'event_id',plan_operations:'operation_id'})[table]||'id';
  const before=tables.map(table=>`SELECT '${table}' AS table_name,${key(table)}::text AS row_id,to_jsonb(t) AS original FROM public.${table} t`).join(' UNION ALL ');
  const preserve=tables.map(table=>`IF EXISTS(SELECT 1 FROM workflow135_before b LEFT JOIN public.${table} t ON t.${key(table)}::text=b.row_id WHERE b.table_name='${table}' AND (t.${key(table)} IS NULL OR
    (SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(to_jsonb(t)) e WHERE b.original ? e.key) IS DISTINCT FROM b.original)) THEN
    RAISE EXCEPTION 'Existing ${table} data changed' USING ERRCODE='23514'; END IF;`).join('\n');
  const apply=migrations.map((row,index)=>`SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version=${quote(row.name)}) AS applied_${index}\n\\gset
\\if :applied_${index}
\\else
${row.sql}
INSERT INTO public.schema_migrations(version,checksum) VALUES(${quote(row.name)},${quote(hash(row.sql))});
\\endif`).join('\n');
  const grants=readFileSync(join(root,'src/db/operations/v3-runtime-grants.sql'),'utf8')
    .replace(/^\\set[^\n]*\n/gm,'').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'');
  return `\\set ON_ERROR_STOP on
\\if :{?apply}
\\else
\\set apply false
\\endif
BEGIN;
SET LOCAL search_path=public;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SELECT pg_advisory_xact_lock(563003056::bigint);
CREATE TEMP TABLE workflow135_expected(version text PRIMARY KEY,checksum text) ON COMMIT DROP;
INSERT INTO workflow135_expected VALUES ${expected};
DO $preflight$
BEGIN
 IF current_database() NOT IN ('coed','coed_v3_test') THEN RAISE EXCEPTION 'Wrong target database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='003_partner_directory.sql') THEN RAISE EXCEPTION 'Directory baseline must exist'; END IF;
 IF EXISTS(SELECT 1 FROM public.schema_migrations m LEFT JOIN workflow135_expected e ON e.version=m.version WHERE e.version IS NULL OR m.checksum IS DISTINCT FROM e.checksum) THEN
   RAISE EXCEPTION 'Migration history mismatch; do not edit stored checksums'; END IF;
 IF current_user='coed_app' THEN RAISE EXCEPTION 'Migration owner required'; END IF;
END $preflight$;
CREATE TEMP TABLE workflow135_before ON COMMIT DROP AS ${before};
${apply}
${grants}
DO $preserve$
BEGIN
 ${preserve}
 IF (SELECT count(*) FROM public.schema_migrations)<>8 THEN RAISE EXCEPTION 'Incomplete schema'; END IF;
END $preserve$;
SELECT json_build_object('Migrations',8,'ExistingRowsPreserved',true,'RuntimeRoleMutation',has_column_privilege('coed_app','public.users','role','UPDATE'));
\\if :apply
COMMIT;
\\else
ROLLBACK;
\\endif
`;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [zipArg,outputArg]=process.argv.slice(2);
  if(!zipArg||!outputArg)throw new Error('Usage: node scripts/operations/prepare-workflow-release.mjs <lambda.zip> <private-output-directory>');
  const output=resolve(outputArg);
  if(output===root||output.startsWith(root+'/'))throw new Error('Release artifacts must be outside the checkout.');
  if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw new Error('Commit reviewed source before preparing the release.');
  mkdirSync(output,{mode:0o700});
  const zip=readFileSync(resolve(zipArg));
  writeFileSync(join(output,'workflow-lambda.zip'),zip,{flag:'wx',mode:0o600});
  const sql=workflowMigrationSQL();
  writeFileSync(join(output,'workflow-migrate.sql'),sql,{flag:'wx',mode:0o600});
  const files={'workflow-lambda.zip':hash(zip),'workflow-migrate.sql':hash(sql)};
  for(const file of ['live-challenge.py','admin-account.py']) {
    const contents=readFileSync(join(root,'scripts/operations',file));
    writeFileSync(join(output,file),contents,{flag:'wx',mode:0o600});files[file]=hash(contents);
  }
  const manifest={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),account:'676101350279',region:'us-east-1',function:'coed-api',files};
  writeFileSync(join(output,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({output,sourceCommit:manifest.sourceCommit,files},null,2));
}
