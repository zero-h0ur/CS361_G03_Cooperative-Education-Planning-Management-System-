import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {SecretsManagerClient} from '@aws-sdk/client-secrets-manager';
import {T,FUNCTION_ARN,bindTarget,validate,COUNTS,BOOLS,reason,safeFlags,safeResult} from '../scripts/operations/tu-identity-diagnostic/contract.mjs';
import {createDiagnostic,loginPassword,readLoginPassword,secretFailure,SECRET_HTTP,SECRET_DEADLINE_MS} from '../scripts/operations/tu-identity-diagnostic/handler.mjs';
import {packageDiagnostic,executionPolicy,endpointGrant,cleanup} from '../scripts/operations/tu-identity-diagnostic/operator.mjs';
import {addStatement,removeStatement,ROOT,useTestAws,OPERATOR,roleArn,hash} from '../scripts/operations/tu-production/common.mjs';
import {listZipEntries,readZipEntry} from '../scripts/operations/zip-archive.mjs';
const subject='9900000001',now=Date.now(),salt='a'.repeat(64),run='b'.repeat(32);
const env={NODE_ENV:'production',AWS_REGION:T.region,DIAG_ENABLED:'true',DIAG_RUN_ID:run,
 DIAG_EXPIRES_AT:new Date(now+1200000).toISOString(),DIAG_LOGIN_SECRET_ARN:T.secret,DIAG_SALT:salt,DIAG_TARGET_DIGEST:bindTarget(subject,salt)};
