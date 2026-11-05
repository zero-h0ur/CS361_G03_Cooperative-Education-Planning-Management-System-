import pg from 'pg';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import reader from './reader.js';
import {upgradeIntake,validateManifest} from '../intake-controls-upgrade.mjs';
const {T,ARN}=reader;
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
export function validate(event,context,env,now){
 if(!event || Object.keys(event).sort().join(',')!=='contract,mode,runId' || event.contract!=='coed-intake-controls-upgrade-v1' || !['inventory','trial','apply'].includes(event.mode) ||
  event.runId!==env.RUN_ID || !/^[a-f0-9]{32}$/.test(env.RUN_ID || '') || env.NODE_ENV!=='production' || env.AWS_REGION!==T.region || env.ENABLED!=='true' ||
  !/^[1-9][0-9]*$/.test(context.functionVersion || '') || context.invokedFunctionArn!==ARN+':'+context.functionVersion ||
  !(Date.parse(env.EXPIRES_AT)>now && Date.parse(env.EXPIRES_AT)<=now+3600000) || !/^[a-f0-9]{64}$/.test(env.MANIFEST_SHA256 || '') ||
  ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>env[k]))fail('C7_UPGRADE_DENIED');
 if(event.mode==='apply' && (env.TRIAL_PASSED!=='true' || !/^[a-f0-9]{64}$/.test(env.EXPECTED_POST_HASH || '')))fail('C7_TRIAL_REQUIRED');
 return event.mode;
}
export function createHandler({env=process.env,clock=Date.now,secrets,connect,readManifest,upgrade=upgradeIntake}={}){
 return async(event,context={})=>{let client,sm;
  try{
   const mode=validate(event,context,env,clock()),bytes=readManifest?readManifest():readFileSync(new URL('../../../approved-manifest.json',import.meta.url));
   if(createHash('sha256').update(bytes).digest('hex')!==env.MANIFEST_SHA256)fail('C7_MANIFEST_DRIFT');const manifest=validateManifest(JSON.parse(bytes));
   sm=secrets || new SecretsManagerClient({region:T.region,maxAttempts:1,requestHandler:{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true}});
   let credential;try{const value=await sm.send(new GetSecretValueCommand({SecretId:T.secret,VersionStage:'AWSCURRENT'}),{abortSignal:AbortSignal.timeout(3000)});credential=JSON.parse(value.SecretString);
   }catch(e){fail(e.name==='AccessDeniedException'?'C7_SECRET_DENIED':'C7_SECRET_UNAVAILABLE');}
   if(credential.username!=='postgres' || typeof credential.password!=='string' || !credential.password || credential.host && credential.host!==T.host)fail('C7_SECRET_INVALID');
   client=connect?connect(credential.password):new pg.Client({host:T.host,port:5432,database:T.database,user:'postgres',password:credential.password,
    ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../../../global-bundle.pem',import.meta.url),'utf8')},connectionTimeoutMillis:3000,query_timeout:15000,
    options:'-c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000 -c search_path=public'});
   client.on?.('error',()=>{});await client.connect();const guarded={query:(...args)=>{
    if(context.getRemainingTimeInMillis && context.getRemainingTimeInMillis()<18000 && args[0]!=='ROLLBACK')fail('C7_DEADLINE');return client.query(...args);}};
   const result=await upgrade({client:guarded,manifest,mode,expectedPostHash:env.EXPECTED_POST_HASH});return {contract:event.contract,ok:true,result};
  }catch(error){return {contract:'coed-intake-controls-upgrade-v1',ok:false,code:/^C7_[A-Z_]+$/.test(error.safeCode || '')?error.safeCode:'C7_UPGRADE_FAILED',
    ...(/^[A-Z0-9]{5}$/.test(error.sqlState || '')?{sqlState:error.sqlState}:{})};}
  finally{if(client){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}sm?.destroy?.();}
 };
}
export const handler=createHandler();
