// Temporary, IAM-operator-only owner capability. Fixed operations, never a SQL
// console. No provider/signing credentials or real applicant data in its output.
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {SecretsManagerClient,GetSecretValueCommand,PutSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {upgradeObservedSchema} from '../present-schema-upgrade.mjs';
import {PROFILE,sha256} from '../present-schema-baseline.mjs';
export const TARGET=Object.freeze({account:'130165494095',region:'ap-southeast-2',
  name:'coed-tu-owner-upgrade-20261105',role:'coed-tu-owner-upgrade-role-20261105',
  operator:'arn:aws:iam::130165494095:role/managed/AccountFullAccessRole',
  host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',
  database:'coed',user:'postgres',subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab',
  endpoint:'vpce-08e95353a534b9e27',sid:'CoedTuOwnerUpgrade20261105',
  ownerSecret:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx',
  contract:'coed-tu-owner-v1'});
export const FUNCTION_ARN='arn:aws:lambda:'+TARGET.region+':'+TARGET.account+':function:'+TARGET.name;
export const LOGIN_SECRET_RE=/^arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed\/v4\/postgres\/tu-login-[A-Za-z0-9]{6}$/;
const denied=code=>{const e=new Error(code);e.safeCode=code;return e;};
export function validate(event,context,env,now){
  if(!event || Array.isArray(event) || Object.keys(event).sort().join(',')!=='contract,mode,runId' ||
    event.contract!==TARGET.contract || !['trial','apply','login'].includes(event.mode) ||
    !/^[a-f0-9]{32}$/.test(env.OWNER_RUN_ID || '') || event.runId!==env.OWNER_RUN_ID ||
    env.NODE_ENV!=='production' || env.AWS_REGION!==TARGET.region || env.OWNER_ENABLED!=='true' ||
    env.OWNER_MAINTENANCE!=='true' || env.OWNER_SNAPSHOT_VERIFIED!=='true' ||
    !/^[1-9][0-9]*$/.test(context.functionVersion || '') ||
    context.invokedFunctionArn!==FUNCTION_ARN+':'+context.functionVersion ||
    !LOGIN_SECRET_RE.test(env.OWNER_LOGIN_SECRET_ARN || '') ||
    ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_API_SECRET_ARN','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>Boolean(env[k])))
    throw denied('OWNER_REQUEST_DENIED');
  const expires=Date.parse(env.OWNER_EXPIRES_AT);
  if(!Number.isFinite(expires) || expires<=now || expires>now+7200000)throw denied('OWNER_EXPIRED');
  if(event.mode!=='trial' && env.OWNER_TRIAL_SUCCEEDED!=='true')throw denied('OWNER_TRIAL_REQUIRED');
  return event.mode;
}
export function ownerPassword(value){
  if(!value || value.username!=='postgres' || typeof value.password!=='string' || !value.password ||
    (value.host && value.host!==TARGET.host) || (value.engine && value.engine!=='postgres'))
    throw denied('OWNER_SECRET_INVALID');
  return value.password;
}
// Send a SCRAM verifier, not a plaintext password, in the ALTER ROLE statement.
export function scram(password,salt=randomBytes(16)){
  if(typeof password!=='string' || !/^[A-Za-z0-9_-]{64}$/.test(password))throw denied('LOGIN_SECRET_INVALID');
  const salted=pbkdf2Sync(password,salt,4096,32,'sha256');
  const client=createHmac('sha256',salted).update('Client Key').digest();
  const server=createHmac('sha256',salted).update('Server Key').digest('base64');
  return 'SCRAM-SHA-256$4096:'+salt.toString('base64')+'$'+createHash('sha256').update(client).digest('base64')+':'+server;
}
function secretClient(){return new SecretsManagerClient({region:TARGET.region,maxAttempts:1,
  requestHandler:{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true}});}
