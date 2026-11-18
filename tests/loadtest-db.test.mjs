import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { localTarget, prepareLocal, fixtureId } from '../scripts/loadtest/database.mjs';
import { loadtestFixture } from './helpers/loadtest-fixture.mjs';
import lambda from '../src/lambda.js';
import validatorModule from '../src/auth/token-validator.js';
import identityModule from '../src/auth/identity-resolver.js';
import authorizationModule from '../src/api/services/authorization-service.js';

// No skip: invoking this suite requires its own empty, disposable loopback DB.
const connectionString = process.env.LOADTEST_PREP_TEST_DATABASE_URL;
localTarget(connectionString);
const admin = new pg.Pool({ connectionString, max: 2 });
const runtimeUrl = new URL(connectionString); runtimeUrl.username = 'coed_app'; runtimeUrl.password = '';
const runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 4 });
const input = loadtestFixture();
const prepare = (command, patch = {}) => prepareLocal({ connectionString, ...input, command, ...patch });
const id = key => fixtureId(input.manifest.run_id, key);
let handler;
const claims = alias => ({ iss: input.manifest.issuer, sub: input.manifest.accounts.find(a => a.alias === alias).subject,
  client_id: 'loadtest-local-only', token_use: 'access', scope: 'openid coed-api/access', exp: Math.floor(Date.now() / 1000) + 600 });
async function request(method, path, body, alias = 'loadtest01', overrides = {}) {
  const [rawPath, rawQueryString = ''] = path.split('?');
  const result = await handler({ version: '2.0', rawPath, rawQueryString,
    headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method }, ...(alias ? { authorizer: { jwt: { claims: { ...claims(alias), ...overrides }, scopes: ['coed-api/access'] } } } : {}) } });
  return { status: result.statusCode, body: JSON.parse(result.body) };
}
async function counts() {
  return (await admin.query('SELECT (SELECT count(*)::int FROM plans) AS plans,(SELECT count(*)::int FROM plan_operations) AS operations,(SELECT count(*)::int FROM audit_events) AS audit')).rows[0];
}
test.after(async () => { await runtime.end(); await admin.end(); });

