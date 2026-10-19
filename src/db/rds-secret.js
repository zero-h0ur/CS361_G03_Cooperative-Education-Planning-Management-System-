const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const SECRET_ARN = /^arn:(aws|aws-us-gov|aws-cn):secretsmanager:([a-z0-9-]+):\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/;

function unavailable() {
  const error = new Error('Database credentials unavailable.');
  error.code = 'DB_CREDENTIALS_UNAVAILABLE';
  return error;
}

// Secrets remain only in memory. Only the configured database identity is accepted;
// changing endpoints or switching to a privileged account requires a reviewed deploy.
function createRdsPasswordProvider({ secretArn, expected, client, now = Date.now,
  ttlMs = 300000, timeoutMs = 2500 } = {}) {
  const match = typeof secretArn === 'string' && secretArn.match(SECRET_ARN);
  if (!match || !expected || !Number.isInteger(ttlMs) || ttlMs < 0 || ttlMs > 300000
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw unavailable();
  const secrets = client || new SecretsManagerClient({
    region: match[2], maxAttempts: 2,
    requestHandler: { connectionTimeout: 1000, requestTimeout: timeoutMs, throwOnRequestTimeout: true }
  });
  let cached = null;
  let expiresAt = 0;
  let pending = null;

  function readPassword(response) {
    if (typeof response?.SecretString !== 'string') throw unavailable();
    const value = JSON.parse(response.SecretString);
    if (!value || Array.isArray(value) || value.engine !== 'postgres'
        || value.host !== expected.host || value.dbname !== expected.database
        || value.username !== expected.user || Number(value.port) !== expected.port
        || typeof value.password !== 'string' || value.password.length === 0) throw unavailable();
    return value.password;
  }

  return function getPassword() {
    if (cached !== null && now() < expiresAt) return Promise.resolve(cached);
    if (pending) return pending;
    const abort = new AbortController();
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(unavailable()); }, timeoutMs);
    });
    pending = (async () => {
      try {
        const response = await Promise.race([
          Promise.resolve().then(() => secrets.send(
            new GetSecretValueCommand({ SecretId: secretArn, VersionStage: 'AWSCURRENT' }),
            { abortSignal: abort.signal })), deadline
        ]);
        cached = readPassword(response);
        expiresAt = now() + ttlMs;
        return cached;
      } catch {
        cached = null;
        expiresAt = 0;
        // Never expose an SDK error, secret value, ARN or original cause in logs/errors.
        throw unavailable();
      } finally {
        clearTimeout(timer);
        pending = null;
      }
    })();
    return pending;
  };
}

module.exports = { createRdsPasswordProvider };
