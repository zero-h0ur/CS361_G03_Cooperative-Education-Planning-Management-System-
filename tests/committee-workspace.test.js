const {transition}=require('../src/api/services/committee-workspace-domain');
const {CommitteeWorkspaceService}=require('../src/api/services/committee-workspace');
const members=['a','b','c'],students=[{id:'s1'},{id:'s2'}];
const propose=()=>transition({proposal:null,history:[]},'a',{action:'propose',normal:1,special:1,reason:'test'},students,members);
test('only one pending proposal, proposer cannot vote, both others required',()=>{
 const p=propose();expect(()=>transition(p,'b',{action:'propose',normal:2,special:1,reason:'test'},students,members)).toThrow();
 expect(()=>transition(p,'a',{action:'accept'},students,members)).toThrow();
 const one=transition(p,'b',{action:'accept'},students,members);expect(one.proposal.status).toBe('pending');
 const two=transition(one,'c',{action:'accept'},students,members);expect(two.proposal.status).toBe('accepted');
 expect(()=>transition(two,'b',{action:'reject',reason:'test'},students,members)).toThrow();
});
test('rejection requires reason and allows a fresh proposal',()=>{
 const p=propose();expect(()=>transition(p,'b',{action:'reject'},students,members)).toThrow();
 const rejected=transition(p,'b',{action:'reject',reason:'change counts'},students,members);
 const next=transition(rejected,'c',{action:'propose',normal:2,special:0,reason:'new'},students,members);expect(next.proposal.number).toBe(2);
});
test('finalization needs approvals, selected ids are in server scope, and is immutable',()=>{
 const p=propose();const body={action:'finalize',selected:['s1'],ranking:'core'};
 expect(()=>transition(p,'b',body,students,members)).toThrow();
 const accepted=transition(transition(p,'b',{action:'accept'},students,members),'c',{action:'accept'},students,members);
 expect(()=>transition(accepted,'a',{...body,selected:['outside']},students,members)).toThrow();
 const final=transition(accepted,'a',body,students,members);expect(final.finalized).toBe(true);
 expect(()=>transition(final,'b',body,students,members)).toThrow();
});
test('role checked before database membership lookup',async()=>{
 const pool={query:jest.fn()};const service=new CommitteeWorkspaceService({pool});
 await expect(service.read({isAuthenticated:true,userId:'x',role:'STUDENT',accountStatus:'ACTIVE'})).rejects.toThrow();expect(pool.query).not.toHaveBeenCalled();
});
test('Phase 1 forwarded students with declared_academic fallbacks map curriculum and program correctly',async()=>{
  const query=jest.fn()
    .mockResolvedValueOnce({rows:[]})
    .mockResolvedValueOnce({rows:[{ready:false}]})
    .mockResolvedValueOnce({rows:[{
      id:'app-1',
      application_version:2,
      program:'ภาคพิเศษ',
      snapshot:{
        official:{full_name:'นายสมชาย ใจดี'},
        declared_academic:{curriculum:'66',program_type:'special',student_number:'6609650001'},
        payload:{thai_full_name:'นายสมชาย ใจดี'},
        assessment:{review_required:false}
      }
    }]});
  const service=new CommitteeWorkspaceService({pool:{query}});
  const result=await service.students({query},{id:'cohort-1'});
  expect(result).toHaveLength(1);
  expect(result[0].curriculum).toBe('66');
  expect(result[0].program).toBe('special');
  expect(result[0].number).toBe('6609650001');
  expect(result[0].source).toBe('PHASE1');
});

test('combined capacity accepts total-only commands and consistent legacy commands',()=>{
  const total=transition({proposal:null,history:[]},'a',{action:'propose',total:3,reason:'Combined intake'},students,members);
  expect(total.proposal).toMatchObject({total:3,normal:3,special:0});
  const legacy=propose();expect(legacy.proposal.total).toBe(2);
});
test.each([{total:0},{total:1000},{total:1.5},{total:'3'},{total:null},{total:2,normal:2,special:1},{normal:2},{normal:-1,special:3}])('rejects malformed or contradictory capacity %j',capacity=>{
  expect(()=>transition({proposal:null,history:[]},'a',{action:'propose',reason:'Capacity',...capacity},students,members)).toThrow('Invalid capacity.');
});

test('Committee displays reviewed academic results while retaining the pending original submission',async()=>{
  const reviewed={eligibility:'PASS',group_gpa:'3.40',gpax:'3.12',curriculum:'66',program_type:'special'};
  const original={eligibility:'UNKNOWN',review_required:true};
  const query=jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[{
    id:'app',submission_id:'submission',checksum:'abc',academic_review_id:'review',reviewed_assessment:reviewed,application_version:2,program:'ACS',
    snapshot:{official:{full_name:'Synthetic'},declared_academic:{curriculum:'61',program_type:'regular'},payload:{},assessment:original}
  }]});
  const result=await new CommitteeWorkspaceService({pool:{query}}).students({query},{id:'cohort'});
  expect(result[0]).toMatchObject({core:3.4,gpax:3.12,curriculum:'66',program:'special',academic_review_id:'review',reviewed_assessment:reviewed,original_assessment:original,submission_id:'submission',checksum:'abc'});
});
