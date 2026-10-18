import './authenticated-shell.css';

const root = document.getElementById('authenticatedApp');

if (root) {
  root.replaceChildren();
  const main = document.createElement('main');
  main.className = 'shell-boot';
  main.setAttribute('aria-busy', 'false');

  const message = document.createElement('p');
  message.textContent = 'พื้นที่ผู้ใช้งานกำลังเชื่อมต่อกับระบบยืนยันตัวตน';
  main.append(message);
  root.append(main);
}
