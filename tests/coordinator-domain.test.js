const {schedule,academic,declarations}=require('../src/api/services/coordinator-domain');
const {CoordinatorWorkspaceService}=require('../src/api/services/coordinator-workspace-service');
const {randomUUID}=require('node:crypto');
const windows={opens_at:'2026-11-02T09:00:00+07:00',closes_at:'2026-11-20T16:30:00+07:00',
  review_opens_at:'2026-11-23T09:00:00+07:00',review_closes_at:'2026-11-27T16:30:00+07:00',
  confirmation_opens_at:'2026-12-01T09:00:00+07:00',confirmation_closes_at:'2026-12-07T16:30:00+07:00'};
test('schedule is timezone-explicit and all three windows have ordered boundaries',()=>{
  expect(schedule(windows).opens_at).toBe('2026-11-02T02:00:00.000Z');
  for(const key of Object.keys(windows))expect(()=>schedule({...windows,[key]:'2026-11-02T09:00'})).toThrow();
  expect(()=>schedule({...windows,review_closes_at:windows.review_opens_at})).toThrow();
  expect(()=>schedule({...windows,confirmation_opens_at:windows.closes_at})).toThrow();
  expect(()=>schedule({...windows,closes_at:'not a date'})).toThrow();
  for(const invalid of ['2026-11-31T09:00:00+07:00','2026-02-29T09:00:00Z','2026-11-02T24:00:00+07:00','prefix2026-11-02T09:00:00Z'])
    expect(()=>schedule({...windows,opens_at:invalid})).toThrow();
  expect(schedule({...windows,opens_at:'2024-02-29T09:00:00+07:00'}).opens_at).toBe('2024-02-29T02:00:00.000Z');
});
test('missing or unverified academic data is unknown, never an invented pass or zero',()=>{
  expect(academic(null)).toEqual({core:null,gpax:null,declared_core:null});
  expect(academic({payload:{gpax:'3.12',declared_group_gpa:'2.8'}})).toEqual({core:null,gpax:3.12,declared_core:2.8});
  expect(academic({payload:{gpax:'',declared_group_gpa:'NaN'}}).gpax).toBeNull();
});
test('seven self-certifications are literal independent student answers, not computed results',()=>{
  const result=declarations({payload:{acknowledgements:{program:true,gpax:true}}});
  expect(result).toHaveLength(7);expect(result.filter(x=>x.checked)).toHaveLength(2);
  expect(result.find(x=>x.key==='conduct').checked).toBe(false);
});
test('legacy confirmation checkbox cannot replace a retained academic review',async()=>{
  const pool={connect:jest.fn()},service=new CoordinatorWorkspaceService({pool});
  await expect(service.review({},randomUUID(),{operation_id:randomUUID(),expected_version:0,submission_id:randomUUID(),confirm_academic_review:true},'forward')).rejects.toMatchObject({statusCode:400});
  expect(pool.connect).not.toHaveBeenCalled();
});
