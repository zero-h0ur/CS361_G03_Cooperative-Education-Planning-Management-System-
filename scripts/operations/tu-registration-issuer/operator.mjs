// O8 controller: fixed migration only, checkpointed temporary resources, no secrets locally.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,existsSync,lstatSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {T} from './handler.mjs';
import {readIssuerSql,SQL_SHA256,ISSUER} from '../tu-registration-issuer-upgrade.mjs';
import {publicKeyFingerprint} from '../tu-registration/environment.mjs';
import {publicCa} from '../../package-tu-auth.mjs';
import {createZip} from '../zip-archive.mjs';
import {ROOT,A,OPERATOR,aws,caller,fixed,hash,cleanSource,save,load,arn,roleArn,tagList,tags,owned,absent,
 eniPolicy,putDeny,waitActive,delay,endpoint,addStatement,removeStatement,setEndpoint,safeFailure} from '../tu-production/common.mjs';
const GROUP='/aws/lambda/'+T.name,POLICY='CoedIssuer020OwnerOnly';
const BASE={
 'coed-api':{version:'3',hash:'YLQR2Ao0Gy3sogh/uOup2YhrOrT1YR5yAz5JJtavMwI='},
 'coed-tu-auth':{version:'5',hash:'eLlO9pTy9BtgKvuXRV1tFZ711jg620RuXQaavo7USjE='},
 'coed-tu-session-issuer':{version:'4',hash:'QlOfuYdpBjVhuOEIpQYeXZljVSfjH7HQwF590fvuV28='}
};
const FILES=['scripts/operations/tu-registration-issuer-upgrade.mjs','scripts/operations/tu-registration-upgrade.mjs',
 'scripts/operations/present-schema-upgrade.mjs','scripts/operations/present-schema-baseline.mjs','scripts/operations/tu-preflight/catalog.js',
 'scripts/operations/baselines/coed-present-20261104.json','src/db/upgrades/019_tu_student_registration.sql','src/db/upgrades/020_tu_registration_issuer_alignment.sql'];
