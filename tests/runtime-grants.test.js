const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const { seed } = require('../src/db/seed');
const { close } = require('../src/db/connection');

describe('V3 runtime ACL policy on isolated PostgreSQL', () => {
  let pool;
  const policy = readFileSync(resolve(__dirname, '../src/db/operations/v3-runtime-grants.sql'), 'utf8')
    .replace(/^\\set[^\n]*\n/m, '');
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL
        || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error('Runtime ACL tests require NODE_ENV=test and a distinct TEST_DATABASE_URL.');
    }
    await seed({ includeV3: true });
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='coed_app') THEN
        CREATE ROLE coed_app NOLOGIN;
      END IF;
    END $$`);
  });
  afterAll(async () => { await pool?.end(); await close(); });

  test('removes excess grants and is repeatable without deleting data', async () => {
    const before = await pool.query('SELECT count(*)::int AS n FROM audit_events');
    await pool.query('GRANT ALL ON audit_events, plan_operations, users, students TO coed_app');
    await pool.query(policy);
    await pool.query(policy);
    const { rows } = await pool.query(`SELECT
      has_table_privilege('coed_app','audit_events','INSERT') AS append,
      has_table_privilege('coed_app','audit_events','DELETE') AS delete,
      has_column_privilege('coed_app','users','role','UPDATE') AS role_update,
      has_column_privilege('coed_app','students','full_name','UPDATE') AS official_update`);
    expect(rows[0]).toEqual({ append: true, delete: false, role_update: false, official_update: false });
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows).toEqual(before.rows);
  });

  test('allows audited contact-command columns including the trigger users FOR UPDATE lock', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE coed_app');
      const result = await client.query(`UPDATE students SET contact_address='ACL regression',
        version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=(
          SELECT id FROM students WHERE user_id IS NOT NULL LIMIT 1) RETURNING id`);
      expect(result.rowCount).toBe(1);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  test('denies audit deletion, role changes and official-profile mutation at the database boundary', async () => {
    for (const sql of ['DELETE FROM audit_events WHERE false',
      "UPDATE users SET role='ADMIN' WHERE false", "UPDATE students SET full_name='changed' WHERE false"]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE coed_app');
        await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
  });
});
