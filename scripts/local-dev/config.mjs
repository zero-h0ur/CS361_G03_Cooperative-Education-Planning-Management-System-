import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const issuer = 'https://coed-local.example.invalid';
export const audience = 'coed-local-client';
export const sessionFile = new URL('../../tmp/local-dev/session.json', import.meta.url);

function port(value, fallback) {
  const n = Number(value || fallback);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('Local port must be an integer from 1024 to 65535.');
  return n;
}
export function localConfig(env = process.env) {
  if (env.AWS_EXECUTION_ENV || env.LAMBDA_TASK_ROOT || ['production', 'prod', 'staging'].includes(env.NODE_ENV)) {
    throw new Error('Local development commands cannot run in a deployed environment.');
  }
  const dbPort = port(env.CO_ED_LOCAL_DB_PORT, 54329);
  return {
    apiPort: port(env.CO_ED_LOCAL_API_PORT, 3001),
    adminUrl: `postgres://postgres:coed_local_only@127.0.0.1:${dbPort}/coed_dev`,
    runtimeUrl: `postgres://coed_app:coed_local_runtime_only@127.0.0.1:${dbPort}/coed_dev`,
    testUrl: `postgres://postgres:coed_local_only@127.0.0.1:${dbPort}/coed_v3_test`,
    selectionUrl: `postgres://postgres:coed_local_only@127.0.0.1:${dbPort}/coed_selection_test`
  };
}
export function useLocalDatabase(connectionString, { reset = false } = {}) {
  const c = localConfig();
  if (![c.adminUrl, c.runtimeUrl].includes(connectionString)) throw new Error('Only the fixed loopback coed_dev database is allowed.');
  delete process.env.DB_SECRET_ARN;
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL = connectionString;
  process.env.TEST_DATABASE_URL = c.testUrl;
  process.env.ALLOW_DB_RESET = String(reset);
  process.env.AUTH_ISSUER = issuer;
  process.env.AUTH_AUDIENCE = audience;
}
