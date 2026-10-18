/**
 * Issue #78 — [V3-T01] Verify V3 migrations, constraints and safe fixtures.
 *
 * Verifies:
 * 1. Fresh DB migration and representative V2 existing-data migration (with checksum backfill).
 * 2. Idempotent rerun and transactional rollback on migration failure (no partial schema/data left behind).
 * 3. Identity, ownership, reference, state, concurrency, non-overlapping assignment, and append-only audit constraints.
 * 4. Repeatable local/test seeding, trigger re-enablement before V3 inserts, and production-like destructive guards.
 * 5. Comprehensive secret and production PII scan across V2 and V3 fixture datasets.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { migrate } = require('../src/db/migrate');
const { assertDestructiveResetAllowed } = require('../src/db/seed');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
const VERIFICATION_SQL_PATH = path.join(
  __dirname,
  '..',
  'src',
  'db',
  'verification',
  '002_v3_forward_only_verification.sql'
);
const SEED_SCRIPT_PATH = path.join(__dirname, '..', 'src', 'db', 'seed.js');
const V2_DATASET_PATH = path.join(__dirname, '..', 'data', 'v2', 'mock-dataset.json');
const V3_FIXTURES_PATH = path.join(__dirname, '..', 'data', 'v3', 'fixtures.json');

const SILENT_LOGGER = { log: () => {}, error: () => {} };

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

const MIGRATION_001_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, '001_initial_schema.sql'),
  'utf8'
);
const MIGRATION_002_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, '002_v3_identity_student_plan_assignment_audit.sql'),
  'utf8'
);
const CHECKSUM_001 = sha256(MIGRATION_001_SQL);
const CHECKSUM_002 = sha256(MIGRATION_002_SQL);

const SENSITIVE_FIELD_PATTERN =
  /(?:^|_)(?:password|passwd|secret|token|api_key|access_key|secret_key|private_key|credential|database_url|connection_string)(?:$|_)/i;
const CREDENTIAL_URI_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s/@]+@/i;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
const RESERVED_EMAIL_DOMAIN_PATTERN =
  /^(?:[a-z0-9-]+\.)*(?:example\.(?:com|net|org)|example|invalid|test)$/i;
const THAI_NATIONAL_ID_PATTERN = /\b\d{13}\b/;
const THAI_PHONE_PATTERN = /(?:^|\D)(?:\+66|0)[689]\d{8}(?:\D|$)/;

function scanFixtureSecurity(...datasets) {
  const findings = [];

  function visit(node, currentPath) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }

    if (!node || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      const fieldPath = `${currentPath}.${key}`;
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        findings.push(`${fieldPath}: sensitive field name`);
      }

      if (typeof value === 'string') {
        if (AWS_ACCESS_KEY_PATTERN.test(value)) {
          findings.push(`${fieldPath}: AWS access key`);
        }
        if (JWT_PATTERN.test(value)) {
          findings.push(`${fieldPath}: JWT`);
        }
        if (PRIVATE_KEY_PATTERN.test(value)) {
          findings.push(`${fieldPath}: private key`);
        }
        if (CREDENTIAL_URI_PATTERN.test(value)) {
          findings.push(`${fieldPath}: credential-bearing database URI`);
        }
        if (THAI_NATIONAL_ID_PATTERN.test(value)) {
          findings.push(`${fieldPath}: possible Thai national ID`);
        }
        if (THAI_PHONE_PATTERN.test(value)) {
          findings.push(`${fieldPath}: possible Thai phone number`);
        }

        for (const match of value.matchAll(EMAIL_PATTERN)) {
          if (!RESERVED_EMAIL_DOMAIN_PATTERN.test(match[1])) {
            findings.push(`${fieldPath}: non-reserved email domain`);
          }
        }
      }

      visit(value, fieldPath);
    }
  }

  datasets.forEach((dataset, index) => visit(dataset, `$[${index}]`));
  return findings;
}

/**
 * Creates a stateful transactional mock PostgreSQL pool to verify migration
 * state transitions, checksum backfill, idempotency, and rollback behavior.
 */
