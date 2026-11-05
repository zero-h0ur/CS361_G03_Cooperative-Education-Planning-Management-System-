// O8: fixed, expiring, IAM-only owner capability. No user/account/credential mode.
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {upgradeRegistrationIssuer,ISSUER} from '../tu-registration-issuer-upgrade.mjs';
export const T=Object.freeze({name:'coed-tu-registration-issuer-upgrade-20261105',role:'coed-tu-registration-issuer-upgrade-role-20261105',
 region:'ap-southeast-2',account:'130165494095',database:'coed',host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',
 subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab',
 owner:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-fc83fbf4-3fed-4d79-ab3a-6276719e730b-S1BcFx',contract:'coed-tu-registration-issuer-owner-v1'});
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
export function validate(event,context,env,now){
 if(!event||Object.keys(event).sort().join(',')!=='contract,mode,runId'||event.contract!==T.contract||
  !['inventory','trial','apply'].includes(event.mode)||!/^[a-f0-9]{32}$/.test(env.RUN_ID||'')||event.runId!==env.RUN_ID||
  env.NODE_ENV!=='production'||env.AWS_REGION!==T.region||env.ENABLED!=='true'||env.MAINTENANCE_VERIFIED!=='true'||env.EXPECTED_ISSUER!==ISSUER||
  !/^[1-9][0-9]*$/.test(context.functionVersion||'')||context.invokedFunctionArn!==`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}:${context.functionVersion}`||
  !(Date.parse(env.EXPIRES_AT)>now&&Date.parse(env.EXPIRES_AT)<=now+3600000)||
  ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_API_SECRET_ARN','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN','REGISTRATION_SECRET'].some(k=>env[k]))fail('ISSUER020_REQUEST_DENIED');
 if(event.mode==='apply'&&env.TRIAL_PASSED!=='true')fail('ISSUER020_TRIAL_REQUIRED');return event.mode;
}
function connection(password){
 const c=new pg.Client({host:T.host,port:5432,database:T.database,user:'postgres',password,
  ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../../../global-bundle.pem',import.meta.url),'utf8')},
  connectionTimeoutMillis:2500,query_timeout:15000,application_name:'coed_issuer_alignment_020',
  options:'-c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000'});
 c.on('error',()=>{});return c;
}
export function createHandler({env=process.env,clock=Date.now,connect=connection,secrets,upgrade=upgradeRegistrationIssuer,logger=line=>console.log(line)}={}){
 return async(event,context={})=>{
  let c,sm,mode,code='OK';
  try{
   mode=validate(event,context,env,clock());sm=secrets||new SecretsManagerClient({region:T.region,maxAttempts:1,requestHandler:{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true}});
   let owner;try{const value=await sm.send(new GetSecretValueCommand({SecretId:T.owner,VersionStage:'AWSCURRENT'}),{abortSignal:AbortSignal.timeout(3000)});
    if(typeof value.SecretString!=='string'||value.SecretString.length>16384)throw Error();owner=JSON.parse(value.SecretString);
   }catch(error){fail(error.name==='AccessDeniedException'?'ISSUER020_SECRET_DENIED':'ISSUER020_SECRET_UNAVAILABLE');}
   if(owner.username!=='postgres'||typeof owner.password!=='string'||!owner.password||(owner.host&&owner.host!==T.host))fail('ISSUER020_SECRET_INVALID');
   c=connect(owner.password);await c.connect();
   const guarded={query:(...args)=>{if(typeof context.getRemainingTimeInMillis==='function'&&context.getRemainingTimeInMillis()<18000&&args[0]!=='ROLLBACK')fail('ISSUER020_DEADLINE');return c.query(...args);}};
   const result=await upgrade({client:guarded,expectedDatabase:T.database,mode,maintenanceApproved:true,expectedIssuer:ISSUER});
   return {contract:T.contract,ok:true,mode,result};
  }catch(error){code=/^ISSUER020_[A-Z_]+$/.test(error.safeCode||'')?error.safeCode:'ISSUER020_OPERATION_FAILED';
   return {contract:T.contract,ok:false,error:{code,...(error.sqlState?{sqlState:error.sqlState}:{})}};
  }finally{if(c){await c.query('ROLLBACK').catch(()=>{});await c.end().catch(()=>{});}sm?.destroy?.();
   try{logger(JSON.stringify({mode:mode||'rejected',code,version:/^[1-9][0-9]*$/.test(context.functionVersion||'')?context.functionVersion:'unpublished'}));}catch{/* Fixed metadata only. */}}
 };
}
export const handler=createHandler();
