const {randomUUID}=require('node:crypto');
const {createLambdaHandler}=require('../src/lambda');
const {TokenValidator,IdentityResolver}=require('../src/auth');
const issuer='https://issuer.example.invalid/application-test',clientId='application-client';
function setup(role='STUDENT') {
  const userId=randomUUID(),studentId=randomUUID(),id=randomUUID();
  const pool={query:jest.fn(async()=>({rows:[{user_id:userId,role,account_status:'ACTIVE',link_status:'ACTIVE',active_link_count:1,student_id:role==='STUDENT'?studentId:null}]}))};
  const applicationService=Object.fromEntries(['options','list','get','create','save','readiness','submit','beginUpload','completeUpload','localContent'].map(k=>[k,jest.fn(async()=>({id,version:1}))]));
  applicationService.download=jest.fn(async()=>({document:{object_key:'private-key-never-in-json'},download:{url:'https://example.invalid/private',method:'GET',auth_required:false}}));
  applicationService.documentStore=()=>({local:true});
  const handler=createLambdaHandler({applicationService,authOptions:{pool,tokenValidator:new TokenValidator({expectedIssuer:issuer,expectedClientId:clientId}),identityResolver:new IdentityResolver({pool})}});
  const event=(path,method='GET',authenticated=true)=>({rawPath:path,rawQueryString:'',body:['POST','PATCH','PUT'].includes(method)?'{}':undefined,
    headers:{'x-role':'STUDENT','Content-Type':'application/json'},requestContext:{http:{method},...(authenticated?{authorizer:{jwt:{claims:{iss:issuer,sub:'test-sub',client_id:clientId,
      token_use:'access',scope:'coed-api/access',exp:Math.floor(Date.now()/1000)+3600,role:'ADMIN','cognito:groups':['STUDENT']},scopes:['coed-api/access']}}}:{})}});
  return {handler,event,applicationService,id,userId,studentId};
}
test.each([['GET','/api/v4/application-options','options'],['GET','/api/v4/applications','list'],['POST','/api/v4/applications','create']])('%s %s uses trusted Student and no-store',async(method,path,fn)=>{
  const {handler,event,applicationService,userId,studentId}=setup();const response=await handler(event(path,method));
  expect(response.statusCode).toBe(200);expect(response.headers['Cache-Control']).toBe('no-store');
  expect(applicationService[fn]).toHaveBeenCalledWith(expect.objectContaining({role:'STUDENT',userId,studentId}),...(method==='POST'?[{}]:[]));
});
test.each(['get','save','readiness','submit','beginUpload','completeUpload','download'])('detail endpoint reaches %s only through authenticated boundary',async fn=>{
  const {handler,event,applicationService,id}=setup();
  const [method,suffix]={get:['GET',''],save:['PATCH',''],readiness:['GET','/readiness'],submit:['POST','/submit'],beginUpload:['POST','/uploads'],
    completeUpload:['POST',`/uploads/${randomUUID()}/complete`],download:['POST',`/documents/${randomUUID()}/download`]}[fn];
  const response=await handler(event('/api/v4/applications/'+id+suffix,method));expect(response.statusCode).toBe(200);
  expect(applicationService[fn]).toHaveBeenCalled();expect(response.body).not.toContain('private-key-never-in-json');
});
test.each(['STAFF','ADVISOR','ADMIN','COMMITTEE','COORDINATOR'])('%s cannot write by spoofing a Student group/header',async role=>{
  const {handler,event,applicationService,id}=setup(role);expect((await handler(event('/api/v4/applications/'+id+'/submit','POST'))).statusCode).toBe(403);
  expect(applicationService.submit).not.toHaveBeenCalled();
});
test('anonymous malformed JSON is denied before parsing; unknown/duplicate query filters rejected',async()=>{
  const {handler,event,applicationService}=setup();const req=event('/api/v4/applications','POST',false);req.body='{';
  expect((await handler(req)).statusCode).toBe(401);expect(applicationService.create).not.toHaveBeenCalled();
  for(const query of ['student_id='+randomUUID(),'cycle=x&cycle=y']){const req=event('/api/v4/applications');req.rawQueryString=query;
    expect((await handler(req)).statusCode).toBe(400);}expect(applicationService.list).not.toHaveBeenCalled();
});
test('raw local bytes are refused in production regardless of injected local adapter',async()=>{
  const before=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{const {handler,event,applicationService,id}=setup();
    expect((await handler(event(`/api/v4/applications/${id}/uploads/${id}/content`,'PUT'))).statusCode).toBe(503);
    expect(applicationService.localContent).not.toHaveBeenCalled();
  }finally{process.env.NODE_ENV=before;}
});
