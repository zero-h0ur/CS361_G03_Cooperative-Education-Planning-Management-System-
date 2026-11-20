import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, prepareLocal, readJson, fail } from './database.mjs';

export async function main(args, env = process.env) {
  const [command, manifestPath, datasetPath, ...extra] = args;
  if (!['plan', 'trial', 'apply', 'check'].includes(command) || !manifestPath || !datasetPath || extra.length) fail('INVALID_ARGUMENTS');
  const manifest = readJson(manifestPath), dataset = readJson(datasetPath);
  if (command === 'plan') return { status: 'OFFLINE_PLAN_ONLY', ...buildPlan(manifest, dataset) };
  return prepareLocal({ command, manifest, dataset, env, connectionString: env.LOADTEST_PREP_TEST_DATABASE_URL });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'LOADTEST_PREPARATION_FAILED',
      code: /^[A-Z][A-Z_]+$/.test(error.code || '') ? error.code : 'PREPARATION_FAILED', cloudChanges: false }));
    process.exitCode = 1;
  });
}