const report=s=>({status:s.status,state:s.path,cleanupVerified:s.cleanupVerified===true,...(s.result?{result:s.result}:{}),noAccountCreatedByOperator:true});
function sourceGuard(s){const c=cleanSource();fixed(s.task==='registration020'&&!c.dirty&&s.source.head===c.head,'COMMITTED_SOURCE_CHANGED');}
export function liveSnapshot(){
 const result={};let client;
 for(const [name,b] of Object.entries(BASE)){
  const c=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier','live']),v=c.Environment?.Variables||{};
  const a=aws(['lambda','get-alias','--function-name',name,'--name','live']);
  fixed(c.Version===b.version&&c.CodeSha256===b.hash&&c.State==='Active'&&c.LastUpdateStatus==='Successful'&&a.FunctionVersion===b.version,'LIVE_RELEASE_DRIFT');
  fixed(!Object.keys(a.RoutingConfig?.AdditionalVersionWeights||{}).length&&v.TU_AUTH_ISSUER===ISSUER&&v.TU_ONBOARDING_ENABLED==='true','LIVE_AUTH_DRIFT');
  fixed(publicKeyFingerprint(v.TU_AUTH_PUBLIC_KEY)==='948706ef031812b73af8fdc7002a7ee06cfdbc89b431d1720526ae249abc3958','LIVE_PUBLIC_KEY_DRIFT');
  fixed(typeof v.TU_AUTH_CLIENT_ID==='string'&&v.TU_AUTH_CLIENT_ID.length>0&&(!client||client===v.TU_AUTH_CLIENT_ID),'LIVE_CLIENT_DRIFT');client=v.TU_AUTH_CLIENT_ID;
  if(name==='coed-api')fixed(v.COED_API_MAINTENANCE==='verify','MAINTENANCE_REQUIRED');
  result[name]={version:c.Version,codeHash:c.CodeSha256,configurationHash:hash({env:v,role:c.Role,vpc:c.VpcConfig,handler:c.Handler,runtime:c.Runtime,timeout:c.Timeout,memory:c.MemorySize}),aliasRevision:a.RevisionId};
 }
 return result;
}
function standingGuard(s){fixed(hash(liveSnapshot())===hash(s.liveBaseline),'STANDING_RESOURCE_DRIFT');}
export function executionPolicy(){return {Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.owner},
 {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${A}:log-group:${GROUP}:*`},...eniPolicy(T.name)]};}
export function endpointStatement(s){return {Sid:'CoedIssuer020OwnerRead'+s.runId.slice(0,8),Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:T.owner,Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(T.role)}}};}
function ownerEnv(s,enabled,trial=false){return {NODE_ENV:'production',ENABLED:String(enabled),MAINTENANCE_VERIFIED:'true',EXPECTED_ISSUER:ISSUER,RUN_ID:s.runId,EXPIRES_AT:s.expiresAt,TRIAL_PASSED:String(trial)};}
function ownerConfig(s){const f=aws(['lambda','get-function','--function-name',T.name]);owned(f.Tags,s);
 fixed(f.Configuration.Role===roleArn(T.role)&&f.Configuration.CodeSha256===Buffer.from(s.artifact.sha256,'hex').toString('base64'),'OWNER_ARTIFACT_DRIFT');return f.Configuration;}
export async function packageOwner(ca){
 publicCa(ca);readIssuerSql();const source=cleanSource();fixed(!source.dirty,'COMMITTED_SOURCE_REQUIRED');
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'production-')),stage=join(dir,'owner020');mkdirSync(stage);
 const entry='scripts/operations/tu-registration-issuer/handler.mjs',out=join(stage,entry);mkdirSync(dirname(out),{recursive:true});
 await build({absWorkingDir:ROOT,entryPoints:[entry],outfile:out,bundle:true,platform:'node',target:'node22',format:'esm',external:['pg-native','../tu-registration-issuer-upgrade.mjs'],
  banner:{js:"import {createRequire as cr} from 'node:module'; const require=cr(import.meta.url);"},logLevel:'warning',sourcemap:false});
 for(const file of FILES){const target=join(stage,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(ROOT,file),target);}
 writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});const file=join(dir,'issuer020-owner.zip');createZip(stage,file,[entry,'global-bundle.pem',...FILES]);
 const s={format:'coed-tu-production-v1',task:'registration020',account:A,runId:randomBytes(16).toString('hex'),source,status:'LOCAL_READY',owned:{},artifact:{file,sha256:hash(readFileSync(file))},sqlSha256:SQL_SHA256,invocations:0};
 s.path=join(dir,'state.json');writeFileSync(s.path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return report(s);
}
export async function prepare(s){
 caller();sourceGuard(s);fixed(s.status==='LOCAL_READY','PREPARE_ALREADY_STARTED');
 s.liveBaseline=liveSnapshot();s.expiresAt=new Date(Date.now()+3600000).toISOString();save(s.path,s);
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name])&&absent(['iam','get-role','--role-name',T.role]),'TEMPORARY_TARGET_EXISTS');
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',GROUP]).logGroups.some(g=>g.logGroupName===GROUP),'TEMPORARY_LOG_EXISTS');
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
 const r=aws(['iam','create-role','--role-name',T.role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;
 s.roleId=r.RoleId;s.owned.role=true;save(s.path,s);
 aws(['iam','put-role-policy','--role-name',T.role,'--policy-name',POLICY,'--policy-document',JSON.stringify(executionPolicy())]);
 aws(['logs','create-log-group','--log-group-name',GROUP,'--tags',JSON.stringify(tags(s))]);s.owned.logs=true;save(s.path,s);aws(['logs','put-retention-policy','--log-group-name',GROUP,'--retention-in-days','1']);
 s.endpointStatement=endpointStatement(s);save(s.path,s);const old=endpoint();setEndpoint(old,addStatement(old,s.endpointStatement));s.owned.endpoint=true;save(s.path,s);
 fixed(hash(readFileSync(s.artifact.file))===s.artifact.sha256,'PACKAGE_DRIFT');
 for(let i=0;i<8;i++)try{
  aws(['lambda','create-function','--function-name',T.name,'--runtime','nodejs22.x','--role',roleArn(T.role),'--handler','scripts/operations/tu-registration-issuer/handler.handler',
   '--timeout','90','--memory-size','256','--zip-file','fileb://'+s.artifact.file,'--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),
   '--environment',JSON.stringify({Variables:ownerEnv(s,false)}),'--tags',JSON.stringify(tags(s))]);s.owned.function=true;save(s.path,s);break;
 }catch(e){if(!e.rolePropagation||i===7)throw e;await delay(2000);}
 putDeny(T.name,[OPERATOR]);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);await waitActive(T.name);
 s.status='OWNER_PREPARED_DISABLED';save(s.path,s);return report(s);
}
export async function activate(s,apply=false){
 caller();sourceGuard(s);standingGuard(s);fixed(s.owned.function&&Date.parse(s.expiresAt)>Date.now(),'OWNER_NOT_READY');if(apply)fixed(s.trialPassed,'TRIAL_REQUIRED');
 const c=ownerConfig(s);aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',c.RevisionId,'--environment',JSON.stringify({Variables:ownerEnv(s,true,apply)})]);
 const ready=await waitActive(T.name),v=aws(['lambda','publish-version','--function-name',T.name,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;
 fixed(/^[1-9][0-9]*$/.test(v));putDeny(T.name,[OPERATOR],v);s.ownerVersion=v;s.applyEnabled=apply;s.status=apply?'OWNER_APPLY_ENABLED':'OWNER_TRIAL_ENABLED';save(s.path,s);return report(s);
}
export function invoke(s,mode){
 caller();sourceGuard(s);standingGuard(s);fixed(['inventory','trial','apply'].includes(mode)&&s.ownerVersion&&s.invocations<8&&Date.parse(s.expiresAt)>Date.now(),'OWNER_INVOCATION_GUARD');
 if(mode==='apply')fixed(s.trialPassed&&s.applyEnabled,'TRIAL_REQUIRED');ownerConfig(s);
 const file=join(dirname(s.path),'issuer020-result-'+(++s.invocations)+'.json');fixed(!existsSync(file));save(s.path,s);
 const response=aws(['lambda','invoke','--function-name',arn(T.name)+':'+s.ownerVersion,'--invocation-type','RequestResponse','--log-type','None','--cli-binary-format','raw-in-base64-out',
  '--payload',JSON.stringify({contract:T.contract,runId:s.runId,mode}),'--cli-read-timeout','110',file],{timeout:115000});
 fixed(response.StatusCode===200&&!response.FunctionError&&response.ExecutedVersion===s.ownerVersion&&lstatSync(file).size<16000,'OWNER_EXECUTION_FAILED');
 const result=JSON.parse(readFileSync(file,'utf8'));fixed(result.contract===T.contract);s.result=result;
 if(result.ok){if(mode==='trial'){fixed(result.result.preservationVerified);s.trialPassed=true;s.status='OWNER_TRIAL_PASSED';}
  if(mode==='apply'){fixed(result.result.applied||result.result.idempotentReplay);s.applied=true;s.status='SCHEMA020_APPLIED';}
  if(mode==='inventory')s.inventoryVerified=true;}
 save(s.path,s);return report(s);
}
export function cleanup(s){
 caller();fixed(s.task==='registration020','WRONG_CLEANUP_TASK');
 if(s.owned.function&&!absent(['lambda','get-function-configuration','--function-name',T.name])){ownerConfig(s);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);aws(['lambda','delete-function','--function-name',T.name]);s.owned.function=false;save(s.path,s);}
 if(s.endpointStatement){const before=endpoint(),after=removeStatement(before,s.endpointStatement);if(hash(before)!==hash(after))setEndpoint(before,after);s.owned.endpoint=false;save(s.path,s);}
 if(s.owned.role&&!absent(['iam','get-role','--role-name',T.role])){
  const r=aws(['iam','get-role','--role-name',T.role]).Role;owned(Object.fromEntries(r.Tags.map(t=>[t.Key,t.Value])),s);fixed(r.RoleId===s.roleId);
  fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn(T.role))&&!aws(['iam','list-attached-role-policies','--role-name',T.role]).AttachedPolicies.length);
  const policies=aws(['iam','list-role-policies','--role-name',T.role]).PolicyNames;fixed(policies.every(p=>p===POLICY));for(const p of policies)aws(['iam','delete-role-policy','--role-name',T.role,'--policy-name',p]);
  aws(['iam','delete-role','--role-name',T.role]);s.owned.role=false;save(s.path,s);
 }
 if(s.owned.logs){owned(aws(['logs','list-tags-log-group','--log-group-name',GROUP]).tags,s);aws(['logs','delete-log-group','--log-group-name',GROUP]);s.owned.logs=false;save(s.path,s);}
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name])&&absent(['iam','get-role','--role-name',T.role]));
 fixed(!endpoint().Statement.some(x=>x.Sid===s.endpointStatement?.Sid));standingGuard(s);s.cleanupVerified=true;s.status=s.applied?'SCHEMA020_APPLIED_CLEANUP_VERIFIED':'OWNER_CLEANUP_VERIFIED';save(s.path,s);return report(s);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [mode,path,flag]=process.argv.slice(2);fixed(flag==='--approved-o8','EXPLICIT_O8_APPROVAL_REQUIRED');let result;
  if(mode==='package')result=await packageOwner(readFileSync(process.env.COED_RDS_CA_FILE));
  else{const s=load(path);fixed(s.task==='registration020');if(mode==='prepare')result=await prepare(s);else if(mode==='trial-enable')result=await activate(s);
   else if(mode==='apply-enable')result=await activate(s,true);else if(['inventory','trial','apply'].includes(mode))result=invoke(s,mode);else if(mode==='cleanup')result=cleanup(s);else fixed(false,'UNKNOWN_OPERATION');}
  console.log(JSON.stringify(result));
 }catch(e){console.log(JSON.stringify(safeFailure(e)));process.exitCode=1;}
}
