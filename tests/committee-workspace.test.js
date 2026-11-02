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
