const {schedule,reviewSchedule,academic,declarations}=require('../src/api/services/coordinator-domain');
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
test('review-only dates need an explicit timezone and ordered valid boundaries, without intake or confirmation fields',()=>{
  expect(reviewSchedule(windows)).toEqual({review_opens_at:'2026-11-23T02:00:00.000Z',review_closes_at:'2026-11-27T09:30:00.000Z'});
  for(const bad of [null,'2026-11-23T09:00','2026-11-31T09:00:00+07:00',windows.review_closes_at])
    expect(()=>reviewSchedule({...windows,review_opens_at:bad})).toThrow();
  expect(()=>reviewSchedule({...windows,review_closes_at:windows.review_opens_at})).toThrow();
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

const results=require('../src/api/services/coordinator-results');
const roster=()=>Array.from({length:3},(_,i)=>({id:randomUUID(),version:3,full_name:'Synthetic '+i,source:'PHASE1'}));
const savedResult=rows=>({finalized:true,proposal:{total:1,status:'accepted'},applicants:rows.map(({id,version})=>({id,version})),selected:[rows[0].id],history:[{title:'finalize',at:'2026-11-10T02:00:00Z'}]});
test('results reflect the finalized saved selection, independent of grades/cutoff; input stays immutable',()=>{
 const rows=roster(),state=savedResult(rows),before=structuredClone(state),read=results.result(state,rows);
 expect(read.status).toBe('CONFIRMED');expect(read.selected).toBe(1);expect(read.not_selected).toBe(2);
 expect(read.applicants.filter(r=>r.outcome==='SELECTED').map(r=>r.id)).toEqual(state.selected);expect(state).toEqual(before);
 // Ties or meeting exceptions can exceed capacity: read the Committee's actual choice.
 expect(results.result({...state,selected:rows.map(r=>r.id)},rows).selected).toBe(3);
 expect(results.capacity({normal:2,special:1})).toBe(3);expect(results.capacity({total:2,normal:3,special:0})).toBeNull();
});
test('pending selection does not classify anyone, and shared out-of-scope results never expose names/counts',()=>{
 const rows=roster(),state=savedResult(rows);expect(results.result({...state,finalized:false},rows)).toMatchObject({status:'PENDING',selected:null,not_selected:null,applicants:[]});
 expect(results.result(state,rows,{scopeLimited:true})).toEqual({status:'SCOPE_LIMITED',capacity:null,proposal_status:null,forwarded:null,selected:null,not_selected:null,applicants:[],finalized_at:null});
});
test('missing, changed, duplicate or foreign finalized identities fail closed rather than inventing rejections',()=>{
 const rows=roster(),state=savedResult(rows);
 for(const changed of [{...state,applicants:null},{...state,applicants:[null]},{...state,selected:[randomUUID()]},{...state,selected:[rows[0].id,rows[0].id]},
  {...state,applicants:[state.applicants[0],state.applicants[0]]},{...state,applicants:state.applicants.map(a=>({...a,version:4}))},{...state,proposal:{total:1,status:'pending'}}]){
  expect(results.result(changed,rows)).toMatchObject({status:'INCOMPLETE',selected:null,not_selected:null,applicants:[]});
 }
 expect(results.result(state,rows.slice(1)).status).toBe('INCOMPLETE');expect(results.result(state,[...rows,{id:randomUUID(),version:3}]).status).toBe('INCOMPLETE');
});
test('mixed-panel totals leave unconfirmed outcomes unknown and do not depend on list pagination',()=>{
 const rows=roster(),state=savedResult(rows),one={result:results.result(state,rows)},two={result:results.result({...state,finalized:false},rows)};
 expect(results.summary([one,two])).toEqual({panels:2,confirmed_panels:1,forwarded:6,capacity:2,selected:null,not_selected:null});
 expect(results.summary([one])).toMatchObject({forwarded:3,selected:1,not_selected:2});
 expect(results.summary([one,{result:results.result(state,rows,{scopeLimited:true})}])).toMatchObject({forwarded:null,capacity:null,selected:null,not_selected:null});
});
