import { readFile } from 'node:fs/promises';
import { localConfig, sessionFile } from './config.mjs';
import { personas } from './fixtures.mjs';
localConfig();
const name = process.argv[2];
if (process.argv.length !== 3 || !personas.some(p => p.name === name)) {
  throw new Error(`Choose one local persona: ${personas.map(p => p.name).join(', ')}`);
}
const session = await readFile(sessionFile, 'utf8').then(JSON.parse).catch(() => null);
if (!session || session.expiresAt <= Date.now() / 1000 || !session.tokens[name]) {
  throw new Error('Start npm run dev:api first; the local session is missing or expired.');
}
console.log(session.tokens[name]);
