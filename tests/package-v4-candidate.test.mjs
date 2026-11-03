import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listZipEntries, readZipEntry } from '../scripts/operations/zip-archive.mjs';
import { readReviewedMigrations } from '../scripts/operations/reviewed-migrations.mjs';

test('paired candidate pins V4 target, current form/API, exact migrations and honest source state without deploying', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'coed-candidate-ca-'));
  const caFile = join(fixture, 'ca.pem');
  writeFileSync(caFile, rootCertificates[0] + '\n');
  let output;
  try {
    const canary = 'DO_NOT_BUNDLE_CREDENTIAL_CANARY';
    const result = JSON.parse(execFileSync(process.execPath, ['scripts/package-v4-candidate.mjs'], {
      cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, COED_RDS_CA_FILE: caFile, DATABASE_URL: `postgresql://${canary}@localhost/unused`,
        CO_ED_API_BASE_URL: 'https://old-api.example.invalid', CO_ED_APP_ORIGIN: 'https://old-web.example.invalid' }
    }));
    output = resolve(result.output);
    const rel = relative(resolve(root, 'tmp/release-candidates'), output);
    assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
    assert.match(rel, /^candidate-/);
    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'));
    assert.equal(manifest.status, 'LOCAL_CANDIDATE_NOT_DEPLOYED');
    assert.equal(manifest.deploymentApproved, false);
    assert.equal(manifest.applicationFormVersion, 2);
    assert.equal(typeof manifest.source.dirty, 'boolean');
    assert.match(manifest.source.inputSha256, /^[a-f0-9]{64}$/);
    assert.equal(manifest.source.commit, execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim());
    assert.equal(manifest.target.account, '130165494095');
    assert.equal(manifest.target.region, 'ap-southeast-2');
    assert.equal(manifest.target.appId, 'd1bpmj87vmjb96');
    for (const [name, file] of Object.entries(manifest.artifacts)) {
      const zip = join(output, name);
      assert.equal(createHash('sha256').update(readFileSync(zip)).digest('hex'), file.sha256);
      assert.deepEqual(listZipEntries(zip).sort(), file.entries.slice().sort());
      assert.ok(file.entries.every(entry => !entry.startsWith('dist/') && !/\.env|\.aws|node_modules|ui-preview|\.map$/.test(entry)));
    }
    const frontend = join(output, 'coed-v4-frontend.zip');
    const runtime = readZipEntry(frontend, 'runtime-config.js').toString('utf8');
    assert.ok(readZipEntry(frontend, 'assets/authenticated-shell.css').includes('application-step-button'));
    assert.ok(runtime.includes(manifest.target.apiBaseUrl));
    assert.ok(!runtime.includes('example.invalid'));
    const backend = join(output, 'coed-v4-lambda.zip');
    const lambda = readZipEntry(backend, 'src/lambda.js').toString('utf8');
    assert.ok(lambda.includes('/api/v4/applications'));
    assert.ok(!lambda.includes(canary));
    assert.ok(!runtime.includes(canary));
    assert.deepEqual(manifest.migrations.map(({name,checksum})=>({name,checksum})),
      readReviewedMigrations().map(({name,checksum})=>({name,checksum})));
    for (const row of manifest.migrations) {
      assert.equal(createHash('sha256').update(readZipEntry(backend, 'src/db/migrations/' + row.name)).digest('hex'), row.checksum);
    }
    // The strict final-release clean-source gate is intentionally still present.
    assert.match(readFileSync(join(root,'scripts/operations/prepare-workflow-release.mjs'),'utf8'), /Commit reviewed source before preparing the release/);
  } finally {
    if (output) {
      const rel = relative(resolve(root, 'tmp/release-candidates'), output);
      if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !/^candidate-/.test(rel)) {
        throw new Error('Unsafe candidate cleanup target');
      }
      rmSync(output, { recursive: true, force: true });
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});
