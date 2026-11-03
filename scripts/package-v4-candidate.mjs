import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { archiveFiles, createZip, listZipEntries, readZipEntry } from './operations/zip-archive.mjs';
import { readReviewedMigrations } from './operations/reviewed-migrations.mjs';
import {LINEAGE_SUPPORT} from './operations/coordinator-schema-lineages.mjs';
import formContract from '../src/shared/application-form.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function inputState() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'src', 'scripts', 'config', 'resources', '*.html', '*.css', '*.js',
    'package.json', 'package-lock.json', '.gitattributes'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const path of paths) digest.update(path + '\0').update(sha256(readFileSync(join(root, path))) + '\n');
  return { commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
    dirty: Boolean(git(['status', '--porcelain'])), inputSha256: digest.digest('hex') };
}

if (!process.env.COED_RDS_CA_FILE) throw new Error('Set COED_RDS_CA_FILE to a verified public AWS RDS CA bundle.');
const migrations = readReviewedMigrations();
const before = inputState();
const target = JSON.parse(await readFile(join(root, 'config/v4-public.json'), 'utf8'));
const parent = join(root, 'tmp/release-candidates');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'candidate-'));

// These subprocesses only build local files. There are no AWS SDK/CLI writes,
// migration invocations, database connections, or credential exports here.
execFileSync(process.execPath, ['scripts/build-v4.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const lambda = JSON.parse(execFileSync(process.execPath, ['scripts/package-lambda.mjs'], {
  cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
}));
const frontend = join(output, 'coed-v4-frontend.zip');
const backend = join(output, 'coed-v4-lambda.zip');
const frontendEntries = archiveFiles(join(root, 'dist'));
if (frontendEntries.some(name => /(^|\/)(?:\.env[^/]*|\.aws|node_modules|data|ui-preview)(?:\/|$)|\.map$/.test(name))) {
  throw new Error('Unexpected private, preview or source-map file in frontend artifact.');
}
for (const required of ['app.html', 'index.html', 'runtime-config.js', 'assets/authenticated-shell.js', 'assets/authenticated-shell.css']) {
  if (!frontendEntries.includes(required)) throw new Error(`Missing frontend file: ${required}`);
}
createZip(join(root, 'dist'), frontend, frontendEntries);
await copyFile(lambda.artifact, backend, constants.COPYFILE_EXCL);

const runtimeBytes = readZipEntry(frontend, 'runtime-config.js');
const context = { window: {} };
runInNewContext(runtimeBytes.toString('utf8'), context, { timeout: 1000 });
const runtime = context.window.CO_ED_CONFIG;
if (runtime?.apiBaseUrl !== target.apiBaseUrl
    || runtime?.auth?.redirectSignIn !== `${target.appOrigin}/app.html`
    || runtime?.auth?.redirectSignOut !== `${target.appOrigin}/index.html`
    || runtime?.auth?.userPoolId !== target.cognito.userPoolId
    || runtime?.auth?.userPoolClientId !== target.cognito.userPoolClientId
    || runtime?.auth?.domain !== target.cognito.domain) {
  throw new Error('Frontend target does not match the pinned V4 public configuration.');
}
const shellBytes = readZipEntry(frontend, 'assets/authenticated-shell.js');
const styleBytes = readZipEntry(frontend, 'assets/authenticated-shell.css');
if (!styleBytes.includes('application-step-button')) throw new Error('Frontend lacks current six-step form styles.');
for (const marker of ['#/student/application', '/api/v4/applications', 'application-step-button', 'english_full_name', 'guardian_address']) {
  if (!shellBytes.includes(marker)) throw new Error(`Frontend lacks current application marker: ${marker}`);
}
const backendEntries = listZipEntries(backend);
const expectedBackendEntries = ['src/lambda.js', 'src/db/migrate.js', 'global-bundle.pem',
  'src/db/verification/002_v3_forward_only_verification.sql',
  ...migrations.map(row => 'src/db/migrations/' + row.name)].sort();
if (JSON.stringify(backendEntries.slice().sort()) !== JSON.stringify(expectedBackendEntries)) {
  throw new Error('Backend ZIP does not match the exact reviewed allowlist.');
}
for (const row of migrations) {
  if (sha256(readZipEntry(backend, 'src/db/migrations/' + row.name)) !== row.checksum) {
    throw new Error(`Packaged migration bytes changed: ${row.name}`);
  }
}
const lambdaBytes = readZipEntry(backend, 'src/lambda.js');
for (const marker of ['/api/v4/application-options', '/api/v4/applications', 'registerApplicationRoutes', 'english_full_name', 'guardian_address']) {
  if (!lambdaBytes.includes(marker)) throw new Error(`Backend lacks current application marker: ${marker}`);
}
const after = inputState();
if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Source changed during packaging. Build a new candidate.');

const manifest = {
  formatVersion: 1,
  status: 'LOCAL_CANDIDATE_NOT_DEPLOYED',
  deploymentApproved: false,
  createdAt: new Date().toISOString(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  applicationFormVersion: formContract.FORM_VERSION,
  source: before,
  target: { account: target.accountId, region: target.region, appId: target.amplifyAppId,
    branch: target.amplifyBranch, function: 'coed-api', appOrigin: target.appOrigin, apiBaseUrl: target.apiBaseUrl },
  artifacts: {},
  frontendAssets: { 'runtime-config.js': sha256(runtimeBytes), 'assets/authenticated-shell.js': sha256(shellBytes),
    'assets/authenticated-shell.css': sha256(styleBytes) },
  migrations: migrations.map(({ name, checksum }) => ({ name, checksum })),
  coordinatorSchema: LINEAGE_SUPPORT,
  caBundleSha256: sha256(readZipEntry(backend, 'global-bundle.pem')),
  blockers: ['Commit/review source and regenerate a clean final release; this is only a local candidate.',
    'Coordinator requires coupled Backend + 016 + scoped ACL cutover. External 015 is upgrade-only; authentic 014/015 source is missing and baseline adoption is not production-approved.',
    'Verify live migration history, runtime grants and API integration/alias; retain backup and rollback artifacts.',
    'Verify private document storage and actual authenticated Profile error; no synthetic academic metadata in production.',
    'Obtain separate approval before any upload, deployment, migration or permission change.']
};
for (const [name, entries] of [['coed-v4-frontend.zip', frontendEntries], ['coed-v4-lambda.zip', backendEntries]]) {
  const bytes = await readFile(join(output, name));
  manifest.artifacts[name] = { bytes: bytes.length, sha256: sha256(bytes), entries };
}
// Publish the manifest last. A failed/partial build must never look verified.
await writeFile(join(output, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, manifest: join(output, 'candidate-manifest.json'), source: before,
  status: manifest.status, deploymentApproved: false }, null, 2));
