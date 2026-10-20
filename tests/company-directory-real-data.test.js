/** @jest-environment node */
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { createDirectoryClient } = require('../tmp/frontend-test-modules/directory-client.cjs');
const script = fs.readFileSync(require.resolve('../company-directory.js'), 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';
const row = { id: ID, code: 'C01', name: 'Synthetic Partner', location: 'นนทบุรี', details_available: false };
const response = (items = [row], options = {}) => ({ data: items,
  pagination: { page: 1, total: items.length, totalPages: 1, details_available: false,
    filters: { locations: ['นนทบุรี'], durations: ['6 months'] }, ...options } });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let dom, w, api;
beforeEach(() => {
  dom = new JSDOM('<input id="companySearch"><div id="searchResultStatus"></div>' +
    '<select id="locationFilter"></select><select id="durationFilter"></select><select id="roleFilter"></select>' +
    '<button id="recruitingToggle"></button><button id="filterResetBtn"></button>' +
    '<section id="companyList"><article>OLD_STATIC_DATA</article></section><button id="loadMoreCompanies"></button>' +
    '<div id="companyModal"><button onclick="closeModal()">Close</button><div id="modalLogo"></div>' +
    '<h3 id="modalName"></h3><p id="modalLocation"></p><div id="modalDescription"></div><div id="modalReq"></div></div>',
    { url: 'https://main.example.invalid/company-directory.html', runScripts: 'outside-only' });
  w = dom.window;
  api = { list: jest.fn(async () => response()), detail: jest.fn(async () => ({ data: row })), invalidate: jest.fn() };
  w.CO_ED_DIRECTORY_API = api;
});
afterEach(() => dom.window.close());
test('loads API records instead of rendering bundled/static recruiting information', async () => {
  w.COMPANIES_DATA = { companies: [{ name: 'UNTRUSTED_BUNDLE' }] };
  w.eval(script); await flush();
  expect(api.list).toHaveBeenCalled();
  expect(w.document.body.textContent).toContain('Synthetic Partner');
  expect(w.document.body.textContent).not.toContain('OLD_STATIC_DATA');
  expect(w.document.body.textContent).not.toContain('UNTRUSTED_BUNDLE');
  expect(w.document.querySelector('#durationFilter').disabled).toBe(true);
});
test('modal displays anonymous company data and a Login link only', async () => {
  w.eval(script); await flush(); await w.openCompanyModal(ID);
  expect(w.document.querySelector('#modalReq a').getAttribute('href')).toBe('app.html');
  expect(w.document.querySelector('#companyModal').getAttribute('aria-modal')).toBe('true');
});
test('server-authorized titles, quotas and durations remain text, never active markup', async () => {
  const privateRow = { ...row, details_available: true, positions: [
    { id: ID, title: '<img src=x onerror=alert(1)>', quota: '5', duration: '6 months', announcement_ref: '2569:1' }
  ] };
  api.list.mockResolvedValue(response([privateRow], { details_available: true }));
  api.detail.mockResolvedValue({ data: privateRow });
  w.eval(script); await flush(); await w.openCompanyModal(ID);
  expect(w.document.querySelector('#modalDescription img')).toBeNull();
  expect(w.document.querySelector('#modalDescription').textContent).toContain('<img src=x');
  expect(w.document.querySelector('#modalDescription').textContent).toContain('รวม');
  expect(w.document.querySelector('#durationFilter').disabled).toBe(false);
});
test('search resets pagination and forwards exact server filters', async () => {
  w.eval(script); await flush();
  w.document.querySelector('#companySearch').value = 'Partner';
  w.document.querySelector('#locationFilter').value = 'นนทบุรี';
  w.document.querySelector('#locationFilter').dispatchEvent(new w.Event('change'));
  await flush();
  expect(api.list.mock.calls.at(-1)[0]).toMatchObject({ q: 'Partner', location: 'นนทบุรี', page: 1 });
});
test('home search parameters are applied on the first API request', async () => {
  w.history.replaceState(null, '', '?search=Partner&location=' + encodeURIComponent('นนทบุรี'));
  w.eval(script); await flush();
  expect(api.list.mock.calls[0][0]).toMatchObject({ q: 'Partner', location: 'นนทบุรี', page: 1 });
  expect(w.document.querySelector('#locationFilter').value).toBe('นนทบุรี');
});
test('empty and failed API reads never revive fabricated fallback cards', async () => {
  api.list.mockResolvedValue(response([]));
  w.eval(script); await flush();
  expect(w.document.querySelector('#companyList').children).toHaveLength(0);
  expect(w.document.querySelector('#searchResultStatus').textContent).toContain('ไม่พบ');
  api.list.mockRejectedValue(new Error('unavailable'));
  w.document.querySelector('#filterResetBtn').click(); await flush();
  expect(w.document.querySelector('#searchResultStatus').textContent).toContain('ยังโหลดข้อมูลไม่ได้');
  expect(w.document.body.textContent).not.toContain('OLD_STATIC_DATA');
});
test('retry repeats the failed first page instead of skipping it', async () => {
  api.list.mockRejectedValueOnce(new Error('unavailable'));
  w.eval(script); await flush();
  w.document.querySelector('#loadMoreCompanies').click(); await flush();
  expect(api.list.mock.calls.map(([query]) => query.page)).toEqual([1, 1]);
  expect(w.document.querySelector('#companyList').children).toHaveLength(1);
});
test('retrying a later page keeps earlier cards without skipping the failed page', async () => {
  api.list.mockResolvedValueOnce(response([row], { total: 3, totalPages: 3 }));
  w.eval(script); await flush();
  api.list.mockRejectedValueOnce(new Error('unavailable'));
  w.document.querySelector('#loadMoreCompanies').click(); await flush();
  api.list.mockResolvedValueOnce(response([{ ...row, id: 'page2' }], { total: 3, totalPages: 3 }));
  w.document.querySelector('#loadMoreCompanies').click(); await flush();
  expect(api.list.mock.calls.map(([query]) => query.page)).toEqual([1, 2, 2]);
  expect(w.document.querySelector('#companyList').children).toHaveLength(2);
});
test('a public detail response removes private cards after access is lost', async () => {
  api.list.mockResolvedValueOnce(response([{ ...row, details_available: true,
    positions: [{ title: 'PRIVATE_TITLE' }] }], { details_available: true }));
  w.eval(script); await flush();
  expect(w.document.body.textContent).toContain('PRIVATE_TITLE');
  await w.openCompanyModal(ID); await flush();
  expect(w.document.body.textContent).not.toContain('PRIVATE_TITLE');
});
test('stale responses cannot overwrite a newer search', async () => {
  let resolve;
  api.list.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  w.eval(script);
  w.document.querySelector('#filterResetBtn').click(); await flush();
  resolve(response([{ ...row, name: 'STALE_DATA' }])); await flush();
  expect(w.document.body.textContent).not.toContain('STALE_DATA');
});
test('logout clears cards/modal immediately and blocks an outstanding detail response', async () => {
  let resolve;
  w.eval(script); await flush();
  api.detail.mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = w.openCompanyModal(ID);
  w.dispatchEvent(new w.Event('coed:private-content-clear'));
  expect(w.document.querySelector('#companyList').children).toHaveLength(0);
  expect(api.invalidate).toHaveBeenCalled();
  resolve({ data: { ...row, details_available: true, positions: [{ title: 'LATE_PRIVATE_DATA' }] } });
  await pending;
  expect(w.document.body.textContent).not.toContain('LATE_PRIVATE_DATA');
  expect(w.document.querySelector('#companyModal').classList.contains('active')).toBe(false);
});
test('a forged storage identity does not make the client request protected details', async () => {
  w.sessionStorage.setItem('fake.idToken', 'NOT_A_REAL_TOKEN');
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => response() }));
  const client = createDirectoryClient({ apiBaseUrl: 'https://api.example.invalid',
    getAccessToken: async () => { throw new Error('Not signed in'); }, fetchImpl });
  await client.list({ role: 'Developer' });
  expect(fetchImpl.mock.calls[0][0]).toContain('/api/directory/companies');
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(fetchImpl.mock.calls[0][0]).not.toContain('role=');
});
test('valid-session requests use Access Token and downgrade 401 to public data without private filters', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 401 })
    .mockResolvedValueOnce({ ok: true, json: async () => response() });
  const client = createDirectoryClient({ apiBaseUrl: 'https://api.example.invalid', getAccessToken: async () => 'SYNTHETIC_ACCESS', fetchImpl });
  await client.list({ role: 'Developer', duration: '6 months' });
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer SYNTHETIC_ACCESS');
  expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
  expect(fetchImpl.mock.calls[1][0]).not.toMatch(/role=|duration=/);
});
test('client rejects a late protected response after invalidation', async () => {
  let resolve;
  const fetchImpl = jest.fn(() => new Promise(done => { resolve = done; }));
  const client = createDirectoryClient({ apiBaseUrl: 'https://api.example.invalid', getAccessToken: async () => 'SYNTHETIC_ACCESS', fetchImpl });
  const pending = client.detail(ID);
  await flush(); client.invalidate();
  resolve({ ok: true, json: async () => ({ data: row }) });
  await expect(pending).rejects.toThrow('Session ended');
});
