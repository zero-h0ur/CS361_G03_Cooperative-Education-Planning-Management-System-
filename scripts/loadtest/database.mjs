// Ronnakrit's preparation tools. Deliberately NO AWS client or remote Apply.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readReviewedMigrations } from '../operations/reviewed-migrations.mjs';
import { validTestSubject } from './identity-input.mjs';

export const CONTRACT = 'coed-loadtest-db-v1';
export const LOCAL_DATABASE = 'coed_loadtest_test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_FILES = [
  'src/api/routes/directory-routes.js', 'src/db/repositories/directory-repository.js',
  'src/api/routes/student-plan-routes.js', 'src/api/services/student-plan-service.js',
  'src/db/repositories/student-plan-repository.js', 'src/auth/identity-resolver.js',
  'src/maintenance.js', 'scripts/loadtest/database.mjs', 'scripts/loadtest/identity-input.mjs', 'scripts/loadtest/runtime-grants.sql'
];
const root = new URL('../../', import.meta.url);
export function fail(code) { throw Object.assign(new Error(code), { code }); }
function exactKeys(value, keys, code) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(code);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function hash(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
}
export function readJson(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('INPUT_FILE_REJECTED');
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { fail('INPUT_FILE_REJECTED'); } // Never echo input fragments/private identity bindings.
}
export function validateInputs(manifest, dataset) {
  exactKeys(manifest, ['contract', 'run_id', 'synthetic_only', 'aws_intent', 'issuer', 'accounts'], 'INVALID_MANIFEST');
  if (manifest.contract !== CONTRACT || manifest.synthetic_only !== true ||
      !/^lt-\d{8}-[a-f0-9]{8}$/.test(manifest.run_id)) fail('INVALID_MANIFEST');
  exactKeys(manifest.aws_intent, ['account_id', 'region', 'rds_identifier', 'secret_name'], 'INVALID_AWS_INTENT');
  const target = manifest.aws_intent;
  if (!/^\d{12}$/.test(target.account_id) || target.region !== 'ap-southeast-2' ||
      target.rds_identifier !== 'coed-loadtest-db' || target.secret_name !== 'coed/loadtest/postgres/app') fail('INVALID_AWS_INTENT');
  if (typeof manifest.issuer !== 'string' ||
      !/^https:\/\/cognito-idp\.ap-southeast-2\.amazonaws\.com\/ap-southeast-2_[A-Za-z0-9]+$/.test(manifest.issuer)) fail('INVALID_ISSUER');
  if (!Array.isArray(manifest.accounts) || manifest.accounts.length < 5 || manifest.accounts.length > 10) fail('INVALID_TEST_ACCOUNTS');
  const aliases = new Set(), subjects = new Set();
  for (const account of manifest.accounts) {
    exactKeys(account, ['alias', 'subject'], 'INVALID_TEST_ACCOUNTS');
    if (!/^loadtest(?:0[1-9]|10)$/.test(account.alias) || !validTestSubject(account.subject) ||
        aliases.has(account.alias) || subjects.has(account.subject)) fail('INVALID_TEST_ACCOUNTS');
    aliases.add(account.alias); subjects.add(account.subject);
  }
  exactKeys(dataset, ['contract', 'run_id', 'synthetic_only', 'companies'], 'INVALID_DATASET');
  if (dataset.contract !== 'coed-loadtest-companies-v1' || dataset.run_id !== manifest.run_id ||
      dataset.synthetic_only !== true || !Array.isArray(dataset.companies) ||
      dataset.companies.length < 300 || dataset.companies.length > 500) fail('INVALID_DATASET');
  const ids = new Set(), names = new Set();
  for (const company of dataset.companies) {
    exactKeys(company, ['id', 'name', 'location'], 'INVALID_COMPANY');
    if (!UUID.test(company.id) || typeof company.name !== 'string' ||
        !/^LOADTEST-[A-Za-z0-9 -]{1,80}$/.test(company.name) ||
        !['Bangkok', 'Pathum Thani', 'Nonthaburi', 'Remote'].includes(company.location) ||
        ids.has(company.id) || names.has(company.name)) fail('INVALID_COMPANY');
    ids.add(company.id); names.add(company.name);
  }
  // This validates a synthetic-only input contract, not proof that supplied subjects
  // really belong to test accounts. That needs the separate Cognito owner handoff.
  return {
    manifest: { ...manifest, accounts: [...manifest.accounts].sort((a, b) => a.alias.localeCompare(b.alias)) },
    dataset: { ...dataset, companies: [...dataset.companies].sort((a, b) => a.id.localeCompare(b.id)) }
  };
}
export function buildPlan(manifest, dataset) {
  const input = validateInputs(manifest, dataset);
  const migrations = readReviewedMigrations();
  const source = Object.fromEntries(SOURCE_FILES.map(path => [path, hash(readFileSync(new URL(path, root)))]));
  const migrationsDigest = hash(migrations.map(({ name, checksum }) => ({ name, checksum })));
  const sourceDigest = hash(source);
  const fingerprint = hash({ ...input, migrationsDigest, sourceDigest });
  return { contract: CONTRACT, fingerprint, sourceDigest, migrationsDigest,
    companyCount: input.dataset.companies.length, accountCount: input.manifest.accounts.length,
    migrationCount: migrations.length, cloudChanges: false, remoteApplySupported: false };
}
export function localTarget(connectionString, env = process.env) {
  if (env.NODE_ENV !== 'test' || env.LOADTEST_PREP_DISPOSABLE !== 'true' ||
      env.AWS_EXECUTION_ENV || env.LAMBDA_TASK_ROOT || env.DB_SECRET_ARN) fail('LOCAL_DISPOSABLE_REQUIRED');
  let url;
  try { url = new URL(connectionString); } catch { fail('LOCAL_TARGET_REJECTED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== `/${LOCAL_DATABASE}` || url.search || url.hash ||
      !url.username || (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1024))) fail('LOCAL_TARGET_REJECTED');
  return url;
}
export function fixtureId(runId, key) {
  const s = hash(`${CONTRACT}:${runId}:${key}`);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
async function assertEmpty(client) {
  const { rows } = await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') OR
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) OR
    EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS occupied`);
  if (rows[0].occupied) fail('NONEMPTY_TARGET_REJECTED');
  const roles = await client.query("SELECT 1 FROM pg_roles WHERE rolname='coed_app'");
  if (roles.rowCount) fail('EXISTING_RUNTIME_ROLE_REJECTED');
}
async function bootstrap(client, input, plan) {
  await client.query(`CREATE TABLE public.schema_migrations
    (version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const migration of readReviewedMigrations()) {
    await client.query(migration.sql);
    await client.query('INSERT INTO public.schema_migrations(version,checksum) VALUES($1,$2)', [migration.name, migration.checksum]);
  }
  await client.query('CREATE ROLE coed_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT');
  const source = `loadtest:${input.manifest.run_id}`;
  for (const company of input.dataset.companies) {
    await client.query(`INSERT INTO companies(id,name,location,source,visibility,data_status)
      VALUES($1,$2,$3,$4,'public','mock')`, [company.id, company.name, company.location, source]);
  }
  const id = key => fixtureId(input.manifest.run_id, key);
  await client.query(`INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status)
    VALUES($1,$2,2569,1,'OPEN',$3,'private','mock')`, [id('round'), `LOADTEST-${input.manifest.run_id}`, source]);
  for (const account of input.manifest.accounts) {
    await client.query("INSERT INTO users(id,role,account_status) VALUES($1,'STUDENT','ACTIVE')", [id(`${account.alias}:user`)]);
    await client.query(`INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject)
      VALUES($1,$2,$3,$4)`, [id(`${account.alias}:link`), id(`${account.alias}:user`), input.manifest.issuer, account.subject]);
    await client.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,
      department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES($1,$2,$3,$4,$5,$6,'LOADTEST-DEPT','LOADTEST-PROGRAM','LOADTEST-MAJOR',2569,'ACTIVE',$7,'private','mock')`,
    [id(`${account.alias}:student`), id(`${account.alias}:user`), `LOADTEST-${account.alias}`,
      `99000000${account.alias.slice(-2)}`, `LOADTEST Student ${account.alias.slice(-2)}`, `${account.alias}@example.invalid`, source]);
    await client.query(`INSERT INTO plans(id,student_id,round_id,cycle_id,notes,source,visibility,data_status)
      VALUES($1,$2,$3,$3,'LOADTEST initial synthetic Draft',$4,'private','mock')`,
    [id(`${account.alias}:plan`), id(`${account.alias}:student`), id('round'), source]);
  }
  await client.query(`CREATE TABLE public.loadtest_preparation
    (singleton boolean PRIMARY KEY CHECK(singleton),contract text NOT NULL,run_id text NOT NULL,
     fingerprint text NOT NULL,source_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`INSERT INTO public.loadtest_preparation(singleton,contract,run_id,fingerprint,source_digest)
    VALUES(true,$1,$2,$3,$4)`, [CONTRACT, input.manifest.run_id, plan.fingerprint, plan.sourceDigest]);
  await client.query(readFileSync(new URL('./runtime-grants.sql', import.meta.url), 'utf8'));
}
async function verify(client, input, plan) {
  const marker = await client.query('SELECT contract,run_id,fingerprint,source_digest FROM public.loadtest_preparation');
  if (marker.rowCount !== 1 || marker.rows[0].contract !== CONTRACT ||
      marker.rows[0].run_id !== input.manifest.run_id || marker.rows[0].fingerprint !== plan.fingerprint ||
      marker.rows[0].source_digest !== plan.sourceDigest) fail('PREPARATION_DRIFT');
  const history = await client.query('SELECT version AS name,checksum FROM public.schema_migrations ORDER BY version');
  if (hash(history.rows) !== plan.migrationsDigest) fail('MIGRATION_DRIFT');
  const companies = await client.query('SELECT id,name,location FROM public.companies ORDER BY id');
  if (hash(companies.rows) !== hash(input.dataset.companies)) fail('DATASET_DRIFT');
  const id = key => fixtureId(input.manifest.run_id, key);
  const users = await client.query(`SELECT u.id,u.role,u.account_status,s.id AS student_id,s.student_number,
    s.institutional_email,s.enrollment_status,l.external_issuer,l.external_subject,l.status AS link_status,
    p.id AS plan_id,p.cycle_id,p.status AS plan_status,p.version
    FROM public.users u JOIN public.students s ON s.user_id=u.id JOIN public.external_identity_links l ON l.user_id=u.id
    JOIN public.plans p ON p.student_id=s.id ORDER BY s.student_number`);
  const expected = input.manifest.accounts.map(a => ({ id: id(`${a.alias}:user`), role: 'STUDENT', account_status: 'ACTIVE',
    student_id: id(`${a.alias}:student`), student_number: `99000000${a.alias.slice(-2)}`,
    institutional_email: `${a.alias}@example.invalid`, enrollment_status: 'ACTIVE', external_issuer: input.manifest.issuer,
    external_subject: a.subject, link_status: 'ACTIVE', plan_id: id(`${a.alias}:plan`), cycle_id: id('round'), plan_status: 'DRAFT' }));
  if (users.rows.some(row => row.version < 1) || hash(users.rows.map(({ version: _version, ...row }) => row)) !== hash(expected)) fail('IDENTITY_OR_DRAFT_DRIFT');
  const counts = await client.query(`SELECT (SELECT count(*)::int FROM public.users) AS users,
    (SELECT count(*)::int FROM public.students) AS students,(SELECT count(*)::int FROM public.external_identity_links) AS links,
    (SELECT count(*)::int FROM public.plans) AS plans,(SELECT count(*)::int FROM public.rounds) AS rounds`);
  if (['users','students','links','plans'].some(key => counts.rows[0][key] !== plan.accountCount) || counts.rows[0].rounds !== 1) fail('FOREIGN_RECORDS_REJECTED');
  const role = await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit
    FROM pg_roles WHERE rolname='coed_app'`);
  if (role.rowCount !== 1 || Object.values(role.rows[0]).some(Boolean)) fail('RUNTIME_PRIVILEGE_DRIFT');
  const memberships = await client.query(`SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='coed_app'`);
  if (memberships.rowCount) fail('RUNTIME_PRIVILEGE_DRIFT');
  const privileges = await client.query(`SELECT
    has_schema_privilege('coed_app','public','CREATE') OR
    has_database_privilege('coed_app',current_database(),'CREATE') OR
    has_table_privilege('coed_app','public.users','INSERT,DELETE,TRUNCATE') OR
    has_column_privilege('coed_app','public.users','role','UPDATE') OR
    has_table_privilege('coed_app','public.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.audit_events','UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.plan_operations','UPDATE,DELETE,TRUNCATE') AS excessive`);
  if (privileges.rows[0].excessive) fail('RUNTIME_PRIVILEGE_DRIFT');
  // All other business tables must remain empty in this narrowly scoped workload.
  const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename <> ALL($1::text[])`, [['schema_migrations','loadtest_preparation','companies','rounds','users',
    'students','external_identity_links','plans','plan_operations','audit_events']]);
  for (const { tablename } of tables.rows) {
    // Identifiers come only from PostgreSQL's catalog, not the manifest/dataset.
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    if ((await client.query(`SELECT 1 FROM public.${quoted} LIMIT 1`)).rowCount) fail('FOREIGN_RECORDS_REJECTED');
  }
  return counts.rows[0];
}
export async function prepareLocal({ connectionString, manifest, dataset, command = 'trial', env = process.env }) {
  localTarget(connectionString, env); // BEFORE opening a socket, even for check.
  if (!['trial', 'apply', 'check'].includes(command)) fail('INVALID_COMMAND');
  const input = validateInputs(manifest, dataset), plan = buildPlan(manifest, dataset);
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000, application_name: 'coed-loadtest-preparation-local' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (command === 'check') await client.query('SET TRANSACTION READ ONLY');
    if (command === 'check') await client.query('SET TRANSACTION READ ONLY');
    await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=public,pg_catalog");
    await client.query('SELECT pg_advisory_xact_lock(36117112026::bigint)');
    const db = await client.query('SELECT current_database() AS name');
    if (db.rows[0].name !== LOCAL_DATABASE) fail('LOCAL_TARGET_REJECTED');
    const present = await client.query("SELECT to_regclass('public.loadtest_preparation') IS NOT NULL AS present");
    const replay = present.rows[0].present;
    if (!replay) {
      if (command === 'check') fail('NOT_PREPARED');
      await assertEmpty(client);
      await bootstrap(client, input, plan);
    }
    const counts = await verify(client, input, plan);
    await client.query(command === 'apply' ? 'COMMIT' : 'ROLLBACK');
    return { status: command === 'trial' ? 'LOCAL_TRIAL_ROLLED_BACK' : command === 'apply' ? 'LOCAL_PREPARED' : 'LOCAL_VERIFIED',
      ...plan, counts, idempotentReplay: replay, committed: command === 'apply', genuineCognitoVerified: false };
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    // A DB error can contain offending identity values. Never forward message/detail/query.
    if (error.code && /^[A-Z][A-Z_]+$/.test(error.code)) throw error;
    fail('LOCAL_DATABASE_OPERATION_FAILED');
  } finally {
    client?.release();
    await pool.end();
  }
}

export const repositoryRoot = fileURLToPath(root);
