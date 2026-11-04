// Pure proposal generator. No AWS clients, credentials, uploads or apply operation.
function checked(value,pattern){if(typeof value!=='string' || !pattern.test(value))throw Error('Unapproved TU deployment resource.');return value;}
export function buildTuIamPolicies(c){
  const account=checked(c.account,/^\d{12}$/),region=checked(c.region,/^[a-z0-9-]+$/);
  const base=`arn:aws:lambda:${region}:${account}:function:coed-tu-session-issuer`;
  if(![base+':live',base+':candidate'].includes(c.issuerAliasArn))throw Error('Issuer must be an exact approved alias.');
  const brokerRole=`arn:aws:iam::${account}:role/coed-tu-auth-role`;
  const issuerRole=`arn:aws:iam::${account}:role/coed-tu-session-role`;
  checked(c.operatorRoleArn,new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]+$`));
  if([brokerRole,issuerRole].includes(c.operatorRoleArn))throw Error('Operator must be separately reviewed.');
  for(const name of ['tuSecretArn','dbSecretArn','signingSecretArn'])checked(c[name],
    new RegExp(`^arn:aws:secretsmanager:${region}:${account}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$`));
  if(new Set([c.tuSecretArn,c.dbSecretArn,c.signingSecretArn]).size!==3)throw Error('Secret capabilities must remain separate.');
  const allow=(Action,Resource)=>({Effect:'Allow',Action,Resource});
  const policy=Statement=>({Version:'2012-10-17',Statement});
  const log=name=>`arn:aws:logs:${region}:${account}:log-group:/aws/lambda/${name}:*`;
  return {
    status:'PROPOSAL_ONLY_NOT_DEPLOYED',deploymentApproved:false,
    brokerRole,issuerRole,
    broker:policy([allow(['logs:CreateLogStream','logs:PutLogEvents'],[log('coed-tu-auth')]),
      allow(['secretsmanager:GetSecretValue'],[c.tuSecretArn]),allow(['lambda:InvokeFunction'],[c.issuerAliasArn])]),
    issuer:policy([allow(['logs:CreateLogStream','logs:PutLogEvents'],[log('coed-tu-session-issuer')]),
      allow(['secretsmanager:GetSecretValue'],[c.dbSecretArn,c.signingSecretArn]),
      // AWS ENI APIs require reviewed wildcard resources; this is not Invoke/data access.
      allow(['ec2:CreateNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets',
        'ec2:DeleteNetworkInterface','ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'],['*']),
      {Effect:'Deny',Action:['ec2:CreateNetworkInterface','ec2:DescribeNetworkInterfaces','ec2:DescribeSubnets',
        'ec2:DeleteNetworkInterface','ec2:AssignPrivateIpAddresses','ec2:UnassignPrivateIpAddresses'],Resource:'*',
        Condition:{ArnEquals:{'lambda:SourceFunctionArn':base}}}]),
    issuerResourcePolicy:policy([{Effect:'Deny',Principal:'*',Action:'lambda:InvokeFunction',Resource:[base,base+':*'],
      Condition:{ArnNotEquals:{'aws:PrincipalArn':[brokerRole,c.operatorRoleArn]}}}]),
    trust:policy([{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]),
    requiredReview:['Full effective account/role policies and the issuer deny policy API support before apply.',
      'Private handler has no Gateway integration, Function URL or other event source.',
      'Use exact resolved secret ARNs; do not replace existing role/resource policy wholesale.',
      'SDK calls must be qualified, synchronous and non-retrying; deployed IAM denial still needs controlled verification.']
  };
}
export const proposedResources=Object.freeze({
  account:'130165494095',region:'ap-southeast-2',apiId:'yhfevhqtoa',
  status:'PROPOSAL_ONLY_NOT_DEPLOYED',deploymentApproved:false,
  existingBroker:{name:'coed-tu-auth',handler:'src/tu-auth-broker.handler',runtime:'nodejs24.x',memoryMB:128,timeoutSeconds:20},
  newIssuer:{name:'coed-tu-session-issuer',handler:'src/tu-session-issuer.handler',runtime:'nodejs22.x',memoryMB:256,
    timeoutSeconds:8,handlerDeadlineMs:7000,reservedConcurrency:2,poolMax:1,dbUser:'coed_tu_login',
    connectionTimeoutMs:1000,queryTimeoutMs:1000},
  network:{vpc:'vpc-0a529698240e85c17',subnet:'subnet-0fb8a4985d4e48f03',securityGroup:'sg-01157dbde4cba48ab',
    newNat:false,newEndpoint:false,publicRds:false},
  gateway:{integration:'sr47ns9',routes:['POST /api/v3/auth/tu-login','GET /api/v3/auth/tu-status'],
    cognitoAuthorizerChanged:false,corsChanged:false,proposedLoginThrottle:{rate:0.2,burst:2,bestEffort:true}},
  secrets:{maximum:3,needsResolvedArns:true,valuesMustNotAppearInArtifacts:true},logs:{retentionDays:14},
  stopGates:['Fresh approved source/artifact hashes; release gates pass on committed HEAD.',
    'Inspect real schema/checksums/identity ownership and effective SELECT-only role privileges.',
    'Resolve/approve exact secret ARNs, rotated TU key, signing public key and endpoint policy.',
    'Review costs, IAM/resource policy deny behavior, baseline/maintenance rollback and obtain AWS approval.']
});
