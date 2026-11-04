import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {aws as realAws} from '../tu-preflight/operator.mjs';
export let aws=realAws;
export function useTestAws(fn){
 fixed(process.env.NODE_ENV==='test' && typeof fn==='function','TEST_TRANSPORT_ONLY');
 aws=fn;return ()=>{aws=realAws;};
}
export const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
export const A='130165494095',REGION='ap-southeast-2',API='yhfevhqtoa';
export const OPERATOR='arn:aws:iam::130165494095:role/managed/AccountFullAccessRole';
export const PROVIDER='arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/tu/provider-F1HRIZ';
export const TAG='tu-production-20261105';
export function fixed(ok,code='PRODUCTION_SCOPE_OR_DRIFT'){if(!ok){const e=Error(code);e.safeCode=code;throw e;}}
const canonical=v=>Array.isArray(v)?v.map(canonical):v && typeof v==='object'
 ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=bytes=>createHash('sha256').update(typeof bytes==='string' || Buffer.isBuffer(bytes)?bytes:(JSON.stringify(canonical(bytes)) ?? 'undefined')).digest('hex');
export const arn=name=>'arn:aws:lambda:'+REGION+':'+A+':function:'+name;
export const roleArn=name=>'arn:aws:iam::'+A+':role/'+name;
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function caller(){
 const c=aws(['sts','get-caller-identity']);fixed(c.Account===A && /^arn:aws:sts::130165494095:assumed-role\/AccountFullAccessRole\//.test(c.Arn));
 fixed(aws(['iam','get-role','--role-name','AccountFullAccessRole','--query','Role.Arn'])===OPERATOR);
}
export function absent(args){try{aws(args);return false;}catch(e){if(['NoSuchEntity','ResourceNotFoundException'].includes(e.awsCode))return true;throw e;}}
export function statePath(path){
 const full=resolve(path),rel=relative(join(ROOT,'tmp/tu-production'),full);
 fixed(/^production-[A-Za-z0-9]+[\\/]state\.json$/.test(rel));
 fixed(!lstatSync(full).isSymbolicLink() && !lstatSync(resolve(full,'..')).isSymbolicLink());return full;
}
export function save(path,s){writeFileSync(statePath(path),JSON.stringify(s,null,2)+'\n');}
export function load(path){
 const s=JSON.parse(readFileSync(statePath(path),'utf8'));
 fixed(s.format==='coed-tu-production-v1' && s.account===A && /^[a-f0-9]{32}$/.test(s.runId));return s;
}
export const tags=s=>({coedTask:TAG,runId:s.runId});
export const tagList=s=>Object.entries(tags(s)).map(([Key,Value])=>({Key,Value}));
export function owned(actual,s){fixed(actual?.coedTask===TAG && actual?.runId===s.runId,'TASK_OWNERSHIP_MISMATCH');}
export function cleanSource(){
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 const dirty=execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim();
 return {head,dirty:!!dirty};
}
export function preflightSource(s){const c=cleanSource();fixed(!c.dirty && c.head===s.source.head,'COMMITTED_SOURCE_CHANGED');}
export function endpoint(){
 const r=aws(['ec2','describe-vpc-endpoints','--vpc-endpoint-ids','vpce-08e95353a534b9e27']).VpcEndpoints?.[0];
 fixed(r?.ServiceName==='com.amazonaws.ap-southeast-2.secretsmanager');return JSON.parse(r.PolicyDocument);
}
export function addStatement(policy,statement){
 fixed(policy?.Version==='2012-10-17' && Array.isArray(policy.Statement));
 const found=policy.Statement.filter(x=>x.Sid===statement.Sid);
 if(found.length){fixed(found.length===1 && hash(found[0])===hash(statement));return policy;}
 return {...policy,Statement:[...policy.Statement,statement]};
}
export function removeStatement(policy,statement){
 const found=policy.Statement.filter(x=>x.Sid===statement.Sid);if(!found.length)return policy;
 fixed(found.length===1 && hash(found[0])===hash(statement));return {...policy,Statement:policy.Statement.filter(x=>x.Sid!==statement.Sid)};
}
export function setEndpoint(expected,next){
 fixed(hash(endpoint())===hash(expected));aws(['ec2','modify-vpc-endpoint','--vpc-endpoint-id','vpce-08e95353a534b9e27','--policy-document',JSON.stringify(next)]);
 fixed(hash(endpoint())===hash(next));
}
export function denyInvoke(name,principals,resource=arn(name)){
 fixed(Array.isArray(principals) && principals.includes(OPERATOR));
 return {Version:'2012-10-17',Statement:[{Sid:'CoedRestrictedInvoke',Effect:'Deny',Principal:'*',
  Action:'lambda:InvokeFunction',Resource:resource===arn(name)?[resource,resource+':*']:[resource],
  Condition:{ArnNotEquals:{'aws:PrincipalArn':principals}}}]};
}
export function putDeny(name,principals,qualifier){
 const resource=arn(name)+(qualifier?':'+qualifier:'');
 // Only a newly owned function with our exact empty/owned policy is handled here.
 let old;try{old=aws(['lambda','get-resource-policy','--resource-arn',resource]);}
 catch(e){if(e.awsCode!=='ResourceNotFoundException')throw e;}
 const policy=denyInvoke(name,principals,resource);
 if(old){fixed(hash(JSON.parse(old.Policy))===hash(policy));return;}
 aws(['lambda','put-resource-policy','--resource-arn',resource,'--policy',JSON.stringify(policy)]);
 const after=aws(['lambda','get-resource-policy','--resource-arn',resource]);fixed(hash(JSON.parse(after.Policy))===hash(policy));
}
export async function waitActive(name){
 for(let i=0;i<50;i++){
  const c=aws(['lambda','get-function-configuration','--function-name',name]);
  if(c.State==='Active' && c.LastUpdateStatus!=='InProgress'){fixed(c.LastUpdateStatus!=='Failed');return c;}
  fixed(c.State!=='Failed' && c.LastUpdateStatus!=='Failed');await delay(1200);
 }
 throw Error('FUNCTION_NOT_ACTIVE_YET');
}
export function eniPolicy(name){
 const Action=['ec2:CreateNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets','ec2:DeleteNetworkInterface',
  'ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'];
 return [{Effect:'Allow',Action,Resource:'*'},
 {Effect:'Deny',Action,Resource:'*',Condition:{ArnEquals:{'lambda:SourceFunctionArn':arn(name)}}}];
}
export function safeConfig(c){
 return {name:c.FunctionName,hash:c.CodeSha256,revision:c.RevisionId,role:c.Role,handler:c.Handler,
  runtime:c.Runtime,timeout:c.Timeout,memory:c.MemorySize,vpc:c.VpcConfig,envKeys:Object.keys(c.Environment?.Variables || {}).sort()};
}
export function sdkCredentials(){
 try{
  const c=JSON.parse(execFileSync('aws',['configure','export-credentials','--profile','coed-v4','--format','process'],
   {encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:30000}));
  fixed(c.AccessKeyId && c.SecretAccessKey && c.SessionToken);
  return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken};
 }catch{throw Error('SECURE_CREDENTIAL_EXPORT_FAILED');}
}
export function safeFailure(e){
 const code=e.awsCode || e.safeCode || 'PRODUCTION_OPERATION_STOPPED';
 return {status:'STOPPED_REVIEW_REQUIRED',code:/^[A-Z][A-Za-z0-9_]+$/.test(code)?code:'PRODUCTION_OPERATION_STOPPED',
  noAutomaticRollback:true,checkStateBeforeCleanup:true};
}
