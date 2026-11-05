// Temporary operator-only reader. Not imported by any application entry point.
const {Pool}=require('pg');
const {readFileSync}=require('node:fs');
const {SecretsManagerClient}=require('@aws-sdk/client-secrets-manager');
const {createRdsPasswordProvider}=require('../../../src/db/rds-secret');
const {readCatalog}=require('./catalog');
const TARGET=Object.freeze({account:'130165494095',region:'ap-southeast-2',
  name:'coed-tu-preflight-readonly-20261104',role:'coed-tu-preflight-readonly-role-20261104',
  operator:'arn:aws:iam::130165494095:role/managed/AccountFullAccessRole',
  host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',database:'coed',user:'coed_app',
  secret:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/app-6VnYui',
  subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab',endpoint:'vpce-08e95353a534b9e27',
  sid:'CoedTuPreflight20261104',contract:'coed-tu-preflight-v1'});
const FUNCTION_ARN=`arn:aws:lambda:${TARGET.region}:${TARGET.account}:function:${TARGET.name}`;
const TABLES=Object.freeze(['schema_migrations','users','external_identity_links','students','rounds',
  'selection_cohorts','phase1_academic_profiles','phase1_policies','phase1_cycle_windows',
  'phase1_applications','phase1_submissions','phase1_submission_deliveries','phase1_reviews',
  'coordinator_round_schedules','coordinator_operations','committee_workspaces','committee_workspace_events',
  'phase1_selection_results','phase1_schedule_events','phase1_notifications','tu_identity_link_events']);
const ROUTINES=Object.freeze(['upsert_tu_student_identity','guard_phase1_review','guard_phase1_application',
  'guard_phase1_delivery','require_phase1_delivery','guard_phase1_attachment','reject_immutable_row_mutation']);
