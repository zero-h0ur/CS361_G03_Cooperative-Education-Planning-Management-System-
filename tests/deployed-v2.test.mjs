import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DEFAULT_API_BASE_URL = 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com';
const DEFAULT_FRONTEND_BASE_URL = 'https://main.d1d9qrqnsi5nl6.amplifyapp.com';

const apiBaseUrl = normalizeBaseUrl(process.env.V2_API_BASE_URL || DEFAULT_API_BASE_URL);
const frontendBaseUrl = normalizeBaseUrl(
  process.env.V2_FRONTEND_BASE_URL || DEFAULT_FRONTEND_BASE_URL
);
const frontendOrigin = new URL(frontendBaseUrl).origin;
const requestTimeoutMs = parsePositiveInteger(
  process.env.V2_REQUEST_TIMEOUT_MS || '15000',
  'V2_REQUEST_TIMEOUT_MS'
);

const COMPANY_PUBLIC_FIELDS = new Set([
  'id',
  'name',
  'description',
  'website_url',
  'location',
  'source',
  'updated_at',
  'data_status',
  'positions'
]);

const POSITION_PUBLIC_FIELDS = new Set([
  'id',
  'company_id',
  'title',
  'description',
  'location',
  'source',
  'updated_at',
  'data_status'
]);

const PRIVATE_KEY_PATTERN = /(?:password|secret|credential|token|anonymous_ref|student_id|plan_id|visibility|private)/i;

function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim());
  return url.toString().replace(/\/+$/, '');
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function request(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...init.headers
      }
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestApi(path, init = {}) {
  const { response, text } = await request(`${apiBaseUrl}${path}`, init);
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    assert.fail(`${path} did not return valid JSON.`);
  }

  return { response, body };
}

function assertStatus(response, expected, context) {
  assert.equal(
    response.status,
    expected,
    `${context}: expected HTTP ${expected}, received ${response.status}`
  );
}

function assertOnlyPublicFields(record, allowedFields, context) {
  assert.equal(typeof record, 'object', `${context} must be an object.`);
  assert.notEqual(record, null, `${context} must not be null.`);

  for (const key of Object.keys(record)) {
    assert.equal(allowedFields.has(key), true, `${context} exposed unsupported field: ${key}`);
    assert.equal(PRIVATE_KEY_PATTERN.test(key), false, `${context} exposed private field: ${key}`);
  }
}

function assertPublicPosition(position, context) {
  assertOnlyPublicFields(position, POSITION_PUBLIC_FIELDS, context);
  for (const field of ['id', 'company_id', 'title', 'source', 'updated_at', 'data_status']) {
    assert.equal(typeof position[field], 'string', `${context}.${field} must be a string.`);
    assert.notEqual(position[field].trim(), '', `${context}.${field} must not be empty.`);
  }
  assert.equal(position.data_status, 'mock', `${context} must be marked as mock data.`);
  assert.equal(Number.isNaN(Date.parse(position.updated_at)), false, `${context}.updated_at is invalid.`);
}

function assertPublicCompany(company, context) {
  assertOnlyPublicFields(company, COMPANY_PUBLIC_FIELDS, context);
  for (const field of ['id', 'name', 'source', 'updated_at', 'data_status']) {
    assert.equal(typeof company[field], 'string', `${context}.${field} must be a string.`);
    assert.notEqual(company[field].trim(), '', `${context}.${field} must not be empty.`);
  }
  assert.equal(company.data_status, 'mock', `${context} must be marked as mock data.`);
  assert.equal(Number.isNaN(Date.parse(company.updated_at)), false, `${context}.updated_at is invalid.`);

  if (company.positions !== undefined) {
    assert.equal(Array.isArray(company.positions), true, `${context}.positions must be an array.`);
    company.positions.forEach((position, index) => {
      assertPublicPosition(position, `${context}.positions[${index}]`);
    });
  }
}

function assertPagination(body, context) {
  assert.equal(Array.isArray(body.data), true, `${context}.data must be an array.`);
  assert.equal(typeof body.pagination, 'object', `${context}.pagination must be an object.`);

  for (const field of ['page', 'pageSize', 'total', 'totalPages']) {
    assert.equal(
      Number.isInteger(body.pagination[field]),
      true,
      `${context}.pagination.${field} must be an integer.`
    );
  }
}

