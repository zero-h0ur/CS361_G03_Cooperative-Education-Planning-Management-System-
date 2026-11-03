/** @jest-environment jsdom */
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');

const mounted = [];
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const draft={id:'14100000-0000-4000-8000-000000000001',cycle_id:'cycle-a',status:'DRAFT',updated_at:'2026-11-02T01:00:00Z'};
const submitted={id:'14100000-0000-4000-8000-000000000002',cycle_id:'cycle-b',status:'SUBMITTED',submitted_at:'2026-10-01T01:00:00Z'};
const cycles=[{id:'cycle-a',name:'รอบปัจจุบัน',status:'OPEN'},{id:'cycle-b',name:'รอบก่อน',status:'CLOSED'}];
const profileData={id:'student',student_number:'SYNTHETIC-01',full_name:'นักศึกษาตัวอย่าง',program:'วิทยาการคอมพิวเตอร์',major:'ACS',
  department:'ภาควิชาตัวอย่าง',institutional_email:'university@example.invalid',contact_email:'contact@example.invalid',
  contact_phone:'0810000000',contact_address:'ที่อยู่ตัวอย่าง',version:1};
const findButton=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
const inputValue=(root,id,text)=>{const input=root.querySelector(id);input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));return input;};
async function mountProfile(overrides={}) {
  const clients={studentProfileClient:{getOwnProfile:jest.fn(async()=>({...profileData}))},
    workflowClient:{request:jest.fn(async(_path,{body})=>({...profileData,...body,version:2}))},
    applicationClient:{options:async()=>({cycles,official:{curriculum:'66',entry_year:2567}}),list:async()=>[draft],save:jest.fn()},...overrides};
  const result=await mount(clients);await flush();await flush();return {...result,...clients};
}
beforeEach(()=>{window.confirm=jest.fn(()=>false);});
async function mount({ role = 'STUDENT', hash = '#/student/profile', ...clients } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const location = { hash };
  const events = new EventTarget();
  const logout = jest.fn();
  const app = createShellApp({ root, location, eventTarget: events, storage: null,
    loadSession: async () => ({ role }), startLogin: async () => {}, restartLogin: async () => {}, logout,
    ...clients });
  mounted.push(app);
  await app.start();
  return { root, app, location, events, logout };
}
afterEach(() => { mounted.splice(0).forEach(app => app.destroy()); document.body.replaceChildren(); });

test('Student gets the approved horizontal header, three labelled destinations and no debugging note', async () => {
  const { root } = await mount();
  expect(root.querySelector('.student-portal')).not.toBeNull();
  expect(root.querySelector('.shell-sidebar')).toBeNull();
  expect([...root.querySelectorAll('.shell-nav a')].map(a => a.textContent))
    .toEqual(['ข้อมูลของฉัน', 'ใบสมัครสหกิจ', 'สถานประกอบการ']);
  expect(root.querySelector('.shell-nav [aria-current=page]').getAttribute('href')).toBe('#/student/profile');
  expect(root.querySelector('.shell-security-note')).toBeNull();
  expect(root.querySelector('.student-page-header__art').getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.student-page-header__art').alt).toBe('');
  expect(root.querySelectorAll('h1')).toHaveLength(1);
  expect(root.querySelector('.student-portal__footer').textContent).toContain('ผู้ประสานงาน');
});

test('account disclosure supports Escape and skip link still focuses the persistent main', async () => {
  const { root } = await mount();
  const account = root.querySelector('.student-account');
  account.open = true;
  account.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(account.open).toBe(false);
  expect(document.activeElement).toBe(account.querySelector('summary'));
  root.querySelector('.shell-skip-link').click();
  expect(document.activeElement).toBe(root.querySelector('main'));
});

test.each([
  ['STAFF', '#/staff/review'], ['ADVISOR', '#/advisor/students'],
  ['ADMIN', '#/admin/operations']
])('%s retains its previous shell and role-scoped navigation', async (role, hash) => {
  const { root } = await mount({ role, hash });
  expect(root.querySelector('.student-portal')).toBeNull();
  expect(root.querySelector('.shell-sidebar')).not.toBeNull();
  expect(root.querySelector('.shell-nav [href="#/student/application"]')).toBeNull();
});

test('Coordinator has its own top navigation with no Student or company-directory menu',async()=>{
  const {root}=await mount({role:'COORDINATOR',hash:'#/coordinator/applications'});
  expect(root.querySelector('.coordinator-portal')).not.toBeNull();expect(root.querySelector('.shell-sidebar')).toBeNull();
  expect(root.querySelectorAll('.shell-nav__link')).toHaveLength(3);
  expect(root.querySelector('.shell-nav [href="company-directory.html"]')).toBeNull();
  expect(root.querySelector('.shell-nav [href="#/student/application"]')).toBeNull();
});

test('bare live list summaries render once, with one prominent draft action and historical read-only action',async()=>{
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles}),list:async()=>[draft,submitted]}});
  await flush();await flush();
  expect(root.querySelectorAll('h1')).toHaveLength(1);
  expect(root.querySelector('.student-feature-action').textContent).toBe('กรอกใบสมัครต่อ');
  expect(root.querySelectorAll('.student-application-table tbody tr')).toHaveLength(1);
  expect(root.querySelector('.student-application-table').textContent).not.toContain('รอบปัจจุบัน');
  expect(root.querySelector('.student-application-table').textContent).toContain('ดูใบสมัคร');
  expect(root.textContent).not.toMatch(/ขั้นที่ 1|100%|ข้อมูลผู้สมัคร · ขั้น/);
  expect(root.querySelectorAll('.student-feature-sections span')).toHaveLength(6);
});

