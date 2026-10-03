import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, getClient } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Run Migration
    const migrationPath = path.join(__dirname, '../migrations/001-v2-initial-schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    console.log('Running migration...');
    await client.query(sql);
    console.log('Migration successful.');

    // 2. Load Mock Data
    const dataPath = path.join(__dirname, '../data/seed/canonical-mock-data.json');
    const dataRaw = fs.readFileSync(dataPath, 'utf-8');
    const dataset = JSON.parse(dataRaw);
    
    // 3. Clear existing data in correct order
    console.log('Clearing existing data...');
    await client.query('DELETE FROM plans');
    await client.query('DELETE FROM students');
    await client.query('DELETE FROM document_metadata');
    await client.query('DELETE FROM rounds');
    await client.query('DELETE FROM positions');
    await client.query('DELETE FROM companies');

    // 4. Insert data
    console.log('Inserting companies...');
    for (const c of dataset.companies) {
      await client.query(
        'INSERT INTO companies (id, name, description, website_url, location, source, updated_at, visibility, data_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [c.id, c.name, c.description || null, c.website_url || null, c.location || null, c.source, c.updated_at, c.visibility, c.data_status]
      );
    }

    console.log('Inserting positions...');
    for (const p of dataset.positions) {
      await client.query(
        'INSERT INTO positions (id, company_id, title, description, location, source, updated_at, visibility, data_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [p.id, p.company_id, p.title, p.description || null, p.location || null, p.source, p.updated_at, p.visibility, p.data_status]
      );
    }

    console.log('Inserting rounds...');
    for (const r of dataset.rounds) {
      await client.query(
        'INSERT INTO rounds (id, name, academic_year, source, updated_at, visibility, data_status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [r.id, r.name, r.academic_year, r.source, r.updated_at, r.visibility, r.data_status]
      );
    }

    console.log('Inserting documents...');
    for (const d of dataset.document_metadata) {
      await client.query(
        'INSERT INTO document_metadata (id, title, public_url, academic_year, source, updated_at, visibility, data_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [d.id, d.title, d.public_url, d.academic_year || null, d.source, d.updated_at, d.visibility, d.data_status]
      );
    }

    console.log('Inserting students...');
    for (const s of dataset.students) {
      await client.query(
        'INSERT INTO students (id, anonymous_ref, source, updated_at, visibility, data_status) VALUES ($1, $2, $3, $4, $5, $6)',
        [s.id, s.anonymous_ref, s.source, s.updated_at, s.visibility, s.data_status]
      );
    }

    console.log('Inserting plans...');
    for (const p of dataset.plans) {
      await client.query(
        'INSERT INTO plans (id, student_id, round_id, source, updated_at, visibility, data_status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [p.id, p.student_id, p.round_id || null, p.source, p.updated_at, p.visibility, p.data_status]
      );
    }

    await client.query('COMMIT');
    console.log('Database seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during seed:', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

runSeed();

