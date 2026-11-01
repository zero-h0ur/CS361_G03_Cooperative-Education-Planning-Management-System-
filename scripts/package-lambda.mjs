import { mkdtemp, mkdir, cp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readReviewedMigrations } from './operations/reviewed-migrations.mjs';
import { createZip, listZipEntries } from './operations/zip-archive.mjs';

// Explicit allowlist: never archive the checkout, .env, credentials, or fixtures.
const workspace = fileURLToPath(new URL('../', import.meta.url));
// Fail before creating any release files if exact reviewed SQL bytes changed.
const migrations = readReviewedMigrations();
// The production DATABASE_URL refers to /var/task/global-bundle.pem.
// Require an explicit trusted public CA bundle; never silently omit TLS assets.
const caFile = process.env.COED_RDS_CA_FILE;
if (!caFile) throw new Error('COED_RDS_CA_FILE must point to the trusted AWS RDS global-bundle.pem.');
const caBytes = await readFile(resolve(caFile));
const caBundle = caBytes.toString('utf8');
const certificates = caBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
if (!certificates?.length || caBundle.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) {
  throw new Error('RDS CA bundle must contain only public PEM certificates.');
}
for (const pem of certificates) {
  if (!new X509Certificate(pem).ca) throw new Error('RDS bundle contains a non-CA certificate.');
}
const release = await mkdtemp(join(tmpdir(), 'coed-v4-release-'));
const staging = join(release, 'package');
await mkdir(staging);
// Package the exact bytes validated above, not a second read of mutable input.
await writeFile(join(staging, 'global-bundle.pem'), caBytes);

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

await mkdir(join(staging, 'src/db/migrations'), { recursive: true });
for (const migration of migrations) {
  await writeFile(join(staging, 'src/db/migrations', migration.name), migration.bytes);
}
await mkdir(join(staging, 'src/db/verification'));
await cp(resolve(workspace, 'src/db/verification/002_v3_forward_only_verification.sql'),
  join(staging, 'src/db/verification/002_v3_forward_only_verification.sql'));

const artifact = join(release, 'coed-v4-lambda.zip');
createZip(staging, artifact);
const contents = await readFile(artifact);
console.log(JSON.stringify({
  artifact,
  bytes: (await stat(artifact)).size,
  sha256: createHash('sha256').update(contents).digest('hex'),
  handler: 'src/lambda.handler',
  migrationRunner: 'src/db/migrate.js',
  entries: listZipEntries(artifact),
  migrations: migrations.map(({ name, checksum }) => ({ name, checksum }))
}, null, 2));
