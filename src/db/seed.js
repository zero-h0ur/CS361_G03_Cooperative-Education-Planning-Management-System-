const fs = require('fs');
const path = require('path');
const { getPool, close } = require('./connection');
const { migrate } = require('./migrate');

/**
 * Validates that destructive seed / reset operations are strictly allowed in the current environment.
 * Throws a descriptive Error if any safety check fails.
 */
function assertDestructiveResetAllowed() {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  if (env !== 'development' && env !== 'test') {
    throw new Error(
      `Destructive seed/reset blocked: NODE_ENV must strictly be 'development' or 'test'. Current: '${process.env.NODE_ENV || ''}'`
    );
  }

  if (process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('Destructive seed/reset blocked: ALLOW_DB_RESET=true flag is required.');
  }

  // Guard against staging or production stage identifiers
  const stage = (process.env.STAGE || process.env.APP_ENV || '').toLowerCase();
  if (['production', 'prod', 'staging', 'stage', 'uat'].includes(stage)) {
    throw new Error(
      `Destructive seed/reset blocked: Environment stage '${stage}' does not permit destructive reset.`
    );
  }

  // Heuristic defense-in-depth: Guard against connection strings clearly named staging/production.
  // Note: RDS hostnames typically use random hashes; authoritative protection relies on NODE_ENV and ALLOW_DB_RESET.
  const targetUrl = env === 'test' ? (process.env.TEST_DATABASE_URL || '') : (process.env.DATABASE_URL || '');
  if (/(prod|production|staging)/i.test(targetUrl)) {
    throw new Error(
      'Destructive seed/reset blocked: Target database URL appears to match a production or staging instance.'
    );
  }

  if (env === 'test') {
    if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error('Test reset requires a TEST_DATABASE_URL that differs from DATABASE_URL.');
    }
  }
}

/**
 * Seed database with V2 mock data and optionally V3 synthetic fixtures.
 *
 * @param {object} [options]
 * @param {boolean} [options.includeV3] Whether to include V3 fixtures (defaults to false for V2 unit tests)
 * @returns {Promise<{ totalV2Records: number, totalV3Records?: number }>}
 */
