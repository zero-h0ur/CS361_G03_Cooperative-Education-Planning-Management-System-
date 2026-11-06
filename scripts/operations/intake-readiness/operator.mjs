// Approved A0 only. No migration, account write or application deployment mode.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import reader from './reader.js';
import {createZip,listZipEntries} from '../zip-archive.mjs';
import {publicCa} from '../../package-tu-auth.mjs';
import {aws,ROOT,OPERATOR,API,caller,fixed,hash,statePath,cleanSource,arn,roleArn,absent,
 endpoint,addStatement,removeStatement,setEndpoint,eniPolicy,putDeny,waitActive,safeConfig,
 sdkCredentials,delay,invocationPolicyHash,safeFailure} from '../tu-production/common.mjs';
const {T,ARN}=reader,group='/aws/lambda/'+T.name,policyName='CoedIntakeReadonlyOnly';
const tags=s=>({coedTask:T.tag,runId:s.runId});
const tagList=s=>Object.entries(tags(s)).map(([Key,Value])=>({Key,Value}));
const save=(p,s)=>writeFileSync(statePath(p),JSON.stringify(s,null,2)+'\n');
function load(p){const s=JSON.parse(readFileSync(statePath(p),'utf8'));fixed(s.format===T.contract && s.account===T.account && /^[a-f0-9]{32}$/.test(s.runId));return s;}
function owned(actual,s){fixed(actual?.coedTask===T.tag && actual.runId===s.runId,'INTAKE_DIAG_RESOURCE_OWNERSHIP');}
export const endpointGrant=()=>({Sid:T.sid,Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:T.secret,
 Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(T.role)}}});
