// Approved O7 controller. Every mutation is checkpointed; no credential values
// are read by the operator or written to its state. Stop on drift, don't guess.
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync,existsSync,lstatSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {T} from './handler.mjs';
import {issuerRegistrationEnvironment} from './environment.mjs';
import {readRegistrationSql,SQL_SHA256} from '../tu-registration-upgrade.mjs';
import {packageTuAuth,publicCa} from '../../package-tu-auth.mjs';
import {archiveFiles,createZip} from '../zip-archive.mjs';
import {ROOT,A,REGION,API,OPERATOR,aws,caller,fixed,hash,cleanSource,save,load,arn,roleArn,
 tagList,tags,owned,absent,waitActive,delay,eniPolicy,putDeny,endpoint,addStatement,removeStatement,setEndpoint,safeFailure} from '../tu-production/common.mjs';
const GROUP='/aws/lambda/'+T.name,POLICY='CoedRegistration019OwnerOnly';
const BASE={
 'coed-api':{version:'2',hash:'wF0Pcn6UZnfZkPRdQHo6zATiOZe8BYP+THo4NDHNCTk='},
 'coed-tu-auth':{version:'4',hash:'Mdxx5SitHWDaFGx88NBedEmwJX4mRFdQPogY7S3Vnbs='},
 'coed-tu-session-issuer':{version:'2',hash:'iReyy/EQQitujAbFpTtA6nivvsqUS1EIAsr1Y7ILDBo='}
};
const OWNER_FILES=['scripts/operations/tu-registration-upgrade.mjs','scripts/operations/present-schema-upgrade.mjs',
 'scripts/operations/present-schema-baseline.mjs','scripts/operations/tu-preflight/catalog.js',
 'scripts/operations/baselines/coed-present-20261104.json','src/db/upgrades/019_tu_student_registration.sql'];
const report=(s)=>({status:s.status,state:s.path,ownerCleanupVerified:s.ownerCleanupVerified===true,
 ...(s.ownerResult?{ownerResult:s.ownerResult}:{}),...(s.versions?{versions:s.versions}:{}),
 ...(s.frontendJob?{frontendJob:s.frontendJob}:{}),noAccountCreatedByOperator:true});
export async function packageRegistration(ca){
 publicCa(ca);readRegistrationSql();const source=cleanSource();fixed(!source.dirty,'COMMITTED_SOURCE_REQUIRED');
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'production-'));
 const stage=join(dir,'owner019');mkdirSync(stage);const entry='scripts/operations/tu-registration/handler.mjs',out=join(stage,entry);mkdirSync(dirname(out),{recursive:true});
 await build({absWorkingDir:ROOT,entryPoints:[entry],outfile:out,bundle:true,platform:'node',target:'node22',format:'esm',external:['pg-native','../tu-registration-upgrade.mjs'],
  banner:{js:"import {createRequire as cr} from 'node:module'; const require=cr(import.meta.url);"},logLevel:'warning',sourcemap:false});
 for(const name of OWNER_FILES){const dest=join(stage,name);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(ROOT,name),dest);}
 writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});const ownerZip=join(dir,'registration-owner.zip');createZip(stage,ownerZip,[entry,'global-bundle.pem',...OWNER_FILES]);
 await packageTuAuth({output:dir,caBytes:ca});
 const apiStage=join(dir,'api019');mkdirSync(apiStage);
 await build({absWorkingDir:ROOT,entryPoints:['src/lambda.js'],outfile:join(apiStage,'src/lambda.js'),bundle:true,platform:'node',target:'node22',format:'cjs',external:['pg-native'],logLevel:'warning',sourcemap:false});
 writeFileSync(join(apiStage,'global-bundle.pem'),ca,{flag:'wx'});const apiZip=join(dir,'api019.zip');createZip(apiStage,apiZip,['src/lambda.js','global-bundle.pem']);
 execFileSync(process.execPath,['scripts/build-v4.mjs'],{cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:60000});
 const frontend=join(dir,'frontend019.zip');createZip(join(ROOT,'dist'),frontend,archiveFiles(join(ROOT,'dist')));
 const artifact=file=>({file,sha256:hash(readFileSync(file))});
 const s={format:'coed-tu-production-v1',task:'registration019',account:A,runId:randomBytes(16).toString('hex'),source,status:'LOCAL_READY',owned:{},
  artifacts:{owner:artifact(ownerZip),broker:artifact(join(dir,'coed-tu-broker.zip')),issuer:artifact(join(dir,'coed-tu-session-issuer.zip')),api:artifact(apiZip),frontend:artifact(frontend)},
  sqlSha256:SQL_SHA256,ownerInvocations:0,createdAt:new Date().toISOString()};
 s.path=join(dir,'state.json');writeFileSync(s.path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return s;
}
function guardSource(s){fixed(s.task==='registration019'&&!cleanSource().dirty&&cleanSource().head===s.source.head,'SOURCE_CHANGED');}
function ownerStatements(s){return [
 {Sid:'CoedRegistration019OwnerRead',Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:[T.owner,s.registrationSecret],Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(T.role)}}},
 {Sid:'CoedRegistration019OwnerWrite',Effect:'Allow',Principal:'*',Action:'secretsmanager:PutSecretValue',Resource:s.registrationSecret,Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(T.role)}}}];}
