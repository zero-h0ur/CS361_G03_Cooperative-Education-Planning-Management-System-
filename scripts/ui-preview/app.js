import '../../src/frontend/authenticated-shell.css';
import './preview.css';
import { createShellApp } from '../../src/frontend/shell-app.js';
import {
  SCENARIOS,
  ADVISOR_SCENARIOS,
  getStoredTuApiResponse,
  saveTuApiResponseToStorage
} from './fixtures.js';
import { SELECTION_SCENARIOS } from './selection-fixtures.js';
import { APPLICATION_SCENARIOS } from './application-fixtures.js';
import { createWorkspacePreviewClients } from './workspace-fixtures.js';

const DEFAULT_TU_API_RESPONSE = Object.freeze({
  status: true,
  message: 'Success',
  type: 'student',
  username: '5701010101',
  tu_status: 'สำเร็จการศึกษา',
  statusid: '40',
  displayname_th: 'นักศึกษา ทดสอบ',
  displayname_en: 'nuksuksa todsob',
  email: 'email.std@dome.tu.ac.th',
  department: 'สาขาวิชาการบริหารเทคโนโลยี',
  faculty: 'วิทยาลัยนวัตกรรม'
});

// Ensure a TU API response is stored in browser storage so UI displays TU API response data instead of mock
if (!getStoredTuApiResponse()) {
  saveTuApiResponseToStorage(DEFAULT_TU_API_RESPONSE);
}

const params = new URLSearchParams(location.search);
const defaultRoutes = {
  STUDENT: '#/student/plan',
  STAFF: '#/coordinator/applications',
  ADVISOR: '#/advisor/students',
  ADMIN: '#/admin/operations',
  COORDINATOR: '#/coordinator/applications',
  COMMITTEE: '#/committee/applications'
};
const roleLabel = document.createElement('label');
roleLabel.textContent = 'พื้นที่จำลอง ';
const role = document.createElement('select');
role.setAttribute('aria-label', 'เลือกพื้นที่จำลอง');
role.add(new Option('นักศึกษา', 'STUDENT'));
role.add(new Option('ผู้ประสานงาน (รับเรื่อง)', 'COORDINATOR'));
role.add(new Option('กรรมการ (ความเห็นรายบุคคล)', 'COMMITTEE'));
role.add(new Option('อาจารย์ที่ปรึกษา (อ่านอย่างเดียว)', 'ADVISOR'));
role.add(new Option('ผู้ดูแลระบบ (Operations)', 'ADMIN'));
const rawRole = params.get('role');
const mappedRole = rawRole === 'STAFF' ? 'COORDINATOR' : rawRole;
role.value = Object.hasOwn(defaultRoutes, mappedRole) ? mappedRole : 'STUDENT';
const selectionRole = ['COORDINATOR', 'COMMITTEE'].includes(role.value);
const scenarios = selectionRole
  ? SELECTION_SCENARIOS
  : role.value === 'ADVISOR'
  ? ADVISOR_SCENARIOS
  : role.value === 'STUDENT'
  ? { ...SCENARIOS, ...APPLICATION_SCENARIOS }
  : SCENARIOS;
const defaultScenario = selectionRole
  ? 'pending'
  : role.value === 'ADVISOR'
  ? 'assigned'
  : 'draft';
const scenario = params.get('scenario') || defaultScenario;
roleLabel.append(role);
role.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('role', role.value);
  url.searchParams.set(
    'scenario',
    ['COORDINATOR', 'COMMITTEE'].includes(role.value)
      ? 'pending'
      : role.value === 'ADVISOR'
      ? 'assigned'
      : 'draft'
  );
  url.hash = defaultRoutes[role.value];
  location.assign(url);
});
const label = document.createElement('label');
label.textContent = 'สถานการณ์จำลอง ';
const select = document.createElement('select');
select.setAttribute('aria-label', 'เลือกสถานการณ์จำลอง');
for (const [value, text] of Object.entries(scenarios)) select.add(new Option(text, value));
select.value = Object.hasOwn(scenarios, scenario) ? scenario : defaultScenario;
select.addEventListener('change', () => {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ scenario: select.value, role: role.value }).toString();
  if (Object.hasOwn(APPLICATION_SCENARIOS, select.value)) url.hash = '#/student/application';
  location.assign(url);
});
label.append(select);

