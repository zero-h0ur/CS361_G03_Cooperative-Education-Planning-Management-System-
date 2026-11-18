import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { localTarget } from '../scripts/loadtest/database.mjs';
import { assertEmpty, runSchema, verifyCatalog } from '../scripts/loadtest/b2-bootstrap.mjs';
import { readReviewedMigrations } from '../scripts/operations/reviewed-migrations.mjs';
const url = process.env.LOADTEST_PREP_TEST_DATABASE_URL;
localTarget(url);
const client = new pg.Client({ connectionString: url });
const payload = { migrations: readReviewedMigrations().map(({ name, checksum, sql }) => ({ name, checksum, sql })),
  grants: readFileSync(new URL('../scripts/loadtest/runtime-grants.sql', import.meta.url), 'utf8') };
test.before(async () => { await client.connect(); });
test.after(async () => { await client.end(); });
test('B2 rollback-only trial leaves schema and runtime role absent', async () => {
  const result = await runSchema(client, payload, 'a'.repeat(64), false);
  assert.equal(result.committed, false); assert.equal(result.businessRows, 0);
  await assertEmpty(client);
});
test('B2 refuses a foreign table without changing it', async () => {
  await client.query('CREATE TABLE public.foreign_fixture(id int); INSERT INTO public.foreign_fixture VALUES(7)');
  try {
    await assert.rejects(runSchema(client, payload, 'a'.repeat(64), true), /B2_NONEMPTY_TARGET/);
    assert.equal((await client.query('SELECT id FROM public.foreign_fixture')).rows[0].id, 7);
  } finally { await client.query('DROP TABLE public.foreign_fixture'); }
});
test('B2 SQL failure rolls back all DDL without disabling triggers', async () => {
  await assert.rejects(runSchema(client, { ...payload, grants: 'SELECT missing_b2_fixture_function()' }, 'a'.repeat(64), true));
  await assertEmpty(client);
});
test('B2 creates reviewed schema and limited role without inserting business records', async () => {
  const result = await runSchema(client, payload, 'a'.repeat(64), true);
  assert.equal(result.committed, true); assert.equal(result.migrationCount, 17); assert.equal(result.businessRows, 0);
  assert.equal((await verifyCatalog(client, payload)).runtimePrivilegeChecks, true);
  await assert.rejects(runSchema(client, payload, 'a'.repeat(64), true), /B2_NONEMPTY_TARGET/);
});
test('B2 runtime can read required tables but cannot DDL or change identities/audit history', async () => {
  await client.query('BEGIN; SET LOCAL ROLE coed_app');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.companies')).rows[0].n, 0);
  const result = (await client.query(`SELECT has_table_privilege(current_user,'public.plans','INSERT,UPDATE') AS writes,
    has_table_privilege(current_user,'public.audit_events','INSERT') AS append,
    has_schema_privilege(current_user,'public','CREATE') AS ddl,
    has_table_privilege(current_user,'public.audit_events','DELETE') AS delete_audit,
    has_column_privilege(current_user,'public.users','role','UPDATE') AS roles`)).rows[0];
  assert.deepEqual(result, { writes: true, append: true, ddl: false, delete_audit: false, roles: false });
  await assert.rejects(client.query('CREATE TABLE public.must_not_create(id int)'), e => e.code === '42501');
  await client.query('ROLLBACK');
});
