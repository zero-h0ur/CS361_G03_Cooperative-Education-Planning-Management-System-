const {generateKeyPairSync,randomUUID}=require('node:crypto');
const {TuAuthService}=require('../src/auth/tu-auth-service');
const {TokenValidator}=require('../src/auth/token-validator');
const {IdentityResolver}=require('../src/auth/identity-resolver');
const {getTuKeyPair,signTuJwt}=require('../src/auth/tu-keys');
const {allowsTuBridge}=require('../src/auth/tu-bridge');
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const profile={id:randomUUID(),student_number:'9900000001'};
function setup(overrides={}) {
  const pool={query:jest.fn(async()=>({rows:[profile]}))};
  const identityResolver={resolveIdentity:jest.fn(async()=>({role:'STUDENT',accountStatus:'ACTIVE',studentId:profile.id,userId:randomUUID()}))};
  const fetchImpl=jest.fn(async()=>({ok:true,json:async()=>({status:true,type:'student',username:profile.student_number})}));
  const service=new TuAuthService({pool,identityResolver,fetchImpl,keyPair:keys,tuAppKey:'synthetic',tuSecretArn:'',...overrides});
  return {pool,identityResolver,fetchImpl:service.fetchImpl,service};
}
test.each([{},null,{studentId:'123',password:'x'},{studentId:'9900000001',password:''},{studentId:'9900000001',password:'x'.repeat(1025)},
  {studentId:'9900000001',password:'x',role:'ADMIN'},{studentId:'9900000001',password:'x',tuResponse:{status:true}}])('strict login input rejects %j',async body=>{
  const {service,pool,fetchImpl}=setup();await expect(service.login(body)).rejects.toMatchObject({statusCode:400});expect(pool.query).not.toHaveBeenCalled();expect(fetchImpl).not.toHaveBeenCalled();
});
test('unavailable provider fails without issuing token or provisioning',async()=>{
  const {service,pool,identityResolver}=setup({fetchImpl:async()=>{throw Error('synthetic network error');}});
  await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({statusCode:503});
  expect(pool.query).not.toHaveBeenCalled();expect(identityResolver.resolveIdentity).not.toHaveBeenCalled();
});
test('cannot redirect university password to a configurable external endpoint',async()=>{
  const {service,fetchImpl}=setup({tuApiUrl:'https://untrusted.example.invalid'});
  await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({statusCode:503});expect(fetchImpl).not.toHaveBeenCalled();
});
test('TU verification uses bounded timeout, no redirect and exact server proof',async()=>{
  const {service,fetchImpl}=setup();const proof=await service.verifyWithRealTuApi(profile.student_number,'synthetic');
  expect(service.assertVerifiedProof(proof)).toBe(proof);expect(()=>service.assertVerifiedProof({...proof})).toThrow();
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({redirect:'error',method:'POST'});expect(fetchImpl.mock.calls[0][1].signal).toBeDefined();
});

test.each(['verify','verify2'])('documented %s endpoint uses exact POST header/body names and never retries',async endpoint=>{
  const url=`https://restapi.tu.ac.th/api/v1/auth/Ad/${endpoint}`;
  const {service,fetchImpl}=setup({tuApiUrl:url,tuAppKey:'synthetic-application-key'});
  await service.verifyWithRealTuApi(profile.student_number,'synthetic-password');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [target,options]=fetchImpl.mock.calls[0];expect(target).toBe(url);
  expect(options.headers).toEqual({'Content-Type':'application/json','Application-Key':'synthetic-application-key'});
  expect(JSON.parse(options.body)).toEqual({UserName:profile.student_number,PassWord:'synthetic-password'});
  expect(options.redirect).toBe('error');
});

test.each([
  [401,'TU_API_ACCESS_DENIED',503],[403,'TU_API_ACCESS_DENIED',503],
  [429,'TU_API_RATE_LIMIT',429],[500,'TU_API_UNAVAILABLE',503],[502,'TU_API_UNAVAILABLE',503]
])('upstream%s returns sanitized%s, not a bad-Student-password error',async(status,code,statusCode)=>{
  const json=jest.fn(async()=>{throw Error('SYNTHETIC_PRIVATE_PROVIDER_BODY');}),cancel=jest.fn(async()=>{});
  const {service,fetchImpl,pool,identityResolver}=setup({fetchImpl:jest.fn(async()=>({status,ok:false,json,body:{cancel}}))});
  await expect(service.login({studentId:profile.student_number,password:'synthetic-password'})).rejects.toMatchObject({code,statusCode});
  expect(fetchImpl).toHaveBeenCalledTimes(1);expect(json).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledTimes(1);
  expect(pool.query).not.toHaveBeenCalled();expect(identityResolver.resolveIdentity).not.toHaveBeenCalled();
});

test('documented invalid credentials are401; malformed provider body is503, without any DB work',async()=>{
  for(const [message,code,statusCode] of [
    ['User or Password Invalid!','INVALID_CREDENTIALS',401],
    ['Could not read the request body!','TU_API_REQUEST_REJECTED',503]
  ]){
    const {service,pool,identityResolver}=setup({fetchImpl:async()=>({status:400,ok:false,json:async()=>({status:false,message})})});
    await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({code,statusCode});
    expect(pool.query).not.toHaveBeenCalled();expect(identityResolver.resolveIdentity).not.toHaveBeenCalled();
  }
});

