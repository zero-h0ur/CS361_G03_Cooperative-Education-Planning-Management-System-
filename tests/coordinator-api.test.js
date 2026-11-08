const {createLambdaHandler}=require('../src/lambda');
const {TokenValidator,IdentityResolver}=require('../src/auth');
const {randomUUID}=require('node:crypto');
const issuer='https://issuer.example.invalid/coordinator',clientId='test-coordinator-client';
function setup(role='COORDINATOR') {
  const userId=randomUUID(),pool={query:jest.fn(async()=>({rows:[{user_id:userId,role,account_status:'ACTIVE',link_status:'ACTIVE',active_link_count:1}]}))};
  const service=Object.fromEntries(['options','list','detail','tracking','review','confirmAcademics','getSchedule','saveSchedule'].map(k=>[k,jest.fn(async()=>({ok:true}))]));
  const handler=createLambdaHandler({coordinatorWorkspaceService:service,authOptions:{pool,
    tokenValidator:new TokenValidator({expectedIssuer:issuer,expectedClientId:clientId}),identityResolver:new IdentityResolver({pool})}});
  const event=(path,method='GET',authenticated=true)=>({rawPath:path,rawQueryString:'',body:method==='POST'?'{}':undefined,
    headers:{'x-role':'COORDINATOR'},requestContext:{http:{method},...(authenticated?{authorizer:{jwt:{claims:{iss:issuer,sub:'synthetic',client_id:clientId,
      token_use:'access',scope:'coed-api/access',exp:Math.floor(Date.now()/1000)+3600,role:'COORDINATOR'},scopes:['coed-api/access']}}}:{})}});
  return {service,handler,event,userId};
}
test.each(['options','applications','tracking'])('Coordinator %s read uses trusted identity and no-store',async path=>{
  const {handler,event}=setup();const response=await handler(event('/api/v4/coordinator/'+path));
  expect(response.statusCode).toBe(200);expect(response.headers['Cache-Control']).toBe('no-store');
});
test('scoped filters and exact review submission identity reach the service',async()=>{
  const {handler,event,service,userId}=setup(),id=randomUUID();
  const get=event('/api/v4/coordinator/applications');get.rawQueryString='curriculum=66&program_type=special&state=PENDING&page=2';
  expect((await handler(get)).statusCode).toBe(200);
  expect(service.list).toHaveBeenCalledWith(expect.objectContaining({userId,role:'COORDINATOR'}),{curriculum:'66',program_type:'special',state:'PENDING',page:'2'});
  const post=event(`/api/v4/coordinator/applications/${id}/forward`,'POST');
  post.body=JSON.stringify({operation_id:randomUUID(),expected_version:0,submission_id:randomUUID()});
  expect((await handler(post)).statusCode).toBe(200);expect(service.review).toHaveBeenCalledWith(expect.objectContaining({userId}),id,JSON.parse(post.body),'forward');
});
test.each(['STUDENT','STAFF','ADVISOR','ADMIN','COMMITTEE'])('%s cannot read or mutate Coordinator resources with a forged role header',async role=>{
  const {handler,event,service}=setup(role),id=randomUUID();
  for(const [path,method] of [['/api/v4/coordinator/applications','GET'],[`/api/v4/coordinator/applications/${id}/return`,'POST'],[`/api/v4/coordinator/schedules/${id}`,'POST']])
    expect((await handler(event(path,method))).statusCode).toBe(403);
  for(const fn of Object.values(service))expect(fn).not.toHaveBeenCalled();
});
test('anonymous malformed commands fail auth before body parsing; duplicate/unknown filters fail closed',async()=>{
  const {handler,event,service}=setup();const post=event(`/api/v4/coordinator/schedules/${randomUUID()}`,'POST',false);post.body='{';
  expect((await handler(post)).statusCode).toBe(401);
  for(const query of ['role=ADMIN','cycle_id=x&cycle_id=y']){const get=event('/api/v4/coordinator/applications');get.rawQueryString=query;expect((await handler(get)).statusCode).toBe(400);}
  expect(service.saveSchedule).not.toHaveBeenCalled();expect(service.list).not.toHaveBeenCalled();
});

test('academic review route uses the trusted Coordinator and refuses forged student role',async()=>{
 const {handler,event,service,userId}=setup(),id=randomUUID(),post=event('/api/v4/coordinator/applications/'+id+'/academic-review','POST');
 post.body=JSON.stringify({operation_id:randomUUID(),expected_version:0,submission_id:randomUUID(),expected_policy_id:randomUUID(),checks:{grades:true},note:'Synthetic'});
 expect((await handler(post)).statusCode).toBe(200);expect(service.confirmAcademics).toHaveBeenCalledWith(expect.objectContaining({userId,role:'COORDINATOR'}),id,JSON.parse(post.body));
 const student=setup('COMMITTEE');expect((await student.handler(student.event(post.rawPath,'POST'))).statusCode).toBe(403);expect(student.service.confirmAcademics).not.toHaveBeenCalled();
});
