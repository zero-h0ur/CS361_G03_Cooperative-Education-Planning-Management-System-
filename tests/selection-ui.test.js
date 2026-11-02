/** @jest-environment jsdom */
const {renderSelectionWorkspace,renderStudentSelectionStatus}=require('../tmp/frontend-test-modules/selection/selection-view.cjs');
const {canRoleAccessRoute,getDefaultRoute}=require('../tmp/frontend-test-modules/routes.cjs');
const flush=()=>new Promise(resolve=>setTimeout(resolve,15));
const plan='50000000-0000-4000-8000-000000000101';
const secondPlan='50000000-0000-4000-8000-000000000102';
const application=(more={})=>({plan_id:plan,plan_version:1,student_number:'TEST361001',full_name:'Synthetic Student',
  department:'CPE',program:'CS',cycle_name:'Synthetic cycle',state:'UNDER_COMMITTEE_REVIEW',opinion_count:0,own_opinion:null,...more});
const result=(rows=[])=>({cohorts:[{department:'CPE',program:'CS'}],applications:rows,page:1,pageSize:25,has_more:false});
beforeEach(()=>document.body.replaceChildren());
test.each(['COORDINATOR','COMMITTEE'])('%s cannot navigate into Staff, Advisor or Admin areas',role=>{
  expect(getDefaultRoute(role)).toMatch(role==='COORDINATOR'?/coordinator/:/committee/);
  for(const path of ['#/staff/review','#/staff/workflow','#/advisor/students','#/admin/operations','#/student/profile'])
    expect(canRoleAccessRoute(role,path)).toBe(false);
});
test('Coordinator acknowledges only a pending application, never gets an approval/grade form',async()=>{
  const request=jest.fn(async(_path,opts)=>opts?.method==='POST'?{}:result([application({state:'AWAITING_COORDINATOR'})]));
  const root=renderSelectionWorkspace({client:{request},role:'COORDINATOR'});document.body.append(root);await flush();
  expect(root.textContent).toContain('ยังไม่จัดอันดับ');expect(root.querySelector('textarea')).toBeNull();
  const button=[...root.querySelectorAll('button')].find(x=>x.textContent==='ยืนยันรับแผนและส่งต่อกรรมการ');
  button.click();await flush();
  expect(request.mock.calls.find(([,o])=>o.method==='POST')).toEqual([
    `/api/v3/coordinator/plans/${plan}/acknowledge`,expect.objectContaining({body:{operation_id:expect.any(String),expected_version:1}})]);
  expect(root.textContent).not.toContain('อนุมัติแผน');
});
test('Coordinator Master-Detail Split View switches students, previews documents, and submits Return for Revision with checklist and reason',async()=>{
  const rows=[
    application({
      plan_id:plan,student_number:'TEST361001',full_name:'Student One',state:'AWAITING_COORDINATOR',
      company_name:'Agoda',position_title:'Backend Co-op',gpax:3.45,core_gpa:3.30,
      document_references:[{key:'conduct',filename:'Conduct_StudentOne.pdf',reference:'DOC-101'}]
    }),
    application({
      plan_id:secondPlan,plan_version:2,student_number:'TEST361002',full_name:'Student Two',state:'NEEDS_REVISION',
      company_name:'KBTG',position_title:'Data Engineer Co-op',
      revision_notes:'ขาดลายเซ็นอาจารย์ที่ปรึกษาในเอกสารรับรองความประพฤติ'
    })
  ];
  const request=jest.fn(async(_path,opts)=>{
    if(opts?.method==='POST')throw new Error('Synthetic network retry test');
    return result(rows);
  });
  const root=renderSelectionWorkspace({client:{request},role:'COORDINATOR'});
  document.body.append(root);await flush();

  // Master-Detail split layout renders both queue items and selects the first student by default
  const queueItems=root.querySelectorAll('.coordinator-queue-item');
  expect(queueItems).toHaveLength(2);
  expect(root.querySelector('.coordinator-detail-heading').textContent).toContain('TEST361001 · Student One');
  expect(root.textContent).toContain('คพ.100');
  expect(root.textContent).toContain('เอกสารรับรองความประพฤติ');

  // Open and close Document Preview Modal
  const previewBtn=[...root.querySelectorAll('.coordinator-doc-btn')].find(b=>b.textContent==='ดูตัวอย่างไฟล์');
  previewBtn.click();
  expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  const closeModalBtn=[...root.querySelectorAll('button')].find(b=>b.textContent==='ปิดหน้าต่างตัวอย่าง');
  closeModalBtn.click();
  expect(root.querySelector('[role="dialog"]')).toBeNull();

  // Switch to second student in Master queue -> shows NEEDS_REVISION banner and notes
  queueItems[1].click();
  expect(root.querySelector('.coordinator-detail-heading').textContent).toContain('TEST361002 · Student Two');
  expect(root.textContent).toContain('ขาดลายเซ็นอาจารย์ที่ปรึกษาในเอกสารรับรองความประพฤติ');

  // Switch back to first student and open Return for Revision form
  root.querySelectorAll('.coordinator-queue-item')[0].click();
  expect(root.querySelector('textarea')).toBeNull();
  const toggleReturnBtn=[...root.querySelectorAll('button')].find(b=>b.textContent==='ส่งกลับเพื่อแก้ไข');
  toggleReturnBtn.click();
  const returnForm=root.querySelector('.coordinator-return-form');
  expect(returnForm).not.toBeNull();
  const checkbox=returnForm.querySelector('input[type="checkbox"]');
  checkbox.checked=true;
  const reasonTextarea=returnForm.querySelector('textarea');
  reasonTextarea.value='กรุณาให้อาจารย์ที่ปรึกษาเซ็นรับรองท้ายเอกสาร';
  returnForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await flush();

  const firstPost=request.mock.calls.find(([,o])=>o?.method==='POST');
  expect(firstPost[0]).toBe(`/api/v3/coordinator/plans/${plan}/return`);
  expect(firstPost[1].body).toEqual({
    operation_id:expect.any(String),
    expected_version:1,
    checklist:['เอกสารรับรองความประพฤติขาดลายเซ็นอาจารย์ที่ปรึกษา'],
    reason:'กรุณาให้อาจารย์ที่ปรึกษาเซ็นรับรองท้ายเอกสาร'
  });

  // Duplicate submit reuses the same operation_id for idempotency
  returnForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await flush();
  const allPosts=request.mock.calls.filter(([,o])=>o?.method==='POST');
  expect(allPosts).toHaveLength(2);
  expect(allPosts[1][1].body.operation_id).toBe(firstPost[1].body.operation_id);
});
test('Coordinator interactive summary cards filter status, reset button clears filter, and empty state hides bottom pagination buttons',async()=>{
  const rows=[
    application({plan_id:plan,student_number:'TEST361001',full_name:'Alice',state:'AWAITING_COORDINATOR',program:'CS'}),
    application({plan_id:secondPlan,student_number:'TEST361002',full_name:'Bob',state:'NEEDS_REVISION',program:'CS'})
  ];
  const request=jest.fn(async()=>result(rows));
  const root=renderSelectionWorkspace({client:{request},role:'COORDINATOR'});
  document.body.append(root);await flush();

  // Bottom pagination buttons are hidden when only 1 page of data is present
  const pager=root.querySelector('.selection-pagination');
  expect(pager.hidden).toBe(true);

  // Department filter is removed for Coordinator
  const selectLabels=[...root.querySelectorAll('.selection-filters label')].map(l=>l.textContent);
  expect(selectLabels.some(t=>t.includes('ภาควิชา'))).toBe(false);

  // Click on "ส่งกลับให้แก้ไข" summary card -> filters list to Bob only
  const statCards=root.querySelectorAll('.coordinator-stat-card');
  const revisionCard=[...statCards].find(c=>c.textContent.includes('ส่งกลับให้แก้ไข'));
  revisionCard.click();
  await flush();
  expect(root.querySelectorAll('.coordinator-queue-item')).toHaveLength(1);
  expect(root.querySelector('.coordinator-detail-heading').textContent).toContain('TEST361002 · Bob');

  // Search for non-existent student -> renders empty state card and hides pager
  const searchInput=root.querySelector('.coordinator-search-input');
  searchInput.value='NonExistent';
  searchInput.dispatchEvent(new Event('input',{bubbles:true}));
  await flush();
  expect(root.querySelector('.coordinator-empty-card')).not.toBeNull();
  expect(root.querySelector('.coordinator-queue-item')).toBeNull();
  expect(pager.hidden).toBe(true);

  // Click "ล้างตัวกรองทั้งหมด" in empty card -> resets and restores both students
  const clearBtn=root.querySelector('.coordinator-empty-card__reset');
  clearBtn.click();
  await flush();
  expect(root.querySelectorAll('.coordinator-queue-item')).toHaveLength(2);
  expect(root.querySelector('.coordinator-empty-card')).toBeNull();

  // Click reset filter button in toolbar
  const resetBtn=root.querySelector('.coordinator-reset-btn');
  expect(resetBtn).not.toBeNull();
  resetBtn.click();
  await flush();
  expect(root.querySelectorAll('.coordinator-queue-item')).toHaveLength(2);
});
test('Coordinator Automated Eligibility Check evaluates 7 criteria, supports Auto-fill return, and displays Curriculum 61 vs 66 distinct course groups',async()=>{
  const row66Fail=application({
    plan_id:plan,student_number:'6609610011',full_name:'Nattawadee 66',curriculum:'หลักสูตร 66',curriculum_year:'66',
    department:'วิทยาการคอมพิวเตอร์',program:'หลักสูตรปกติ',program_track:'คอมพิวเตอร์และวิทยาการสารสนเทศ (ภาคปกติ)',
    state:'AWAITING_COORDINATOR',gpax:3.42,core_gpa:3.35,
    core_courses:{'คพ.100':'A','คพ.101':'B+','คพ.102':'A','คพ.111':'B+','คพ.213 / 216':'B','คพ.251':'A','คพ.261':'B+'},
    prerequisite_courses:{mandatory:{code:'คพ.180',grade:'B+'},electives:{'คพ.262':'A','คพ.331':'-','คพ.240':'-'}},
    advance_course:{code:'คพ.301',status:'กำลังศึกษา'},
    document_references:[
      {key:'cv',filename:'CV.pdf',reference:'DOC-1'},
      {key:'transcript',filename:'TR.pdf',reference:'DOC-2'},
      {key:'photo',filename:'PH.jpg',reference:'DOC-3'},
      {key:'conduct',filename:'Conduct_Draft_Unsigned.pdf',reference:'DOC-4',summary:'ฉบับร่าง ขาดลายเซ็นอาจารย์ที่ปรึกษา'}
    ]
  });

  const row61Pass=application({
    plan_id:secondPlan,student_number:'6109610022',full_name:'Pawarisa 61',curriculum:'หลักสูตร 61',curriculum_year:'61',
    department:'วิทยาการคอมพิวเตอร์',program:'หลักสูตรพิเศษ',program_track:'คอมพิวเตอร์เครือข่ายและความปลอดภัยทางไซเบอร์ (ภาคพิเศษ)',
    state:'AWAITING_COORDINATOR',gpax:3.65,core_gpa:3.50,
    core_courses:{'คพ.101':'A','คพ.102':'A','คพ.111':'A','คพ.213 / 216':'B+','คพ.251':'A','คพ.264':'A'},
    prerequisite_courses:{mandatory:{code:'คพ.384',grade:'A'},electives:{'คพ.266':'B+','คพ.322':'-','คพ.348':'-'}},
    advance_course:{code:'คพ.302',status:'กำลังศึกษา'},
    document_references:[
      {key:'cv',filename:'CV.pdf',reference:'DOC-1'},
      {key:'transcript',filename:'TR.pdf',reference:'DOC-2'},
      {key:'photo',filename:'PH.jpg',reference:'DOC-3'},
      {key:'conduct',filename:'Conduct_Signed.pdf',reference:'DOC-4',summary:'อาจารย์ที่ปรึกษาลงนามรับรองแล้ว'}
    ]
  });

  const request=jest.fn(async()=>result([row66Fail,row61Pass]));
  const root=renderSelectionWorkspace({client:{request},role:'COORDINATOR'});
  document.body.append(root);await flush();

  // Pure CSS chevron wrappers present around all filter selects
  const selectWraps=root.querySelectorAll('.coordinator-select-wrap');
  expect(selectWraps.length).toBeGreaterThanOrEqual(3);

  // Student 1 (หลักสูตร 66): Course groups 1-3
  expect(root.textContent).toContain('2. ตรวจสอบผลการเรียนและรายวิชาตามหลักสูตร 66');
  expect(root.textContent).toContain('คพ.100');
  expect(root.textContent).toContain('คพ.180 (บังคับ)');
  expect(root.textContent).toContain('คพ.262 (วิชาเลือก · ขั้นต่ำ 1 ตัว)');
  expect(root.textContent).toContain('คพ.301');

  // Subsections 1.1 & 1.2 (Student vs Guardian) and Section 4 (Interests & Skills)
  expect(root.textContent).toContain('1.1 ข้อมูลนักศึกษาและการติดต่อ');
  expect(root.textContent).toContain('อีเมลมหาวิทยาลัย (Dome)');
  expect(root.textContent).toContain('1.2 ข้อมูลการติดต่อผู้ปกครอง (ผู้ติดต่อกรณีฉุกเฉิน)');
  expect(root.textContent).toContain('ชื่อ-นามสกุลผู้ปกครอง');
  expect(root.textContent).toContain('ความสัมพันธ์กับนักศึกษา');
  expect(root.textContent).toContain('เบอร์โทรศัพท์ที่ติดต่อได้ของผู้ปกครอง');
  expect(root.textContent).toContain('ที่อยู่ที่ติดต่อได้ของผู้ปกครอง');
  expect(root.textContent).toContain('4. ตำแหน่งงานที่สนใจ และทักษะของนักศึกษา');
  expect(root.textContent).toContain('ตำแหน่งงานที่สนใจ (เลือกได้หลายตำแหน่ง)');
  expect(root.querySelectorAll('.coordinator-doc-card__bottom')).toHaveLength(4);

  // Automated Eligibility Check 7 criteria section rendered
  const eligSection=root.querySelector('.coordinator-eligibility-section');
  expect(eligSection).not.toBeNull();
  expect(eligSection.textContent).toContain('5. สรุปผลการตรวจสอบคุณสมบัติอัตโนมัติ (Automated Eligibility Check 7 ข้อ)');
  expect(eligSection.textContent).toContain('ไม่ผ่าน 2 ข้อ');

  // Auto-fill shortcut button is present because Student 1 failed Rule 6 (conduct unsigned)
  const autofillBtn=root.querySelector('.coordinator-autofill-btn');
  expect(autofillBtn).not.toBeNull();
  expect(root.querySelector('textarea')).toBeNull(); // Still unmounted before clicking

  autofillBtn.click();
  const returnForm=root.querySelector('.coordinator-return-form');
  expect(returnForm).not.toBeNull();
  const reasonTextarea=returnForm.querySelector('textarea');
  expect(reasonTextarea.value).toContain('ไม่ผ่านเกณฑ์การตรวจสอบคุณสมบัติ');
  expect(reasonTextarea.value).toContain('ขาดลายเซ็นอาจารย์ที่ปรึกษา');

  // Corresponding checkbox auto-checked
  const conductCheckbox=[...returnForm.querySelectorAll('input[type="checkbox"]')].find(cb=>
    cb.value.includes('เอกสารรับรองความประพฤติขาดลายเซ็นอาจารย์ที่ปรึกษา')
  );
  expect(conductCheckbox.checked).toBe(true);

  // Switch to Student 2 (หลักสูตร 61)
  const queueItems=root.querySelectorAll('.coordinator-queue-item');
  queueItems[1].click();

  // Curriculum 61 courses rendered
  expect(root.textContent).toContain('2. ตรวจสอบผลการเรียนและรายวิชาตามหลักสูตร 61');
  expect(root.textContent).toContain('คพ.264');
  expect(root.textContent).toContain('คพ.384 (บังคับ)');
  expect(root.textContent).toContain('คพ.266 (วิชาเลือก · ขั้นต่ำ 1 ตัว)');
  expect(root.textContent).toContain('คพ.302');

  // Student 2 passes all 7 criteria
  expect(root.querySelector('.coordinator-eligibility-section').textContent).toContain('ผ่านเกณฑ์ครบทุกข้อ');
  expect(root.querySelector('.coordinator-autofill-btn')).toBeNull();

  // Filter by Curriculum 61 -> hides Student 1 (66), keeps Student 2 (61)
  const currSelect=[...root.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.text.includes('หลักสูตร 61')));
  currSelect.value='61';
  currSelect.dispatchEvent(new Event('change',{bubbles:true}));
  await flush();
  expect(root.querySelectorAll('.coordinator-queue-item')).toHaveLength(1);
  expect(root.querySelector('.coordinator-detail-heading').textContent).toContain('6109610022 · Pawarisa 61');
});
test('Committee records only its own explicit choice and comment; duplicate requests reuse operation id',async()=>{
  const request=jest.fn(async(_path,opts)=>{
    if(opts?.method==='POST')throw new Error('Synthetic unavailable');return result([application()]);
  });
  const root=renderSelectionWorkspace({client:{request},role:'COMMITTEE'});document.body.append(root);await flush();
  let form=[...root.querySelectorAll('form')].find(x=>x.querySelector('textarea'));
  form.querySelector('select').value='no';form.querySelector('textarea').value='Synthetic independent opinion';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  const first=request.mock.calls.find(([,o])=>o.method==='POST');
  expect(first[0]).toBe(`/api/v3/committee/plans/${plan}/opinion`);
  expect(first[1].body).toEqual({operation_id:expect.any(String),expected_version:1,selected:false,comment:'Synthetic independent opinion'});
  expect(Object.keys(first[1].body)).not.toContain('committee_id');
  expect(root.querySelector('textarea').value).toBe('Synthetic independent opinion');
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  const posts=request.mock.calls.filter(([,o])=>o.method==='POST');
  expect(posts).toHaveLength(2);expect(posts[1][1].body.operation_id).toBe(first[1].body.operation_id);
});
test('completed own opinion and names are text, not HTML; no editable form overwrites history',async()=>{
  const xss='<img src=x onerror=alert(1)>';
  const root=renderSelectionWorkspace({role:'COMMITTEE',client:{request:async()=>result([application({
    full_name:xss,state:'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT',opinion_count:3,
    own_opinion:{selected:true,comment:xss,submitted_at:'2026-10-31T00:00:00Z'}})])}});
  document.body.append(root);await flush();
  expect(root.textContent).toContain(xss);expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('textarea')).toBeNull();expect(root.textContent).toContain('รอประกาศผล');
});
test('scope revocation removes old details and informs the shell',async()=>{
  const denied=jest.fn();let calls=0;
  const root=renderSelectionWorkspace({role:'COMMITTEE',onAccessDenied:denied,client:{request:async()=>{
    if(++calls>1)throw Object.assign(new Error('Denied'),{status:403});return result([application()]);
  }}});document.body.append(root);await flush();
  root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flush();
  expect(root.textContent).not.toContain('TEST361001');expect(denied).toHaveBeenCalled();
});
test('Student sees only progress or revision instructions, never Committee choices or individual comments',async()=>{
  const root=renderStudentSelectionStatus({client:{request:async()=>result([
    application({opinion_count:3,state:'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT'}),
    application({plan_id:secondPlan,cycle_name:'Cycle Revision',opinion_count:0,state:'NEEDS_REVISION',revision_notes:'กรุณาแนบเอกสารรับรองความประพฤติที่มีลายเซ็นอาจารย์ที่ปรึกษา'})
  ])}});
  document.body.append(root);await flush();
  expect(root.textContent).toContain('3 / 3');expect(root.textContent).toContain('รอประกาศผล');
  expect(root.textContent).toContain('กรุณาแก้ไขข้อมูลใบสมัคร');
  expect(root.textContent).toContain('กรุณาแนบเอกสารรับรองความประพฤติที่มีลายเซ็นอาจารย์ที่ปรึกษา');
  expect(root.querySelector('a[href="#/student/plan"]')).not.toBeNull();
  expect(root.querySelector('form,input,select,textarea')).toBeNull();
});


