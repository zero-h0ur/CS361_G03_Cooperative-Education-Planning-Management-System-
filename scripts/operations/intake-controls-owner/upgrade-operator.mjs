// Explicit C7 only. Fresh capability after inventory cleanup; exact embedded
// metadata and pinned SQL, Trial before Apply, unconditional verified cleanup.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {prepare,cleanup,environment,config} from './operator.mjs';
import reader from './reader.js';
import {validateManifest} from '../intake-controls-upgrade.mjs';
import {catalogHash} from '../present-schema-baseline.mjs';
import {readPendingIntakeSql} from '../student-intake-contract.mjs';
import {readIntakeControlsSql} from '../intake-controls-contract.mjs';
import {publicCa} from '../../package-tu-auth.mjs';
import {createZip,listZipEntries} from '../zip-archive.mjs';
import {ROOT,OPERATOR,aws,caller,fixed,hash,cleanSource,save,load,arn,putDeny,waitActive,sdkCredentials,safeFailure} from '../tu-production/common.mjs';
const {T}=reader,CONTRACT='coed-intake-controls-upgrade-v1';
const FILES=['scripts/operations/intake-controls-upgrade.mjs','scripts/operations/intake-controls-contract.mjs','scripts/operations/student-intake-contract.mjs',
 'scripts/operations/present-schema-baseline.mjs','scripts/operations/present-schema-upgrade.mjs','scripts/operations/tu-preflight/catalog.js',
 'scripts/operations/baselines/coed-present-20261104.json','src/db/upgrades/021_phase1_pending_intake.sql','src/db/upgrades/022_coordinator_intake_controls.sql'];