test('additional drafts stay accessible and never get labelled read-only',async()=>{
  const second={...draft,id:'14100000-0000-4000-8000-000000000003',cycle_id:'cycle-c',updated_at:'2026-10-02T01:00:00Z'};
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles:[...cycles,{id:'cycle-c',name:'รอบพิเศษ',status:'OPEN'}]}),list:async()=>[draft,second,submitted]}});
  await flush();await flush();
  expect(root.querySelector('.student-application-history h2').textContent).toBe('ใบสมัครอื่น · 2 รายการ');
  const rows=[...root.querySelectorAll('tbody tr')];
  expect(rows[0].textContent).toContain('กรอกต่อ');expect(rows[0].textContent).not.toContain('เปิดดูฉบับที่ส่ง');
});

test('closed drafts stay viewable, never promise editing, and do not displace an open draft',async()=>{
  const closed={...draft,id:'14100000-0000-4000-8000-000000000004',cycle_id:'cycle-b',updated_at:'2026-11-03T01:00:00Z'};
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles}),list:async()=>[closed,draft]}});
  await flush();await flush();
  expect(root.querySelector('.student-feature-action').getAttribute('href')).toBe('#/student/application/'+draft.id);
  expect(root.querySelector('tbody').textContent).toContain('ดูฉบับร่าง');
  expect(root.querySelector('tbody').textContent).toContain('รอบปิด · อ่านอย่างเดียว');
});

test('cycle lookup failure does not hide existing applications; empty list has a clear starting action',async()=>{
  const {root}=await mount({hash:'#/student/application',applicationClient:{options:async()=>{throw new Error('lookup unavailable');},list:async()=>[draft]}});
  await flush();await flush();
  expect(root.querySelector('.student-feature-action')).not.toBeNull();
  expect(root.textContent).toContain('โหลดข้อมูลรอบสมัครไม่สำเร็จ');
  const empty=await mount({hash:'#/student/application',applicationClient:{options:async()=>({cycles}),list:async()=>[]}});
  await flush();await flush();
  expect(empty.root.querySelector('.student-cycle-picker summary').textContent).toBe('เลือกรอบสมัครใหม่');
  expect(empty.root.querySelector('.student-empty-state').textContent).toContain('ยังไม่มีใบสมัคร');
});

test('profile matches the approved sections without inventing faculty/English name or editing university email',async()=>{
  const {root}=await mountProfile();
  expect(root.querySelectorAll('h1')).toHaveLength(1);expect(root.querySelector('h1').textContent).toBe('ข้อมูลของฉัน');
  expect(root.querySelector('.student-identity').textContent).toContain('หลักสูตร 66');
  expect(root.querySelector('.student-profile-grid').textContent).toContain('contact@example.invalid');
  expect(root.textContent).toContain('ใบรับรองความประพฤติ');expect(root.textContent).not.toContain('คณะวิทยาศาสตร์');
  root.querySelector('.student-contact-edit').click();
  expect(document.activeElement.id).toBe('student-contact_email');
  expect(root.querySelector('#student-institutional_email')).toBeNull();
  expect(root.querySelector('#student-contact_address').value).toBe(profileData.contact_address);
});

