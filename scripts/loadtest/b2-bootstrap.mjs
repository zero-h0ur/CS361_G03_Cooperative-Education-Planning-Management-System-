// B2a only: fixed target, no reset/seed or caller-supplied SQL.
import { createHash } from 'node:crypto';

export const TARGET = Object.freeze({
  account: '130165494095', region: 'ap-southeast-2', id: 'coed-loadtest-db',
  host: 'coed-loadtest-db.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',
  database: 'coed_loadtest', owner: 'coed_loadtest_owner', user: 'coed_app', port: 5432,
  ownerSecret: 'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:rds!db-5e70b6a9-5fc1-484c-9229-d524ed65eeb9-ejTvPm',
  appPrefix: 'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/loadtest/postgres/app-',
  vpc: 'vpc-0a529698240e85c17', subnet: 'subnet-0fb8a4985d4e48f03',
  dbSg: 'sg-09136a6da15840e2b', clientSg: 'sg-0b5db000588a14b36', endpointSg: 'sg-02f4119a2e0c632c8',
  endpoint: 'vpce-08e95353a534b9e27', run: 'lt-20261117-45b10a7e',
  fn: 'coed-loadtest-bootstrap-b2', role: 'coed-loadtest-bootstrap-b2-role',
  runtimeRole: 'arn:aws:iam::130165494095:role/coed-loadtest-lambda-role'
});
export const digest = value => createHash('sha256').update(value).digest('hex');
export function reject(code) { throw Object.assign(new Error(code), { code }); }
export function validateConfig(c, now = Date.now()) {
  if (!c || c.host !== TARGET.host || c.database !== TARGET.database || c.owner !== TARGET.owner ||
      c.ownerSecret !== TARGET.ownerSecret || !new RegExp('^' + TARGET.appPrefix + '[A-Za-z0-9]{6}$').test(c.appSecret || '') ||
      !Number.isSafeInteger(c.startedAt) || !Number.isSafeInteger(c.expiresAt) || c.startedAt > now + 5000 ||
      c.expiresAt <= now || c.expiresAt - c.startedAt > 3600000 || c.expiresAt <= c.startedAt ||
      !/^[a-f0-9]{64}$/.test(c.digest || '')) reject('B2_CONFIG_REJECTED');
}
export function credentials(value, kind) {
  let v;
  try { v = JSON.parse(value); } catch { reject('B2_SECRET_REJECTED'); }
  if (!v || v.username !== TARGET[kind === 'owner' ? 'owner' : 'user'] || typeof v.password !== 'string' || !v.password ||
      v.host !== undefined && v.host !== TARGET.host || v.port !== undefined && Number(v.port) !== TARGET.port ||
      v.dbname !== undefined && v.dbname !== TARGET.database || v.engine !== undefined && v.engine !== 'postgres') reject('B2_SECRET_REJECTED');
  if (kind === 'app' && (v.host !== TARGET.host || v.dbname !== TARGET.database || v.engine !== 'postgres' ||
      Number(v.port) !== 5432 || !/^[a-f0-9]{64}$/.test(v.password))) reject('B2_SECRET_REJECTED');
  return { user: v.username, password: v.password };
}
export function validatePayload(payload, expected) {
  if (!payload || !Array.isArray(payload.migrations) || payload.migrations.length !== 17 ||
      payload.migrations.some(m => !/^[0-9]{3}_[a-z0-9_]+\.sql$/.test(m.name) || digest(m.sql) !== m.checksum) ||
      digest(JSON.stringify(payload)) !== expected) reject('B2_PAYLOAD_REJECTED');
}
export async function assertEmpty(client) {
  const r = await client.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') OR
    EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') OR
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coed_app') AS occupied`);
  if (r.rows[0].occupied) reject('B2_NONEMPTY_TARGET');
}
export async function verifyCatalog(client, payload) {
  const history = (await client.query('SELECT version,checksum FROM public.schema_migrations ORDER BY version')).rows;
  if (JSON.stringify(history) !== JSON.stringify(payload.migrations.map(m => ({ version: m.name, checksum: m.checksum })))) reject('B2_HISTORY_DRIFT');
  const role = (await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS member
    FROM pg_roles WHERE rolname='coed_app'`)).rows;
  if (role.length !== 1 || Object.values(role[0]).some(Boolean)) reject('B2_EXCESSIVE_ROLE');
  const forbidden = (await client.query(`SELECT
    has_schema_privilege('coed_app','public','CREATE') OR has_database_privilege('coed_app',current_database(),'CREATE') OR
    has_table_privilege('coed_app','public.users','INSERT,DELETE,TRUNCATE') OR
    has_column_privilege('coed_app','public.users','role','UPDATE') OR
    has_table_privilege('coed_app','public.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.audit_events','UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.plan_operations','UPDATE,DELETE,TRUNCATE') AS bad`)).rows[0].bad;
  if (forbidden) reject('B2_EXCESSIVE_GRANTS');
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations'")).rows;
  let count = 0;
  for (const { tablename } of tables) {
    const name = '"' + tablename.replaceAll('"', '""') + '"';
    count += Number((await client.query(`SELECT count(*)::int AS n FROM public.${name}`)).rows[0].n);
  }
  if (count !== 0) reject('B2_UNEXPECTED_BUSINESS_DATA');
  return { migrationCount: history.length, businessRows: count, runtimePrivilegeChecks: true };
}
export async function runSchema(client, payload, password, commit) {
  if (!/^[a-f0-9]{64}$/.test(password)) reject('B2_SECRET_REJECTED');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='90s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('coed-loadtest-b2a'))");
    await assertEmpty(client);
    await client.query('CREATE TABLE public.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for (const m of payload.migrations) {
      await client.query(m.sql);
      await client.query('INSERT INTO public.schema_migrations(version,checksum) VALUES($1,$2)', [m.name, m.checksum]);
    }
    // Password is fixed hex from a memory-only Secret read, never event input/output.
    await client.query(`CREATE ROLE coed_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await client.query(payload.grants);
    const result = await verifyCatalog(client, payload);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return { ...result, committed: commit };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
export function createBootstrap({ config, payload, secretReader, connect, now = Date.now }) {
  return async event => {
    let client;
    try {
      validateConfig(config, now()); validatePayload(payload, config.digest);
      if (!event || Object.keys(event).sort().join(',') !== 'command,digest' || event.digest !== config.digest ||
          !['preflight','trial','apply','verify'].includes(event.command)) reject('B2_COMMAND_REJECTED');
      const owner = credentials(await secretReader(config.ownerSecret), 'owner');
      const app = credentials(await secretReader(config.appSecret), 'app');
      client = await connect(owner);
      const target = (await client.query('SELECT current_database() AS db,current_user AS usr')).rows[0];
      if (target.db !== TARGET.database || target.usr !== TARGET.owner) reject('B2_CONNECTED_TARGET_REJECTED');
      let result;
      if (event.command === 'preflight') { await assertEmpty(client); result = { empty: true }; }
      else if (event.command === 'verify') {
        await client.query('BEGIN READ ONLY');
        result = await verifyCatalog(client, payload);
        await client.query('ROLLBACK');
      } else result = await runSchema(client, payload, app.password, event.command === 'apply');
      await client.end(); client = null;
      if (['apply','verify'].includes(event.command)) {
        client = await connect(app);
        const r = (await client.query(`SELECT current_database() AS db,current_user AS usr,
          (SELECT count(*)::int FROM public.companies) AS companies,
          has_table_privilege(current_user,'public.plans','INSERT,UPDATE') AS can_save,
          has_table_privilege(current_user,'public.plan_operations','INSERT') AS receipts,
          has_table_privilege(current_user,'public.audit_events','INSERT') AS audit,
          has_schema_privilege(current_user,'public','CREATE') AS can_ddl`)).rows[0];
        if (r.db !== TARGET.database || r.usr !== TARGET.user || r.companies !== 0 || !r.can_save || !r.receipts || !r.audit || r.can_ddl) reject('B2_RUNTIME_VERIFY_FAILED');
        result.runtimeLogin = true;
      }
      return { ok: true, status: `B2_${event.command.toUpperCase()}_OK`, ...result };
    } catch (error) {
      return { ok: false, code: /^B2_[A-Z_]+$/.test(error.code || '') ? error.code : 'B2_DATABASE_OR_SECRET_FAILED',
        sqlState: /^[0-9A-Z]{5}$/.test(error.code || '') ? error.code : undefined };
    } finally { if (client) await client.end().catch(() => {}); }
  };
}
