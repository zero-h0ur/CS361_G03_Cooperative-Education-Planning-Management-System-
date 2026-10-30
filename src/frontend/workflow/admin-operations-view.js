function node(tag, text) {
  const value = document.createElement(tag);
  if (text) value.textContent = text;
  return value;
}

export function renderAdminOperations({ client, signal, onSessionExpired, onAccessDenied } = {}) {
  const root = node('section');
  root.className = 'workflow-card';
  root.setAttribute('aria-busy', 'true');
  root.append(node('p', 'กำลังตรวจข้อมูลระบบ'));

  async function load(page = 1) {
    root.setAttribute('aria-busy', 'true');
    try {
      const data = await client.request(`/api/v3/admin/operations?page=${page}`, { signal });
      if (signal?.aborted) return;
      root.replaceChildren(
        node('h2', 'Operations'),
        node('p', `ข้อมูลสถานประกอบการ ${data.catalogue.companies} บริษัท / ${data.catalogue.positions} ตำแหน่ง`)
      );
      root.append(node('p', 'บัญชีนี้ไม่มีสิทธิ์อนุมัติ ปฏิเสธแผน หรือมอบหมายอาจารย์แทน Staff'));
      root.append(node('p', 'เปลี่ยน role/สถานะบัญชีผ่าน scripts/operations/admin-account.py โดยใช้ Admin session และบัญชี operator ฐานข้อมูล ไม่ใช้รหัสฐานข้อมูลใน Browser'));

      const table = node('table');
      table.className = 'workflow-table';
      const head = node('tr');
      for (const title of ['User ID', 'Role', 'สถานะ', 'Version']) head.append(node('th', title));
      table.append(head);
      for (const account of data.accounts) {
        const row = node('tr');
        for (const value of [account.id, account.role, account.account_status, String(account.version)]) {
          row.append(node('td', value));
        }
        table.append(row);
      }
      const scroll = node('div');
      scroll.style.overflowX = 'auto';
      scroll.append(table);
      root.append(scroll);

      const controls = node('div');
      for (const [label, next] of [['ก่อนหน้า', page - 1], ['ถัดไป', page + 1]]) {
        const button = node('button', label);
        button.type = 'button';
        button.className = 'shell-button shell-button--secondary';
        button.disabled = next < 1 || next > data.pagination.totalPages;
        button.addEventListener('click', () => load(next));
        controls.append(button);
      }
      root.append(controls, node('p', `หน้า ${page} · ทั้งหมด ${data.pagination.total} บัญชี`));
      const details = node('details');
      details.append(node('summary', 'Migration ที่ติดตั้งแล้ว'));
      for (const migration of data.migrations) details.append(node('p', migration));
      root.append(details);
    } catch (error) {
      if (signal?.aborted) return;
      root.replaceChildren(node('p', 'ยังอ่านข้อมูลระบบไม่ได้ กรุณาลองใหม่'));
      if (error.status === 401) onSessionExpired?.();
      if (error.status === 403) onAccessDenied?.('ไม่มีสิทธิ์จัดการระบบ');
      const retry = node('button', 'ลองใหม่');
      retry.type = 'button';
      retry.addEventListener('click', () => load(page));
      root.append(retry);
    } finally {
      if (!signal?.aborted) root.setAttribute('aria-busy', 'false');
    }
  }

  load();
  return root;
}
