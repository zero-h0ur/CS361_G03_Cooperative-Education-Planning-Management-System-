import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC_CONFIG_PATH = resolve(ROOT_DIR, 'config/v4-public.json');

const HARDCODED_PRODUCTION_HOSTS = Object.freeze([
  'yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com',
  'qtqlsb1aec.execute-api.us-east-1.amazonaws.com',
  'main.d1bpmj87vmjb96.amplifyapp.com',
  'main.d1d9qrqnsi5nl6.amplifyapp.com'
]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const EDITABLE_PLAN_STATES = new Set(['DRAFT', 'NEEDS_REVISION']);

function loadForbiddenProductionHosts() {
  const hosts = new Set(HARDCODED_PRODUCTION_HOSTS);
  try {
    const cfg = JSON.parse(readFileSync(PUBLIC_CONFIG_PATH, 'utf8'));
    for (const candidate of [cfg?.apiBaseUrl, cfg?.appOrigin]) {
      if (typeof candidate === 'string' && candidate) hosts.add(new URL(candidate).hostname.toLowerCase());
    }
  } catch {
    // Fallback list remains active if public config file is unavailable.
  }
  return hosts;
}

/** Ensures smoke tests never target production endpoints or insecure non-loopback HTTP URLs. */
export function assertSafeTargetUrl(rawUrl, extraForbiddenHosts = []) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Target API URL is required (--url <url> or LOADTEST_API_URL).');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid target API URL.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Target API URL must not embed credentials.');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(host))) {
    throw new Error('Target API URL must use HTTPS (or HTTP strictly on loopback for local testing).');
  }
  const forbidden = loadForbiddenProductionHosts();
  for (const h of extraForbiddenHosts) forbidden.add(String(h).toLowerCase());
  if (forbidden.has(host)) {
    throw new Error(`Refusing to target production host (${host}). Use the isolated loadtest API URL instead.`);
  }
  const basePath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${basePath}`;
}

/** Normalizes and validates a raw Bearer token string without echoing it in errors. */
export function validateAccessToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Access token is required (--token <jwt>, --token-file <path>, or LOADTEST_ACCESS_TOKEN).');
  }
  const cleaned = token.trim().replace(/^Bearer\s+/i, '');
  if (!cleaned || /[\s\x00-\x1f\x7f]/.test(cleaned)) {
    throw new Error('Access token contains whitespace or control characters.');
  }
  return cleaned;
}

/** Extracts an access token from capture-tokens JSON layouts without printing secret fields. */
export function extractTokenFromRecord(record, accountName = null) {
  if (!record || typeof record !== 'object') return null;
  if (Array.isArray(record)) {
    const match = accountName
      ? record.find(item => item?.username === accountName || item?.account === accountName)
      : record[0];
    return extractTokenFromRecord(match, null);
  }
  if (typeof record.access_token === 'string') return record.access_token;
  if (typeof record.accessToken === 'string') return record.accessToken;
  if (accountName && record[accountName]) return extractTokenFromRecord(record[accountName], null);
  if (record.tokens && typeof record.tokens === 'object') {
    if (accountName && typeof record.tokens[accountName] === 'string') return record.tokens[accountName];
    if (accountName && record.tokens[accountName]) return extractTokenFromRecord(record.tokens[accountName], null);
    const firstKey = Object.keys(record.tokens)[0];
    if (firstKey) {
      const val = record.tokens[firstKey];
      return typeof val === 'string' ? val : extractTokenFromRecord(val, null);
    }
  }
  const candidateKey = accountName || Object.keys(record).find(k => !['expiresAt', 'expires_at', 'instance'].includes(k));
  if (candidateKey && typeof record[candidateKey] === 'object') {
    return extractTokenFromRecord(record[candidateKey], null);
  }
  return null;
}

function formatFailureHint(status, jsonBody) {
  const code = jsonBody?.error?.code;
  if (status === 503 || code === 'COED_MAINTENANCE') {
    return 'Check that COED_API_MAINTENANCE=off on coed-api-loadtest Lambda.';
  }
  if (status === 401) {
    return 'Access token is invalid/expired, or JWT authorizer issuer/audience/scope does not match Cognito.';
  }
  if (status === 403) {
    return 'Cognito user sub may not be linked to an ACTIVE STUDENT in coed-loadtest-db.';
  }
  if (status === 409) {
    return 'Version conflict (409); ensure no other user or Locust worker is updating this account right now.';
  }
  return null;
}

async function timedJsonRequest(fetchImpl, url, { method = 'GET', headers = {}, body = undefined, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const rawText = await response.text();
    const durationMs = Number((performance.now() - startedAt).toFixed(1));
    let json = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }
    return { status: response.status, durationMs, json, rawText };
  } finally {
    clearTimeout(timer);
  }
}

function buildStepError(stepName, status, expectedStatus, res) {
  const errMsg = res.json?.error?.message || res.rawText.slice(0, 240) || '(empty response)';
  const errCode = res.json?.error?.code ? ` [${res.json.error.code}]` : '';
  const hint = formatFailureHint(status, res.json);
  return new Error(
    `Smoke step "${stepName}" failed: expected HTTP ${expectedStatus}, got ${status}${errCode} (${res.durationMs} ms) — ${errMsg}` +
    (hint ? ` | Hint: ${hint}` : '')
  );
}

/** Runs all 3 loadtest workflow checks (company list, company detail, and own plan GET + PATCH). */
export async function runSmoke(options, { fetchImpl = globalThis.fetch, uuid = randomUUID } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch implementation is unavailable in this Node runtime.');
  const baseUrl = assertSafeTargetUrl(options.url);
  const token = validateAccessToken(options.token);
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const queryText = options.q ?? '';
  const location = options.location ?? '';
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const notes = options.notes ?? 'loadtest 2026-11-18';

  const steps = [];

  // 1. Public company list (50% workload)
  const listParams = new URLSearchParams({
    q: String(queryText),
    location: String(location),
    page: String(page),
    pageSize: String(pageSize)
  });
  const listPath = `/api/directory/companies?${listParams.toString()}`;
  const listRes = await timedJsonRequest(fetchImpl, `${baseUrl}${listPath}`, { timeoutMs });
  if (listRes.status !== 200) throw buildStepError('list', listRes.status, 200, listRes);
  if (!Array.isArray(listRes.json?.data) || listRes.json.data.length === 0 || !listRes.json.data[0]?.id) {
    throw new Error(`Smoke step "list" returned 200 (${listRes.durationMs} ms) but had no companies to pick an ID from.`);
  }
  const companyId = listRes.json.data[0].id;
  const totalCompanies = listRes.json.pagination?.total ?? listRes.json.data.length;
  const loadtestCountInPage = listRes.json.data.filter(c => String(c.name || '').startsWith('LOADTEST')).length;
  steps.push({
    name: '1. List companies',
    method: 'GET',
    path: listPath,
    status: listRes.status,
    durationMs: listRes.durationMs,
    detail: `items=${listRes.json.data.length}, total=${totalCompanies}, loadtest_prefix=${loadtestCountInPage}`
  });

  // 2. Public company detail (30% workload)
  const detailPath = `/api/directory/companies/${encodeURIComponent(companyId)}`;
  const detailRes = await timedJsonRequest(fetchImpl, `${baseUrl}${detailPath}`, { timeoutMs });
  if (detailRes.status !== 200) throw buildStepError('detail', detailRes.status, 200, detailRes);
  if (detailRes.json?.data?.id !== companyId) {
    throw new Error(`Smoke step "detail" returned mismatched company id (${detailRes.json?.data?.id}).`);
  }
  steps.push({
    name: '2. Company detail',
    method: 'GET',
    path: detailPath,
    status: detailRes.status,
    durationMs: detailRes.durationMs,
    detail: `name=${detailRes.json.data.name || '(unnamed)'}`
  });

  // 3a. Authenticated own plans list (before PATCH)
  const authHeaders = { Authorization: `Bearer ${token}` };
  const plansPath = '/api/v3/plans';
  const plansRes = await timedJsonRequest(fetchImpl, `${baseUrl}${plansPath}`, {
    headers: authHeaders,
    timeoutMs
  });
  if (plansRes.status !== 200) throw buildStepError('plans_get', plansRes.status, 200, plansRes);
  const plans = Array.isArray(plansRes.json?.data) ? plansRes.json.data : [];
  const editable = plans.find(p => EDITABLE_PLAN_STATES.has(p?.status));
  if (!editable || !editable.id || !Number.isInteger(editable.version)) {
    throw new Error(
      `Smoke step "plans_get" succeeded (200), but no editable DRAFT/NEEDS_REVISION plan exists for this user (found ${plans.length} plan(s)).`
    );
  }
  steps.push({
    name: '3a. GET own plan',
    method: 'GET',
    path: plansPath,
    status: plansRes.status,
    durationMs: plansRes.durationMs,
    detail: `plan_id=${editable.id}, status=${editable.status}, version=${editable.version}`
  });

  // 3b. Authenticated draft plan PATCH (20% workload)
  const patchPath = `/api/v3/plans/${encodeURIComponent(editable.id)}`;
  const patchRes = await timedJsonRequest(fetchImpl, `${baseUrl}${patchPath}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: {
      notes,
      expected_version: editable.version,
      operation_id: uuid()
    },
    timeoutMs
  });
  if (patchRes.status !== 200) throw buildStepError('plans_patch', patchRes.status, 200, patchRes);
  const newVersion = patchRes.json?.data?.version;
  if (patchRes.json?.data?.id !== editable.id || newVersion !== editable.version + 1) {
    throw new Error(
      `Smoke step "plans_patch" returned unexpected version: expected ${editable.version + 1}, got ${newVersion}.`
    );
  }
  steps.push({
    name: '3b. PATCH own plan',
    method: 'PATCH',
    path: patchPath,
    status: patchRes.status,
    durationMs: patchRes.durationMs,
    detail: `version ${editable.version} -> ${newVersion}`
  });

  return {
    ok: true,
    targetHost: new URL(baseUrl).host,
    totalCompanies,
    loadtestCountInPage,
    selectedCompanyId: companyId,
    planId: editable.id,
    previousVersion: editable.version,
    newVersion,
    steps
  };
}

