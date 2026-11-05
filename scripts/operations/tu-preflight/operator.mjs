// Scoped D0-D6 controller. Never deploys the application or applies SQL.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
import reader from './reader.js';
import {createZip,listZipEntries} from '../zip-archive.mjs';
import {publicCa} from '../../package-tu-auth.mjs';
const {TARGET:T,FUNCTION_ARN}=reader;
const root=fileURLToPath(new URL('../../../',import.meta.url));
const tags={coedTask:'tu-preflight-20261104'};
const roleArn=`arn:aws:iam::${T.account}:role/${T.role}`;
const group='/aws/lambda/'+T.name,policyName='ScopedPreflightOnly';
const canonical=v=>Array.isArray(v)?v.map(canonical):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(canonical(v))).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function aws(args,{binary=false,timeout=30000}={}){
  try{
    const out=execFileSync('aws',[...args,'--profile','coed-v4','--region',T.region,'--no-cli-pager',...(binary?[]:['--output','json'])],
      {encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024,timeout,windowsHide:true});
    return out.trim()?JSON.parse(out):{};
  }catch(raw){
    const stderr=String(raw.stderr || ''),match=stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/);
    const error=new Error('AWS_OPERATION_FAILED');error.awsCode=match?.[1] || 'AWS_CALL_UNAVAILABLE';
    error.rolePropagation=/role defined for the function cannot be assumed/i.test(stderr);throw error;
  }
}
function absent(args){try{aws(args);return false;}catch(e){if(['NoSuchEntity','ResourceNotFoundException'].includes(e.awsCode))return true;throw e;}}
function fixed(condition){if(!condition)throw new Error('PREFLIGHT_SCOPE_OR_DRIFT_GUARD');}
export function endpointPolicy(original,add){
  fixed(original?.Version==='2012-10-17' && Array.isArray(original.Statement));
  const owned=original.Statement.filter(s=>s.Sid===T.sid);
  const grant={Sid:T.sid,Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:T.secret,
    Condition:{ArnEquals:{'aws:PrincipalArn':roleArn}}};
  if(add){fixed(!owned.length);return {...original,Statement:[...original.Statement,grant]};}
  fixed(owned.length===1 && hash(owned[0])===hash(grant));return {...original,Statement:original.Statement.filter(s=>s.Sid!==T.sid)};
}
export function executionPolicy(){
  const eni=['ec2:CreateNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets',
    'ec2:DeleteNetworkInterface','ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'];
  return {Version:'2012-10-17',Statement:[
    {Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.secret},
    {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${T.account}:log-group:${group}:*`},
    {Effect:'Allow',Action:eni,Resource:'*'},
    {Effect:'Deny',Action:eni,Resource:'*',Condition:{ArnEquals:{'lambda:SourceFunctionArn':FUNCTION_ARN}}}
  ]};
}
export function invokePolicy(resource=FUNCTION_ARN){
  fixed(resource===FUNCTION_ARN || (resource.startsWith(FUNCTION_ARN+':') && /^[1-9][0-9]*$/.test(resource.slice(FUNCTION_ARN.length+1))));
  return {Version:'2012-10-17',Statement:[{Sid:'OperatorOnly',Effect:'Deny',Principal:'*',
    Action:'lambda:InvokeFunction',Resource:resource===FUNCTION_ARN?[FUNCTION_ARN,FUNCTION_ARN+':*']:[resource],
    Condition:{ArnNotEquals:{'aws:PrincipalArn':T.operator}}}]};
}
function checkCaller(){
  const caller=aws(['sts','get-caller-identity']);fixed(caller.Account===T.account && /^arn:aws:sts::130165494095:assumed-role\/AccountFullAccessRole\//.test(caller.Arn));
  fixed(aws(['iam','get-role','--role-name','AccountFullAccessRole','--query','Role.Arn'])===T.operator);
}
function readEndpoint(){
  const e=aws(['ec2','describe-vpc-endpoints','--vpc-endpoint-ids',T.endpoint]).VpcEndpoints?.[0];
  fixed(e?.VpcEndpointId===T.endpoint && e.ServiceName==='com.amazonaws.ap-southeast-2.secretsmanager');return JSON.parse(e.PolicyDocument);
}
function baseline(){
  const fn=name=>aws(['lambda','get-function-configuration','--function-name',name,'--query','{Code:CodeSha256,Revision:RevisionId,Role:Role,Timeout:Timeout,Handler:Handler,Vpc:VpcConfig}']);
  return {api:fn('coed-api'),tu:fn('coed-tu-auth'),endpoint:readEndpoint(),
    integrations:aws(['apigatewayv2','get-integrations','--api-id','yhfevhqtoa','--query','Items'])};
}
function statePath(path){
  const full=resolve(path),rel=relative(join(root,'tmp/main-alignment'),full);
  fixed(/^tu-preflight-[A-Za-z0-9]+[\\/]state\.json$/.test(rel) && !rel.startsWith('..'));
  fixed(!lstatSync(full).isSymbolicLink() && !lstatSync(resolve(full,'..')).isSymbolicLink());return full;
}
function load(path){const s=JSON.parse(readFileSync(statePath(path),'utf8'));
  fixed(s.format==='coed-tu-preflight-state-v1' && s.target===FUNCTION_ARN && /^[a-f0-9]{32}$/.test(s.runId));return s;}
function save(path,state){writeFileSync(statePath(path),JSON.stringify(state,null,2)+'\n');}
function assertOwnedTags(actual,state){fixed(actual?.coedTask===tags.coedTask && actual?.runId===state.runId);}
export async function buildArtifact(ca){
  publicCa(ca);mkdirSync(join(root,'tmp/main-alignment'),{recursive:true});
  const dir=mkdtempSync(join(root,'tmp/main-alignment/tu-preflight-')),stage=join(dir,'stage');mkdirSync(stage);
  const result=await build({absWorkingDir:root,entryPoints:['scripts/operations/tu-preflight/reader.js'],outfile:join(stage,'handler.js'),
    bundle:true,platform:'node',target:'node22',format:'cjs',external:['pg-native'],sourcemap:false,legalComments:'none',metafile:true,logLevel:'warning'});
  const inputs=Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('node_modules/')).sort();
  fixed(JSON.stringify(inputs)===JSON.stringify(['scripts/operations/tu-preflight/catalog.js','scripts/operations/tu-preflight/reader.js','src/db/rds-secret.js']));
  writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});
  const zip=join(dir,'diagnostic.zip');createZip(stage,zip,['handler.js','global-bundle.pem']);
  fixed(JSON.stringify(listZipEntries(zip).sort())===JSON.stringify(['global-bundle.pem','handler.js']));
  const state={format:'coed-tu-preflight-state-v1',target:FUNCTION_ARN,runId:randomBytes(16).toString('hex'),
    zipSha256:hash(readFileSync(zip)),caSha256:hash(ca),sourceInputs:inputs,createdAt:new Date().toISOString(),
    owned:{},invocations:0,status:'LOCAL_ONLY_NOT_DEPLOYED'};
  const path=join(dir,'state.json');writeFileSync(path,JSON.stringify(state,null,2)+'\n',{flag:'wx'});return {path,state};
}
async function deploy(path,state){
  checkCaller();fixed(!Object.values(state.owned).some(Boolean) && state.status==='LOCAL_ONLY_NOT_DEPLOYED');
  fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]));
  fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups?.some(g=>g.logGroupName===group));
  state.baseline=baseline();state.expiresAt=new Date(Date.now()+7200000).toISOString();save(path,state);
  fixed(state.baseline.api.Code==='/0B5tQMbjcxxZDDsbLOd4+K7McqH9OAL0r5vJw9hU44=' &&
    state.baseline.tu.Code==='IwMiSvavUadk27YoGWGYWj5vZAXAO83okw/GNkEGfY0=' &&
    state.baseline.api.Role===`arn:aws:iam::${T.account}:role/coed-v4-api-role` &&
    state.baseline.tu.Role===`arn:aws:iam::${T.account}:role/coed-tu-auth-role`);
  const tagList=[...Object.entries({...tags,runId:state.runId})].map(([Key,Value])=>({Key,Value}));
  const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
  const role=aws(['iam','create-role','--role-name',T.role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList)]).Role;
  fixed(role?.Arn===roleArn);state.owned.role=true;state.roleId=role.RoleId;save(path,state);
  aws(['iam','put-role-policy','--role-name',T.role,'--policy-name',policyName,'--policy-document',JSON.stringify(executionPolicy())]);
  aws(['logs','create-log-group','--log-group-name',group,'--tags',JSON.stringify({...tags,runId:state.runId})]);state.owned.logs=true;save(path,state);
  aws(['logs','put-retention-policy','--log-group-name',group,'--retention-in-days','1']);
  const policy=readEndpoint();fixed(hash(policy)===hash(state.baseline.endpoint));const added=endpointPolicy(policy,true);
  aws(['ec2','modify-vpc-endpoint','--vpc-endpoint-id',T.endpoint,'--policy-document',JSON.stringify(added)]);
  state.owned.endpoint=true;save(path,state);fixed(hash(readEndpoint())===hash(added));
  const zip=join(resolve(path,'..'),'diagnostic.zip');fixed(hash(readFileSync(zip))===state.zipSha256);
  const env={NODE_ENV:'production',PREFLIGHT_ENABLED:'false',PREFLIGHT_RUN_ID:state.runId,PREFLIGHT_EXPIRES_AT:state.expiresAt};
  let fn;
  for(let i=0;i<6;i++){
    try{fn=aws(['lambda','create-function','--function-name',T.name,'--runtime','nodejs22.x','--role',roleArn,'--handler','handler.handler',
      '--timeout','15','--memory-size','256','--zip-file','fileb://'+zip,'--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),
      '--environment',JSON.stringify({Variables:env}),'--tags',JSON.stringify({...tags,runId:state.runId})]);break;}
    catch(e){if(!e.rolePropagation || i===5)throw e;await delay(2000);}
  }
  fixed(fn?.FunctionArn===FUNCTION_ARN);state.owned.function=true;state.status='DIAGNOSTIC_CREATED_DISABLED';save(path,state);
  aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','1']);
  aws(['lambda','put-resource-policy','--resource-arn',FUNCTION_ARN,'--policy',JSON.stringify(invokePolicy())]);
  return state;
}
function configuration(state){
  const f=aws(['lambda','get-function','--function-name',T.name]);assertOwnedTags(f.Tags,state);
  fixed(f.Configuration.Role===roleArn && f.Configuration.CodeSha256===Buffer.from(state.zipSha256,'hex').toString('base64'));
  return f.Configuration;
}
async function activate(path,state){
  checkCaller();const config=configuration(state);fixed(state.owned.function && state.owned.endpoint);
  if(config.State!=='Active' || config.LastUpdateStatus==='InProgress')return {status:'WAIT_FOR_LAMBDA_ACTIVE',state:path};
  if(config.Environment?.Variables?.PREFLIGHT_ENABLED!=='true'){
    aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',config.RevisionId,
      '--environment',JSON.stringify({Variables:{NODE_ENV:'production',PREFLIGHT_ENABLED:'true',PREFLIGHT_RUN_ID:state.runId,PREFLIGHT_EXPIRES_AT:state.expiresAt}})]);
    return {status:'WAIT_FOR_ENABLED_UPDATE',state:path};
  }
  if(!state.version){const v=aws(['lambda','publish-version','--function-name',T.name,'--code-sha256',config.CodeSha256,'--revision-id',config.RevisionId]);
    fixed(/^[1-9][0-9]*$/.test(v.Version));state.version=v.Version;save(path,state);}
  aws(['lambda','put-resource-policy','--resource-arn',FUNCTION_ARN+':'+state.version,'--policy',JSON.stringify(invokePolicy(FUNCTION_ARN+':'+state.version))]);
  state.status='READY_FOR_METADATA_ONLY';save(path,state);return {status:state.status,version:state.version,state:path};
}
function invoke(path,state,mode='metadata'){
  fixed(['metadata','schema'].includes(mode));
  checkCaller();configuration(state);fixed(state.status==='READY_FOR_METADATA_ONLY' && /^[1-9][0-9]*$/.test(state.version) && state.invocations<30 && Date.parse(state.expiresAt)>Date.now());
  const responseFile=join(resolve(path,'..'),`result-${state.invocations+1}.json`);fixed(!existsSync(responseFile));
  state.invocations++;save(path,state);
  const response=aws(['lambda','invoke','--function-name',FUNCTION_ARN+':'+state.version,'--invocation-type','RequestResponse','--log-type','None',
    '--cli-binary-format','raw-in-base64-out','--payload',JSON.stringify({contract:T.contract,runId:state.runId,mode}),responseFile],{timeout:25000});
  fixed(response.StatusCode===200 && !response.FunctionError && response.ExecutedVersion===state.version && lstatSync(responseFile).size<=(mode==='schema'?1000000:120000));
  const value=JSON.parse(readFileSync(responseFile,'utf8'));fixed(value.contract===T.contract && typeof value.ok==='boolean');
  return {status:value.ok?'METADATA_READ_COMPLETE':'METADATA_READ_FAILED_SAFE',resultFile:responseFile,
    result:mode==='schema'?{ok:value.ok,error:value.error,bytes:lstatSync(responseFile).size}:value};
}
function cleanup(path,state){
  checkCaller();const completed=[];
  if(!absent(['lambda','get-function-configuration','--function-name',T.name])){
    configuration(state);aws(['lambda','put-function-concurrency','--function-name',T.name,'--reserved-concurrent-executions','0']);
    aws(['lambda','delete-function','--function-name',T.name]);completed.push('temporary function/versions deleted');
  }
  const current=readEndpoint();
  if(current.Statement.some(s=>s.Sid===T.sid)){
    const restored=endpointPolicy(current,false);aws(['ec2','modify-vpc-endpoint','--vpc-endpoint-id',T.endpoint,'--policy-document',JSON.stringify(restored)]);
    fixed(hash(readEndpoint())===hash(restored));completed.push('owned endpoint statement removed');
  }
  fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn));
  if(!absent(['iam','get-role','--role-name',T.role])){
    const role=aws(['iam','get-role','--role-name',T.role]).Role;
    assertOwnedTags(Object.fromEntries(role.Tags.map(t=>[t.Key,t.Value])),state);fixed(role.RoleId===state.roleId);
    fixed(!aws(['iam','list-attached-role-policies','--role-name',T.role]).AttachedPolicies.length);
    const names=aws(['iam','list-role-policies','--role-name',T.role]).PolicyNames;fixed(names.every(name=>name===policyName));
    for(const name of names)aws(['iam','delete-role-policy','--role-name',T.role,'--policy-name',name]);
    aws(['iam','delete-role','--role-name',T.role]);completed.push('temporary role/policy deleted');
  }
  if(aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups?.some(g=>g.logGroupName===group)){
    assertOwnedTags(aws(['logs','list-tags-log-group','--log-group-name',group]).tags,state);
    aws(['logs','delete-log-group','--log-group-name',group]);completed.push('temporary log group deleted');
  }
  fixed(absent(['lambda','get-function-configuration','--function-name',T.name]) && absent(['iam','get-role','--role-name',T.role]));
  const after=baseline();fixed(hash(after.api)===hash(state.baseline.api) && hash(after.tu)===hash(state.baseline.tu) && hash(after.integrations)===hash(state.baseline.integrations));
  fixed(!after.endpoint.Statement.some(s=>s.Sid===T.sid));
  state.status='CLEANED_UP';state.cleanup={completed,endpointEqualsOriginal:hash(after.endpoint)===hash(state.baseline.endpoint),applicationUnchanged:true,checkedAt:new Date().toISOString()};
  save(path,state);return {status:state.status,...state.cleanup};
}
async function main(){
  const [mode,path,approval]=process.argv.slice(2);
  if(mode==='build' && !path){const response=await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',{redirect:'error',signal:AbortSignal.timeout(15000)});
    fixed(response.ok);const ca=Buffer.from(await response.arrayBuffer());fixed(ca.length<1024*1024);const built=await buildArtifact(ca);
    console.log(JSON.stringify({status:built.state.status,state:built.path,zipSha256:built.state.zipSha256}));return;}
  fixed(['deploy','activate','invoke','invoke-schema','cleanup'].includes(mode) &&
    ['--approved-d0-d6','--approved-current-schema'].includes(approval) && process.argv.length===5);
  if(mode==='invoke-schema')fixed(approval==='--approved-current-schema');
  const state=load(path);
  const result=mode==='invoke-schema'?invoke(path,state,'schema'):await ({deploy,activate,invoke,cleanup}[mode])(path,state);
  console.log(JSON.stringify(mode==='deploy'?{status:result.status,state:path}:result,null,2));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
  // Report no raw SDK/CLI response, configuration body, SQL error or stack.
  console.error(JSON.stringify({status:'STOPPED_REVIEW_REQUIRED',code:e.awsCode || (e.message==='PREFLIGHT_SCOPE_OR_DRIFT_GUARD'?e.message:'LOCAL_OPERATION_FAILED'),cleanupMayBeRequired:true}));process.exitCode=1;
});
