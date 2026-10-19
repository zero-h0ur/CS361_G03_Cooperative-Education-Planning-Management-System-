import '../../src/frontend/authenticated-shell.css';
import './preview.css';
import { createShellApp } from '../../src/frontend/shell-app.js';
import { createPreviewClients, SCENARIOS } from './fixtures.js';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'draft';
const roleLabel = document.createElement('label'); roleLabel.textContent = 'พื้นที่จำลอง ';
const role = document.createElement('select'); role.setAttribute('aria-label', 'เลือกพื้นที่จำลอง');
role.add(new Option('นักศึกษา', 'STUDENT')); role.add(new Option('เจ้าหน้าที่ (รายการอ่านอย่างเดียว)', 'STAFF'));
role.value = params.get('role') === 'STAFF' ? 'STAFF' : 'STUDENT';
roleLabel.append(role);
role.addEventListener('change', () => {
  const url = new URL(location.href); url.searchParams.set('role', role.value);
  url.hash = role.value === 'STAFF' ? '#/staff/students' : '#/student/plan'; location.assign(url);
});
const label = document.createElement('label');
label.textContent = 'สถานการณ์จำลอง ';
const select = document.createElement('select');
select.setAttribute('aria-label', 'เลือกสถานการณ์จำลอง');
for (const [value, text] of Object.entries(SCENARIOS)) select.add(new Option(text, value));
select.value = Object.hasOwn(SCENARIOS, scenario) ? scenario : 'draft';
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

if (!location.hash) location.hash = role.value === 'STAFF' ? '#/staff/students' : '#/student/plan';
const clients = createPreviewClients({ scenario: select.value, role: role.value });
createShellApp({
  ...clients, root: document.getElementById('authenticatedApp'),
  location, eventTarget: window, storage: null,
  // These buttons only reload this preview, never redirect to an identity provider.
  startLogin: async () => location.reload(), restartLogin: async () => location.reload(),
  logout: async () => location.reload()
}).start();