test('contact edit saves all three editable fields with version/operation ID, not submitted application snapshots',async()=>{
  const {root,workflowClient,applicationClient}=await mountProfile();
  root.querySelector('.student-contact-edit').click();
  inputValue(root,'#student-contact_email','updated@example.invalid');
  findButton(root,'บันทึกข้อมูลติดต่อ').click();await flush();
  expect(workflowClient.request).toHaveBeenCalledWith('/api/v3/students/me',expect.objectContaining({method:'PATCH',body:{
    contact_email:'updated@example.invalid',contact_phone:profileData.contact_phone,contact_address:profileData.contact_address,version:1,operation_id:expect.any(String)}}));
  expect(root.textContent).toContain('บันทึกข้อมูลติดต่อแล้ว');expect(root.textContent).toContain('updated@example.invalid');
  expect(applicationClient.save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(root.querySelector('.student-contact-edit'));
});

test('failed saves retain typed data and retry the same operation; dirty navigation/cancel requires consent',async()=>{
  const request=jest.fn().mockRejectedValueOnce(new Error('เชื่อมต่อไม่สำเร็จ')).mockResolvedValue({...profileData,contact_email:'retry@example.invalid',version:2});
  const {root,location,events}=await mountProfile({workflowClient:{request}});
  root.querySelector('.student-contact-edit').click();inputValue(root,'#student-contact_email','retry@example.invalid');
  findButton(root,'ยกเลิก').click();expect(root.querySelector('#student-contact_email').value).toBe('retry@example.invalid');
  location.hash='#/student/application';events.dispatchEvent(new Event('hashchange'));
  expect(location.hash).toBe('#/student/profile');expect(root.querySelector('#student-contact_email')).not.toBeNull();
  findButton(root,'บันทึกข้อมูลติดต่อ').click();await flush();
  expect(root.querySelector('#student-contact_email').value).toBe('retry@example.invalid');
  findButton(root,'บันทึกข้อมูลติดต่อ').click();await flush();
  expect(request.mock.calls[0][1].body.operation_id).toBe(request.mock.calls[1][1].body.operation_id);
});

test('conflict offers explicit reload without losing typed values when reload also fails',async()=>{
  const getOwnProfile=jest.fn().mockResolvedValueOnce({...profileData}).mockRejectedValue(new Error('unavailable'));
  const {root}=await mountProfile({studentProfileClient:{getOwnProfile},workflowClient:{request:jest.fn().mockRejectedValue(Object.assign(new Error('ข้อมูลเปลี่ยนแล้ว'),{status:409}))}});
  root.querySelector('.student-contact-edit').click();inputValue(root,'#student-contact_address','เก็บข้อความนี้');
  findButton(root,'บันทึกข้อมูลติดต่อ').click();await flush();
  expect(findButton(root,'โหลดข้อมูลล่าสุด').hidden).toBe(false);
  window.confirm.mockReturnValue(true);findButton(root,'โหลดข้อมูลล่าสุด').click();await flush();
  expect(root.querySelector('#student-contact_address').value).toBe('เก็บข้อความนี้');
  expect(root.textContent).toContain('ข้อมูลที่กรอกยังอยู่');
});

test.each([401,403])('contact authorization failure %s clears protected form values',async status=>{
  const {root}=await mountProfile({workflowClient:{request:jest.fn().mockRejectedValue(Object.assign(new Error('denied'),{status}))}});
  root.querySelector('.student-contact-edit').click();inputValue(root,'#student-contact_email','private@example.invalid');
  findButton(root,'บันทึกข้อมูลติดต่อ').click();await flush();
  expect(root.textContent).not.toContain('private@example.invalid');expect(root.querySelector('#student-contact_email')).toBeNull();
});

test('Committee shares the Student theme while retaining Committee-only routes',async()=>{
 const {root}=await mount({role:'COMMITTEE',hash:'#/committee/applications'});
 expect(root.querySelector('.student-portal')).not.toBeNull();
 expect(root.querySelector('.shell-nav [href="#/student/application"]')).toBeNull();
 expect(root.querySelector('.shell-nav [href="#/committee/applications"]')).not.toBeNull();
});
