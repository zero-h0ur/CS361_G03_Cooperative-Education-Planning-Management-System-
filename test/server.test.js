import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { createAppServer } from '../server.js';

function dispatch(server, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const req = new Readable({
      read() {
        if (body) {
          this.push(typeof body === 'string' ? body : JSON.stringify(body));
        }
        this.push(null);
      }
    });
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost', ...headers };

    const resHeaders = new Map();
    let statusCode = 200;
    const chunks = [];

    const res = new EventEmitter();
    res.writeHead = (status, headersObj) => {
      statusCode = status;
      if (headersObj) {
        for (const [k, v] of Object.entries(headersObj)) {
          resHeaders.set(k.toLowerCase(), v);
        }
      }
    };
    res.setHeader = (k, v) => {
      resHeaders.set(k.toLowerCase(), v);
    };
    res.getHeader = (k) => resHeaders.get(k.toLowerCase());
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const resBody = Buffer.concat(chunks).toString('utf-8');
      resolve({
        status: statusCode,
        headers: {
          get: (name) => resHeaders.get(name.toLowerCase()) ?? null
        },
        text: async () => resBody,
        json: async () => JSON.parse(resBody)
      });
    };

    server.emit('request', req, res);
  });
}

test('health endpoint exposes active non-secret configuration', async () => {
  const server = createAppServer({ maxItems: 4 });
  const response = await dispatch(server, { url: '/api/health' });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.config.maxItems, 4);
});

test('company endpoint filters data and respects MAX_ITEMS', async () => {
  const server = createAppServer({ maxItems: 2 });
  const response = await dispatch(server, {
    url: `/api/companies?q=${encodeURIComponent('วิศวกรซอฟต์แวร์')}`
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.items.length, 2);
  assert.equal(body.pagination.pageSize, 2);
  assert.ok(body.pagination.total >= 3);
});

test('server provides the existing company directory page', async () => {
  const server = createAppServer();
  const response = await dispatch(server, { url: '/company-directory.html' });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(html, /รายชื่อสถานประกอบการ/);
});

test('server-side source files are not publicly accessible', async () => {
  const server = createAppServer();
  const responses = await Promise.all([
    dispatch(server, { url: '/server.js' }),
    dispatch(server, { url: '/data/companies.js' }),
    dispatch(server, { url: '/services/company-search.js' }),
    dispatch(server, { url: '/.env' })
  ]);

  assert.ok(responses.every(({ status }) => status === 404));
});
