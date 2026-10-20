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

async function runImport(input, apply = false) {
  validatePayload(input);
  const body = buildImportSql(input).split('\\if :apply')[0]
    .split('\n').filter(line => !line.startsWith('\\')).join('\n') + (apply ? '\nCOMMIT;' : '\nROLLBACK;');
  const client = await pool.connect();
  try {
    await client.query("SET coed.allow_local_import = 'yes'");
    return await client.query(body);
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
