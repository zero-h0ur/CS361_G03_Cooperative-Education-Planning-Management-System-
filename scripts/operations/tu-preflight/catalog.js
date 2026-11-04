// Schema metadata only. No business-row reads or SQL supplied by callers.
const TABLES=Object.freeze(['schema_migrations','companies','positions','rounds','document_metadata',
  'users','external_identity_links','students','plans','advisor_assignments','staff_scopes','plan_operations',
  'audit_events','document_policies','plan_submissions','workflow_receipts','workflow_events','placements',
  'selection_cohorts','selection_receipts','selection_opinions','phase1_academic_profiles','phase1_policies',
  'phase1_cycle_windows','phase1_applications','phase1_uploads','phase1_documents','phase1_attachments',
  'phase1_submissions','phase1_operations','phase1_events','phase1_reviews','coordinator_round_schedules',
  'coordinator_operations','committee_workspaces','committee_workspace_events','phase1_selection_results',
  'phase1_schedule_events','phase1_notifications','phase1_submission_deliveries','tu_identity_link_events']);
const SQL=Object.freeze({
  inventory:`SELECT c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.relname LIMIT 201`,
  tables:`SELECT c.relname AS name,c.relkind AS kind,r.rolname AS owner,c.relrowsecurity AS row_security,
    c.relforcerowsecurity AS force_rls,c.relpersistence AS persistence
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname LIMIT 101`,
  columns:`SELECT c.relname AS table_name,a.attnum AS ordinal,a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression,a.attidentity AS identity,a.attgenerated AS generated
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum LIMIT 1501`,
  constraints:`SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,
    k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS initially_deferred,
    pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,k.conname LIMIT 501`,
  indexes:`SELECT c.relname AS table_name,ic.relname AS name,i.indisvalid AS valid,i.indisready AS ready,
    i.indisunique AS unique,i.indisprimary AS primary_index,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,ic.relname LIMIT 501`,
  triggers:`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,
    pn.nspname AS function_schema,p.proname AS function_name,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname LIMIT 201`,
  routines:`SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prosecdef AS security_definer,p.proconfig AS settings,r.rolname AS owner,
    md5(pg_get_functiondef(p.oid)) AS definition_md5,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname='public' AND p.prokind='f' AND (p.proname='upsert_tu_student_identity' OR EXISTS(
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace tn ON tn.oid=c.relnamespace
      WHERE t.tgfoid=p.oid AND tn.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal))
    ORDER BY p.proname,pg_get_function_identity_arguments(p.oid) LIMIT 81`,
  table_acl:`SELECT c.relname AS table_name,coalesce(grantee.rolname,'PUBLIC') AS grantee,
    grantor.rolname AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee JOIN pg_roles grantor ON grantor.oid=a.grantor
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,grantee.rolname,a.privilege_type LIMIT 1501`,
  column_acl:`SELECT c.relname AS table_name,col.attname AS column_name,coalesce(grantee.rolname,'PUBLIC') AS grantee,
    grantor.rolname AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute col ON col.attrelid=c.oid
    CROSS JOIN LATERAL aclexplode(col.attacl) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    JOIN pg_roles grantor ON grantor.oid=a.grantor
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND col.attnum>0 AND NOT col.attisdropped
    ORDER BY c.relname,col.attnum,grantee.rolname,a.privilege_type LIMIT 1501`,
  routine_acl:`SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
    coalesce(grantee.rolname,'PUBLIC') AS grantee,grantor.rolname AS grantor,
    a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee JOIN pg_roles grantor ON grantor.oid=a.grantor
    WHERE n.nspname='public' AND p.proname='upsert_tu_student_identity'
    ORDER BY p.proname,grantee.rolname LIMIT 101`,
  dependencies:`SELECT p.proname AS routine_name,pg_get_function_identity_arguments(p.oid) AS arguments,
    d.deptype AS dependency_type,pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent_object
    FROM pg_depend d JOIN pg_proc p ON d.refclassid='pg_proc'::regclass AND d.refobjid=p.oid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('upsert_tu_student_identity','guard_phase1_review',
      'guard_phase1_application','guard_phase1_attachment','reject_immutable_row_mutation')
    ORDER BY p.proname,d.classid,d.objid,d.objsubid LIMIT 501`,
  effective_columns:`SELECT r.rolname AS role,c.relname AS table_name,a.attname AS column_name,
    has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS can_select,
    has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') AS can_insert,
    has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') AS can_update,
    has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES') AS can_reference
    FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE r.rolname IN ('coed_app','coed_tu_login') AND n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY r.rolname,c.relname,a.attnum LIMIT 3001`
});
const LIMITS={inventory:200,tables:100,columns:1500,constraints:500,indexes:500,triggers:200,
  routines:80,table_acl:1500,column_acl:1500,routine_acl:100,dependencies:500,effective_columns:3000};
function failure(code){const e=new Error(code);e.safeCode=code;throw e;}
function assertSafeCatalog(result){
  const text=JSON.stringify(result);
  if(Buffer.byteLength(text)>900000 || result.routines.some(r=>Buffer.byteLength(r.definition)>65000))failure('PREFLIGHT_OUTPUT_LIMIT');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bTU[0-9a-f]{60,}\b|\bBearer\s+[A-Za-z0-9._-]{20,}|(?:password|application[-_]key)\s*[:=]\s*["'][^"'\s]{8,}/i.test(text))
    failure('PREFLIGHT_UNSAFE_CATALOG_OUTPUT');
  return result;
}
async function readCatalog(query){
  const result={notice:'Observed present schema, NOT recovered historical SQL; no business rows',version:1};
  for(const [key,sql] of Object.entries(SQL)){
    const rows=await query(sql,['inventory','routine_acl','dependencies'].includes(key)?[]:[TABLES]);
    if(rows.length>LIMITS[key])failure('PREFLIGHT_CATALOG_LIMIT');
    result[key]=rows;
  }
  return assertSafeCatalog(result);
}
module.exports={TABLES,SQL,LIMITS,assertSafeCatalog,readCatalog};
