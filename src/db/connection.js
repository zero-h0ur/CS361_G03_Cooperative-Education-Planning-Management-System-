require('dotenv').config();
const { Pool } = require('pg');
const { readFileSync } = require('node:fs');
const { createRdsPasswordProvider } = require('./rds-secret');

let pool = null;

function getConnectionString(env = process.env) {
  if (env.NODE_ENV === 'test') {
    const testUrl = env.TEST_DATABASE_URL;

    if (!testUrl) {
      throw new Error('TEST_DATABASE_URL is required when NODE_ENV=test.');
    }
    if (testUrl === env.DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL.');
    }

    return testUrl;
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  return env.DATABASE_URL;
}

function getDatabaseConfig(env = process.env, { readCa = readFileSync,
  createPassword = createRdsPasswordProvider } = {}) {
  // Test mode never fetches a production secret, even if inherited from the shell.
  if (env.NODE_ENV === 'test' || env.DB_SECRET_ARN === undefined) {
    return { connectionString: getConnectionString(env) };
  }
  const expected = {
    host: env.DB_HOST, database: env.DB_NAME, user: env.DB_USER,
    port: Number(env.DB_PORT || '5432')
  };
  if (!expected.host || !/^[a-zA-Z0-9.-]+$/.test(expected.host)
      || !expected.database || !expected.user || expected.user !== expected.user.trim()
      || ['postgres', 'rdsadmin'].includes(expected.user.toLowerCase())
      || !Number.isInteger(expected.port) || expected.port < 1 || expected.port > 65535
      || !env.DB_SSL_CA_FILE) throw new Error('Invalid database secret configuration.');
  // No connectionString is passed in secret mode: neither URL credentials nor URL
  // SSL parameters can override the password callback or certificate validation.
  return {
    ...expected,
    password: createPassword({ secretArn: env.DB_SECRET_ARN, expected }),
    ssl: { rejectUnauthorized: true, ca: readCa(env.DB_SSL_CA_FILE, 'utf8') }
  };
}

function initPool() {
  pool = new Pool({
    ...getDatabaseConfig(),
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '2000', 10),
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '5000', 10),
  });
  
  pool.on('error', () => {
    // PostgreSQL errors can contain query/private data; never log the raw object.
    console.error('Unexpected database pool error.');
  });
}

function getPool() {
  if (!pool) initPool();
  return pool;
}

module.exports = {
  query: (text, params) => getPool().query(text, params),
  getPool,
  getDatabaseConfig,
  close: async () => {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};
