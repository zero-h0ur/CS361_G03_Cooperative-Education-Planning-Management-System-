import { mkdtemp, mkdir, cp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Explicit allowlist: never archive the checkout, .env, credentials, or fixtures.
const workspace = fileURLToPath(new URL('../', import.meta.url));
// The production DATABASE_URL refers to /var/task/global-bundle.pem.
// Require an explicit trusted public CA bundle; never silently omit TLS assets.
const caFile = process.env.COED_RDS_CA_FILE;
if (!caFile) throw new Error('COED_RDS_CA_FILE must point to the trusted AWS RDS global-bundle.pem.');
const caBundle = await readFile(resolve(caFile), 'utf8');
const certificates = caBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
if (!certificates?.length || caBundle.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) {
  throw new Error('RDS CA bundle must contain only public PEM certificates.');
}
for (const pem of certificates) {
  if (!new X509Certificate(pem).ca) throw new Error('RDS bundle contains a non-CA certificate.');
}
const release = await mkdtemp(join(tmpdir(), 'coed-v3-release-'));
const staging = join(release, 'package');
await mkdir(staging);
await cp(resolve(caFile), join(staging, 'global-bundle.pem'));

await build({
  absWorkingDir: workspace,
  entryPoints: ['src/lambda.js', 'src/db/migrate.js'],
  outbase: '.',
  outdir: staging,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg-native'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning'
});

for (const directory of ['migrations', 'verification']) {
  await cp(resolve(workspace, 'src/db', directory), join(staging, 'src/db', directory), {
    recursive: true
  });
}

const artifact = join(release, 'coed-v3-lambda.zip');
execFileSync('zip', ['-q', '-r', artifact, 'src', 'global-bundle.pem'], { cwd: staging });
const contents = await readFile(artifact);
console.log(JSON.stringify({
  artifact,
  bytes: (await stat(artifact)).size,
  sha256: createHash('sha256').update(contents).digest('hex'),
  handler: 'src/lambda.handler',
  migrationRunner: 'src/db/migrate.js'
}, null, 2));
