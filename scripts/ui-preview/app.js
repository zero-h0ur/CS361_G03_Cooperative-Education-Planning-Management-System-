import '../../src/frontend/authenticated-shell.css';
import './preview.css';
import { createShellApp } from '../../src/frontend/shell-app.js';
import { createPreviewClients, SCENARIOS } from './fixtures.js';

const scenario = new URLSearchParams(location.search).get('scenario') || 'draft';
const label = document.createElement('label');
label.textContent = 'สถานการณ์จำลอง ';
const select = document.createElement('select');
select.setAttribute('aria-label', 'เลือกสถานการณ์จำลอง');
for (const [value, text] of Object.entries(SCENARIOS)) select.add(new Option(text, value));
select.value = Object.hasOwn(SCENARIOS, scenario) ? scenario : 'draft';
select.addEventListener('change', () => {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ scenario: select.value }).toString();
  location.assign(url);
});
label.append(select);
const notice = document.createElement('p');
notice.textContent = 'Local UI Preview — ข้อมูลจำลอง ไม่เชื่อม AWS / ไม่ใช่ผลทดสอบสิทธิ์จริง';
const reset = document.createElement('button');
reset.type = 'button'; reset.textContent = 'รีเซ็ตข้อมูลจำลอง';
reset.addEventListener('click', () => location.reload());
document.getElementById('previewControls').append(notice, label, reset);

if (!location.hash) location.hash = '#/student/plan';
const clients = createPreviewClients({ scenario: select.value });
createShellApp({
  ...clients, root: document.getElementById('authenticatedApp'),
  location, eventTarget: window, storage: null,
  // These buttons only reload this preview, never redirect to an identity provider.
  startLogin: async () => location.reload(), restartLogin: async () => location.reload(),
  logout: async () => location.reload()
}).start();
