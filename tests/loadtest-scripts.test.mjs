import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLoadtestCompaniesSql,
  companyIdForIndex,
  generateSyntheticDataset,
  positionIdForIndex,
  sqlLiteral,
  validateGeneratorOptions
} from '../scripts/loadtest/generate-companies.mjs';
import {
  assertSafeTargetUrl,
  extractTokenFromRecord,
  parseCliOptions,
  runSmoke,
  validateAccessToken
} from '../scripts/loadtest/smoke.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('generate-companies validates bounds and produces 300-500 LOADTEST companies matching location proportions', () => {
  assert.throws(() => validateGeneratorOptions({ count: 299 }), RangeError);
  assert.throws(() => validateGeneratorOptions({ count: 501 }), RangeError);
  assert.throws(() => validateGeneratorOptions({ count: 400.5 }), RangeError);
  assert.throws(() => validateGeneratorOptions({ count: 400, positionsPerCompany: -1 }), RangeError);

  const { companies, positions } = generateSyntheticDataset({ count: 400, positionsPerCompany: 2 });
  assert.equal(companies.length, 400);
  assert.equal(positions.length, 800);
  assert.equal(new Set(companies.map(c => c.id)).size, 400);
  assert.equal(new Set(companies.map(c => c.directory_code)).size, 400);
  assert.equal(new Set(positions.map(p => p.id)).size, 800);

  for (const c of companies) {
    assert.match(c.id, UUID_V4);
    assert.ok(c.name.startsWith('LOADTEST '), `Expected LOADTEST prefix, got: ${c.name}`);
    assert.equal(c.visibility, 'public');
    assert.equal(c.data_status, 'mock');
    assert.equal(c.logo_path, null);
    assert.equal(c.catalog_key, 'loadtest-synthetic-2569');
  }
  for (const p of positions) {
    assert.match(p.id, UUID_V4);
    assert.match(p.company_id, UUID_V4);
    assert.equal(p.visibility, 'public');
    assert.equal(p.data_status, 'mock');
    assert.equal(p.academic_year, 2569);
  }

  // Location distribution closely matches data/companies.json (~74.8% BKK, ~7.8% Nonthaburi, ~6.8% Pathum Thani, ~3.9% null).
  const byLocation = new Map();
  for (const c of companies) byLocation.set(c.location, (byLocation.get(c.location) || 0) + 1);
  assert.equal(byLocation.get('กรุงเทพฯ'), 299);
  assert.equal(byLocation.get('นนทบุรี'), 31);
  assert.equal(byLocation.get('ปทุมธานี'), 27);
  assert.equal(byLocation.get(null), 15);
  assert.equal(byLocation.get('สมุทรปราการ'), 8);
  assert.equal(companies.slice(0, 20).some(c => c.location !== 'กรุงเทพฯ'), true);
});

