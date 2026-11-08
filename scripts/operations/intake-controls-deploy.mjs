// C7 existing-service cutover only. No IAM/Secret/Gateway/DB mutation here.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,lstatSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {aws,ROOT,A,REGION,API,caller,fixed,hash,cleanSource,safeConfig,sdkCredentials,waitActive,load as loadOwner} from './tu-production/common.mjs';
import {readZipEntry} from './zip-archive.mjs';
import {probe as browseProbe,publicRequest} from './read-only-browse.mjs';
import access from '../../src/shared/application-access.js';
const FUNCTION='coed-api',APP='d1bpmj87vmjb96',ORIGIN='https://main.d1bpmj87vmjb96.amplifyapp.com',BASE='https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com';
const ASSETS=['app.html','runtime-config.js','assets/authenticated-shell.js','assets/authenticated-shell.css','company-directory.html'];
function within(parent,path){const p=resolve(path),r=relative(parent,p);fixed(r && !r.startsWith('..') && !isAbsolute(r) && !lstatSync(p).isSymbolicLink(),'C7_LOCAL_PATH_DENIED');return p;}
function checkpoint(path){const p=within(join(ROOT,'tmp/tu-production'),path);fixed(/^production-[A-Za-z0-9]+[\\/]state\.json$/.test(relative(join(ROOT,'tmp/tu-production'),p)));return p;}
const save=s=>writeFileSync(checkpoint(s.path),JSON.stringify(s,null,2)+'\n');
export function load(path){const s=JSON.parse(readFileSync(checkpoint(path)));fixed(s.task==='intake-controls-deploy' && s.account===A);return s;}
const config=qualifier=>aws(['lambda','get-function-configuration','--function-name',FUNCTION,...(qualifier?['--qualifier',qualifier]:[])]);
const alias=()=>aws(['lambda','get-alias','--function-name',FUNCTION,'--name','live']);
const CONTROLLER_FILES=new Set(['scripts/operations/intake-controls-deploy.mjs','tests/intake-controls-deploy.test.mjs']);
export function assertControllerSource(current,candidate,binding,paths=[]){
 fixed(!current.dirty,'C7_SOURCE_CHANGED');
 if(current.head===candidate.head)return;
 fixed(binding?.head===current.head && binding.candidateSource===candidate.head && paths.length>0 &&
  paths.every(path=>CONTROLLER_FILES.has(path)),'C7_SOURCE_CHANGED');
}
function controllerDelta(from,to){
 fixed(/^[a-f0-9]{40}$/.test(from) && /^[a-f0-9]{40}$/.test(to),'C7_SOURCE_CHANGED');
 try{execFileSync('git',['merge-base','--is-ancestor',from,to],{cwd:ROOT,stdio:'pipe',windowsHide:true});
  return execFileSync('git',['diff','--name-only',from,to,'--'],{cwd:ROOT,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(Boolean);
 }catch{fixed(false,'C7_SOURCE_CHANGED');}
}
function source(s){const c=cleanSource();assertControllerSource(c,s.source,s.controllerSource,
 c.head===s.source.head?[]:controllerDelta(s.source.head,c.head));
 if(c.head!==s.source.head)for(const name of ['coed-v4-lambda.zip','coed-v4-frontend.zip'])artifact(s,name);
}
export function bindControllerSource(s){
 const current=cleanSource();fixed(current.head!==s.source.head,'C7_CONTROLLER_BINDING_NOT_NEEDED');
 const paths=controllerDelta(s.source.head,current.head),binding={head:current.head,candidateSource:s.source.head};
 assertControllerSource(current,s.source,binding,paths);
 for(const name of ['coed-v4-lambda.zip','coed-v4-frontend.zip'])artifact(s,name);
 s.controllerSource={...binding,paths,boundAt:new Date().toISOString()};save(s);return s;
}
function routing(){return {routes:hash(aws(['apigatewayv2','get-routes','--api-id',API]).Items),integrations:hash(aws(['apigatewayv2','get-integrations','--api-id',API]).Items),
 cors:hash(aws(['apigatewayv2','get-api','--api-id',API]).CorsConfiguration)};}
function standing(){return Object.fromEntries(['coed-tu-auth','coed-tu-session-issuer'].map(name=>{const c=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier','live']),a=aws(['lambda','get-alias','--function-name',name,'--name','live']);
 return [name,{version:c.Version,hash:c.CodeSha256,configuration:hash(safeConfig(c)),environment:hash(c.Environment?.Variables),alias:a}];}));}
function unchanged(s){fixed(hash(routing())===hash(s.routing) && hash(standing())===hash(s.standing),'C7_STANDING_RESOURCE_DRIFT');}
function artifact(s,name){const a=s.artifacts[name];fixed(hash(readFileSync(a.file))===a.sha256,'C7_ARTIFACT_DRIFT');return a;}
async function assetHashes(){const result={};for(const path of ASSETS){const r=await fetch(ORIGIN+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});fixed(r.ok,'C7_FRONTEND_READ_FAILED');result[path]=hash(Buffer.from(await r.arrayBuffer()));}return result;}
export function stageEnvironment(original,scope,stage){
 fixed(['browse','intake-draft','intake-upload','intake-pilot'].includes(stage),'C7_STAGE_DENIED');
 fixed(access.pilotScope(scope),'C7_SCOPE_DENIED');
 fixed((original.COED_INTAKE_AUDIENCE ?? 'pilot')==='pilot','C7_AUDIENCE_DRIFT');
 fixed(original.DB_USER==='coed_app' && original.DB_NAME==='coed' && original.CO_ED_APPLICATION_STORAGE==='s3' && original.CO_ED_APPLICATION_BUCKET==='coed-v4-application-documents-130165494095-ap-southeast-2' && original.TU_ONBOARDING_ENABLED==='true','C7_CONFIG_DRIFT');
 fixed(!['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>original[k]),'C7_UNSAFE_ENVIRONMENT');
 return {...original,COED_API_MAINTENANCE:stage,COED_INTAKE_PILOT:JSON.stringify(scope),COED_INTAKE_CONTROLS_REQUIRED:'true'};
}
async function invoke(version,event){const client=new LambdaClient({region:REGION,credentials:sdkCredentials(),maxAttempts:1});
 try{const r=await client.send(new InvokeCommand({FunctionName:FUNCTION,Qualifier:version,InvocationType:'RequestResponse',LogType:'None',Payload:Buffer.from(JSON.stringify(event))}),{abortSignal:AbortSignal.timeout(32000)});
  fixed(r.StatusCode===200 && !r.FunctionError && r.ExecutedVersion===version,'C7_NUMERIC_INVOKE_FAILED');return JSON.parse(Buffer.from(r.Payload).toString());
 }finally{client.destroy();}}
const publicCall=async event=>{const r=await fetch(BASE+event.rawPath+(event.rawQueryString?'?'+event.rawQueryString:''),{...publicRequest(event),signal:AbortSignal.timeout(15000)});return {statusCode:r.status,body:await r.text()};};
function coordinatorEvent(s,path){const now=Math.floor(Date.now()/1000);return {rawPath:path,requestContext:{http:{method:'GET'},authorizer:{jwt:{scopes:['coed-api/access'],claims:{
  iss:'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Um6nksXa1',sub:s.coordinatorSubject,client_id:'65b8bifg3860706esa1uns6cd8',token_use:'access',scope:'coed-api/access',exp:now+60}}}}};}
export async function pilotReadProbe(s,version){
 const root='/api/v4/coordinator',cycle=s.scope.cycle_id;
 const result=await invoke(version,coordinatorEvent(s,root+'/intake/'+cycle));fixed(result.statusCode===200,'C7_COORDINATOR_DATABASE_READ_FAILED');const data=JSON.parse(result.body).data;
 fixed(data.cycle_id===cycle && data.can_control===true && data.control?.mode==='CLOSED' && data.control.version===1,'C7_CONTROL_NOT_CLOSED_OR_ASSIGNED');
 const schedule=await invoke(version,coordinatorEvent(s,root+'/schedules/'+cycle));fixed(schedule.statusCode===200 && JSON.parse(schedule.body).data.can_edit===false,'C7_LEGACY_SCHEDULE_NOT_CLOSED');
 const options=await invoke(version,coordinatorEvent(s,root+'/options'));fixed(options.statusCode===200 && JSON.parse(options.body).data.cycles.length===1 && JSON.parse(options.body).data.cycles[0].id===cycle,'C7_SCOPE_NOT_EXACT');
 // This uses operator IAM invocation plus a modeled Gateway envelope, not a
 // genuine Cognito browser login. The real session remains an acceptance gate.
 const blocked=await invoke(version,{rawPath:'/api/v4/coordinator/applications/'+cycle+'/forward',requestContext:{http:{method:'POST'}},body:'{}'});fixed(blocked.statusCode===503,'C7_REVIEW_COMMAND_OPEN');
 return {databaseScopeVerified:true,closedControlVerified:true,legacyWritesClosed:true,genuineCognitoSessionPending:true};
}
export async function prepare(candidate,ownerPath){
 caller();fixed(!cleanSource().dirty,'C7_CLEAN_SOURCE_REQUIRED');const owner=loadOwner(ownerPath);fixed(owner.task==='intake-controls-upgrade' && owner.applied && owner.cleanup?.verified && owner.result?.ok && owner.result.result?.preservationVerified,'C7_SCHEMA_AND_CLEANUP_REQUIRED');
 const directory=within(join(ROOT,'tmp/release-candidates'),candidate),manifest=JSON.parse(readFileSync(join(directory,'candidate-manifest.json')));
 fixed(manifest.source.commit===cleanSource().head && !manifest.source.dirty && manifest.target.account===A && manifest.target.appId===APP && manifest.target.function===FUNCTION,'C7_SOURCE_OR_TARGET_DRIFT');
 const live=config('live'),latest=config(),a=alias();
 fixed(live.Version==='4' && live.CodeSha256==='TSumC2dRMnoJQWqKVQmhW4Oua1hwWt2FyZ5iJbk50QA=' && live.CodeSha256===latest.CodeSha256 && hash(live.Environment?.Variables)===hash(latest.Environment?.Variables) &&
  live.Environment.Variables.COED_API_MAINTENANCE==='browse' && live.Timeout===15 && live.MemorySize===256 && live.Handler==='src/lambda.handler' && live.Runtime==='nodejs22.x' &&
  live.Role==='arn:aws:iam::130165494095:role/coed-v4-api-role' && !Object.keys(a.RoutingConfig?.AdditionalVersionWeights || {}).length,'C7_BASELINE_CHANGED');
 const artifacts={};for(const name of ['coed-v4-lambda.zip','coed-v4-frontend.zip']){const file=join(directory,name),sha256=hash(readFileSync(file));fixed(sha256===manifest.artifacts[name].sha256);artifacts[name]={file,sha256};}
 const scope={student_user_id:owner.manifest.studentUserId,coordinator_user_id:owner.manifest.coordinatorUserId,cycle_id:owner.manifest.cycleId};stageEnvironment(live.Environment.Variables,scope,'browse');
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'production-')),path=join(dir,'state.json');writeFileSync(path,'{}',{flag:'wx'});
 const s={format:'coed-tu-production-v1',task:'intake-controls-deploy',account:A,path,source:cleanSource(),artifacts,scope,coordinatorSubject:owner.manifest.coordinatorSubject,
  originalEnvironment:live.Environment.Variables,baseline:{alias:a,configuration:safeConfig(live),latest:safeConfig(latest)},standing:standing(),routing:routing(),frontendBefore:await assetHashes(),status:'PREPARED',ownerState:ownerPath};save(s);return s;
}
async function publishStage(s,stage){
 source(s);unchanged(s);if(['intake-upload','intake-pilot'].includes(stage))fixed(s.ownerConfirmed && (stage!=='intake-pilot' || s.uploadConfirmed),'C7_GENUINE_ACCEPTANCE_REQUIRED');
 const current=config(),environment=stageEnvironment(s.originalEnvironment,s.scope,stage);
 fixed(current.CodeSha256===Buffer.from(artifact(s,'coed-v4-lambda.zip').sha256,'hex').toString('base64'),'C7_CURRENT_CODE_DRIFT');
 aws(['lambda','update-function-configuration','--function-name',FUNCTION,'--revision-id',current.RevisionId,'--timeout','28','--environment',JSON.stringify({Variables:environment})]);
 const ready=await waitActive(FUNCTION);fixed(hash(ready.Environment.Variables)===hash(environment) && ready.Timeout===28);
 const version=aws(['lambda','publish-version','--function-name',FUNCTION,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;
 s.versions={...s.versions,[stage]:version};save(s);return version;
}
export async function stageBrowse(s){
 caller();source(s);unchanged(s);fixed(s.status==='PREPARED');const c=config();fixed(c.CodeSha256===s.baseline.latest.hash && c.RevisionId===s.baseline.latest.revision,'C7_LATEST_DRIFT');
 const zip=artifact(s,'coed-v4-lambda.zip');s.status='STAGING';save(s);aws(['lambda','update-function-code','--function-name',FUNCTION,'--revision-id',c.RevisionId,'--zip-file','fileb://'+zip.file]);
 await waitActive(FUNCTION);const version=await publishStage(s,'browse');s.candidateChecks=await browseProbe(event=>invoke(version,event));
 const a=alias();fixed(a.FunctionVersion===s.baseline.alias.FunctionVersion && a.RevisionId===s.baseline.alias.RevisionId,'C7_ALIAS_DRIFT');
 aws(['lambda','update-alias','--function-name',FUNCTION,'--name','live','--function-version',version,'--revision-id',a.RevisionId]);s.liveVersion=version;s.status='BROWSE_LIVE';save(s);
 s.publicChecks=await browseProbe(publicCall);save(s);return s;
}
export async function deployFrontend(s){
 caller();source(s);unchanged(s);fixed(s.status==='BROWSE_LIVE' && !s.frontendJob && hash(await assetHashes())===hash(s.frontendBefore),'C7_FRONTEND_DRIFT');
 const r=aws(['amplify','create-deployment','--app-id',APP,'--branch-name','main']),u=new URL(r.zipUploadUrl);fixed(u.protocol==='https:' && u.hostname.endsWith('.amazonaws.com') && r.jobId,'C7_UPLOAD_DESTINATION_DENIED');
 s.frontendJob={id:r.jobId,status:'CREATED'};save(s);const upload=await fetch(u,{method:'PUT',body:readFileSync(artifact(s,'coed-v4-frontend.zip').file),redirect:'error',signal:AbortSignal.timeout(60000)});fixed(upload.ok,'C7_UPLOAD_FAILED');
 aws(['amplify','start-deployment','--app-id',APP,'--branch-name','main','--job-id',r.jobId]);s.frontendJob.status='STARTED';save(s);return s;
}
export async function frontendStatus(s){
 caller();unchanged(s);fixed(s.frontendJob);const job=aws(['amplify','get-job','--app-id',APP,'--branch-name','main','--job-id',s.frontendJob.id]).job.summary;s.frontendJob.status=job.status;
 if(job.status==='SUCCEED'){const expected=Object.fromEntries(ASSETS.map(path=>[path,hash(readZipEntry(artifact(s,'coed-v4-frontend.zip').file,path))]));fixed(hash(await assetHashes())===hash(expected),'C7_FRONTEND_HASH_MISMATCH');s.status='BROWSE_FRONTEND_VERIFIED';}
 save(s);return s;
}
export async function openDraftPilot(s){
 caller();source(s);unchanged(s);fixed(s.status==='BROWSE_FRONTEND_VERIFIED','C7_FRONTEND_REQUIRED');const version=await publishStage(s,'intake-draft');s.pilotChecks=await pilotReadProbe(s,version);
 const a=alias();fixed(a.FunctionVersion===s.liveVersion,'C7_ALIAS_DRIFT');aws(['lambda','update-alias','--function-name',FUNCTION,'--name','live','--function-version',version,'--revision-id',a.RevisionId]);
 s.liveVersion=version;s.status='DRAFT_PILOT_CLOSED_CONTROL_OWNER_ACCEPTANCE_PENDING';save(s);return s;
}
export function acknowledge(s,kind){
 fixed(['owner','upload'].includes(kind),'C7_ACK_DENIED');
 if(kind==='owner'){fixed(s.status==='DRAFT_PILOT_CLOSED_CONTROL_OWNER_ACCEPTANCE_PENDING','C7_OWNER_STAGE_REQUIRED');s.ownerConfirmed=true;s.ownerConfirmedAt=new Date().toISOString();}
 else{fixed(s.status==='UPLOAD_PILOT_ACCEPTANCE_PENDING' && s.ownerConfirmed,'C7_UPLOAD_STAGE_REQUIRED');s.uploadConfirmed=true;s.uploadConfirmedAt=new Date().toISOString();}
 save(s);return s;
}
export async function promotionProbe(call,stage,id,gateway=false){
 fixed(['intake-upload','intake-pilot'].includes(stage),'C7_STAGE_DENIED');
 for(const path of ['/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v4/application-options'])fixed((await call({rawPath:path,requestContext:{http:{method:'GET'}}})).statusCode===401,'C7_ANONYMOUS_ALLOWED');
 for(const suffix of ['/uploads','/documents/'+id+'/download','/submit']){const r=await call({rawPath:'/api/tu-proxy/api/v4/applications/'+id+suffix,requestContext:{http:{method:'POST'}},body:'{}'});
  fixed(r.statusCode===(suffix==='/submit'&&stage!=='intake-pilot'?503:401),'C7_STAGE_GATE_FAILED');}
 // No JWT reaches the staff Lambda through the real Gateway. A numeric IAM
 // invocation reaches maintenance first instead; neither permits the command.
 fixed((await call({rawPath:'/api/v4/coordinator/applications/'+id+'/forward',requestContext:{http:{method:'POST'}},body:'{}'})).statusCode===(gateway?401:503),'C7_REVIEW_OPEN');
}
export async function promote(s,stage){
 fixed(stage==='intake-upload' && s.status==='DRAFT_PILOT_CLOSED_CONTROL_OWNER_ACCEPTANCE_PENDING' && s.ownerConfirmed ||
  stage==='intake-pilot' && s.status==='UPLOAD_PILOT_ACCEPTANCE_PENDING' && s.ownerConfirmed && s.uploadConfirmed,'C7_GENUINE_ACCEPTANCE_REQUIRED');
 caller();source(s);unchanged(s);
 const version=await publishStage(s,stage),id=s.scope.cycle_id;
 await promotionProbe(event=>invoke(version,event),stage,id);const a=alias();fixed(a.FunctionVersion===s.liveVersion,'C7_ALIAS_DRIFT');
 aws(['lambda','update-alias','--function-name',FUNCTION,'--name','live','--function-version',version,'--revision-id',a.RevisionId]);s.liveVersion=version;
 s.status=stage==='intake-upload'?'UPLOAD_PILOT_ACCEPTANCE_PENDING':'SUBMIT_PILOT_OWNER_AND_COORDINATOR_ACCEPTANCE_PENDING';save(s);await promotionProbe(publicCall,stage,id,true);return s;
}
export async function returnToBrowse(s){
 caller();source(s);unchanged(s);const a=alias();fixed(a.FunctionVersion===s.liveVersion,'C7_ROLLBACK_NOT_OWNED');const version=await publishStage(s,'browse');
 aws(['lambda','update-alias','--function-name',FUNCTION,'--name','live','--function-version',version,'--revision-id',a.RevisionId]);s.liveVersion=version;s.status='COMPATIBLE_BROWSE';save(s);return s;
}
function report(s){return {status:s.status,state:s.path,apiVersion:s.liveVersion,frontendJob:s.frontendJob,pilotChecks:s.pilotChecks};}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [mode,path,extra]=process.argv.slice(2);fixed(process.argv.at(-1)==='--approved-c7','C7_APPROVAL_REQUIRED');let s;
  if(mode==='prepare')s=await prepare(path,extra);else{s=load(path);if(mode==='stage')await stageBrowse(s);else if(mode==='frontend')await deployFrontend(s);else if(mode==='status')await frontendStatus(s);
   else if(mode==='draft')await openDraftPilot(s);else if(mode==='browse')await returnToBrowse(s);else if(mode==='owner-tested')acknowledge(s,'owner');
   else if(mode==='upload-tested')acknowledge(s,'upload');else if(mode==='upload')await promote(s,'intake-upload');else if(mode==='submit')await promote(s,'intake-pilot');
   else if(mode==='bind-controller')bindControllerSource(s);
   else fixed(false,'C7_COMMAND_DENIED');}console.log(JSON.stringify(report(s)));
 }catch(e){console.log(JSON.stringify({status:'C7_DEPLOY_STOPPED',code:e.safeCode || e.awsCode || 'C7_OPERATION_FAILED',checkCheckpoint:true}));process.exitCode=1;}
}
