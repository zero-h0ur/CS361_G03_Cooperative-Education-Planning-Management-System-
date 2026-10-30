const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const { migrate } = require('../src/db/migrate');

jest.setTimeout(30000);

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
const INITIAL_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, '001_initial_schema.sql'),
  'utf8'
);
const SILENT_LOGGER = { log: () => {}, error: () => {} };

const IDS = {
  company: '10000000-0000-4000-8000-000000009001',
  otherCompany: '10000000-0000-4000-8000-000000009002',
  position: '20000000-0000-4000-8000-000000009001',
  round: '30000000-0000-4000-8000-000000009001',
  cycle: '30000000-0000-4000-8000-000000009002',
  legacyStudent: '40000000-0000-4000-8000-000000009001',
  v3Student: '40000000-0000-4000-8000-000000009002',
  legacyPlanWithRound: '50000000-0000-4000-8000-000000009001',
  legacyPlanWithoutRound: '50000000-0000-4000-8000-000000009002',
  v3Plan: '50000000-0000-4000-8000-000000009003',
  studentUser: '70000000-0000-4000-8000-000000009001',
  advisorUser: '70000000-0000-4000-8000-000000009002',
  staffUser: '70000000-0000-4000-8000-000000009003',
  adminUser: '70000000-0000-4000-8000-000000009004',
  incompleteUser: '70000000-0000-4000-8000-000000009005',
  identity: '80000000-0000-4000-8000-000000009001',
  assignment: '90000000-0000-4000-8000-000000009001',
  staffScope: '91000000-0000-4000-8000-000000009001',
  operation: '92000000-0000-4000-8000-000000009001',
  audit: '93000000-0000-4000-8000-000000009001',
};

let schemaCounter = 0;
let adminPool;
let testPool;
let testSchema;

function requireTestDatabase() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for the V3 migration integration tests.');
  }
  if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.');
  }
}

