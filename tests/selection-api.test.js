const {createLambdaHandler}=require('../src/lambda');
const {TokenValidator,IdentityResolver}=require('../src/auth');
const {randomUUID}=require('node:crypto');
const issuer='https://issuer.example.invalid/test-pool',clientId='selection-test-client';
function setup(role){
  const userId=randomUUID();
  const pool={query:jest.fn(async()=>({rows:[{user_id:userId,role,account_status:'ACTIVE',link_status:'ACTIVE',active_link_count:1,
    ...(role==='STUDENT'?{student_id:randomUUID()}:{student_id:null})}]}))};
  const selectionService={list:jest.fn(async()=>({cohorts:[],applications:[]})),mutate:jest.fn(async()=>({opinion_count:1})),
    studentList:jest.fn(async()=>({applications:[]})),studentStatus:jest.fn(async()=>({opinion_count:0}))};
  const handler=createLambdaHandler({selectionService,authOptions:{pool,
    tokenValidator:new TokenValidator({expectedIssuer:issuer,expectedClientId:clientId}),identityResolver:new IdentityResolver({pool})}});
  const event=(path,method='GET',authenticated=true)=>({rawPath:path,rawQueryString:'',body:method==='POST'?'{}':undefined,
    headers:{'x-role':'COORDINATOR'},requestContext:{http:{method},...(authenticated?{authorizer:{jwt:{claims:{iss:issuer,sub:'synthetic-sub',
      client_id:clientId,token_use:'access',scope:'coed-api/access',exp:Math.floor(Date.now()/1000)+3600,
      role:'ADMIN','cognito:groups':['COORDINATOR','COMMITTEE','STAFF']},scopes:['coed-api/access']}}}:{})}});
  return {handler,event,selectionService,userId};
}
test.each([
  ['COORDINATOR','/api/v3/coordinator/applications'],['COMMITTEE','/api/v3/committee/applications']
])('%s route uses the trusted database identity and sends no-store',async(role,path)=>{
  const {handler,event,selectionService,userId}=setup(role);
  const response=await handler(event(path));expect(response.statusCode).toBe(200);
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(selectionService.list).toHaveBeenCalledWith(expect.objectContaining({role,userId}),{});
});
test.each(['STUDENT','STAFF','ADVISOR','ADMIN','COMMITTEE'])('%s cannot call Coordinator command using role headers/groups',async role=>{
  const {handler,event,selectionService}=setup(role);
  const response=await handler(event(`/api/v3/coordinator/plans/${randomUUID()}/acknowledge`,'POST'));
  expect(response.statusCode).toBe(403);expect(selectionService.mutate).not.toHaveBeenCalled();
});
test.each(['STUDENT','STAFF','ADVISOR','ADMIN','COORDINATOR'])('%s cannot submit a Committee opinion using role headers/groups',async role=>{
  const {handler,event,selectionService}=setup(role);
  expect((await handler(event(`/api/v3/committee/plans/${randomUUID()}/opinion`,'POST'))).statusCode).toBe(403);
  expect(selectionService.mutate).not.toHaveBeenCalled();
});
test('anonymous command is denied before malformed JSON or service execution',async()=>{
  const {handler,event,selectionService}=setup('COORDINATOR');
  const request=event(`/api/v3/coordinator/plans/${randomUUID()}/acknowledge`,'POST',false);request.body='{';
  expect((await handler(request)).statusCode).toBe(401);expect(selectionService.mutate).not.toHaveBeenCalled();
});
test('unknown/duplicate scope filters are rejected rather than used to enlarge access',async()=>{
  const {handler,event,selectionService}=setup('COMMITTEE');
  for(const query of ['role=COMMITTEE','department=CPE&department=OTHER']){
    const request=event('/api/v3/committee/applications');request.rawQueryString=query;
    expect((await handler(request)).statusCode).toBe(400);
  }
  expect(selectionService.list).not.toHaveBeenCalled();
});
