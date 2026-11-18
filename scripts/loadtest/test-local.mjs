// Create a NEW local PostgreSQL cluster for each run; never reset a retained DB.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from 'pg';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = join(root, 'tmp', 'loadtest');
const suffix = process.platform === 'win32' ? '.exe' : '';
async function unusedPort() {
  const server = net.createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const { port } = server.address();
  await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  return port;
}
async function main() {
  if ((process.argv.length !== 2 && !(process.argv.length === 3 && ['--b2','--b2b'].includes(process.argv[2]))) || process.env.AWS_EXECUTION_ENV || process.env.LAMBDA_TASK_ROOT ||
      ['production', 'prod', 'staging'].includes(process.env.NODE_ENV)) throw new Error('LOCAL_RUNNER_REJECTED');
  const bin = process.env.LOADTEST_PG_BIN;
  if (!bin || !isAbsolute(bin) || !['initdb', 'pg_ctl', 'postgres'].every(name => existsSync(join(bin, `${name}${suffix}`)))) {
    throw new Error('SET_LOADTEST_PG_BIN_TO_INSTALLED_POSTGRESQL');
  }
  mkdirSync(artifacts, { recursive: true });
  const dataDir = mkdtempSync(join(artifacts, 'pg-'));
  const childEnv = { ...process.env };
  // Do not pass inherited cloud credentials, pg defaults or real auth settings to fixtures.
  for (const key of Object.keys(childEnv)) {
    if (/^(AWS_|DB_|PG|TU_|AUTH_|COED_)/.test(key) || ['DATABASE_URL', 'TEST_DATABASE_URL'].includes(key)) delete childEnv[key];
  }
  Object.assign(childEnv, { NODE_ENV: 'test', LOADTEST_PREP_DISPOSABLE: 'true', COED_API_MAINTENANCE: '' });
  const native = (name, args, timeout = 30000) => spawnSync(join(bin, `${name}${suffix}`), args,
    { cwd: root, env: childEnv, encoding: 'utf8', timeout, windowsHide: true });
  const record = (name, result) => writeFileSync(join(dataDir, `${name}.log`), `${result.stdout || ''}\n${result.stderr || ''}`);
  let startupAttempted = false;
  try {
    const init = native('initdb', ['-D', dataDir, '--encoding=UTF8', '--locale=C', '--auth=trust', '--username=postgres']);
    record('init', init);
    if (init.status !== 0) throw new Error('LOCAL_POSTGRES_INIT_FAILED');
    const port = await unusedPort();
    startupAttempted = true;
    const start = native('pg_ctl', ['-D', dataDir, '-l', join(dataDir, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    record('start', start);
    if (start.status !== 0) throw new Error('LOCAL_POSTGRES_START_FAILED');
    const admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 3000 });
    try { await admin.connect(); await admin.query('CREATE DATABASE coed_loadtest_test'); } finally { await admin.end(); }
    childEnv.LOADTEST_PREP_TEST_DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/coed_loadtest_test`;
    const suite = process.argv[2] === '--b2b' ? 'tests/loadtest-b2b-db.test.mjs' : process.argv[2] === '--b2' ? 'tests/loadtest-b2-db.test.mjs' : 'tests/loadtest-db.test.mjs';
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', suite],
      { cwd: root, env: childEnv, encoding: 'utf8', timeout: 90000, windowsHide: true });
    record('test', result);
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.status !== 0) throw new Error('LOCAL_DATABASE_TESTS_FAILED');
  } finally {
    // Exact directory created by this invocation only; no recursive deletion.
    const inside = relative(artifacts, resolve(dataDir));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('LOCAL_CLUSTER_PATH_REJECTED');
    if (startupAttempted) {
      const status = native('pg_ctl', ['-D', dataDir, 'status']);
      if (status.status === 0) {
        const stop = native('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
        record('stop', stop);
        if (stop.status !== 0) throw new Error('LOCAL_POSTGRES_STOP_FAILED');
      } else if (status.status !== 3) throw new Error('LOCAL_POSTGRES_STATUS_UNKNOWN');
      if (native('pg_ctl', ['-D', dataDir, 'status']).status !== 3) throw new Error('LOCAL_POSTGRES_STOP_UNVERIFIED');
    }
    console.log(JSON.stringify({ status: startupAttempted ? 'LOCAL_CLUSTER_STOPPED' : 'LOCAL_CLUSTER_NOT_STARTED',
      stopped: startupAttempted, cloudChanges: false,
      artifacts: relative(root, dataDir).replaceAll('\\', '/') }));
  }
}
main().catch(error => {
  // Never serialize a pg Error, connection URL or inherited environment.
  console.error(JSON.stringify({ status: 'LOCAL_LOADTEST_TESTS_FAILED',
    code: /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_TEST_RUNNER_FAILED', cloudChanges: false }));
  process.exitCode = 1;
});