export const executionPolicy=()=>({Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.secret},
 {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${T.account}:log-group:${group}:*`},...eniPolicy(T.name)]});
export function baseline(){
 const functions=[];
 for(const [name,version] of [['coed-api','4'],['coed-tu-auth','5'],['coed-tu-session-issuer','4']]){
  const live=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier','live']);
  fixed(live.Version===version,'INTAKE_DIAG_LIVE_VERSION_DRIFT');
  if(name==='coed-api')fixed(live.CodeSha256==='TSumC2dRMnoJQWqKVQmhW4Oua1hwWt2FyZ5iJbk50QA=' && live.Environment?.Variables?.COED_API_MAINTENANCE==='browse','INTAKE_DIAG_NOT_BROWSE_BASELINE');
  const latest=aws(['lambda','get-function-configuration','--function-name',name]);
  functions.push({live:safeConfig(live),liveEnvironmentHash:hash(live.Environment?.Variables),
   latest:safeConfig(latest),latestEnvironmentHash:hash(latest.Environment?.Variables),
   alias:aws(['lambda','get-alias','--function-name',name,'--name','live'])});
 }
 return {functions,routes:aws(['apigatewayv2','get-routes','--api-id',API]).Items,
  integrations:aws(['apigatewayv2','get-integrations','--api-id',API]).Items,
  cors:aws(['apigatewayv2','get-api','--api-id',API]).CorsConfiguration};
}
export async function packageDiagnostic(ca){
 publicCa(ca);const source=cleanSource();fixed(!source.dirty,'INTAKE_DIAG_COMMIT_REQUIRED');
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'production-')),stage=join(dir,'intake-stage');mkdirSync(stage);
 const built=await build({absWorkingDir:ROOT,entryPoints:['scripts/operations/intake-readiness/reader.js'],outfile:join(stage,'reader.cjs'),
  bundle:true,platform:'node',target:'node22',format:'cjs',external:['pg-native'],metafile:true,sourcemap:false,legalComments:'none',logLevel:'warning'});
 const inputs=Object.keys(built.metafile.inputs).filter(p=>!p.startsWith('node_modules/')).sort();
 fixed(hash(inputs)===hash(['scripts/operations/intake-readiness/reader.js','scripts/operations/tu-preflight/catalog.js','src/db/rds-secret.js']),'INTAKE_DIAG_DEPENDENCY_DRIFT');
 writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});
 const zip=join(dir,'diagnostic.zip');createZip(stage,zip,['reader.cjs','global-bundle.pem']);
 fixed(hash(listZipEntries(zip).sort())===hash(['global-bundle.pem','reader.cjs']));fixed(hash(cleanSource())===hash(source));
 const s={format:T.contract,account:T.account,runId:randomBytes(16).toString('hex'),source,zip,zipSha256:hash(readFileSync(zip)),status:'LOCAL_ONLY',creationStarted:false};
 const path=join(dir,'state.json');writeFileSync(path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return {path,state:s};
}
function config(s){
 const f=aws(['lambda','get-function','--function-name',T.name]);owned(f.Tags,s);
 fixed(f.Configuration.Role===roleArn(T.role) && f.Configuration.Handler==='reader.handler' &&
  f.Configuration.CodeSha256===Buffer.from(s.zipSha256,'hex').toString('base64') && f.Configuration.Runtime==='nodejs22.x' &&
  f.Configuration.Timeout===28 && f.Configuration.MemorySize===256 &&
  hash(f.Configuration.VpcConfig?.SubnetIds)===hash([T.subnet]) && hash(f.Configuration.VpcConfig?.SecurityGroupIds)===hash([T.sg]) &&
  [hash(environment(s,false)),hash(environment(s,true))].includes(hash(f.Configuration.Environment?.Variables)),'INTAKE_DIAG_CODE_DRIFT');return f.Configuration;
}
const environment=(s,enabled)=>({NODE_ENV:'production',INTAKE_ENABLED:String(enabled),INTAKE_RUN_ID:s.runId,INTAKE_EXPIRES_AT:s.expiresAt});
export async function waitForPropagation({wait=delay,check=()=>{},progress=console.log}={}){
 for(let left=300;left>0;left-=30){check();progress(JSON.stringify({status:'WAITING_ENDPOINT_PROPAGATION',remainingSeconds:left}));await wait(30000);}check();
}
export async function deploy(path,s,{check=()=>{}}={}){
 caller();fixed(s.status==='LOCAL_ONLY' && hash(cleanSource())===hash(s.source) && !cleanSource().dirty,'INTAKE_DIAG_SOURCE_DRIFT');
 fixed(hash(readFileSync(s.zip))===s.zipSha256,'INTAKE_DIAG_ARCHIVE_DRIFT');
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]),'INTAKE_DIAG_NAME_COLLISION');
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group),'INTAKE_DIAG_LOG_COLLISION');
 s.baseline=baseline();s.endpointBefore=endpoint();fixed(!s.endpointBefore.Statement.some(x=>x.Sid===T.sid),'INTAKE_DIAG_ENDPOINT_COLLISION');
 const secret=aws(['secretsmanager','describe-secret','--secret-id',T.secret]);fixed(secret.ARN===T.secret && secret.Name==='coed/v4/postgres/app' && !secret.DeletedDate);
 check();s.expiresAt=new Date(Date.now()+3600000).toISOString();s.creationStarted=true;save(path,s);
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
 const role=aws(['iam','create-role','--role-name',T.role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;
 s.roleId=role.RoleId;save(path,s);
 aws(['iam','put-role-policy','--role-name',T.role,'--policy-name',policyName,'--policy-document',JSON.stringify(executionPolicy())]);
 aws(['logs','create-log-group','--log-group-name',group,'--tags',JSON.stringify(tags(s))]);
 aws(['logs','put-retention-policy','--log-group-name',group,'--retention-in-days','1']);
 setEndpoint(s.endpointBefore,addStatement(s.endpointBefore,endpointGrant()));s.endpointGranted=true;save(path,s);
 for(let i=0;i<8;i++){
  try{aws(['lambda','create-function','--function-name',T.name,'--runtime','nodejs22.x','--role',roleArn(T.role),'--handler','reader.handler',
   '--timeout','28','--memory-size','256','--zip-file','fileb://'+s.zip,'--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),
   '--environment',JSON.stringify({Variables:environment(s,false)}),'--tags',JSON.stringify(tags(s))]);break;}
  catch(e){if(!e.rolePropagation || i===7)throw e;await delay(2000);}
 }
 aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);
 putDeny(T.name,[OPERATOR]);await waitActive(T.name);const c=config(s);
 aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',c.RevisionId,'--environment',JSON.stringify({Variables:environment(s,true)})]);
 const ready=await waitActive(T.name),v=aws(['lambda','publish-version','--function-name',T.name,'--code-sha256',ready.CodeSha256,'--revision-id',ready.RevisionId]);
 s.version=v.Version;save(path,s);putDeny(T.name,[OPERATOR],s.version);
 fixed(!aws(['lambda','list-function-url-configs','--function-name',T.name]).FunctionUrlConfigs.length &&
  !aws(['lambda','list-event-source-mappings','--function-name',T.name]).EventSourceMappings.length);
 // Endpoint updates may take minutes. Yield progress rather than replaying policy writes.
 await waitForPropagation({check});
 s.status='READY';save(path,s);
}
export function cleanup(path,s){
 caller();const failed=[];const attempt=(key,fn)=>{try{fn();}catch{failed.push(key);}};
 attempt('function',()=>{if(!absent(['lambda','get-function-configuration','--function-name',T.name])){
  config(s);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);
  aws(['lambda','delete-function','--function-name',T.name]);}});
 attempt('endpoint',()=>{const before=endpoint();if(before.Statement.some(x=>x.Sid===T.sid)){
  fixed(s.endpointGranted || s.creationStarted);setEndpoint(before,removeStatement(before,endpointGrant()));}});
 attempt('role',()=>{fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn(T.role)));
  if(!absent(['iam','get-role','--role-name',T.role])){
   const r=aws(['iam','get-role','--role-name',T.role]).Role;owned(Object.fromEntries(r.Tags.map(t=>[t.Key,t.Value])),s);fixed(!s.roleId || s.roleId===r.RoleId);
   fixed(!aws(['iam','list-attached-role-policies','--role-name',T.role]).AttachedPolicies.length);
   for(const name of aws(['iam','list-role-policies','--role-name',T.role]).PolicyNames){fixed(name===policyName);
    fixed(invocationPolicyHash(aws(['iam','get-role-policy','--role-name',T.role,'--policy-name',name]).PolicyDocument)===invocationPolicyHash(executionPolicy()));
    aws(['iam','delete-role-policy','--role-name',T.role,'--policy-name',name]);}
   aws(['iam','delete-role','--role-name',T.role]);}});
 attempt('logs',()=>{if(aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group)){
  owned(aws(['logs','list-tags-log-group','--log-group-name',group]).tags,s);aws(['logs','delete-log-group','--log-group-name',group]);}});
 attempt('verification',()=>{fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]));
  fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group));
  fixed(hash(endpoint())===hash(s.endpointBefore));fixed(hash(baseline())===hash(s.baseline),'INTAKE_DIAG_APPLICATION_DRIFT');});
 s.cleanup={verified:!failed.length,failedParts:failed};s.status=failed.length?'CLEANUP_REVIEW_REQUIRED':'CLEANED_UP';save(path,s);return s.cleanup;
}
export async function run(ca){
 const {path,state:s}=await packageDiagnostic(ca);console.log(JSON.stringify({status:'PREPARING_INTAKE_READONLY',state:path}));let failure,interrupted=false;
 const interrupt=()=>{interrupted=true;},check=()=>fixed(!interrupted,'INTAKE_DIAG_INTERRUPTED');process.once('SIGINT',interrupt);
 try{await deploy(path,s,{check});check();const client=new LambdaClient({region:T.region,credentials:sdkCredentials(),maxAttempts:1});
  try{const r=await client.send(new InvokeCommand({FunctionName:ARN,Qualifier:s.version,InvocationType:'RequestResponse',LogType:'None',
   Payload:Buffer.from(JSON.stringify({contract:T.contract,runId:s.runId}))}),{abortSignal:AbortSignal.timeout(31000)});
   fixed(r.StatusCode===200 && !r.FunctionError && r.ExecutedVersion===s.version && r.Payload?.byteLength<1100000);
   const value=JSON.parse(Buffer.from(r.Payload).toString());fixed(value.contract===T.contract && typeof value.ok==='boolean');s.result=value;save(path,s);
  }finally{client.destroy();}
 }catch(e){failure=safeFailure(e);}
 finally{if(s.creationStarted){console.log(JSON.stringify({status:'CLEANING_UP_INTAKE_DIAGNOSTIC'}));try{cleanup(path,s);}catch{s.cleanup={verified:false};save(path,s);}}
  else{s.cleanup={verified:true,noAwsResourcesCreated:true};save(path,s);}process.removeListener('SIGINT',interrupt);}
 console.log(JSON.stringify({status:s.result?.ok && s.cleanup?.verified?'INTAKE_READONLY_COMPLETE':'INTAKE_READONLY_STOPPED',
  code:s.result?.code,...(failure?{error:failure}:{}),cleanupVerified:s.cleanup?.verified===true,state:path,noDatabaseWrites:true}));
 if(!s.result?.ok || !s.cleanup?.verified)process.exitCode=1;return {path,state:s};
}
async function main(){const args=process.argv.slice(2);
 if(args.length===3 && args[0]==='run' && args[2]==='--approved-a0'){await run(readFileSync(resolve(args[1])));return;}
 if(args.length===3 && args[0]==='cleanup' && args[2]==='--approved-a0'){const s=load(args[1]);const result=cleanup(args[1],s);console.log(JSON.stringify(result));if(!result.verified)process.exitCode=1;return;}
 throw Error('USE_RUN_CA_PATH_OR_CLEANUP_STATE_WITH_APPROVED_A0');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify(safeFailure(e)));process.exitCode=1;});
