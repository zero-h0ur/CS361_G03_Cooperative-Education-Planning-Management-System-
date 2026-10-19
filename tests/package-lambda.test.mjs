import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
    const entries = execFileSync('unzip', ['-Z1', manifest.artifact], { encoding: 'utf8' })
      .trim().split('\n');
    assert.ok(entries.includes('src/lambda.js'));
    assert.ok(entries.includes('src/db/migrate.js'));
    assert.ok(entries.includes('global-bundle.pem'));
    assert.ok(entries.every((entry) => entry.startsWith('src/') || entry === 'global-bundle.pem'));
    assert.ok(entries.every((entry) => !/(^|\/)(\.env[^/]*|\.aws|node_modules|data)(\/|$)/.test(entry)));
    assert.equal(createHash('sha256').update(await readFile(manifest.artifact)).digest('hex'), manifest.sha256);
    execFileSync('unzip', ['-q', manifest.artifact, '-d', extracted]);
    assert.deepEqual(await readFile(join(extracted, 'global-bundle.pem')), await readFile(caFile));
    for (const name of ['001_initial_schema.sql', '002_v3_identity_student_plan_assignment_audit.sql']) {
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
        const protectedRoute = await handler({rawPath:'/api/v3/me',requestContext:{http:{method:'GET'}}});
        console.log(JSON.stringify([health.statusCode, protectedRoute.statusCode]));
      })().catch(() => process.exit(1));
    `], { cwd: extracted, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.deepEqual(JSON.parse(output), [200, 401]);
  } finally {
    await rm(extracted, { recursive: true, force: true });
    await rm(dirname(manifest.artifact), { recursive: true, force: true });
    await rm(caFixture, { recursive: true, force: true });
  }
});
