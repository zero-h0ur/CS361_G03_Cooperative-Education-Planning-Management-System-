/** @jest-environment jsdom */
const {renderCommitteeWorkspace}=require('../tmp/frontend-test-modules/committee/workspace.cjs');
const {compareApplicants}=require('../tmp/frontend-test-modules/committee/ranking.cjs');
const flush=()=>new Promise(r=>setTimeout(r,10));
const students=[{id:'a',name:'Higher Core',number:'TEST01',core:3.9,gpax:3.0,program:'regular',curriculum:'61'},{id:'b',name:'Higher GPAX',number:'TEST02',core:3.2,gpax:3.9,program:'regular',curriculum:'61'}];
const model=()=>({students,cohort_id:'cohort',members:['one','two','three'],me:'two',version:1,cycle_name:'Test round',state:{proposal:{number:1,normal:1,special:0,proposer:'one',votes:{two:'pending',three:'accepted'},status:'pending',reason:'Test',created:'Test date'},history:[],selected:[],finalized:false}});
beforeAll(()=>{CSSStyleSheet.prototype.replaceSync=function(){};HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};window.scrollTo=()=>{};});
afterEach(()=>document.body.replaceChildren());
test('ranking priority swaps order, uses secondary key and keeps unknown grades last',()=>{
 expect([...students].sort(compareApplicants('core'))[0].id).toBe('a');
 expect([...students].sort(compareApplicants('gpax'))[0].id).toBe('b');
 expect([...students,{id:'c',core:null,gpax:null}].sort(compareApplicants())[2].id).toBe('c');
 expect([{id:'a',core:3,gpax:3},{id:'b',core:3,gpax:4}].sort(compareApplicants())[0].id).toBe('b');
});
test('UI filters, swaps visible ranking, safely escapes names, and clears search',async()=>{
 const data=model();data.students=[...students,{...students[0],id:'x',name:'<img src=x onerror=alert(1)>',core:1,gpax:1}];
 const host=renderCommitteeWorkspace({client:{request:async()=>data}});document.body.append(host);await flush();const root=host.shadowRoot;
 expect(root.querySelector('#applicantRows').textContent.indexOf('Higher Core')).toBeLessThan(root.querySelector('#applicantRows').textContent.indexOf('Higher GPAX'));
 const sort=root.querySelector('#ranking');sort.value='gpax';sort.dispatchEvent(new Event('change'));
 expect(root.querySelector('#applicantRows').textContent.indexOf('Higher GPAX')).toBeLessThan(root.querySelector('#applicantRows').textContent.indexOf('Higher Core'));
 expect(root.querySelector('#applicantRows img')).toBeNull();
 const search=root.querySelector('#searchInput');search.value='none';search.dispatchEvent(new Event('input'));expect(root.querySelector('#applicantRows').textContent).toContain('ไม่พบผู้สมัคร');
 root.querySelector('#clearSearch').click();expect(search.value).toBe('');
});
test('confirmation posts the real version and never changes state before a server response',async()=>{
 const data=model();let reject;
 const request=jest.fn(async(path,options)=>{if(options?.method==='POST')return new Promise((_,r)=>{reject=r;});return data;});
 const host=renderCommitteeWorkspace({client:{request}});document.body.append(host);await flush();const root=host.shadowRoot;
 root.querySelector('[data-view="capacity"]').click();root.querySelector('[data-review="accept"]').click();root.querySelector('#submitVote').click();await flush();
 expect(request.mock.calls[1][1].body).toMatchObject({action:'accept',expected_version:1});expect(root.querySelector('#submitVote').disabled).toBe(true);
 reject(new Error('offline'));await flush();expect(root.querySelector('#submitVote').disabled).toBe(false);expect(root.querySelector('#voteError').textContent).toContain('บันทึกไม่สำเร็จ');
});
test('read failure offers retry and expired access invokes session handler',async()=>{
 const onSessionExpired=jest.fn();const host=renderCommitteeWorkspace({client:{request:async()=>{throw Object.assign(new Error('expired'),{status:401});}},onSessionExpired});document.body.append(host);await flush();expect(onSessionExpired).toHaveBeenCalled();expect(host.shadowRoot.textContent).toContain('ลองโหลดใหม่');
});
test('server refresh removes old delegated listeners before the next confirmation',async()=>{
 const data=model();const request=jest.fn(async(_path,opts)=>{if(opts?.method==='POST'){data.state.proposal.status='accepted';data.version++;}return JSON.parse(JSON.stringify(data));});
 const host=renderCommitteeWorkspace({client:{request}});document.body.append(host);await flush();const root=host.shadowRoot;
 root.querySelector('[data-view="capacity"]').click();root.querySelector('[data-review="accept"]').click();root.querySelector('#submitVote').click();await flush();
 root.querySelector('[data-go="results"]').click();root.querySelector('#suggestSelection').click();
 const spy=jest.spyOn(HTMLDialogElement.prototype,'showModal');root.querySelector('#confirmResults').click();expect(spy).toHaveBeenCalledTimes(1);spy.mockRestore();
});