async function getJson(secrets,arn,version){
  try{
    const r=await secrets.send(new GetSecretValueCommand({SecretId:arn,...(version?{VersionId:version}:{VersionStage:'AWSCURRENT'})}),
      {abortSignal:AbortSignal.timeout(3000)});
    if(typeof r.SecretString!=='string' || r.SecretString.length>32768)throw denied('OWNER_SECRET_INVALID');
    return JSON.parse(r.SecretString);
  }catch(e){if(version && e.name==='ResourceNotFoundException')return null;throw denied('OWNER_SECRET_UNAVAILABLE');}
}
function connection(password,user=TARGET.user){
  const client=new pg.Client({host:TARGET.host,port:5432,database:TARGET.database,user,password,
    ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../../../global-bundle.pem',import.meta.url),'utf8')},
    connectionTimeoutMillis:2500,query_timeout:10000,application_name:'coed_tu_owner_bounded',
    options:'-c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000'});
  client.on('error',()=>{});return client;
}
export async function provisionLogin(client,secrets,env,loginFactory=connection){
  const roleSql=readFileSync(new URL('../tu-login-role.sql',import.meta.url),'utf8');
  if(sha256(roleSql)!==env.OWNER_ROLE_SQL_SHA256)throw denied('OWNER_ROLE_SOURCE_INTEGRITY');
  const existing=(await client.query("SELECT rolcanlogin,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname='coed_tu_login'")).rows[0];
  if(existing && existing.marker!=='COED_TU_LOGIN_V1_SELECT_ONLY')throw denied('LOGIN_ROLE_OWNERSHIP');
  let value=await getJson(secrets,env.OWNER_LOGIN_SECRET_ARN,env.OWNER_RUN_ID);
  if(!value){
    if(existing?.rolcanlogin)throw denied('LOGIN_ROLE_UNEXPLAINED');
    value={engine:'postgres',host:TARGET.host,dbname:TARGET.database,port:5432,username:'coed_tu_login',password:randomBytes(48).toString('base64url')};
    // The issuer is not created/routed yet. A DB failure leaves an unused secret,
    // never an enabled account with an unknown password. Retry reuses this version.
    await secrets.send(new PutSecretValueCommand({SecretId:env.OWNER_LOGIN_SECRET_ARN,
      ClientRequestToken:env.OWNER_RUN_ID,SecretString:JSON.stringify(value),VersionStages:['AWSCURRENT']}),
      {abortSignal:AbortSignal.timeout(3000)});
  }
  if(value.engine!=='postgres' || value.host!==TARGET.host || value.dbname!==TARGET.database ||
    value.port!==5432 || value.username!=='coed_tu_login' || !/^[A-Za-z0-9_-]{64}$/.test(value.password || ''))
    throw denied('LOGIN_SECRET_INVALID');
  // Remove only the fixed transaction delimiters from reviewed SQL so enabling
  // the login is atomic with the role contract. No event content becomes SQL.
  const body=roleSql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
  await client.query('BEGIN');
  try{
    await client.query(body);
    if(!existing?.rolcanlogin)await client.query("ALTER ROLE coed_tu_login LOGIN PASSWORD '"+scram(value.password)+"'");
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  const login=loginFactory(value.password,'coed_tu_login');
  try{
    await login.connect();
    const row=(await login.query("SELECT current_user='coed_tu_login' AND current_database()='coed' AS matches")).rows[0];
    if(!row?.matches)throw denied('LOGIN_CONNECTION_FAILED');
  }finally{await login.end().catch(()=>{});}
  return {selectOnlyContractVerified:true,loginConnectionVerified:true,secretVersion:env.OWNER_RUN_ID};
}
export function createOwnerTool({env=process.env,clock=Date.now,secrets,connect,upgrade=upgradeObservedSchema,
  loginProvisioner=provisionLogin,logger=line=>console.log(line)}={}){
 return async function handler(event,context={}){
  const start=clock();let client,mode,code='OK',result;
  try{
    mode=validate(event,context,env,clock());
    const sm=secrets || secretClient(),password=ownerPassword(await getJson(sm,TARGET.ownerSecret));
    client=connect?await connect(password):connection(password);
    await client.connect();
    const guarded={query:async(...args)=>{
      const remaining=typeof context.getRemainingTimeInMillis==='function'?context.getRemainingTimeInMillis():90000-(clock()-start);
      if(remaining<15000 && args[0]!=='ROLLBACK')throw denied('OWNER_DEADLINE');
      return client.query(...args);
    }};
    result=await upgrade({client:guarded,profile:PROFILE,expectedDatabase:TARGET.database,expectedSchema:'public',
      mode:mode==='apply'?'apply':'trial',maintenanceApproved:true});
    if(mode==='login'){
      if(!result.idempotentReplay)throw denied('OWNER_APPLY_REQUIRED');
      if(typeof context.getRemainingTimeInMillis==='function' && context.getRemainingTimeInMillis()<20000)
        throw denied('OWNER_DEADLINE');
      result=await loginProvisioner(client,sm,env);
    }
    return {contract:TARGET.contract,ok:true,mode,result};
  }catch(e){
    code=e.safeCode || e.code;
    if(!/^(OWNER_|OBSERVED_|LOGIN_|UPGRADE_|DEDICATED_|EXPLICIT_|MAINTENANCE_)[A-Z0-9_]+$/.test(code || ''))code='OWNER_OPERATION_FAILED';
    const sqlState=e.sqlState || e.code;
    return {contract:TARGET.contract,ok:false,error:{code,...(/^[A-Z0-9]{5}$/.test(sqlState || '')?{sqlState}:{})}};
  }finally{
    if(client){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
    logger(JSON.stringify({operation:mode || 'rejected',code,durationMs:clock()-start,version:context.functionVersion || 'unpublished'}));
  }
 };
}
export const handler=createOwnerTool();