test('invalid JSON is an upstream failure, not authentication success or password rejection',async()=>{
  const {service,pool}=setup({fetchImpl:async()=>({status:200,ok:true,json:async()=>{throw Error('SYNTHETIC_PRIVATE_BODY');}})});
  await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({statusCode:503,code:'TU_API_INVALID_RESPONSE'});
  expect(pool.query).not.toHaveBeenCalled();
});

test.each([401,403])('public login translates upstream%s without leaking provider contents or credentials',async status=>{
  const {createLambdaHandler}=require('../src/lambda');
  const json=jest.fn(async()=>({status:false,message:'SYNTHETIC_PRIVATE_PROVIDER_BODY'}));
  const {service,pool}=setup({fetchImpl:async()=>({status,ok:false,json})});
  const handler=createLambdaHandler({tuAuthService:service});
  const response=await handler({rawPath:'/api/v3/auth/tu-login',headers:{'content-type':'application/json'},
    requestContext:{http:{method:'POST'}},body:JSON.stringify({studentId:profile.student_number,password:'SYNTHETIC_PRIVATE_PASSWORD'})});
  expect(response.statusCode).toBe(503);expect(JSON.parse(response.body).error.code).toBe('TU_API_ACCESS_DENIED');
  for(const privateValue of ['SYNTHETIC_PRIVATE_PROVIDER_BODY','SYNTHETIC_PRIVATE_PASSWORD',profile.student_number])expect(response.body).not.toContain(privateValue);
  expect(json).not.toHaveBeenCalled();expect(pool.query).not.toHaveBeenCalled();
});

test.each([
  'https://restapi.tu.ac.th.evil.invalid/api/v1/auth/Ad/verify',
  'https://restapi.tu.ac.th/api/v1/auth/Ad/verify?next=other',
  'https://restapi.tu.ac.th/api/v1/auth/Ad/verify#other',
  'https://restapi.tu.ac.th/api/v1/auth/Ad/verify3'
])('unapproved URL is rejected before credentials or application key are used: %s',async tuApiUrl=>{
  const {service,fetchImpl}=setup({tuApiUrl});service.resolveAppKey=jest.fn();
  await expect(service.verifyWithRealTuApi(profile.student_number,'synthetic')).rejects.toMatchObject({code:'TU_AUTH_UNAVAILABLE'});
  expect(fetchImpl).not.toHaveBeenCalled();expect(service.resolveAppKey).not.toHaveBeenCalled();
});
test('documented TU success without optional username echo binds only the verified credential request',async()=>{
  const {service}=setup({fetchImpl:async()=>({ok:true,json:async()=>({status:true,type:'student',displayname_th:'Untrusted display',faculty:'not a routing program'})})});
  const proof=await service.verifyWithRealTuApi(profile.student_number,'synthetic');expect(proof.subject).toBe(profile.student_number);
});
test('proof expires, cannot come from another service or a client assertion',async()=>{
  let now=1000;const {service}=setup({clock:()=>now});const proof=await service.verifyWithRealTuApi(profile.student_number,'synthetic');
  expect(()=>setup().service.assertVerifiedProof(proof)).toThrow();now+=300001;expect(()=>service.assertVerifiedProof(proof)).toThrow();
});
test('per-instance attempt budget fails closed; global gateway throttling remains a release prerequisite',async()=>{
  const {service}=setup({identityResolver:{resolveIdentity:async()=>{throw Error('synthetic unlinked');}}});
  for(let n=0;n<5;n++)await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toThrow();
  await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({statusCode:429});
});
test('mismatched signing keys rejected instead of using a repository default',()=>{
  const other=generateKeyPairSync('rsa',{modulusLength:2048});expect(()=>getTuKeyPair({privateKey:keys.privateKey,publicKey:other.publicKey})).toThrow();
});
test.each([{client_id:'other'},{iss:'urn:coed:tu-auth:other'},{exp:0},{nbf:Math.floor(Date.now()/1000)+3600},{token_use:'id'},{scope:'openid'}])('TU token claims constrained independently of Cognito: %j',async replacement=>{
  const validator=new TokenValidator({tuPublicKey:keys.publicKey}),now=Math.floor(Date.now()/1000);
  const token=signTuJwt({iss:'urn:coed:tu-auth',sub:'9900000001',client_id:'coed-api',token_use:'access',scope:'coed-api/access',exp:now+300,...replacement},{privateKey:keys.privateKey});
  await expect(validator.validateToken(token)).rejects.toMatchObject({statusCode:401});
});
test.each([['GET','/api/v3/me'],['GET','/api/v4/application-options'],['GET','/api/v4/applications'],['POST','/api/v4/applications'],['PATCH','/api/v3/students/me']])('explicit Student bridge permits %s %s', (method,path)=>expect(allowsTuBridge(method,path)).toBe(true));
test.each([['GET','/api/v4/coordinator/applications'],['POST','/api/v3/admin/users'],['GET','/api/v3/plans'],['DELETE','/api/v4/applications'],['GET','/api/v4/applications/not-an-id'],['POST','/api/v3/auth/tu-login']])('TU bridge refuses %s %s',(method,path)=>expect(allowsTuBridge(method,path)).toBe(false));
test('request-time identity resolution is SELECT-only, never falls back to any active Student',async()=>{
  const pool={query:jest.fn(async()=>({rows:[]}))};await expect(new IdentityResolver({pool}).resolveIdentity('urn:coed:tu-auth','9900000001')).rejects.toMatchObject({statusCode:403});
  expect(pool.query).toHaveBeenCalledTimes(1);expect(pool.query.mock.calls[0][0].trim()).toMatch(/^SELECT/);
});
