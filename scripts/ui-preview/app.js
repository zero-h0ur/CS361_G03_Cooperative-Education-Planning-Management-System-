import '../../src/frontend/authenticated-shell.css';
import './preview.css';
import { createShellApp } from '../../src/frontend/shell-app.js';
import { createPreviewClients, SCENARIOS, ADVISOR_SCENARIOS } from './fixtures.js';
import { enhanceWorkflowPreview } from './workflow-fixtures.js';

const params = new URLSearchParams(location.search);
const defaultRoutes = { STUDENT: '#/student/plan', STAFF: '#/staff/students', ADVISOR: '#/advisor/students' };
const roleLabel = document.createElement('label'); roleLabel.textContent = 'พื้นที่จำลอง ';
const role = document.createElement('select'); role.setAttribute('aria-label', 'เลือกพื้นที่จำลอง');
role.add(new Option('นักศึกษา', 'STUDENT')); role.add(new Option('เจ้าหน้าที่ (จำลอง Workflow)', 'STAFF'));
role.add(new Option('อาจารย์ที่ปรึกษา (อ่านอย่างเดียว)', 'ADVISOR'));
role.value = Object.hasOwn(defaultRoutes, params.get('role')) ? params.get('role') : 'STUDENT';
const scenarios = role.value === 'ADVISOR' ? ADVISOR_SCENARIOS : SCENARIOS;
const defaultScenario = role.value === 'ADVISOR' ? 'assigned' : 'draft';
const scenario = params.get('scenario') || defaultScenario;
roleLabel.append(role);
role.addEventListener('change', () => {
  const url = new URL(location.href); url.searchParams.set('role', role.value);
  url.searchParams.set('scenario', role.value === 'ADVISOR' ? 'assigned' : 'draft');
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
  location.assign(url);
});
label.append(select);
const notice = document.createElement('p');
notice.textContent = 'Local UI Preview — ข้อมูลจำลอง ไม่เชื่อม AWS / ไม่ใช่ผลทดสอบสิทธิ์จริง';
const reset = document.createElement('button');
reset.type = 'button'; reset.textContent = 'รีเซ็ตข้อมูลจำลอง';
reset.addEventListener('click', () => location.reload());
document.getElementById('previewControls').append(notice, roleLabel, label, reset);

if (!location.hash) location.hash = defaultRoutes[role.value];
const clients = enhanceWorkflowPreview(createPreviewClients({ scenario: select.value, role: role.value }),{scenario:select.value,role:role.value});
createShellApp({
  ...clients, root: document.getElementById('authenticatedApp'),
  location, eventTarget: window, storage: null,
  // These buttons only reload this preview, never redirect to an identity provider.
  startLogin: async () => location.reload(), restartLogin: async () => location.reload(),
  logout: async () => location.reload()
}).start();
