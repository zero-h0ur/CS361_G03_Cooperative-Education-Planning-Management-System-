const {generateKeyPairSync,randomUUID}=require('node:crypto');
const {TuProviderVerifier}=require('../src/auth/tu-provider-verifier');
const {TuBrokerService}=require('../src/auth/tu-broker-service');
const {createTuAuthBroker}=require('../src/tu-auth-broker');
const {createTuSessionIssuer}=require('../src/tu-session-issuer');
const {createTuSigningKeyProvider}=require('../src/auth/tu-signing-secret');
const {CONTRACT}=require('../src/auth/tu-session-contract');
const {ForbiddenError}=require('../src/api/errors');
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const arn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:candidate';
const now=Date.now(),subject='9900000001',password='SYNTHETIC_PASSWORD_CANARY',appKey='SYNTHETIC_APPLICATION_KEY_CANARY';
const profile={id:randomUUID(),student_number:subject,full_name:'Synthetic Student',preferred_name:null,
  institutional_email:'synthetic@example.invalid',department:'CS',program:'regular',major:'CS',academic_year:2567,
  enrollment_status:'ACTIVE',version:1,contact_email:null,contact_phone:null,contact_address:null};
function setup(options={}){
  const logs=[],pool={query:jest.fn(async()=>({rows:[{...profile}]}))};
  const identityResolver={resolveIdentity:jest.fn(async()=>({userId:randomUUID(),studentId:profile.id,role:'STUDENT',accountStatus:'ACTIVE'}))};
  const getKeys=jest.fn(async()=>keys),clock=()=>now;
  const issuer=createTuSessionIssuer({pool,identityResolver,getKeys,targetArn:arn,clock,logger:line=>logs.push(line),...options.issuer});
  const fetchImpl=jest.fn(async()=>({ok:true,status:200,json:async()=>({status:true,type:'student',username:subject,displayname_th:'PRIVATE_PROVIDER_PROFILE_CANARY'})}));
  const verifier=new TuProviderVerifier({fetchImpl,tuAppKey:appKey,tuSecretArn:'',clock});
  const send=jest.fn(async(command)=>({StatusCode:200,ExecutedVersion:'1',Payload:Buffer.from(JSON.stringify(await issuer(
    JSON.parse(Buffer.from(command.input.Payload).toString()),{invokedFunctionArn:arn,functionVersion:'1'})))}));
  const service=new TuBrokerService({verifier,client:{send},targetArn:arn,publicKey:keys.publicKey,clock,...options.broker});
  const handler=createTuAuthBroker({service,logger:line=>logs.push(line)});
  return {logs,pool,identityResolver,getKeys,issuer,fetchImpl,verifier,send,service,handler};
}
const input={studentId:subject,password};
const event=body=>({rawPath:'/api/v3/auth/tu-login',requestContext:{http:{method:'POST'}},body:JSON.stringify(body)});
const envelope=()=>({contract:CONTRACT,subject,verifiedAt:now,requestId:randomUUID()});

