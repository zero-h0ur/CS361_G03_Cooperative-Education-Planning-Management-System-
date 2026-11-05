const {generateKeyPairSync,randomUUID}=require('node:crypto');
const {REGISTRATION,identity,fromProvider,verifyTicket,envelope,metadata}=require('../src/auth/tu-registration-contract');
const {TuRegistrationService}=require('../src/auth/tu-registration-service');
const {TokenValidator}=require('../src/auth/token-validator');
const {signTuJwt}=require('../src/auth/tu-keys');
const {tuConfig}=require('../src/auth/tu-config');
const {createTuSessionIssuer}=require('../src/tu-session-issuer');
const {TuProviderVerifier}=require('../src/auth/tu-provider-verifier');
const {TuBrokerService}=require('../src/auth/tu-broker-service');
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),now=Date.now(),subject='9900000019';
const i={subject,nameTh:'Synthetic Student',nameEn:null,email:'student@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'ปกติ',statusId:null};
const e=()=>({contract:REGISTRATION,operation:'begin',subject,identity:{...i},verifiedAt:now,requestId:randomUUID()});
const make=options=>new TuRegistrationService({pool:{query:async()=>({rows:[{linked:false,student:false}]})},clock:()=>now,publicKey:keys.publicKey,...options});
const ticket=async()=> (await make().begin(e(),async()=>keys)).registrationToken;
const sign=p=>signTuJwt(p,{privateKey:keys.privateKey,kid:tuConfig().kid});

test('new-owner ticket has a separate purpose and never authorizes a normal API',async()=>{
 const token=await ticket(),p=verifyTicket(token,{publicKey:keys.publicKey,now:Math.floor(now/1000)});
 expect(p.identity).toEqual(i);expect(p.exp-p.iat).toBe(300);
 await expect(new TokenValidator({tuPublicKey:keys.publicKey}).validateToken(token,Math.floor(now/1000))).rejects.toThrow();
});
test.each(['สำเร็จการศึกษา','พักการศึกษา','ลาออก','',null,'unknown'])('new registration rejects non-normal status: %s',status=>{
 expect(()=>identity({...i,tuStatus:status})).toThrow();
});
test('contradictory graduated status, missing identity and override fields reject',()=>{
 expect(()=>identity({...i,statusId:'40'})).toThrow();
 expect(()=>identity({...i,role:'ADMIN'})).toThrow();
 expect(()=>fromProvider({displayname_th:'Student'},subject)).toThrow();
 expect(()=>metadata({identity:i,program_type:'regular',entry_year:2567,study_source:'official',academic_verification:'pending'},{})).toThrow();
});
test.each([{linked:true,student:false},{linked:false,student:true},{},null])('any legacy link/profile or missing DB answer blocks begin',async row=>{
 const getKeys=jest.fn();await expect(make({pool:{query:async()=>({rows:row?[row]:[]})}}).begin(e(),getKeys)).rejects.toThrow();
 expect(getKeys).not.toHaveBeenCalled();
});
test('proof must be fresh, exact and bound to the same subject',()=>{
 expect(()=>envelope(e(),now)).not.toThrow();
 for(const bad of [{...e(),verifiedAt:now-30001},{...e(),subject:'9900000020'},{...e(),role:'STUDENT'}])expect(()=>envelope(bad,now)).toThrow();
});
test('tampered, expired, wrong-purpose and numeric-string claims fail closed',async()=>{
 const token=await ticket(),p=verifyTicket(token,{publicKey:keys.publicKey,now:Math.floor(now/1000)});
 for(const patch of [{token_use:'access'},{scope:'coed-api/access'},{aud:'coed-api'},{sub:'9900000020'},{exp:String(p.exp)},{iat:p.iat-301,nbf:p.iat-301,exp:p.exp-301},{role:'ADMIN'}])
  expect(()=>verifyTicket(sign({...p,...patch}),{publicKey:keys.publicKey,now:Math.floor(now/1000)})).toThrow();
 expect(()=>verifyTicket(token.slice(0,-10)+'AAAAAAAAAA',{publicKey:keys.publicKey})).toThrow();
});
test('completion uses a separate connection, binds exact proof and closes it',async()=>{
 const query=jest.fn(async()=>({rows:[{student_id:randomUUID(),user_id:randomUUID()}]})),end=jest.fn(async()=>{}),token=await ticket();
 const service=make({provisionConnect:async()=>({query,end})});
 const result=await service.complete({ticket:token,study:{programType:'regular',entryYear:2567},operationId:randomUUID()});
 expect(result.subject).toBe(subject);expect(query.mock.calls[0][0]).toContain('public.complete_tu_registration');
 expect(JSON.parse(query.mock.calls[0][1][3])).toEqual(i);expect(end).toHaveBeenCalledTimes(1);
});
test('issuer rejects completion owner mismatch; no access session leaves the boundary',async()=>{
 const previous=process.env.TU_ONBOARDING_ENABLED;process.env.TU_ONBOARDING_ENABLED='true';
 try{
  const targetArn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:candidate';
  const issuer=createTuSessionIssuer({targetArn,clock:()=>now,logger:()=>{},getKeys:async()=>keys,
   registrationService:{complete:async()=>({subject,userId:randomUUID(),studentId:randomUUID()})},
   sessionService:{issue:async()=>({user:{id:randomUUID(),studentId:randomUUID()}})}});
  const result=await issuer({contract:REGISTRATION,operation:'complete',ticket:await ticket(),study:{programType:'regular',entryYear:2567},operationId:randomUUID(),requestId:randomUUID()},
   {invokedFunctionArn:targetArn,functionVersion:'1'});
  expect(result.ok).toBe(false);expect(result.session).toBeUndefined();
 }finally{if(previous===undefined)delete process.env.TU_ONBOARDING_ENABLED;else process.env.TU_ONBOARDING_ENABLED=previous;}
});
test('broker new-owner flow uses fresh verified fields only; provider credentials never reach issuer',async()=>{
 const previous=process.env.TU_ONBOARDING_ENABLED;process.env.TU_ONBOARDING_ENABLED='true';
 try{
  const targetArn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:candidate',forwarded=[];
  const issuer=createTuSessionIssuer({targetArn,clock:()=>now,logger:()=>{},getKeys:async()=>keys,registrationService:make(),
   sessionService:{issue:async()=>{throw Object.assign(Error(),{statusCode:403});}}});
  const verifier=new TuProviderVerifier({tuAppKey:'SYNTHETIC_KEY',tuSecretArn:'',clock:()=>now,fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:true,type:'student',username:subject,
   displayname_th:i.nameTh,email:i.email,faculty:i.faculty,department:i.department,tu_status:i.tuStatus})})});
  const service=new TuBrokerService({targetArn,clock:()=>now,publicKey:keys.publicKey,verifier,client:{send:async command=>{
   const value=JSON.parse(Buffer.from(command.input.Payload));forwarded.push(value);
   return {StatusCode:200,ExecutedVersion:'1',Payload:Buffer.from(JSON.stringify(await issuer(value,{invokedFunctionArn:targetArn,functionVersion:'1'})))};
  }}});
  const result=await service.login({studentId:subject,password:'SYNTHETIC_PASSWORD'},randomUUID());
  expect(result.contract).toBe(REGISTRATION);expect(result.accessToken).toBeUndefined();expect(forwarded).toHaveLength(2);
  expect(JSON.stringify(forwarded)).not.toContain('SYNTHETIC_PASSWORD');expect(forwarded[1].identity).toEqual(i);
 }finally{if(previous===undefined)delete process.env.TU_ONBOARDING_ENABLED;else process.env.TU_ONBOARDING_ENABLED=previous;}
});