export function fromInventory(path){
 const s=load(path),d=s.result?.data;fixed(s.task==='intake-controls-inventory' && s.cleanup?.verified && s.result?.ok && d?.student?.length===1 && d.coordinator?.length===1 && d.cohorts?.length===1,'C7_VERIFIED_INVENTORY_REQUIRED');
 const student=d.student[0],coordinator=d.coordinator[0],cohort=d.cohorts[0];
 fixed(student.account_status==='ACTIVE' && student.tu_link_active && student.identity_source==='TU_ONBOARDING' && coordinator.role==='COORDINATOR' && coordinator.account_status==='ACTIVE' &&
  cohort.id==='4c03d8c8-9995-4542-b019-2882ff6a8c1a' && cohort.cycle_id==='2b87b296-4ebe-478b-b45d-9527c2c28404' && cohort.coordinator_id===coordinator.user_id && cohort.active_committee_count===3,'C7_APPROVED_ASSIGNMENT_REQUIRED');
 return validateManifest({version:1,baselineCatalogHash:catalogHash(d.catalog),cycleId:randomUUID(),cohortId:randomUUID(),sourceCohortId:cohort.id,sourceCycleId:cohort.cycle_id,
  coordinatorUserId:coordinator.user_id,coordinatorSubject:'092e4478-c0d1-704d-4d12-62055954b15a',members:[cohort.committee_one,cohort.committee_two,cohort.committee_three],
  studentId:student.student_id,studentUserId:student.user_id});
}
export async function packageUpgrade(ca,manifest){
 publicCa(ca);validateManifest(manifest);readPendingIntakeSql();readIntakeControlsSql();const source=cleanSource();fixed(!source.dirty,'C7_COMMIT_REQUIRED');
 const parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'production-')),stage=join(dir,'c7-upgrade');mkdirSync(stage);
 const entry='scripts/operations/intake-controls-owner/upgrade-handler.mjs',target=join(stage,entry);mkdirSync(dirname(target),{recursive:true});
 await build({absWorkingDir:ROOT,entryPoints:[entry],outfile:target,bundle:true,platform:'node',format:'esm',target:'node22',sourcemap:false,legalComments:'none',
  external:['pg-native','../intake-controls-upgrade.mjs'],banner:{js:"import {createRequire as cr} from 'node:module'; const require=cr(import.meta.url);"},logLevel:'warning'});
 for(const file of FILES){const out=join(stage,file);mkdirSync(dirname(out),{recursive:true});copyFileSync(join(ROOT,file),out);}
 const bytes=Buffer.from(JSON.stringify(manifest));writeFileSync(join(stage,'approved-manifest.json'),bytes,{flag:'wx'});writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});
 const files=[entry,'approved-manifest.json','global-bundle.pem',...FILES],zip=join(dir,'c7-upgrade.zip');createZip(stage,zip,files);fixed(hash(listZipEntries(zip).sort())===hash(files.sort()));
 fixed(hash(cleanSource())===hash(source));
 const s={format:'coed-tu-production-v1',task:'intake-controls-upgrade',account:T.account,runId:randomBytes(16).toString('hex'),source,zip,sha256:hash(readFileSync(zip)),
  manifestSha256:hash(bytes),manifest,status:'LOCAL_ONLY',owned:{},operator:OPERATOR};const path=join(dir,'state.json');writeFileSync(path,JSON.stringify(s,null,2)+'\n',{flag:'wx'});return {path,state:s};
}
export async function invoke(path,s,mode){
 caller();fixed(['trial','apply'].includes(mode) && s.version && Date.parse(s.expiresAt)>Date.now() && !cleanSource().dirty && cleanSource().head===s.source.head,'C7_EXECUTION_GUARD');
 if(mode==='apply')fixed(s.trialPassed && s.postCatalogHash && s.applyVersion===s.version,'C7_TRIAL_REQUIRED');config(s);
 const client=new LambdaClient({region:T.region,credentials:sdkCredentials(),maxAttempts:1});
 try{const r=await client.send(new InvokeCommand({FunctionName:arn(T.name),Qualifier:s.version,InvocationType:'RequestResponse',LogType:'None',
  Payload:Buffer.from(JSON.stringify({contract:CONTRACT,runId:s.runId,mode}))}),{abortSignal:AbortSignal.timeout(95000)});
  fixed(r.StatusCode===200 && !r.FunctionError && r.ExecutedVersion===s.version && r.Payload.byteLength<16000,'C7_UPGRADE_INVOKE_FAILED');
  const result=JSON.parse(Buffer.from(r.Payload).toString());fixed(result.contract===CONTRACT);s.result=result;save(path,s);fixed(result.ok,result.code || 'C7_UPGRADE_FAILED');
  if(mode==='trial'){fixed(result.result.preservationVerified && /^[a-f0-9]{64}$/.test(result.result.postCatalogHash));s.trialPassed=true;s.postCatalogHash=result.result.postCatalogHash;s.status='TRIAL_PASSED';}
  else{fixed(result.result.applied || result.result.idempotentReplay);s.applied=true;s.status='APPLIED';}save(path,s);return result;
 }finally{client.destroy();}
}
export async function enableApply(path,s){
 fixed(s.trialPassed && s.postCatalogHash && Date.parse(s.expiresAt)>Date.now(),'C7_TRIAL_REQUIRED');const c=config(s),variables=environment(s,true);
 s.environmentHashes.push(hash(variables));save(path,s);aws(['lambda','update-function-configuration','--function-name',T.name,'--revision-id',c.RevisionId,'--environment',JSON.stringify({Variables:variables})]);
 const ready=await waitActive(T.name),v=aws(['lambda','publish-version','--function-name',T.name,'--revision-id',ready.RevisionId,'--code-sha256',ready.CodeSha256]).Version;
 putDeny(T.name,[OPERATOR],v);s.version=v;s.applyVersion=v;save(path,s);
}
export async function runUpgrade(ca,inventory){
 const {path,state:s}=await packageUpgrade(ca,fromInventory(inventory));console.log(JSON.stringify({status:'C7_UPGRADE_PREPARING',state:path}));
 let interrupted=false;const interrupt=()=>{interrupted=true;},check=()=>fixed(!interrupted,'C7_INTERRUPTED');process.once('SIGINT',interrupt);
 try{await prepare(path,s,{check});check();await invoke(path,s,'trial');console.log(JSON.stringify({status:'C7_TRIAL_PASSED',preservationVerified:true}));
  check();await enableApply(path,s);check();await invoke(path,s,'apply');console.log(JSON.stringify({status:'C7_SQL_AND_CLOSED_TEST_ROUND_APPLIED'}));
 }catch(e){s.failure=safeFailure(e);save(path,s);}
 finally{try{if(s.creationStarted){console.log(JSON.stringify({status:'C7_UPGRADE_CLEANING'}));cleanup(path,s);}else{s.cleanup={verified:true,noResourcesCreated:true};save(path,s);}}finally{process.removeListener('SIGINT',interrupt);}}
 console.log(JSON.stringify({status:s.applied && s.cleanup?.verified?'C7_SCHEMA_READY':'C7_UPGRADE_STOPPED',applied:s.applied===true,cleanupVerified:s.cleanup?.verified,state:path,error:s.failure}));
 if(!s.applied || !s.cleanup?.verified)process.exitCode=1;return {path,state:s};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,path,ca,flag]=process.argv.slice(2);fixed(flag==='--approved-c7','C7_APPROVAL_REQUIRED');
 if(mode==='run')await runUpgrade(readFileSync(resolve(ca)),path);else if(mode==='cleanup'){const s=load(path);console.log(JSON.stringify(cleanup(path,s)));}else fixed(false,'C7_UPGRADE_COMMAND_REQUIRED');
}
