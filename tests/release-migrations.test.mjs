import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readReviewedMigrations, REVIEWED_MIGRATIONS, normalizeReviewedMigrationLineEndings } from '../scripts/operations/reviewed-migrations.mjs';
import { workflowMigrationSQL, assertExternalReleaseDirectory } from '../scripts/operations/prepare-workflow-release.mjs';
import { fileURLToPath } from 'node:url';
import migrationTestHelpers from './helpers/reviewed-migrations.js';

test('CommonJS migration expectations include every checksum-verified name and exact checksum', () => {
  assert.deepEqual(migrationTestHelpers.readReviewedMigrationRows(),
    readReviewedMigrations().map(({ name, checksum }) => ({ version: name, checksum })));
});

test('reviewed migration hashes equal exact committed LF bytes, including 011', () => {
  const migrations = readReviewedMigrations();
  assert.ok(migrations.some(row => row.name === '011_student_contact_email.sql'));
  assert.ok(migrations.some(row => row.name === '012_committee_workspace.sql'));
  assert.ok(migrations.some(row => row.name === '013_coordinator_workspace.sql'));
  assert.ok(migrations.some(row => row.name === '014_phase1_schedules_and_confirmations.sql'));
  for (const row of migrations) {
    assert.equal(row.bytes.includes(13), false);
    const committed = execFileSync('git', ['show', `HEAD:src/db/migrations/${row.name}`]);
    assert.deepEqual(row.bytes, committed);
    assert.equal(row.checksum, createHash('sha256').update(committed).digest('hex'));
  }
  const sql = workflowMigrationSQL();
  for (const [name, hash] of REVIEWED_MIGRATIONS) assert.ok(sql.includes(`('${name}','${hash}')`));
  assert.match(sql, /m\.checksum IS DISTINCT FROM e\.checksum/);
  assert.match(sql, /ROLLBACK;/);
  assert.doesNotMatch(sql, /UPDATE\s+(?:public\.)?schema_migrations\s+SET\s+checksum/i);
});

test('workflow SQL count guard and report match the checksum-verified migration set', () => {
  const migrations = readReviewedMigrations();
  const sql = workflowMigrationSQL();
  const guard = sql.match(/IF \(SELECT count\(\*\) FROM public\.schema_migrations\)<>\s*(\d+) THEN RAISE EXCEPTION 'Incomplete schema'/);
  const report = sql.match(/SELECT json_build_object\('Migrations',\s*(\d+),/);
  assert.ok(guard, 'Keep the post-migration completeness guard.');
  assert.ok(report, 'Keep the migration count in the operator result.');
  assert.equal(Number(guard[1]), migrations.length, 'Schema guard must follow reviewed migrations.');
  assert.equal(Number(report[1]), migrations.length, 'Operator report must follow reviewed migrations.');
});

for (const scenario of ['CRLF', 'mutated SQL', 'BOM', 'missing', 'unknown']) {
  test(`release rejects ${scenario} without altering the input`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'coed-migration-guard-'));
    try {
      const rows = readReviewedMigrations();
      for (const row of rows) writeFileSync(join(directory, row.name), row.bytes);
      const selected = join(directory, rows[0].name);
      if (scenario === 'CRLF') writeFileSync(selected, rows[0].sql.replaceAll('\n', '\r\n'));
      if (scenario === 'mutated SQL') writeFileSync(selected, rows[0].sql + '\nSELECT 42;\n');
      if (scenario === 'BOM') writeFileSync(selected, '\ufeff' + rows[0].sql);
      if (scenario === 'missing') rmSync(selected);
      if (scenario === 'unknown') writeFileSync(join(directory, '011_unknown.sql'), 'SELECT 1;\n');
      const before = scenario === 'missing' ? null : readFileSync(selected);
      assert.throws(() => readReviewedMigrations(directory), /LF bytes|checksum mismatch|allowlist/);
      if (before) assert.deepEqual(readFileSync(selected), before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('strict final release rejects output within the checkout on Windows and POSIX', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  assert.throws(() => assertExternalReleaseDirectory(root), /outside the checkout/);
  assert.throws(() => assertExternalReleaseDirectory(join(root, 'tmp', 'release')), /outside the checkout/);
  assert.doesNotThrow(() => assertExternalReleaseDirectory(join(tmpdir(), 'coed-reviewed-final-release')));
});

test('explicit EOL formatter restores only reviewed bytes and validates all files before writing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coed-eol-format-'));
  try {
    const rows = readReviewedMigrations();
    for (const row of rows) writeFileSync(join(directory, row.name), row.sql.replaceAll('\n', '\r\n'));
    const last = join(directory, rows.at(-1).name);
    writeFileSync(last, rows.at(-1).sql + '\nSELECT 42;\n');
    const firstBefore = readFileSync(join(directory, rows[0].name));
    assert.throws(() => normalizeReviewedMigrationLineEndings(directory), /Refusing to format changed SQL/);
    assert.deepEqual(readFileSync(join(directory, rows[0].name)), firstBefore);
    writeFileSync(last, rows.at(-1).sql.replaceAll('\n', '\r\n'));
    assert.equal(normalizeReviewedMigrationLineEndings(directory).length, rows.length);
    assert.deepEqual(readReviewedMigrations(directory).map(row => row.checksum), rows.map(row => row.checksum));
    assert.deepEqual(normalizeReviewedMigrationLineEndings(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