/** Parses CLI flags, positional arguments (<url> <token>), and environment variables cleanly. */
export async function parseCliOptions(argv, env = process.env) {
  const opts = {
    url: env.LOADTEST_API_URL || '',
    token: env.LOADTEST_ACCESS_TOKEN || '',
    tokenFile: null,
    account: null,
    q: '',
    location: '',
    page: 1,
    pageSize: 20,
    notes: 'loadtest 2026-11-18',
    timeoutMs: 15000,
    help: false
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--url' || arg === '-u') opts.url = argv[++i] || '';
    else if (arg === '--token' || arg === '-t') opts.token = argv[++i] || '';
    else if (arg === '--token-file') opts.tokenFile = argv[++i] || '';
    else if (arg === '--account') opts.account = argv[++i] || '';
    else if (arg === '--q') opts.q = argv[++i] ?? '';
    else if (arg === '--location') opts.location = argv[++i] ?? '';
    else if (arg === '--page') opts.page = Number(argv[++i]);
    else if (arg === '--page-size') opts.pageSize = Number(argv[++i]);
    else if (arg === '--notes') opts.notes = argv[++i] ?? '';
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (!opts.url && positional[0]) opts.url = positional[0];
  if (!opts.token && !opts.tokenFile && positional[1]) opts.token = positional[1];

  if (!opts.help && !opts.token && opts.tokenFile) {
    let raw;
    try {
      raw = JSON.parse(await readFile(resolve(opts.tokenFile), 'utf8'));
    } catch {
      throw new Error(`Unable to read or parse JSON token file: ${opts.tokenFile}`);
    }
    const extracted = extractTokenFromRecord(raw, opts.account);
    if (!extracted) {
      throw new Error(
        `No access_token found in ${opts.tokenFile}. Pass --token <access_token> directly if the file only holds refresh tokens.`
      );
    }
    opts.token = extracted;
  }
  return opts;
}

function formatReport(report) {
  const lines = [`CO-ED Loadtest Smoke Check — Target: ${report.targetHost}`, ''];
  for (const s of report.steps) {
    lines.push(`[PASS] ${s.name.padEnd(20)} HTTP ${s.status}  ${String(s.durationMs).padStart(7)} ms  (${s.method} ${s.path}) — ${s.detail}`);
  }
  const totalMs = Number(report.steps.reduce((sum, s) => sum + s.durationMs, 0).toFixed(1));
  lines.push('');
  if (report.totalCompanies < 300 || report.totalCompanies > 500) {
    lines.push(`[WARN] Directory total is ${report.totalCompanies} (expected 300-500 synthetic companies).`);
  }
  if (report.loadtestCountInPage === 0) {
    lines.push('[WARN] No company name starting with "LOADTEST" appeared on the first page.');
  }
  lines.push(`Overall: PASS (all 3 actions returned 200 OK; combined request time ${totalMs} ms)`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = await parseCliOptions(process.argv.slice(2));
    if (opts.help) {
      console.log(`Usage:
  node scripts/loadtest/smoke.mjs --url <LOADTEST_API_URL> --token <ACCESS_TOKEN>
  node scripts/loadtest/smoke.mjs <LOADTEST_API_URL> <ACCESS_TOKEN>

Environment fallback:
  LOADTEST_API_URL, LOADTEST_ACCESS_TOKEN

Options:
  -u, --url <url>          Isolated loadtest API base URL (production URLs are blocked)
  -t, --token <jwt>        Cognito access token for a linked test STUDENT account
  --token-file <path>      Optional JSON file containing access_token
  --account <name>         Optional account key when reading --token-file
  --q <text>               Search query for directory list (default: "")
  --location <province>    Location filter for directory list (default: "")
  --page <n>               Page number (default: 1)
  --page-size <n>          Page size 1..100 (default: 20)
  --notes <text>           Draft notes value for PATCH /api/v3/plans/{id}
  --timeout-ms <ms>        Per-request timeout in milliseconds (default: 15000)`);
      process.exit(0);
    }
    const report = await runSmoke(opts);
    console.log(formatReport(report));
  } catch (error) {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  }
}
