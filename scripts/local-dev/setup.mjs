import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { localConfig, useLocalDatabase } from './config.mjs';
import { addLocalFixtures } from './fixtures.mjs';
const require = createRequire(import.meta.url);

if (process.argv.slice(2).join(' ') !== '--reset') throw new Error('Use --reset to replace only the disposable local coed_dev fixtures.');
const { seed } = require('../../src/db/seed');
const connection = require('../../src/db/connection');
const config = localConfig();
useLocalDatabase(config.adminUrl, { reset: true });
try {
  await seed({ includeV3: true });
  await addLocalFixtures(connection.getPool());
  const policy = (await readFile(new URL('../../src/db/operations/v3-runtime-grants.sql', import.meta.url), 'utf8'))
    .replace(/^\\set[^\n]*\n/gm, '');
  await connection.getPool().query(policy);
  console.log('Local fixtures ready: student01, staff01, advisor01, admin01, coordinator01, committee01–03. No AWS accounts created.');
} finally { await connection.close(); }
