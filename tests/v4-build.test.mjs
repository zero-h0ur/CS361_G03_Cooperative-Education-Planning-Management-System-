import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const target = JSON.parse(await readFile(new URL('../config/v4-public.json', import.meta.url), 'utf8'));

test('V4 artifact stays on the new account despite inherited configuration from another target', async () => {
  const result = spawnSync(process.execPath, ['scripts/build-v4.mjs'], {
    cwd, encoding: 'utf8', env: {
      ...process.env,
      CO_ED_API_BASE_URL: 'https://old-api.example.invalid',
      CO_ED_APP_ORIGIN: 'https://old-web.example.invalid',
      CO_ED_COGNITO_USER_POOL_ID: 'us-east-1_oldPool',
      CO_ED_COGNITO_CLIENT_ID: 'old-client',
      CO_ED_COGNITO_DOMAIN: 'old-auth.example.invalid'
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const script = await readFile(new URL('../dist/runtime-config.js', import.meta.url), 'utf8');
  const context = { window: {} };
  runInNewContext(script, context);
  const actual = JSON.parse(JSON.stringify(context.window.CO_ED_CONFIG));
  assert.deepEqual(actual, {
    apiBaseUrl: target.apiBaseUrl,
    auth: {
      userPoolId: target.cognito.userPoolId,
      userPoolClientId: target.cognito.userPoolClientId,
      domain: target.cognito.domain,
      redirectSignIn: `${target.appOrigin}/app.html`,
      redirectSignOut: `${target.appOrigin}/index.html`,
      scopes: ['openid', 'email', 'coed-api/access']
    }
  });
  assert.ok(!script.includes('example.invalid'));
  // A strict generic build must not silently mix an explicit Cognito pool with a default API.
  const env = { ...process.env, NODE_ENV: 'production', CO_ED_REQUIRE_AUTH_CONFIG: '1',
    CO_ED_COGNITO_USER_POOL_ID: target.cognito.userPoolId,
    CO_ED_COGNITO_CLIENT_ID: target.cognito.userPoolClientId,
    CO_ED_COGNITO_DOMAIN: target.cognito.domain, CO_ED_APP_ORIGIN: target.appOrigin };
  delete env.CO_ED_API_BASE_URL;
  const denied = spawnSync(process.execPath, ['scripts/build-frontend.mjs'], { cwd, env, encoding: 'utf8' });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /Missing required public auth configuration: CO_ED_API_BASE_URL/);
  assert.equal(await readFile(new URL('../dist/runtime-config.js', import.meta.url), 'utf8'), script);
});
