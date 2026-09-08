import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createAppServer } from '../server.js';

async function startTestServer(maxItems = 2) {
  const server = createAppServer({ maxItems });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server
  };
}

test('health endpoint exposes active non-secret configuration', async (t) => {
  const { baseUrl, server } = await startTestServer(4);
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.config.maxItems, 4);
});

test('company endpoint filters data and respects MAX_ITEMS', async (t) => {
  const { baseUrl, server } = await startTestServer(2);
  t.after(() => server.close());

  const response = await fetch(
    `${baseUrl}/api/companies?q=${encodeURIComponent('วิศวกรซอฟต์แวร์')}`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.items.length, 2);
  assert.equal(body.pagination.pageSize, 2);
  assert.ok(body.pagination.total >= 3);
});

test('server provides the existing company directory page', async (t) => {
  const { baseUrl, server } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/company-directory.html`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(html, /รายชื่อสถานประกอบการ/);
});

test('server-side source files are not publicly accessible', async (t) => {
  const { baseUrl, server } = await startTestServer();
  t.after(() => server.close());

  const responses = await Promise.all([
    fetch(`${baseUrl}/server.js`),
    fetch(`${baseUrl}/data/companies.js`),
    fetch(`${baseUrl}/services/company-search.js`),
    fetch(`${baseUrl}/.env`)
  ]);

  assert.ok(responses.every(({ status }) => status === 404));
});