function quoteIdentifier(identifier) {
  if (!/^issue56_[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe test schema name: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function createIsolatedPool(label) {
  schemaCounter += 1;
  const schema = `issue56_${label}_${process.pid}_${Date.now()}_${schemaCounter}`;
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema},public`,
    max: 4,
  });
  return { schema, pool };
}

async function dropIsolatedPool(schema, pool) {
  if (pool) await pool.end();
  if (schema) {
    await adminPool.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
  }
}

async function prepareLegacyV2(pool) {
  await pool.query(INITIAL_SQL);
  await pool.query(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(
    `INSERT INTO schema_migrations (version) VALUES ('001_initial_schema.sql')`
  );

  await pool.query(`
    INSERT INTO companies (
      id, name, source, visibility, data_status
    ) VALUES
      ($1, 'Synthetic Company A', 'issue-56-test', 'public', 'mock'),
      ($2, 'Synthetic Company B', 'issue-56-test', 'public', 'mock')
  `, [IDS.company, IDS.otherCompany]);
  await pool.query(`
    INSERT INTO positions (
      id, company_id, title, source, visibility, data_status
    ) VALUES ($1, $2, 'Synthetic Position', 'issue-56-test', 'public', 'mock')
  `, [IDS.position, IDS.company]);
  await pool.query(`
    INSERT INTO rounds (
      id, name, academic_year, source, visibility, data_status
    ) VALUES ($1, 'Synthetic Legacy Round', 2569, 'issue-56-test', 'public', 'mock')
  `, [IDS.round]);
  await pool.query(`
    INSERT INTO students (
      id, anonymous_ref, source, visibility, data_status
    ) VALUES ($1, 'SYNTHETIC-LEGACY-001', 'issue-56-test', 'private', 'mock')
  `, [IDS.legacyStudent]);
  await pool.query(`
    INSERT INTO plans (
      id, student_id, round_id, source, visibility, data_status
    ) VALUES
      ($1, $2, $3, 'issue-56-test', 'private', 'mock'),
      ($4, $2, NULL, 'issue-56-test', 'private', 'mock')
  `, [
    IDS.legacyPlanWithRound,
    IDS.legacyStudent,
    IDS.round,
    IDS.legacyPlanWithoutRound,
  ]);
}

async function prepareV3References(pool) {
  await pool.query(`
    INSERT INTO users (id, role, account_status) VALUES
      ($1, 'STUDENT', 'ACTIVE'),
      ($2, 'ADVISOR', 'ACTIVE'),
      ($3, 'STAFF', 'ACTIVE'),
      ($4, 'ADMIN', 'ACTIVE'),
      ($5, 'STUDENT', 'ACTIVE')
  `, [
    IDS.studentUser,
    IDS.advisorUser,
    IDS.staffUser,
    IDS.adminUser,
    IDS.incompleteUser,
  ]);

  await pool.query(`
    INSERT INTO students (
      id, anonymous_ref, source, visibility, data_status, user_id,
      student_number, full_name, preferred_name, institutional_email,
      department, program, major, academic_year, enrollment_status
    ) VALUES (
      $1, 'SYNTHETIC-V3-001', 'issue-56-test', 'private', 'mock', $2,
      'SYNTHETIC-0001', 'Synthetic Student', 'Tester',
      'synthetic.student@example.invalid', 'Synthetic Department',
      'Synthetic Program', 'Synthetic Major', 2569, 'ACTIVE'
    )
  `, [IDS.v3Student, IDS.studentUser]);

  await pool.query(`
    INSERT INTO external_identity_links (
      id, user_id, external_issuer, external_subject
    ) VALUES ($1, $2, 'https://synthetic-idp.example.invalid', 'synthetic-subject-001')
  `, [IDS.identity, IDS.studentUser]);

  await pool.query(`
    INSERT INTO rounds (
      id, name, academic_year, semester, status, end_date,
      source, visibility, data_status
    ) VALUES (
      $1, 'Synthetic V3 Cycle', 2569, 1, 'OPEN', '2027-05-01T00:00:00Z',
      'issue-56-test', 'public', 'mock'
    )
  `, [IDS.cycle]);

  await pool.query(`
    INSERT INTO plans (
      id, student_id, cycle_id, company_id, position_id,
      source, visibility, data_status
    ) VALUES ($1, $2, $3, $4, $5, 'issue-56-test', 'private', 'mock')
  `, [IDS.v3Plan, IDS.v3Student, IDS.cycle, IDS.company, IDS.position]);
}

describe('Issue #56 forward-only V3 migration', () => {
  beforeAll(async () => {
    requireTestDatabase();
    adminPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const isolated = await createIsolatedPool('primary');
    testSchema = isolated.schema;
    testPool = isolated.pool;
    await prepareLegacyV2(testPool);
    await migrate({ pool: testPool, logger: SILENT_LOGGER });
    await prepareV3References(testPool);
  });

  afterAll(async () => {
    await dropIsolatedPool(testSchema, testPool);
    if (adminPool) await adminPool.end();
  });

  test('preserves V2 rows and applies the approved compatibility backfill', async () => {
    const students = await testPool.query(`
      SELECT id, user_id, student_number, department, version
      FROM students
      WHERE id = $1
    `, [IDS.legacyStudent]);
    expect(students.rows).toEqual([{
      id: IDS.legacyStudent,
      user_id: null,
      student_number: null,
      department: null,
      version: 1,
    }]);

    const plans = await testPool.query(`
      SELECT id, round_id, cycle_id, status, version, legacy_compatibility
      FROM plans
      WHERE id IN ($1, $2)
      ORDER BY id
    `, [IDS.legacyPlanWithRound, IDS.legacyPlanWithoutRound]);
    expect(plans.rows).toEqual([
      {
        id: IDS.legacyPlanWithRound,
        round_id: IDS.round,
        cycle_id: IDS.round,
        status: 'DRAFT',
        version: 1,
        legacy_compatibility: true,
      },
      {
        id: IDS.legacyPlanWithoutRound,
        round_id: null,
        cycle_id: null,
        status: 'DRAFT',
        version: 1,
        legacy_compatibility: true,
      },
    ]);

    const round = await testPool.query(`SELECT status FROM rounds WHERE id = $1`, [IDS.round]);
    expect(round.rows[0].status).toBe('CLOSED');
  });

  test('records SHA-256 checksums and is repeatable', async () => {
    await migrate({ pool: testPool, logger: SILENT_LOGGER });
    const result = await testPool.query(`
      SELECT version, checksum
      FROM schema_migrations
      ORDER BY version
    `);
    expect(result.rows.map(row => row.version)).toEqual([
      '001_initial_schema.sql', '002_v3_identity_student_plan_assignment_audit.sql', '003_partner_directory.sql',
      '004_three_role_workflow.sql','005_submission_snapshots.sql','006_advisor_display_name.sql','007_submission_policy_integrity.sql',
      '008_returned_plan_cancellation.sql'
    ]);
    for (const row of result.rows) {
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('serializes two concurrent migration runners', async () => {
    const isolated = await createIsolatedPool('concurrent');
    try {
      await prepareLegacyV2(isolated.pool);
      await Promise.all([
        migrate({ pool: isolated.pool, logger: SILENT_LOGGER }),
        migrate({ pool: isolated.pool, logger: SILENT_LOGGER }),
      ]);
      const result = await isolated.pool.query(`SELECT COUNT(*) FROM schema_migrations`);
      expect(Number(result.rows[0].count)).toBe(8);
    } finally {
      await dropIsolatedPool(isolated.schema, isolated.pool);
    }
  });

  test('enforces exact identity uniqueness and one active identity per user', async () => {
    await expect(testPool.query(`
      INSERT INTO external_identity_links (
        id, user_id, external_issuer, external_subject
      ) VALUES (
        '80000000-0000-4000-8000-000000009002', $1,
        'https://synthetic-idp.example.invalid', 'synthetic-subject-001'
      )
    `, [IDS.advisorUser])).rejects.toMatchObject({ code: '23505' });

    await expect(testPool.query(`
      INSERT INTO external_identity_links (
        id, user_id, external_issuer, external_subject
      ) VALUES (
        '80000000-0000-4000-8000-000000009003', $1,
        'https://synthetic-idp.example.invalid', 'synthetic-subject-002'
      )
    `, [IDS.studentUser])).rejects.toMatchObject({ code: '23505' });
  });

  test('requires all official profile fields before linking a Student', async () => {
    await expect(testPool.query(`
      INSERT INTO students (
        id, anonymous_ref, source, visibility, data_status, user_id
      ) VALUES (
        '40000000-0000-4000-8000-000000009099',
        'SYNTHETIC-INCOMPLETE', 'issue-56-test', 'private', 'mock', $1
      )
    `, [IDS.incompleteUser])).rejects.toMatchObject({ code: '23514' });
  });

  test('requires every linked Student user to retain the STUDENT role', async () => {
    await expect(testPool.query(`
      INSERT INTO students (
        id, anonymous_ref, source, visibility, data_status, user_id,
        student_number, full_name, institutional_email, department,
        program, major, academic_year, enrollment_status
      ) VALUES (
        '40000000-0000-4000-8000-000000009098',
        'SYNTHETIC-WRONG-ROLE', 'issue-56-test', 'private', 'mock', $1,
        'SYNTHETIC-0098', 'Synthetic Wrong Role',
        'wrong.role@example.invalid', 'Synthetic Department',
        'Synthetic Program', 'Synthetic Major', 2569, 'ACTIVE'
      )
    `, [IDS.advisorUser])).rejects.toMatchObject({ code: '23514' });

    await expect(testPool.query(`
      UPDATE users
      SET role = 'ADVISOR'
      WHERE id = $1
    `, [IDS.studentUser])).rejects.toMatchObject({ code: '23514' });
  });

  test('enforces V3 Plan references, version, and active cardinality', async () => {
    const plan = await testPool.query(`
      SELECT status, version, legacy_compatibility
      FROM plans
      WHERE id = $1
    `, [IDS.v3Plan]);
    expect(plan.rows[0]).toEqual({
      status: 'DRAFT',
      version: 1,
      legacy_compatibility: false,
    });

    await expect(testPool.query(`
      INSERT INTO plans (
        id, student_id, source, visibility, data_status
      ) VALUES (
        '50000000-0000-4000-8000-000000009090', $1,
        'issue-56-test', 'private', 'mock'
      )
    `, [IDS.v3Student])).rejects.toMatchObject({ code: '23514' });

    await expect(testPool.query(`
      INSERT INTO plans (
        id, student_id, legacy_compatibility,
        source, visibility, data_status
      ) VALUES (
        '50000000-0000-4000-8000-000000009089', $1, TRUE,
        'issue-56-test', 'private', 'mock'
      )
    `, [IDS.v3Student])).rejects.toMatchObject({ code: '23514' });

    await expect(testPool.query(`
      UPDATE plans
      SET legacy_compatibility = TRUE
      WHERE id = $1
    `, [IDS.v3Plan])).rejects.toMatchObject({ code: '23514' });

    await expect(testPool.query(`
      INSERT INTO plans (
        id, student_id, cycle_id, company_id, position_id,
        source, visibility, data_status
      ) VALUES (
        '50000000-0000-4000-8000-000000009091', $1, $2, $3, $4,
        'issue-56-test', 'private', 'mock'
      )
    `, [
      IDS.legacyStudent,
      IDS.cycle,
      IDS.otherCompany,
      IDS.position,
    ])).rejects.toMatchObject({ code: '23503' });

    await expect(testPool.query(`
      INSERT INTO plans (
        id, student_id, cycle_id, source, visibility, data_status
      ) VALUES (
        '50000000-0000-4000-8000-000000009092', $1, $2,
        'issue-56-test', 'private', 'mock'
      )
    `, [IDS.v3Student, IDS.cycle])).rejects.toMatchObject({ code: '23505' });
  });

  test('prevents overlapping active Advisor assignments', async () => {
    await testPool.query(`
      INSERT INTO advisor_assignments (
        id, advisor_id, student_id, academic_year, semester,
        effective_from, effective_to, assigned_by
      ) VALUES (
        $1, $2, $3, 2569, 1,
        '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', $4
      )
    `, [IDS.assignment, IDS.advisorUser, IDS.v3Student, IDS.adminUser]);

    await expect(testPool.query(`
      INSERT INTO advisor_assignments (
        id, advisor_id, student_id, academic_year, semester,
        effective_from, effective_to, assigned_by
      ) VALUES (
        '90000000-0000-4000-8000-000000009002', $1, $2, 2569, 1,
        '2026-05-01T00:00:00Z', '2026-08-01T00:00:00Z', $3
      )
    `, [IDS.advisorUser, IDS.v3Student, IDS.adminUser]))
      .rejects.toMatchObject({ code: '23P01' });
  });

  test('enforces unique Staff scope', async () => {
    await testPool.query(`
      INSERT INTO staff_scopes (
        id, staff_id, department, program, academic_year
      ) VALUES (
        $1, $2, 'Synthetic Department', 'Synthetic Program', 2569
      )
    `, [IDS.staffScope, IDS.staffUser]);

    await expect(testPool.query(`
      INSERT INTO staff_scopes (
        id, staff_id, department, program, academic_year
      ) VALUES (
        '91000000-0000-4000-8000-000000009002', $1,
        'Synthetic Department', 'Synthetic Program', 2569
      )
    `, [IDS.staffUser])).rejects.toMatchObject({ code: '23505' });
  });

  test('makes operation records and audit events append-only', async () => {
    await testPool.query(`
      INSERT INTO plan_operations (
        operation_id, plan_id, actor_id, action, request_hash,
        response_status, response_payload, result_version
      ) VALUES (
        $1, $2, $3, 'update_draft', $4,
        200, '{"status":"DRAFT","version":2}'::jsonb, 2
      )
    `, [IDS.operation, IDS.v3Plan, IDS.studentUser, 'a'.repeat(64)]);
    await testPool.query(`
      INSERT INTO audit_events (
        event_id, plan_id, actor_id, actor_role, action,
        resource_type, resource_id, from_state, to_state, operation_id
      ) VALUES (
        $1, $2, $3, 'STUDENT', 'PLAN_DRAFT_UPDATED',
        'PLAN', $2, 'DRAFT', 'DRAFT', $4
      )
    `, [IDS.audit, IDS.v3Plan, IDS.studentUser, IDS.operation]);

    await expect(testPool.query(
      `UPDATE audit_events SET action = 'CHANGED' WHERE event_id = $1`,
      [IDS.audit]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(testPool.query(
      `DELETE FROM audit_events WHERE event_id = $1`,
      [IDS.audit]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(testPool.query(
      `UPDATE plan_operations SET result_version = 3 WHERE operation_id = $1`,
      [IDS.operation]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(testPool.query(
      `DELETE FROM plans WHERE id = $1`,
      [IDS.v3Plan]
    )).rejects.toMatchObject({ code: '55000' });
  });

  test('rolls back PostgreSQL DDL, data, and migration history when a migration fails', async () => {
    const isolated = await createIsolatedPool('rollback');
    const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coed-v3-rollback-'));

    try {
      fs.writeFileSync(
        path.join(migrationsDir, '001_initial_schema.sql'),
        `
          CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY);
          INSERT INTO rollback_probe (id) VALUES (1);
        `,
        'utf8'
      );
      fs.writeFileSync(
        path.join(migrationsDir, '002_intentional_failure.sql'),
        `
          CREATE TABLE rollback_partial (id INTEGER PRIMARY KEY);
          INSERT INTO rollback_probe (id) VALUES (2);
          SELECT * FROM table_that_must_not_exist;
        `,
        'utf8'
      );

      await expect(
        migrate({
          pool: isolated.pool,
          logger: SILENT_LOGGER,
          migrationsDir,
        })
      ).rejects.toThrow();

      const result = await isolated.pool.query(`
        SELECT
          to_regclass(current_schema() || '.schema_migrations') AS migration_table,
          to_regclass(current_schema() || '.rollback_probe') AS committed_table,
          to_regclass(current_schema() || '.rollback_partial') AS partial_table
      `);
      expect(result.rows[0]).toEqual({
        migration_table: null,
        committed_table: null,
        partial_table: null,
      });
    } finally {
      fs.rmSync(migrationsDir, { recursive: true, force: true });
      await dropIsolatedPool(isolated.schema, isolated.pool);
    }
  });

  test('rejects checksum drift for an applied migration', async () => {
    const migrationFile = path.join(MIGRATIONS_DIR, '001_initial_schema.sql');
    const actualChecksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(migrationFile, 'utf8'), 'utf8')
      .digest('hex');

    await testPool.query(`
      UPDATE schema_migrations
      SET checksum = $1
      WHERE version = '001_initial_schema.sql'
    `, ['0'.repeat(64)]);

    try {
      await expect(migrate({ pool: testPool, logger: SILENT_LOGGER }))
        .rejects.toThrow('Migration checksum mismatch');
    } finally {
      await testPool.query(`
        UPDATE schema_migrations
        SET checksum = $1
        WHERE version = '001_initial_schema.sql'
      `, [actualChecksum]);
    }
  });

  test('passes every read-only verification query', async () => {
    const verificationSql = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        'src',
        'db',
        'verification',
        '002_v3_forward_only_verification.sql'
      ),
      'utf8'
    );
    const results = await testPool.query(verificationSql);
    const resultSets = Array.isArray(results) ? results : [results];
    const checks = resultSets.flatMap((result) => result.rows || []);
    const failedChecks = checks.filter((check) => check.passed !== true);

    expect(checks.length).toBeGreaterThanOrEqual(10);
    expect(failedChecks).toEqual([]);
  });
});
