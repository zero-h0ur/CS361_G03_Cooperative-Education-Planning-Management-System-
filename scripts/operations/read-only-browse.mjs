// Approved read-only recovery only. No SQL, IAM, Gateway, Secret or TU-auth writes.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,lstatSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {aws} from './tu-preflight/operator.mjs';
import {hash,fixed,sdkCredentials,waitActive} from './tu-production/common.mjs';
import {readZipEntry} from './zip-archive.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url)),PARENT=join(ROOT,'tmp/read-only-browse');
const BASE='https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com';
const ORIGIN='https://main.d1bpmj87vmjb96.amplifyapp.com';
const ACCOUNT='130165494095',FUNCTION='coed-api',APP='d1bpmj87vmjb96';
const OLD_HASH='YLQR2Ao0Gy3sogh/uOup2YhrOrT1YR5yAz5JJtavMwI=';
const ID='11111111-1111-4111-8111-111111111111';
const ASSETS=['runtime-config.js','assets/authenticated-shell.js','assets/authenticated-shell.css'];
const git=args=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',windowsHide:true}).trim();
export function within(parent,path){const r=relative(parent,resolve(path));fixed(r && !r.startsWith('..') && !isAbsolute(r),'UNSAFE_LOCAL_PATH');return resolve(path);}
function checkpoint(path){const p=within(PARENT,path);fixed(/^release-[A-Za-z0-9]+[\\/]state\.json$/.test(relative(PARENT,p)) && !lstatSync(p).isSymbolicLink() && !lstatSync(resolve(p,'..')).isSymbolicLink());return p;}
const save=s=>writeFileSync(checkpoint(s.path),JSON.stringify(s,null,2)+'\n');
function load(path){const s=JSON.parse(readFileSync(checkpoint(path),'utf8'));fixed(s.contract==='coed-readonly-browse-v1' && s.account===ACCOUNT);return s;}
function source(s){fixed(!git(['status','--porcelain']) && git(['rev-parse','HEAD'])===s.source,'SOURCE_NOT_CLEAN_OR_CHANGED');}
function caller(){const c=aws(['sts','get-caller-identity']);fixed(c.Account===ACCOUNT && /^arn:aws:sts::130165494095:assumed-role\/AccountFullAccessRole\//.test(c.Arn),'WRONG_ACCOUNT_OR_OPERATOR');}
function config(name,qualifier){return aws(['lambda','get-function-configuration','--function-name',name,...(qualifier?['--qualifier',qualifier]:[])]);}
function alias(name){return aws(['lambda','get-alias','--function-name',name,'--name','live']);}
function shape(c){return {hash:c.CodeSha256,role:c.Role,handler:c.Handler,runtime:c.Runtime,vpc:c.VpcConfig,
  timeout:c.Timeout,memory:c.MemorySize,layers:c.Layers || [],envHash:hash(c.Environment?.Variables || {}),maintenance:c.Environment?.Variables?.COED_API_MAINTENANCE};}
function routing(){const integrations=['ip14y62','sr47ns9'].map(id=>aws(['apigatewayv2','get-integration','--api-id','yhfevhqtoa','--integration-id',id]));
  fixed(integrations[0].IntegrationUri==='arn:aws:lambda:ap-southeast-2:130165494095:function:coed-api:live' &&
    integrations[1].IntegrationUri==='arn:aws:lambda:ap-southeast-2:130165494095:function:coed-tu-auth:live','UNQUALIFIED_OR_UNEXPECTED_INTEGRATION');return {
  routes:hash((aws(['apigatewayv2','get-routes','--api-id','yhfevhqtoa']).Items || []).sort((a,b)=>a.RouteId.localeCompare(b.RouteId))),
  integrations:hash(integrations),
  cors:hash(aws(['apigatewayv2','get-api','--api-id','yhfevhqtoa']).CorsConfiguration)};}
function unchanged(s){
  fixed(hash(routing())===hash(s.routing),'GATEWAY_DRIFT');
  for(const name of ['coed-tu-auth','coed-tu-session-issuer']){
    const a=alias(name);fixed(a.FunctionVersion===s.standing[name].version && hash(shape(config(name,'live')))===s.standing[name].hash,'TU_AUTH_DRIFT');
  }
}
function artifact(s,key){const a=s.artifacts[key];fixed(hash(readFileSync(a.file))===a.sha256,'ARTIFACT_CHANGED');return a;}
async function assetHashes(){const entries=[];for(const path of ASSETS){const r=await fetch(ORIGIN+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});fixed(r.ok,'LIVE_FRONTEND_UNAVAILABLE');entries.push([path,hash(Buffer.from(await r.arrayBuffer()))]);}return Object.fromEntries(entries);}
export function approvedEnvironment(old){fixed(old?.COED_API_MAINTENANCE==='verify' && old.TU_ONBOARDING_ENABLED==='true','UNEXPECTED_MAINTENANCE');return {...old,COED_API_MAINTENANCE:'browse'};}
export async function probe(call){
  const get=async(path,query='')=>call({rawPath:path,rawQueryString:query,requestContext:{http:{method:'GET'}}});
  const directory=await get('/api/directory/companies','page=1&pageSize=1');fixed(directory.statusCode===200,'PUBLIC_DIRECTORY_NOT_READY');
  const rows=JSON.parse(directory.body).data;fixed(Array.isArray(rows) && rows.length>0,'DIRECTORY_HAS_NO_VISIBLE_COMPANIES');
  fixed(rows.every(row=>row.details_available===false && !Object.hasOwn(row,'positions') && !Object.hasOwn(row,'contact_email')),'PUBLIC_DIRECTORY_PRIVACY');
  const detail=await get('/api/directory/companies/'+rows[0].id);fixed(detail.statusCode===200,'PUBLIC_COMPANY_DETAIL_NOT_READY');
  const publicDetail=JSON.parse(detail.body).data;fixed(publicDetail?.details_available===false && !Object.hasOwn(publicDetail,'positions') && !Object.hasOwn(publicDetail,'contact_email'),'PUBLIC_DETAIL_PRIVACY');
  for(const path of ['/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v3/students/me',
    '/api/tu-proxy/api/v4/application-options','/api/tu-proxy/api/v4/applications','/api/tu-proxy/api/v4/applications/'+ID])
    fixed((await get(path)).statusCode===401,'ANONYMOUS_OWNER_READ_ALLOWED');
  const blocked=[['POST','/api/tu-proxy/api/v4/applications'],['PATCH','/api/tu-proxy/api/v4/applications/'+ID],
    ['POST','/api/tu-proxy/api/v4/applications/'+ID+'/submit'],['POST','/api/tu-proxy/api/v4/applications/'+ID+'/uploads'],
    ['POST','/api/tu-proxy/api/v4/applications/'+ID+'/documents/'+ID+'/download'],
    ['GET','/api/tu-proxy/api/v4/applications/'+ID+'/readiness'],['PATCH','/api/tu-proxy/api/v3/students/me']];
  for(const [method,rawPath] of blocked){const r=await call({rawPath,requestContext:{http:{method}},body:'{}'});
    fixed(r.statusCode===503 && JSON.parse(r.body).error?.code==='COED_MAINTENANCE','WRITE_OR_UNREVIEWED_PATH_OPEN');}
  return {directoryRead:true,companyDetailRead:true,publicPrivacy:true,anonymousDenied:true,writesBlocked:true,ownerPositivePending:true};
}
async function invoke(version,event){
  const c=new LambdaClient({region:'ap-southeast-2',credentials:sdkCredentials(),maxAttempts:1});
  const r=await c.send(new InvokeCommand({FunctionName:FUNCTION,Qualifier:version,InvocationType:'RequestResponse',LogType:'None',Payload:Buffer.from(JSON.stringify(event))}));
  fixed(r.StatusCode===200 && !r.FunctionError && r.ExecutedVersion===version,'NUMERIC_VERSION_INVOKE_FAILED');
  return JSON.parse(Buffer.from(r.Payload).toString());
}
async function publicCall(event){const method=event.requestContext.http.method;
  const r=await fetch(BASE+event.rawPath+(event.rawQueryString?'?'+event.rawQueryString:''),{method,body:event.body,
    headers:event.body?{'Content-Type':'application/json'}:{},redirect:'error',signal:AbortSignal.timeout(15000)});
  return {statusCode:r.status,body:await r.text()};}
export async function prepare(candidate){
  caller();fixed(!git(['status','--porcelain']),'SOURCE_NOT_CLEAN');
  const dir=within(join(ROOT,'tmp/release-candidates'),candidate);fixed(/^candidate-[A-Za-z0-9]+$/.test(relative(join(ROOT,'tmp/release-candidates'),dir)) && !lstatSync(dir).isSymbolicLink(),'UNSAFE_CANDIDATE_DIRECTORY');
  const m=JSON.parse(readFileSync(join(dir,'candidate-manifest.json'),'utf8'));
  fixed(m.source.dirty===false && m.source.commit===git(['rev-parse','HEAD']) && m.target.account===ACCOUNT && m.target.appId===APP && m.target.function===FUNCTION,'CANDIDATE_TARGET_OR_SOURCE');
  const live=config(FUNCTION,'live'),latest=config(FUNCTION),a=alias(FUNCTION);
  fixed(live.Version==='3' && live.CodeSha256===OLD_HASH && latest.CodeSha256===OLD_HASH && hash(shape(live))===hash(shape(latest)) && !Object.keys(a.RoutingConfig?.AdditionalVersionWeights || {}).length,'BASELINE_CHANGED');
  approvedEnvironment(live.Environment?.Variables);
  const previous=within(join(ROOT,'tmp/tu-production'),process.env.COED_PREVIOUS_FRONTEND_ZIP || '');
  const oldHashes=Object.fromEntries(ASSETS.map(path=>[path,hash(readZipEntry(previous,path))]));
  fixed(hash(oldHashes)===hash(await assetHashes()),'PREVIOUS_FRONTEND_NOT_CURRENT');
  mkdirSync(PARENT,{recursive:true});const folder=mkdtempSync(join(PARENT,'release-')),path=join(folder,'state.json');
  const rollback=join(folder,'rollback-frontend.zip');copyFileSync(previous,rollback);
  const artifacts={};for(const [key,name] of [['api','coed-v4-lambda.zip'],['frontend','coed-v4-frontend.zip']]){
    const file=join(dir,name);fixed(hash(readFileSync(file))===m.artifacts[name].sha256,'CANDIDATE_ARTIFACT_HASH');artifacts[key]={file,sha256:m.artifacts[name].sha256};
  }
  const standing={};for(const name of ['coed-tu-auth','coed-tu-session-issuer'])standing[name]={version:alias(name).FunctionVersion,hash:hash(shape(config(name,'live')))};
  fixed(standing['coed-tu-auth'].version==='5' && standing['coed-tu-session-issuer'].version==='4','TU_AUTH_BASELINE_CHANGED');
  const s={contract:'coed-readonly-browse-v1',account:ACCOUNT,path,source:m.source.commit,artifacts,standing,routing:routing(),
    baseline:{alias:{version:a.FunctionVersion,revision:a.RevisionId},shape:shape(live),latestRevision:latest.RevisionId},
    rollbackFrontend:{file:rollback,sha256:hash(readFileSync(rollback)),assets:oldHashes},createdAt:new Date().toISOString(),status:'PREPARED_NO_CHANGES'};
  writeFileSync(path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return {status:s.status,state:path};
}
export async function stage(s){
  caller();source(s);unchanged(s);fixed(s.status==='PREPARED_NO_CHANGES');
  const a=alias(FUNCTION),c=config(FUNCTION);fixed(a.FunctionVersion===s.baseline.alias.version && a.RevisionId===s.baseline.alias.revision && c.RevisionId===s.baseline.latestRevision && hash(shape(c))===hash(s.baseline.shape),'STAGE_DRIFT');
  const zip=artifact(s,'api');s.status='STAGING';save(s);
  aws(['lambda','update-function-code','--function-name',FUNCTION,'--revision-id',c.RevisionId,'--zip-file','fileb://'+zip.file]);
  const next=await waitActive(FUNCTION);fixed(next.CodeSha256===Buffer.from(zip.sha256,'hex').toString('base64'),'STAGED_CODE_HASH');
  const env=approvedEnvironment(c.Environment.Variables);
  aws(['lambda','update-function-configuration','--function-name',FUNCTION,'--revision-id',next.RevisionId,'--environment',JSON.stringify({Variables:env})]);
  const ready=await waitActive(FUNCTION);fixed(hash(ready.Environment.Variables)===hash(env) && ready.CodeSha256===next.CodeSha256,'CONFIGURATION_DRIFT');
  const v=aws(['lambda','publish-version','--function-name',FUNCTION,'--code-sha256',ready.CodeSha256,'--revision-id',ready.RevisionId]);
  fixed(/^[1-9][0-9]*$/.test(v.Version));s.version=v.Version;s.publishedHash=v.CodeSha256;s.status='CANDIDATE_PUBLISHED_NOT_ROUTED';save(s);
  s.candidateChecks=await probe(event=>invoke(s.version,event));s.status='CANDIDATE_VERIFIED';save(s);return report(s);
}
export async function activate(s){
  caller();source(s);unchanged(s);fixed(s.status==='CANDIDATE_VERIFIED');
  const a=alias(FUNCTION);fixed(a.FunctionVersion===s.baseline.alias.version && a.RevisionId===s.baseline.alias.revision,'LIVE_ALIAS_DRIFT');
  const candidate=config(FUNCTION,s.version);fixed(candidate.CodeSha256===s.publishedHash && candidate.Environment?.Variables?.COED_API_MAINTENANCE==='browse','CANDIDATE_DRIFT');
  s.status='ACTIVATING';save(s);
  aws(['lambda','update-alias','--function-name',FUNCTION,'--name','live','--function-version',s.version,'--revision-id',a.RevisionId]);
  s.status='LIVE_READONLY_CHECKS_PENDING';save(s);s.liveChecks=await probe(publicCall);unchanged(s);
  s.status='LIVE_READONLY_FRONTEND_PENDING';save(s);return report(s);
}
async function upload(s,file,rollback=false){
  const d=aws(['amplify','create-deployment','--app-id',APP,'--branch-name','main']);
  const u=new URL(d.zipUploadUrl);fixed(u.protocol==='https:' && u.hostname.endsWith('.amazonaws.com') && d.jobId,'AMPLIFY_UPLOAD_DESTINATION');
  const key=rollback?'rollbackJob':'frontendJob';s[key]={id:d.jobId,status:'CREATED'};save(s);
  const r=await fetch(u,{method:'PUT',body:readFileSync(file),redirect:'error',signal:AbortSignal.timeout(60000)});fixed(r.ok,'AMPLIFY_UPLOAD_FAILED');
  aws(['amplify','start-deployment','--app-id',APP,'--branch-name','main','--job-id',d.jobId]);s[key].status='STARTED';save(s);return report(s);
}
export async function frontend(s){
  caller();source(s);unchanged(s);fixed(s.status==='LIVE_READONLY_FRONTEND_PENDING' && !s.frontendJob);
  fixed(hash(await assetHashes())===hash(s.rollbackFrontend.assets),'FRONTEND_CHANGED_CONCURRENTLY');
  return upload(s,artifact(s,'frontend').file);
}
export async function status(s){
  caller();unchanged(s);
  if(s.rollbackJob){const j=aws(['amplify','get-job','--app-id',APP,'--branch-name','main','--job-id',s.rollbackJob.id]).job.summary;
    s.rollbackJob.status=j.status;
    if(j.status==='SUCCEED'){fixed(hash(await assetHashes())===hash(s.rollbackFrontend.assets),'ROLLBACK_FRONTEND_HASH_MISMATCH');s.status='API_AND_FRONTEND_ROLLED_BACK';}
    save(s);return report(s);
  }
  if(s.frontendJob){const j=aws(['amplify','get-job','--app-id',APP,'--branch-name','main','--job-id',s.frontendJob.id]).job.summary;s.frontendJob.status=j.status;
    if(j.status==='SUCCEED'){
      const actual=await assetHashes(),expected=Object.fromEntries(ASSETS.map(path=>[path,hash(readZipEntry(artifact(s,'frontend').file,path))]));
      fixed(hash(actual)===hash(expected),'PUBLISHED_FRONTEND_HASH_MISMATCH');
      fixed(alias(FUNCTION).FunctionVersion===s.version,'LIVE_VERSION_DRIFT');s.liveChecks=await probe(publicCall);s.status='READONLY_ROLLOUT_VERIFIED_OWNER_PENDING';
    }
    save(s);
  }
  return report(s);
}
export async function rollback(s){
  caller();unchanged(s);const a=alias(FUNCTION);fixed(a.FunctionVersion===s.version,'ROLLBACK_NOT_OWNED_VERSION');
  aws(['lambda','update-alias','--function-name',FUNCTION,'--name','live','--function-version',s.baseline.alias.version,'--revision-id',a.RevisionId]);
  s.status='ROLLED_BACK_TO_VERIFY';save(s);return report(s);
}
export async function rollbackFrontend(s){
  caller();unchanged(s);fixed(s.status==='ROLLED_BACK_TO_VERIFY' && s.frontendJob && !s.rollbackJob,'FRONTEND_ROLLBACK_NOT_OWNED');
  const expected=Object.fromEntries(ASSETS.map(path=>[path,hash(readZipEntry(artifact(s,'frontend').file,path))]));
  fixed(hash(await assetHashes())===hash(expected) && hash(readFileSync(s.rollbackFrontend.file))===s.rollbackFrontend.sha256,'FRONTEND_ROLLBACK_DRIFT');
  return upload(s,s.rollbackFrontend.file,true);
}
function report(s){return {status:s.status,state:s.path,apiVersion:s.version || null,frontendJob:s.frontendJob,rollbackJob:s.rollbackJob,
  candidateChecks:s.candidateChecks,liveChecks:s.liveChecks,writesResumed:false,ownerPositivePending:true};}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,arg,approval]=process.argv.slice(2);
  try{
    fixed(approval==='--approved-read-only' && ['prepare','stage','activate','frontend','status','rollback','rollback-frontend'].includes(mode),'READONLY_APPROVAL_REQUIRED');
    const result=mode==='prepare'?await prepare(arg):await ({stage,activate,frontend,status,rollback,'rollback-frontend':rollbackFrontend})[mode](load(arg));
    console.log(JSON.stringify(result,null,2));
  }catch(e){console.error(JSON.stringify({status:'STOPPED_REVIEW_REQUIRED',code:e.safeCode || e.awsCode || 'READONLY_OPERATION_FAILED',checkCheckpoint:true}));process.exitCode=1;}
}
