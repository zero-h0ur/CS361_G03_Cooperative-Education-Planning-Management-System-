import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { createAppServer } from '../server.js';
import { store } from '../services/dynamic-data-service.js';

function dispatch(server, { method = 'GET', url = '/', headers = {}, body = null }) {
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

    const resHeaders = {};
    let statusCode = 200;
    const chunks = [];

    const res = new EventEmitter();
    res.writeHead = (status, headersObj) => {
      statusCode = status;
      if (headersObj) Object.assign(resHeaders, headersObj);
    };
    res.setHeader = (k, v) => { resHeaders[k.toLowerCase()] = v; };
    res.getHeader = (k) => resHeaders[k.toLowerCase()];
    res.write = (chunk) => { if (chunk) chunks.push(Buffer.from(chunk)); };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const resBody = Buffer.concat(chunks).toString('utf-8');
      let json = null;
      try { json = JSON.parse(resBody); } catch { /* text */ }
      resolve({ statusCode, headers: resHeaders, body: resBody, json });
    };

    server.emit('request', req, res);
  });
}

test.beforeEach(() => {
  store.reset();
});

test('GET /api/health returns ok status and v2 info', async () => {
  const server = createAppServer({ maxItems: 8 });
  const res = await dispatch(server, { url: '/api/health' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.version, '2.0.0');
  assert.equal(res.json.config.maxItems, 8);
});

test('GET /api/v2/summary returns comprehensive metrics across all 5 entities', async () => {
  const server = createAppServer();
  const res = await dispatch(server, { url: '/api/v2/summary' });

  assert.equal(res.statusCode, 200);
  assert.ok(res.json.students.total > 0);
  assert.ok(res.json.companies.total > 0);
  assert.ok(res.json.positions.total > 0);
  assert.ok(res.json.plans.total > 0);
  assert.ok(res.json.activeCycle.id);
});

test('GET /api/v2/students filters and searches students', async () => {
  const server = createAppServer({ maxItems: 5 });
  const res = await dispatch(server, { url: '/api/v2/students?eligibility=eligible' });

  assert.equal(res.statusCode, 200);
  assert.ok(res.json.items.length > 0);
  assert.ok(res.json.items.every((s) => s.eligibilityStatus === 'eligible'));

  const detailRes = await dispatch(server, { url: '/api/v2/students/6609650012' });
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.json.id, '6609650012');
  assert.ok(detailRes.json.currentPlan);
});

test('GET /api/v2/companies returns companies and detail with positions', async () => {
  const server = createAppServer();
  const res = await dispatch(server, { url: '/api/v2/companies?hasMOU=true' });

  assert.equal(res.statusCode, 200);
  assert.ok(res.json.items.every((c) => c.coopMOU === true));

  const detailRes = await dispatch(server, { url: '/api/v2/companies/agoda' });
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.json.name, 'Agoda');
  assert.ok(detailRes.json.positions.length >= 1);
});

test('GET /api/v2/positions filters by field and workMode', async () => {
  const server = createAppServer();
  const res = await dispatch(server, {
    url: `/api/v2/positions?field=${encodeURIComponent('Software Engineering')}&workMode=Hybrid`
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.json.items.length > 0);
  assert.ok(res.json.items.every((p) => p.field === 'Software Engineering' && p.workMode === 'Hybrid'));
});

test('GET /api/v2/cycles and active cycle endpoint', async () => {
  const server = createAppServer();
  const res = await dispatch(server, { url: '/api/v2/cycles/active' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'active');
  assert.ok(res.json.milestones.length > 0);
});

test('POST /api/v2/plans creates a new co-op plan systematically', async () => {
  const server = createAppServer();
  const payload = {
    studentId: '6609650224',
    cycleId: 'cycle-2567-2',
    companyId: 'g-able',
    positionId: 'pos-gable-01',
    proposedTopic: 'ระบบ Automated Kubernetes Cluster Observability บน AWS',
    objective: '1. ออกแบบ Alerting Rules\n2. ลด Mean Time To Detect (MTTD)'
  };

  const res = await dispatch(server, {
    method: 'POST',
    url: '/api/v2/plans',
    headers: { 'content-type': 'application/json' },
    body: payload
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json.plan.studentId, '6609650224');
  assert.equal(res.json.plan.status, 'pending');
  assert.ok(res.json.plan.id.startsWith('plan-2567-'));

  // Test PATCH to update plan status
  const planId = res.json.plan.id;
  const patchRes = await dispatch(server, {
    method: 'PATCH',
    url: `/api/v2/plans/${planId}`,
    headers: { 'content-type': 'application/json' },
    body: { status: 'approved', reviewNotes: 'อนุมัติผ่านระบบ' }
  });

  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.json.plan.status, 'approved');
  assert.equal(patchRes.json.plan.reviewNotes, 'อนุมัติผ่านระบบ');
});

test('OPTIONS request returns 204 for CORS preflight', async () => {
  const server = createAppServer();
  const res = await dispatch(server, { method: 'OPTIONS', url: '/api/v2/plans' });
  assert.equal(res.statusCode, 204);
});
