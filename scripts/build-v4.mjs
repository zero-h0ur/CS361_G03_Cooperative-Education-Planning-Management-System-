import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Public browser identifiers only. No AWS session or database credentials required.
// Pin the destination so a leftover Lab environment cannot redirect this build.
const root = fileURLToPath(new URL('../', import.meta.url));
const target = JSON.parse(await readFile(new URL('../config/v4-public.json', import.meta.url), 'utf8'));
const result = spawnSync(process.execPath, ['scripts/build-frontend.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    CO_ED_REQUIRE_AUTH_CONFIG: '1',
    CO_ED_API_BASE_URL: target.apiBaseUrl,
    CO_ED_APP_ORIGIN: target.appOrigin,
    CO_ED_COGNITO_USER_POOL_ID: target.cognito.userPoolId,
    CO_ED_COGNITO_CLIENT_ID: target.cognito.userPoolClientId,
    CO_ED_COGNITO_DOMAIN: target.cognito.domain
  }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
