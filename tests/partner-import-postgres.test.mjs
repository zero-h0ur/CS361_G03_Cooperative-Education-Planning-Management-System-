import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import seedModule from '../src/db/seed.js';
import connection from '../src/db/connection.js';
import repositoryModule from '../src/db/repositories/directory-repository.js';
import dal from '../src/db/dal.js';
import { buildCatalogue, validatePayload } from '../scripts/import-companies-csv.mjs';
import { buildImportSql } from '../scripts/operations/partner-import-sql.mjs';

// This suite is destructive only inside the isolated local test database.
seedModule.assertDestructiveResetAllowed();
const target = new URL(process.env.TEST_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
assert.equal(process.env.NODE_ENV, 'test');
const pool = connection.getPool();
const sample = [
  'ลำดับ,ชื่อสถานประกอบการ/หน่วยงาน,ตำแหน่งงาน,จำนวนอัตรา,ช่องทางการติดต่อ,ระยะเวลา',
  '1,บริษัท Synthetic Partner จำกัด,"Developer, Tester",5,PRIVATE_CANARY,6 months',
  'Code,ชื่อสถานประกอบการ (ภาษาไทย),ที่ตั้ง',
  'C901,บริษัท Synthetic Partner จำกัด,นนทบุรี'
].join('\n');
const payload = process.env.COED_DIRECTORY_MANIFEST
  ? JSON.parse(fs.readFileSync(process.env.COED_DIRECTORY_MANIFEST, 'utf8'))
  : buildCatalogue(sample, { importedAt: '2026-10-21T00:00:00.000Z' });
validatePayload(payload);

async function runImport(input, apply = false, setup = null) {
  validatePayload(input);
  const body = buildImportSql(input).split('\\if :apply')[0]
    .split('\n').filter(line => !line.startsWith('\\')).join('\n') + (apply ? '\nCOMMIT;' : '\nROLLBACK;');
  const client = await pool.connect();
  try {
    await client.query("SET coed.allow_local_import = 'yes'");
    await client.query('BEGIN');
    if (setup) await setup(client);
    return await client.query(body.replace('BEGIN;', ''));
  } finally { await client.query('ROLLBACK'); client.release(); }
}
async function digest(tables) {
  const result = {};
  for (const table of tables) {
    const res = await pool.query(`SELECT count(*)::integer AS count,
      md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t`);
    result[table] = res.rows[0];
  }
  return result;
}

test.before(async () => { await seedModule.seed({ includeV3: true }); });
test.after(async () => { await connection.close(); });
test('dry run rolls back catalogue rows and preserves private records', async () => {
  const tables = ['companies', 'positions', 'plans', 'students', 'audit_events', 'plan_operations'];
  const before = await digest(tables);
  await runImport(payload);
  assert.deepEqual(await digest(tables), before);
});

test('import accepts the complete reviewed migration history 001 through 007', async () => {
  const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(rows.map(row => row.version), [
    '001_initial_schema.sql', '002_v3_identity_student_plan_assignment_audit.sql',
    '003_partner_directory.sql', '004_three_role_workflow.sql',
    '005_submission_snapshots.sql', '006_advisor_display_name.sql',
    '007_submission_policy_integrity.sql',
    '008_returned_plan_cancellation.sql',
  ]);
  await runImport(payload);
});

// Shadow history only in a transaction-local temporary table. Never alter the
// installed migration checksums, even inside this disposable test database.
async function shadowMigrationHistory(client) {
  const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
  await client.query('CREATE TEMP TABLE schema_migrations (version text, checksum text) ON COMMIT DROP');
  for (const row of rows) {
    await client.query('INSERT INTO pg_temp.schema_migrations VALUES ($1, $2)', [row.version, row.checksum]);
  }
}

test('import rejects altered checksums for every reviewed migration without changing stored history', async t => {
  const before = await digest(['schema_migrations', 'companies', 'positions', 'students', 'plans']);
  const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  for (const { version } of rows) {
    await t.test(version, async () => {
      await assert.rejects(runImport(payload, true, async client => {
        await shadowMigrationHistory(client);
        await client.query('UPDATE pg_temp.schema_migrations SET checksum = $1 WHERE version = $2', ['0'.repeat(64), version]);
      }), /Migration history differs from reviewed source/);
      assert.deepEqual(await digest(Object.keys(before)), before);
    });
  }
});

test('import rejects unknown migrations without changing stored history or catalogue rows', async () => {
  const before = await digest(['schema_migrations', 'companies', 'positions', 'students', 'plans']);
  await assert.rejects(runImport(payload, true, async client => {
    await shadowMigrationHistory(client);
    await client.query('INSERT INTO pg_temp.schema_migrations VALUES ($1, $2)', ['999_unreviewed.sql', 'a'.repeat(64)]);
  }), /Migration history differs from reviewed source/);
  assert.deepEqual(await digest(Object.keys(before)), before);
});
test('apply is idempotent, private records stay unchanged, and real positions never enter legacy public APIs', async () => {
  const privateTables = ['users', 'external_identity_links', 'students', 'plans', 'advisor_assignments',
    'staff_scopes', 'rounds', 'document_metadata', 'audit_events', 'plan_operations'];
  const before = await digest(privateTables);
  await runImport(payload, true);
  const applied = await digest(['companies', 'positions']);
  assert.deepEqual(await digest(privateTables), before);
  await runImport(payload, true);
  assert.deepEqual(await digest(['companies', 'positions']), applied);
  const repo = new repositoryModule.DirectoryRepository({ pool });
  const query = repositoryModule.parseDirectoryQuery(new URLSearchParams('pageSize=100'), false);
  const publicRows = await repo.list(query, false);
  assert.equal(publicRows.pagination.total, payload.companies.length);
  assert.ok(publicRows.items.every(c => !('positions' in c)));
  const companyId = payload.positions[0].company_id;
  assert.ok((await repo.detail(companyId, true)).positions.length > 0);
  assert.deepEqual(await dal.listPublicPositionsByCompany(companyId), []);
  await assert.rejects(dal.getPublicPositionById(payload.positions[0].id));
  const privateQuery = repositoryModule.parseDirectoryQuery(new URLSearchParams('role=Developer&pageSize=100'), true);
  const result = await repo.list(privateQuery, true);
  assert.ok(result.items.length > 0);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
});
test('collision with an existing legacy company rolls back the entire import', async () => {
  const legacy = await pool.query("SELECT id FROM companies WHERE catalog_key IS NULL ORDER BY id LIMIT 1");
  const collision = structuredClone(payload);
  collision.companies[0].id = legacy.rows[0].id;
  collision.positions = [];
  const before = await digest(['companies', 'positions', 'plans', 'audit_events']);
  await assert.rejects(runImport(collision, true), /collision/);
  assert.deepEqual(await digest(['companies', 'positions', 'plans', 'audit_events']), before);
});
