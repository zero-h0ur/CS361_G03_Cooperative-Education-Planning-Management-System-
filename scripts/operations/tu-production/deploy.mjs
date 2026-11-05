import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageProduction} from './package.mjs';
import {ownerDeploy,ownerActivate,ownerInvoke,ownerCleanup} from './owner.mjs';
import {stageApplications,candidateChecks,routeVerification,repairBrokerPublicKey,resumeAfterOwnerSmoke,retireTemporaryTuMaintenance,report} from './application.mjs';
import {negativeIam,alarms,cleanupProbe} from './probe.mjs';
import {aws,A,REGION,API,PROVIDER,arn,fixed,hash,load,save,caller,preflightSource,safeConfig,
 waitActive,tagList,owned,absent,safeFailure} from './common.mjs';
export const API_BASE='https://'+API+'.execute-api.'+REGION+'.amazonaws.com';
export function apiPermission(name,qualifier,sid,sourceArn){
 fixed(['coed-api','coed-tu-auth'].includes(name) && /^[A-Za-z0-9_-]+$/.test(qualifier));
 const args=['lambda','add-permission','--function-name',name,'--qualifier',qualifier,'--statement-id',sid,
  '--principal','apigateway.amazonaws.com','--action','lambda:InvokeFunction','--source-arn',sourceArn];
 aws(args);
}
export function integration(s,id,uri){
 const old=aws(['apigatewayv2','get-integration','--api-id',API,'--integration-id',id]);
 const expected=s.currentIntegrations?.[id] || s.baseline.integrations.find(x=>x.IntegrationId===id)?.IntegrationUri;
 fixed(old.IntegrationUri===expected,'INTEGRATION_DRIFT');
 aws(['apigatewayv2','update-integration','--api-id',API,'--integration-id',id,'--integration-uri',uri,
  ...(id==='sr47ns9'?['--timeout-in-millis','25000']:[])]);
 const after=aws(['apigatewayv2','get-integration','--api-id',API,'--integration-id',id]);fixed(after.IntegrationUri===uri);
 s.currentIntegrations={...s.currentIntegrations,[id]:uri};
}
export async function maintain(path,s,{fetchImpl=fetch,sourceCheck=preflightSource}={}){
 caller();sourceCheck(s);fixed(s.status==='LOCAL_ONLY' && !s.maintenance);
 const api=aws(['lambda','get-function-configuration','--function-name','coed-api']);
 const tu=aws(['lambda','get-function-configuration','--function-name','coed-tu-auth']);
 fixed(api.CodeSha256==='/0B5tQMbjcxxZDDsbLOd4+K7McqH9OAL0r5vJw9hU44=' &&
  tu.CodeSha256==='IwMiSvavUadk27YoGWGYWj5vZAXAO83okw/GNkEGfY0=');
 fixed(api.Handler==='src/lambda.handler' && tu.Handler==='src/lambda.handler');
 fixed(api.Role==='arn:aws:iam::'+A+':role/coed-v4-api-role' && tu.Role==='arn:aws:iam::'+A+':role/coed-tu-auth-role');
 fixed(JSON.stringify(api.VpcConfig?.SubnetIds?.slice().sort())===JSON.stringify(['subnet-0fb8a4985d4e48f03']) &&
  JSON.stringify(api.VpcConfig?.SecurityGroupIds?.slice().sort())===JSON.stringify(['sg-01157dbde4cba48ab']) &&
  !tu.VpcConfig?.VpcId,'NETWORK_BASELINE_DRIFT');
 const baseline={api:safeConfig(api),tu:safeConfig(tu),
  integrations:aws(['apigatewayv2','get-integrations','--api-id',API]).Items,
  routes:aws(['apigatewayv2','get-routes','--api-id',API]).Items,
  apiConfig:aws(['apigatewayv2','get-api','--api-id',API])};
 fixed(baseline.integrations.find(x=>x.IntegrationId==='ip14y62')?.IntegrationUri===arn('coed-api') &&
  baseline.integrations.find(x=>x.IntegrationId==='sr47ns9')?.IntegrationUri===arn('coed-tu-auth'));
 s.baseline=baseline;s.maintenance={startedAt:new Date().toISOString(),versions:{},active:false};save(path,s);
 fixed(hash(readFileSync(s.artifacts.maintenance.file))===s.artifacts.maintenance.sha256);
 for(const [name,old,id] of [['coed-api',api,'ip14y62'],['coed-tu-auth',tu,'sr47ns9']]){
  aws(['lambda','update-function-code','--function-name',name,'--revision-id',old.RevisionId,
   '--zip-file','fileb://'+s.artifacts.maintenance.file]);
  const ready=await waitActive(name);
  const v=aws(['lambda','publish-version','--function-name',name,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;
  fixed(/^[1-9][0-9]*$/.test(v));s.maintenance.versions[name]=v;save(path,s);
  apiPermission(name,v,'CoedMaintenance'+s.runId.slice(0,8),'arn:aws:execute-api:'+REGION+':'+A+':'+API+'/*/*/*');
  integration(s,id,arn(name)+':'+v);save(path,s);
 }
 return await confirmMaintenance(path,s,{fetchImpl});
}
export async function confirmMaintenance(path,s,{fetchImpl=fetch}={}){
 caller();fixed(s.maintenance?.versions?.['coed-api'] && s.maintenance.versions['coed-tu-auth']);
 for(const [name,id] of [['coed-api','ip14y62'],['coed-tu-auth','sr47ns9']]){
  const version=s.maintenance.versions[name];fixed(/^[1-9][0-9]*$/.test(version));
  const cfg=aws(['lambda','get-function-configuration','--function-name',name,'--qualifier',version]);
  fixed(cfg.CodeSha256===Buffer.from(s.artifacts.maintenance.sha256,'hex').toString('base64'));
  const current=aws(['apigatewayv2','get-integration','--api-id',API,'--integration-id',id]);
  fixed(current.IntegrationUri===arn(name)+':'+version);
 }
 // Cognito /api/v3/me rightly rejects anonymous requests at Gateway. Probe the
 // existing TU bridge without changing its normal Lambda authentication.
 for(const p of ['/api/tu-proxy/api/v3/me','/api/v3/auth/tu-status']){
  const r=await fetchImpl(API_BASE+p,{redirect:'error',signal:AbortSignal.timeout(10000)});
  fixed(r.status===503 && (await r.json()).error?.code==='COED_MAINTENANCE','MAINTENANCE_HTTP_NOT_CONFIRMED');
 }
 s.maintenance.active=true;s.status='MAINTENANCE';save(path,s);return {status:s.status};
}
export function snapshot(path,s){
 caller();fixed(s.maintenance?.active===true && !s.ownerApplied);
 if(!s.snapshot){
  s.snapshot={id:'coed-pre-tu-018-20261105-'+s.runId.slice(0,8),status:'planned',
   reviewAfter:new Date(Date.now()+7*86400000).toISOString(),restoreTested:false};save(path,s);
  aws(['rds','create-db-snapshot','--db-instance-identifier','database-coed-postgres',
   '--db-snapshot-identifier',s.snapshot.id,'--tags',JSON.stringify(tagList(s))]);
 }
 const r=aws(['rds','describe-db-snapshots','--db-snapshot-identifier',s.snapshot.id]).DBSnapshots?.[0];
 fixed(r?.DBInstanceIdentifier==='database-coed-postgres' && r.Encrypted && ['creating','available'].includes(r.Status));
 const snapshotTags=aws(['rds','list-tags-for-resource','--resource-name',r.DBSnapshotArn]).TagList;owned(Object.fromEntries(snapshotTags.map(t=>[t.Key,t.Value])),s);
 s.snapshot={...s.snapshot,status:r.Status,arn:r.DBSnapshotArn};save(path,s);
 return {status:r.Status==='available'?'SNAPSHOT_AVAILABLE':'SNAPSHOT_CREATING',id:s.snapshot.id,reviewAfter:s.snapshot.reviewAfter};
}
export function loginSecret(path,s){
 caller();fixed(s.snapshot?.status==='available' && s.maintenance?.active);
 if(s.loginSecret){
  const meta=aws(['secretsmanager','describe-secret','--secret-id',s.loginSecret]);
  owned(Object.fromEntries(meta.Tags.map(t=>[t.Key,t.Value])),s);return {status:'LOGIN_SECRET_ALREADY_OWNED'};
 }
 fixed(absent(['secretsmanager','describe-secret','--secret-id','coed/v4/postgres/tu-login']),'LOGIN_SECRET_ALREADY_EXISTS');
 const value=aws(['secretsmanager','create-secret','--name','coed/v4/postgres/tu-login',
  '--description','CO-ED SELECT-only TU session issuer database credential; populated privately by bounded owner tool',
  '--tags',JSON.stringify(tagList(s))]);
 s.loginSecret=value.ARN;s.owned.loginSecret=true;save(path,s);return {status:'EMPTY_LOGIN_SECRET_CREATED',arn:value.ARN};
}
async function main(){
 const [mode,path,approval]=process.argv.slice(2);
 if(mode==='build' && !path){
  const r=await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',{redirect:'error',signal:AbortSignal.timeout(20000)});
  fixed(r.ok);const out=await packageProduction(Buffer.from(await r.arrayBuffer()));
  console.log(JSON.stringify({status:'LOCAL_ONLY',state:out.path,source:out.state.source}));return;
 }
 fixed(approval==='--approved-p0-p6' && process.argv.length===5);
 const s=load(path);caller();
 let result;
 if(mode==='maintain')result=await maintain(path,s);
 else if(mode==='confirm-maintenance')result=await confirmMaintenance(path,s);
 else if(mode==='snapshot')result=snapshot(path,s);
 else if(mode==='login-secret')result=loginSecret(path,s);
 else if(mode==='owner-deploy')result=await ownerDeploy(path,s);
 else if(mode==='owner-activate')result=await ownerActivate(path,s,false);
 else if(mode==='owner-enable-apply')result=await ownerActivate(path,s,true);
 else if(mode==='owner-trial')result=ownerInvoke(path,s,'trial');
 else if(mode==='owner-apply')result=ownerInvoke(path,s,'apply');
 else if(mode==='owner-login')result=ownerInvoke(path,s,'login');
 else if(mode==='owner-cleanup')result=ownerCleanup(path,s);
 else if(mode==='stage-applications')result=await stageApplications(path,s);
 else if(mode==='candidate-checks')result=await candidateChecks(path,s);
 else if(mode==='iam-negative')result=await negativeIam(path,s);
 else if(mode==='probe-cleanup')result=cleanupProbe(path,s);
 else if(mode==='alarms')result=alarms(path,s);
 else if(mode==='route-verification')result=await routeVerification(path,s);
 else if(mode==='repair-broker-public-key')result=await repairBrokerPublicKey(path,s);
 else if(mode==='retire-tu-maintenance')result=retireTemporaryTuMaintenance(path,s);
 else if(mode==='resume-after-owner-smoke')result=await resumeAfterOwnerSmoke(path,s);
 else if(mode==='report')result=report(path,s);
 else throw Error('UNKNOWN_OPERATION');
 console.log(JSON.stringify({state:path,...result},null,2));
 if(result?.ok===false)process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
 console.error(JSON.stringify(safeFailure(e)));process.exitCode=1;
});
