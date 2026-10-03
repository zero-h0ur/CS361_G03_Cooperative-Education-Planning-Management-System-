require('dotenv').config();
const { Pool } = require('pg');

let pool = null;

function initPool() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '2000', 10),
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '5000', 10),
  });
  
  pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
  });
}

initPool();

module.exports = {
  query: (text, params) => pool.query(text, params),
  getPool: () => {
    if (!pool) initPool();
    return pool;
  },
  close: async () => {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};
