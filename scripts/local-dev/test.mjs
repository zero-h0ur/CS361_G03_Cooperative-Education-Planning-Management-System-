import { spawnSync } from 'node:child_process';
import { localConfig, root } from './config.mjs';
const config = localConfig();
const npmCli = process.env.npm_execpath;
if (!npmCli || !npmCli.endsWith('.js')) throw new Error('Run this wrapper with npm run test:local.');
// Invoke npm through Node directly, including Windows, without a command shell.
const result = spawnSync(process.execPath, [npmCli, 'test'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', ALLOW_DB_RESET: 'true',
    DATABASE_URL: config.adminUrl, TEST_DATABASE_URL: config.testUrl,
    CO_ED_WORKFLOW_TEST_DATABASE_URL: config.testUrl, CO_ED_SELECTION_TEST_DATABASE_URL: config.selectionUrl,
    CO_ED_APPLICATION_TEST_DATABASE_URL: config.testUrl }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
