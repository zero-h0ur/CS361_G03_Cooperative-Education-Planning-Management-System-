import '../../src/frontend/authenticated-shell.css';
import './preview.css';
import { createShellApp } from '../../src/frontend/shell-app.js';
import { SCENARIOS, ADVISOR_SCENARIOS } from './fixtures.js';
import { SELECTION_SCENARIOS } from './selection-fixtures.js';
import {APPLICATION_SCENARIOS} from './application-fixtures.js';
import {createWorkspacePreviewClients} from './workspace-fixtures.js';

const params = new URLSearchParams(location.search);
const defaultRoutes = { STUDENT: '#/student/plan', STAFF: '#/coordinator/applications', ADVISOR: '#/advisor/students', ADMIN:'#/admin/operations',
  COORDINATOR:'#/coordinator/applications',COMMITTEE:'#/committee/applications' };
const roleLabel = document.createElement('label'); roleLabel.textContent = 'พื้นที่จำลอง ';
const role = document.createElement('select'); role.setAttribute('aria-label', 'เลือกพื้นที่จำลอง');
role.add(new Option('นักศึกษา', 'STUDENT'));
role.add(new Option('ผู้ประสานงาน (รับเรื่อง)', 'COORDINATOR'));
role.add(new Option('กรรมการ (ความเห็นรายบุคคล)', 'COMMITTEE'));
role.add(new Option('อาจารย์ที่ปรึกษา (อ่านอย่างเดียว)', 'ADVISOR'));
role.add(new Option('ผู้ดูแลระบบ (Operations)', 'ADMIN'));
const rawRole = params.get('role');
const mappedRole = rawRole === 'STAFF' ? 'COORDINATOR' : rawRole;
role.value = Object.hasOwn(defaultRoutes, mappedRole) ? mappedRole : 'STUDENT';
const selectionRole=['COORDINATOR','COMMITTEE'].includes(role.value);
const scenarios = selectionRole?SELECTION_SCENARIOS:role.value === 'ADVISOR' ? ADVISOR_SCENARIOS : role.value==='STUDENT'?{...SCENARIOS,...APPLICATION_SCENARIOS}:SCENARIOS;
const defaultScenario = selectionRole?'pending':role.value === 'ADVISOR' ? 'assigned' : 'draft';
const scenario = params.get('scenario') || defaultScenario;
roleLabel.append(role);
role.addEventListener('change', () => {
  const url = new URL(location.href); url.searchParams.set('role', role.value);
  url.searchParams.set('scenario', ['COORDINATOR','COMMITTEE'].includes(role.value)?'pending':role.value === 'ADVISOR' ? 'assigned' : 'draft');
  url.hash = defaultRoutes[role.value]; location.assign(url);
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
  if(Object.hasOwn(APPLICATION_SCENARIOS,select.value))url.hash='#/student/application';
  location.assign(url);
});
label.append(select);
const notice = document.createElement('p');
notice.textContent = 'Local UI Preview — ข้อมูลจำลอง ไม่เชื่อม AWS / ไม่ใช่ผลทดสอบสิทธิ์จริง';
const reset = document.createElement('button');
reset.type = 'button'; reset.textContent = 'รีเซ็ตข้อมูลจำลอง';
reset.addEventListener('click', () => location.reload());
document.getElementById('previewControls').append(notice, roleLabel, label, reset);

if (!location.hash || location.hash.startsWith('#/staff')) location.hash = defaultRoutes[role.value];
const clients = createWorkspacePreviewClients({role:role.value,scenario:select.value});
createShellApp({
  ...clients, root: document.getElementById('authenticatedApp'),
  location, eventTarget: window, storage: null,
  startTuAuthLogin: async ({ studentId }) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const url = new URL(location.href);
    url.searchParams.set('scenario', 'draft');
    url.hash = '#/student/plan';
    location.assign(url);
  },
  // These buttons only reload this preview, never redirect to an identity provider.
  startLogin: async () => location.reload(), restartLogin: async () => location.reload(),
  logout: async () => {
    const url = new URL(location.href);
    url.searchParams.set('scenario', 'signin');
    location.assign(url);
  }
}).start();
