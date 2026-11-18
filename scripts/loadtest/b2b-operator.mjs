// Explicit B2b approval only: data import, no production/API traffic or deployment.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { build } from 'esbuild';
import { LambdaClient, CreateFunctionCommand, InvokeCommand } from '@aws-sdk/client-lambda';
import { readReviewedMigrations } from '../operations/reviewed-migrations.mjs';
import { createZip, listZipEntries } from '../operations/zip-archive.mjs';
import { equal, preserve, appendPolicy, removeOwned, sgRulesPreserved, stripSecretPermissions } from './b2-operator.mjs';
import { T, hash, validateBindings, id } from './b2b-import.mjs';
import { reject } from './b2-bootstrap.mjs';
import { generateSyntheticDataset } from './vendor/pr178-generate-companies.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const tag=(tags,key)=>tags?.find(t=>t.Key===key)?.Value;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const POLICY_NAME='b2b-test-only';
export function retryablePreflight(command,result,attempt) {
  return command==='preflight' && attempt<24 && result.ok===false && result.stage==='owner-secret' &&
    result.errorName==='AccessDeniedException' && ['VPC_ENDPOINT_POLICY','IDENTITY_POLICY','UNSPECIFIED'].includes(result.denialCategory);
}
export function temporaryPolicy(logGroup) {
  const secretArns=[T.ownerSecret,T.appSecret];
  const fnArn=`arn:aws:lambda:${T.region}:${T.account}:function:${T.fn}`;
  return {Version:'2012-10-17',Statement:[
    {Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:secretArns},
    {Effect:'Deny',Action:'secretsmanager:GetSecretValue',NotResource:secretArns},
    {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${T.account}:log-group:${logGroup}:*`},
    {Effect:'Allow',Action:['ec2:CreateNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets','ec2:DeleteNetworkInterface',
      'ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'],Resource:'*'},
    {Effect:'Deny',Action:['ec2:CreateNetworkInterface','ec2:DeleteNetworkInterface','ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'],
      Resource:'*',Condition:{ArnEquals:{'lambda:SourceFunctionArn':fnArn}}}
  ]};
}
export async function packageImporter(config,payload,ca,dir) {
  const stage=join(dir,'package');mkdirSync(stage);
  writeFileSync(join(stage,'config.json'),JSON.stringify(config));
  writeFileSync(join(stage,'payload.json'),JSON.stringify(payload));
  writeFileSync(join(stage,'global-bundle.pem'),ca);
  await build({entryPoints:[join(root,'scripts/loadtest/b2b-handler.mjs')],outfile:join(stage,'index.cjs'),bundle:true,
    platform:'node',target:'node22',format:'cjs',external:['pg-native'],legalComments:'none',logLevel:'silent',
    define:{'import.meta.url':JSON.stringify('file:///var/task/library.mjs')}});
  const zip=join(dir,'importer.zip');createZip(stage,zip);
  if(!equal(listZipEntries(zip).sort(),['config.json','global-bundle.pem','index.cjs','payload.json']))reject('B2B_PACKAGE_FILES');
  return {zip,bytes:readFileSync(zip)};
}
function cli(service,operation,input={}) {
  try {
    const args=[service,operation,'--profile','coed-v4','--region',T.region,'--no-cli-pager','--output','json'];
    if(Object.keys(input).length)args.push('--cli-input-json',JSON.stringify(input));
    const r=execFileSync('aws',args,{encoding:'utf8',timeout:25000,windowsHide:true,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
    return r.trim()?JSON.parse(r):{};
  } catch(e) {
    const code=/\(([^)]+)\) when calling/.exec(String(e.stderr || ''))?.[1];
    throw Object.assign(new Error('B2B_AWS_COMMAND_FAILED'),{code:/^[A-Za-z0-9_.-]+$/.test(code || '')?code:'B2B_AWS_COMMAND_FAILED'});
  }
}
export async function execute() {
  if(process.argv[2]!=='--approved-b2b' || process.argv.length!==3)reject('B2B_APPROVAL_FLAG_REQUIRED');
  if(cli('sts','get-caller-identity').Account!==T.account)reject('B2B_WRONG_ACCOUNT');
  const bindingsPath=resolve(process.env.COED_B2B_BINDINGS_FILE || '');
  const privateRoot=join(root,'tmp','loadtest');
  if(!bindingsPath.startsWith(privateRoot+String.fromCharCode(process.platform==='win32'?92:47)))reject('B2B_PRIVATE_INPUT_PATH_REQUIRED');
  const raw=readFileSync(bindingsPath,'utf8');if(raw.length>16384)reject('B2B_INPUT_TOO_LARGE');
  const bindings=validateBindings(JSON.parse(raw));
  const db=cli('rds','describe-db-instances',{DBInstanceIdentifier:T.id}).DBInstances[0];
  if(db.DBInstanceStatus!=='available' || db.DBName!==T.database || db.MasterUsername!==T.owner || db.EngineVersion!=='16.15' ||
    db.Endpoint.Address!==T.host || db.PubliclyAccessible || db.DBSubnetGroup.VpcId!==T.vpc || tag(db.TagList,'coed:run-id')!==T.run ||
    db.MasterUserSecret.SecretArn!==T.ownerSecret || db.VpcSecurityGroups.length!==1 || db.VpcSecurityGroups[0].VpcSecurityGroupId!==T.dbSg)reject('B2B_RDS_DRIFT');
  for(const arn of [T.ownerSecret,T.appSecret]) {
    const s=cli('secretsmanager','describe-secret',{SecretId:arn});
    if(s.ARN!==arn || s.DeletedDate || !Object.values(s.VersionIdsToStages || {}).some(stages=>stages.includes('AWSCURRENT')))reject('B2B_SECRET_METADATA_DRIFT');
  }
  // Read exact test-account metadata only; never request passwords or tokens.
  for(const a of bindings.accounts) {
    const user=cli('cognito-idp','admin-get-user',{UserPoolId:'ap-southeast-2_Um6nksXa1',Username:`${a.alias}@loadtest.coed.local`});
    if(!user.Enabled || user.UserAttributes?.find(x=>x.Name==='sub')?.Value!==a.subject)reject('B2B_COGNITO_HANDOFF_MISMATCH');
  }
  for(const [service,operation,input,missing] of [
    ['iam','get-role',{RoleName:T.role},'NoSuchEntity'],['lambda','get-function',{FunctionName:T.fn},'ResourceNotFoundException']]) {
    try {cli(service,operation,input);reject('B2B_RESOURCE_EXISTS');}catch(e){if(e.code!==missing)throw e;}
  }
  const logGroup=`/aws/lambda/${T.fn}`;
  if(cli('logs','describe-log-groups',{logGroupNamePrefix:logGroup}).logGroups.some(g=>g.logGroupName===logGroup))reject('B2B_LOG_EXISTS');
  const ep=cli('ec2','describe-vpc-endpoints',{VpcEndpointIds:[T.endpoint]}).VpcEndpoints[0];
  if(ep.State!=='available' || ep.VpcId!==T.vpc || !ep.PrivateDnsEnabled || ep.ServiceName!==`com.amazonaws.${T.region}.secretsmanager` ||
    ep.Groups.length!==1 || ep.Groups[0].GroupId!==T.endpointSg)reject('B2B_ENDPOINT_DRIFT');
  const original=JSON.parse(ep.PolicyDocument);
  const groups=cli('ec2','describe-security-groups',{GroupIds:[T.dbSg,T.clientSg,T.endpointSg]}).SecurityGroups;
  const peer=(g,d,port,other)=>(g[d] || []).some(p=>p.IpProtocol==='tcp' && p.FromPort===port && p.ToPort===port && p.UserIdGroupPairs.some(x=>x.GroupId===other));
  const dbSg=groups.find(g=>g.GroupId===T.dbSg),clientSg=groups.find(g=>g.GroupId===T.clientSg),endpointSg=groups.find(g=>g.GroupId===T.endpointSg);
  if([dbSg,clientSg].some(g=>g.VpcId!==T.vpc || tag(g.Tags,'coed:run-id')!==T.run) ||
    !peer(dbSg,'IpPermissions',5432,T.clientSg) || !peer(clientSg,'IpPermissionsEgress',5432,T.dbSg) ||
    !peer(clientSg,'IpPermissionsEgress',443,T.endpointSg) || !peer(endpointSg,'IpPermissions',443,T.clientSg) ||
    clientSg.IpPermissions.length || dbSg.IpPermissionsEgress.length ||
    dbSg.IpPermissions.some(p=>p.IpProtocol!=='tcp' || p.FromPort!==5432 || p.ToPort!==5432 || p.UserIdGroupPairs.some(x=>x.GroupId!==T.clientSg) || p.IpRanges.length || p.Ipv6Ranges.length) ||
    clientSg.IpPermissionsEgress.some(p=>p.IpProtocol!=='tcp' || ![443,5432].includes(p.FromPort) || p.FromPort!==p.ToPort ||
      p.UserIdGroupPairs.some(x=>x.GroupId!==(p.FromPort===443?T.endpointSg:T.dbSg)) || p.IpRanges.length || p.Ipv6Ranges.length))reject('B2B_NETWORK_DRIFT');
  const ca=readFileSync(resolve(process.env.COED_RDS_CA_FILE || ''),'utf8');
  const certs=ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if(!certs?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim() || certs.some(c=>!new X509Certificate(c).ca))reject('B2B_CA_REJECTED');
  const payload={history:readReviewedMigrations().map(({name,checksum})=>({version:name,checksum})),dataset:generateSyntheticDataset()};
  mkdirSync(privateRoot,{recursive:true});const dir=mkdtempSync(join(privateRoot,'b2b-'));
  const roleArn=`arn:aws:iam::${T.account}:role/${T.role}`;
  const statement={Sid:'CoedLoadtestB2bOwner20261118',Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',
    Resource:[T.ownerSecret,T.appSecret],Condition:{ArnEquals:{'aws:PrincipalArn':roleArn}}};
  const windowStart=process.env.COED_B2B_WINDOW_STARTED_AT ? Number(process.env.COED_B2B_WINDOW_STARTED_AT) : Date.now();
  if(!Number.isSafeInteger(windowStart) || windowStart>Date.now() || Date.now()-windowStart>40*60000)reject('B2B_WINDOW_REJECTED');
  const state={contract:'coed-loadtest-b2b-v1',target:T.id,run:T.run,startedAt:windowStart,attemptStartedAt:Date.now(),phase:'PREPARING',
    inputHash:hash(bindings),payloadHash:hash(payload),backupHash:hash(original),statement,created:{},results:[],cleanup:{},
    productionTouched:false,apiInvoked:false,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
  const files=['scripts/loadtest/b2b-import.mjs','scripts/loadtest/b2b-handler.mjs','scripts/loadtest/b2b-runtime-check.mjs',
    'scripts/loadtest/b2b-operator.mjs','scripts/loadtest/vendor/pr178-generate-companies.mjs','scripts/loadtest/identity-input.mjs',
    'src/auth/identity-resolver.js','src/api/services/student-plan-service.js','src/db/repositories/student-plan-repository.js',
    'src/db/repositories/workflow-repository.js','src/api/services/authorization-service.js','src/db/repositories/directory-repository.js'];
  state.sourceHashes=Object.fromEntries(files.map(f=>[f,hash(readFileSync(join(root,f)))]));
  writeFileSync(join(dir,'endpoint-before.json'),JSON.stringify(original,null,2),{flag:'wx'});
  writeFileSync(join(dir,'security-groups-before.json'),JSON.stringify(groups,null,2),{flag:'wx'});
  const save=()=>writeFileSync(join(dir,'state.json'),JSON.stringify(state,null,2));
  const step=phase=>{state.phase=phase;save();console.log(JSON.stringify({status:phase,state:join(dir,'state.json')}));};
  const deadline=()=>{if(Date.now()>state.startedAt+40*60000)reject('B2B_CLEANUP_RESERVE_REACHED');};
  const getPolicy=()=>JSON.parse(cli('ec2','describe-vpc-endpoints',{VpcEndpointIds:[T.endpoint]}).VpcEndpoints[0].PolicyDocument);
  const setPolicy=(before,after)=>{
    preserve(original,before);preserve(original,after);
    if(!equal(getPolicy(),before))reject('B2B_ENDPOINT_CONCURRENT_CHANGE');
    cli('ec2','modify-vpc-endpoint',{VpcEndpointId:T.endpoint,PolicyDocument:JSON.stringify(after)});
    if(!equal(getPolicy(),after))reject('B2B_ENDPOINT_POSTWRITE_DRIFT');
  };
  const tags=[{Key:'coed:run-id',Value:T.run},{Key:'coed:purpose',Value:'loadtest'},{Key:'coed:owner',Value:'ronnakrit'},{Key:'coed:stage',Value:'b2b'}];
  const isOurs=r=>tag(r.Tags,'coed:run-id')===T.run && tag(r.Tags,'coed:stage')==='b2b';
  const mutate=(s,o,i)=>{deadline();if(cli('sts','get-caller-identity').Account!==T.account)reject('B2B_WRONG_ACCOUNT');return cli(s,o,i);};
  try {
    const config={host:T.host,database:T.database,owner:T.owner,ownerSecret:T.ownerSecret,appSecret:T.appSecret,
      startedAt:state.startedAt,expiresAt:state.startedAt+3600000,payloadHash:state.payloadHash,bindingHash:state.inputHash};
    const packed=await packageImporter(config,payload,ca,dir);state.zipHash=hash(packed.bytes);save();
    // CLI credential export captured only in memory. Do not log SDK errors/requests.
    const exported=JSON.parse(execFileSync('aws',['configure','export-credentials','--profile','coed-v4','--format','process'],
      {encoding:'utf8',timeout:20000,windowsHide:true,stdio:['ignore','pipe','pipe']}));
    const credentials={accessKeyId:exported.AccessKeyId,secretAccessKey:exported.SecretAccessKey,sessionToken:exported.SessionToken};
    const lambda=new LambdaClient({region:T.region,credentials,maxAttempts:1,requestHandler:{connectionTimeout:3000,requestTimeout:210000,throwOnRequestTimeout:true}});
    step('B2B_CREATING_TEMP_ROLE_LOG');
    mutate('iam','create-role',{RoleName:T.role,Tags:tags,AssumeRolePolicyDocument:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]})});state.created.role=true;save();
    mutate('iam','put-role-policy',{RoleName:T.role,PolicyName:POLICY_NAME,PolicyDocument:JSON.stringify(temporaryPolicy(logGroup))});
    const observedPolicy=cli('iam','get-role-policy',{RoleName:T.role,PolicyName:POLICY_NAME}).PolicyDocument;
    if(!equal(observedPolicy,temporaryPolicy(logGroup)))reject('B2B_TEMP_ROLE_POLICY_DRIFT');
    const observedRole=cli('iam','get-role',{RoleName:T.role}).Role;
    state.rolePolicyHash=hash(observedPolicy);state.permissionsBoundaryPresent=!!observedRole.PermissionsBoundary;save();
    mutate('logs','create-log-group',{logGroupName:logGroup,tags:Object.fromEntries(tags.map(t=>[t.Key,t.Value]))});state.created.log=true;save();
    mutate('logs','put-retention-policy',{logGroupName:logGroup,retentionInDays:1});
    step('B2B_ADDING_TEMP_ENDPOINT_ALLOWANCE');deadline();setPolicy(original,appendPolicy(original,[statement]));state.created.endpoint=true;save();
    step('B2B_CREATING_TEMP_LAMBDA');
    for(let attempt=0;;attempt++) {
      try {deadline();const created=await lambda.send(new CreateFunctionCommand({FunctionName:T.fn,Runtime:'nodejs22.x',Role:roleArn,Handler:'index.handler',
        Code:{ZipFile:packed.bytes},MemorySize:256,Timeout:180,Architectures:['x86_64'],VpcConfig:{SubnetIds:[T.subnet],SecurityGroupIds:[T.clientSg]},Tags:Object.fromEntries(tags.map(t=>[t.Key,t.Value]))}));
        state.created.fn=true;save();
        if(created.CodeSha256!==Buffer.from(state.zipHash,'hex').toString('base64'))reject('B2B_ZIP_HASH_MISMATCH');break;
      }catch(e){if((e.code || e.name)!=='InvalidParameterValueException' || attempt>=5)throw e;await sleep(5000);}
    }
    const activeDeadline=Date.now()+10*60000;
    while(true){deadline();const f=cli('lambda','get-function-configuration',{FunctionName:T.fn});if(f.State==='Active')break;
      if(f.State==='Failed' || Date.now()>activeDeadline)reject('B2B_LAMBDA_NOT_ACTIVE');await sleep(5000);}
    mutate('lambda','put-function-concurrency',{FunctionName:T.fn,ReservedConcurrentExecutions:1});
    for(const command of ['preflight','trial','preflight','apply','verify']) {
      deadline();step('B2B_'+command.toUpperCase());
      if(command==='apply'){state.commitOutcome='UNKNOWN';save();}
      let result;
      for(let attempt=0;;attempt++) {
        deadline();
        const response=await lambda.send(new InvokeCommand({FunctionName:T.fn,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({command,
          payloadHash:state.payloadHash,baseline:state.baseline || null,bindings}))}));
        if(response.FunctionError)reject('B2B_INVOCATION_ERROR');
        result=JSON.parse(Buffer.from(response.Payload).toString('utf8'));state.results.push({command,attempt,...result});save();
        if(!retryablePreflight(command,result,attempt))break;
        const policy=getPolicy();preserve(original,policy);
        if(!policy.Statement.some(s=>equal(s,statement)) ||
          !equal(cli('iam','get-role-policy',{RoleName:T.role,PolicyName:POLICY_NAME}).PolicyDocument,temporaryPolicy(logGroup)))reject('B2B_PROPAGATION_POLICY_DRIFT');
        console.log(JSON.stringify({status:'B2B_WAITING_SECRET_AUTH_PROPAGATION',attempt,category:result.denialCategory}));
        await sleep(15000);
      }
      if(!result.ok)reject(result.code || 'B2B_COMMAND_FAILED');
      if(command==='preflight' && !state.baseline){state.baseline=result.baseline;save();}
      if(command==='apply'){state.dataCommitted=true;state.commitOutcome='CONFIRMED';save();}
    }
    state.dataVerified=true;step('B2B_DATA_RUNTIME_VERIFIED');
    const mapping=bindings.accounts.map(a=>({username:`${a.alias}@loadtest.coed.local`,planId:id(`${a.alias}:plan`),cycleId:id('round'),status:'DRAFT',version:1}));
    writeFileSync(join(dir,'username-plan-map.json'),JSON.stringify({database:T.database,issuer:bindings.issuer,accounts:mapping},null,2));
    writeFileSync(join(dir,'username-plan-map.csv'),'username,plan_id,cycle_id,status,version\n'+mapping.map(m=>[m.username,m.planId,m.cycleId,m.status,m.version].join(',')).join('\n')+'\n');
  } catch(e) {
    state.failure=/^[A-Za-z0-9_.-]+$/.test(e.code || e.name || '') ? (e.code || e.name) : 'B2B_OPERATION_FAILED';save();
    console.log(JSON.stringify({status:'B2B_STOPPING_FOR_CLEANUP',code:state.failure}));
  } finally {
    step('B2B_CLEANING_TEMPORARY_CAPABILITIES');
    const cleanup=async(name,action)=>{try{await action();state.cleanup[name]=true;}catch{state.cleanup[name]=false;}save();};
    await cleanup('secretAccessRevoked',()=>{
      let r;try{r=cli('iam','get-role',{RoleName:T.role}).Role;}catch(e){if(e.code==='NoSuchEntity')return;throw e;}
      if(!isOurs(r))reject('B2B_ROLE_OWNERSHIP');
      const pol=cli('iam','get-role-policy',{RoleName:T.role,PolicyName:POLICY_NAME}).PolicyDocument;
      cli('iam','put-role-policy',{RoleName:T.role,PolicyName:POLICY_NAME,PolicyDocument:JSON.stringify(stripSecretPermissions(pol))});
      if(!equal(cli('iam','get-role-policy',{RoleName:T.role,PolicyName:POLICY_NAME}).PolicyDocument,stripSecretPermissions(pol)))reject('B2B_ROLE_POLICY_DRIFT');
    });
    await cleanup('ownerEndpointRemoved',()=>{const current=getPolicy();preserve(original,current);const next=removeOwned(current,statement);
      if(!equal(current,next))setPolicy(current,next);if(getPolicy().Statement.some(s=>s.Sid===statement.Sid))reject('B2B_OWNER_REMAINS');});
    await cleanup('functionRemoved',()=>{
      let f;try{f=cli('lambda','get-function',{FunctionName:T.fn});}catch(e){if(e.code==='ResourceNotFoundException')return;throw e;}
      if(!isOurs(Object.assign({},f,{Tags:Object.entries(f.Tags || {}).map(([Key,Value])=>({Key,Value}))})) || f.Configuration.Role!==roleArn)reject('B2B_FN_OWNERSHIP');
      cli('lambda','delete-function',{FunctionName:T.fn});
      try{cli('lambda','get-function',{FunctionName:T.fn});reject('B2B_FN_REMAINS');}catch(e){if(e.code!=='ResourceNotFoundException')throw e;}
    });
    if(state.created.fn && state.cleanup.functionRemoved) {
      const waitEnd=Math.min(state.startedAt+45*60000,Date.now()+2*60000);
      while(Date.now()<waitEnd) {
        try{const enis=cli('ec2','describe-network-interfaces',{Filters:[{Name:'group-id',Values:[T.clientSg]}]}).NetworkInterfaces;
          state.remainingEnis=enis.map(e=>({id:e.NetworkInterfaceId,status:e.Status,description:e.Description}));save();if(!enis.length)break;
        }catch{state.eniInventoryUnavailable=true;break;}
        await sleep(15000);
      }
    }
    await cleanup('roleRemoved',()=>{
      let r;try{r=cli('iam','get-role',{RoleName:T.role}).Role;}catch(e){if(e.code==='NoSuchEntity')return;throw e;}
      if(!isOurs(r))reject('B2B_ROLE_OWNERSHIP');
      const names=cli('iam','list-role-policies',{RoleName:T.role}).PolicyNames;
      if(names.some(n=>n!==POLICY_NAME) || cli('iam','list-attached-role-policies',{RoleName:T.role}).AttachedPolicies.length)reject('B2B_ROLE_POLICY_DRIFT');
      for(const PolicyName of names)cli('iam','delete-role-policy',{RoleName:T.role,PolicyName});
      cli('iam','delete-role',{RoleName:T.role});
      try{cli('iam','get-role',{RoleName:T.role});reject('B2B_ROLE_REMAINS');}catch(e){if(e.code!=='NoSuchEntity')throw e;}
    });
    await cleanup('logRemoved',()=>{
      const logs=cli('logs','describe-log-groups',{logGroupNamePrefix:logGroup}).logGroups.filter(g=>g.logGroupName===logGroup);
      if(!logs.length)return;
      const tags=cli('logs','list-tags-log-group',{logGroupName:logGroup}).tags;
      if(tags['coed:run-id']!==T.run || tags['coed:stage']!=='b2b')reject('B2B_LOG_OWNERSHIP');
      cli('logs','delete-log-group',{logGroupName:logGroup});
      if(cli('logs','describe-log-groups',{logGroupNamePrefix:logGroup}).logGroups.some(g=>g.logGroupName===logGroup))reject('B2B_LOG_REMAINS');
    });
    await cleanup('originalEndpointPreserved',()=>preserve(original,getPolicy()));
    await cleanup('originalSgRulesPreserved',()=>{
      const current=cli('ec2','describe-security-groups',{GroupIds:groups.map(g=>g.GroupId)}).SecurityGroups;
      for(const g of groups)for(const d of ['IpPermissions','IpPermissionsEgress'])if(!sgRulesPreserved(g[d],current.find(n=>n.GroupId===g.GroupId)[d]))reject('B2B_ORIGINAL_SG_CHANGED');
    });
    state.durationSeconds=Math.round((Date.now()-state.startedAt)/1000);state.finishedAt=new Date().toISOString();
    state.cleanupVerified=['functionRemoved','roleRemoved','logRemoved','ownerEndpointRemoved','originalEndpointPreserved','originalSgRulesPreserved'].every(k=>state.cleanup[k]===true);
    state.withinOneHour=state.durationSeconds<=3600;
    state.phase=state.dataVerified && state.cleanupVerified && state.withinOneHour ? 'B2B_COMPLETE' : 'B2B_INCOMPLETE';save();
    const handoff={status:state.phase,database:T.database,host:T.host,port:T.port,user:T.user,appSecretArn:T.appSecret,lambdaSecurityGroup:T.clientSg,
      dataCommitted:state.commitOutcome==='UNKNOWN'?null:!!state.dataCommitted,commitOutcome:state.commitOutcome || 'NOT_ATTEMPTED',dataVerified:!!state.dataVerified,cleanupVerified:state.cleanupVerified,withinOneHour:state.withinOneHour,
      apiDeployed:false,apiInvoked:false,genuineCognitoAuthentication:false,loadGenerated:false,remainingEnis:state.remainingEnis || [],
      privateMapping:state.dataVerified?join(dir,'username-plan-map.csv'):null,state:join(dir,'state.json')};
    writeFileSync(join(dir,'handoff.json'),JSON.stringify(handoff,null,2));console.log(JSON.stringify(handoff,null,2));
    if(state.phase!=='B2B_COMPLETE')process.exitCode=1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))execute().catch(e=>{
  console.error(JSON.stringify({status:'B2B_OPERATOR_FAILED',code:/^[A-Za-z0-9_.-]+$/.test(e.code || '')?e.code:'B2B_PREFLIGHT_FAILED'}));process.exitCode=1;
});
