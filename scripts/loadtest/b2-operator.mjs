// Explicit B2a approval only. Never call general seed/reset/migrate or stack-up.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, X509Certificate } from 'node:crypto';
import { build } from 'esbuild';
import { SecretsManagerClient, CreateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { LambdaClient, InvokeCommand, CreateFunctionCommand } from '@aws-sdk/client-lambda';
import { readReviewedMigrations } from '../operations/reviewed-migrations.mjs';
import { createZip, listZipEntries } from '../operations/zip-archive.mjs';
import { TARGET as T, digest, reject } from './b2-bootstrap.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ?
  Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function preserve(original, current) {
  if (!Array.isArray(original.Statement) || !Array.isArray(current.Statement) ||
      original.Statement.some(s => !current.Statement.some(c => equal(s, c)))) reject('B2_ENDPOINT_ORIGINAL_CHANGED');
}
export function appendPolicy(original, additions) {
  if (additions.some(s => original.Statement.some(o => o.Sid === s.Sid))) reject('B2_ENDPOINT_SID_EXISTS');
  return { ...original, Statement: [...original.Statement, ...additions] };
}
export function removeOwned(current, statement) {
  const matches = current.Statement.filter(s => s.Sid === statement.Sid);
  if (matches.length && (matches.length !== 1 || !equal(matches[0], statement))) reject('B2_ENDPOINT_OWNED_DRIFT');
  return { ...current, Statement: current.Statement.filter(s => s.Sid !== statement.Sid) };
}
const profile = 'coed-v4';
export function sgRulesPreserved(oldRules, currentRules) {
  return oldRules.every(old => currentRules.some(rule => old.IpProtocol === rule.IpProtocol &&
    old.FromPort === rule.FromPort && old.ToPort === rule.ToPort &&
    ['UserIdGroupPairs','IpRanges','Ipv6Ranges','PrefixListIds'].every(key =>
      (old[key] || []).every(peer => (rule[key] || []).some(next => equal(peer,next))))));
}
export async function packageBootstrap(config,payload,ca,dir) {
  const stage=join(dir,'package');mkdirSync(stage);
  writeFileSync(join(stage,'config.json'),JSON.stringify(config));
  writeFileSync(join(stage,'payload.json'),JSON.stringify(payload));
  writeFileSync(join(stage,'global-bundle.pem'),ca);
  await build({ entryPoints:[join(root,'scripts/loadtest/b2-handler.mjs')],outfile:join(stage,'index.cjs'),bundle:true,
    platform:'node',target:'node22',format:'cjs',external:['pg-native'],legalComments:'none',logLevel:'silent' });
  const zip=join(dir,'bootstrap.zip');createZip(stage,zip);
  if(!equal(listZipEntries(zip).sort(),['config.json','global-bundle.pem','index.cjs','payload.json']))reject('B2_PACKAGE_FILES');
  return {zip,bytes:readFileSync(zip)};
}
function cli(service, operation, data = {}) {
  try {
    const args = [service, operation, '--profile', profile, '--region', T.region, '--no-cli-pager', '--output', 'json'];
    if (Object.keys(data).length) args.push('--cli-input-json', JSON.stringify(data));
    const result = execFileSync('aws', args, { encoding: 'utf8', timeout: 25000, windowsHide: true,
      maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return result.trim() ? JSON.parse(result) : {};
  } catch (error) {
    const code = /\(([^)]+)\) when calling/.exec(String(error.stderr || ''))?.[1];
    throw Object.assign(new Error('B2_AWS_COMMAND_FAILED'), { code: /^[A-Za-z0-9_.-]+$/.test(code || '') ? code : 'B2_AWS_COMMAND_FAILED' });
  }
}
const tag = (tags, key) => tags?.find(t => t.Key === key)?.Value;
const sleep = ms => new Promise(yes => setTimeout(yes, ms));
export function stripSecretPermissions(policy) {
  const next=structuredClone(policy);
  next.Statement=next.Statement.filter(s=>s.Action!=='secretsmanager:GetSecretValue');
  next.Statement.push({Effect:'Deny',Action:'secretsmanager:GetSecretValue',Resource:'*'});
  return next;
}
export function restrictTemporaryRoleForCleanup() {
  if(cli('sts','get-caller-identity').Account!==T.account)reject('B2_WRONG_ACCOUNT');
  const r=cli('iam','get-role',{RoleName:T.role}).Role;
  if(r.Arn!==`arn:aws:iam::${T.account}:role/${T.role}` || tag(r.Tags,'coed:run-id')!==T.run)reject('B2_CLEANUP_ROLE_OWNERSHIP');
  const current=cli('iam','get-role-policy',{RoleName:T.role,PolicyName:'b2a-test-only'}).PolicyDocument;
  cli('iam','put-role-policy',{RoleName:T.role,PolicyName:'b2a-test-only',PolicyDocument:JSON.stringify(stripSecretPermissions(current))});
  const observed=cli('iam','get-role-policy',{RoleName:T.role,PolicyName:'b2a-test-only'}).PolicyDocument;
  if(!equal(observed,stripSecretPermissions(current)))reject('B2_CLEANUP_ROLE_DRIFT');
  return {status:'B2A_TEMP_ROLE_SECRET_ACCESS_DENIED',atUtc:new Date().toISOString()};
}
async function productionProbe() {
  const r = await fetch('https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com/api/directory/companies',
    { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
  await r.body?.cancel();
  if (r.status !== 200) reject('B2_PRODUCTION_DIRECTORY_NOT_200');
  return { status: 200, atUtc: new Date().toISOString() };
}
async function execute() {
  if (process.argv[2] !== '--approved-b2a' || process.argv.length !== 3) reject('B2_EXPLICIT_APPROVAL_FLAG_REQUIRED');
  if (cli('sts','get-caller-identity').Account !== T.account) reject('B2_WRONG_ACCOUNT');
  const db = cli('rds','describe-db-instances',{ DBInstanceIdentifier: T.id }).DBInstances[0];
  if (db.DBInstanceStatus !== 'available' || db.DBName !== T.database || db.MasterUsername !== T.owner || db.EngineVersion !== '16.15' ||
      db.Endpoint.Address !== T.host || db.PubliclyAccessible || db.DBSubnetGroup.VpcId !== T.vpc ||
      tag(db.TagList,'coed:run-id') !== T.run || db.MasterUserSecret.SecretArn !== T.ownerSecret ||
      db.VpcSecurityGroups.length !== 1 || db.VpcSecurityGroups[0].VpcSecurityGroupId !== T.dbSg) reject('B2_RDS_DRIFT');
  for (const [service, operation, input] of [
    ['iam','get-role',{ RoleName: T.role }], ['lambda','get-function',{ FunctionName: T.fn }]]) {
    try { cli(service, operation, input); reject('B2_TEMP_RESOURCE_EXISTS'); }
    catch (e) { if (!['NoSuchEntity','ResourceNotFoundException'].includes(e.code)) throw e; }
  }
  if (cli('secretsmanager','list-secrets',{ IncludePlannedDeletion: true, Filters: [{ Key: 'name', Values: ['coed/loadtest/postgres/app'] }] })
    .SecretList.some(s => s.Name === 'coed/loadtest/postgres/app')) reject('B2_APP_SECRET_EXISTS');
  const logGroup = `/aws/lambda/${T.fn}`;
  if (cli('logs','describe-log-groups',{ logGroupNamePrefix: logGroup }).logGroups.some(g => g.logGroupName === logGroup)) reject('B2_TEMP_LOG_EXISTS');
  const ep = cli('ec2','describe-vpc-endpoints',{ VpcEndpointIds: [T.endpoint] }).VpcEndpoints[0];
  if (ep.State !== 'available' || ep.VpcId !== T.vpc || !ep.PrivateDnsEnabled ||
      ep.ServiceName !== `com.amazonaws.${T.region}.secretsmanager` || ep.Groups.length !== 1 || ep.Groups[0].GroupId !== T.endpointSg) reject('B2_ENDPOINT_DRIFT');
  const original = JSON.parse(ep.PolicyDocument);
  const groups = cli('ec2','describe-security-groups',{ GroupIds: [T.dbSg,T.clientSg,T.endpointSg] }).SecurityGroups;
  if(cli('ec2','describe-network-interfaces',{ Filters:[{Name:'group-id',Values:[T.clientSg]}] }).NetworkInterfaces.length) reject('B2_TEST_SG_ALREADY_IN_USE');
  for (const id of [T.dbSg,T.clientSg]) {
    const sg = groups.find(g => g.GroupId === id);
    if (sg.VpcId !== T.vpc || tag(sg.Tags,'coed:run-id') !== T.run) reject('B2_SG_OWNERSHIP_DRIFT');
  }
  const caFile = process.env.COED_RDS_CA_FILE;
  if (!caFile) reject('B2_CA_REQUIRED');
  const ca = readFileSync(resolve(caFile), 'utf8');
  const certs = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!certs?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim() ||
      certs.some(c => !new X509Certificate(c).ca)) reject('B2_CA_REJECTED');
  const payload = { migrations: readReviewedMigrations().map(({ name, checksum, sql }) => ({ name, checksum, sql })),
    grants: readFileSync(join(root,'scripts/loadtest/runtime-grants.sql'),'utf8') };
  const before = await productionProbe();
  mkdirSync(join(root,'tmp/loadtest'),{ recursive: true });
  const dir = mkdtempSync(join(root,'tmp/loadtest/b2a-'));
  const state = { contract: 'coed-loadtest-b2a-v1', directory: dir, startedAt: Date.now(), phase: 'PREPARED',
    target: T.id, run: T.run, before, backupHash: digest(JSON.stringify(original)), payloadHash: digest(JSON.stringify(payload)),
    secretValuesLogged: false, businessDataInserted: false, created: {}, results: [], cleanup: {} };
  writeFileSync(join(dir,'endpoint-before.json'), JSON.stringify(original,null,2), { flag: 'wx' });
  writeFileSync(join(dir,'security-groups-before.json'), JSON.stringify(groups,null,2), { flag: 'wx' });
  const save = () => writeFileSync(join(dir,'state.json'), JSON.stringify(state,null,2));
  const step = phase => { state.phase = phase; save(); console.log(JSON.stringify({ status: phase, state: join(dir,'state.json') })); };
  const deadline = () => { if (Date.now() > state.startedAt + 45 * 60000) reject('B2_CLEANUP_RESERVE_REACHED'); };
  const mutate = (service, operation, input) => {
    deadline(); if (cli('sts','get-caller-identity').Account !== T.account) reject('B2_WRONG_ACCOUNT');
    return cli(service, operation, input);
  };
  const getPolicy = () => JSON.parse(cli('ec2','describe-vpc-endpoints',{ VpcEndpointIds: [T.endpoint] }).VpcEndpoints[0].PolicyDocument);
  const verifyOriginalRules = () => {
    const current=cli('ec2','describe-security-groups',{GroupIds:[T.dbSg,T.clientSg,T.endpointSg]}).SecurityGroups;
    for(const old of groups)for(const direction of ['IpPermissions','IpPermissionsEgress'])
      if(!sgRulesPreserved(old[direction],current.find(g=>g.GroupId===old.GroupId)[direction]))reject('B2_ORIGINAL_SG_RULE_CHANGED');
  };
  const setPolicy = (expected, next) => {
    preserve(original, expected); preserve(original, next);
    if (!equal(getPolicy(), expected)) reject('B2_ENDPOINT_CONCURRENT_CHANGE');
    cli('ec2','modify-vpc-endpoint',{ VpcEndpointId: T.endpoint, PolicyDocument: JSON.stringify(next) });
    const observed = getPolicy(); preserve(original, observed);
    if (!equal(next, observed)) reject('B2_ENDPOINT_POSTWRITE_DRIFT');
  };
  const tags = [{ Key: 'coed:run-id', Value: T.run },{ Key: 'coed:purpose', Value: 'loadtest' },{ Key: 'coed:owner', Value: 'ronnakrit' }];
  const roleArn = `arn:aws:iam::${T.account}:role/${T.role}`;
  let ownerStatement, runtimeStatement, failure;
  try {
    step('B2A_CREATING_APP_SECRET');
    // Export credentials is captured only in process memory, never to stdout/files.
    const exported = JSON.parse(execFileSync('aws',['configure','export-credentials','--profile',profile,'--format','process'],
      { encoding:'utf8', timeout:20000, windowsHide:true, stdio:['ignore','pipe','pipe'] }));
    const credentials = { accessKeyId: exported.AccessKeyId, secretAccessKey: exported.SecretAccessKey, sessionToken: exported.SessionToken };
    const secrets = new SecretsManagerClient({ region:T.region, credentials, maxAttempts:2,
      requestHandler:{ connectionTimeout:3000, requestTimeout:12000, throwOnRequestTimeout:true } });
    const created = await secrets.send(new CreateSecretCommand({ Name:'coed/loadtest/postgres/app',
      Description:'B2a isolated load-test coed_app runtime; no production credentials', Tags:tags,
      SecretString:JSON.stringify({ engine:'postgres',host:T.host,dbname:T.database,username:T.user,port:5432,password:randomBytes(32).toString('hex') }) }));
    state.created.appSecret = created.ARN; save();
    step('B2A_CREATING_TEMP_ROLE_LOG');
    mutate('iam','create-role',{ RoleName:T.role, Tags:tags, AssumeRolePolicyDocument:JSON.stringify({ Version:'2012-10-17',
      Statement:[{ Effect:'Allow',Principal:{ Service:'lambda.amazonaws.com' },Action:'sts:AssumeRole' }] }) });
    state.created.role = roleArn; save();
    const fnArn = `arn:aws:lambda:${T.region}:${T.account}:function:${T.fn}`;
    const secretArns = [T.ownerSecret,state.created.appSecret];
    mutate('iam','put-role-policy',{ RoleName:T.role,PolicyName:'b2a-test-only',PolicyDocument:JSON.stringify({ Version:'2012-10-17',Statement:[
      { Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:secretArns },
      { Effect:'Deny',Action:'secretsmanager:GetSecretValue',NotResource:secretArns },
      { Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${T.region}:${T.account}:log-group:${logGroup}:*` },
      { Effect:'Allow',Action:['ec2:CreateNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets','ec2:DeleteNetworkInterface',
        'ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'],Resource:'*' },
      { Effect:'Deny',Action:['ec2:CreateNetworkInterface','ec2:DeleteNetworkInterface','ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'],
        Resource:'*',Condition:{ ArnEquals:{ 'lambda:SourceFunctionArn':fnArn } } }
    ] }) });
    mutate('logs','create-log-group',{ logGroupName:logGroup,tags:Object.fromEntries(tags.map(t=>[t.Key,t.Value])) });
    state.created.log = logGroup; save();
    mutate('logs','put-retention-policy',{ logGroupName:logGroup,retentionInDays:1 });
    step('B2A_ADDING_TEST_NETWORK');
    for (const [groupId, direction, other] of [[T.clientSg,'egress',T.endpointSg],[T.endpointSg,'ingress',T.clientSg]]) {
      const g = groups.find(g=>g.GroupId===groupId);
      const old = direction === 'egress' ? g.IpPermissionsEgress : g.IpPermissions;
      const exists = old.some(p=>p.IpProtocol==='tcp' && p.FromPort===443 && p.ToPort===443 && p.UserIdGroupPairs.some(x=>x.GroupId===other));
      if (!exists) {
        const out = mutate('ec2',`authorize-security-group-${direction}`,{ GroupId:groupId,
          IpPermissions:[{ IpProtocol:'tcp',FromPort:443,ToPort:443,UserIdGroupPairs:[{ GroupId:other,Description:`B2a app Secret path ${T.run}` }] }] });
        state.created[direction+'Rule'] = out.SecurityGroupRules.map(r=>r.SecurityGroupRuleId); save();
      }
    }
    const statement = (Sid, arn, resources) => ({ Sid,Effect:'Allow',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:resources,
      Condition:{ ArnEquals:{ 'aws:PrincipalArn':arn } } });
    ownerStatement = statement('CoedLoadtestB2aOwner20261118',roleArn,secretArns);
    runtimeStatement = statement('CoedLoadtestB2aRuntime20261118',T.runtimeRole,state.created.appSecret);
    state.ownerStatement = ownerStatement; state.runtimeStatement = runtimeStatement; save();
    setPolicy(original, appendPolicy(original,[ownerStatement,runtimeStatement]));
    verifyOriginalRules();
    state.created.endpointAdditions = true; save();
    state.afterEndpointProbe = await productionProbe(); save();
    step('B2A_PACKAGING_FIXED_BOOTSTRAP');
    const config = { host:T.host,database:T.database,owner:T.owner,ownerSecret:T.ownerSecret,appSecret:state.created.appSecret,
      startedAt:state.startedAt,expiresAt:state.startedAt+3600000,digest:state.payloadHash };
    const {bytes:zipBytes}=await packageBootstrap(config,payload,ca,dir);
    state.zipHash = digest(zipBytes); save();
    step('B2A_CREATING_TEMP_LAMBDA');
    const lambda = new LambdaClient({ region:T.region,credentials,maxAttempts:1,
      requestHandler:{ connectionTimeout:3000,requestTimeout:210000,throwOnRequestTimeout:true } });
    // IAM propagation only; no retry if the function may already have been created.
    for (let attempt=0; ; attempt++) {
      try {
        deadline(); if(cli('sts','get-caller-identity').Account!==T.account)reject('B2_WRONG_ACCOUNT');
        const createdFunction=await lambda.send(new CreateFunctionCommand({ FunctionName:T.fn,Runtime:'nodejs22.x',Role:roleArn,Handler:'index.handler',
          Code:{ ZipFile:zipBytes },MemorySize:256,Timeout:180,Architectures:['x86_64'],
          VpcConfig:{ SubnetIds:[T.subnet],SecurityGroupIds:[T.clientSg] },Tags:Object.fromEntries(tags.map(t=>[t.Key,t.Value])) }));
        if(createdFunction.CodeSha256!==Buffer.from(state.zipHash,'hex').toString('base64'))reject('B2_DEPLOYED_ZIP_HASH_MISMATCH');
        break;
      } catch(e) { if((e.code || e.name)!=='InvalidParameterValueException' || attempt>=5)throw e; await sleep(5000); }
    }
    state.created.fn = T.fn; save();
    const waitEnd = Date.now()+10*60000;
    while(true) {
      deadline(); const f=cli('lambda','get-function-configuration',{ FunctionName:T.fn });
      if(f.State==='Active')break;
      if(f.State==='Failed' || Date.now()>waitEnd)reject('B2_LAMBDA_NOT_ACTIVE');
      await sleep(5000);
    }
    mutate('lambda','put-function-concurrency',{ FunctionName:T.fn,ReservedConcurrentExecutions:1 });
    for (const command of ['preflight','trial','preflight','apply','verify']) {
      deadline(); step('B2A_'+command.toUpperCase());
      const response = await lambda.send(new InvokeCommand({ FunctionName:T.fn,InvocationType:'RequestResponse',
        Payload:Buffer.from(JSON.stringify({ command,digest:state.payloadHash })) }));
      if(response.FunctionError)reject('B2_LAMBDA_INVOCATION_ERROR');
      const result=JSON.parse(Buffer.from(response.Payload).toString('utf8'));
      state.results.push({ command,...result }); save();
      if(!result.ok)reject(result.code || 'B2_COMMAND_FAILED');
    }
    state.schemaVerified = true; step('B2A_SCHEMA_RUNTIME_VERIFIED');
  } catch(error) {
    failure=/^[A-Za-z0-9_.-]+$/.test(error.code || '') ? error.code : 'B2_OPERATION_FAILED';
    state.failure=failure; save(); console.log(JSON.stringify({ status:'B2A_STOPPING_FOR_CLEANUP',code:failure }));
  } finally {
    // Cleanup ignores normal deadline reserve. No Secret values are fetched by this operator.
    step('B2A_CLEANING_TEMPORARY_CAPABILITIES');
    const cleanup = (name, action) => { try { action(); state.cleanup[name]=true; } catch { state.cleanup[name]=false; } save(); };
    if(ownerStatement)cleanup('ownerEndpointRemoved',()=>{
      const current=getPolicy(); preserve(original,current);
      const next=removeOwned(current,ownerStatement);
      if(!equal(current,next))setPolicy(current,next);
      if(getPolicy().Statement.some(s=>s.Sid===ownerStatement.Sid))reject('B2_OWNER_STATEMENT_REMAINS');
    });
    // Detect ambiguous creation rather than trusting only successful request responses.
    cleanup('functionRemoved',()=>{
      let fn;
      try { fn=cli('lambda','get-function',{ FunctionName:T.fn }); }
      catch(e) { if(e.code==='ResourceNotFoundException')return; throw e; }
      if(tag(Object.entries(fn.Tags || {}).map(([Key,Value])=>({Key,Value})),'coed:run-id')!==T.run || fn.Configuration.Role!==roleArn)reject('B2_CLEANUP_FN_OWNERSHIP');
      cli('lambda','delete-function',{ FunctionName:T.fn });
      try { cli('lambda','get-function',{ FunctionName:T.fn }); reject('B2_FN_REMAINS'); }
      catch(e) { if(e.code!=='ResourceNotFoundException')throw e; }
    });
    if(state.created.fn && state.cleanup.functionRemoved) {
      cleanup('temporarySecretIamRevoked',()=>restrictTemporaryRoleForCleanup());
      step('B2A_WAITING_FOR_LAMBDA_ENI_CLEANUP');
      const eniDeadline=Math.min(state.startedAt+50*60000,Date.now()+15*60000);
      while(Date.now()<eniDeadline) {
        const enis=cli('ec2','describe-network-interfaces',{Filters:[{Name:'group-id',Values:[T.clientSg]}]}).NetworkInterfaces;
        state.remainingEnis=enis.map(e=>({id:e.NetworkInterfaceId,status:e.Status}));save();
        if(!enis.length)break;
        console.log(JSON.stringify({status:'B2A_WAITING_MANAGED_ENI',count:enis.length}));await sleep(15000);
      }
    }
    cleanup('roleRemoved',()=>{
      let r;
      try { r=cli('iam','get-role',{ RoleName:T.role }).Role; }
      catch(e) { if(e.code==='NoSuchEntity')return;throw e; }
      if(tag(r.Tags,'coed:run-id')!==T.run)reject('B2_CLEANUP_ROLE_OWNERSHIP');
      for(const name of cli('iam','list-role-policies',{ RoleName:T.role }).PolicyNames) {
        if(name!=='b2a-test-only')reject('B2_CLEANUP_ROLE_DRIFT');
        cli('iam','delete-role-policy',{ RoleName:T.role,PolicyName:name });
      }
      cli('iam','delete-role',{ RoleName:T.role });
      try { cli('iam','get-role',{ RoleName:T.role }); reject('B2_ROLE_REMAINS'); }
      catch(e) { if(e.code!=='NoSuchEntity')throw e; }
    });
    cleanup('logRemoved',()=>{
      const logs=cli('logs','describe-log-groups',{ logGroupNamePrefix:logGroup }).logGroups.filter(g=>g.logGroupName===logGroup);
      if(!logs.length)return;
      if(!state.created.log)reject('B2_CLEANUP_LOG_OWNERSHIP');
      cli('logs','delete-log-group',{ logGroupName:logGroup });
      if(cli('logs','describe-log-groups',{ logGroupNamePrefix:logGroup }).logGroups.some(g=>g.logGroupName===logGroup))reject('B2_LOG_REMAINS');
    });
    try { state.finalProductionProbe=await productionProbe(); } catch { state.finalProductionProbe={ status:'FAILED' }; }
    const finalPolicy=getPolicy(); preserve(original,finalPolicy);
    verifyOriginalRules(); state.cleanup.originalSgRulesPreserved=true;
    state.cleanup.originalEndpointPreserved=true;
    state.cleanupVerified=['functionRemoved','roleRemoved','logRemoved','ownerEndpointRemoved'].every(k=>state.cleanup[k]===true);
    state.finishedAt=new Date().toISOString();state.durationSeconds=Math.round((Date.now()-state.startedAt)/1000);
    state.phase=state.schemaVerified && state.cleanupVerified && state.finalProductionProbe.status===200 ? 'B2A_COMPLETE' : 'B2A_INCOMPLETE';save();
    const handoff={ status:state.phase,host:T.host,port:T.port,database:T.database,username:T.user,
      runtimeSecretArn:state.created.appSecret || null,lambdaSecurityGroup:T.clientSg,dbSecurityGroup:T.dbSg,
      schemaVerified:!!state.schemaVerified,cleanupVerified:state.cleanupVerified,productionDirectory:state.finalProductionProbe,
      companyDatasetApplied:false,identityBindingsApplied:false,apiDeployed:false,loadTested:false,
      retained:['B1 RDS/two SGs/owner Secret','test app Secret if created','test HTTPS SG rules if added','test runtime endpoint statement if added'],
      remainingManagedEnis:state.remainingEnis || [],
      operatorState:join(dir,'state.json'),endpointBackup:join(dir,'endpoint-before.json') };
    writeFileSync(join(dir,'handoff.json'),JSON.stringify(handoff,null,2));
    console.log(JSON.stringify(handoff,null,2));
    if(state.phase!=='B2A_COMPLETE')process.exitCode=1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))execute().catch(error=>{
  console.error(JSON.stringify({ status:'B2A_OPERATOR_FAILED',code:/^[A-Za-z0-9_.-]+$/.test(error.code || '') ? error.code : 'B2_OPERATOR_FAILED' }));process.exitCode=1;
});
