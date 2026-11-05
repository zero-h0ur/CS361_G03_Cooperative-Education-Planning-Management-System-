import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {aws,A,REGION,OPERATOR,arn,roleArn,fixed,save,caller,tagList,owned,absent,delay} from './common.mjs';
const NAME='coed-tu-issuer-probe-20261105',POLICY='CoedIssuerDryRunOnly',ISSUER='coed-tu-session-issuer';
export function cleanupProbe(path,s){
 if(!absent(['iam','get-role','--role-name',NAME])){
  const r=aws(['iam','get-role','--role-name',NAME]).Role;owned(Object.fromEntries(r.Tags.map(t=>[t.Key,t.Value])),s);
  fixed(r.RoleId===s.probeRoleId && !aws(['iam','list-attached-role-policies','--role-name',NAME]).AttachedPolicies.length);
  const p=aws(['iam','list-role-policies','--role-name',NAME]).PolicyNames;fixed(p.every(x=>x===POLICY));
  for(const name of p)aws(['iam','delete-role-policy','--role-name',NAME,'--policy-name',name]);
  aws(['iam','delete-role','--role-name',NAME]);
 }
 s.owned.probeRole=false;save(path,s);
}
export async function negativeIam(path,s){
 caller();fixed(s.candidatesReady && s.maintenance?.active && !s.iamNegative);
 fixed(absent(['iam','get-role','--role-name',NAME]));
 const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{AWS:OPERATOR},Action:'sts:AssumeRole'}]};
 const role=aws(['iam','create-role','--role-name',NAME,'--assume-role-policy-document',JSON.stringify(trust),'--tags',JSON.stringify(tagList(s))]).Role;
 s.owned.probeRole=true;s.probeRoleId=role.RoleId;save(path,s);
 try{
  const policy={Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'lambda:InvokeFunction',Resource:[arn(ISSUER),arn(ISSUER)+':*']}]};
  aws(['iam','put-role-policy','--role-name',NAME,'--policy-name',POLICY,'--policy-document',JSON.stringify(policy)]);
  let c;
  for(let i=0;i<8;i++){
   try{c=aws(['sts','assume-role','--role-arn',roleArn(NAME),'--role-session-name','CoedIssuerDryRun','--duration-seconds','900']).Credentials;break;}
   catch(e){if(e.awsCode!=='AccessDenied' || i===7)throw e;await delay(2000);}
  }
  fixed(c?.AccessKeyId && c.SecretAccessKey && c.SessionToken);
  const lambda=new LambdaClient({region:REGION,maxAttempts:1,credentials:{accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken}});
  const denied=[];
  for(const qualifier of ['',':candidate',':'+s.versions[ISSUER].candidate]){
   try{await lambda.send(new InvokeCommand({FunctionName:arn(ISSUER)+qualifier,InvocationType:'DryRun'}));throw Error('PROBE_UNEXPECTEDLY_ALLOWED');}
   catch(e){fixed(e.name==='AccessDeniedException' || e.name==='AccessDenied','PROBE_UNEXPECTED_RESULT');denied.push(qualifier || 'unqualified');}
  }
  s.iamNegative={passed:true,denied,checkedAt:new Date().toISOString(),noFunctionExecution:true};save(path,s);
  return {status:'IAM_EXPLICIT_DENY_VERIFIED',...s.iamNegative};
 }finally{cleanupProbe(path,s);}
}
export function alarms(path,s){
 caller();fixed(s.candidatesReady && s.iamNegative?.passed);
 s.alarmNames ||= [];
 for(const functionName of ['coed-tu-auth','coed-tu-session-issuer']){
  const name=functionName+'-runtime-errors';
  if(s.alarmNames.includes(name))continue;
  fixed(!aws(['cloudwatch','describe-alarms','--alarm-names',name]).MetricAlarms?.length);
  aws(['cloudwatch','put-metric-alarm','--alarm-name',name,'--alarm-description',
   'CO-ED Lambda runtime errors. Handled authentication HTTP failures require separate safe-log monitoring.',
   '--namespace','AWS/Lambda','--metric-name','Errors','--dimensions','Name=FunctionName,Value='+functionName,
   '--statistic','Sum','--period','60','--evaluation-periods','1','--threshold','1',
   '--comparison-operator','GreaterThanOrEqualToThreshold','--treat-missing-data','notBreaching','--tags',JSON.stringify(tagList(s))]);
  s.alarmNames.push(name);save(path,s);
 }
 return {status:'RUNTIME_ALARMS_CONFIGURED',handledHttpErrorsRequireLogReview:true,notificationsConfigured:false};
}
