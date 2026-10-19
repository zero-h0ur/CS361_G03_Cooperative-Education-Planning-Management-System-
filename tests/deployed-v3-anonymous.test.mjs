import assert from 'node:assert/strict';
import test from 'node:test';

// Explicit live-only command; not included in npm test / offline CI. No real
// token, password or user resource ID is read. Mutation-denial probes use invalid
// JSON and a reserved synthetic ID, so no valid application write is requested.
const API = new URL(process.env.V3_API_BASE_URL || 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com');
const WEB = new URL(process.env.V3_FRONTEND_BASE_URL || 'https://main.d1d9qrqnsi5nl6.amplifyapp.com');
for (const value of [API, WEB]) {
  assert.equal(value.protocol, 'https:', 'Live smoke requires HTTPS.');
  assert.equal(Boolean(value.username || value.password || value.search || value.hash), false,
    'Live origin cannot include credentials, query or fragment.');
  assert.equal(value.pathname, '/', 'Configure an origin, not an API resource path.');
}
const ID = '00000000-0000-4000-8000-000000000083';
const INVALID_TOKEN = 'coed-smoke83-invalid-token-canary';
const timeout = Number(process.env.V3_REQUEST_TIMEOUT_MS || 15000);
assert.equal(Number.isInteger(timeout) && timeout > 0 && timeout <= 60000, true, 'Invalid request timeout.');

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(new URL(path, API), {
    method, headers: { Accept: 'application/json', ...headers }, body,
    redirect: 'error', signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  return { response, text };
}

function safeError(result, label) {
  assert.equal(result.text.includes(INVALID_TOKEN), false, `${label}: request token echoed (withheld).`);
  const unsafe = /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/|BEGIN [A-Z ]*PRIVATE KEY|external_subject|external_issuer|institutional_email|student_number|preferred_name|\bat\s+\S+\s+\([^\n]*:\d+:\d+\))/i;
  assert.equal(unsafe.test(result.text), false, `${label}: response contains private/debug material (withheld).`);
  let json;
  try { json = JSON.parse(result.text); } catch { assert.fail(`${label}: expected safe JSON error (body withheld).`); }
  assert.equal(json !== null && typeof json === 'object' && !Array.isArray(json), true, `${label}: invalid error envelope.`);
  assert.equal(Object.keys(json).every(key => ['message', 'error'].includes(key)), true,
    `${label}: unexpected top-level error fields (values withheld).`);
  assert.equal(Object.hasOwn(json, 'data'), false, `${label}: error must not return a data envelope.`);
  assert.notEqual(result.response.headers.get('access-control-allow-origin'), '*', `${label}: wildcard CORS.`);
  assert.notEqual(result.response.headers.get('access-control-allow-credentials'), 'true', `${label}: unexpected credentialed CORS.`);
}

test('V3-T05 deployed anonymous/authentication boundary', { timeout: 180000 }, async t => {
  t.diagnostic(`Started ${new Date().toISOString()} · API ${API.origin} · frontend ${WEB.origin}`);
  t.diagnostic('These probes do NOT establish live ownership, Staff scope, Advisor read-only, session expiry or CloudWatch log acceptance.');

  const reads = [
    '/api/v3/me', '/api/v3/students/me', '/api/v3/plans',
    `/api/v3/plans/${ID}`, `/api/v3/plans/${ID}/history`, '/api/v3/plan-options/cycles',
    '/api/v3/staff/students', '/api/v3/staff/plans', '/api/v3/staff/review-queue',
    `/api/v3/staff/plans/${ID}`, `/api/v3/staff/plans/${ID}/history`,
    '/api/v3/advisor/students', `/api/v3/advisor/students/${ID}`,
    `/api/v3/advisor/students/${ID}/plans`, `/api/v3/advisor/plans/${ID}`
  ];
  for (const path of reads) {
    await t.test(`anonymous GET ${path} → 401`, async () => {
      const result = await request(path);
      assert.equal(result.response.status, 401, 'Anonymous protected read must be 401.');
      safeError(result, 'anonymous protected read');
    });
  }

  const writes = [
    ['POST', '/api/v3/plans'], ['PATCH', '/api/v3/students/me'], ['PUT', '/api/v3/students/me'],
    ['PATCH', `/api/v3/plans/${ID}`], ['DELETE', `/api/v3/plans/${ID}`],
    ...['submit', 'start-review', 'return', 'approve'].map(command => ['POST', `/api/v3/plans/${ID}/${command}`])
  ];
  for (const [method, path] of writes) {
    await t.test(`anonymous ${method} ${path} → 401 before JSON parsing`, async () => {
      const result = await request(path, { method, headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(result.response.status, 401, 'Anonymous mutation probe must be rejected before body validation.');
      safeError(result, 'anonymous mutation denial');
    });
  }

  for (const path of ['/api/v3/me', '/api/v3/students/me', '/api/v3/staff/plans', '/api/v3/advisor/students']) {
    await t.test(`malformed Bearer on ${path} → 401`, async () => {
      const result = await request(path, { headers: { Authorization: `Bearer ${INVALID_TOKEN}` } });
      assert.equal(result.response.status, 401, 'Malformed bearer must be denied.');
      safeError(result, 'malformed token denial');
    });
  }

  for (const path of ['/api/students', '/api/plans']) {
    await t.test(`legacy public namespace ${path} does not expose private data`, async () => {
      const result = await request(path);
      assert.equal(result.response.status, 404, 'Legacy private path must not be published.');
      safeError(result, 'legacy private path');
    });
  }

  for (const path of ['/api/companies', '/api/positions']) {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      await t.test(`public directory ${method} ${path} is unavailable`, async () => {
        const result = await request(path, { method, headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal([401, 403, 404, 405].includes(result.response.status), true,
          'Public mutation route must be unavailable, not successful or a server error.');
        safeError(result, 'public mutation denial');
      });
    }
  }

  await t.test('main protected preflight allows only configured origin/headers and exposes no data', async () => {
    const { response, text } = await request('/api/v3/me', { method: 'OPTIONS', headers: {
      Origin: WEB.origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'
    } });
    assert.equal(response.status, 204);
    assert.equal(text, '', 'Preflight must not return application data.');
    assert.equal(response.headers.get('access-control-allow-origin'), WEB.origin);
    assert.equal((response.headers.get('access-control-allow-headers') || '').toLowerCase().includes('authorization'), true);
    assert.notEqual(response.headers.get('access-control-allow-credentials'), 'true');
  });

  await t.test('unapproved browser origin is not granted CORS access', async () => {
    const { response } = await request('/api/health', { headers: { Origin: 'https://unapproved-smoke83.example.com' } });
    assert.equal(response.status, 200, 'CORS is not API authentication; public health remains public.');
    assert.equal(response.headers.has('access-control-allow-origin'), false, 'Unapproved origin must not receive an allow-origin grant.');
  });
  t.diagnostic(`Finished ${new Date().toISOString()}`);
});