const cycleId = '10000000-0000-4000-8000-000000000001';

test('Coordinator Schedule & Deadline Management displays both windows, updates dates, announces results, and sweeps expired', async () => {
  const scheduleData = {
    cycle_id: cycleId,
    cycle_name: 'รอบ 1/2569 (สหกิจศึกษา)',
    version: 1,
    near_deadline_hours: 48,
    application_window: {
      state: 'OPEN',
      is_open: true,
      is_near_deadline: false,
      is_closed: false,
      remaining_ms: 5 * 86400000,
      opens_at: '2026-11-01T01:30:00.000Z',
      closes_at: '2026-11-15T09:30:00.000Z'
    },
    confirmation_window: {
      state: 'UPCOMING',
      is_open: false,
      is_near_deadline: false,
      is_closed: false,
      remaining_ms: 10 * 86400000,
      opens_at: '2026-11-20T01:30:00.000Z',
      closes_at: '2026-11-27T09:30:00.000Z'
    },
    announced_at: null
  };

  const confirmationsData = {
    summary: { total: 2, confirmed: 1, pending_confirmation: 1, waived: 0, auto_waived: 0 },
    results: [
      { student_number: '6609610011', full_name: 'Student One', company_name: 'Agoda', confirmation_status: 'CONFIRMED' },
      { student_number: '6609610022', full_name: 'Student Two', company_name: 'Line Man Wongnai', confirmation_status: 'PENDING_CONFIRMATION' }
    ]
  };

  const request = jest.fn(async (path, opts) => {
    if (path.includes('/applications')) {
      return {
        cohorts: [{ cycle_id: cycleId, department: 'CPE', program: 'CS' }],
        applications: [application({ cycle_id: cycleId, state: 'AWAITING_COORDINATOR' })],
        page: 1, pageSize: 25, has_more: false
      };
    }
    if (path === `/api/v4/cycles/${cycleId}/schedule`) {
      if (opts?.method === 'PUT') {
        scheduleData.version = 2;
        return { ...scheduleData, version: 2 };
      }
      return scheduleData;
    }
    if (path === `/api/v4/cycles/${cycleId}/announce`) {
      scheduleData.announced_at = new Date().toISOString();
      return { ...scheduleData, announced_at: scheduleData.announced_at };
    }
    if (path === `/api/v4/coordinator/cycles/${cycleId}/confirmations/sweep`) {
      return { cycle_id: cycleId, expired_count: 1, message: 'ประมวลผลสำเร็จ' };
    }
    if (path === `/api/v4/coordinator/cycles/${cycleId}/confirmations`) {
      return confirmationsData;
    }
    return {};
  });

  const root = renderSelectionWorkspace({ client: { request }, role: 'COORDINATOR' });
  document.body.append(root);
  await flush();

  // Schedule card rendered with both windows
  expect(root.textContent).toContain('กำหนดการรับสมัครและกำหนดยืนยันสิทธิ์');
  expect(root.textContent).toContain('1. ช่วงเวลารับสมัคร (Application Window)');
  expect(root.textContent).toContain('2. ช่วงเวลายืนยันสิทธิ์ (Confirmation Window)');
  expect(root.textContent).toContain('เปิดรับสมัคร');
  expect(root.textContent).toContain('ยังไม่ถึงกำหนดยืนยันสิทธิ์');

  // Edit Schedule
  const editBtn = root.querySelector('.coordinator-schedule-edit-btn');
  expect(editBtn).not.toBeNull();
  editBtn.click();
  await flush();

  const scheduleForm = root.querySelector('.coordinator-schedule-form');
  expect(scheduleForm).not.toBeNull();
  const opensInput = scheduleForm.querySelector('.coordinator-input-opens');
  expect(opensInput.value).toBe('2026-11-01T01:30:00.000Z');
  scheduleForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();

  expect(request).toHaveBeenCalledWith(
    `/api/v4/cycles/${cycleId}/schedule`,
    expect.objectContaining({ method: 'PUT' })
  );

  // Announce Results
  const announceBtn = root.querySelector('.coordinator-announce-btn');
  announceBtn.click();
  await flush();

  const announceForm = root.querySelector('.coordinator-announce-form');
  expect(announceForm).not.toBeNull();
  announceForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();

  expect(request).toHaveBeenCalledWith(
    `/api/v4/cycles/${cycleId}/announce`,
    expect.objectContaining({ method: 'POST' })
  );

  // Sweep Expired Confirmations
  const sweepBtn = root.querySelector('.coordinator-sweep-btn');
  sweepBtn.click();
  await flush();

  expect(request).toHaveBeenCalledWith(
    `/api/v4/coordinator/cycles/${cycleId}/confirmations/sweep`,
    expect.objectContaining({ method: 'POST' })
  );
  expect(root.textContent).toContain('ประมวลผลสละสิทธิ์อัตโนมัติเรียบร้อยแล้ว');

  // Confirmation Tracking
  const toggleConfirmBtn = root.querySelector('.coordinator-confirmations-toggle-btn');
  toggleConfirmBtn.click();
  await flush();

  expect(root.textContent).toContain('รายการติดตามสถานะการยืนยันสิทธิ์');
  expect(root.textContent).toContain('ยืนยันสิทธิ์แล้ว: 1 คน');
  expect(root.textContent).toContain('รอยืนยันสิทธิ์: 1 คน');
  expect(root.textContent).toContain('6609610011 · Student One');

  // Verify Table & Filter Controls
  const confTable = root.querySelector('.coordinator-confirmations-table');
  expect(confTable).not.toBeNull();
  const filterBtns = root.querySelectorAll('.coordinator-filter-btn');
  expect(filterBtns.length).toBe(5);

  // Filter: ยืนยันสิทธิ์แล้ว
  filterBtns[1].click();
  expect(root.textContent).toContain('6609610011 · Student One');
  expect(root.textContent).not.toContain('6609610022 · Student Two');

  // Filter: รอยืนยันสิทธิ์
  filterBtns[2].click();
  expect(root.textContent).not.toContain('6609610011 · Student One');
  expect(root.textContent).toContain('6609610022 · Student Two');

  // Filter: ทั้งหมด
  filterBtns[0].click();
  expect(root.textContent).toContain('6609610011 · Student One');
  expect(root.textContent).toContain('6609610022 · Student Two');
});

