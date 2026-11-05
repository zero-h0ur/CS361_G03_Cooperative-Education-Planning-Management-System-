// C7 inventory gate only; no SQL Apply, metadata publication or main deployment.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import reader from './reader.js';
import {publicCa} from '../../package-tu-auth.mjs';
import {createZip,listZipEntries} from '../zip-archive.mjs';
import {baseline,waitForPropagation} from '../intake-readiness/operator.mjs';
import {ROOT,OPERATOR,aws,caller,fixed,hash,cleanSource,statePath,save,load,arn,roleArn,tags,tagList,owned,absent,
 endpoint,addStatement,removeStatement,setEndpoint,eniPolicy,putDeny,waitActive,delay,sdkCredentials,invocationPolicyHash,safeFailure} from '../tu-production/common.mjs';
const {T,ARN}=reader,GROUP='/aws/lambda/'+T.name,POLICY='CoedIntakeControlsInventoryOnly';
export const statement=()=>({Sid:'CoedIntakeControlsOwnerInventory',Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:T.secret,
 Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(T.role)}}});
export const policy=()=>({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.secret},
 {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${T.account}:log-group:${GROUP}:*`},...eniPolicy(T.name)]});
function bindings(){const result={STUDENT_NUMBER:process.env.COED_C7_STUDENT_NUMBER,COORDINATOR_SUBJECT:process.env.COED_C7_COORDINATOR_SUBJECT};
 fixed(/^\d{10}$/.test(result.STUDENT_NUMBER || '') && /^[a-f0-9-]{36}$/.test(result.COORDINATOR_SUBJECT || ''),'C7_EXACT_IDENTITIES_REQUIRED');return result;}
export const environment=(s,enabled)=>{
 if(s.task==='intake-controls-upgrade')return {NODE_ENV:'production',ENABLED:String(enabled),RUN_ID:s.runId,EXPIRES_AT:s.expiresAt,
  MANIFEST_SHA256:s.manifestSha256,TRIAL_PASSED:String(s.trialPassed===true),EXPECTED_POST_HASH:s.postCatalogHash || ''};
 const b=bindings();fixed(hash(b)===s.bindingsHash);return {NODE_ENV:'production',ENABLED:String(enabled),RUN_ID:s.runId,EXPIRES_AT:s.expiresAt,...b};};
export function config(s){const f=aws(['lambda','get-function','--function-name',T.name]);owned(f.Tags,s);
 const upgrade=s.task==='intake-controls-upgrade';
 fixed(f.Configuration.Role===roleArn(T.role) && f.Configuration.Handler===(upgrade?'scripts/operations/intake-controls-owner/upgrade-handler.handler':'reader.handler') && f.Configuration.Runtime==='nodejs22.x' &&
  f.Configuration.CodeSha256===Buffer.from(s.sha256,'hex').toString('base64') && f.Configuration.Timeout===(upgrade?90:60) && f.Configuration.MemorySize===256 &&
  hash(f.Configuration.VpcConfig?.SubnetIds)===hash([T.subnet]) && hash(f.Configuration.VpcConfig?.SecurityGroupIds)===hash([T.sg]) &&
  s.environmentHashes?.includes(hash(f.Configuration.Environment?.Variables)),'C7_TEMP_CONFIG_DRIFT');return f.Configuration;}
export async function packageInventory(ca){
 publicCa(ca);const source=cleanSource();fixed(!source.dirty,'C7_COMMIT_REQUIRED');
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'production-')),stage=join(dir,'c7-inventory');mkdirSync(stage);
 const result=await build({absWorkingDir:ROOT,entryPoints:['scripts/operations/intake-controls-owner/reader.js'],outfile:join(stage,'reader.js'),bundle:true,platform:'node',target:'node22',format:'cjs',
  external:['pg-native'],metafile:true,sourcemap:false,legalComments:'none',logLevel:'warning'});
 fixed(hash(Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('node_modules/')).sort())===hash(['scripts/operations/intake-controls-owner/reader.js','scripts/operations/tu-preflight/catalog.js']),'C7_DEPENDENCY_DRIFT');
 writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});const zip=join(dir,'c7-inventory.zip');createZip(stage,zip,['reader.js','global-bundle.pem']);
 fixed(hash(listZipEntries(zip).sort())===hash(['global-bundle.pem','reader.js']));fixed(hash(cleanSource())===hash(source));
 const s={format:'coed-tu-production-v1',task:'intake-controls-inventory',account:T.account,runId:randomBytes(16).toString('hex'),source,zip,sha256:hash(readFileSync(zip)),bindingsHash:hash(bindings()),status:'LOCAL_ONLY',owned:{}};
 const path=join(dir,'state.json');writeFileSync(path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return {path,state:s};
}
export async function prepare(path,s,{check=()=>{}}={}){
 caller();fixed(s.status==='LOCAL_ONLY' && hash(cleanSource())===hash(s.source) && hash(readFileSync(s.zip))===s.sha256,'C7_SOURCE_DRIFT');
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]),'C7_RESOURCE_COLLISION');
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',GROUP]).logGroups.some(g=>g.logGroupName===GROUP),'C7_RESOURCE_COLLISION');
 const secret=aws(['secretsmanager','describe-secret','--secret-id',T.secret]);fixed(secret.ARN===T.secret && !secret.DeletedDate);
 s.baseline=baseline();s.endpointBefore=endpoint();fixed(!s.endpointBefore.Statement.some(x=>x.Sid===statement().Sid));s.expiresAt=new Date(Date.now()+3600000).toISOString();
 s.environmentHashes=[hash(environment(s,false)),hash(environment(s,true))];check();s.creationStarted=true;save(path,s);
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
 const role=aws(['iam','create-role','--role-name',T.role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;s.roleId=role.RoleId;s.owned.role=true;save(path,s);
 aws(['iam','put-role-policy','--role-name',T.role,'--policy-name',POLICY,'--policy-document',JSON.stringify(policy())]);
 aws(['logs','create-log-group','--log-group-name',GROUP,'--tags',JSON.stringify(tags(s))]);s.owned.logs=true;save(path,s);aws(['logs','put-retention-policy','--log-group-name',GROUP,'--retention-in-days','3']);
 s.endpointStatement=statement();save(path,s);setEndpoint(s.endpointBefore,addStatement(s.endpointBefore,s.endpointStatement));s.owned.endpoint=true;save(path,s);
 for(let i=0;i<8;i++)try{check();aws(['lambda','create-function','--function-name',T.name,'--runtime','nodejs22.x','--role',roleArn(T.role),
  '--handler',s.task==='intake-controls-upgrade'?'scripts/operations/intake-controls-owner/upgrade-handler.handler':'reader.handler','--timeout',s.task==='intake-controls-upgrade'?'90':'60','--memory-size','256',
  '--zip-file','fileb://'+s.zip,'--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),'--environment',JSON.stringify({Variables:environment(s,false)}),'--tags',JSON.stringify(tags(s))]);s.owned.function=true;save(path,s);break;
 }catch(e){if(!e.rolePropagation || i===7)throw e;await delay(2000);}
 putDeny(T.name,[OPERATOR]);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);await waitActive(T.name);const c=config(s);
 check();aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',c.RevisionId,'--environment',JSON.stringify({Variables:environment(s,true)})]);
 const ready=await waitActive(T.name),version=aws(['lambda','publish-version','--function-name',T.name,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;s.version=version;save(path,s);putDeny(T.name,[OPERATOR],version);
 fixed(!aws(['lambda','list-function-url-configs','--function-name',T.name]).FunctionUrlConfigs.length && !aws(['lambda','list-event-source-mappings','--function-name',T.name]).EventSourceMappings.length);
 await waitForPropagation({check});s.status='INVENTORY_READY';save(path,s);
}
export function cleanup(path,s){
 caller();fixed(['intake-controls-inventory','intake-controls-upgrade'].includes(s.task));const failed=[];const attempt=(part,fn)=>{try{fn();}catch{failed.push(part);}};
 attempt('function',()=>{if(!absent(['lambda','get-function-configuration','--function-name',T.name])){config(s);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);aws(['lambda','delete-function','--function-name',T.name]);}});
 attempt('endpoint',()=>{const before=endpoint();if(before.Statement.some(x=>x.Sid===s.endpointStatement?.Sid))setEndpoint(before,removeStatement(before,s.endpointStatement));});
 attempt('role',()=>{if(!absent(['iam','get-role','--role-name',T.role])){const role=aws(['iam','get-role','--role-name',T.role]).Role;owned(Object.fromEntries(role.Tags.map(t=>[t.Key,t.Value])),s);fixed(role.RoleId===s.roleId);
  fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn(T.role)) && !aws(['iam','list-attached-role-policies','--role-name',T.role]).AttachedPolicies.length);
  for(const name of aws(['iam','list-role-policies','--role-name',T.role]).PolicyNames){fixed(name===POLICY);fixed(invocationPolicyHash(aws(['iam','get-role-policy','--role-name',T.role,'--policy-name',name]).PolicyDocument)===invocationPolicyHash(policy()));aws(['iam','delete-role-policy','--role-name',T.role,'--policy-name',name]);}aws(['iam','delete-role','--role-name',T.role]);}});
 attempt('logs',()=>{if(aws(['logs','describe-log-groups','--log-group-name-prefix',GROUP]).logGroups.some(g=>g.logGroupName===GROUP)){owned(aws(['logs','list-tags-log-group','--log-group-name',GROUP]).tags,s);aws(['logs','delete-log-group','--log-group-name',GROUP]);}});
 attempt('verification',()=>{fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]));
  fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',GROUP]).logGroups.some(g=>g.logGroupName===GROUP));fixed(hash(endpoint())===hash(s.endpointBefore));fixed(hash(baseline())===hash(s.baseline),'C7_STANDING_DRIFT');});
 s.cleanup={verified:!failed.length,failedParts:failed};s.status=failed.length?'CLEANUP_REVIEW_REQUIRED':'CLEANED_UP';save(path,s);return s.cleanup;
}
export async function run(ca){const {path,state:s}=await packageInventory(ca);console.log(JSON.stringify({status:'C7_INVENTORY_PREPARING',state:path}));
 let interrupted=false;const interrupt=()=>{interrupted=true;},check=()=>fixed(!interrupted,'C7_INTERRUPTED');process.once('SIGINT',interrupt);
 try{await prepare(path,s,{check});check();const client=new LambdaClient({region:T.region,credentials:sdkCredentials(),maxAttempts:1});
  try{const result=await client.send(new InvokeCommand({FunctionName:ARN,Qualifier:s.version,InvocationType:'RequestResponse',LogType:'None',Payload:Buffer.from(JSON.stringify({contract:T.contract,runId:s.runId}))}),{abortSignal:AbortSignal.timeout(65000)});
   fixed(result.StatusCode===200 && !result.FunctionError && result.ExecutedVersion===s.version && result.Payload.byteLength<1100000);
   s.result=JSON.parse(Buffer.from(result.Payload).toString());fixed(s.result.contract===T.contract);save(path,s);
  }finally{client.destroy();}
 }catch(e){s.failure=safeFailure(e);save(path,s);}
 finally{try{if(s.creationStarted){console.log(JSON.stringify({status:'C7_INVENTORY_CLEANING'}));cleanup(path,s);}else{s.cleanup={verified:true,noResourcesCreated:true};save(path,s);}}
  finally{process.removeListener('SIGINT',interrupt);}}
 console.log(JSON.stringify({status:s.result?.ok&&s.cleanup?.verified?'C7_INVENTORY_COMPLETE':'C7_INVENTORY_STOPPED',code:s.result?.code,error:s.failure,cleanupVerified:s.cleanup?.verified,state:path,noDatabaseWrites:true}));
 if(!s.result?.ok || !s.cleanup?.verified)process.exitCode=1;return {path,state:s};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,path,flag]=process.argv.slice(2);fixed(flag==='--approved-c7','C7_APPROVAL_REQUIRED');
 if(mode==='run')await run(readFileSync(resolve(path)));else if(mode==='cleanup'){const s=load(path);console.log(JSON.stringify(cleanup(statePath(path),s)));}else fixed(false,'C7_INVENTORY_ONLY');
}
