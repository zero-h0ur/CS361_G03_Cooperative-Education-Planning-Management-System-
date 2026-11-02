import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readReviewedMigrations } from '../scripts/operations/reviewed-migrations.mjs';
import { buildCatalogue } from '../scripts/import-companies-csv.mjs';
import { buildImportSql } from '../scripts/operations/partner-import-sql.mjs';

test('release/import checks preserve stored LF history and reject tampering in an isolated PostgreSQL schema',
  { skip: !process.env.CO_ED_APPLICATION_TEST_DATABASE_URL && !process.env.CI }, async t => {
    const url = new URL(process.env.CO_ED_APPLICATION_TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.match(url.pathname, /^\/coed_(?:v4_application|v3)_test$/);
    assert.equal(process.env.NODE_ENV, 'test');
    const pool = new pg.Pool({ connectionString: url.href });
    const schema = 'release_' + randomUUID().replaceAll('-', '');
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}",public`);
      await client.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum char(64))');
      const migrations = readReviewedMigrations();
      for (const row of migrations) {
        await client.query(row.sql);
        await client.query('INSERT INTO schema_migrations VALUES($1,$2)', [row.name, row.checksum]);
      }
      // Non-empty private data, created only in this random test schema.
      const user = randomUUID();
      await client.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')", [user]);
      const before = (await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
      const privateBefore = (await client.query('SELECT to_jsonb(u) AS row FROM users u ORDER BY id')).rows;
      const payload = buildCatalogue([
        'ลำดับ,ชื่อสถานประกอบการ/หน่วยงาน,ตำแหน่งงาน,จำนวนอัตรา,ช่องทางการติดต่อ,ระยะเวลา',
        '1,บริษัท Synthetic Release จำกัด,Developer,2,SYNTHETIC_PRIVATE_CANARY,6 months',
        'Code,ชื่อสถานประกอบการ (ภาษาไทย),ที่ตั้ง',
        'C901,บริษัท Synthetic Release จำกัด,นนทบุรี'
      ].join('\n'), { importedAt: '2026-11-01T00:00:00.000Z' });
      const sql = buildImportSql(payload).split('\\if :apply')[0].split('\n')
        .filter(line => !line.startsWith('\\')).join('\n').replace(/^BEGIN;\r?$/m, '');
      const unchanged = async () => {
        assert.deepEqual((await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows, before);
        assert.deepEqual((await client.query('SELECT to_jsonb(u) AS row FROM users u ORDER BY id')).rows, privateBefore);
      };
      const run = async (tamper = null, apply = false) => {
        await client.query('BEGIN');
        try {
          await client.query("SET LOCAL coed.allow_local_import = 'yes'");
          if (tamper) {
            await client.query('CREATE TEMP TABLE schema_migrations ON COMMIT DROP AS SELECT * FROM schema_migrations');
            await tamper();
          }
          await client.query(sql);
          await client.query(apply ? 'COMMIT' : 'ROLLBACK');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      };
      await t.test('all reviewed checksums pass; apply/import remains idempotent', async () => {
        await run(null, true); await run(null, true);
        assert.equal((await client.query('SELECT count(*)::integer AS n FROM companies')).rows[0].n, 1);
        await unchanged();
      });
      for (const row of migrations) {
        await t.test(`rejects altered ${row.name} without changing stored history`, async () => {
          await assert.rejects(run(() => client.query('UPDATE pg_temp.schema_migrations SET checksum=$1 WHERE version=$2',
            ['0'.repeat(64), row.name])), /Migration history differs from reviewed source/);
          await unchanged();
        });
      }
      await t.test('unknown migration remains rejected', async () => {
        await assert.rejects(run(() => client.query('INSERT INTO pg_temp.schema_migrations VALUES($1,$2)',
          ['999_unknown.sql', 'a'.repeat(64)])), /Migration history differs from reviewed source/);
        await unchanged();
      });
    } finally {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      if (!/^release_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema cleanup');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release(); await pool.end();
    }
  });
