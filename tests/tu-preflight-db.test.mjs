import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import reader from '../scripts/operations/tu-preflight/reader.js';
const {readMetadata}=reader;
test('fixed reader uses actual PostgreSQL read-only transaction and preserves synthetic records',
 {skip:process.env.COED_PREFLIGHT_DISPOSABLE_CONTAINER!=='true'},async()=>{
  const url=new URL(process.env.COED_PREFLIGHT_TEST_URL);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55440');assert.equal(url.pathname,'/coed');
  assert.equal(process.env.NODE_ENV,'test');
  const owner=new pg.Client({connectionString:url.href});await owner.connect();let runtime;
  try{
   assert.equal((await owner.query("SELECT to_regclass('public.users') IS NULL AS empty")).rows[0].empty,true,'Refuse a non-empty test database');
   await owner.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)');
   for(const m of readReviewedMigrations()){
    await owner.query(m.sql);
   }
   // Migration files do not record runner history when applied directly in this test.
   for(const m of readReviewedMigrations())await owner.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[m.name,m.checksum]);
   const password=randomBytes(20).toString('hex');
   await owner.query(`CREATE ROLE coed_app LOGIN PASSWORD '${password}'`);
   const grants=readFileSync(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8')
    .split('\n').filter(l=>!l.startsWith('\\')).join('\n');
   await owner.query(grants);
   await owner.query("INSERT INTO users(id,role) VALUES('90000000-0000-4000-8000-000000000001','STUDENT')");
   const before=(await owner.query('SELECT md5(string_agg(to_jsonb(u)::text,\'\' ORDER BY id)) AS fingerprint FROM users u')).rows[0].fingerprint;
   const runtimeUrl=new URL(url.href);runtimeUrl.username='coed_app';runtimeUrl.password=password;
   runtime=new pg.Client({connectionString:runtimeUrl.href});await runtime.connect();
   await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const result=await readMetadata(runtime,'schema');
   assert.equal(result.guards.read_only,true);assert.equal(result.migrations.length,15);assert.deepEqual(result.missingTables,[]);
   assert.equal(result.identity.status,'NOT_CHECKED');assert.ok(result.privileges.some(p=>p.role==='coed_app' && p.insert_table));
   assert.ok(!result.roles.some(r=>r.role==='coed_tu_login'));
   assert.ok(result.catalog.tables.length>30);assert.ok(result.catalog.constraints.length>30);
   assert.ok(result.catalog.indexes.length>30);assert.ok(result.catalog.routines.some(r=>r.name==='guard_phase1_delivery'));
   assert.ok(result.catalog.effective_columns.some(c=>c.role==='coed_app' && c.table_name==='phase1_submission_deliveries' && c.column_name==='submission_id' && c.can_insert));
   await assert.rejects(runtime.query("INSERT INTO users(id,role) VALUES('90000000-0000-4000-8000-000000000002','STUDENT')"),e=>e.code==='25006');
   await runtime.query('ROLLBACK');
   assert.equal((await owner.query('SELECT md5(string_agg(to_jsonb(u)::text,\'\' ORDER BY id)) AS fingerprint FROM users u')).rows[0].fingerprint,before);
  }finally{await runtime?.end();await owner.end();}
 });