function ownerEnv(s,trial=false){return {NODE_ENV:'production',ENABLED:'true',MAINTENANCE_VERIFIED:'true',SNAPSHOT_VERIFIED:'true',RUN_ID:s.runId,EXPIRES_AT:s.expiresAt,REGISTRATION_SECRET:s.registrationSecret,TRIAL_PASSED:String(trial)};}
function checkMaintenance(){
 const api=aws(['lambda','get-function-configuration','--function-name','coed-api','--qualifier','live']);
 fixed(api.Environment?.Variables?.COED_API_MAINTENANCE==='verify','MAINTENANCE_REQUIRED');return api;
}
export async function prepare(s){
 caller();guardSource(s);fixed(s.status==='LOCAL_READY');checkMaintenance();
 const functions={};for(const [name,b] of Object.entries(BASE)){
  const c=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier','live']);fixed(c.Version===b.version&&c.CodeSha256===b.hash,'LIVE_BASELINE_DRIFT');
  const latest=aws(['lambda','get-function-configuration','--function-name',name]);fixed(latest.CodeSha256===b.hash,'LATEST_CODE_DRIFT');
  functions[name]={version:c.Version,hash:c.CodeSha256,revision:aws(['lambda','get-alias','--function-name',name,'--name','live']).RevisionId};
 }
 const integrations=aws(['apigatewayv2','get-integrations','--api-id',API]).Items;
 fixed(integrations.find(x=>x.IntegrationId==='ip14y62')?.IntegrationUri===arn('coed-api')+':live'&&integrations.find(x=>x.IntegrationId==='sr47ns9')?.IntegrationUri===arn('coed-tu-auth')+':live','INTEGRATION_DRIFT');
 const routes=aws(['apigatewayv2','get-routes','--api-id',API]).Items;fixed(!routes.some(r=>r.RouteKey==='POST /api/v3/auth/tu-register'),'EXISTING_REGISTRATION_ROUTE');
 // Retain the already approved backup. Forward019 itself is one atomic owner
 // transaction; failed trial/apply never restores or overwrites business data.
 const snap=aws(['rds','describe-db-snapshots','--db-snapshot-identifier','coed-pre-tu-018-20261105-f2ca1f7a']).DBSnapshots?.[0];
 fixed(snap?.Status==='available'&&snap.DBInstanceIdentifier==='database-coed-postgres'&&snap.Encrypted,'BACKUP_REQUIRED');
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name])&&absent(['iam','get-role','--role-name',T.role]),'OWNER_TARGET_EXISTS');
 fixed(absent(['secretsmanager','describe-secret','--secret-id','coed/v4/postgres/tu-registration']),'REGISTRATION_SECRET_EXISTS');
 s.baseline={functions,integrations,routes,snapshot:snap.DBSnapshotIdentifier};s.expiresAt=new Date(Date.now()+7200000).toISOString();save(s.path,s);
 const secret=aws(['secretsmanager','create-secret','--name','coed/v4/postgres/tu-registration','--description','CO-ED TU registration: execute-only fixed provisioning function; no direct table access','--tags',JSON.stringify(tagList(s))]);
 s.registrationSecret=secret.ARN;s.owned.registrationSecret=true;save(s.path,s);
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
 const r=aws(['iam','create-role','--role-name',T.role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;
 s.ownerRoleId=r.RoleId;s.owned.ownerRole=true;save(s.path,s);
 const policy={Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:[T.owner,s.registrationSecret]},
  {Effect:'Allow',Action:'secretsmanager:PutSecretValue',Resource:s.registrationSecret},
  {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${REGION}:${A}:log-group:${GROUP}:*`},...eniPolicy(T.name)]};
 aws(['iam','put-role-policy','--role-name',T.role,'--policy-name',POLICY,'--policy-document',JSON.stringify(policy)]);
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',GROUP]).logGroups.some(g=>g.logGroupName===GROUP),'OWNER_LOG_EXISTS');
 aws(['logs','create-log-group','--log-group-name',GROUP,'--tags',JSON.stringify(tags(s))]);s.owned.ownerLogs=true;save(s.path,s);
 aws(['logs','put-retention-policy','--log-group-name',GROUP,'--retention-in-days','1']);
 const before=endpoint(),statements=ownerStatements(s);s.ownerStatements=statements;save(s.path,s);setEndpoint(before,statements.reduce(addStatement,before));s.owned.ownerEndpoint=true;save(s.path,s);
 fixed(hash(readFileSync(s.artifacts.owner.file))===s.artifacts.owner.sha256);
 for(let i=0;i<8;i++)try{
  aws(['lambda','create-function','--function-name',T.name,'--runtime','nodejs22.x','--role',roleArn(T.role),'--handler','scripts/operations/tu-registration/handler.handler',
   '--timeout','90','--memory-size','256','--zip-file','fileb://'+s.artifacts.owner.file,'--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),
   '--environment',JSON.stringify({Variables:{...ownerEnv(s),ENABLED:'false'}}),'--tags',JSON.stringify(tags(s))]);s.owned.ownerFunction=true;save(s.path,s);break;
 }catch(e){if(!e.rolePropagation||i===7)throw e;await delay(2000);}
 putDeny(T.name,[OPERATOR]);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);await waitActive(T.name);
 s.status='OWNER_PREPARED_DISABLED';save(s.path,s);return report(s);
}
function ownerConfig(s){const f=aws(['lambda','get-function','--function-name',T.name]);owned(f.Tags,s);fixed(f.Configuration.Role===roleArn(T.role)&&f.Configuration.CodeSha256===Buffer.from(s.artifacts.owner.sha256,'hex').toString('base64'));return f.Configuration;}
export async function activateOwner(s,trial=false){
 caller();guardSource(s);checkMaintenance();fixed(s.owned.ownerFunction&&Date.parse(s.expiresAt)>Date.now());if(trial)fixed(s.trialPassed);
 const c=ownerConfig(s);aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',c.RevisionId,'--environment',JSON.stringify({Variables:ownerEnv(s,trial)})]);
 const ready=await waitActive(T.name),v=aws(['lambda','publish-version','--function-name',T.name,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;
 fixed(/^[1-9][0-9]*$/.test(v));putDeny(T.name,[OPERATOR],v);s.ownerVersion=v;save(s.path,s);return report(s);
}
export async function refreshOwner(s,candidate,{reviewedSqlChange=false}={}){
 caller();checkMaintenance();fixed(s.task==='registration019'&&!s.applied&&!s.trialPassed&&s.owned.ownerFunction,'OWNER_REFRESH_SCOPE');
 fixed(s.sqlSha256===candidate.sqlSha256 || (reviewedSqlChange===true&&s.ownerResult?.ok===false&&s.ownerResult.error?.code==='REGISTRATION_POSTCONDITION'),'OWNER_SQL_CHANGE_REVIEW_REQUIRED');
 fixed(!cleanSource().dirty&&candidate.source.head===cleanSource().head,'COMMITTED_SOURCE_REQUIRED');
 ownerConfig(s);fixed(hash(readFileSync(candidate.artifacts.owner.file))===candidate.artifacts.owner.sha256);
 s.ownerRefresh={oldSource:s.source,oldOwner:s.artifacts.owner,oldSqlSha256:s.sqlSha256,newSource:candidate.source,newOwner:candidate.artifacts.owner,newSqlSha256:candidate.sqlSha256};save(s.path,s);
 aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);
 const c=ownerConfig(s); // Concurrency updates can advance Lambda's revision.
 aws(['lambda','update-function-code','--function-name',T.name,'--revision-id',c.RevisionId,'--zip-file','fileb://'+candidate.artifacts.owner.file]);
 await waitActive(T.name);s.source=candidate.source;s.artifacts=candidate.artifacts;s.sqlSha256=candidate.sqlSha256;s.ownerVersion=null;save(s.path,s);
 aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);return report(s);
}
export function invokeOwner(s,mode){
 caller();guardSource(s);checkMaintenance();fixed(['trial','apply','credential'].includes(mode)&&s.ownerVersion&&s.ownerInvocations<12&&Date.parse(s.expiresAt)>Date.now());ownerConfig(s);
 if(mode!=='trial')fixed(s.trialPassed);if(mode==='credential')fixed(s.applied);
 const file=join(dirname(s.path),'owner019-result-'+(++s.ownerInvocations)+'.json');fixed(!existsSync(file));save(s.path,s);
 const response=aws(['lambda','invoke','--function-name',arn(T.name)+':'+s.ownerVersion,'--invocation-type','RequestResponse','--log-type','None',
  '--cli-binary-format','raw-in-base64-out','--payload',JSON.stringify({contract:T.contract,runId:s.runId,mode}),'--cli-read-timeout','110',file],{timeout:115000});
 fixed(response.StatusCode===200&&!response.FunctionError&&response.ExecutedVersion===s.ownerVersion&&lstatSync(file).size<16000);
 const result=JSON.parse(readFileSync(file,'utf8'));fixed(result.contract===T.contract);s.ownerResult=result;
 if(result.ok){if(mode==='trial'){fixed(result.result.preservationVerified);s.trialPassed=true;s.status='OWNER_TRIAL_PASSED';}
  if(mode==='apply'){fixed(result.result.applied||result.result.idempotentReplay);s.applied=true;s.status='SCHEMA019_APPLIED';}
  if(mode==='credential'){fixed(result.result.executeOnlyVerified&&result.result.noAccountCreated);s.credentialReady=true;s.status='REGISTRATION_CREDENTIAL_READY';}}
 save(s.path,s);return report(s);
}
export function cleanup(s){
 caller();fixed(s.task==='registration019');
 if(s.owned.ownerFunction&&!absent(['lambda','get-function-configuration','--function-name',T.name])){ownerConfig(s);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);aws(['lambda','delete-function','--function-name',T.name]);s.owned.ownerFunction=false;save(s.path,s);}
 if(s.ownerStatements){const before=endpoint(),after=s.ownerStatements.reduce(removeStatement,before);if(hash(before)!==hash(after))setEndpoint(before,after);s.owned.ownerEndpoint=false;save(s.path,s);}
 if(s.owned.ownerRole&&!absent(['iam','get-role','--role-name',T.role])){
  const role=aws(['iam','get-role','--role-name',T.role]).Role;owned(Object.fromEntries(role.Tags.map(t=>[t.Key,t.Value])),s);fixed(role.RoleId===s.ownerRoleId);
  fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn(T.role)));
  fixed(!aws(['iam','list-attached-role-policies','--role-name',T.role]).AttachedPolicies.length);
  const policies=aws(['iam','list-role-policies','--role-name',T.role]).PolicyNames;fixed(policies.every(p=>p===POLICY));
  for(const p of policies)aws(['iam','delete-role-policy','--role-name',T.role,'--policy-name',p]);aws(['iam','delete-role','--role-name',T.role]);s.owned.ownerRole=false;save(s.path,s);
 }
 if(s.owned.ownerLogs){owned(aws(['logs','list-tags-log-group','--log-group-name',GROUP]).tags,s);aws(['logs','delete-log-group','--log-group-name',GROUP]);s.owned.ownerLogs=false;save(s.path,s);}
 fixed(absent(['lambda','get-function-configuration','--function-name',T.name])&&absent(['iam','get-role','--role-name',T.role]));
 fixed(!endpoint().Statement.some(x=>s.ownerStatements?.some(y=>y.Sid===x.Sid)));s.ownerCleanupVerified=true;s.ownerCleanedAt=new Date().toISOString();save(s.path,s);return report(s);
}
export async function stage(s){
 caller();guardSource(s);checkMaintenance();fixed(s.credentialReady&&s.ownerCleanupVerified&&!s.versions);
 // Completion verifies a registration ticket before connecting to the DB. The
 // older issuer could sign login sessions without a public-key environment;
 // inheriting it unchanged silently breaks only first-registration completion.
 // Validate the complete issuer environment before any IAM/code mutation.
 const verifier=aws(['lambda','get-function-configuration','--function-name','coed-tu-auth','--qualifier','live']);
 fixed(verifier.Version===BASE['coed-tu-auth'].version&&verifier.CodeSha256===BASE['coed-tu-auth'].hash,'LIVE_BASELINE_DRIFT');
 const currentIssuer=aws(['lambda','get-function-configuration','--function-name','coed-tu-session-issuer']);
 const issuerEnv=issuerRegistrationEnvironment(currentIssuer.Environment?.Variables,verifier.Environment?.Variables,s.registrationSecret);
 const statement={Sid:'CoedRegistration019IssuerRead',Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:s.registrationSecret,Condition:{ArnEquals:{'aws:PrincipalArn':roleArn('coed-tu-session-role')}}};
 fixed(!aws(['iam','list-role-policies','--role-name','coed-tu-session-role']).PolicyNames.includes('CoedTuRegistration019Read'),'EXISTING_REGISTRATION_POLICY');
 aws(['iam','put-role-policy','--role-name','coed-tu-session-role','--policy-name','CoedTuRegistration019Read','--policy-document',JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:s.registrationSecret}]})]);
 s.issuerRegistrationPolicy=true;s.issuerEndpointStatement=statement;save(s.path,s);const old=endpoint();setEndpoint(old,addStatement(old,statement));
 s.versions={};save(s.path,s);
 for(const [name,key,timeout] of [['coed-tu-session-issuer','issuer',20],['coed-api','api',15],['coed-tu-auth','broker',28]]){
  const c=aws(['lambda','get-function-configuration','--function-name',name]),b=BASE[name];fixed(c.CodeSha256===b.hash,'LATEST_CODE_DRIFT');
  const v=key==='issuer'?issuerRegistrationEnvironment(c.Environment?.Variables,verifier.Environment?.Variables,s.registrationSecret):{...c.Environment.Variables,TU_ONBOARDING_ENABLED:'true'};
  if(key==='issuer'){fixed(v.TU_SESSION_FUNCTION_ARN===arn(name)+':live'&&hash(v)===hash(issuerEnv),'ISSUER_ENVIRONMENT_DRIFT');}
  if(key==='api')fixed(v.COED_API_MAINTENANCE==='verify');
  fixed(hash(readFileSync(s.artifacts[key].file))===s.artifacts[key].sha256);
  aws(['lambda','update-function-code','--function-name',name,'--revision-id',c.RevisionId,'--zip-file','fileb://'+s.artifacts[key].file]);
  const code=await waitActive(name);aws(['lambda','update-function-configuration','--function-name',name,'--revision-id',code.RevisionId,'--timeout',String(timeout),'--environment',JSON.stringify({Variables:v})]);
  const ready=await waitActive(name),version=aws(['lambda','publish-version','--function-name',name,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;
  fixed(/^[1-9][0-9]*$/.test(version));s.versions[name]=version;save(s.path,s);
 }
 s.status='RELEASE_STAGED_NOT_ROUTED';save(s.path,s);return report(s);
}
export function refreshReleaseSource(s,candidate){
 fixed(s.task==='registration019'&&s.applied&&s.credentialReady&&s.ownerCleanupVerified&&!s.versions&&s.sqlSha256===candidate.sqlSha256,'RELEASE_REFRESH_SCOPE');
 fixed(!cleanSource().dirty&&candidate.source.head===cleanSource().head,'COMMITTED_SOURCE_REQUIRED');
 s.releaseSourceHistory=[...(s.releaseSourceHistory||[]),{source:s.source,artifacts:s.artifacts}];
 s.source=candidate.source;s.artifacts=candidate.artifacts;save(s.path,s);return report(s);
}
export async function activate(s){
 caller();guardSource(s);checkMaintenance();fixed(s.status==='RELEASE_STAGED_NOT_ROUTED');
 // Exact permission for the new route; old login/status permissions deliberately
 // do not cover it. Never replace those with an auth/* wildcard.
 const sid='CoedRegistration019POST'+s.runId.slice(0,8),sourceArn=`arn:aws:execute-api:${REGION}:${A}:${API}/*/POST/api/v3/auth/tu-register`;
 const policy=JSON.parse(aws(['lambda','get-policy','--function-name','coed-tu-auth','--qualifier','live']).Policy);
 const existing=policy.Statement.find(x=>x.Sid===sid);
 if(existing)fixed(existing.Condition?.ArnLike?.['AWS:SourceArn']===sourceArn&&existing.Condition.StringEquals?.['AWS:SourceAccount']===A,'REGISTRATION_PERMISSION_DRIFT');
 else aws(['lambda','add-permission','--function-name','coed-tu-auth','--qualifier','live','--statement-id',sid,'--principal','apigateway.amazonaws.com',
  '--action','lambda:InvokeFunction','--source-arn',sourceArn,'--source-account',A]);
 s.registrationInvokePermission={sid,sourceArn};save(s.path,s);
 // No credential or signed proof is fabricated. The existing exact live alias
 // resource/IAM boundaries stay in place; use revision-guarded alias updates.
 for(const name of ['coed-tu-session-issuer','coed-api','coed-tu-auth']){
  const a=aws(['lambda','get-alias','--function-name',name,'--name','live']);fixed(a.FunctionVersion===s.baseline.functions[name].version,'ALIAS_DRIFT');
  const c=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier',s.versions[name]]),key=name==='coed-api'?'api':name==='coed-tu-auth'?'broker':'issuer';
  fixed(c.CodeSha256===Buffer.from(s.artifacts[key].sha256,'hex').toString('base64'));
  aws(['lambda','update-alias','--function-name',name,'--name','live','--function-version',s.versions[name],'--revision-id',a.RevisionId]);s.activated={...s.activated,[name]:true};save(s.path,s);
 }
 const route=aws(['apigatewayv2','create-route','--api-id',API,'--route-key','POST /api/v3/auth/tu-register','--authorization-type','NONE','--target','integrations/sr47ns9']);
 s.registrationRoute=route.RouteId;s.status='LIVE_VERIFY_ONLY';save(s.path,s);return report(s);
}
export async function deployFrontend(s){
 caller();guardSource(s);fixed(s.status==='LIVE_VERIFY_ONLY'&&!s.frontendJob);
 fixed(hash(readFileSync(s.artifacts.frontend.file))===s.artifacts.frontend.sha256);
 const deployment=aws(['amplify','create-deployment','--app-id','d1bpmj87vmjb96','--branch-name','main']);
 fixed(typeof deployment.zipUploadUrl==='string'&&deployment.jobId);s.frontendJob={id:deployment.jobId,status:'CREATED'};save(s.path,s);
 const u=new URL(deployment.zipUploadUrl);fixed(u.protocol==='https:'&&u.hostname.endsWith('.amazonaws.com'));
 const response=await fetch(u,{method:'PUT',body:readFileSync(s.artifacts.frontend.file),redirect:'error',signal:AbortSignal.timeout(60000)});fixed(response.ok,'FRONTEND_UPLOAD_FAILED');
 aws(['amplify','start-deployment','--app-id','d1bpmj87vmjb96','--branch-name','main','--job-id',deployment.jobId]);s.frontendJob.status='STARTED';save(s.path,s);return report(s);
}
function check(s){caller();if(s.frontendJob){const j=aws(['amplify','get-job','--app-id','d1bpmj87vmjb96','--branch-name','main','--job-id',s.frontendJob.id]).job.summary;s.frontendJob.status=j.status;save(s.path,s);}return report(s);}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [mode,path,flag]=process.argv.slice(2);fixed(flag==='--approved-o7','EXPLICIT_O7_APPROVAL_REQUIRED');
  if(mode==='package'){const ca=readFileSync(process.env.COED_RDS_CA_FILE);console.log(JSON.stringify(report(await packageRegistration(ca))));}
  else{const s=load(path);fixed(s.task==='registration019');let result;
   if(mode==='prepare')result=await prepare(s);else if(mode==='owner-trial-enable')result=await activateOwner(s);
   else if(mode==='owner-apply-enable')result=await activateOwner(s,true);else if(['trial','apply','credential'].includes(mode))result=invokeOwner(s,mode);
   else if(mode==='cleanup')result=cleanup(s);else if(mode==='stage')result=await stage(s);else if(mode==='activate')result=await activate(s);
   else if(mode==='frontend')result=await deployFrontend(s);else if(mode==='status')result=check(s);else fixed(false,'UNKNOWN_OPERATION');
   console.log(JSON.stringify(result));}
 }catch(e){console.log(JSON.stringify(safeFailure(e)));process.exitCode=1;}
}