test('split flow verifies TU, invokes IAM-only issuer, checks canonical ownership and signs the original DTO',async()=>{
  const s=setup(),response=await s.handler(event(input));
  expect(response.statusCode).toBe(200);expect(response.headers['Cache-Control']).toBe('no-store');
  const data=JSON.parse(response.body).data;
  expect(data.profile.program).toBe('regular');expect(data.user.studentId).toBe(profile.id);expect(data.mode).toBe('tu_api');
  expect(s.fetchImpl).toHaveBeenCalledTimes(1);expect(s.send).toHaveBeenCalledTimes(1);
  const command=s.send.mock.calls[0][0].input;
  expect(command).toMatchObject({FunctionName:arn,InvocationType:'RequestResponse',LogType:'None'});
  const forwarded=Buffer.from(command.Payload).toString();
  expect(Object.keys(JSON.parse(forwarded)).sort()).toEqual(['contract','requestId','subject','verifiedAt']);
  for(const canary of [password,appKey,'PRIVATE_PROVIDER_PROFILE_CANARY']){
    expect(forwarded).not.toContain(canary);expect(response.body).not.toContain(canary);expect(s.logs.join('')).not.toContain(canary);
  }
  expect(s.logs.join('')).not.toContain(subject);expect(s.logs.join('')).not.toContain(data.accessToken);
  expect(s.getKeys).toHaveBeenCalledTimes(1);
});
test.each([null,{},[],{...input,verified:true},{...input,role:'COORDINATOR'},{...input,studentId:'other'}])('broker rejects malformed/spoofed login without provider call: %j',async body=>{
  const s=setup();expect((await s.handler(event(body))).statusCode).toBe(400);expect(s.fetchImpl).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();
});
test.each(['https://example.invalid','arn:aws:lambda:ap-southeast-2:111111111111:function:coed-api:live',
  'arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer',
  'arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:$LATEST'])('unapproved invocation target fails before credentials are used: %s',async targetArn=>{
  const s=setup({broker:{targetArn}});expect((await s.handler(event(input))).statusCode).toBe(503);expect(s.fetchImpl).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();
});
test('provider denial cannot invoke issuer or touch the database',async()=>{
  const s=setup();s.fetchImpl.mockResolvedValue({ok:false,status:403,body:{cancel:async()=>{}},json:async()=>({message:password})});
  const res=await s.handler(event(input));expect(res.statusCode).toBe(503);expect(JSON.parse(res.body).error.code).toBe('TU_API_ACCESS_DENIED');
  expect(s.send).not.toHaveBeenCalled();expect(s.pool.query).not.toHaveBeenCalled();expect(s.logs.join('')).not.toContain(password);
});
test.each([
  {StatusCode:202},{StatusCode:200,FunctionError:'Unhandled'},
  {StatusCode:200,ExecutedVersion:'$LATEST',Payload:Buffer.from('{}')},
  {StatusCode:200,ExecutedVersion:'1',Payload:Buffer.from('not json')},
  {StatusCode:200,ExecutedVersion:'1',Payload:Buffer.alloc(65537)},
  {StatusCode:200,ExecutedVersion:'1',Payload:Buffer.from(JSON.stringify({contract:CONTRACT,ok:true,session:{accessToken:'forged'}}))}
])('Invoke success status is insufficient: invalid response safely fails',async result=>{
  const s=setup();s.send.mockResolvedValue(result);const res=await s.handler(event(input));
  expect(res.statusCode).toBe(503);expect(res.body).not.toContain('accessToken');expect(s.send).toHaveBeenCalledTimes(1);
});
test('Invoke IAM denial is sanitized and never retried',async()=>{
  const s=setup();s.send.mockRejectedValue(Object.assign(Error(password),{name:'AccessDeniedException'}));
  const res=await s.handler(event(input));expect(res.statusCode).toBe(503);expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.logs.join('')+res.body).not.toContain(password);
});
test('an unresponsive issuer has a bounded deadline, aborts the SDK call and does not retry',async()=>{
  jest.useFakeTimers();try{
    const s=setup();s.send.mockImplementation(()=>new Promise(()=>{}));const pending=s.handler(event(input));
    await jest.advanceTimersByTimeAsync(8001);const res=await pending;
    expect(res.statusCode).toBe(503);expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  }finally{jest.useRealTimers();}
});
test('production broker refuses DB/private-signing/raw-provider credentials instead of retaining old environment capabilities',async()=>{
  const old=process.env.NODE_ENV,oldDb=process.env.DB_SECRET_ARN;
  try{
    process.env.NODE_ENV='production';process.env.DB_SECRET_ARN='SYNTHETIC_FORBIDDEN_ENV';
    const s=setup();expect((await s.handler(event(input))).statusCode).toBe(503);expect(s.fetchImpl).not.toHaveBeenCalled();
    const status=await s.handler({rawPath:'/api/v3/auth/tu-status',requestContext:{http:{method:'GET'}}});
    expect(JSON.parse(status.body).data.configured).toBe(false);
  }finally{process.env.NODE_ENV=old;if(oldDb===undefined)delete process.env.DB_SECRET_ARN;else process.env.DB_SECRET_ARN=oldDb;}
});
test('raw signing key errors never become a session or sensitive log',async()=>{
  const s=setup();s.getKeys.mockRejectedValue(Error(password));const res=await s.handler(event(input));
  expect(res.statusCode).toBe(503);expect(res.body+s.logs.join('')).not.toContain(password);
});
test('issuer stops a hung DB request before Lambda timeout and never signs a late result',async()=>{
  jest.useFakeTimers();try{
    const s=setup();let release;
    s.identityResolver.resolveIdentity.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const pending=s.issuer(envelope(),{invokedFunctionArn:arn,functionVersion:'1'});
    await jest.advanceTimersByTimeAsync(7001);expect((await pending).error.status).toBe(503);
    release({userId:randomUUID(),studentId:profile.id,role:'STUDENT',accountStatus:'ACTIVE'});
    await jest.advanceTimersByTimeAsync(1);expect(s.getKeys).not.toHaveBeenCalled();
  }finally{jest.useRealTimers();}
});
test('issuer handles a nearly expired Lambda context before touching the database',async()=>{
  const s=setup();const result=await s.issuer(envelope(),{invokedFunctionArn:arn,functionVersion:'1',getRemainingTimeInMillis:()=>250});
  expect(result.error.status).toBe(503);expect(s.pool.query).not.toHaveBeenCalled();expect(s.getKeys).not.toHaveBeenCalled();
});
test.each([null,{}, {...envelope(),verified:true},{...envelope(),requestContext:{}},
  {...envelope(),subject:'9900000002',role:'STUDENT'},{...envelope(),verifiedAt:now-30001},
  {...envelope(),verifiedAt:now+5001},{...envelope(),requestId:'private log injection\n'}])('private issuer rejects untrusted/stale/HTTP-shaped inputs before DB work',async value=>{
  const s=setup(),result=await s.issuer(value,{invokedFunctionArn:arn,functionVersion:'1'});
  expect(result.ok).toBe(false);expect(result.error.status).toBe(403);expect(s.pool.query).not.toHaveBeenCalled();expect(s.getKeys).not.toHaveBeenCalled();
});
test.each([{}, {invokedFunctionArn:arn,functionVersion:'$LATEST'},
  {invokedFunctionArn:arn.replace('candidate','live'),functionVersion:'1'}])('private handler requires the configured qualified deployment context',async context=>{
  const s=setup();expect((await s.issuer(envelope(),context)).ok).toBe(false);expect(s.pool.query).not.toHaveBeenCalled();
});
test.each(['UNLINKED_IDENTITY','REVOKED_IDENTITY','DUPLICATE_IDENTITY','ACCOUNT_DISABLED','INCOMPLETE_PROVISIONING'])('identity %s cannot mint a token and is safely mapped',async code=>{
  const s=setup();s.identityResolver.resolveIdentity.mockRejectedValue(new ForbiddenError(password,code));
  const res=await s.handler(event(input));expect(res.statusCode).toBe(403);expect(s.getKeys).not.toHaveBeenCalled();expect(res.body).not.toContain(password);
});
test.each([{role:'COORDINATOR',accountStatus:'ACTIVE'},{role:'STUDENT',accountStatus:'DISABLED'}])('wrong canonical owner state cannot sign',async state=>{
  const s=setup();s.identityResolver.resolveIdentity.mockResolvedValue({...state,studentId:profile.id,userId:randomUUID()});
  expect((await s.handler(event(input))).statusCode).toBe(403);expect(s.getKeys).not.toHaveBeenCalled();
});
test('missing/contradictory canonical profile cannot sign',async()=>{
  const s=setup();s.pool.query.mockResolvedValue({rows:[{...profile,student_number:'9900000002'}]});
  expect((await s.handler(event(input))).statusCode).toBe(403);expect(s.getKeys).not.toHaveBeenCalled();
});
test('DB/signing failure is safe and contains no provider password or SQL details',async()=>{
  const s=setup();s.pool.query.mockRejectedValue(Error(password));
  const res=await s.handler(event(input));expect(res.statusCode).toBe(503);expect(s.getKeys).not.toHaveBeenCalled();expect(s.logs.join('')+res.body).not.toContain(password);
});
test('broker verifies signature, key and credential subject, not merely an issuer success flag',async()=>{
  const s=setup({broker:{publicKey:generateKeyPairSync('rsa',{modulusLength:2048}).publicKey}});
  expect((await s.handler(event(input))).statusCode).toBe(503);
});
test('signing secret requires matching RSA keys, never an env fallback, and caches only in memory',async()=>{
  let nowMs=1000;const send=jest.fn(async()=>({SecretString:JSON.stringify({privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:keys.publicKey.export({format:'pem',type:'spki'})})}));
  const getKeys=createTuSigningKeyProvider({secretArn:'arn:aws:secretsmanager:ap-southeast-2:111111111111:secret:synthetic-abcdef',client:{send},clock:()=>nowMs});
  const first=await getKeys();expect((await getKeys()).publicKey).toBe(first.publicKey);expect(send).toHaveBeenCalledTimes(1);
  nowMs+=60001;await getKeys();expect(send).toHaveBeenCalledTimes(2);
  await expect(createTuSigningKeyProvider({secretArn:'not-approved'})()).rejects.toMatchObject({code:'TU_SIGNING_UNAVAILABLE'});
});
test('split handler does not enable provisioning routes, provider details or query parameters',async()=>{
  const s=setup();
  expect((await s.handler({...event(input),rawPath:'/api/v3/admin/users'})).statusCode).toBe(404);
  expect((await s.handler({...event(input),rawQueryString:'debug=true'})).statusCode).toBe(400);
  expect((await s.handler({...event(input),isBase64Encoded:true})).statusCode).toBe(400);
  const response=await s.handler({rawPath:'/api/v3/auth/tu-status',requestContext:{http:{method:'GET'}}});
  expect(Object.keys(JSON.parse(response.body).data).sort()).toEqual(['configured','mode']);expect(s.fetchImpl).not.toHaveBeenCalled();
});
