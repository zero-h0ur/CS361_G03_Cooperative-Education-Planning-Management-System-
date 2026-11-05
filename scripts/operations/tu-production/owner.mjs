import {readFileSync,existsSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {TARGET as T,FUNCTION_ARN} from '../tu-owner/handler.mjs';
import {aws,fixed,hash,save,caller,owned,tags,tagList,roleArn,arn,absent,endpoint,addStatement,removeStatement,setEndpoint,
 eniPolicy,denyInvoke,putDeny,waitActive,OPERATOR,REGION,A,delay} from './common.mjs';
const name=T.name,role=T.role,group='/aws/lambda/'+name,policyName='CoedOwnerBoundedOnly';
export function ownerEndpoint(s){
 return [{Sid:T.sid,Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',
  Resource:[T.ownerSecret,s.loginSecret],Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(role)}}},
  {Sid:T.sid+'WriteLogin',Effect:'Allow',Principal:'*',Action:'secretsmanager:PutSecretValue',
   Resource:s.loginSecret,Condition:{ArnEquals:{'aws:PrincipalArn':roleArn(role)}}}];
}
export function ownerExecution(s){
 return {Version:'2012-10-17',Statement:[
  {Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:[T.ownerSecret,s.loginSecret]},
  {Effect:'Allow',Action:'secretsmanager:PutSecretValue',Resource:s.loginSecret},
  {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:'arn:aws:logs:'+REGION+':'+A+':log-group:'+group+':*'},
  ...eniPolicy(name)]};
}
function env(s,enabled,trial=false){
 fixed(s.snapshot?.status==='available' && s.maintenance?.active===true && s.loginSecret);
 return {NODE_ENV:'production',OWNER_ENABLED:String(enabled),OWNER_MAINTENANCE:'true',OWNER_SNAPSHOT_VERIFIED:'true',
  OWNER_RUN_ID:s.runId,OWNER_EXPIRES_AT:s.ownerExpiresAt,OWNER_LOGIN_SECRET_ARN:s.loginSecret,
  OWNER_TRIAL_SUCCEEDED:String(trial),OWNER_ROLE_SQL_SHA256:s.roleSqlSha256};
}
function configuration(s){
 const f=aws(['lambda','get-function','--function-name',name]);owned(f.Tags,s);
 fixed(f.Configuration.Role===roleArn(role) && f.Configuration.CodeSha256===Buffer.from(s.artifacts.owner.sha256,'hex').toString('base64'));
 return f.Configuration;
}
export async function ownerDeploy(path,s){
 caller();fixed(s.snapshot?.status==='available' && s.maintenance?.active===true && !s.owned.ownerRole && !s.owned.ownerFunction);
 fixed(absent(['lambda','get-function-configuration','--function-name',name]) && absent(['iam','get-role','--role-name',role]));
 fixed(!aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group));
 const snapshot=aws(['rds','describe-db-snapshots','--db-snapshot-identifier',s.snapshot.id]).DBSnapshots?.[0];
 fixed(snapshot?.Status==='available' && snapshot.DBInstanceIdentifier==='database-coed-postgres');
 const secret=aws(['secretsmanager','describe-secret','--secret-id',s.loginSecret]);owned(Object.fromEntries(secret.Tags.map(t=>[t.Key,t.Value])),s);
 fixed(secret.Name==='coed/v4/postgres/tu-login' && !secret.DeletedDate);
 s.ownerExpiresAt=new Date(Date.now()+7200000).toISOString();save(path,s);
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]};
 const created=aws(['iam','create-role','--role-name',role,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;
 fixed(created.Arn===roleArn(role));s.ownerRoleId=created.RoleId;s.owned.ownerRole=true;save(path,s);
 aws(['iam','put-role-policy','--role-name',role,'--policy-name',policyName,'--policy-document',JSON.stringify(ownerExecution(s))]);
 aws(['logs','create-log-group','--log-group-name',group,'--tags',JSON.stringify(tags(s))]);s.owned.ownerLogs=true;save(path,s);
 aws(['logs','put-retention-policy','--log-group-name',group,'--retention-in-days','1']);
 const before=endpoint(),after=ownerEndpoint(s).reduce(addStatement,before);s.ownerEndpoint=ownerEndpoint(s);save(path,s);
 setEndpoint(before,after);s.owned.ownerEndpoint=true;save(path,s);
 const bytes=readFileSync(s.artifacts.owner.file);fixed(hash(bytes)===s.artifacts.owner.sha256);
 let f;
 for(let i=0;i<8;i++){
  try{f=aws(['lambda','create-function','--function-name',name,'--runtime','nodejs22.x','--role',roleArn(role),
   '--handler','scripts/operations/tu-owner/handler.handler','--timeout','90','--memory-size','256',
   '--zip-file','fileb://'+s.artifacts.owner.file,'--vpc-config',JSON.stringify({SubnetIds:[T.subnet],SecurityGroupIds:[T.sg]}),
   '--environment',JSON.stringify({Variables:env(s,false)}),'--tags',JSON.stringify(tags(s))]);break;}
  catch(e){if(!e.rolePropagation || i===7)throw e;await delay(2000);}
 }
 fixed(f.FunctionArn===FUNCTION_ARN);s.owned.ownerFunction=true;save(path,s);
 aws(['lambda','put-function-concurrency','--function-name',name,'--reserved-concurrent-executions','1']);
 putDeny(name,[OPERATOR]);await waitActive(name);
 return {status:'OWNER_CREATED_DISABLED'};
}
export async function ownerActivate(path,s,trial=false){
 caller();fixed(s.owned.ownerFunction && Date.parse(s.ownerExpiresAt)>Date.now());
 if(trial)fixed(s.ownerTrial?.ok && s.ownerTrial.result?.preservationVerified);
 const c=configuration(s);
 aws(['lambda','update-function-configuration','--function-name',name,'--revision-id',c.RevisionId,
  '--environment',JSON.stringify({Variables:env(s,true,trial)})]);
 const ready=await waitActive(name),published=aws(['lambda','publish-version','--function-name',name,
  '--code-sha256',ready.CodeSha256,'--revision-id',ready.RevisionId]);
 fixed(/^[1-9][0-9]*$/.test(published.Version));putDeny(name,[OPERATOR],published.Version);
 s.ownerVersion=published.Version;s.status=trial?'OWNER_READY_APPLY':'OWNER_READY_TRIAL';save(path,s);
 return {status:s.status,version:s.ownerVersion};
}
export function ownerInvoke(path,s,mode){
 caller();fixed(['trial','apply','login'].includes(mode) && s.ownerVersion && s.ownerInvocations<10 &&
  s.maintenance?.active===true && Date.parse(s.ownerExpiresAt)>Date.now());
 configuration(s);
 if(mode==='apply')fixed(s.status==='OWNER_READY_APPLY' && s.ownerTrial?.ok && !s.ownerApplied);
 if(mode==='login')fixed(s.ownerApplied && !s.loginReady);
 const file=join(dirname(path),'owner-result-'+(s.ownerInvocations+1)+'.json');fixed(!existsSync(file));
 s.ownerInvocations++;save(path,s);
 const invoked=aws(['lambda','invoke','--function-name',FUNCTION_ARN+':'+s.ownerVersion,
  '--invocation-type','RequestResponse','--log-type','None','--cli-binary-format','raw-in-base64-out',
  '--payload',JSON.stringify({contract:T.contract,runId:s.runId,mode}),'--cli-read-timeout','110',file],{timeout:115000});
 fixed(invoked.StatusCode===200 && !invoked.FunctionError && invoked.ExecutedVersion===s.ownerVersion && lstatSync(file).size<5000);
 const value=JSON.parse(readFileSync(file,'utf8'));fixed(value.contract===T.contract);
 if(!value.ok){s.lastOwnerError=value.error;save(path,s);return value;}
 if(mode==='trial'){s.ownerTrial=value;s.status='OWNER_TRIAL_PASSED';}
 if(mode==='apply'){fixed(value.result?.applied===true && value.result.preservationVerified);s.ownerApplied=true;s.status='OWNER_APPLIED';}
 if(mode==='login'){fixed(value.result?.selectOnlyContractVerified && value.result.loginConnectionVerified);s.loginReady=true;s.status='LOGIN_READY';}
 save(path,s);return value;
}
export function ownerCleanup(path,s){
 caller();
 if(!absent(['lambda','get-function-configuration','--function-name',name])){
  configuration(s);aws(['lambda','put-function-concurrency','--function-name',name,'--reserved-concurrent-executions','0']);
  aws(['lambda','delete-function','--function-name',name]);s.owned.ownerFunction=false;save(path,s);
 }
 const before=endpoint(),after=ownerEndpoint(s).reduce(removeStatement,before);if(hash(before)!==hash(after))setEndpoint(before,after);
 s.owned.ownerEndpoint=false;save(path,s);
 fixed(!aws(['lambda','list-functions','--query','Functions[].Role']).includes(roleArn(role)));
 if(!absent(['iam','get-role','--role-name',role])){
  const r=aws(['iam','get-role','--role-name',role]).Role;owned(Object.fromEntries(r.Tags.map(t=>[t.Key,t.Value])),s);fixed(r.RoleId===s.ownerRoleId);
  fixed(!aws(['iam','list-attached-role-policies','--role-name',role]).AttachedPolicies.length);
  const policies=aws(['iam','list-role-policies','--role-name',role]).PolicyNames;fixed(policies.every(x=>x===policyName));
  for(const p of policies)aws(['iam','delete-role-policy','--role-name',role,'--policy-name',p]);
  aws(['iam','delete-role','--role-name',role]);s.owned.ownerRole=false;save(path,s);
 }
 if(aws(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups.some(g=>g.logGroupName===group)){
  owned(aws(['logs','list-tags-log-group','--log-group-name',group]).tags,s);aws(['logs','delete-log-group','--log-group-name',group]);
  s.owned.ownerLogs=false;save(path,s);
 }
 fixed(absent(['lambda','get-function-configuration','--function-name',name]) && absent(['iam','get-role','--role-name',role]));
 s.ownerCleanedAt=new Date().toISOString();save(path,s);return {status:'OWNER_CLEANED_UP',retainedLoginSecret:true};
}
