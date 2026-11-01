import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig, root } from '../scripts/local-dev/config.mjs';
import { id, personas } from '../scripts/local-dev/fixtures.mjs';
import { startLocalApi } from '../scripts/local-dev/api.mjs';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');

test('local commands pin loopback targets and reject deployed environments', () => {
  assert.equal(new URL(localConfig({ DATABASE_URL: 'postgres://example.invalid/real' }).adminUrl).hostname, '127.0.0.1');
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'staging' }, { AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' },
    { LAMBDA_TASK_ROOT: '/var/task' }, { CO_ED_LOCAL_DB_PORT: '5432;bad' }]) {
    assert.throws(() => localConfig(env));
  }
  assert.equal(new Set(personas.map(p => p.userId)).size, 8);
});

test('team local setup, signed identities, full selection flow and repeatable reset',
  { skip: process.env.CO_ED_LOCAL_DEV_TESTS !== '1', timeout: 60000 }, async t => {
    const setup = () => {
      const result = spawnSync(process.execPath, ['scripts/local-dev/setup.mjs', '--reset'], { cwd: root, encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'development' } });
      assert.equal(result.status, 0, result.stderr);
    };
    setup();
    const api = await startLocalApi({ port: 0 });
    const tokens = api.tokens().tokens;
    const db = new Pool({ connectionString: localConfig().adminUrl });
    const request = async (persona, path, body, extraHeaders = {}) => {
      const response = await fetch(api.baseUrl + path, {
        method: body ? 'POST' : 'GET', headers: {
          ...(persona ? { Authorization: `Bearer ${tokens[persona]}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders
        }, ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      await t.test('loopback server accepts all eight signed personas and resolves roles from DB', async () => {
        assert.equal(api.server.address().address, '127.0.0.1');
        for (const p of personas) {
          const r = await request(p.name, '/api/v3/me');
          assert.equal(r.status, 200);
          assert.equal(r.body.data.role, p.role);
        }
      });
      await t.test('unsigned, anonymous and spoofed cross-role calls remain denied', async () => {
        assert.equal((await request(null, '/api/v3/me')).status, 401);
        assert.equal((await request(null, '/api/v3/me', null, { Authorization: 'Bearer unsigned.local.token' })).status, 401);
        assert.equal((await request('student01', '/api/v3/coordinator/applications', null, { 'x-role': 'COORDINATOR' })).status, 403);
        assert.equal((await request('committee01', '/api/v3/coordinator/applications')).status, 403);
      });
      await t.test('Student sees the private local cycle and submits a draft under the real runtime ACL', async () => {
        const cycles = await request('student01', '/api/v3/plan-options/cycles');
        assert.equal(cycles.status, 200);
        assert.ok(JSON.stringify(cycles.body.data).includes(id(100)));
        const submit = await request('student01', `/api/v3/plans/${id(400)}/submit`, { expected_version: 1, operation_id: randomUUID() });
        assert.equal(submit.status, 200, JSON.stringify(submit.body));
        assert.equal(submit.body.data.status, 'SUBMITTED');
      });
      await t.test('Coordinator receives the application and each Committee records an independent opinion', async () => {
        const ack = await request('coordinator01', `/api/v3/coordinator/plans/${id(400)}/acknowledge`,
          { expected_version: 2, operation_id: randomUUID() });
        assert.equal(ack.status, 200, JSON.stringify(ack.body));
        for (const name of ['committee01', 'committee02', 'committee03']) {
          const r = await request(name, `/api/v3/committee/plans/${id(400)}/opinion`,
            { expected_version: 2, operation_id: randomUUID(), selected: true, comment: 'Synthetic local test opinion' });
          assert.equal(r.status, 200, JSON.stringify(r.body));
        }
        const student = await request('student01', `/api/v3/plans/${id(400)}/selection`);
        assert.equal(student.body.data.opinion_count, 3);
        assert.equal(student.body.data.state, 'SELECTION_COMPLETE_PENDING_ANNOUNCEMENT');
        assert.equal(student.body.data.announcement_available, false);
      });
      await t.test('runtime cannot change roles; reset removes selection data and restores immutable guards', async () => {
        const runtime = new Pool({ connectionString: localConfig().runtimeUrl });
        try { await assert.rejects(runtime.query("UPDATE users SET role='ADMIN' WHERE false"), e => e.code === '42501'); }
        finally { await runtime.end(); }
        setup();
        assert.equal((await db.query('SELECT count(*)::int AS n FROM selection_opinions')).rows[0].n, 0);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM selection_cohorts')).rows[0].n, 1);
        assert.equal((await db.query('SELECT status FROM plans WHERE id=$1', [id(400)])).rows[0].status, 'DRAFT');
        const guards = await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgname IN
          ('selection_receipts_immutable','selection_opinions_immutable')`);
        assert.deepEqual(guards.rows.map(r => r.tgenabled), ['O', 'O']);
      });
      await t.test('production entry points do not import local keys, fixtures or local authentication', async () => {
        for (const file of ['src/lambda.js', 'src/server.js', 'scripts/build-frontend.mjs', 'scripts/package-lambda.mjs']) {
          assert.doesNotMatch(await readFile(new URL('../' + file, import.meta.url), 'utf8'), /local-dev|coed-local\.example\.invalid|allowBearerFallback:\s*true/);
        }
      });
    } finally { await api.close(); await db.end(); }
  });
