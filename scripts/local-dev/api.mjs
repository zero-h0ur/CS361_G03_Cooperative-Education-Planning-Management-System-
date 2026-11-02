import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { localConfig, useLocalDatabase, issuer, audience, sessionFile } from './config.mjs';
import { personas } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { createApiServer } = require('../../src/api/app');
const { TokenValidator } = require('../../src/auth/token-validator');
const connection = require('../../src/db/connection');

export async function startLocalApi({ port, persistSessions = false } = {}) {
  const config = localConfig();
  useLocalDatabase(config.runtimeUrl);
  const pool = new Pool({ connectionString: config.runtimeUrl });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const instance = randomUUID();
  const server = createApiServer({ pool, authOptions: {
    pool, allowBearerFallback: true,
    tokenValidator: new TokenValidator({ expectedIssuer: issuer, expectedClientId: audience, publicKey })
  } });
  const tokens = () => {
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    return { instance, expiresAt: now + 3600, tokens: Object.fromEntries(personas.map(p => {
      const input = `${header}.${encode({ iss: issuer, sub: p.subject, client_id: audience,
        token_use: 'access', scope: 'coed-api/access', iat: now, exp: now + 3600 })}`;
      return [p.name, `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`];
    })) };
  };
  let timer;
  const publish = async () => {
    await mkdir(new URL('./', sessionFile), { recursive: true, mode: 0o700 });
    await writeFile(sessionFile, JSON.stringify(tokens()), { mode: 0o600 });
  };
  try {
    await pool.query('SELECT 1 FROM selection_cohorts LIMIT 1');
    await new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(port ?? config.apiPort, '127.0.0.1', () => { server.off('error', fail); ok(); });
    });
    if (persistSessions) {
      await publish();
      timer = setInterval(() => publish().catch(() => console.error('Cannot refresh local session file.')), 45 * 60 * 1000);
      timer.unref();
    }
  } catch (error) { if (server.listening) server.close(); await pool.end(); throw error; }
  return { server, tokens, baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
      await pool.end();
      await connection.close();
      if (persistSessions) {
        const saved = await readFile(sessionFile, 'utf8').then(JSON.parse).catch(() => null);
        if (saved?.instance === instance) await unlink(sessionFile).catch(() => {});
      }
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const api = await startLocalApi({ persistSessions: true });
  console.log(`Local API (synthetic identities only): ${api.baseUrl}`);
  console.log('Get a local token with: npm run dev:token -- student01');
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (!stopping) { stopping = true; api.close().then(() => process.exit(0)).catch(() => process.exit(1)); }
  });
}
