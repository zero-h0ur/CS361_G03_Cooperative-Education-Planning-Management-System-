const fs = require('fs');
const path = require('path');
const { getPool, close } = require('./connection');

const { migrate } = require('./migrate');

async function seed() {
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error('Seed/Reset is only allowed in development or test environment.');
  }
  if (process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('Seed/Reset requires ALLOW_DB_RESET=true flag.');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('Starting seed process...');
    
    // 1. Run migrations via migrate()
    console.log('Running migrations...');
    await migrate();

    await client.query('BEGIN');

    // 2. Load dataset
    console.log('Loading dataset...');
    const datasetPath = path.join(__dirname, '..', '..', 'data', 'v2', 'mock-dataset.json');
    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

    // 3. Reset tables (Delete in reverse order of dependencies)
    console.log('Resetting tables...');
    await client.query('DELETE FROM plans');
    await client.query('DELETE FROM students');
    await client.query('DELETE FROM document_metadata');
    await client.query('DELETE FROM rounds');
    await client.query('DELETE FROM positions');
    await client.query('DELETE FROM companies');

    // 4. Seed data
    console.log('Seeding companies...');
    for (const c of dataset.companies) {
      await client.query(
        `INSERT INTO companies (id, name, description, website_url, location, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.id, c.name, c.description || null, c.website_url || null, c.location || null, c.source, c.updated_at, c.visibility, c.data_status]
      );
    }

    console.log('Seeding positions...');
    for (const p of dataset.positions) {
      await client.query(
        `INSERT INTO positions (id, company_id, title, description, location, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, p.company_id, p.title, p.description || null, p.location || null, p.source, p.updated_at, p.visibility, p.data_status]
      );
    }

    console.log('Seeding rounds...');
    for (const r of dataset.rounds) {
      await client.query(
        `INSERT INTO rounds (id, name, academic_year, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, r.name, r.academic_year, r.source, r.updated_at, r.visibility, r.data_status]
      );
    }

    console.log('Seeding document_metadata...');
    for (const d of dataset.document_metadata) {
      await client.query(
        `INSERT INTO document_metadata (id, title, public_url, academic_year, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [d.id, d.title, d.public_url, d.academic_year || null, d.source, d.updated_at, d.visibility, d.data_status]
      );
    }

    console.log('Seeding students...');
    for (const s of dataset.students) {
      await client.query(
        `INSERT INTO students (id, anonymous_ref, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.id, s.anonymous_ref, s.source, s.updated_at, s.visibility, s.data_status]
      );
    }

    console.log('Seeding plans...');
    for (const p of dataset.plans) {
      await client.query(
        `INSERT INTO plans (id, student_id, round_id, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.id, p.student_id, p.round_id || null, p.source, p.updated_at, p.visibility, p.data_status]
      );
    }

    // Verify record count
    const tables = ['companies', 'positions', 'rounds', 'document_metadata', 'students', 'plans'];
    let totalCount = 0;
    for (const table of tables) {
      const res = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
      totalCount += parseInt(res.rows[0].count, 10);
    }

    if (totalCount !== 53) {
      throw new Error(`Expected 53 records, but got ${totalCount} records after seed.`);
    }

    await client.query('COMMIT');
    console.log('Seed process completed successfully. Total records:', totalCount);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed process failed, rolling back.', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed().then(() => close()).catch(() => process.exit(1));
}

module.exports = { seed };
