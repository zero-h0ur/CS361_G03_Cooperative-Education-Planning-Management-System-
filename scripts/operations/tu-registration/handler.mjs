// Temporary IAM-only019 owner tool. Fixed SQL, target and expiry. No arbitrary
// query, student identifier, password, token or account provisioning operation.
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {SecretsManagerClient,GetSecretValueCommand,PutSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {upgradeRegistration} from '../tu-registration-upgrade.mjs';
export const T=Object.freeze({name:'coed-tu-registration-upgrade-20261105',role:'coed-tu-registration-upgrade-role-20261105',
 region:'ap-southeast-2',account:'130165494095',database:'coed',host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',
 subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab',
 owner:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx',contract:'coed-tu-registration-owner-v1'});
const fail=code=>{const e=Error(code);e.safeCode=code;throw e;};
export function validate(event,context,env,now){
 if(!event||Array.isArray(event)||Object.keys(event).sort().join(',')!=='contract,mode,runId'||event.contract!==T.contract||
  !['trial','apply','credential'].includes(event.mode)||!/^[a-f0-9]{32}$/.test(env.RUN_ID||'')||event.runId!==env.RUN_ID||
  env.NODE_ENV!=='production'||env.AWS_REGION!==T.region||env.ENABLED!=='true'||env.MAINTENANCE_VERIFIED!=='true'||env.SNAPSHOT_VERIFIED!=='true'||
  !/^[1-9][0-9]*$/.test(context.functionVersion||'')||context.invokedFunctionArn!==`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}:${context.functionVersion}`||
  !/^arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed\/v4\/postgres\/tu-registration-[A-Za-z0-9]{6}$/.test(env.REGISTRATION_SECRET||'')||
  ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_API_SECRET_ARN','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>env[k])||
  !(Date.parse(env.EXPIRES_AT)>now&&Date.parse(env.EXPIRES_AT)<=now+7200000))fail('REGISTRATION_OWNER_REQUEST_DENIED');
 if(event.mode!=='trial'&&env.TRIAL_PASSED!=='true')fail('REGISTRATION_OWNER_TRIAL_REQUIRED');return event.mode;
}
export function scram(password,salt=randomBytes(16)){
 if(!/^[A-Za-z0-9_-]{64}$/.test(password||''))fail('REGISTRATION_CREDENTIAL_INVALID');
 const salted=pbkdf2Sync(password,salt,4096,32,'sha256'),client=createHmac('sha256',salted).update('Client Key').digest();
 return 'SCRAM-SHA-256$4096:'+salt.toString('base64')+'$'+createHash('sha256').update(client).digest('base64')+':'+createHmac('sha256',salted).update('Server Key').digest('base64');
}
function connection(password,user='postgres'){
 const c=new pg.Client({host:T.host,port:5432,database:T.database,user,password,
  ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../../../global-bundle.pem',import.meta.url),'utf8')},
  connectionTimeoutMillis:2500,query_timeout:15000,application_name:'coed_registration_owner_019',
  options:'-c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000'});
 c.on('error',()=>{});return c;
}
async function secret(sm,arn,version){
 try{const r=await sm.send(new GetSecretValueCommand({SecretId:arn,...(version?{VersionId:version}:{VersionStage:'AWSCURRENT'})}),{abortSignal:AbortSignal.timeout(3000)});
  if(typeof r.SecretString!=='string'||r.SecretString.length>32768)fail('REGISTRATION_OWNER_SECRET_INVALID');return JSON.parse(r.SecretString);
 }catch(e){if(version&&e.name==='ResourceNotFoundException')return null;fail(e.name==='AccessDeniedException'?'REGISTRATION_OWNER_SECRET_DENIED':'REGISTRATION_OWNER_SECRET_UNAVAILABLE');}
}
export async function credential(client,sm,env,connect=connection){
 let value=await secret(sm,env.REGISTRATION_SECRET,env.RUN_ID);
 const role=(await client.query("SELECT rolcanlogin,shobj_description(oid,'pg_authid') marker FROM pg_roles WHERE rolname='coed_tu_registration'")).rows[0];
 if(role?.marker!=='COED_TU_REGISTRATION_V1_EXECUTE_ONLY')fail('REGISTRATION_ROLE_OWNERSHIP');
 if(!value){
  if(role.rolcanlogin)fail('REGISTRATION_CREDENTIAL_UNEXPLAINED');
  value={engine:'postgres',host:T.host,dbname:T.database,port:5432,username:'coed_tu_registration',password:randomBytes(48).toString('base64url')};
  await sm.send(new PutSecretValueCommand({SecretId:env.REGISTRATION_SECRET,ClientRequestToken:env.RUN_ID,SecretString:JSON.stringify(value),VersionStages:['AWSCURRENT']}),{abortSignal:AbortSignal.timeout(3000)});
 }
 if(value.engine!=='postgres'||value.host!==T.host||value.dbname!==T.database||value.port!==5432||value.username!=='coed_tu_registration'||!/^[A-Za-z0-9_-]{64}$/.test(value.password||''))fail('REGISTRATION_CREDENTIAL_INVALID');
 if(!role.rolcanlogin)await client.query("ALTER ROLE coed_tu_registration LOGIN PASSWORD '"+scram(value.password)+"'");
 const c=connect(value.password,'coed_tu_registration');try{await c.connect();
  const row=(await c.query(`SELECT current_user='coed_tu_registration' AND current_database()='coed' AS matches,
   has_function_privilege(current_user,'public.complete_tu_registration(text,uuid,uuid,jsonb,text,integer,timestamptz)','EXECUTE') AS executable,
   has_table_privilege(current_user,'public.users','SELECT,INSERT,UPDATE,DELETE') AS direct`)).rows[0];
  if(!row?.matches||row.executable!==true||row.direct!==false)fail('REGISTRATION_CREDENTIAL_CAPABILITY');
 }finally{await c.end().catch(()=>{});}
 return {connectionVerified:true,executeOnlyVerified:true,noAccountCreated:true};
}
export function createHandler({env=process.env,clock=Date.now,connect=connection,secrets,upgrade=upgradeRegistration,provision=credential,logger=line=>console.log(line)}={}){
 return async(event,context={})=>{
  let c,sm,mode,code='OK';try{
   mode=validate(event,context,env,clock());sm=secrets||new SecretsManagerClient({region:T.region,maxAttempts:1,requestHandler:{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true}});
   const owner=await secret(sm,T.owner);
   if(owner.username!=='postgres'||typeof owner.password!=='string'||!owner.password||(owner.host&&owner.host!==T.host))fail('REGISTRATION_OWNER_SECRET_INVALID');
   c=connect(owner.password);await c.connect();
   const guarded={query:(...args)=>{
    if(typeof context.getRemainingTimeInMillis==='function'&&context.getRemainingTimeInMillis()<18000&&args[0]!=='ROLLBACK')fail('REGISTRATION_OWNER_DEADLINE');
    return c.query(...args);
   }};
   let result=await upgrade({client:guarded,expectedDatabase:T.database,mode:mode==='apply'?'apply':'trial',maintenanceApproved:true});
   if(mode==='credential'){if(!result.idempotentReplay)fail('REGISTRATION_OWNER_APPLY_REQUIRED');result=await provision(c,sm,env);}
   return {contract:T.contract,ok:true,mode,result};
  }catch(e){code=e.safeCode||'REGISTRATION_OWNER_OPERATION_FAILED';return {contract:T.contract,ok:false,error:{code,...(e.sqlState?{sqlState:e.sqlState}:{}),...(e.safeMetadata?{metadata:e.safeMetadata}:{})}};}
  finally{if(c){await c.query('ROLLBACK').catch(()=>{});await c.end().catch(()=>{});}sm?.destroy?.();logger(JSON.stringify({mode:mode||'rejected',code,version:context.functionVersion||'unpublished'}));}
 };
}
export const handler=createHandler();
