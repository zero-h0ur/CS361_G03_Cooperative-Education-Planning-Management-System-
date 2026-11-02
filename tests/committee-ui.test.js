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
