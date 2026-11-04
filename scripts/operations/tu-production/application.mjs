import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {SecretsManagerClient,CreateSecretCommand,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {buildTuIamPolicies} from '../tu-auth-deployment-plan.mjs';
import {aws,ROOT,A,REGION,API,PROVIDER,OPERATOR,arn,roleArn,fixed,hash,save,caller,owned,tags,tagList,absent,
 endpoint,addStatement,setEndpoint,putDeny,waitActive,delay,sdkCredentials} from './common.mjs';
import {apiPermission,integration,API_BASE} from './deploy.mjs';
const require=createRequire(import.meta.url),{getTuKeyPair}=require('../../../src/auth/tu-keys.js');
const ISSUER='coed-tu-session-issuer',ISSUER_ROLE='coed-tu-session-role',BROKER='coed-tu-auth';
const fingerprint='948706ef031812b73af8fdc7002a7ee06cfdbc89b431d1720526ae249abc3958';
function checkMaintenance(s){fixed(s.maintenance?.active===true && s.ownerApplied && s.loginReady,'STRICT_DB_PREREQUISITES_REQUIRED');}
function policies(s,alias='candidate'){
 return buildTuIamPolicies({account:A,region:REGION,operatorRoleArn:OPERATOR,issuerAliasArn:arn(ISSUER)+':'+alias,
  tuSecretArn:PROVIDER,dbSecretArn:s.loginSecret,signingSecretArn:s.signingSecret});
}
function validateApiEnv(v){
 fixed(!['DATABASE_URL','DB_PASSWORD','TU_AUTH_PRIVATE_KEY','TU_API_APP_KEY','TU_SIGNING_SECRET_ARN'].some(k=>v[k]));
 fixed(v.DB_USER==='coed_app' && v.DB_NAME==='coed' && v.DB_HOST==='database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com' &&
  v.DB_SECRET_ARN==='arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/app-6VnYui');
 fixed(hash(getTuKeyPairPublic(v.TU_AUTH_PUBLIC_KEY))===fingerprint);return v;
}
function getTuKeyPairPublic(value){return require('node:crypto').createPublicKey(value.replace(/\\n/g,'\n')).export({format:'der',type:'spki'});}
async function secretSigning(path,s){
 const c=aws(['lambda','get-function-configuration','--function-name',BROKER]),a=aws(['lambda','get-function-configuration','--function-name','coed-api']);
 fixed([c,a].every(f=>f.CodeSha256===Buffer.from(s.artifacts.maintenance.sha256,'hex').toString('base64')),'MAINTENANCE_CODE_DRIFT');
 const v=c.Environment?.Variables || {},api=validateApiEnv(a.Environment?.Variables || {});
 const sm=new SecretsManagerClient({region:REGION,credentials:sdkCredentials(),maxAttempts:1});
 if(s.signingSecret){
  const meta=aws(['secretsmanager','describe-secret','--secret-id',s.signingSecret]);owned(Object.fromEntries(meta.Tags.map(t=>[t.Key,t.Value])),s);
  const r=await sm.send(new GetSecretValueCommand({SecretId:s.signingSecret}));
  const keys=getTuKeyPair(JSON.parse(r.SecretString));fixed(hash(keys.publicKey.export({format:'der',type:'spki'}))===fingerprint);
  return api;
 }
 fixed(absent(['secretsmanager','describe-secret','--secret-id','coed/v4/tu/signing']));
 const pair=getTuKeyPair({privateKey:v.TU_AUTH_PRIVATE_KEY,publicKey:v.TU_AUTH_PUBLIC_KEY});
 fixed(hash(pair.publicKey.export({format:'der',type:'spki'}))===fingerprint);
 fixed(v.TU_AUTH_ISSUER===api.TU_AUTH_ISSUER && v.TU_AUTH_CLIENT_ID===api.TU_AUTH_CLIENT_ID);
 const r=await sm.send(new CreateSecretCommand({Name:'coed/v4/tu/signing',
  Description:'CO-ED existing verified signing pair; private issuer only',Tags:tagList(s),
  SecretString:JSON.stringify({privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}),
   publicKey:pair.publicKey.export({format:'pem',type:'spki'})})}));
 s.signingSecret=r.ARN;s.owned.signingSecret=true;save(path,s);return api;
}
export async function stageApplications(path,s){
 caller();checkMaintenance(s);fixed(!s.candidatesReady);
 const apiEnv=await secretSigning(path,s),p=policies(s),group='/aws/lambda/'+ISSUER;
 fixed(absent(['lambda','get-function-configuration','--function-name',ISSUER]) && absent(['iam','get-role','--role-name',ISSUER_ROLE]));
 const role=aws(['iam','create-role','--role-name',ISSUER_ROLE,'--assume-role-policy-document',JSON.stringify(p.trust),'--tags',JSON.stringify(tagList(s))]).Role;
 s.issuerRoleId=role.RoleId;s.owned.issuerRole=true;save(path,s);
 aws(['iam','put-role-policy','--role-name',ISSUER_ROLE,'--policy-name','CoedTuSessionRestricted','--policy-document',JSON.stringify(p.issuer)]);
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group));
 aws(['logs','create-log-group','--log-group-name',group,'--tags',JSON.stringify(tags(s))]);s.owned.issuerLogs=true;save(path,s);
 aws(['logs','put-retention-policy','--log-group-name',group,'--retention-in-days','14']);
 const ep={Sid:'CoedTuIssuerSecrets20261105',Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',
  Resource:[s.loginSecret,s.signingSecret],Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(ISSUER_ROLE)}}};
 const before=endpoint();setEndpoint(before,addStatement(before,ep));s.issuerEndpoint=ep;save(path,s);
 const issuerEnv={NODE_ENV:'production',DB_HOST:apiEnv.DB_HOST,DB_PORT:'5432',DB_NAME:'coed',DB_USER:'coed_tu_login',
  DB_SECRET_ARN:s.loginSecret,DB_SSL_CA_FILE:'/var/task/global-bundle.pem',DB_POOL_MAX:'1',DB_CONN_TIMEOUT:'1000',DB_QUERY_TIMEOUT:'1000',
  TU_AUTH_ISSUER:apiEnv.TU_AUTH_ISSUER,TU_AUTH_CLIENT_ID:apiEnv.TU_AUTH_CLIENT_ID,
  TU_SIGNING_SECRET_ARN:s.signingSecret,TU_SESSION_FUNCTION_ARN:arn(ISSUER)+':candidate'};
 fixed(hash(readFileSync(s.artifacts.issuer.file))===s.artifacts.issuer.sha256);
 let created;
 for(let i=0;i<8;i++){
  try{created=aws(['lambda','create-function','--function-name',ISSUER,'--runtime','nodejs22.x','--role',roleArn(ISSUER_ROLE),
   '--handler','src/tu-session-issuer.handler','--timeout','8','--memory-size','256','--zip-file','fileb://'+s.artifacts.issuer.file,
   '--vpc-config',JSON.stringify({SubnetIds:['subnet-0fb8a4985d4e48f03'],SecurityGroupIds:['sg-01157dbde4cba48ab']}),
   '--environment',JSON.stringify({Variables:issuerEnv}),'--tags',JSON.stringify(tags(s))]);break;}
  catch(e){if(!e.rolePropagation || i===7)throw e;await delay(2000);}
 }
 fixed(created.FunctionArn===arn(ISSUER));s.owned.issuerFunction=true;save(path,s);
 aws(['lambda','put-function-concurrency','--function-name',ISSUER,'--reserved-concurrent-executions','2']);
 putDeny(ISSUER,[roleArn('coed-tu-auth-role'),OPERATOR]);
 await publish(path,s,ISSUER,'candidate');
 aws(['iam','put-role-policy','--role-name','coed-tu-auth-role','--policy-name','CoedTuBrokerRestricted','--policy-document',JSON.stringify(p.broker)]);
 for(const [name,artifact,handler,env,timeout] of [
  [BROKER,s.artifacts.broker,'src/tu-auth-broker.handler',{NODE_ENV:'production',TU_API_URL:'https://restapi.tu.ac.th/api/v1/auth/Ad/verify',
   TU_API_SECRET_ARN:PROVIDER,TU_SESSION_FUNCTION_ARN:arn(ISSUER)+':candidate',TU_AUTH_ISSUER:apiEnv.TU_AUTH_ISSUER,
   TU_AUTH_CLIENT_ID:apiEnv.TU_AUTH_CLIENT_ID,TU_LOGIN_MAINTENANCE:'true'},20],
  ['coed-api',s.artifacts.api,'src/lambda.handler',{...apiEnv,COED_API_MAINTENANCE:'verify'},15]
 ]){
  fixed(hash(readFileSync(artifact.file))===artifact.sha256);
  const old=aws(['lambda','get-function-configuration','--function-name',name]);
  aws(['lambda','update-function-code','--function-name',name,'--revision-id',old.RevisionId,'--zip-file','fileb://'+artifact.file]);
  const ready=await waitActive(name);
  aws(['lambda','update-function-configuration','--function-name',name,'--revision-id',ready.RevisionId,
   '--handler',handler,'--timeout',String(timeout),'--environment',JSON.stringify({Variables:env})]);
  await publish(path,s,name,'candidate');
 }
 s.candidatesReady=true;s.status='CANDIDATES_READY';save(path,s);return {status:s.status};
}
export async function publish(path,s,name,alias){
 fixed(['coed-api',BROKER,ISSUER].includes(name) && ['candidate','live'].includes(alias));
 const c=await waitActive(name);
 const artifact=s.artifacts[name==='coed-api'?'api':name===BROKER?'broker':'issuer'];
 fixed(c.CodeSha256===Buffer.from(artifact.sha256,'hex').toString('base64'),'CANDIDATE_CODE_DRIFT');
 const v=aws(['lambda','publish-version','--function-name',name,'--code-sha256',c.CodeSha256,'--revision-id',c.RevisionId]);
 fixed(/^[1-9][0-9]*$/.test(v.Version));
 if(name===ISSUER)putDeny(name,[roleArn('coed-tu-auth-role'),OPERATOR],v.Version);
 const prior=s.versions?.[name]?.[alias];
 if(prior){
  const old=aws(['lambda','get-alias','--function-name',name,'--name',alias]);fixed(old.FunctionVersion===prior);
  aws(['lambda','update-alias','--function-name',name,'--name',alias,'--function-version',v.Version,'--revision-id',old.RevisionId]);
 }else{
  fixed(absent(['lambda','get-alias','--function-name',name,'--name',alias]));
  aws(['lambda','create-alias','--function-name',name,'--name',alias,'--function-version',v.Version]);
 }
 s.versions={...s.versions,[name]:{...s.versions?.[name],[alias]:v.Version}};save(path,s);
 if(name===ISSUER)putDeny(name,[roleArn('coed-tu-auth-role'),OPERATOR],alias);
 return v.Version;
}
async function invoke(name,alias,event){
 const c=new LambdaClient({region:REGION,credentials:sdkCredentials(),maxAttempts:1});
 const r=await c.send(new InvokeCommand({FunctionName:arn(name)+':'+alias,InvocationType:'RequestResponse',LogType:'None',Payload:Buffer.from(JSON.stringify(event))}));
 fixed(r.StatusCode===200 && !r.FunctionError,'CANDIDATE_EXECUTION_FAILED');
 return JSON.parse(Buffer.from(r.Payload).toString());
}
export async function candidateChecks(path,s){
 caller();checkMaintenance(s);fixed(s.candidatesReady);
 const issuer=await invoke(ISSUER,'candidate',{});fixed(issuer.ok===false && issuer.error?.status===403);
 const broker=await invoke(BROKER,'candidate',{rawPath:'/api/v3/auth/tu-login',httpMethod:'POST',body:'{}'});
 fixed(broker.statusCode===503 && JSON.parse(broker.body).error?.code==='TU_LOGIN_MAINTENANCE');
 const api=await invoke('coed-api','candidate',{rawPath:'/api/v3/me',httpMethod:'GET'});
 fixed(api.statusCode===401);
 const blocked=await invoke('coed-api','candidate',{rawPath:'/api/tu-proxy/api/v4/applications',httpMethod:'POST',body:'{}'});
 fixed(blocked.statusCode===503 && JSON.parse(blocked.body).error?.code==='COED_MAINTENANCE');
 s.candidateChecks={invalidEnvelopeRejected:true,brokerMaintenance:true,anonymousMeRejected:true,writesBlocked:true};
 save(path,s);return {status:'CANDIDATE_CHECKS_PASSED',...s.candidateChecks};
}
export async function routeVerification(path,s){
 caller();checkMaintenance(s);fixed(s.candidateChecks?.writesBlocked && s.iamNegative?.passed && !s.verificationRouted);
 const issuer=aws(['lambda','get-function-configuration','--function-name',ISSUER]);
 aws(['lambda','update-function-configuration','--function-name',ISSUER,'--revision-id',issuer.RevisionId,
  '--environment',JSON.stringify({Variables:{...issuer.Environment.Variables,TU_SESSION_FUNCTION_ARN:arn(ISSUER)+':live'}})]);
 await publish(path,s,ISSUER,'live');
 const p=policies(s,'live');
 aws(['iam','put-role-policy','--role-name','coed-tu-auth-role','--policy-name','CoedTuBrokerRestricted','--policy-document',JSON.stringify(p.broker)]);
 const broker=aws(['lambda','get-function-configuration','--function-name',BROKER]);
 fixed(!['TU_AUTH_PRIVATE_KEY','TU_API_APP_KEY','DB_SECRET_ARN'].some(k=>broker.Environment.Variables[k]));
 aws(['lambda','update-function-configuration','--function-name',BROKER,'--revision-id',broker.RevisionId,
  '--environment',JSON.stringify({Variables:{...broker.Environment.Variables,TU_LOGIN_MAINTENANCE:'false',TU_SESSION_FUNCTION_ARN:arn(ISSUER)+':live'}})]);
 await publish(path,s,BROKER,'live');
 const malformed=await invoke(BROKER,'live',{rawPath:'/api/v3/auth/tu-login',httpMethod:'POST',body:'{}'});fixed(malformed.statusCode===400);
 const invalid=await invoke(ISSUER,'live',{});fixed(invalid.ok===false && invalid.error?.status===403);
 await publish(path,s,'coed-api','live');
 apiPermission('coed-api','live','CoedTuLive'+s.runId.slice(0,8),'arn:aws:execute-api:'+REGION+':'+A+':'+API+'/*/*/*');
 for(const [method,pth] of [['POST','tu-login'],['GET','tu-status']])
  apiPermission(BROKER,'live','CoedTu'+method+s.runId.slice(0,8),'arn:aws:execute-api:'+REGION+':'+A+':'+API+'/*/'+method+'/api/v3/auth/'+pth);
 integration(s,'ip14y62',arn('coed-api')+':live');save(path,s);
 integration(s,'sr47ns9',arn(BROKER)+':live');save(path,s);
 const r=await fetch(API_BASE+'/api/v3/me',{redirect:'error',signal:AbortSignal.timeout(10000)});fixed(r.status===401);
 const b=await fetch(API_BASE+'/api/tu-proxy/api/v4/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
 fixed(b.status===503 && (await b.json()).error?.code==='COED_MAINTENANCE');
 s.verificationRouted=true;s.status='WAITING_OWNER_SMOKE';save(path,s);
 return {status:s.status,apiReadOnly:true,noStudentPasswordNeededInChat:true};
}
export async function resumeAfterOwnerSmoke(path,s){
 caller();checkMaintenance(s);
 fixed(s.verificationRouted && s.status==='WAITING_OWNER_SMOKE' && process.env.COED_OWNER_SMOKE_ATTESTED==='true',
  'FRESH_OWNER_SMOKE_ATTESTATION_REQUIRED');
 const c=aws(['lambda','get-function-configuration','--function-name','coed-api']);
 const old=aws(['lambda','get-alias','--function-name','coed-api','--name','live']);
 fixed(old.FunctionVersion===s.versions['coed-api'].live && c.Environment.Variables.COED_API_MAINTENANCE==='verify');
 const api=validateApiEnv(c.Environment.Variables);
 s.ownerSmoke={attestedAt:new Date().toISOString(),independentCredentialTest:false,
  versions:{api:s.versions['coed-api'].live,broker:s.versions[BROKER].live,issuer:s.versions[ISSUER].live}};save(path,s);
 aws(['lambda','update-function-configuration','--function-name','coed-api','--revision-id',c.RevisionId,
  '--environment',JSON.stringify({Variables:{...api,COED_API_MAINTENANCE:'off'}})]);
 await publish(path,s,'coed-api','live');
 const routes=aws(['apigatewayv2','get-routes','--api-id',API]).Items;
 fixed(hash(routes)===hash(s.baseline.routes),'GATEWAY_ROUTES_DRIFT');
 const cfg=aws(['apigatewayv2','get-api','--api-id',API]);fixed(hash(cfg.CorsConfiguration)===hash(s.baseline.apiConfig.CorsConfiguration));
 s.maintenance.active=false;s.resumedAt=new Date().toISOString();s.status='LIVE_MONITORING';save(path,s);
 return {status:s.status,maintenanceEndedAt:s.resumedAt};
}
export function report(path,s){
 caller();
 const safeFunctions=[];
 for(const name of ['coed-api',BROKER,ISSUER]){
  const c=aws(['lambda','get-function-configuration','--function-name',name]);
  safeFunctions.push({name,state:c.State,lastUpdate:c.LastUpdateStatus,hash:c.CodeSha256,handler:c.Handler,
   aliasVersion:s.versions?.[name]?.live || null,envKeys:Object.keys(c.Environment?.Variables || {}).sort()});
 }
 const routes=aws(['apigatewayv2','get-routes','--api-id',API]).Items;
 const cfg=aws(['apigatewayv2','get-api','--api-id',API]);
 fixed(hash(routes)===hash(s.baseline.routes),'GATEWAY_ROUTES_DRIFT');
 fixed(hash(cfg.CorsConfiguration)===hash(s.baseline.apiConfig.CorsConfiguration),'CORS_DRIFT');
 const end=Date.now(),start=s.resumedAt?Date.parse(s.resumedAt):Date.parse(s.maintenance.startedAt);
 const runtimeMetrics=[];
 for(const name of [BROKER,ISSUER]){
  const errors=aws(['cloudwatch','get-metric-statistics','--namespace','AWS/Lambda','--metric-name','Errors',
   '--dimensions','Name=FunctionName,Value='+name,'--start-time',new Date(start).toISOString(),'--end-time',new Date(end).toISOString(),
   '--period','60','--statistics','Sum']).Datapoints || [];
  const messages=aws(['logs','filter-log-events','--log-group-name','/aws/lambda/'+name,
   '--start-time',String(start),'--end-time',String(end),'--filter-pattern','{ $.status >= 500 }',
   '--query','events[].message']);
  const categories={};
  for(const text of messages || []){
   try{const row=JSON.parse(text);
    if(Number.isInteger(row.status) && row.status>=500 && /^[A-Z][A-Z0-9_]{1,80}$/.test(row.code || ''))
      categories[row.code]=(categories[row.code] || 0)+1;
   }catch{/* Ignore platform log lines without echoing them. */}
  }
  runtimeMetrics.push({name,runtimeErrors:errors.reduce((n,p)=>n+(p.Sum || 0),0),handled5xxCategories:categories});
 }
 s.lastReportAt=new Date(end).toISOString();save(path,s);
 return {status:s.status,functions:safeFunctions,routesUnchanged:true,corsUnchanged:true,snapshot:s.snapshot,
  ownerToolRemoved:!!s.ownerCleanedAt,runtimeMetrics,monitoringElapsedMinutes:Math.max(0,(end-start)/60000),
  handledAuthHttpFailuresNotIncludedInLambdaErrors:true,ownerSmokeAttested:!!s.ownerSmoke,
  maintenanceActive:!!s.maintenance.active};
}