// All identifiers are fixed. Event values can never become SQL or object names.
const SQL=Object.freeze({
  guard:`SELECT current_database()=$1 AS database_matches,current_user=$2 AS user_matches,
    current_setting('transaction_read_only')='on' AS read_only,
    current_setting('transaction_isolation')='repeatable read' AS repeatable_read,
    current_setting('server_version_num')::int AS server_version_num`,
  tables:`SELECT c.relname AS name,c.relkind AS kind,has_table_privilege(current_user,c.oid,'SELECT') AS can_select
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname LIMIT 100`,
  migrations:`SELECT version,checksum FROM public.schema_migrations ORDER BY version LIMIT 100`,
  columns:`SELECT c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS not_null,has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS can_select
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum LIMIT 1500`,
  constraints:`SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,k.convalidated AS validated,
    k.condeferrable AS deferrable,md5(pg_get_constraintdef(k.oid)) AS definition_md5
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname LIMIT 500`,
  triggers:`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,p.proname AS function_name,
    md5(pg_get_triggerdef(t.oid)) AS definition_md5 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname LIMIT 200`,
  routines:`SELECT p.proname AS name,p.prosecdef AS security_definer,
    pg_get_function_identity_arguments(p.oid) AS arguments,md5(pg_get_functiondef(p.oid)) AS definition_md5,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS runtime_can_execute,
    position('phase1_submission_deliveries' in pg_get_functiondef(p.oid))>0 AS uses_delivery_receipts
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname,p.oid LIMIT 50`,
  privileges:`SELECT r.rolname AS role,c.relname AS table_name,
    has_table_privilege(r.oid,c.oid,'SELECT') AS select_table,
    has_any_column_privilege(r.oid,c.oid,'SELECT') AS select_any_column,
    has_table_privilege(r.oid,c.oid,'INSERT') AS insert_table,
    has_table_privilege(r.oid,c.oid,'UPDATE') AS update_table,
    has_table_privilege(r.oid,c.oid,'DELETE') AS delete_table,
    has_table_privilege(r.oid,c.oid,'TRUNCATE') AS truncate_table,
    has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES') AS any_column_write
    FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE r.rolname IN ('coed_app','coed_tu_login') AND n.nspname='public'
      AND c.relname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f') ORDER BY r.rolname,c.relname LIMIT 200`,
  roles:`SELECT r.rolname AS role,r.rolcanlogin AS login,r.rolsuper AS superuser,r.rolcreatedb AS create_db,
    r.rolcreaterole AS create_role,r.rolbypassrls AS bypass_rls,r.rolinherit AS inherits,
    has_schema_privilege(r.oid,'public','CREATE') AS create_public_schema,
    has_database_privilege(r.oid,current_database(),'CREATE') AS create_schema,
    (SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prorettype<>'trigger'::regtype AND has_function_privilege(r.oid,p.oid,'EXECUTE')
        AND (p.prosecdef OR NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')))
      AS callable_application_routines
    FROM pg_roles r WHERE r.rolname IN ('coed_app','coed_tu_login') ORDER BY r.rolname`,
  identity:`WITH matches AS (SELECT l.id,l.user_id,l.status,u.role,u.account_status,s.id AS student_id,
    s.student_number,s.full_name,s.institutional_email,s.department,s.program,s.major,s.academic_year,s.enrollment_status
    FROM public.external_identity_links l JOIN public.users u ON u.id=l.user_id
    LEFT JOIN public.students s ON s.user_id=u.id WHERE l.external_issuer=$1 AND l.external_subject=$2)
    SELECT count(*)::int AS exact_links,count(*) FILTER(WHERE status='ACTIVE')::int AS active_links,
      count(DISTINCT user_id)::int AS linked_owners,
      count(*) FILTER(WHERE status='ACTIVE' AND role='STUDENT' AND account_status='ACTIVE' AND student_number=$2)::int AS active_matching_students,
      count(*) FILTER(WHERE status='ACTIVE' AND role='STUDENT' AND account_status='ACTIVE' AND student_number=$2
        AND student_id IS NOT NULL AND length(btrim(full_name))>0 AND length(btrim(institutional_email))>0
        AND length(btrim(department))>0 AND length(btrim(program))>0 AND length(btrim(major))>0
        AND academic_year>0 AND length(btrim(enrollment_status))>0
        AND NOT EXISTS(SELECT 1 FROM public.external_identity_links o WHERE o.user_id=matches.user_id AND o.status='ACTIVE' AND o.id<>matches.id))::int AS complete_single_owner
    FROM matches`
});
function denied(code='PREFLIGHT_DENIED'){const e=new Error(code);e.safeCode=code;return e;}
function validate(event,context,env,now){
  const keys=event?.mode==='identity'?['contract','runId','mode','subject']:['contract','runId','mode'];
  if(!event || typeof event!=='object' || Array.isArray(event) || Object.keys(event).length!==keys.length ||
    !keys.every(k=>Object.hasOwn(event,k)) || event.contract!==TARGET.contract || !['metadata','identity','schema'].includes(event.mode) ||
    !/^[a-f0-9]{32}$/.test(env.PREFLIGHT_RUN_ID || '') || event.runId!==env.PREFLIGHT_RUN_ID ||
    (event.mode==='identity' && (typeof event.subject!=='string' || !/^\d{10}$/.test(event.subject))))throw denied();
  const expiry=Date.parse(env.PREFLIGHT_EXPIRES_AT);
  if(env.NODE_ENV!=='production' || env.PREFLIGHT_ENABLED!=='true' || env.AWS_REGION!==TARGET.region ||
    !/^[1-9][0-9]*$/.test(context.functionVersion || '') ||
    context.invokedFunctionArn!==FUNCTION_ARN+':'+context.functionVersion ||
    !Number.isFinite(expiry) || expiry<=now || expiry>now+7200000 ||
    ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_AUTH_PRIVATE_KEY'].some(k=>Boolean(env[k])))throw denied();
  return event.mode;
}
async function readMetadata(client,mode,subject,check=()=>{}){
  const query=async(sql,values=[])=>{check();const r=await client.query(sql,values);check();return r.rows;};
  const guards=(await query(SQL.guard,[TARGET.database,TARGET.user]))[0];
  if(!guards?.database_matches || !guards.user_matches || !guards.read_only || !guards.repeatable_read)throw denied('PREFLIGHT_READONLY_GUARD_FAILED');
  if(mode==='identity'){
    const row=(await query(SQL.identity,[`urn:coed:tu-auth:${TARGET.account}`,subject]))[0];
    return {guards,identity:{status:'CHECKED',...row}};
  }
  const tables=await query(SQL.tables,[TABLES]);
  if(!tables.some(t=>t.name==='schema_migrations' && t.can_select))throw denied('PREFLIGHT_MIGRATION_READ_DENIED');
  const migrations=(await query(SQL.migrations)).map(r=>({version:/^[A-Za-z0-9_-]+\.sql$/.test(r.version || '')?r.version:'REDACTED_UNEXPECTED_NAME',
    checksum:/^[a-f0-9]{64}$/.test((r.checksum || '').trim())?r.checksum.trim():'INVALID_CHECKSUM_FORMAT'}));
  const result={guards,tables,missingTables:TABLES.filter(name=>!tables.some(t=>t.name===name)),migrations,identity:{status:'NOT_CHECKED'}};
  for(const key of ['columns','constraints','triggers','routines','privileges','roles'])
    result[key]=await query(SQL[key],key==='roles'?[]:[key==='routines'?ROUTINES:TABLES]);
  if(mode==='schema')result.catalog=await readCatalog(query);
  return result;
}
function productionPool(){
  const secrets=new SecretsManagerClient({region:TARGET.region,maxAttempts:1,
    requestHandler:{connectionTimeout:800,requestTimeout:1800,throwOnRequestTimeout:true}});
  return new Pool({host:TARGET.host,database:TARGET.database,user:TARGET.user,port:5432,max:1,
    password:createRdsPasswordProvider({secretArn:TARGET.secret,expected:{host:TARGET.host,database:TARGET.database,user:TARGET.user,port:5432},
      client:secrets,ttlMs:0,timeoutMs:2200}),ssl:{rejectUnauthorized:true,ca:readFileSync('/var/task/global-bundle.pem','utf8')},
    connectionTimeoutMillis:2500,query_timeout:1500,idleTimeoutMillis:500});
}
function createReader({env=process.env,clock=Date.now,createPool=productionPool,logger=line=>console.log(line),deadlineMs=11000}={}){
  if(!Number.isInteger(deadlineMs) || deadlineMs<1 || deadlineMs>11000)throw denied();
  return async function handler(event,context={}){
    const start=clock();let pool,client,timer,cancelled=false,mode='request',code='PREFLIGHT_DENIED',releaseNeeded=false;
    const check=()=>{if(cancelled)throw denied('PREFLIGHT_DEADLINE');};
    const work=async()=>{
      mode=validate(event,context,env,clock());pool=createPool();pool.on?.('error',()=>{});
      const connected=await pool.connect();
      if(cancelled){connected.release(true);throw denied('PREFLIGHT_DEADLINE');}
      client=connected;releaseNeeded=true;client.on?.('error',()=>{});check();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');check();
      await client.query("SET LOCAL statement_timeout='1000ms'");check();
      await client.query("SET LOCAL lock_timeout='300ms'");check();
      await client.query("SET LOCAL idle_in_transaction_session_timeout='3000ms'");check();
      const data=await readMetadata(client,mode,event.subject,check);check();
      await client.query('ROLLBACK');check();
      const result={contract:TARGET.contract,ok:true,data};
      if(Buffer.byteLength(JSON.stringify(result))>(mode==='schema'?1000000:120000))throw denied('PREFLIGHT_OUTPUT_LIMIT');
      code='PREFLIGHT_OK';return result;
    };
    try{
      return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;reject(denied('PREFLIGHT_DEADLINE'));},deadlineMs);})]);
    }catch(error){
      code=['PREFLIGHT_DENIED','PREFLIGHT_READONLY_GUARD_FAILED','PREFLIGHT_MIGRATION_READ_DENIED','PREFLIGHT_DEADLINE','PREFLIGHT_OUTPUT_LIMIT','PREFLIGHT_UNSAFE_CATALOG_OUTPUT','PREFLIGHT_CATALOG_LIMIT'].includes(error?.safeCode)?error.safeCode:'PREFLIGHT_QUERY_UNAVAILABLE';
      return {contract:TARGET.contract,ok:false,error:{code}};
    }finally{
      cancelled=true;clearTimeout(timer);
      // Destroy this reader connection; no session transaction can survive a timeout.
      if(client && releaseNeeded){client.release(true);releaseNeeded=false;}
      if(pool)await pool.end().catch(()=>{});
      try{logger(JSON.stringify({code,mode:['metadata','identity','schema'].includes(mode)?mode:'request',durationMs:Math.max(0,clock()-start),
        version:/^[1-9][0-9]*$/.test(context.functionVersion || '')?context.functionVersion:'rejected'}));}catch{/* No raw errors. */}
    }
  };
}
module.exports={TARGET,FUNCTION_ARN,TABLES,ROUTINES,SQL,validate,readMetadata,createReader,handler:createReader()};