test('handoff-only workspace can read applicants but disables proposal, vote and selection actions',async()=>{
 const data={...model(),can_decide:false};const client={request:jest.fn(async()=>JSON.parse(JSON.stringify(data)))};
 const controller=new AbortController(),host=renderCommitteeWorkspace({client,signal:controller.signal});document.body.append(host);await flush();
 const root=host.shadowRoot || host;expect(root.textContent).toContain('ยังไม่เปิดลงมติ');
 for(const b of root.querySelectorAll('[data-propose],[data-review],[data-vote],#confirmResults,#suggestSelection'))expect(b.disabled).toBe(true);
 expect(client.request.mock.calls.every(([,options])=>!options || !options.method || options.method==='GET')).toBe(true);controller.abort();
});

test('combined capacity ranks all assigned tracks and keeps cutoff ties while filters only change visibility',async()=>{
 const data=model();data.students=[
   {id:'a',name:'Highest regular',number:'SYN01',core:3.9,gpax:3,program:'regular',curriculum:'61'},
   {id:'b',name:'Special tie one',number:'SYN02',core:3.8,gpax:3.5,program:'special',curriculum:'66'},
   {id:'c',name:'Below combined cutoff',number:'SYN03',core:3.7,gpax:3,program:'regular',curriculum:'66'},
   {id:'d',name:'Special tie two',number:'SYN04',core:3.8,gpax:3.5,program:'special',curriculum:'61'}
 ];data.state.proposal={...data.state.proposal,total:2,normal:2,special:0,status:'accepted'};
 const host=renderCommitteeWorkspace({client:{request:async()=>data}});document.body.append(host);await flush();const root=host.shadowRoot;
 expect(root.querySelector('#curriculum').value).toBe('all');expect(root.querySelector('#program').value).toBe('all');
 expect(root.querySelectorAll('#applicantRows tr:not(.cutoff-label)')).toHaveLength(4);expect(root.querySelector('#applicantRows').textContent).toContain('ภาคพิเศษ');
 const program=root.querySelector('#program');program.value='regular';program.dispatchEvent(new Event('change'));
 const below=[...root.querySelectorAll('#applicantRows tr')].find(r=>r.textContent.includes('Below combined cutoff'));
 expect(below.textContent).not.toContain('อยู่ในจำนวนเสนอ');
 expect(below.querySelector('.rank').textContent).toBe('4');
 program.value='special';program.dispatchEvent(new Event('change'));
 const tied=[...root.querySelectorAll('#applicantRows tr')].find(r=>r.textContent.includes('Special tie two'));
 expect(tied.classList.contains('tie')).toBe(true);expect(tied.querySelector('.rank').textContent).toBe('3');
 root.querySelector('[data-view=results]').click();root.querySelector('#suggestSelection').click();
 expect([...root.querySelectorAll('[data-select]:checked')].map(n=>n.dataset.select).sort()).toEqual(['a','b','d']);
});

test('new capacity proposal sends only the combined total and retains typed fields on failure',async()=>{
 const data=model();data.state.proposal=null;const request=jest.fn(async(_path,options)=>{if(options?.method==='POST')throw new Error('offline');return data;});
 const host=renderCommitteeWorkspace({client:{request}});document.body.append(host);await flush();const root=host.shadowRoot;
 root.querySelector('[data-view=capacity]').click();root.querySelector('[data-propose]').click();
 root.querySelector('#totalCount').value='5';root.querySelector('#proposalReason').value='Synthetic combined capacity';root.querySelector('#submitProposal').click();await flush();
 expect(request.mock.calls.find(([,o])=>o?.method==='POST')[1].body).toMatchObject({action:'propose',total:5,reason:'Synthetic combined capacity'});
 expect(request.mock.calls.find(([,o])=>o?.method==='POST')[1].body).not.toHaveProperty('normal');
 expect(root.querySelector('#totalCount').value).toBe('5');expect(root.querySelector('#proposalReason').value).toBe('Synthetic combined capacity');
});
