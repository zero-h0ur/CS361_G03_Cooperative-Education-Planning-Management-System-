import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTuIamPolicies,proposedResources} from '../scripts/operations/tu-auth-deployment-plan.mjs';
const c={account:'111111111111',region:'ap-southeast-2',operatorRoleArn:'arn:aws:iam::111111111111:role/ApprovedOperator',
  issuerAliasArn:'arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:candidate',
  tuSecretArn:'arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:tu-abcdef',
  dbSecretArn:'arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:db-abcdef',
  signingSecretArn:'arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:signing-abcdef'};
test('pure IAM proposal separates secrets and permits broker invocation of only the exact issuer alias',()=>{
  const p=buildTuIamPolicies(c);assert.equal(p.deploymentApproved,false);
  assert.deepEqual(p.broker.Statement.find(s=>s.Action.includes('lambda:InvokeFunction')).Resource,[c.issuerAliasArn]);
  assert.deepEqual(p.broker.Statement.find(s=>s.Action.includes('secretsmanager:GetSecretValue')).Resource,[c.tuSecretArn]);
  assert.deepEqual(p.issuer.Statement.find(s=>s.Action.includes('secretsmanager:GetSecretValue')).Resource,[c.dbSecretArn,c.signingSecretArn]);
  assert.ok(!JSON.stringify(p.issuer.Statement).includes('lambda:InvokeFunction'));
});
test('policy model denies public, API-role and cross-account issuers; does not claim an actual deployed IAM test',()=>{
  const p=buildTuIamPolicies(c),deny=p.issuerResourcePolicy.Statement[0];
  const permitted=deny.Condition.ArnNotEquals['aws:PrincipalArn'];
  for(const principal of ['apigateway.amazonaws.com','arn:aws:iam::111111111111:role/coed-v4-api-role','arn:aws:iam::222222222222:role/coed-tu-auth-role'])assert.ok(!permitted.includes(principal));
  assert.ok(permitted.includes(p.brokerRole));assert.ok(permitted.includes(c.operatorRoleArn));
  assert.equal(deny.Effect,'Deny');assert.equal(deny.Principal,'*');assert.equal(proposedResources.network.newNat,false);
});
for(const replacement of [{issuerAliasArn:c.issuerAliasArn.replace(':candidate',':$LATEST')},
  {issuerAliasArn:c.issuerAliasArn.replace('issuer','other')},{tuSecretArn:c.tuSecretArn.replace('111111111111','222222222222')},
  {dbSecretArn:c.tuSecretArn},{operatorRoleArn:'*'}])test('IAM generator rejects unapproved resource variants',()=>assert.throws(()=>buildTuIamPolicies({...c,...replacement})));