const event={contract:T.contract,runId:run,studentId:subject},context={functionVersion:'1',invokedFunctionArn:FUNCTION_ARN+':1'};
const flags=()=>({...Object.fromEntries(COUNTS.map(k=>[k,1])),...Object.fromEntries(BOOLS.map(k=>[k,true])),active_cognito_link:false,active_other_link:false});
test('diagnostic accepts one bound target only, exact envelope, immutable context and short expiry',()=>{
 assert.equal(validate(event,context,env,now),subject);
 for(const value of [null,[],{}, {...event,sql:'SELECT 1'},{...event,password:'PRIVATE_CANARY'},
  {...event,studentId:'9900000002'},{...event,runId:'c'.repeat(32)}])assert.throws(()=>validate(value,context,env,now));
 for(const change of [{DIAG_ENABLED:'false'},{DIAG_LOGIN_SECRET_ARN:T.secret.replace('tu-login','app')},
  {AWS_REGION:'us-east-1'},{DIAG_TARGET_DIGEST:'0'.repeat(64)},{DIAG_SALT:'invalid'},
  {DIAG_EXPIRES_AT:new Date(now-1).toISOString()},{DIAG_EXPIRES_AT:new Date(now+1800001).toISOString()},
  {TU_AUTH_PRIVATE_KEY:'PRIVATE_CANARY'},{TU_SIGNING_SECRET_ARN:'PRIVATE_CANARY'},{DATABASE_URL:'PRIVATE_CANARY'}])
   assert.throws(()=>validate(event,context,{...env,...change},now));
 for(const ctx of [{},{...context,functionVersion:'$LATEST'},{...context,invokedFunctionArn:FUNCTION_ARN}])
  assert.throws(()=>validate(event,ctx,env,now));
});
test('safe reason classification is finite and refuses extra output fields',()=>{
 assert.equal(reason(flags()),'IDENTITY_CHECKS_PASSED');
 for(const [change,expected] of [
  [{tu_links:0},'UNLINKED_IDENTITY'],[{tu_links:2},'DUPLICATE_IDENTITY'],[{canonical_user_exists:false},'IDENTITY_OWNER_MISSING'],
  [{tu_link_active:false},'REVOKED_IDENTITY'],[{active_links:2},'DUPLICATE_ACTIVE_IDENTITIES'],[{account_active:false},'ACCOUNT_DISABLED'],
  [{student_role:false},'WRONG_ROLE'],[{canonical_students:0},'INCOMPLETE_PROVISIONING'],[{profile_complete:false},'INCOMPLETE_PROFILE'],
  [{subject_owner_matches:false},'STUDENT_OWNER_MISMATCH'],[{profile_version_valid:false},'PROFILE_VERSION_INVALID']])
   assert.equal(reason({...flags(),...change}),expected);
 assert.throws(()=>safeFlags({...flags(),student_number:subject}));
 assert.throws(()=>safeFlags({...flags(),tu_links:3}));
 assert.throws(()=>safeResult({contract:T.contract,ok:false,code:'PRIVATE_CANARY'}));
});
test('rejected envelope reads no Secret; successful lookup emits flags only and caps warm/controller calls',async()=>{
 let reads=0,ends=0,lookups=0;const logs=[];
 const secret={engine:'postgres',host:T.host,dbname:T.database,port:5432,username:T.user,password:'p'.repeat(64)};
 const handler=createDiagnostic({env,clock:()=>now,secrets:{send:async command=>{
  assert.equal(command.input.SecretId,T.secret);assert.equal(command.input.VersionStage,'AWSCURRENT');reads++;return {SecretString:JSON.stringify(secret)};
 }},connect:password=>{assert.equal(password,secret.password);return {connect:async()=>{},query:async()=>{},end:async()=>{ends++;}};},
 inspect:async(_client,id)=>{assert.equal(id,subject);lookups++;return flags();},logger:x=>logs.push(x)});
 assert.equal((await handler({...event,sql:'PRIVATE_CANARY'},context)).ok,false);assert.equal(reads,0);
 for(let i=0;i<3;i++)assert.equal((await handler(event,context)).reason,'IDENTITY_CHECKS_PASSED');
 assert.equal((await handler(event,context)).code,'DIAG_LIMIT');assert.equal(reads,3);assert.equal(lookups,3);assert.equal(ends,3);
 for(const value of [subject,secret.password,'PRIVATE_CANARY'])assert.ok(!logs.join('').includes(value));
 assert.throws(()=>loginPassword({...secret,username:'postgres'}));assert.throws(()=>loginPassword({...secret,host:'other'}));
});
test('raw SQL/SDK errors never become personal output and clients close on query failure',async()=>{
 const logs=[];let closed=false;
 const handler=createDiagnostic({env,clock:()=>now,secrets:{send:async()=>({SecretString:JSON.stringify({engine:'postgres',host:T.host,
  dbname:T.database,port:5432,username:T.user,password:'p'.repeat(64)})})},
 connect:()=>({connect:async()=>{},query:async()=>{},end:async()=>{closed=true;}}),
 inspect:async()=>{throw Error('PRIVATE_CANARY '+subject);},logger:x=>logs.push(x)});
 const result=await handler(event,context);assert.equal(result.code,'DIAG_QUERY_FAILED');assert.equal(closed,true);
 assert.ok(!JSON.stringify([result,logs]).includes('PRIVATE_CANARY'));assert.ok(!JSON.stringify([result,logs]).includes(subject));
});
test('Secret SDK failures use fixed categories only, never raw errors or a DB connection',async()=>{
 for(const [name,code] of [
  ['AccessDeniedException','DIAG_SECRET_DENIED'],['DecryptionFailure','DIAG_SECRET_DENIED'],
  ['AbortError','DIAG_SECRET_TIMEOUT'],['TimeoutError','DIAG_SECRET_TIMEOUT'],['ETIMEDOUT','DIAG_SECRET_TIMEOUT'],
  ['ResourceNotFoundException','DIAG_SECRET_NOT_FOUND'],['CredentialsProviderError','DIAG_SECRET_CREDENTIALS_UNAVAILABLE'],
  ['ExpiredTokenException','DIAG_SECRET_CREDENTIALS_UNAVAILABLE'],['ENOTFOUND','DIAG_SECRET_NETWORK'],
  ['ECONNREFUSED','DIAG_SECRET_NETWORK'],['ECONNRESET','DIAG_SECRET_NETWORK'],['UnrecognizedPrivateError','DIAG_SECRET_UNAVAILABLE']]){
  const error=Object.assign(Error('PRIVATE_CANARY '+subject),{name,code:name,safeCode:'DIAG_SECRET_INVALID'}),logs=[];
  assert.equal(secretFailure(error),code);
  const handler=createDiagnostic({env,clock:()=>now,secrets:{send:async()=>{throw error;}},
   connect:()=>assert.fail('Secret failure must not reach DB'),logger:x=>logs.push(x)});
  const result=await handler(event,context);
  assert.deepEqual(safeResult(result),{contract:T.contract,ok:false,code});
  for(const value of ['PRIVATE_CANARY',subject,'UnrecognizedPrivateError'])assert.ok(!JSON.stringify([result,logs]).includes(value));
 }
 for(const invalid of [{},{SecretString:'not JSON PRIVATE_CANARY'},{SecretString:'x'.repeat(8193)},
  {SecretString:'null'},{SecretString:'{}'},{SecretString:'{"password":"PRIVATE_CANARY"}'}]){
  const handler=createDiagnostic({env,clock:()=>now,secrets:{send:async()=>invalid},
   connect:()=>assert.fail('Invalid Secret must not reach DB'),logger:()=>{}});
  assert.equal((await handler(event,context)).code,'DIAG_SECRET_INVALID');
 }
});
test('real Secret SDK transport stays one-attempt and distinguishes denial, malformed JSON and bounded timeouts locally',async()=>{
 assert.deepEqual(SECRET_HTTP,{connectionTimeout:1000,requestTimeout:2500,throwOnRequestTimeout:true});
 assert.equal(SECRET_DEADLINE_MS,3000);
 const secret={engine:'postgres',host:T.host,dbname:T.database,port:5432,username:T.user,password:'p'.repeat(64)};
 let mode='ok',requests=0;
 const server=createServer(async(req,res)=>{
  requests++;let body='';for await(const chunk of req)body+=chunk;
  assert.deepEqual(JSON.parse(body),{SecretId:T.secret,VersionStage:'AWSCURRENT'});
  assert.equal(req.headers['x-amz-target'],'secretsmanager.GetSecretValue');
  if(mode==='timeout')return;
  res.setHeader('Content-Type','application/x-amz-json-1.1');
  if(mode==='denied'){res.statusCode=400;res.end(JSON.stringify({__type:'AccessDeniedException',message:'PRIVATE_CANARY '+subject}));}
  else if(mode==='invalid')res.end(JSON.stringify({SecretString:'invalid PRIVATE_CANARY'}));
  else res.end(JSON.stringify({SecretString:JSON.stringify(secret)}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const sdk=requestHandler=>new SecretsManagerClient({region:T.region,endpoint:'http://127.0.0.1:'+server.address().port,
  credentials:{accessKeyId:'synthetic-local',secretAccessKey:'synthetic-local-only'},maxAttempts:1,requestHandler});
 const client=sdk(SECRET_HTTP),short=sdk({...SECRET_HTTP,requestTimeout:50}),abort=sdk({...SECRET_HTTP,requestTimeout:10000});
 try{
  assert.equal(await readLoginPassword(client),secret.password);
  mode='denied';let before=requests;
  await assert.rejects(readLoginPassword(client),e=>e.safeCode==='DIAG_SECRET_DENIED' && !String(e).includes('PRIVATE_CANARY'));
  assert.equal(requests-before,1);
  mode='invalid';await assert.rejects(readLoginPassword(client),e=>e.safeCode==='DIAG_SECRET_INVALID');
  mode='timeout';before=requests;
  await assert.rejects(readLoginPassword(short),e=>e.safeCode==='DIAG_SECRET_TIMEOUT');assert.equal(requests-before,1);
  before=requests;
  await assert.rejects(readLoginPassword(abort),e=>e.safeCode==='DIAG_SECRET_TIMEOUT');assert.equal(requests-before,1);
 }finally{client.destroy();short.destroy();abort.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('diagnostic IAM/endpoint is additive and has no owner/signing/provider/write capability',()=>{
 const p=executionPolicy();assert.deepEqual(p.Statement[0],{Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:T.secret});
 const text=JSON.stringify(p);for(const value of ['PutSecretValue','rds!db','/tu/signing','/tu/provider','InvokeFunction'])assert.ok(!text.includes(value));
 const base={Version:'2012-10-17',Statement:[{Sid:'Original',Effect:'Allow',Resource:'unchanged'}]};
 const after=addStatement(base,endpointGrant());assert.deepEqual(removeStatement(after,endpointGrant()),base);
 assert.throws(()=>removeStatement({...after,Statement:[...base.Statement,{...endpointGrant(),Resource:'*'}]},endpointGrant()));
});
test('isolated diagnostic ZIP rejects before any AWS/DB work and CLI rejects credential/target args',async()=>{
 const {path,state}=await packageDiagnostic(Buffer.from(rootCertificates[0]+'\n')),dir=dirname(path);
 try{
  assert.deepEqual(listZipEntries(state.zip).sort(),['global-bundle.pem','handler.mjs']);
  const stage=join(dir,'isolated');mkdirSync(stage);
  for(const entry of listZipEntries(state.zip))writeFileSync(join(stage,entry),readZipEntry(state.zip,entry));
  const out=execFileSync(process.execPath,['--input-type=module','-e',"import {handler} from './handler.mjs'; console.log(JSON.stringify(await handler({sql:'NO_SQL_CONSOLE'})));"],
   {cwd:stage,encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'production'}}).trim().split(/\r?\n/);
  assert.deepEqual(JSON.parse(out.at(-1)),{contract:T.contract,ok:false,code:'DIAG_REQUEST_DENIED'});
  assert.throws(()=>execFileSync(process.execPath,['scripts/operations/tu-identity-diagnostic/operator.mjs','run','--approved-n0-n5',subject],
   {cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}),e=>e.status===1 && !String(e.stdout).includes(subject));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cleanup verifies removal, refuses foreign ownership, and still withdraws owned grants after a partial failure',async t=>{
 for(const mode of ['success','foreign','function-delete-failed'])await t.test(mode,async()=>{
  const {path,state:s}=await packageDiagnostic(Buffer.from(rootCertificates[0]+'\n')),dir=dirname(path);
  const base={Version:'2012-10-17',Statement:[{Sid:'Original',Effect:'Allow',Resource:'untouched'}]};
  s.baseline={unchanged:true};s.endpointBefore=base;s.roleId='TEST_ROLE_ID';
  s.owned={function:true,role:true,logs:true,endpoint:true};
  let fn=true,role=true,logs=true,ep=addStatement(base,endpointGrant());const mutations=[];
  const taskTags={coedTask:T.tag,runId:mode==='foreign'?'f'.repeat(32):s.runId};
  const missing=()=>{const e=Error();e.awsCode='ResourceNotFoundException';throw e;};
  const oldEnv=process.env.NODE_ENV;process.env.NODE_ENV='test';
  const restore=useTestAws(args=>{
   const cmd=args.slice(0,2).join(' '),arg=key=>args[args.indexOf(key)+1];
   if(cmd==='sts get-caller-identity')return {Account:T.account,Arn:'arn:aws:sts::'+T.account+':assumed-role/AccountFullAccessRole/test'};
   if(cmd==='iam get-role' && arg('--role-name')==='AccountFullAccessRole')return OPERATOR;
   if(cmd==='lambda get-function-configuration')return fn?{}:missing();
   if(cmd==='lambda get-function')return {Tags:taskTags,Configuration:{Role:roleArn(T.role),CodeSha256:Buffer.from(s.zipSha256,'hex').toString('base64'),Handler:'handler.handler'}};
   if(cmd==='lambda put-function-concurrency'){mutations.push(cmd);return {};}
   if(cmd==='lambda delete-function'){
    mutations.push(cmd);if(mode==='function-delete-failed')throw Error('synthetic delete failed');fn=false;return {};
   }
   if(cmd==='ec2 describe-vpc-endpoints')return {VpcEndpoints:[{ServiceName:'com.amazonaws.ap-southeast-2.secretsmanager',PolicyDocument:JSON.stringify(ep)}]};
   if(cmd==='ec2 modify-vpc-endpoint'){mutations.push(cmd);ep=JSON.parse(arg('--policy-document'));return {};}
   if(cmd==='lambda list-functions')return fn?[roleArn(T.role)]:[];
   if(cmd==='iam get-role'){
    if(!role){const e=Error();e.awsCode='NoSuchEntity';throw e;}
    return {Role:{RoleId:s.roleId,Tags:Object.entries(taskTags).map(([Key,Value])=>({Key,Value}))}};
   }
   if(cmd==='iam list-attached-role-policies')return {AttachedPolicies:[]};
   if(cmd==='iam list-role-policies')return {PolicyNames:['CoedIdentityReadonlyOnly']};
   if(cmd==='iam get-role-policy')return {PolicyDocument:executionPolicy()};
   if(cmd==='iam delete-role-policy'){mutations.push(cmd);return {};}
   if(cmd==='iam delete-role'){mutations.push(cmd);role=false;return {};}
   if(cmd==='logs describe-log-groups')return {logGroups:logs?[{logGroupName:'/aws/lambda/'+T.name}]:[]};
   if(cmd==='logs list-tags-log-group')return {tags:taskTags};
   if(cmd==='logs delete-log-group'){mutations.push(cmd);logs=false;return {};}
   throw Error('UNEXPECTED_MOCK_OPERATION');
  });
  try{
   const result=cleanup(path,s,{baselineCheck:()=>s.baseline});
   if(mode==='success'){
    assert.equal(result.verified,true);assert.equal(fn,false);assert.equal(role,false);assert.equal(logs,false);assert.equal(hash(ep),hash(base));
   }else if(mode==='foreign'){
    assert.equal(result.verified,false);assert.equal(mutations.length,0);assert.equal(fn,true);assert.equal(role,true);assert.equal(logs,true);
   }else{
    assert.equal(result.verified,false);assert.ok(result.failedParts.includes('function'));assert.equal(hash(ep),hash(base));
    assert.equal(role,true);assert.equal(logs,false);
   }
  }finally{restore();if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;rmSync(dir,{recursive:true,force:true});}
 });
});
