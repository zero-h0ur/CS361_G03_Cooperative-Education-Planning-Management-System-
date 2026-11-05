// Approved N0-N5 only. Interactive target, no password/SQL/credential arguments.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {build} from 'esbuild';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {T,FUNCTION_ARN,bindTarget,safeResult} from './contract.mjs';
import {createZip,listZipEntries,readZipEntry} from '../zip-archive.mjs';
import {publicCa} from '../../package-tu-auth.mjs';
import {aws,ROOT,API,OPERATOR,caller,fixed,hash,load as loadParent,statePath,cleanSource,
 arn,roleArn,absent,endpoint,addStatement,removeStatement,setEndpoint,eniPolicy,putDeny,
 waitActive,safeConfig,sdkCredentials,delay,safeFailure,invocationPolicyHash} from '../tu-production/common.mjs';
const parentPath='tmp/tu-production/production-ehWrZm/state.json';
const group='/aws/lambda/'+T.name,policyName='CoedIdentityReadonlyOnly';
export const ENDPOINT_GRACE_MS=300000;
const tags=s=>({coedTask:T.tag,runId:s.runId});
const tagList=s=>Object.entries(tags(s)).map(([Key,Value])=>({Key,Value}));
function owned(actual,s){fixed(actual?.coedTask===T.tag && actual.runId===s.runId,'DIAG_OWNERSHIP_MISMATCH');}
function save(path,s){writeFileSync(statePath(path),JSON.stringify(s,null,2)+'\n');}
function load(path){const s=JSON.parse(readFileSync(statePath(path),'utf8'));
 fixed(s.format===T.contract && s.account===T.account && /^[a-f0-9]{32}$/.test(s.runId) &&
  typeof s.zip==='string' && resolve(s.zip)===join(resolve(path,'..'),'diagnostic.zip'));return s;}
export function endpointGrant(){return {Sid:T.sid,Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',
 Resource:T.secret,Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(T.role)}}};}
