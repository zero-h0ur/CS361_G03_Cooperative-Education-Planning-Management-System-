import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listZipEntries, readZipEntry } from '../scripts/operations/zip-archive.mjs';
import { readReviewedMigrations } from '../scripts/operations/reviewed-migrations.mjs';

test('Lambda release is self-contained and preserves reviewed migrations without secrets', async () => {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const caFixture = await mkdtemp(join(tmpdir(), 'coed-v3-ca-test-'));
  const caFile = join(caFixture, 'global-bundle.pem');
  await writeFile(caFile, rootCertificates[0] + '\n');
  const manifest = JSON.parse(execFileSync(process.execPath, ['scripts/package-lambda.mjs'], {
    cwd: workspace, encoding: 'utf8', env: { ...process.env, COED_RDS_CA_FILE: caFile }
  }));
  const extracted = await mkdtemp(join(tmpdir(), 'coed-v3-package-test-'));
  try {
    const entries = listZipEntries(manifest.artifact);
    const migrations = readReviewedMigrations();
    assert.deepEqual(entries.sort(), ['src/lambda.js', 'src/db/migrate.js', 'global-bundle.pem',
      'src/db/verification/002_v3_forward_only_verification.sql',
      ...migrations.map(row => 'src/db/migrations/' + row.name)].sort());
    assert.ok(entries.includes('src/lambda.js'));
    assert.ok(entries.includes('src/db/migrate.js'));
    assert.ok(entries.includes('global-bundle.pem'));
    assert.ok(entries.every((entry) => entry.startsWith('src/') || entry === 'global-bundle.pem'));
    assert.ok(entries.every((entry) => !/(^|\/)(\.env[^/]*|\.aws|node_modules|data)(\/|$)/.test(entry)));
    assert.equal(createHash('sha256').update(await readFile(manifest.artifact)).digest('hex'), manifest.sha256);
    // Names are validated by listZipEntries and the exact allowlist above.
    for (const entry of entries) {
      await mkdir(dirname(join(extracted, entry)), { recursive: true });
      await writeFile(join(extracted, entry), readZipEntry(manifest.artifact, entry));
    }
    assert.deepEqual(await readFile(join(extracted, 'global-bundle.pem')), await readFile(caFile));
    for (const name of ['001_initial_schema.sql', '002_v3_identity_student_plan_assignment_audit.sql',
      '009_coordinator_committee_selection.sql','010_phase1_applications_documents.sql']) {
      assert.deepEqual(
        await readFile(join(extracted, 'src/db/migrations', name)),
        await readFile(join(workspace, 'src/db/migrations', name))
      );
    }
    // Run outside the checkout: no project node_modules or .env may be required.
    const output = execFileSync(process.execPath, ['-e', `
      const { handler } = require('./src/lambda.js');
      (async () => {
        const health = await handler({rawPath:'/api/health',requestContext:{http:{method:'GET'}}});
        const statuses = [health.statusCode];
        for (const rawPath of ['/api/v3/me', '/api/v4/application-options', '/api/v4/applications']) {
          const result = await handler({rawPath,requestContext:{http:{method:'GET'}}});
          statuses.push(result.statusCode);
        }
        console.log(JSON.stringify(statuses));
      })().catch(() => process.exit(1));
    `], { cwd: extracted, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.deepEqual(JSON.parse(output), [200, 401, 401, 401]);
  } finally {
    await rm(extracted, { recursive: true, force: true });
    await rm(dirname(manifest.artifact), { recursive: true, force: true });
    await rm(caFixture, { recursive: true, force: true });
  }
});

test('Lambda packaging refuses a missing CA or private-key-bearing input without exposing its content', async () => {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env };
  delete env.COED_RDS_CA_FILE;
  const missing = spawnSync(process.execPath, ['scripts/package-lambda.mjs'], { cwd: workspace, encoding: 'utf8', env });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /COED_RDS_CA_FILE must point/);
  const directory = await mkdtemp(join(tmpdir(), 'coed-invalid-ca-'));
  try {
    const path = join(directory, 'not-a-public-bundle.pem');
    await writeFile(path, rootCertificates[0] + '\n-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_KEY_CANARY\n-----END PRIVATE KEY-----\n');
    const invalid = spawnSync(process.execPath, ['scripts/package-lambda.mjs'], {
      cwd: workspace, encoding: 'utf8', env: { ...env, COED_RDS_CA_FILE: path }
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /only public PEM certificates/);
    assert.ok(!invalid.stderr.includes('SYNTHETIC_PRIVATE_KEY_CANARY'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
