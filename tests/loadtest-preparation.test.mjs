import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateInputs, buildPlan, localTarget, prepareLocal } from '../scripts/loadtest/database.mjs';
import { loadtestFixture } from './helpers/loadtest-fixture.mjs';

const environment = { NODE_ENV: 'test', LOADTEST_PREP_DISPOSABLE: 'true' };
const local = 'postgres://postgres@127.0.0.1:54337/coed_loadtest_test';
test('accepts ten synthetic mappings and 300-500 companies, without credentials in the plan', () => {
  for (const count of [300, 400, 500]) {
    const { manifest, dataset } = loadtestFixture(count);
    const plan = buildPlan(manifest, dataset);
    assert.equal(plan.companyCount, count); assert.equal(plan.accountCount, 10);
    assert.equal(plan.remoteApplySupported, false); assert.equal(plan.cloudChanges, false);
    assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(plan).includes(manifest.accounts[0].subject));
    assert.ok(!JSON.stringify(plan).includes(manifest.issuer));
  }
});
test('fingerprint is stable across input object/array ordering and changes with a binding', () => {
  const { manifest, dataset } = loadtestFixture();
  const original = buildPlan(manifest, dataset);
  assert.equal(buildPlan({ ...manifest, accounts: [...manifest.accounts].reverse() },
    { ...dataset, companies: [...dataset.companies].reverse() }).fingerprint, original.fingerprint);
  manifest.accounts[0].subject = '99000000-0000-4000-8000-000000000099';
  assert.notEqual(buildPlan(manifest, dataset).fingerprint, original.fingerprint);
});
test('supports instructor minimum of five test accounts without changing the identity contract', () => {
  const { manifest, dataset } = loadtestFixture();
  manifest.accounts = manifest.accounts.slice(0, 5);
  assert.equal(buildPlan(manifest, dataset).accountCount, 5);
});
test('rejects untrusted manifest boundaries, duplicate identities and secret-shaped fields', async t => {
  const mutations = [
    m => { m.synthetic_only = false; }, m => { m.run_id = '../production'; },
    m => { m.aws_intent.rds_identifier = 'database-coed-postgres'; },
    m => { m.aws_intent.region = 'us-east-1'; }, m => { m.aws_intent.account_id = 'bad'; },
    m => { m.issuer += '/'; }, m => { m.issuer = 'https://example.invalid'; },
    m => { m.accounts[1].subject = m.accounts[0].subject; },
    m => { m.accounts[1].alias = m.accounts[0].alias; },
    m => { m.accounts[0].subject = "x'); DROP TABLE users;--"; },
    m => { m.accounts[0].password = 'SYNTHETIC-CANARY'; },
    m => { m.token = 'SYNTHETIC-CANARY'; }, m => { m.accounts = m.accounts.slice(0, 4); }
  ];
  for (const [i, mutate] of mutations.entries()) await t.test(`invalid input ${i + 1}`, () => {
    const { manifest, dataset } = loadtestFixture(); mutate(manifest);
    assert.throws(() => validateInputs(manifest, dataset));
  });
});
test('rejects dataset mismatches, real-looking contact data, duplicate rows and SQL injection', async t => {
  const mutations = [
    d => { d.synthetic_only = false; }, d => { d.run_id = 'lt-20261118-bbbbbbbb'; },
    d => { d.companies.pop(); d.companies.length = 299; },
    d => { d.companies[1].id = d.companies[0].id; },
    d => { d.companies[1].name = d.companies[0].name; },
    d => { d.companies[0].name = 'Actual retained company'; },
    d => { d.companies[0].name = "LOADTEST-'; DROP TABLE users;--"; },
    d => { d.companies[0].email = 'private@example.invalid'; },
    d => { d.companies[0].location = 'UNREVIEWED'; }
  ];
  for (const [i, mutate] of mutations.entries()) await t.test(`invalid dataset ${i + 1}`, () => {
    const { manifest, dataset } = loadtestFixture(); mutate(dataset);
    assert.throws(() => validateInputs(manifest, dataset));
  });
});
test('local target rejects every non-loopback/retained target before a socket opens', async t => {
  for (const target of [undefined, 'bad', 'postgres://x@coed-loadtest-db.fake.ap-southeast-2.rds.amazonaws.com/coed_loadtest_test',
    'postgres://x@127.0.0.1/coed_dev', 'postgres://x@127.0.0.1/production',
    `${local}?options=-csearch_path%3Dprivate`, `${local}#fragment`, 'postgres://x@127.0.0.1:80/coed_loadtest_test']) {
    await t.test(String(target), async () => {
      const { manifest, dataset } = loadtestFixture();
      await assert.rejects(prepareLocal({ connectionString: target, env: environment, manifest, dataset }), /LOCAL_TARGET_REJECTED/);
    });
  }
  assert.equal(localTarget(local, environment).hostname, '127.0.0.1');
});
test('requires explicit disposable test flags, rejects deployed environment/Secret', () => {
  for (const env of [{}, { ...environment, NODE_ENV: 'production' }, { ...environment, LOADTEST_PREP_DISPOSABLE: 'false' },
    { ...environment, AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' }, { ...environment, LAMBDA_TASK_ROOT: '/var/task' },
    { ...environment, DB_SECRET_ARN: 'synthetic-secret-canary' }]) {
    assert.throws(() => localTarget(local, env), /LOCAL_DISPOSABLE_REQUIRED/);
  }
});
test('CLI is offline by default and errors never echo private JSON fragments', () => {
  const tempRoot = new URL('../tmp/loadtest/', import.meta.url);
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(fileURLToPath(tempRoot), 'unit-'));
  const { manifest, dataset } = loadtestFixture();
  const m = join(dir, 'manifest.json'), d = join(dir, 'companies.json');
  writeFileSync(m, JSON.stringify(manifest)); writeFileSync(d, JSON.stringify(dataset));
  const invoke = (...args) => spawnSync(process.execPath, ['scripts/loadtest/prepare-db.mjs', ...args], { encoding: 'utf8' });
  const offline = invoke('plan', m, d);
  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).status, 'OFFLINE_PLAN_ONLY');
  assert.ok(!offline.stdout.includes(manifest.accounts[0].subject));
  writeFileSync(m, '{"password":"PRIVATE_CANARY_DO_NOT_PRINT",BROKEN');
  const bad = invoke('plan', m, d);
  assert.equal(bad.status, 1); assert.ok(!bad.stderr.includes('PRIVATE_CANARY_DO_NOT_PRINT'));
  assert.equal(JSON.parse(bad.stderr).code, 'INPUT_FILE_REJECTED');
  const remote = invoke('apply-aws', m, d);
  assert.equal(JSON.parse(remote.stderr).code, 'INVALID_ARGUMENTS');
});
test('tool does not reuse general reset/seed, disable triggers or import an AWS SDK', () => {
  const source = readFileSync(new URL('../scripts/loadtest/database.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:import|require).*\b(?:seed|migrate|@aws-sdk)\b/);
  assert.doesNotMatch(source, /DISABLE\s+TRIGGER|TRUNCATE\s|DROP\s+DATABASE|ALTER\s+ROLE/i);
});
test('native local runner rejects deployed mode or absent PostgreSQL before starting processes', () => {
  for (const [env, code] of [
    [{ ...process.env, NODE_ENV: 'production' }, 'LOCAL_RUNNER_REJECTED'],
    [{ ...process.env, NODE_ENV: 'test', LOADTEST_PG_BIN: '' }, 'SET_LOADTEST_PG_BIN_TO_INSTALLED_POSTGRESQL']
  ]) {
    delete env.AWS_EXECUTION_ENV; delete env.LAMBDA_TASK_ROOT;
    const result = spawnSync(process.execPath, ['scripts/loadtest/test-local.mjs'], { encoding: 'utf8', env });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).code, code);
  }
});