async function seed(options = {}) {
  assertDestructiveResetAllowed();

  const includeV3 =
    options.includeV3 !== undefined
      ? Boolean(options.includeV3)
      : process.env.SEED_V3 === 'true';

  console.log(`Starting seed process (includeV3: ${includeV3})...`);

  // Run migrations before reserving a client so seeding also works with a pool size of 1.
  console.log('Running migrations...');
  await migrate();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Inside this protected reset transaction (development/test + ALLOW_DB_RESET=true),
    // temporarily disable deletion and immutability triggers on protected tables.
    await client.query(`
      ALTER TABLE plans DISABLE TRIGGER trg_plans_no_delete;
      ALTER TABLE plans DISABLE TRIGGER trg_plans_legacy_compatibility_guard;
      ALTER TABLE advisor_assignments DISABLE TRIGGER trg_advisor_assignments_no_delete;
      ALTER TABLE plan_operations DISABLE TRIGGER trg_plan_operations_immutable;
      ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;
    `);

    // 1. Reset tables in reverse order of foreign key dependencies
    console.log('Resetting tables...');
    await client.query('DELETE FROM audit_events');
    await client.query('DELETE FROM plan_operations');
    await client.query('DELETE FROM advisor_assignments');
    await client.query('DELETE FROM staff_scopes');
    await client.query('DELETE FROM plans');
    await client.query('DELETE FROM students');
    await client.query('DELETE FROM external_identity_links');
    await client.query('DELETE FROM users');
    await client.query('DELETE FROM document_metadata');
    await client.query('DELETE FROM rounds');
    await client.query('DELETE FROM positions');
    await client.query('DELETE FROM companies');

    // 2. Load and seed V2 canonical dataset
    console.log('Loading V2 dataset...');
    const v2DatasetPath = path.join(__dirname, '..', '..', 'data', 'v2', 'mock-dataset.json');
    const v2Dataset = JSON.parse(fs.readFileSync(v2DatasetPath, 'utf8'));

    console.log('Seeding V2 companies...');
    for (const c of v2Dataset.companies) {
      await client.query(
        `INSERT INTO companies (id, name, description, website_url, location, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.id, c.name, c.description || null, c.website_url || null, c.location || null, c.source, c.updated_at, c.visibility, c.data_status]
      );
    }

    console.log('Seeding V2 positions...');
    for (const p of v2Dataset.positions) {
      await client.query(
        `INSERT INTO positions (id, company_id, title, description, location, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, p.company_id, p.title, p.description || null, p.location || null, p.source, p.updated_at, p.visibility, p.data_status]
      );
    }

    console.log('Seeding V2 rounds...');
    for (const r of v2Dataset.rounds) {
      await client.query(
        `INSERT INTO rounds (
           id, name, academic_year, source, updated_at,
           visibility, data_status, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'CLOSED')`,
        [r.id, r.name, r.academic_year, r.source, r.updated_at, r.visibility, r.data_status]
      );
    }

    console.log('Seeding V2 document_metadata...');
    for (const d of v2Dataset.document_metadata) {
      await client.query(
        `INSERT INTO document_metadata (id, title, public_url, academic_year, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [d.id, d.title, d.public_url, d.academic_year || null, d.source, d.updated_at, d.visibility, d.data_status]
      );
    }

    console.log('Seeding V2 students (legacy unlinked)...');
    for (const s of v2Dataset.students) {
      await client.query(
        `INSERT INTO students (id, anonymous_ref, source, updated_at, visibility, data_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.id, s.anonymous_ref, s.source, s.updated_at, s.visibility, s.data_status]
      );
    }

    console.log('Seeding V2 plans (legacy compatibility)...');
    for (const p of v2Dataset.plans) {
      await client.query(
        `INSERT INTO plans (
           id, student_id, round_id, cycle_id, source, updated_at,
           visibility, data_status, status, version, legacy_compatibility
         )
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 'DRAFT', 1, TRUE)`,
        [p.id, p.student_id, p.round_id || null, p.source, p.updated_at, p.visibility, p.data_status]
      );
    }

    let totalV3Records = 0;

    // 3. Seed V3 synthetic fixtures if requested
    if (includeV3) {
      console.log('Loading V3 fixtures...');
      const v3FixturesPath = path.join(__dirname, '..', '..', 'data', 'v3', 'fixtures.json');
      const v3Fixtures = JSON.parse(fs.readFileSync(v3FixturesPath, 'utf8'));

      console.log('Seeding V3 users...');
      for (const u of v3Fixtures.users) {
        await client.query(
          `INSERT INTO users (id, role, account_status, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [u.id, u.role, u.account_status, u.version, u.created_at, u.updated_at]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 external identity links...');
      for (const l of v3Fixtures.external_identity_links) {
        await client.query(
          `INSERT INTO external_identity_links (
             id, user_id, external_issuer, external_subject, status,
             revoked_at, revoked_by, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            l.id,
            l.user_id,
            l.external_issuer,
            l.external_subject,
            l.status,
            l.revoked_at || null,
            l.revoked_by || null,
            l.created_at,
            l.updated_at,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 students (linked profiles)...');
      for (const s of v3Fixtures.students) {
        await client.query(
          `INSERT INTO students (
             id, user_id, anonymous_ref, student_number, full_name, preferred_name,
             institutional_email, department, program, major, academic_year,
             enrollment_status, source, visibility, data_status, version, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            s.id,
            s.user_id,
            s.anonymous_ref,
            s.student_number,
            s.full_name,
            s.preferred_name || null,
            s.institutional_email,
            s.department,
            s.program,
            s.major,
            s.academic_year,
            s.enrollment_status,
            s.source,
            s.visibility,
            s.data_status,
            s.version || 1,
            s.created_at,
            s.updated_at,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 rounds (cycles)...');
      for (const r of v3Fixtures.rounds) {
        await client.query(
          `INSERT INTO rounds (
             id, name, academic_year, semester, source, updated_at,
             visibility, data_status, status, end_date
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             academic_year = EXCLUDED.academic_year,
             semester = EXCLUDED.semester,
             status = EXCLUDED.status,
             end_date = EXCLUDED.end_date,
             updated_at = EXCLUDED.updated_at`,
          [
            r.id,
            r.name,
            r.academic_year,
            r.semester || null,
            r.source,
            r.updated_at,
            r.visibility,
            r.data_status,
            r.status,
            r.end_date || null,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 plans...');
      for (const p of v3Fixtures.plans) {
        await client.query(
          `INSERT INTO plans (
             id, student_id, round_id, cycle_id, company_id, position_id,
             notes, status, version, legacy_compatibility, source,
             visibility, data_status, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            p.id,
            p.student_id,
            p.round_id || null,
            p.cycle_id || null,
            p.company_id || null,
            p.position_id || null,
            p.notes || null,
            p.status,
            p.version || 1,
            Boolean(p.legacy_compatibility),
            p.source,
            p.visibility,
            p.data_status,
            p.created_at,
            p.updated_at,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 advisor assignments...');
      for (const a of v3Fixtures.advisor_assignments) {
        await client.query(
          `INSERT INTO advisor_assignments (
             id, advisor_id, student_id, academic_year, semester, status,
             effective_from, effective_to, revoked_at, revoked_by,
             revocation_reason, assigned_by, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            a.id,
            a.advisor_id,
            a.student_id,
            a.academic_year,
            a.semester,
            a.status,
            a.effective_from,
            a.effective_to,
            a.revoked_at || null,
            a.revoked_by || null,
            a.revocation_reason || null,
            a.assigned_by,
            a.created_at,
            a.updated_at,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 staff scopes...');
      for (const sc of v3Fixtures.staff_scopes) {
        await client.query(
          `INSERT INTO staff_scopes (
             id, staff_id, department, program, academic_year, status, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            sc.id,
            sc.staff_id,
            sc.department,
            sc.program || null,
            sc.academic_year || null,
            sc.status,
            sc.created_at,
            sc.updated_at,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 plan operations...');
      for (const op of v3Fixtures.plan_operations) {
        await client.query(
          `INSERT INTO plan_operations (
             operation_id, plan_id, actor_id, action, request_hash,
             response_status, response_payload, result_version, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            op.operation_id,
            op.plan_id,
            op.actor_id,
            op.action,
            op.request_hash,
            op.response_status,
            JSON.stringify(op.response_payload),
            op.result_version,
            op.created_at,
          ]
        );
        totalV3Records += 1;
      }

      console.log('Seeding V3 audit events...');
      for (const ev of v3Fixtures.audit_events) {
        await client.query(
          `INSERT INTO audit_events (
             event_id, plan_id, actor_id, actor_role, action, resource_type,
             resource_id, from_state, to_state, notes, correlation_id, operation_id, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            ev.event_id,
            ev.plan_id || null,
            ev.actor_id,
            ev.actor_role,
            ev.action,
            ev.resource_type,
            ev.resource_id,
            ev.from_state || null,
            ev.to_state || null,
            ev.notes || null,
            ev.correlation_id || null,
            ev.operation_id || null,
            ev.created_at,
          ]
        );
        totalV3Records += 1;
      }
    }

    // Re-enable triggers
    await client.query(`
      ALTER TABLE plans ENABLE TRIGGER trg_plans_legacy_compatibility_guard;
      ALTER TABLE plans ENABLE TRIGGER trg_plans_no_delete;
      ALTER TABLE advisor_assignments ENABLE TRIGGER trg_advisor_assignments_no_delete;
      ALTER TABLE plan_operations ENABLE TRIGGER trg_plan_operations_immutable;
      ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;
    `);

    // Verify record counts
    if (!includeV3) {
      const v2Tables = ['companies', 'positions', 'rounds', 'document_metadata', 'students', 'plans'];
      let v2Count = 0;
      for (const table of v2Tables) {
        const res = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
        v2Count += parseInt(res.rows[0].count, 10);
      }
      if (v2Count !== 53) {
        throw new Error(`Expected 53 V2 records, but got ${v2Count} records after seed.`);
      }
      console.log('V2 seed process completed successfully. Total records:', v2Count);
    } else {
      console.log(`V2+V3 seed process completed successfully. Added ${totalV3Records} V3 records.`);
    }

    await client.query('COMMIT');
    return { includeV3, totalV3Records };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed process failed, rolling back.', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Convenience helper to explicitly seed with V3 fixtures.
 */
async function seedV3(options = {}) {
  return seed({ ...options, includeV3: true });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const v2Only = args.includes('--v2-only');
  const includeV3 = !v2Only;

  seed({ includeV3 })
    .then(() => close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  seed,
  seedV3,
  assertDestructiveResetAllowed,
};
