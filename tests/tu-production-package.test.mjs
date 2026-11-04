import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {rootCertificates} from 'node:tls';
import {execFileSync} from 'node:child_process';
import {packageProduction,OWNER_FILES} from '../scripts/operations/tu-production/package.mjs';
import {hash,ROOT,addStatement,removeStatement,denyInvoke,invocationPolicyHash,putDeny,OPERATOR,useTestAws,A,arn} from '../scripts/operations/tu-production/common.mjs';
import {maintain,snapshot} from '../scripts/operations/tu-production/deploy.mjs';
import {ownerExecution,ownerEndpoint} from '../scripts/operations/tu-production/owner.mjs';
import {readZipEntry,listZipEntries} from '../scripts/operations/zip-archive.mjs';
test('owner IAM/endpoint grants are narrow and additive without owner-secret write capability',()=>{
 const s={loginSecret:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/tu-login-Abc123'};
 const p=ownerExecution(s);
 assert.equal(p.Statement.find(x=>x.Action==='secretsmanager:PutSecretValue').Resource,s.loginSecret);
 assert.ok(!JSON.stringify(p).includes('coed/v4/tu/provider'));assert.ok(!JSON.stringify(p).includes('coed/v4/tu/signing'));
 const ep=ownerEndpoint(s),base={Version:'2012-10-17',Statement:[{Sid:'Original',Effect:'Allow',Resource:'unchanged'}]};
 assert.equal(ep.find(x=>x.Action==='secretsmanager:PutSecretValue').Resource,s.loginSecret);
 const next=ep.reduce(addStatement,base);assert.deepEqual(next.Statement[0],base.Statement[0]);
 assert.deepEqual(ep.reduce(removeStatement,next),base);
 const foreign=structuredClone(next);foreign.Statement[1].Resource='*';assert.throws(()=>ep.reduce(removeStatement,foreign));
 assert.equal(hash({b:1,a:2}),hash({a:2,b:1}));
 const deny=denyInvoke('coed-tu-owner-upgrade-20261105',[OPERATOR]);
 assert.deepEqual(deny.Statement[0].Condition.ArnNotEquals['aws:PrincipalArn'],[OPERATOR]);
});
test('Invoke policy comparison accepts only IAM scalar/list normalization, never broader rights',()=>{
 const name='coed-tu-owner-upgrade-20261105',expected=denyInvoke(name,[OPERATOR],arn(name)+':1');
 const stored=structuredClone(expected);
 stored.Statement[0].Resource=stored.Statement[0].Resource[0];
 stored.Statement[0].Action=[stored.Statement[0].Action];
 stored.Statement[0].Condition.ArnNotEquals['aws:PrincipalArn']=OPERATOR;
 assert.equal(invocationPolicyHash(stored),invocationPolicyHash(expected));
 for(const mutate of [
  x=>{x.Statement[0].Condition.ArnNotEquals['aws:PrincipalArn']=[OPERATOR,'arn:aws:iam::130165494095:role/foreign'];},
  x=>{x.Statement[0].Resource='*';},x=>{x.Statement[0].Effect='Allow';},
  x=>{delete x.Statement[0].Condition;},x=>{x.Statement.push({...x.Statement[0]});}
 ]){const drift=structuredClone(stored);mutate(drift);assert.notEqual(invocationPolicyHash(drift),invocationPolicyHash(expected));}
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
 const restore=useTestAws(args=>{
  assert.deepEqual(args,['lambda','get-resource-policy','--resource-arn',arn(name)+':1']);
  return {Policy:JSON.stringify(stored)};
 });
 try{assert.doesNotThrow(()=>putDeny(name,[OPERATOR],'1'));}
 finally{restore();if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
test('production owner/API/maintenance archives load isolated and reject without credentials',async()=>{
 const {path,state}=await packageProduction(Buffer.from(rootCertificates[0]+'\n'));
 const dir=dirname(path);assert.ok(relative(join(ROOT,'tmp/tu-production'),dir).startsWith('production-'));
 try{
  assert.doesNotThrow(()=>execFileSync('git',['check-ignore','--quiet','--',path],{cwd:ROOT,encoding:'utf8'}));
  const owner=state.artifacts.owner;
  assert.deepEqual(listZipEntries(owner.file).sort(),['scripts/operations/tu-owner/handler.mjs','global-bundle.pem',...OWNER_FILES].sort());
  for(const [kind,artifact] of Object.entries(state.artifacts)){
   assert.equal(hash(readFileSync(artifact.file)),artifact.sha256);
   assert.ok(!artifact.entries.some(x=>/(^|\/)(\.env|\.aws|tests|tmp)\b|\.map$/.test(x)));
   const extracted=join(dir,'extracted-'+kind);mkdirSync(extracted);
   for(const entry of artifact.entries){mkdirSync(dirname(join(extracted,entry)),{recursive:true});writeFileSync(join(extracted,entry),readZipEntry(artifact.file,entry));}
   if(!['owner','api','maintenance'].includes(kind))continue;
   const code=kind==='owner'?
    "import('./scripts/operations/tu-owner/handler.mjs').then(async m=>console.log(JSON.stringify(await m.handler({sql:'NO_SQL_CONSOLE'}))));":
    "require('./src/lambda.js').handler({rawPath:'/api/v3/me',httpMethod:'GET'}).then(r=>console.log(JSON.stringify({status:r.statusCode,code:JSON.parse(r.body).error.code})));";
   const out=execFileSync(process.execPath,['-e',code],{cwd:extracted,encoding:'utf8',
    env:{PATH:process.env.PATH,NODE_ENV:'production',COED_API_MAINTENANCE:'all'}}).trim().split(/\r?\n/);
   const value=JSON.parse(out.at(-1));
   if(kind==='owner'){assert.equal(value.ok,false);assert.equal(value.error.code,'OWNER_REQUEST_DENIED');}
   else assert.deepEqual(value,{status:503,code:'COED_MAINTENANCE'});
  }
  // No AWS network here: exercise actual checkpoint/routing control code with
  // an explicit test-only transport, including refusal before mutation.
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
  const calls=[],functions={
   'coed-api':{FunctionName:'coed-api',CodeSha256:'/0B5tQMbjcxxZDDsbLOd4+K7McqH9OAL0r5vJw9hU44=',Role:'arn:aws:iam::'+A+':role/coed-v4-api-role',
    Handler:'src/lambda.handler',RevisionId:'api-original',State:'Active',LastUpdateStatus:'Successful',Environment:{Variables:{}},
    VpcConfig:{SubnetIds:['subnet-0fb8a4985d4e48f03'],SecurityGroupIds:['sg-01157dbde4cba48ab']}},
   'coed-tu-auth':{FunctionName:'coed-tu-auth',CodeSha256:'IwMiSvavUadk27YoGWGYWj5vZAXAO83okw/GNkEGfY0=',Role:'arn:aws:iam::'+A+':role/coed-tu-auth-role',
    Handler:'src/lambda.handler',RevisionId:'tu-original',State:'Active',LastUpdateStatus:'Successful',
    Environment:{Variables:{TU_AUTH_PRIVATE_KEY:'PRIVATE_CANARY',TU_API_APP_KEY:'PRIVATE_CANARY'}},VpcConfig:{VpcId:''}}
  },integrations={ip14y62:arn('coed-api'),sr47ns9:arn('coed-tu-auth')};
  const writes=[],arg=(args,key)=>args[args.indexOf(key)+1];
  const restore=useTestAws(args=>{
   calls.push(args);
   const cmd=args.slice(0,2).join(' ');
   if(cmd==='sts get-caller-identity')return {Account:A,Arn:'arn:aws:sts::'+A+':assumed-role/AccountFullAccessRole/test'};
   if(cmd==='iam get-role')return OPERATOR;
   if(cmd==='lambda get-function-configuration')return structuredClone(functions[arg(args,'--function-name')]);
   if(cmd==='apigatewayv2 get-integrations')return {Items:Object.entries(integrations).map(([IntegrationId,IntegrationUri])=>({IntegrationId,IntegrationUri}))};
   if(cmd==='apigatewayv2 get-routes')return {Items:[]};
   if(cmd==='apigatewayv2 get-api')return {CorsConfiguration:{AllowOrigins:['https://example.invalid']}};
   if(cmd==='apigatewayv2 get-integration')return {IntegrationUri:integrations[arg(args,'--integration-id')]};
   if(cmd==='lambda update-function-code'){
    writes.push(cmd);const f=functions[arg(args,'--function-name')];f.CodeSha256=Buffer.from(state.artifacts.maintenance.sha256,'hex').toString('base64');f.RevisionId='maintenance';return {};
   }
   if(cmd==='lambda publish-version'){writes.push(cmd);return {Version:'1'};}
   if(cmd==='lambda add-permission'){writes.push(cmd);return {};}
   if(cmd==='apigatewayv2 update-integration'){writes.push(cmd);integrations[arg(args,'--integration-id')]=arg(args,'--integration-uri');return {};}
   if(cmd==='rds create-db-snapshot'){writes.push(cmd);return {};}
   if(cmd==='rds describe-db-snapshots')return {DBSnapshots:[{DBInstanceIdentifier:'database-coed-postgres',Status:'available',Encrypted:true,DBSnapshotArn:'arn:aws:rds:test-owned'}]};
   if(cmd==='rds list-tags-for-resource')return {TagList:[{Key:'coedTask',Value:'tu-production-20261105'},{Key:'runId',Value:state.runId}]};
   throw Error('UNEXPECTED_MOCK_OPERATION');
  });
  try{
   await assert.rejects(maintain(path,state,{sourceCheck:()=>{throw Error('SOURCE_CHANGED');}}),/SOURCE_CHANGED/);
   assert.equal(writes.length,0);
   functions['coed-api'].Role='foreign';
   await assert.rejects(maintain(path,state,{sourceCheck:()=>{}}));assert.equal(writes.length,0);
   functions['coed-api'].Role='arn:aws:iam::'+A+':role/coed-v4-api-role';
   await maintain(path,state,{sourceCheck:()=>{},fetchImpl:async url=>{
    assert.ok(Object.values(integrations).every(x=>x.endsWith(':1')));
    assert.ok(!url.endsWith('/api/v3/me') || url.includes('/api/tu-proxy/'));
    return {status:503,json:async()=>({error:{code:'COED_MAINTENANCE'}})};
   }});
   assert.equal(state.maintenance.active,true);assert.ok(!JSON.stringify(state).includes('PRIVATE_CANARY'));
   snapshot(path,state);snapshot(path,state);
   assert.equal(writes.filter(x=>x==='rds create-db-snapshot').length,1);assert.equal(state.snapshot.restoreTested,false);
  }finally{restore();if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