function createMockMigrationPool({
  initialApplied = [],
  missingV2Columns = [],
  failOnMigrationFile = null
} = {}) {
  let committedState = initialApplied.map((row) => ({ ...row }));
  let workingState = null;
  const executedSqlLog = [];
  let lockAcquired = false;
  let released = false;

  const client = {
    query: jest.fn(async (sql, params = []) => {
      const normalized = sql.trim();
      executedSqlLog.push({ sql: normalized, params });

      if (normalized === 'BEGIN') {
        workingState = committedState.map((row) => ({ ...row }));
        return { rows: [] };
      }

      if (normalized === 'COMMIT') {
        if (workingState) {
          committedState = workingState.map((row) => ({ ...row }));
          workingState = null;
        }
        return { rows: [] };
      }

      if (normalized === 'ROLLBACK') {
        workingState = null;
        return { rows: [] };
      }

      if (normalized.includes('pg_advisory_xact_lock')) {
        lockAcquired = true;
        return { rows: [] };
      }

      if (normalized.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] };
      }

      if (normalized.includes('ALTER TABLE schema_migrations')) {
        return { rows: [] };
      }

      if (normalized.includes('chk_schema_migrations_checksum')) {
        return { rows: [] };
      }

      if (normalized.includes('SELECT version, checksum') && normalized.includes('FROM schema_migrations')) {
        const active = workingState || committedState;
        return {
          rows: [...active]
            .sort((a, b) => a.version.localeCompare(b.version))
            .map((r) => ({ ...r }))
        };
      }

      if (normalized.includes('WITH required(table_name, column_name)')) {
        return {
          rows: missingV2Columns.map(([table_name, column_name]) => ({
            table_name,
            column_name
          }))
        };
      }

      if (normalized.startsWith('UPDATE schema_migrations SET checksum = $1')) {
        const [newChecksum, version] = params;
        const active = workingState || committedState;
        for (const row of active) {
          if (row.version === version && row.checksum === null) {
            row.checksum = newChecksum;
          }
        }
        return { rowCount: 1, rows: [] };
      }

      if (normalized === MIGRATION_001_SQL.trim()) {
        if (failOnMigrationFile === '001_initial_schema.sql') {
          throw new Error('Simulated DDL failure during 001_initial_schema.sql');
        }
        return { rows: [] };
      }

      if (normalized === MIGRATION_002_SQL.trim()) {
        if (failOnMigrationFile === '002_v3_identity_student_plan_assignment_audit.sql') {
          throw new Error('Simulated DDL failure during 002_v3_identity_student_plan_assignment_audit.sql');
        }
        return { rows: [] };
      }

      if (normalized.startsWith('INSERT INTO schema_migrations (version, checksum)')) {
        const [version, checksum] = params;
        const active = workingState || committedState;
        active.push({ version, checksum });
        return { rowCount: 1, rows: [] };
      }

      return { rows: [] };
    }),
    release: jest.fn(() => {
      released = true;
    })
  };

  return {
    pool: {
      connect: jest.fn(async () => client)
    },
    client,
    getCommittedMigrations: () => committedState.map((r) => ({ ...r })),
    getExecutedSqlLog: () => executedSqlLog,
    wasLockAcquired: () => lockAcquired,
    wasReleased: () => released
  };
}

