require('dotenv').config();
const { Pool } = require('pg');

let pool = null;

function getConnectionString() {
  if (process.env.NODE_ENV === 'test') {
    const testUrl = process.env.TEST_DATABASE_URL;

    if (!testUrl) {
      throw new Error('TEST_DATABASE_URL is required when NODE_ENV=test.');
    }
    if (testUrl === process.env.DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL.');
    }

    return testUrl;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  return process.env.DATABASE_URL;
}

function initPool() {
  pool = new Pool({
    connectionString: getConnectionString(),
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '2000', 10),
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '5000', 10),
  });
  
  pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
  });
}

function getPool() {
  if (!pool) initPool();
  return pool;
}

module.exports = {
  query: (text, params) => getPool().query(text, params),
  getPool,
  close: async () => {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};
