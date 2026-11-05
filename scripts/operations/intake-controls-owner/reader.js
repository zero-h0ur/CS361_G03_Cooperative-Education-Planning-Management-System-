// C7 first gate: one fixed READ ONLY inventory. No Apply/SQL/metadata-write mode.
const {Client}=require('pg');
const {readFileSync}=require('node:fs');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {readCatalog}=require('../tu-preflight/catalog');
const T=Object.freeze({name:'coed-intake-controls-owner-20261105',role:'coed-intake-controls-owner-role-20261105',
 account:'130165494095',region:'ap-southeast-2',database:'coed',host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',
 subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab',
 secret:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx',
 cognitoIssuer:'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Um6nksXa1',tuIssuer:'urn:coed:tu-auth:130165494095',
 contract:'coed-intake-controls-owner-inventory-v1'});
const ARN=`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}`;
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
function validate(event,context,env,now){
 if(!event || Object.keys(event).sort().join(',')!=='contract,runId' || event.contract!==T.contract || event.runId!==env.RUN_ID ||
   !/^[a-f0-9]{32}$/.test(env.RUN_ID || '') || env.NODE_ENV!=='production' || env.AWS_REGION!==T.region || env.ENABLED!=='true' ||
   !/^\d{10}$/.test(env.STUDENT_NUMBER || '') || !/^[a-f0-9-]{36}$/.test(env.COORDINATOR_SUBJECT || '') ||
   !/^[1-9][0-9]*$/.test(context.functionVersion || '') || context.invokedFunctionArn!==ARN+':'+context.functionVersion ||
   !(Date.parse(env.EXPIRES_AT)>now && Date.parse(env.EXPIRES_AT)<=now+3600000) ||
   ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>env[k]))fail('C7_INVENTORY_DENIED');
}
async function inspect(client,{studentNumber,coordinatorSubject}){
 const guard=(await client.query(`SELECT current_database() AS db,current_user AS role,current_setting('transaction_read_only') AS readonly,
   current_setting('transaction_isolation') AS isolation,current_schema() AS schema`)).rows[0];
 if(guard.db!==T.database && !(process.env.NODE_ENV==='test' && guard.db==='coed_intake_test') || guard.role!=='postgres' || guard.readonly!=='on' || guard.isolation!=='repeatable read')fail('C7_READONLY_REQUIRED');
 const migrations=(await client.query('SELECT version,checksum FROM public.schema_migrations ORDER BY version LIMIT 100')).rows;
 const student=(await client.query(`SELECT s.id AS student_id,u.id AS user_id,u.account_status,s.identity_source,
   EXISTS(SELECT 1 FROM public.external_identity_links l WHERE l.user_id=u.id AND l.external_issuer=$2 AND l.external_subject=$1 AND l.status='ACTIVE') AS tu_link_active
   FROM public.students s JOIN public.users u ON u.id=s.user_id WHERE s.student_number=$1 AND u.role='STUDENT' LIMIT 2`,[studentNumber,T.tuIssuer])).rows;
 const coordinator=(await client.query(`SELECT u.id AS user_id,u.role,u.account_status FROM public.external_identity_links l
   JOIN public.users u ON u.id=l.user_id WHERE l.external_issuer=$1 AND l.external_subject=$2 AND l.status='ACTIVE' LIMIT 2`,[T.cognitoIssuer,coordinatorSubject])).rows;
 const cohorts=(await client.query(`SELECT c.id,c.cycle_id,c.department,c.program,c.coordinator_id,c.committee_one,c.committee_two,c.committee_three,c.status,
   r.name AS cycle_name,r.status AS round_status,r.academic_year,r.semester,
   (SELECT count(*)::int FROM public.users u WHERE u.id=ANY(ARRAY[c.committee_one,c.committee_two,c.committee_three]) AND u.role='COMMITTEE' AND u.account_status='ACTIVE') AS active_committee_count
   FROM public.selection_cohorts c JOIN public.rounds r ON r.id=c.cycle_id WHERE c.coordinator_id=ANY($1::uuid[]) ORDER BY c.cycle_id,c.id LIMIT 100`,[coordinator.map(c=>c.user_id)])).rows;
 if(migrations.length===100 || student.length>1 || coordinator.length>1 || cohorts.length===100)fail('C7_INVENTORY_LIMIT');
 const catalog=await readCatalog(async(sql,values)=>(await client.query(sql,values)).rows);
 return {migrations,student,coordinator,cohorts,catalog,noDatabaseWrites:true};
}
function createReader({env=process.env,clock=Date.now,secrets,clientFactory,logger=()=>{}}={}){
 return async(event,context={})=>{let client,sm;
  try{validate(event,context,env,clock());
   sm=secrets || new SecretsManagerClient({region:T.region,maxAttempts:1,requestHandler:{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true}});
   let credential;try{const r=await sm.send(new GetSecretValueCommand({SecretId:T.secret,VersionStage:'AWSCURRENT'}),{abortSignal:AbortSignal.timeout(3000)});
    if(typeof r.SecretString!=='string' || r.SecretString.length>16384)fail('C7_SECRET_INVALID');credential=JSON.parse(r.SecretString);
   }catch(e){fail(e.name==='AccessDeniedException'?'C7_SECRET_DENIED':'C7_SECRET_UNAVAILABLE');}
   if(credential.username!=='postgres' || typeof credential.password!=='string' || !credential.password || credential.host && credential.host!==T.host)fail('C7_SECRET_INVALID');
   client=clientFactory?clientFactory():new Client({host:T.host,port:5432,database:T.database,user:'postgres',password:credential.password,
    ssl:{rejectUnauthorized:true,ca:readFileSync('/var/task/global-bundle.pem','utf8')},connectionTimeoutMillis:3000,query_timeout:2500,
    options:'-c default_transaction_read_only=on -c statement_timeout=2000 -c lock_timeout=300 -c idle_in_transaction_session_timeout=3000 -c search_path=public'});
   client.on?.('error',()=>{});await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const data=await inspect(client,{studentNumber:env.STUDENT_NUMBER,coordinatorSubject:env.COORDINATOR_SUBJECT});await client.query('ROLLBACK');
   if(Buffer.byteLength(JSON.stringify(data))>1100000)fail('C7_OUTPUT_LIMIT');return {contract:T.contract,ok:true,data};
  }catch(error){return {contract:T.contract,ok:false,code:/^C7_[A-Z_]+$/.test(error.safeCode || '')?error.safeCode:'C7_INVENTORY_FAILED'};}
  finally{if(client){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}sm?.destroy?.();logger('C7_READONLY_INVENTORY_FINISHED');}
 };
}
module.exports={T,ARN,validate,inspect,createReader,handler:createReader()};