function assertSafeError(body, context) {
  assert.deepEqual(Object.keys(body).sort(), ['error'], `${context} must return only an error object.`);
  assert.deepEqual(
    Object.keys(body.error).sort(),
    ['code', 'message'],
    `${context}.error must return only code and message.`
  );
  assert.equal(typeof body.error.code, 'string');
  assert.equal(typeof body.error.message, 'string');
  assert.doesNotMatch(body.error.message, /(?:stack|postgres|database_url|password|secret|credential|token)/i);
}

function normalizeText(value) {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

async function listCompanies(parameters = {}) {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '100', ...parameters });
  return requestApi(`/api/companies?${searchParams}`);
}

test('Issue #36 deployed V2 verification', { timeout: 120000 }, async (t) => {
  let canonicalCompanies = [];
  let sampleCompanyWithPosition;
  let samplePosition;

  await t.test('V2-T01 health endpoint is safe and available', async () => {
    const { response, body } = await requestApi('/api/health');

    assertStatus(response, 200, 'health');
    assert.deepEqual(body, { data: { status: 'ok', service: 'co-ed-v2-api' } });
  });

  await t.test('V2-T02 lists public mock companies and position details', async () => {
    const { response, body } = await listCompanies();

    assertStatus(response, 200, 'company list');
    assertPagination(body, 'company list');
    assert.equal(body.data.length > 0, true, 'company list must contain deployed data.');
    canonicalCompanies = body.data;
    canonicalCompanies.forEach((company, index) => {
      assertPublicCompany(company, `company list.data[${index}]`);
    });

    const company = canonicalCompanies[0];
    const companyResult = await requestApi(`/api/companies/${company.id}`);
    assertStatus(companyResult.response, 200, 'company detail');
    assertPublicCompany(companyResult.body.data, 'company detail.data');
    assert.equal(companyResult.body.data.id, company.id);

    for (const candidate of canonicalCompanies) {
      const positionsResult = await requestApi(`/api/companies/${candidate.id}/positions`);
      assertStatus(positionsResult.response, 200, 'company positions');
      assert.equal(Array.isArray(positionsResult.body.data), true);

      positionsResult.body.data.forEach((position, index) => {
        assertPublicPosition(position, `company positions.data[${index}]`);
        assert.equal(position.company_id, candidate.id);
      });

      if (positionsResult.body.data.length > 0) {
        sampleCompanyWithPosition = candidate;
        [samplePosition] = positionsResult.body.data;
        break;
      }
    }

    assert.ok(sampleCompanyWithPosition, 'At least one company must have a public position.');
    assert.ok(samplePosition, 'At least one public position must be available.');

    const positionResult = await requestApi(`/api/positions/${samplePosition.id}`);
    assertStatus(positionResult.response, 200, 'position detail');
    assertPublicPosition(positionResult.body.data, 'position detail.data');
    assert.equal(positionResult.body.data.id, samplePosition.id);
  });

  await t.test('V2-T03 searches by company name and position title', async () => {
    assert.equal(canonicalCompanies.length > 0, true, 'V2-T02 must load company data first.');
    const company = canonicalCompanies[0];
    const companySearch = await listCompanies({ q: company.name });

    assertStatus(companySearch.response, 200, 'company search');
    assertPagination(companySearch.body, 'company search');
    assert.equal(
      companySearch.body.data.some((item) => item.id === company.id),
      true,
      'Exact company-name search must return the source company.'
    );

    assert.ok(sampleCompanyWithPosition, 'V2-T02 must locate a company with a position first.');
    assert.ok(samplePosition, 'V2-T02 must locate a public position first.');
    const positionSearch = await listCompanies({ q: samplePosition.title });

    assertStatus(positionSearch.response, 200, 'position search');
    assert.equal(
      positionSearch.body.data.some((item) => item.id === sampleCompanyWithPosition.id),
      true,
      'Position-title search must return its company.'
    );
  });

  await t.test('V2-T04 filters companies by an exact deployed location', async () => {
    const company = canonicalCompanies.find((item) => typeof item.location === 'string');
    assert.ok(company, 'Location verification requires at least one located company.');
    const result = await listCompanies({ location: company.location });

    assertStatus(result.response, 200, 'location filter');
    assertPagination(result.body, 'location filter');
    assert.equal(result.body.data.length > 0, true);
    assert.equal(
      result.body.data.every((item) => item.location === company.location),
      true,
      'Every filtered company must match the requested location.'
    );
  });

  await t.test('V2-T05 paginates without duplicating records', async () => {
    const first = await listCompanies({ page: '1', pageSize: '1' });
    const second = await listCompanies({ page: '2', pageSize: '1' });

    assertStatus(first.response, 200, 'pagination page 1');
    assertStatus(second.response, 200, 'pagination page 2');
    assertPagination(first.body, 'pagination page 1');
    assertPagination(second.body, 'pagination page 2');
    assert.equal(first.body.pagination.page, 1);
    assert.equal(second.body.pagination.page, 2);
    assert.equal(first.body.pagination.pageSize, 1);
    assert.equal(second.body.pagination.pageSize, 1);
    assert.equal(first.body.pagination.total > 1, true);
    assert.notEqual(first.body.data[0].id, second.body.data[0].id);
  });

  await t.test('V2-T06 returns safe 400 responses for invalid input', async () => {
    for (const path of [
      '/api/companies?page=0&pageSize=10',
      '/api/companies?page=1&pageSize=101',
      '/api/companies?page=1&pageSize=10&unsupported=true',
      '/api/companies/not-a-uuid'
    ]) {
      const { response, body } = await requestApi(path);
      assertStatus(response, 400, path);
      assertSafeError(body, path);
    }
  });

  await t.test('V2-T02 empty query result stays a valid 200 response', async () => {
    const result = await listCompanies({ q: 'issue-36-no-match-7f74e6f7' });

    assertStatus(result.response, 200, 'empty search');
    assertPagination(result.body, 'empty search');
    assert.deepEqual(result.body.data, []);
    assert.equal(result.body.pagination.total, 0);
  });

  await t.test('V2-T09 does not expose Student, Plan, or private fields', async () => {
    for (const path of ['/api/students', '/api/plans']) {
      const { response, body } = await requestApi(path);
      assertStatus(response, 404, path);
      assertSafeError(body, path);
    }

    canonicalCompanies.forEach((company, index) => {
      assertPublicCompany(company, `privacy audit.data[${index}]`);
    });
  });

  await t.test('deployed frontend points to the API and CORS is origin-specific', async () => {
    const pageResult = await request(`${frontendBaseUrl}/company-directory.html`, {
      headers: { Accept: 'text/html' }
    });
    assertStatus(pageResult.response, 200, 'company directory page');
    assert.match(pageResult.text, /runtime-config\.js/);
    assert.match(pageResult.text, /company-directory\.js/);

    const configResult = await request(`${frontendBaseUrl}/runtime-config.js`, {
      headers: { Accept: 'text/javascript' }
    });
    assertStatus(configResult.response, 200, 'runtime config');
    assert.equal(configResult.text.includes(apiBaseUrl), true);
    assert.doesNotMatch(configResult.text, /(?:password|secret|credential|token)\s*[:=]/i);

    const corsResult = await request(`${apiBaseUrl}/api/health`, {
      headers: { Origin: frontendOrigin }
    });
    assertStatus(corsResult.response, 200, 'CORS GET');
    assert.equal(corsResult.response.headers.get('access-control-allow-origin'), frontendOrigin);
    assert.notEqual(corsResult.response.headers.get('access-control-allow-origin'), '*');

    const preflightResult = await request(`${apiBaseUrl}/api/companies`, {
      method: 'OPTIONS',
      headers: {
        Origin: frontendOrigin,
        'Access-Control-Request-Method': 'GET'
      }
    });
    assertStatus(preflightResult.response, 204, 'CORS preflight');
    assert.equal(
      preflightResult.response.headers.get('access-control-allow-origin'),
      frontendOrigin
    );
    assert.match(preflightResult.response.headers.get('access-control-allow-methods') || '', /GET/);
  });

  await t.test('deployed frontend assets match the tested repository files', async () => {
    for (const file of [
      'company-directory.html',
      'company-directory-helpers.js',
      'company-directory.js',
      'runtime-config.js'
    ]) {
      const localText = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      const deployedResult = await request(`${frontendBaseUrl}/${file}`, {
        headers: { Accept: file.endsWith('.html') ? 'text/html' : 'text/javascript' }
      });

      assertStatus(deployedResult.response, 200, `deployed asset ${file}`);
      assert.equal(
        normalizeText(deployedResult.text),
        normalizeText(localText),
        `${file} deployed by Amplify does not match the tested repository file.`
      );
    }
  });
});