const currentTuResponse = getStoredTuApiResponse() || DEFAULT_TU_API_RESPONSE;
const notice = document.createElement('p');
notice.textContent = `TU API Response ที่เก็บไว้: ${currentTuResponse.displayname_th} (${currentTuResponse.username}) · ${currentTuResponse.department} · ${currentTuResponse.faculty}`;

const tuInspector = document.createElement('details');
tuInspector.style.cssText = 'display:inline-block;margin-left:8px;position:relative;';
const tuSummary = document.createElement('summary');
tuSummary.textContent = 'ดู/แก้ไข JSON Response จาก TU API';
tuSummary.style.cssText = 'cursor:pointer;font-weight:600;padding:4px 10px;border-radius:6px;background:#fff3cd;color:#7a4f01;border:1px solid #ffecb5;font-size:13px;';
const tuEditorBox = document.createElement('div');
tuEditorBox.style.cssText = 'position:absolute;right:0;top:34px;z-index:9999;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.15);color:#1f2328;';
const tuTextarea = document.createElement('textarea');
tuTextarea.rows = 12;
tuTextarea.style.cssText = 'width:100%;font-family:monospace;font-size:12px;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;';
tuTextarea.value = JSON.stringify(currentTuResponse, null, 2);
const saveTuBtn = document.createElement('button');
saveTuBtn.type = 'button';
saveTuBtn.textContent = 'บันทึก Response และอัปเดตหน้าเว็บ';
saveTuBtn.style.cssText = 'margin-top:8px;padding:6px 12px;background:#900;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;';
saveTuBtn.addEventListener('click', () => {
  try {
    const parsed = JSON.parse(tuTextarea.value);
    saveTuApiResponseToStorage(parsed);
    location.reload();
  } catch (err) {
    alert(`JSON ไม่ถูกต้อง: ${err.message}`);
  }
});
tuEditorBox.append(tuTextarea, saveTuBtn);
tuInspector.append(tuSummary, tuEditorBox);

const reset = document.createElement('button');
reset.type = 'button';
reset.textContent = 'รีเซ็ตค่าเริ่มต้น TU API Doc';
reset.addEventListener('click', () => {
  saveTuApiResponseToStorage(DEFAULT_TU_API_RESPONSE);
  location.reload();
});
document.getElementById('previewControls').append(notice, roleLabel, label, tuInspector, reset);

if (!location.hash || location.hash.startsWith('#/staff')) location.hash = defaultRoutes[role.value];
const clients = createWorkspacePreviewClients({ role: role.value, scenario: select.value });
createShellApp({
  ...clients,
  root: document.getElementById('authenticatedApp'),
  location,
  eventTarget: window,
  storage: null,
  startTuAuthLogin: async ({ studentId, password }) => {
    const res = await fetch('/api/v3/auth/tu-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        body?.error?.message ||
          body?.message ||
          'ไม่สามารถยืนยันตัวตนกับ TU API ได้ กรุณาตรวจสอบรหัสนักศึกษาและรหัสผ่าน'
      );
    }
    if (body?.data?.tuResponse) {
      saveTuApiResponseToStorage(body.data.tuResponse);
    }
    if (body?.data?.accessToken) {
      window.sessionStorage?.setItem('co-ed:access-token', body.data.accessToken);
      window.localStorage?.setItem('co-ed:access-token', body.data.accessToken);
    }
    const url = new URL(location.href);
    url.searchParams.set('scenario', 'draft');
    url.hash = '#/student/profile';
    location.assign(url);
  },
  // These buttons only reload this preview, never redirect to an identity provider.
  startLogin: async () => location.reload(),
  restartLogin: async () => location.reload(),
  logout: async () => {
    const url = new URL(location.href);
    url.searchParams.set('scenario', 'signin');
    location.assign(url);
  }
}).start();