test('generate-companies builds safe SQL and checked-in companies-seed.sql stays synchronized', () => {
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(2569), '2569');
  assert.equal(sqlLiteral("O'Reilly & Co"), "'O''Reilly & Co'");
  assert.equal(companyIdForIndex(1), '50000000-0000-4000-8000-000000000001');
  assert.equal(positionIdForIndex(1, 2), '51000000-0000-4000-8000-000000010002');

  const noPosSql = buildLoadtestCompaniesSql({ count: 300, positionsPerCompany: 0 });
  assert.ok(noPosSql.includes('INSERT INTO companies'));
  assert.ok(!noPosSql.includes('INSERT INTO positions'));

  const expectedSql = buildLoadtestCompaniesSql({ count: 400, positionsPerCompany: 2 });
  const checkedInSql = readFileSync(resolve(ROOT, 'scripts/loadtest/companies-seed.sql'), 'utf8');
  assert.equal(checkedInSql, expectedSql);

  const statsOut = execFileSync(process.execPath, ['scripts/loadtest/generate-companies.mjs', '--stats', '--count', '350'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const stats = JSON.parse(statsOut);
  assert.equal(stats.companies, 350);
  assert.equal(stats.positions, 700);
});

test('smoke target safety guard blocks production URLs, cleartext non-loopback HTTP, and embedded credentials', () => {
  for (const prodUrl of [
    'https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com',
    'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com/prod',
    'https://main.d1bpmj87vmjb96.amplifyapp.com',
    'http://loadtest.example.com',
    'https://user:secret@loadtest.example.com'
  ]) {
    assert.throws(() => assertSafeTargetUrl(prodUrl));
  }
  assert.equal(
    assertSafeTargetUrl('https://lt12345678.execute-api.ap-southeast-2.amazonaws.com/'),
    'https://lt12345678.execute-api.ap-southeast-2.amazonaws.com'
  );
  assert.equal(assertSafeTargetUrl('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001');
});

test('smoke verifies list 200, detail 200, GET + PATCH /api/v3/plans 200 and protects tokens via CLI', async t => {
  const SECRET_TOKEN = 'header.payload_CANARY_TOKEN_VALUE.signature';
  const companyId = companyIdForIndex(1);
  const planId = '44000000-0000-4000-8000-000000000001';
  const baseUrl = 'https://lt12345678.execute-api.ap-southeast-2.amazonaws.com';
  let planVersion = 2;
  let lastPatchBody = null;
  const requests = [];

  const mockFetch = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    const method = init.method || 'GET';
    const auth = init.headers?.Authorization || init.headers?.authorization;
    requests.push({ method, path: `${url.pathname}${url.search}`, hasAuth: Boolean(auth) });

    if (method === 'GET' && url.pathname === '/api/directory/companies') {
      assert.equal(url.searchParams.get('pageSize'), '20');
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(auth, undefined);
      return new Response(JSON.stringify({
        data: [{ id: companyId, name: 'LOADTEST Cloud บริษัท สหกิจศึกษา 0001 จำกัด' }],
        pagination: { page: 1, pageSize: 20, total: 400, totalPages: 20 }
      }), { status: 200 });
    }
    if (method === 'GET' && url.pathname === `/api/directory/companies/${companyId}`) {
      assert.equal(auth, undefined);
      return new Response(JSON.stringify({
        data: { id: companyId, name: 'LOADTEST Cloud บริษัท สหกิจศึกษา 0001 จำกัด' }
      }), { status: 200 });
    }
    if (auth !== `Bearer ${SECRET_TOKEN}`) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }), { status: 401 });
    }
    if (method === 'GET' && url.pathname === '/api/v3/plans') {
      return new Response(JSON.stringify({
        data: [
          { id: '44000000-0000-4000-8000-000000000099', status: 'CANCELLED', version: 1 },
          { id: planId, status: 'DRAFT', version: planVersion }
        ],
        pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 }
      }), { status: 200 });
    }
    if (method === 'PATCH' && url.pathname === `/api/v3/plans/${planId}`) {
      lastPatchBody = JSON.parse(init.body);
      if (lastPatchBody.expected_version !== planVersion) {
        return new Response(JSON.stringify({ error: { code: 'STALE_RECORD_CONFLICT', message: 'Stale' } }), { status: 409 });
      }
      planVersion += 1;
      return new Response(JSON.stringify({ data: { id: planId, status: 'DRAFT', version: planVersion } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 });
  };

  const report = await runSmoke({ url: baseUrl, token: SECRET_TOKEN }, { fetchImpl: mockFetch });
  assert.equal(report.ok, true);
  assert.equal(report.steps.length, 4);
  assert.deepEqual(report.steps.map(s => s.status), [200, 200, 200, 200]);
  assert.ok(report.steps.every(s => typeof s.durationMs === 'number' && s.durationMs >= 0));
  assert.equal(report.selectedCompanyId, companyId);
  assert.equal(report.planId, planId);
  assert.equal(report.previousVersion, 2);
  assert.equal(report.newVersion, 3);
  assert.equal(lastPatchBody.expected_version, 2);
  assert.equal(lastPatchBody.notes, 'loadtest 2026-11-18');
  assert.match(lastPatchBody.operation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.deepEqual(requests.map(r => r.hasAuth), [false, false, true, true]);

  // Verify CLI rejects production target immediately without making network requests or leaking the token.
  const deniedCli = spawnSync(
    process.execPath,
    ['scripts/loadtest/smoke.mjs', '--url', 'https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com', '--token', SECRET_TOKEN],
    { cwd: ROOT, encoding: 'utf8' }
  );
  assert.equal(deniedCli.status, 1);
  assert.match(deniedCli.stderr, /Refusing to target production host/);
  assert.ok(!deniedCli.stderr.includes(SECRET_TOKEN));

  // Verify token extraction helper & token-file option without leaking secrets on failure.
  assert.equal(extractTokenFromRecord({ tokens: { loadtest01: { access_token: 'abc.def.ghi' } } }, 'loadtest01'), 'abc.def.ghi');
  assert.equal(validateAccessToken('Bearer xyz.123.456'), 'xyz.123.456');

  const tmp = mkdtempSync(join(tmpdir(), 'coed-lt-tokens-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const tokenFile = join(tmp, 'tokens.json');
  writeFileSync(tokenFile, JSON.stringify({ loadtest01: { refresh_token: 'ONLY_REFRESH_SECRET' } }));
  await assert.rejects(
    () => parseCliOptions(['--url', baseUrl, '--token-file', tokenFile], {}),
    err => !err.message.includes('ONLY_REFRESH_SECRET') && err.message.includes('No access_token found')
  );
});

test('smoke surfaces actionable hints on 503 maintenance or 401 auth errors without leaking the token', async () => {
  const SECRET_TOKEN = 'super.secret.loadtest_token';
  let callIndex = 0;
  const mockFetch = async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return new Response(JSON.stringify({
        data: [{ id: companyIdForIndex(1), name: 'LOADTEST Co' }],
        pagination: { total: 400 }
      }), { status: 200 });
    }
    if (callIndex === 2) {
      return new Response(JSON.stringify({ data: { id: companyIdForIndex(1) } }), { status: 200 });
    }
    if (callIndex === 3) {
      return new Response(JSON.stringify({
        error: { code: 'COED_MAINTENANCE', message: 'maintenance' }
      }), { status: 503 });
    }
    throw new Error('Unexpected call');
  };

  await assert.rejects(
    () => runSmoke({ url: 'https://lt.execute-api.ap-southeast-2.amazonaws.com', token: SECRET_TOKEN }, { fetchImpl: mockFetch }),
    err => err.message.includes('503') && err.message.includes('COED_API_MAINTENANCE=off') && !err.message.includes(SECRET_TOKEN)
  );
});