test('foreign existing table is preserved and bootstrap refuses it', async () => {
  await admin.query('CREATE TABLE public.loadtest_foreign_guard_fixture(id int); INSERT INTO public.loadtest_foreign_guard_fixture VALUES(123)');
  try {
    await assert.rejects(prepare('trial'), /NONEMPTY_TARGET_REJECTED/);
    assert.equal((await admin.query('SELECT id FROM public.loadtest_foreign_guard_fixture')).rows[0].id, 123);
  } finally { await admin.query('DROP TABLE public.loadtest_foreign_guard_fixture'); }
});
test('trial rolls back all fresh migrations, fixtures and runtime role', async () => {
  const result = await prepare('trial');
  assert.equal(result.status, 'LOCAL_TRIAL_ROLLED_BACK');
  assert.equal(result.committed, false); assert.equal(result.companyCount, 400);
  assert.equal((await admin.query("SELECT to_regclass('public.users') AS relation")).rows[0].relation, null);
  assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'")).rowCount, 0);
});
test('bootstrap refuses an existing cluster role rather than changing its privileges', async () => {
  await admin.query('CREATE ROLE coed_app NOLOGIN');
  try {
    await assert.rejects(prepare('trial'), /EXISTING_RUNTIME_ROLE_REJECTED/);
    assert.equal((await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='coed_app'")).rows[0].rolcanlogin, false);
  } finally { await admin.query('DROP ROLE coed_app'); }
});
test('apply commits fresh schema, ten exact synthetic links/Drafts and 400 companies; rerun is non-destructive', async () => {
  const result = await prepare('apply');
  assert.equal(result.status, 'LOCAL_PREPARED'); assert.equal(result.idempotentReplay, false);
  assert.deepEqual(result.counts, { users: 10, students: 10, links: 10, plans: 10, rounds: 1 });
  assert.equal((await prepare('apply')).idempotentReplay, true);
  assert.equal((await prepare('check')).committed, false);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM companies WHERE visibility='public' AND data_status='mock'")).rows[0].n, 400);
  handler = lambda.createLambdaHandler({ authOptions: { pool: runtime,
    identityResolver: new identityModule.IdentityResolver({ pool: runtime }),
    tokenValidator: new validatorModule.TokenValidator({ expectedIssuer: input.manifest.issuer, expectedClientId: 'loadtest-local-only' }),
    authorizationService: new authorizationModule.AuthorizationService({ pool: runtime }) } });
});
test('different binding/run manifest is rejected without modifying existing data', async () => {
  const manifest = structuredClone(input.manifest);
  manifest.accounts[0].subject = '99000000-0000-4000-8000-000000000099';
  const before = await counts();
  await assert.rejects(prepare('apply', { manifest }), /PREPARATION_DRIFT/);
  assert.deepEqual(await counts(), before);
});
test('runtime is not migration owner, cannot rebind identities or rewrite audit', async () => {
  for (const query of ['CREATE TABLE public.forbidden_fixture(id int)', "UPDATE users SET role='ADMIN'",
    'INSERT INTO users(id,role) VALUES(gen_random_uuid(),\'ADMIN\')', 'DELETE FROM external_identity_links',
    'DELETE FROM audit_events', 'DELETE FROM plan_operations', 'UPDATE schema_migrations SET checksum=checksum']) {
    await assert.rejects(runtime.query(query), error => error.code === '42501');
  }
});
test('check detects broadened runtime permissions and role membership, never repairs them silently', async () => {
  await admin.query('GRANT INSERT ON public.users TO coed_app');
  try {
    await assert.rejects(prepare('check'), /RUNTIME_PRIVILEGE_DRIFT/);
    assert.equal((await admin.query("SELECT has_table_privilege('coed_app','public.users','INSERT') AS allowed")).rows[0].allowed, true);
  } finally { await admin.query('REVOKE INSERT ON public.users FROM coed_app'); }
  await admin.query('CREATE ROLE coed_loadtest_membership_fixture NOLOGIN; GRANT coed_loadtest_membership_fixture TO coed_app');
  try { await assert.rejects(prepare('check'), /RUNTIME_PRIVILEGE_DRIFT/); }
  finally { await admin.query('REVOKE coed_loadtest_membership_fixture FROM coed_app; DROP ROLE coed_loadtest_membership_fixture'); }
});
test('check rejects foreign populated tables without deleting the foreign rows', async () => {
  await admin.query('CREATE TABLE public.loadtest_foreign_guard_fixture(id int); INSERT INTO public.loadtest_foreign_guard_fixture VALUES(123)');
  try {
    await assert.rejects(prepare('check'), /FOREIGN_RECORDS_REJECTED/);
    assert.equal((await admin.query('SELECT id FROM public.loadtest_foreign_guard_fixture')).rows[0].id, 123);
  } finally { await admin.query('DROP TABLE public.loadtest_foreign_guard_fixture'); }
});
test('public list/detail and all ten exact Students read only their own Draft', async () => {
  const list = await request('GET', '/api/directory/companies?q=&location=&page=1&pageSize=20', undefined, null);
  assert.equal(list.status, 200); assert.equal(list.body.data.length, 20);
  assert.equal(list.body.pagination.total, 400);
  const detail = await request('GET', `/api/directory/companies/${list.body.data[0].id}`, undefined, null);
  assert.equal(detail.status, 200); assert.equal(detail.body.data.id, list.body.data[0].id);
  for (const account of input.manifest.accounts) {
    const own = await request('GET', '/api/v3/plans', undefined, account.alias);
    assert.equal(own.status, 200); assert.equal(own.body.data.length, 1);
    assert.equal(own.body.data[0].id, id(`${account.alias}:plan`));
  }
  assert.equal((await request('GET', '/api/v3/plans', undefined, null)).status, 401);
  assert.equal((await request('GET', '/api/v3/plans', undefined, 'loadtest01', { sub: '99000000-0000-4000-8000-000000000099' })).status, 403);
});
test('PATCH commits version, operation receipt and audit together; replay/stale/foreign ownership stay enforced', async () => {
  const planId = id('loadtest01:plan'), operationId = randomUUID();
  const patch = { notes: 'LOADTEST class write', expected_version: 1, operation_id: operationId };
  const updated = await request('PATCH', `/api/v3/plans/${planId}`, patch);
  assert.equal(updated.status, 200); assert.equal(updated.body.data.version, 2);
  assert.deepEqual((await request('PATCH', `/api/v3/plans/${planId}`, patch)).body, updated.body);
  assert.deepEqual(await counts(), { plans: 10, operations: 1, audit: 1 });
  assert.equal((await request('PATCH', `/api/v3/plans/${planId}`, { ...patch, operation_id: randomUUID() })).status, 409);
  assert.equal((await request('PATCH', `/api/v3/plans/${id('loadtest02:plan')}`, { ...patch, operation_id: randomUUID() })).status, 403);
  const matching = await admin.query('SELECT count(*)::int AS n FROM plan_operations p JOIN audit_events a ON a.operation_id=p.operation_id WHERE p.operation_id=$1', [operationId]);
  assert.equal(matching.rows[0].n, 1);
});
test('competing writes keep exactly one success and one version conflict', async () => {
  const results = await Promise.all([1, 2].map(i => request('PATCH', `/api/v3/plans/${id('loadtest01:plan')}`,
    { notes: `LOADTEST competing ${i}`, expected_version: 2, operation_id: randomUUID() })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(await counts(), { plans: 10, operations: 2, audit: 2 });
});
test('audit failure rolls back content, version and operation receipt without disabling audit', async () => {
  const before = await counts();
  await admin.query(`CREATE FUNCTION public.loadtest_reject_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
    CREATE TRIGGER loadtest_reject_audit_fixture BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION public.loadtest_reject_audit_fixture()`);
  try {
    const result = await request('PATCH', `/api/v3/plans/${id('loadtest01:plan')}`,
      { notes: 'LOADTEST must rollback', expected_version: 3, operation_id: randomUUID() });
    assert.equal(result.status, 500); assert.deepEqual(await counts(), before);
    assert.equal((await admin.query('SELECT version FROM plans WHERE id=$1', [id('loadtest01:plan')])).rows[0].version, 3);
  } finally {
    await admin.query('DROP TRIGGER loadtest_reject_audit_fixture ON public.audit_events; DROP FUNCTION public.loadtest_reject_audit_fixture()');
  }
  assert.equal((await prepare('check')).status, 'LOCAL_VERIFIED');
});
