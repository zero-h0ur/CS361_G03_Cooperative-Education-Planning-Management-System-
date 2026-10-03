import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Use environment variables for configuration
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
});

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // Log operation without sensitive data
    console.debug(`[DB] Executed query`, { 
      duration, 
      rows: res.rowCount, 
      success: true 
    });
    return res;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[DB] Query error`, {
      duration,
      success: false,
      error_category: 'DatabaseError'
    });
    throw error;
  }
}

export function getClient() {
  return pool.connect();
}

export async function endPool() {
  await pool.end();
}