export function executionPolicy(){return {Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.secret},
 {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${T.account}:log-group:${group}:*`},
 ...eniPolicy(T.name)]};}
export function applicationBaseline(){
 const p=loadParent(parentPath);fixed(p.status==='WAITING_OWNER_SMOKE' && p.maintenance?.active && !p.ownerSmoke &&
  p.loginReady && p.ownerApplied && p.loginSecret===T.secret,'DIAG_PARENT_CHECKPOINT');
 const functions=[];
 for(const name of ['coed-api','coed-tu-auth','coed-tu-session-issuer']){
  const c=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier','live']);
  const artifact=p.artifacts[name==='coed-api'?'api':name==='coed-tu-auth'?'broker':'issuer'];
  fixed(c.Version===p.versions[name].live && c.CodeSha256===Buffer.from(artifact.sha256,'hex').toString('base64') &&
   c.Environment?.Variables?.TU_AUTH_ISSUER===T.issuer,'DIAG_APPLICATION_DRIFT');
  if(name==='coed-api')fixed(c.Environment.Variables.COED_API_MAINTENANCE==='verify');
  if(name==='coed-tu-session-issuer')fixed(c.Environment.Variables.DB_SECRET_ARN===T.secret && c.Environment.Variables.DB_USER===T.user);
  const latest=aws(['lambda','get-function-configuration','--function-name',name]);
  functions.push({...safeConfig(c),version:c.Version,envHash:hash(c.Environment.Variables),
   latest:{...safeConfig(latest),envHash:hash(latest.Environment?.Variables)}});
 }
 const routes=aws(['apigatewayv2','get-routes','--api-id',API]).Items;
 const cors=aws(['apigatewayv2','get-api','--api-id',API]).CorsConfiguration;
 fixed(hash(routes)===hash(p.baseline.routes) && hash(cors)===hash(p.baseline.apiConfig.CorsConfiguration),'DIAG_GATEWAY_DRIFT');
 const integrations=aws(['apigatewayv2','get-integrations','--api-id',API]).Items;
 for(const [id,name] of [['ip14y62','coed-api'],['sr47ns9','coed-tu-auth']])
  fixed(integrations.find(i=>i.IntegrationId===id)?.IntegrationUri===arn(name)+':live','DIAG_INTEGRATION_DRIFT');
 return {functions,routes,cors,integrations};
}
export function preflight(){
 caller();const baseline=applicationBaseline();
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]),'DIAG_NAME_COLLISION');
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group),'DIAG_LOG_COLLISION');
 fixed(!endpoint().Statement.some(x=>x.Sid===T.sid),'DIAG_ENDPOINT_COLLISION');
 const meta=aws(['secretsmanager','describe-secret','--secret-id',T.secret]);
 fixed(meta.Name==='coed/v4/postgres/tu-login' && !meta.DeletedDate);
 return baseline;
}
export async function packageDiagnostic(ca){
 publicCa(ca);const source=cleanSource();
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'production-')),stage=join(dir,'identity-stage');mkdirSync(stage);
 const result=await build({absWorkingDir:ROOT,entryPoints:['scripts/operations/tu-identity-diagnostic/handler.mjs'],
  outfile:join(stage,'handler.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',external:['pg-native'],metafile:true,
  banner:{js:"import {createRequire as diagnosticRequire} from 'node:module'; const require=diagnosticRequire(import.meta.url);"},
  sourcemap:false,legalComments:'none',logLevel:'warning'});
 const inputs=Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('node_modules/')).sort();
 fixed(hash(inputs)===hash(['scripts/operations/tu-identity-diagnostic/contract.mjs',
  'scripts/operations/tu-identity-diagnostic/handler.mjs','scripts/operations/tu-identity-diagnostic/query.mjs']),'DIAG_DEPENDENCY_BOUNDARY');
 writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});
 const zip=join(dir,'diagnostic.zip');createZip(stage,zip,['handler.mjs','global-bundle.pem']);
 fixed(hash(listZipEntries(zip).sort())===hash(['global-bundle.pem','handler.mjs']));
 fixed(hash(cleanSource())===hash(source),'DIAG_SOURCE_CHANGED');
 const s={format:T.contract,account:T.account,runId:randomBytes(16).toString('hex'),source,zip,
  zipSha256:hash(readFileSync(zip)),status:'LOCAL_ONLY',owned:{},invocations:0};
 const path=join(dir,'state.json');writeFileSync(path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return {path,state:s};
}
function configuration(s){
 const f=aws(['lambda','get-function','--function-name',T.name]);owned(f.Tags,s);
 fixed(f.Configuration.Role===roleArn(T.role) && f.Configuration.CodeSha256===Buffer.from(s.zipSha256,'hex').toString('base64') &&
  f.Configuration.Handler==='handler.handler','DIAG_FUNCTION_DRIFT');return f.Configuration;
}
function environment(s,enabled){return {NODE_ENV:'production',DIAG_ENABLED:String(enabled),DIAG_RUN_ID:s.runId,
 DIAG_EXPIRES_AT:s.expiresAt,DIAG_LOGIN_SECRET_ARN:T.secret,DIAG_TARGET_DIGEST:s.targetDigest,DIAG_SALT:s.salt};}
export function endpointWaitMs(s,now){
 const updated=Date.parse(s.endpointUpdatedAt),ready=Date.parse(s.endpointReadyAt),expires=Date.parse(s.expiresAt);
 fixed(s.owned.endpoint===true && Number.isFinite(updated) && Number.isFinite(ready) && Number.isFinite(expires) &&
  ready-updated===ENDPOINT_GRACE_MS && updated<=now && ready<expires && expires>now,'DIAG_ENDPOINT_READINESS_INVALID');
 return Math.max(0,ready-now);
}
export async function waitForEndpointPropagation(s,{clock=Date.now,wait=delay,interrupted=()=>false,
 progress=x=>console.log(JSON.stringify(x))}={}){
 for(;;){
  fixed(!interrupted(),'DIAG_INTERRUPTED');const remaining=endpointWaitMs(s,clock());if(!remaining)return;
  progress({status:'WAITING_ENDPOINT_POLICY_PROPAGATION',remainingSeconds:Math.ceil(remaining/1000)});
  await wait(Math.min(30000,remaining));
 }
}
export async function deploy(path,s){
 fixed(s.status==='LOCAL_ONLY' && /^[a-f0-9]{64}$/.test(s.targetDigest || '') && /^[a-f0-9]{64}$/.test(s.salt || ''));
 const source=cleanSource();fixed(!source.dirty && hash(source)===hash(s.source),'DIAG_COMMITTED_SOURCE_REQUIRED');
 s.baseline=preflight();s.endpointBefore=endpoint();s.expiresAt=new Date(Date.now()+1800000).toISOString();save(path,s);
 s.creationStarted=true;save(path,s);
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
 const r=aws(['iam','create-role','--role-name',T.role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;
 fixed(r.Arn===roleArn(T.role));s.roleId=r.RoleId;s.owned.role=true;save(path,s);
 aws(['iam','put-role-policy','--role-name',T.role,'--policy-name',policyName,'--policy-document',JSON.stringify(executionPolicy())]);
 aws(['logs','create-log-group','--log-group-name',group,'--tags',JSON.stringify(tags(s))]);s.owned.logs=true;save(path,s);
 aws(['logs','put-retention-policy','--log-group-name',group,'--retention-in-days','1']);
 setEndpoint(s.endpointBefore,addStatement(s.endpointBefore,endpointGrant()));s.owned.endpoint=true;
 const endpointUpdated=Date.now();s.endpointUpdatedAt=new Date(endpointUpdated).toISOString();
 s.endpointReadyAt=new Date(endpointUpdated+ENDPOINT_GRACE_MS).toISOString();save(path,s);
 fixed(hash(readFileSync(s.zip))===s.zipSha256,'DIAG_ARCHIVE_DRIFT');
 for(let i=0;i<8;i++){
  try{aws(['lambda','create-function','--function-name',T.name,'--runtime','nodejs22.x','--role',roleArn(T.role),'--handler','handler.handler',
   '--timeout','10','--memory-size','256','--zip-file','fileb://'+s.zip,
   '--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),
   '--environment',JSON.stringify({Variables:environment(s,false)}),'--tags',JSON.stringify(tags(s))]);break;}
  catch(e){if(!e.rolePropagation || i===7)throw e;await delay(2000);}
 }
 s.owned.function=true;save(path,s);
 aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);
 putDeny(T.name,[OPERATOR]);await waitActive(T.name);
 const c=configuration(s);aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',c.RevisionId,
  '--environment',JSON.stringify({Variables:environment(s,true)})]);
 const ready=await waitActive(T.name);const v=aws(['lambda','publish-version','--function-name',T.name,
  '--code-sha256',ready.CodeSha256,'--revision-id',ready.RevisionId]);
 fixed(/^[1-9][0-9]*$/.test(v.Version));s.version=v.Version;save(path,s);putDeny(T.name,[OPERATOR],v.Version);
 fixed(!aws(['lambda','list-function-url-configs','--function-name',T.name]).FunctionUrlConfigs.length &&
  !aws(['lambda','list-event-source-mappings','--function-name',T.name]).EventSourceMappings.length);
 s.status='READY_FOR_SINGLE_TARGET';save(path,s);
}
export async function invoke(path,s,subject){
 caller();fixed(s.status==='READY_FOR_SINGLE_TARGET' && s.invocations<3 && Date.parse(s.expiresAt)>Date.now() &&
  bindTarget(subject,s.salt)===s.targetDigest,'DIAG_INVOCATION_DENIED');
 fixed(endpointWaitMs(s,Date.now())===0,'DIAG_ENDPOINT_NOT_READY');
 configuration(s);s.invocations++;save(path,s);
 const lambda=new LambdaClient({region:T.region,credentials:sdkCredentials(),maxAttempts:1,
  requestHandler:{connectionTimeout:1000,requestTimeout:12000,throwOnRequestTimeout:true}});
 const r=await lambda.send(new InvokeCommand({FunctionName:FUNCTION_ARN+':'+s.version,InvocationType:'RequestResponse',LogType:'None',
  Payload:Buffer.from(JSON.stringify({contract:T.contract,runId:s.runId,studentId:subject}))}),{abortSignal:AbortSignal.timeout(14000)});
 fixed(r.StatusCode===200 && !r.FunctionError && r.ExecutedVersion===s.version && r.Payload?.byteLength<8192,'DIAG_INVOCATION_FAILED');
 const value=safeResult(JSON.parse(Buffer.from(r.Payload).toString('utf8')));s.result=value;save(path,s);return value;
}
export function cleanup(path,s,{baselineCheck=applicationBaseline}={}){
 caller();const failures=[];
 const attempt=(part,fn)=>{try{fn();}catch{failures.push(part);}};
 attempt('function',()=>{
  if(!absent(['lambda','get-function-configuration','--function-name',T.name])){
   configuration(s);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);
   aws(['lambda','delete-function','--function-name',T.name]);s.owned.function=false;save(path,s);
  }
 });
 attempt('endpoint',()=>{const before=endpoint();
  if(before.Statement.some(x=>x.Sid===T.sid)){
   if(!absent(['iam','get-role','--role-name',T.role])){
    const r=aws(['iam','get-role','--role-name',T.role]).Role;owned(Object.fromEntries(r.Tags.map(t=>[t.Key,t.Value])),s);
    fixed(!s.roleId || s.roleId===r.RoleId);
   }else fixed(s.owned.endpoint===true && s.roleId,'DIAG_ENDPOINT_OWNERSHIP');
  }
  const after=removeStatement(before,endpointGrant());
  if(hash(before)!==hash(after))setEndpoint(before,after);s.owned.endpoint=false;save(path,s);});
 attempt('role',()=>{
  fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn(T.role)));
  if(!absent(['iam','get-role','--role-name',T.role])){
   const role=aws(['iam','get-role','--role-name',T.role]).Role;owned(Object.fromEntries(role.Tags.map(t=>[t.Key,t.Value])),s);
   fixed(!s.roleId || s.roleId===role.RoleId);
   fixed(!aws(['iam','list-attached-role-policies','--role-name',T.role]).AttachedPolicies.length);
   const names=aws(['iam','list-role-policies','--role-name',T.role]).PolicyNames;fixed(names.every(n=>n===policyName));
   for(const name of names){
    const p=aws(['iam','get-role-policy','--role-name',T.role,'--policy-name',name]).PolicyDocument;
    fixed(invocationPolicyHash(p)===invocationPolicyHash(executionPolicy()),'DIAG_ROLE_POLICY_DRIFT');
    aws(['iam','delete-role-policy','--role-name',T.role,'--policy-name',name]);
   }
   aws(['iam','delete-role','--role-name',T.role]);s.owned.role=false;save(path,s);
  }
 });
 attempt('logs',()=>{
  if(aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group)){
   owned(aws(['logs','list-tags-log-group','--log-group-name',group]).tags,s);
   aws(['logs','delete-log-group','--log-group-name',group]);s.owned.logs=false;save(path,s);
  }
 });
 attempt('baselines',()=>{
  fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]));
  fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group));
  fixed(hash(baselineCheck())===hash(s.baseline),'DIAG_APPLICATION_DRIFT');
  fixed(hash(endpoint())===hash(s.endpointBefore),'DIAG_ENDPOINT_DRIFT');
 });
 s.cleanup={verified:failures.length===0,failedParts:failures,at:new Date().toISOString()};
 s.status=failures.length?'CLEANUP_REVIEW_REQUIRED':'CLEANED_UP';save(path,s);return s.cleanup;
}
async function hiddenTarget(){
 if(!process.stdin.isTTY)throw Error('INTERACTIVE_TTY_REQUIRED');
 const muted=new Writable({write(_chunk,_enc,done){done();}}),rl=createInterface({input:process.stdin,output:muted,terminal:true});
 process.stdout.write('Student ID (hidden; no password): ');
 try{const subject=(await rl.question('')).trim();fixed(/^\d{10}$/.test(subject),'DIAG_TARGET_INVALID');return subject;}
 finally{rl.close();process.stdout.write('\n');}
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===1 && args[0]==='preflight'){preflight();console.log(JSON.stringify({status:'READONLY_PREFLIGHT_PASSED',awsMutated:false}));return;}
 if(args.length===3 && args[0]==='cleanup' && args[2]==='--approved-n0-n5'){
  const s=load(args[1]);const result=cleanup(args[1],s);console.log(JSON.stringify({status:s.status,state:args[1],...result}));
  if(!result.verified)process.exitCode=1;return;
 }
 fixed(args.length===2 && args[0]==='run' && args[1]==='--approved-n0-n5','DIAG_NO_TARGET_OR_CREDENTIAL_ARGUMENTS');
 const subject=await hiddenTarget();let interrupted=false;
 const onInterrupt=()=>{interrupted=true;};process.once('SIGINT',onInterrupt);
 const p=loadParent(parentPath);fixed(p.loginSecret===T.secret);
 fixed(hash(readFileSync(p.artifacts.issuer.file))===p.artifacts.issuer.sha256);
 const ca=publicCa(readZipEntry(p.artifacts.issuer.file,'global-bundle.pem'));
 const {path,state:s}=await packageDiagnostic(ca);s.salt=randomBytes(32).toString('hex');s.targetDigest=bindTarget(subject,s.salt);save(path,s);
 // No raw target, password, token or Secret value is persisted or passed to CLI.
 console.log(JSON.stringify({status:'PREPARING_READONLY_DIAGNOSTIC',state:path}));
 let value,error;
 try{fixed(!interrupted,'DIAG_INTERRUPTED');await deploy(path,s);fixed(!interrupted,'DIAG_INTERRUPTED');
  console.log(JSON.stringify({status:'PRIVATE_DIAGNOSTIC_READY',version:s.version}));
  await waitForEndpointPropagation(s,{interrupted:()=>interrupted});value=await invoke(path,s,subject);}
 catch(e){error=safeFailure(e);}
 finally{
  if(s.creationStarted){
   console.log(JSON.stringify({status:'CLEANING_UP_TEMPORARY_CAPABILITIES'}));
   try{cleanup(path,s);}catch{s.status='CLEANUP_REVIEW_REQUIRED';save(path,s);}
  }else{s.cleanup={verified:true,noAwsResourcesCreated:true,at:new Date().toISOString()};s.status='NO_AWS_RESOURCES_CREATED';save(path,s);}
  process.removeListener('SIGINT',onInterrupt);
 }
 const clean=s.cleanup?.verified===true;
 console.log(JSON.stringify({status:clean?(value?.ok?'IDENTITY_DIAGNOSTIC_COMPLETE':'IDENTITY_DIAGNOSTIC_FAILED'):'CLEANUP_REVIEW_REQUIRED',
  ...(value?{result:value}:{}),...(error?{error}:{}),cleanupVerified:clean,state:path,noDatabaseWrites:true},null,2));
 if(!clean || !value?.ok)process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
 console.error(JSON.stringify(safeFailure(e)));process.exitCode=1;
});
