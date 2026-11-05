const crypto = require('node:crypto');
const {TuAuthService} = require('../src/auth/tu-auth-service');
const {IdentityResolver} = require('../src/auth/identity-resolver');
const {TokenValidator} = require('../src/auth/token-validator');
const {getTuKeyPair, signTuJwt} = require('../src/auth/tu-keys');

const issuer = 'urn:coed:tu-auth';
const keys = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
const profile = {id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222',student_number:'9900000001',full_name:'Synthetic Student',institutional_email:'synthetic@example.invalid',department:'CS',program:'regular',major:'CS',academic_year:2567,enrollment_status:'ACTIVE',version:1};
const identity = {userId:profile.user_id,studentId:profile.id,role:'STUDENT',accountStatus:'ACTIVE'};
const raw = {status:true,type:'student',username:profile.student_number,displayname_th:'Untrusted display',department:'display department',faculty:'display faculty'};
const setup = (overrides={}) => {
  const pool = {query:jest.fn(async()=>({rows:[profile]}))};
  const resolver = {resolveIdentity:jest.fn(async()=>identity)};
  const fetchImpl = jest.fn(async()=>({ok:true,json:async()=>raw}));
  const service = new TuAuthService({pool,identityResolver:resolver,tuAppKey:'synthetic-key',tuSecretArn:'',issuer,clientId:'coed-api',keyPair:keys,fetchImpl,...overrides});
  return {pool,resolver,fetchImpl,service};
};

test('missing TU verification config fails closed, without database writes or fallback',async()=>{
  const {service,pool,fetchImpl} = setup({tuAppKey:''});
  await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({statusCode:503});
  expect(pool.query).not.toHaveBeenCalled();expect(fetchImpl).not.toHaveBeenCalled();
});
test('caller supplied TU response is not authentication proof',async()=>{
  const {service} = setup({tuAppKey:''});
  await expect(service.login({studentId:profile.student_number,password:'synthetic',tuResponse:raw})).rejects.toMatchObject({statusCode:400});
});
test.each([{...raw,status:false},{...raw,username:'9900000002'},{...raw,type:'employee'}])('invalid provider success or identity mismatch cannot authenticate',async response=>{
  const {service} = setup({fetchImpl:async()=>({ok:true,json:async()=>response})});
  await expect(service.login({studentId:profile.student_number,password:'synthetic'})).rejects.toMatchObject({statusCode:401});
});
test('TU login resolves the provisioned identity and never overwrites canonical program or profile',async()=>{
  const {service,pool,resolver} = setup();
  const result = await service.login({studentId:profile.student_number,password:'synthetic'});
  expect(resolver.resolveIdentity).toHaveBeenCalledWith(issuer,profile.student_number);
  expect(result.profile.program).toBe('regular');expect(result.profile.full_name).toBe(profile.full_name);
  expect(pool.query.mock.calls.every(([sql])=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toBe(true);
  const validator = new TokenValidator({tuIssuer:issuer,tuClientId:'coed-api',tuPublicKey:keys.publicKey});
  await expect(validator.validateToken(result.accessToken)).resolves.toMatchObject({issuer,subject:profile.student_number});
});
test('unlinked TU identity is denied without provisioning or selecting another active Student',async()=>{
  const pool = {query:jest.fn(async()=>({rows:[]}))};
  await expect(new IdentityResolver({pool}).resolveIdentity(issuer,profile.student_number)).rejects.toMatchObject({statusCode:403});
  expect(pool.query).toHaveBeenCalledTimes(1);
});
test('there is no repository default signing key',()=>{
  const saved = [process.env.TU_AUTH_PRIVATE_KEY,process.env.TU_AUTH_PUBLIC_KEY];
  delete process.env.TU_AUTH_PRIVATE_KEY;delete process.env.TU_AUTH_PUBLIC_KEY;
  try {expect(()=>getTuKeyPair()).toThrow();} finally {
    for(const [i,k] of ['TU_AUTH_PRIVATE_KEY','TU_AUTH_PUBLIC_KEY'].entries())if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];
  }
});
test('TU verification key is not usable for a Cognito issuer',async()=>{
  const now=Math.floor(Date.now()/1000);
  const payload={sub:'synthetic',iss:'https://cognito.example.invalid/pool',client_id:'client',token_use:'access',scope:'coed-api/access',exp:now+60};
  const token=signTuJwt(payload,{privateKey:keys.privateKey});
  const validator=new TokenValidator({expectedIssuer:payload.iss,expectedClientId:'client',tuPublicKey:keys.publicKey});
  await expect(validator.validateToken(token)).rejects.toMatchObject({statusCode:401});
});
test('TU claims cannot enter through unverified Cognito authorizer claim validation',()=>{
  const validator=new TokenValidator({expectedIssuer:'https://cognito.example.invalid/pool',expectedClientId:'coed-api'});
  expect(()=>validator.validateClaims({sub:'synthetic',iss:issuer,client_id:'coed-api',token_use:'access',scope:'coed-api/access',exp:Math.floor(Date.now()/1000)+60})).toThrow();
});
