const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getPool, close } = require('./connection');

const MIGRATION_LOCK_KEY = '563003056';
const INITIAL_MIGRATION = '001_initial_schema.sql';

function checksum(contents) {
  return crypto.createHash('sha256').update(contents, 'utf8').digest('hex');
}

function readMigrations(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      return { file, sql, checksum: checksum(sql) };
    });
}

async function verifyInitialSchema(client) {
  const requiredColumns = [
    ['companies', 'id'],
    ['companies', 'visibility'],
    ['positions', 'id'],
    ['positions', 'company_id'],
    ['rounds', 'id'],
    ['rounds', 'academic_year'],
    ['document_metadata', 'id'],
    ['students', 'id'],
    ['students', 'anonymous_ref'],
    ['plans', 'id'],
    ['plans', 'student_id'],
    ['plans', 'round_id'],
  ];

  const values = requiredColumns
    .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
    .join(', ');
  const params = requiredColumns.flat();
  const result = await client.query(
    `
      WITH required(table_name, column_name) AS (VALUES ${values})
      SELECT required.table_name, required.column_name
      FROM required
      LEFT JOIN information_schema.columns actual
        ON actual.table_schema = current_schema()
       AND actual.table_name = required.table_name
       AND actual.column_name = required.column_name
      WHERE actual.column_name IS NULL
      ORDER BY required.table_name, required.column_name
    `,
    params
  );

  if (result.rows.length > 0) {
    const missing = result.rows
      .map((row) => `${row.table_name}.${row.column_name}`)
      .join(', ');
    throw new Error(
      `Cannot backfill checksum for ${INITIAL_MIGRATION}: ` +
      `the existing V2 schema is missing ${missing}.`
    );
  }
}

async function ensureChecksumTracking(client, migrationsByFile) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    ALTER TABLE schema_migrations
    ADD COLUMN IF NOT EXISTS checksum TEXT
  `);

  const result = await client.query(`
    SELECT version, checksum
    FROM schema_migrations
    ORDER BY version
  `);

  for (const applied of result.rows) {
    const migration = migrationsByFile.get(applied.version);
    if (!migration) {
      throw new Error(
        `Applied migration ${applied.version} is missing from the migrations directory.`
      );
    }

    if (applied.checksum === null) {
      if (applied.version !== INITIAL_MIGRATION) {
        throw new Error(
          `Applied migration ${applied.version} has no checksum and cannot be verified safely.`
        );
      }
      await verifyInitialSchema(client);
      await client.query(
        `UPDATE schema_migrations SET checksum = $1 WHERE version = $2 AND checksum IS NULL`,
        [migration.checksum, applied.version]
      );
      applied.checksum = migration.checksum;
    }

    if (applied.checksum !== migration.checksum) {
      throw new Error(
        `Migration checksum mismatch for ${applied.version}. ` +
        'Applied migrations are immutable; create a new forward-only migration.'
      );
    }
  }

  await client.query(`
    ALTER TABLE schema_migrations
    ALTER COLUMN checksum SET NOT NULL
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'schema_migrations'::regclass
          AND conname = 'chk_schema_migrations_checksum'
      ) THEN
        ALTER TABLE schema_migrations
        ADD CONSTRAINT chk_schema_migrations_checksum
        CHECK (checksum ~ '^[0-9a-f]{64}$');
      END IF;
    END
    $$
  `);

  return new Set(result.rows.map((row) => row.version));
}

async function migrate(options = {}) {
  const pool = options.pool || getPool();
  const logger = options.logger || console;
  const migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');
  const migrations = readMigrations(migrationsDir);
  const migrationsByFile = new Map(migrations.map((migration) => [migration.file, migration]));
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Serialize deploys before any runner reads migration state.
    await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [MIGRATION_LOCK_KEY]);
    const applied = await ensureChecksumTracking(client, migrationsByFile);

    for (const migration of migrations) {
      if (applied.has(migration.file)) continue;

      logger.log(`Applying migration: ${migration.file}`);
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
        [migration.file, migration.checksum]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;
    logger.log('Migrations applied successfully.');
  } catch (err) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    logger.error('Migration failed', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().then(() => close()).catch(() => {
    process.exit(1);
  });
}

module.exports = { migrate };
