import { readFileSync } from 'node:fs';
import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createBootstrap, TARGET } from './b2-bootstrap.mjs';
const root = process.env.LAMBDA_TASK_ROOT;
const config = JSON.parse(readFileSync(`${root}/config.json`, 'utf8'));
const payload = JSON.parse(readFileSync(`${root}/payload.json`, 'utf8'));
const ca = readFileSync(`${root}/global-bundle.pem`, 'utf8');
const secrets = new SecretsManagerClient({ region: TARGET.region, maxAttempts: 2,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 5000, throwOnRequestTimeout: true } });
export const handler = createBootstrap({ config, payload,
  secretReader: async arn => (await secrets.send(new GetSecretValueCommand({ SecretId: arn, VersionStage: 'AWSCURRENT' }))).SecretString,
  connect: async ({ user, password }) => {
    const client = new pg.Client({ host: TARGET.host, port: TARGET.port, database: TARGET.database, user, password,
      ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 5000, query_timeout: 60000,
      application_name: 'coed-loadtest-b2a-bootstrap' });
    client.on('error', () => {}); await client.connect(); return client;
  }
});