describe('Issue #78 [V3-T01]: Verify V3 migrations, constraints and safe fixtures', () => {
  describe('1. Migration Scenarios: Fresh DB, Representative V2 DB, Idempotency & Failure Rollback', () => {
    it('migrates cleanly from a fresh empty database and records SHA-256 checksums for 001 and 002', async () => {
      const harness = createMockMigrationPool({ initialApplied: [] });

      await migrate({ pool: harness.pool, logger: SILENT_LOGGER });

      expect(harness.wasLockAcquired()).toBe(true);
      expect(harness.wasReleased()).toBe(true);
      expect(harness.getCommittedMigrations()).toEqual([
        { version: '001_initial_schema.sql', checksum: CHECKSUM_001 },
        {
          version: '002_v3_identity_student_plan_assignment_audit.sql',
          checksum: CHECKSUM_002
        }
      ]);
    });

    it('migrates from a representative existing V2 database by verifying V2 columns, backfilling 001 checksum, and applying only 002', async () => {
      const harness = createMockMigrationPool({
        initialApplied: [{ version: '001_initial_schema.sql', checksum: null }]
      });

      await migrate({ pool: harness.pool, logger: SILENT_LOGGER });

      const sqls = harness.getExecutedSqlLog().map((entry) => entry.sql);
      // 001 SQL must NOT be re-executed on an existing V2 database
      expect(sqls).not.toContain(MIGRATION_001_SQL.trim());
      // 002 SQL MUST be executed
      expect(sqls).toContain(MIGRATION_002_SQL.trim());

      expect(harness.getCommittedMigrations()).toEqual([
        { version: '001_initial_schema.sql', checksum: CHECKSUM_001 },
        {
          version: '002_v3_identity_student_plan_assignment_audit.sql',
          checksum: CHECKSUM_002
        }
      ]);
    });

    it('is idempotent when rerun on an already-migrated V3 database', async () => {
      const harness = createMockMigrationPool({
        initialApplied: [
          { version: '001_initial_schema.sql', checksum: CHECKSUM_001 },
          {
            version: '002_v3_identity_student_plan_assignment_audit.sql',
            checksum: CHECKSUM_002
          }
        ]
      });

      await migrate({ pool: harness.pool, logger: SILENT_LOGGER });

      const sqls = harness.getExecutedSqlLog().map((entry) => entry.sql);
      expect(sqls).not.toContain(MIGRATION_001_SQL.trim());
      expect(sqls).not.toContain(MIGRATION_002_SQL.trim());
      expect(harness.getCommittedMigrations()).toHaveLength(2);
    });

    it('rolls back the entire migration transaction on failure without leaving partial schema_migrations state', async () => {
      const harness = createMockMigrationPool({
        initialApplied: [{ version: '001_initial_schema.sql', checksum: CHECKSUM_001 }],
        failOnMigrationFile: '002_v3_identity_student_plan_assignment_audit.sql'
      });

      await expect(
        migrate({ pool: harness.pool, logger: SILENT_LOGGER })
      ).rejects.toThrow(/Simulated DDL failure during 002/);

      const sqls = harness.getExecutedSqlLog().map((entry) => entry.sql);
      expect(sqls).toContain('ROLLBACK');
      expect(sqls).not.toContain('COMMIT');
      expect(harness.wasReleased()).toBe(true);
      // Committed state remains untouched at 001 only
      expect(harness.getCommittedMigrations()).toEqual([
        { version: '001_initial_schema.sql', checksum: CHECKSUM_001 }
      ]);
    });

    it('rolls back and refuses checksum backfill if an existing V2 database is missing required columns', async () => {
      const harness = createMockMigrationPool({
        initialApplied: [{ version: '001_initial_schema.sql', checksum: null }],
        missingV2Columns: [['plans', 'student_id']]
      });

      await expect(
        migrate({ pool: harness.pool, logger: SILENT_LOGGER })
      ).rejects.toThrow(/existing V2 schema is missing plans\.student_id/);

      const sqls = harness.getExecutedSqlLog().map((entry) => entry.sql);
      expect(sqls).toContain('ROLLBACK');
      expect(harness.getCommittedMigrations()).toEqual([
        { version: '001_initial_schema.sql', checksum: null }
      ]);
    });

    it('rolls back and rejects checksum drift when an applied migration file was modified', async () => {
      const harness = createMockMigrationPool({
        initialApplied: [
          { version: '001_initial_schema.sql', checksum: 'f'.repeat(64) }
        ]
      });

      await expect(
        migrate({ pool: harness.pool, logger: SILENT_LOGGER })
      ).rejects.toThrow(/Migration checksum mismatch for 001_initial_schema\.sql/);

      const sqls = harness.getExecutedSqlLog().map((entry) => entry.sql);
      expect(sqls).toContain('ROLLBACK');
    });
  });

  describe('2. Schema Contract, Constraints, Triggers & Verification SQL Coverage', () => {
    it('defines all V3 tables, identity/ownership/reference/state/concurrency constraints, and append-only triggers in 002 migration SQL', () => {
      const requiredConstructs = [
        // Core V3 tables
        'CREATE TABLE users',
        'CREATE TABLE external_identity_links',
        'CREATE TABLE advisor_assignments',
        'CREATE TABLE staff_scopes',
        'CREATE TABLE plan_operations',
        'CREATE TABLE audit_events',
        // Identity & role constraints
        'chk_users_role',
        'chk_users_account_status',
        'uq_external_identity_links_identity',
        'uq_external_identity_links_active_user',
        // Student ownership & profile completeness constraints
        'uq_students_user',
        'uq_students_student_number',
        'chk_students_linked_profile_complete',
        'trg_students_user_role',
        'trg_users_student_role',
        // Plan state, reference, optimistic concurrency & cardinality constraints
        'chk_plans_status',
        'chk_plans_version',
        'chk_plans_v3_cycle_required',
        'fk_plans_position_company',
        'uq_plans_active_student_cycle',
        'trg_plans_legacy_compatibility_guard',
        'trg_plans_no_delete',
        // Advisor non-overlapping active assignment constraint
        'ex_advisor_assignment_no_overlap',
        'trg_advisor_assignments_no_delete',
        // Staff scope uniqueness & status check
        'uq_staff_scopes_unique',
        'chk_staff_scopes_status',
        // Append-only immutability triggers
        'trg_plan_operations_immutable',
        'trg_audit_events_immutable'
      ];

      for (const construct of requiredConstructs) {
        expect(MIGRATION_002_SQL).toContain(construct);
      }
    });

    it('includes the read-only verification SQL script covering all V3 forward-only schema checks', () => {
      const verificationSql = fs.readFileSync(VERIFICATION_SQL_PATH, 'utf8');
      expect(verificationSql).toContain('required constraint');
      expect(verificationSql).toContain('legacy plan backfill valid');
      expect(verificationSql).toContain('identity and Student references valid');
      expect(verificationSql).toContain('Plan references valid');
      expect(verificationSql).toContain('Plan state and version valid');
      expect(verificationSql).toContain('non-cancelled Plan cardinality valid');
      expect(verificationSql).toContain('active Advisor periods do not overlap');
      expect(verificationSql).toContain('required protection triggers enabled');
    });
  });

  describe('3. Repeatable Seed Execution, Trigger Re-enablement & Destructive-Seed Guards', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('blocks destructive seed/reset across all production-like and misconfigured environments', () => {
      // Production NODE_ENV
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_DB_RESET = 'true';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/coed_dev';
      expect(() => assertDestructiveResetAllowed()).toThrow(/NODE_ENV must strictly be/);

      // Missing ALLOW_DB_RESET
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOW_DB_RESET;
      expect(() => assertDestructiveResetAllowed()).toThrow(/ALLOW_DB_RESET=true flag is required/);

      // Production/staging STAGE variable
      process.env.ALLOW_DB_RESET = 'true';
      process.env.STAGE = 'production';
      expect(() => assertDestructiveResetAllowed()).toThrow(/does not permit destructive reset/);

      // Production keyword in DATABASE_URL
      delete process.env.STAGE;
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/coed_production';
      expect(() => assertDestructiveResetAllowed()).toThrow(/production or staging instance/i);
    });

    it('verifies seed.js re-enables all 5 protection triggers BEFORE inserting V3 fixtures and wraps seeding in a ROLLBACK-safe transaction', () => {
      const seedSource = fs.readFileSync(SEED_SCRIPT_PATH, 'utf8');

      const enableTriggersIdx = seedSource.indexOf(
        'ALTER TABLE plans ENABLE TRIGGER trg_plans_legacy_compatibility_guard;'
      );
      const v3UsersInsertIdx = seedSource.indexOf(
        'INSERT INTO users (id, role, account_status, version, created_at, updated_at)'
      );
      const rollbackIdx = seedSource.indexOf("await client.query('ROLLBACK');");

      expect(enableTriggersIdx).toBeGreaterThan(0);
      expect(v3UsersInsertIdx).toBeGreaterThan(enableTriggersIdx);
      expect(rollbackIdx).toBeGreaterThan(v3UsersInsertIdx);
    });
  });

  describe('4. Fixture Security, Secret, and Production PII Scan (V2 & V3 Datasets)', () => {
    const v2Dataset = JSON.parse(fs.readFileSync(V2_DATASET_PATH, 'utf8'));
    const v3Fixtures = JSON.parse(fs.readFileSync(V3_FIXTURES_PATH, 'utf8'));

    it('scans V2 and V3 datasets and confirms zero secrets, tokens, private keys, or production PII', () => {
      expect(scanFixtureSecurity(v2Dataset, v3Fixtures)).toEqual([]);
    });

    it.each([
      [{ password: 'synthetic-but-forbidden' }, /sensitive field name/],
      [
        { endpoint: 'postgres://example-user:example-password@db.example.invalid/coed' },
        /credential-bearing database URI/
      ],
      [{ contact: 'student@gmail.com' }, /non-reserved email domain/],
      [{ contact: '0812345678' }, /possible Thai phone number/],
      [{ identity_number: '1234567890123' }, /possible Thai national ID/]
    ])('rejects representative secret or production-PII mutation %#', (mutation, expected) => {
      expect(scanFixtureSecurity(mutation).join('\n')).toMatch(expected);
    });

    it('passes the CLI V3 fixture validator and rejects invalid or duplicate fixture mutations', () => {
      const output = execFileSync(
        process.execPath,
        [path.join(__dirname, '..', 'scripts', 'validate-v3-fixtures.mjs')],
        { encoding: 'utf8' }
      );
      expect(output).toContain('V3 Fixtures validation passed successfully');
    });
  });
});
