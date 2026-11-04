import pg from 'pg';
import {readFileSync} from 'node:fs';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {T,validate,reason,safeResult,denied} from './contract.mjs';
import {inspectIdentity} from './query.mjs';
export function loginPassword(value){
 if(value?.engine!=='postgres' || value.host!==T.host || value.dbname!==T.database || value.port!==5432 ||
  value.username!==T.user || typeof value.password!=='string' || !/^[A-Za-z0-9_-]{64}$/.test(value.password))throw denied('DIAG_SECRET_INVALID');
 return value.password;
}
export function createDiagnostic({env=process.env,clock=Date.now,secrets,connect,inspect=inspectIdentity,logger=x=>console.log(x)}={}){
 let invocations=0;
 return async function handler(event,context={}){
  const start=clock();let client,result;
  try{
   const subject=validate(event,context,env,clock());
   if(++invocations>3)throw denied('DIAG_LIMIT');
   const sm=secrets || new SecretsManagerClient({region:T.region,maxAttempts:1,
    requestHandler:{connectionTimeout:800,requestTimeout:1500,throwOnRequestTimeout:true}});
   let value;
   try{const r=await sm.send(new GetSecretValueCommand({SecretId:T.secret,VersionStage:'AWSCURRENT'}),{abortSignal:AbortSignal.timeout(2000)});
    if(typeof r.SecretString!=='string' || r.SecretString.length>8192)throw Error();value=JSON.parse(r.SecretString);
   }catch{throw denied('DIAG_SECRET_UNAVAILABLE');}
   const password=loginPassword(value);
   client=connect?connect(password):new pg.Client({host:T.host,port:5432,database:T.database,user:T.user,password,
    ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('./global-bundle.pem',import.meta.url),'utf8')},
    connectionTimeoutMillis:1200,query_timeout:2200,application_name:'coed_identity_readonly',
    options:'-c default_transaction_read_only=on -c statement_timeout=2000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=3000 -c search_path=pg_catalog'});
   client.on?.('error',()=>{});await client.connect();
   result={contract:T.contract,ok:true,...await inspect(client,subject).then(flags=>({reason:reason(flags),flags}))};
  }catch(e){
   const code=/^DIAG_[A-Z_]+$/.test(e.safeCode || '')?e.safeCode:'DIAG_QUERY_FAILED';
   try{result=safeResult({contract:T.contract,ok:false,code});}catch{result={contract:T.contract,ok:false,code:'DIAG_QUERY_FAILED'};}
  }finally{
   if(client){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
   try{logger(JSON.stringify({operation:'identity-readonly',ok:result?.ok===true,
    code:result?.ok?result.reason:result?.code || 'DIAG_QUERY_FAILED',version:/^[1-9][0-9]*$/.test(context.functionVersion || '')?context.functionVersion:'unpublished',
    durationMs:Math.max(0,Math.min(10000,clock()-start))}));}catch{/* No raw event/error/subject logging. */}
  }
  return safeResult(result);
 };
}
export const handler=createDiagnostic();