test('Student views announcement, confirms participation within deadline, and receives MS Teams join link', async () => {
  const decisionData = {
    has_result: true,
    cycle_id: cycleId,
    student_id: 'STUDENT-001',
    outcome: 'SELECTED',
    confirmation_status: 'PENDING_CONFIRMATION',
    version: 1,
    confirmation_window: {
      state: 'OPEN',
      is_open: true,
      is_near_deadline: false,
      is_closed: false,
      remaining_ms: 3 * 86400000,
      opens_at: '2026-11-20T01:30:00.000Z',
      closes_at: '2026-11-27T09:30:00.000Z'
    },
    teams_join_url: 'https://teams.microsoft.com/l/team/tu-cs-coop-69'
  };

  const request = jest.fn(async (path, opts) => {
    if (path === '/api/v3/student/selection') {
      return {
        applications: [{ plan_id: plan, cycle_id: cycleId, cycle_name: 'รอบ 1/69', state: 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT', opinion_count: 3 }]
      };
    }
    if (path === `/api/v4/cycles/${cycleId}/selection-decision`) {
      return decisionData;
    }
    if (path === `/api/v4/cycles/${cycleId}/confirm`) {
      decisionData.confirmation_status = 'CONFIRMED';
      return { success: true };
    }
    return {};
  });

  const root = renderStudentSelectionStatus({ client: { request } });
  document.body.append(root);
  await flush();

  expect(root.textContent).toContain('ผลการคัดเลือก: ผ่านการคัดเลือก (ได้รับคัดเลือก)');
  expect(root.textContent).toContain('กำหนดยืนยันสิทธิ์:');
  const confirmBtn = root.querySelector('.student-confirm-btn');
  const waiveBtn = root.querySelector('.student-waive-btn');
  expect(confirmBtn).not.toBeNull();
  expect(waiveBtn).not.toBeNull();

  // Click Confirm
  confirmBtn.click();
  await flush();

  expect(request).toHaveBeenCalledWith(
    `/api/v4/cycles/${cycleId}/confirm`,
    expect.objectContaining({ method: 'POST' })
  );
  expect(root.textContent).toContain('ยืนยันสิทธิ์แล้ว');
  expect(root.querySelector('.student-teams-link')).not.toBeNull();
  expect(root.querySelector('.student-teams-link').href).toContain('teams.microsoft.com');
});

test('Student sees near-deadline warning banner when <= 48h remaining', async () => {
  const request = jest.fn(async (path) => {
    if (path === '/api/v3/student/selection') {
      return {
        applications: [{ plan_id: plan, cycle_id: cycleId, cycle_name: 'รอบ 1/69', state: 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT', opinion_count: 3 }]
      };
    }
    if (path === `/api/v4/cycles/${cycleId}/selection-decision`) {
      return {
        has_result: true,
        cycle_id: cycleId,
        outcome: 'SELECTED',
        confirmation_status: 'PENDING_CONFIRMATION',
        version: 1,
        confirmation_window: {
          state: 'NEAR_DEADLINE',
          is_open: true,
          is_near_deadline: true,
          is_closed: false,
          remaining_ms: 24 * 3600000,
          opens_at: '2026-11-20T01:30:00.000Z',
          closes_at: '2026-11-21T01:30:00.000Z'
        }
      };
    }
    return {};
  });

  const root = renderStudentSelectionStatus({ client: { request } });
  document.body.append(root);
  await flush();

  expect(root.textContent).toContain('ใกล้ครบกำหนดยืนยันสิทธิ์');
  expect(root.textContent).toContain('1 วัน 0 ชั่วโมง');
});

test('Student is notified of automatic waiver when confirmation deadline is expired', async () => {
  const request = jest.fn(async (path) => {
    if (path === '/api/v3/student/selection') {
      return {
        applications: [{ plan_id: plan, cycle_id: cycleId, cycle_name: 'รอบ 1/69', state: 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT', opinion_count: 3 }]
      };
    }
    if (path === `/api/v4/cycles/${cycleId}/selection-decision`) {
      return {
        has_result: true,
        cycle_id: cycleId,
        outcome: 'SELECTED',
        confirmation_status: 'AUTO_WAIVED',
        version: 2,
        confirmation_window: {
          state: 'CLOSED',
          is_open: false,
          is_near_deadline: false,
          is_closed: true,
          remaining_ms: 0,
          opens_at: '2026-11-10T01:30:00.000Z',
          closes_at: '2026-11-17T09:30:00.000Z'
        }
      };
    }
    return {};
  });

  const root = renderStudentSelectionStatus({ client: { request } });
  document.body.append(root);
  await flush();

  expect(root.textContent).toContain('คุณไม่ได้ยืนยันสิทธิ์ในระยะเวลาที่กำหนด (ระบบสละสิทธิโดยอัตโนมัติ)');
  expect(root.querySelector('.student-confirm-btn')).toBeNull();
  expect(root.querySelector('.student-waive-btn')).toBeNull();
});

test('Concurrent/late confirmation rejected with 422 displays auto-waived notice', async () => {
  const request = jest.fn(async (path, opts) => {
    if (path === '/api/v3/student/selection') {
      return {
        applications: [{ plan_id: plan, cycle_id: cycleId, cycle_name: 'รอบ 1/69', state: 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT', opinion_count: 3 }]
      };
    }
    if (path === `/api/v4/cycles/${cycleId}/selection-decision`) {
      return {
        has_result: true,
        cycle_id: cycleId,
        outcome: 'SELECTED',
        confirmation_status: 'PENDING_CONFIRMATION',
        version: 1,
        confirmation_window: {
          state: 'OPEN',
          is_open: true,
          is_near_deadline: false,
          is_closed: false,
          remaining_ms: 1000,
          opens_at: '2026-11-20T01:30:00.000Z',
          closes_at: '2026-11-27T09:30:00.000Z'
        }
      };
    }
    if (path === `/api/v4/cycles/${cycleId}/confirm`) {
      const err = new Error('หมดเวลายืนยันสิทธิ์แล้ว ระบบได้ทำการสละสิทธิ์โดยอัตโนมัติ');
      err.status = 422;
      throw err;
    }
    return {};
  });

  const root = renderStudentSelectionStatus({ client: { request } });
  document.body.append(root);
  await flush();

  const confirmBtn = root.querySelector('.student-confirm-btn');
  expect(confirmBtn).not.toBeNull();
  confirmBtn.click();
  await flush();

  expect(root.textContent).toContain('คุณไม่ได้ยืนยันสิทธิ์ในระยะเวลาที่กำหนด (ระบบสละสิทธิโดยอัตโนมัติ)');
  expect(root.querySelector('.student-confirm-btn')).toBeNull();
});
