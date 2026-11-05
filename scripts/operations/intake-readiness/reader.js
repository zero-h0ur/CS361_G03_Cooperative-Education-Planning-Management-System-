// A0 only: fixed SELECT queries, no owner credential or business commands.
const {Pool}=require('pg');
const {readFileSync}=require('node:fs');
const {SecretsManagerClient}=require('@aws-sdk/client-secrets-manager');
const {createRdsPasswordProvider}=require('../../../src/db/rds-secret');
const {readCatalog}=require('../tu-preflight/catalog');
const T=Object.freeze({account:'130165494095',region:'ap-southeast-2',
  name:'coed-intake-readonly-20261105',role:'coed-intake-readonly-role-20261105',
  tag:'intake-readonly-20261105',sid:'CoedIntakeReadonly20261105',contract:'coed-intake-readiness-v1',
  host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',database:'coed',user:'coed_app',
  secret:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/app-6VnYui',
  subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab'});
const ARN=`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}`;
const SQL=Object.freeze({
  guard:`SELECT current_database()=$1 AS database_matches,current_user=$2 AS user_matches,
    current_setting('transaction_read_only')='on' AS read_only,
    current_setting('transaction_isolation')='repeatable read' AS repeatable_read`,
  migrations:'SELECT version,checksum FROM public.schema_migrations ORDER BY version LIMIT 100',
  rounds:`SELECT r.id,r.name,r.academic_year,r.semester,r.status,r.visibility,
    w.opens_at,w.closes_at,clock_timestamp()>=w.opens_at AND clock_timestamp()<w.closes_at AS intake_open,
    s.review_closes_at,
    (SELECT count(*)::int FROM public.selection_cohorts c WHERE c.cycle_id=r.id AND c.status='ACTIVE') AS active_cohorts
    FROM public.rounds r LEFT JOIN public.phase1_cycle_windows w ON w.cycle_id=r.id
    LEFT JOIN public.coordinator_round_schedules s ON s.cycle_id=r.id
    ORDER BY r.academic_year DESC,r.semester DESC NULLS LAST,r.id LIMIT 100`,
  cohorts:`SELECT c.id,c.cycle_id,c.department,c.program,c.status,
    u.role='COORDINATOR' AND u.account_status='ACTIVE' AS coordinator_active,
    EXISTS(SELECT 1 FROM public.external_identity_links l WHERE l.user_id=c.coordinator_id
      AND l.status='ACTIVE' AND l.external_issuer LIKE 'https://cognito-idp.%') AS cognito_link_present,
    (SELECT count(*)::int FROM public.users m WHERE m.id=ANY(ARRAY[c.committee_one,c.committee_two,c.committee_three])
      AND m.role='COMMITTEE' AND m.account_status='ACTIVE') AS active_committee_count
    FROM public.selection_cohorts c JOIN public.users u ON u.id=c.coordinator_id
    WHERE c.status='ACTIVE' ORDER BY c.cycle_id,c.id LIMIT 100`,
  policies:`SELECT cycle_id,curriculum,version,source_year,verified,synthetic,
    data->>'repeat_rule' AS repeat_rule,data->>'alternative_rule' AS alternative_rule,
    jsonb_typeof(data->'credits')='object' AS has_credit_map
    FROM public.phase1_policies ORDER BY cycle_id,curriculum,version DESC LIMIT 100`,
  onboarding:`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null
    FROM pg_attribute a WHERE a.attrelid=to_regclass('public.tu_student_registrations') AND a.attnum>0
      AND NOT a.attisdropped ORDER BY a.attnum LIMIT 30`
});
const fail=code=>{const e=Error(code);e.safeCode=code;throw e;};
function validate(event,context,env,now){
  if(!event || Array.isArray(event) || Object.keys(event).sort().join(',')!=='contract,runId' ||
    event.contract!==T.contract || !/^[a-f0-9]{32}$/.test(env.INTAKE_RUN_ID || '') || event.runId!==env.INTAKE_RUN_ID ||
    env.NODE_ENV!=='production' || env.AWS_REGION!==T.region || env.INTAKE_ENABLED!=='true' ||
    !/^[1-9][0-9]*$/.test(context.functionVersion || '') || context.invokedFunctionArn!==ARN+':'+context.functionVersion ||
    ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>env[k]))fail('INTAKE_DIAG_DENIED');
  const expires=Date.parse(env.INTAKE_EXPIRES_AT);
  if(!Number.isFinite(expires) || expires<=now || expires>now+3600000)fail('INTAKE_DIAG_EXPIRED');
}
async function inspect(client,check=()=>{}){
  const query=async(sql,values=[])=>{check();const r=await client.query(sql,values);check();return r.rows;};
  const guard=(await query(SQL.guard,[T.database,T.user]))[0];
  if(!guard?.database_matches || !guard.user_matches || !guard.read_only || !guard.repeatable_read)fail('INTAKE_DIAG_READONLY_REQUIRED');
  const data={guard};
  for(const key of ['migrations','rounds','cohorts','policies','onboarding']){
    data[key]=await query(SQL[key]);if(data[key].length>=(key==='onboarding'?30:100))fail('INTAKE_DIAG_LIMIT');
  }
  data.catalog=await readCatalog(query);
  const json=JSON.stringify(data);
  if(Buffer.byteLength(json)>1000000 || /-----BEGIN .*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{20,}|\bTU[0-9a-f]{60,}/i.test(json))fail('INTAKE_DIAG_OUTPUT_DENIED');
  return data;
}
function createReader({env=process.env,clock=Date.now,poolFactory,logger=console.log,deadlineMs=22000}={}){
  return async(event,context={})=>{
    let pool,client,timer,cancelled=false,result;
    const check=()=>{if(cancelled)fail('INTAKE_DIAG_DEADLINE');};
    const work=async()=>{
      validate(event,context,env,clock());
      pool=poolFactory?poolFactory():new Pool({host:T.host,database:T.database,user:T.user,port:5432,max:1,
        password:createRdsPasswordProvider({secretArn:T.secret,expected:{host:T.host,database:T.database,user:T.user,port:5432},
          client:new SecretsManagerClient({region:T.region,maxAttempts:1,requestHandler:{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true}}),ttlMs:0,timeoutMs:3000}),
        ssl:{rejectUnauthorized:true,ca:readFileSync('/var/task/global-bundle.pem','utf8')},connectionTimeoutMillis:4000,
        query_timeout:2000,options:'-c default_transaction_read_only=on -c statement_timeout=1500 -c search_path=public'});
      pool.on?.('error',()=>{});const connected=await pool.connect();
      if(cancelled){connected.release(true);fail('INTAKE_DIAG_DEADLINE');}client=connected;client.on?.('error',()=>{});
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');check();
      await client.query("SET LOCAL statement_timeout='1500ms'");check();
      await client.query("SET LOCAL lock_timeout='300ms'");check();
      await client.query("SET LOCAL idle_in_transaction_session_timeout='3000ms'");check();
      const data=await inspect(client,check);await client.query('ROLLBACK');check();
      return {contract:T.contract,ok:true,data};
    };
    try{result=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{cancelled=true;const e=Error();e.safeCode='INTAKE_DIAG_DEADLINE';reject(e);},deadlineMs);})]);}
    catch(e){result={contract:T.contract,ok:false,code:/^INTAKE_DIAG_[A-Z_]+$/.test(e.safeCode || '')?e.safeCode:'INTAKE_DIAG_UNAVAILABLE'};}
    finally{cancelled=true;clearTimeout(timer);if(client)client.release(true);if(pool)await pool.end().catch(()=>{});
      try{logger(JSON.stringify({operation:'intake-readonly',ok:result?.ok===true,code:result?.code || 'INTAKE_DIAG_OK'}));}catch{/* No event/raw SQL or credentials. */}}
    return result;
  };
}
module.exports={T,ARN,SQL,validate,inspect,createReader,handler:createReader()};
