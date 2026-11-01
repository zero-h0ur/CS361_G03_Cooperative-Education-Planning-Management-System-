import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// SHA-256 of the reviewed, committed LF bytes. Append a reviewed migration;
// never modify historical SQL or a database's stored checksum to pass this gate.
export const REVIEWED_MIGRATIONS = Object.freeze([
  ['001_initial_schema.sql', 'd437adfc170a8c3fe79e2db857b2fc0dc342a8c66b44422a2fcaca697ccc9a21'],
  ['002_v3_identity_student_plan_assignment_audit.sql', 'abf94231966248045543d736e3ab745359693c93f082317990489902e1e7484c'],
  ['003_partner_directory.sql', 'b9efe94b7066680f8fa2e41b63cdcd17bdd4f42bce67f598484187f017abf595'],
  ['004_three_role_workflow.sql', '42a86447baf7a12081c11e0c2e1de7c64386b9ffa4b8cc0f8daddddaaacb468c'],
  ['005_submission_snapshots.sql', '5ecc998195f8f624eb9d13f1e00126364b465ed1a3a07b8cd833736dd689cf9c'],
  ['006_advisor_display_name.sql', '163f7856063191a267c291cfe15e799de78c27abe6019bac5372b0b39467ea2b'],
  ['007_submission_policy_integrity.sql', '4a832351580a689f0f1b2293ff136b678ded644f4f5bad12f02710be60ed4090'],
  ['008_returned_plan_cancellation.sql', '1e9853c72dcb7f1860521e4e157495f3e76f940dd573ec7a4855e1928013b0ca'],
  ['009_coordinator_committee_selection.sql', 'adf284bac0a62237ee1c73044c17754eae71c0e9ab1450f998653615c7234c3b'],
  ['010_phase1_applications_documents.sql', '033de7bdc6737a3637428d486365f5d4978c4490f632635f0fdc647c479b2523'],
].map(row => Object.freeze(row)));

const defaultDirectory = fileURLToPath(new URL('../../src/db/migrations/', import.meta.url));

function migrationFiles(directory) {
  const actual = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  const expected = REVIEWED_MIGRATIONS.map(([name]) => name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Migration files differ from the reviewed 001–010 allowlist. Missing/unknown migrations are not accepted.');
  }
  return REVIEWED_MIGRATIONS.map(([name, expectedHash]) => {
    const path = join(directory, name);
    if (!lstatSync(path).isFile()) throw new Error(`Migration must be a regular file: ${name}`);
    return { name, path, expectedHash, bytes: readFileSync(path) };
  });
}

export function readReviewedMigrations(directory = defaultDirectory) {
  return migrationFiles(directory).map(({ name, expectedHash, bytes }) => {
    if (bytes.includes(13)) {
      throw new Error(`Migration ${name} must use committed LF bytes, not CRLF. Restore only verified LF formatting; do not rewrite database checksums.`);
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== expectedHash) throw new Error(`Reviewed migration checksum mismatch: ${name}. Historical SQL is immutable.`);
    return { name, bytes, sql: bytes.toString('utf8'), checksum };
  });
}

// Explicit opt-in formatting for an existing Windows checkout, NOT migration or
// checksum normalization. Validate ALL files before changing any local bytes.
export function normalizeReviewedMigrationLineEndings(directory = defaultDirectory) {
  const files = migrationFiles(directory).map(row => {
    const normalized = Buffer.from(row.bytes.toString('utf8').replaceAll('\r\n', '\n'));
    if (createHash('sha256').update(normalized).digest('hex') !== row.expectedHash) {
      throw new Error(`Refusing to format changed SQL: ${row.name}. No files were written.`);
    }
    return { ...row, normalized };
  });
  const changed = files.filter(row => !row.bytes.equals(row.normalized));
  for (const row of changed) writeFileSync(row.path, row.normalized);
  return changed.map(row => row.name);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--normalize-eol')) throw new Error('Usage: reviewed-migrations.mjs [--normalize-eol]');
  const formatted = args.length ? normalizeReviewedMigrationLineEndings() : [];
  console.log(JSON.stringify({ formatted, databaseTouched: false,
    migrations: readReviewedMigrations().map(({ name, checksum }) => ({ name, checksum })) }, null, 2));
}
