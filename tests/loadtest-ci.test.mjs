import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const scripts = JSON.parse(read('package.json')).scripts;
const workflow = read('.github/workflows/v4-verification.yml');
const dbJob = workflow.split('\n  loadtest-database:')[1]?.split('\n  observed-schema-upgrade:')[0];

test('loadtest entry point includes old, B2a, B2b, teammate and CI unit checks without DB/operator execution', () => {
  const command = scripts['test:loadtest'];
  for (const name of ['preparation', 'b2', 'b2b', 'scripts', 'ci']) {
    assert.ok(command.includes(`tests/loadtest-${name}.test.mjs`));
  }
  assert.ok(command.includes('--test-concurrency=1'));
  assert.doesNotMatch(command, /operator|prepare-db|test-local|-db\.test|smoke\.mjs/);
  assert.match(workflow, /run: npm run test:loadtest\r?\n/);
});

test('each DB suite has its own PG16 matrix job with loopback disposable guards and no AWS operators', () => {
  assert.ok(dbJob);
  assert.match(dbJob, /suite: \[local, b2a, b2b\]/);
  assert.match(dbJob, /fail-fast: false/);
  for (const [name, file] of [
    ['test:loadtest:db', 'loadtest-db'],
    ['test:loadtest:b2a:db', 'loadtest-b2-db'],
    ['test:loadtest:b2b:db', 'loadtest-b2b-db']
  ]) {
    assert.equal(scripts[name], `node --test --test-concurrency=1 tests/${file}.test.mjs`);
    assert.ok(dbJob.includes(`command: ${name}\n`) || dbJob.includes(`command: ${name}\r\n`));
    const source = read(`tests/${file}.test.mjs`);
    assert.match(source, /localTarget\((?:url|connectionString)\)/);
    assert.doesNotMatch(source, /from ['"].*\.test\.mjs['"]/);
  }
  assert.match(dbJob, /image: postgres:16-alpine/);
  assert.match(dbJob, /127\.0\.0\.1:55442:5432/);
  assert.match(dbJob, /POSTGRES_HOST_AUTH_METHOD: trust/);
  assert.match(dbJob, /NODE_ENV: test/);
  assert.match(dbJob, /LOADTEST_PREP_DISPOSABLE: 'true'/);
  assert.match(dbJob, /postgres:\/\/postgres@127\.0\.0\.1:55442\/coed_loadtest_test/);
  assert.match(dbJob, /localTarget\(url\)/);
  assert.match(dbJob, /CI_REQUIRES_POSTGRESQL_16/);
  assert.doesNotMatch(dbJob, /run:.*(?:operator|stack-up|smoke\.mjs|aws\s)|secrets\.|configure-aws|upload-artifact/);
});

test('private loadtest artifacts remain ignored and are not CI upload paths', () => {
  assert.ok(read('.gitignore').split(/\r?\n/).includes('/tmp/loadtest/'));
  assert.doesNotMatch(workflow, /^\s+path:.*(?:tmp\/loadtest|\.zip)/m);
  for (const block of workflow.split('uses: actions/upload-artifact').slice(1)) {
    const configuration = block.split(/\n\s+- (?:name:|uses:)|\n  [a-z][\w-]*:/)[0];
    assert.doesNotMatch(configuration, /tmp\/loadtest|\*\*|\.zip|mapping|checkpoint/);
  }
});

test('byte-pinned generator and generated SQL retain LF on Windows and Linux', () => {
  const attributes = read('.gitattributes');
  for (const file of ['companies-seed.sql', 'generate-companies.mjs', 'vendor/pr178-generate-companies.mjs']) {
    assert.ok(attributes.includes(`/scripts/loadtest/${file} text eol=lf`));
    assert.equal(read(`scripts/loadtest/${file}`).includes('\r'), false, `${file} must retain committed LF bytes`);
  }
});
