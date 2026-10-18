const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const { seed, seedV3, assertDestructiveResetAllowed } = require('../src/db/seed');
const { IdentityResolver } = require('../src/auth/identity-resolver');

describe('Issue #60 - Anonymized V3 Fixtures and Destructive-Seed Guards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Destructive-Seed Guards (assertDestructiveResetAllowed)', () => {
    it('blocks reset when NODE_ENV is undefined or empty', () => {
      delete process.env.NODE_ENV;
      process.env.ALLOW_DB_RESET = 'true';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /NODE_ENV must strictly be 'development' or 'test'/
      );

      process.env.NODE_ENV = '';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /NODE_ENV must strictly be 'development' or 'test'/
      );
    });

    it('blocks reset when NODE_ENV is production or staging', () => {
      process.env.ALLOW_DB_RESET = 'true';

      process.env.NODE_ENV = 'production';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /NODE_ENV must strictly be 'development' or 'test'/
      );

      process.env.NODE_ENV = 'staging';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /NODE_ENV must strictly be 'development' or 'test'/
      );
    });

    it('blocks reset when ALLOW_DB_RESET is missing or not "true"', () => {
      process.env.NODE_ENV = 'development';

      delete process.env.ALLOW_DB_RESET;
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /ALLOW_DB_RESET=true flag is required/
      );

      process.env.ALLOW_DB_RESET = 'false';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /ALLOW_DB_RESET=true flag is required/
      );

      process.env.ALLOW_DB_RESET = '1';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /ALLOW_DB_RESET=true flag is required/
      );
    });

    it('blocks reset when STAGE or APP_ENV indicates production or staging', () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_DB_RESET = 'true';

      process.env.STAGE = 'production';
      expect(() => assertDestructiveResetAllowed()).toThrow(/does not permit destructive reset/);

      process.env.STAGE = 'staging';
      expect(() => assertDestructiveResetAllowed()).toThrow(/does not permit destructive reset/);

      delete process.env.STAGE;
      process.env.APP_ENV = 'prod';
      expect(() => assertDestructiveResetAllowed()).toThrow(/does not permit destructive reset/);
    });

    it('blocks reset when connection URL hostname/database matches production or staging patterns', () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_DB_RESET = 'true';

      process.env.DATABASE_URL = 'postgres://user:pass@production-db.internal:5432/coed_prod';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /target database URL appears to match a production or staging/i
      );

      process.env.DATABASE_URL = 'postgres://user:pass@staging-rds.aws.com:5432/coed_staging';
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /target database URL appears to match a production or staging/i
      );
    });

    it('in test mode, requires TEST_DATABASE_URL differing from DATABASE_URL', () => {
      process.env.NODE_ENV = 'test';
      process.env.ALLOW_DB_RESET = 'true';
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/coed_dev';

      delete process.env.TEST_DATABASE_URL;
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /TEST_DATABASE_URL that differs from DATABASE_URL/
      );

      process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
      expect(() => assertDestructiveResetAllowed()).toThrow(
        /TEST_DATABASE_URL that differs from DATABASE_URL/
      );
    });

    it('permits reset when all development guard conditions are met', () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_DB_RESET = 'true';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/coed_v2_dev';
      delete process.env.STAGE;
      delete process.env.APP_ENV;

      expect(() => assertDestructiveResetAllowed()).not.toThrow();
    });

    it('permits reset when all test guard conditions are met', () => {
      process.env.NODE_ENV = 'test';
      process.env.ALLOW_DB_RESET = 'true';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/coed_v2_dev';
      process.env.TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/coed_v2_test';
      delete process.env.STAGE;
      delete process.env.APP_ENV;

      expect(() => assertDestructiveResetAllowed()).not.toThrow();
    });
  });

  describe('V3 Fixtures Data Safety and Privacy', () => {
    const fixturesPath = path.join(__dirname, '..', 'data', 'v3', 'fixtures.json');
    const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

    it('strictly uses RFC 2606 reserved domains (@student.example.com)', () => {
      for (const student of fixtures.students) {
        expect(student.institutional_email).toMatch(/@student\.example\.com$/);
        expect(student.institutional_email).not.toMatch(/@cmu\.ac\.th|@gmail\.com|@hotmail\.com|@yahoo\.com/);
      }
    });

    it('uses synthetic names clearly distinguishable as test records', () => {
      for (const student of fixtures.students) {
        expect(student.full_name).toBeTruthy();
        expect(student.anonymous_ref).toMatch(/^v3-student-ref-/);
      }
    });

    it('contains no actual passwords or credentials in any field', () => {
      const jsonString = JSON.stringify(fixtures);
      expect(jsonString).not.toMatch(/AKIA[0-9A-Z]{16}/); // AWS Access Key pattern
      expect(jsonString).not.toMatch(/"password"/i);
      expect(jsonString).not.toMatch(/"secret"/i);
    });

    it('contains all required roles: STUDENT, ADVISOR, STAFF, ADMIN', () => {
      const roles = fixtures.users.map((u) => u.role);
      expect(roles).toContain('STUDENT');
      expect(roles).toContain('ADVISOR');
      expect(roles).toContain('STAFF');
      expect(roles).toContain('ADMIN');
    });

    it('covers all major plan workflow states', () => {
      const planStatuses = fixtures.plans.map((p) => p.status);
      expect(planStatuses).toContain('DRAFT');
      expect(planStatuses).toContain('SUBMITTED');
      expect(planStatuses).toContain('UNDER_REVIEW');
      expect(planStatuses).toContain('NEEDS_REVISION');
      expect(planStatuses).toContain('APPROVED');
      expect(planStatuses).toContain('CANCELLED');
    });

    it('satisfies standardized department requirement ("CPE", "EE") per #51 and #53', () => {
      const allowedDepts = new Set(['CPE', 'EE', 'ME']);
      for (const s of fixtures.students) {
        expect(allowedDepts.has(s.department)).toBe(true);
        expect(s.department).toBe(s.department.trim());
      }
      for (const sc of fixtures.staff_scopes) {
        expect(allowedDepts.has(sc.department)).toBe(true);
      }
    });

    it('uses the unified Common Era calendar (2026/2025) for academic_year', () => {
      for (const s of fixtures.students) {
        expect(s.academic_year).toBe(2026);
      }
      for (const r of fixtures.rounds) {
        expect(r.academic_year).toBe(2026);
      }
    });

    it('covers both in-scope 200 OK and out-of-year 403 Forbidden staff cases for OPEN round', () => {
      const openRound = fixtures.rounds.find((r) => r.status === 'OPEN');
      expect(openRound.academic_year).toBe(2026);

      // Staff 1 covers 2026 OPEN round via NULL academic_year -> 200 OK
      const staff1Scopes = fixtures.staff_scopes.filter(
        (sc) => sc.staff_id === '70000000-0000-4000-8000-000000000020' && sc.status === 'ACTIVE'
      );
      expect(staff1Scopes.some((sc) => sc.academic_year === null)).toBe(true);

      // Staff 3 restricted to 2025 -> 403 Forbidden on OPEN round 2026
      const staff3Scopes = fixtures.staff_scopes.filter(
        (sc) => sc.staff_id === '70000000-0000-4000-8000-000000000022' && sc.status === 'ACTIVE'
      );
      expect(staff3Scopes.length).toBeGreaterThan(0);
      expect(staff3Scopes.every((sc) => sc.academic_year === 2025)).toBe(true);
    });
  });

  describe('Database Seeding Integration (with TEST_DATABASE_URL)', () => {
    const hasTestDb = Boolean(
      process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL
    );

    (hasTestDb ? describe : describe.skip)('When isolated PostgreSQL database is available', () => {
      let pool;

      beforeAll(() => {
        process.env.NODE_ENV = 'test';
        process.env.ALLOW_DB_RESET = 'true';
        pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      });

      afterAll(async () => {
        if (pool) await pool.end();
      });

      it('seeds both V2 and V3 data deterministically', async () => {
        const result = await seedV3();
        expect(result.includeV3).toBe(true);
        expect(result.totalV3Records).toBeGreaterThan(0);

        // Verify users
        const userRes = await pool.query('SELECT role, count(*)::int FROM users GROUP BY role');
        const roles = userRes.rows.reduce((acc, r) => ({ ...acc, [r.role]: r.count }), {});
        expect(roles.STUDENT).toBeGreaterThanOrEqual(5);
        expect(roles.ADVISOR).toBeGreaterThanOrEqual(2);
        expect(roles.STAFF).toBeGreaterThanOrEqual(2);
        expect(roles.ADMIN).toBeGreaterThanOrEqual(1);

        // Verify advisor assignments
        const assignRes = await pool.query(
          'SELECT status, count(*)::int FROM advisor_assignments GROUP BY status'
        );
        const assignStatuses = assignRes.rows.reduce((acc, r) => ({ ...acc, [r.status]: r.count }), {});
        expect(assignStatuses.ACTIVE).toBeGreaterThanOrEqual(3);
        expect(assignStatuses.REVOKED).toBeGreaterThanOrEqual(1);
        expect(assignStatuses.EXPIRED).toBeGreaterThanOrEqual(1);

        // Verify staff scopes
        const scopeRes = await pool.query(
          'SELECT department, status, count(*)::int FROM staff_scopes GROUP BY department, status'
        );
        expect(scopeRes.rows.length).toBeGreaterThanOrEqual(3);

        // Verify plan workflow states
        const planRes = await pool.query('SELECT status, count(*)::int FROM plans GROUP BY status');
        const planStatuses = planRes.rows.reduce((acc, r) => ({ ...acc, [r.status]: r.count }), {});
        expect(planStatuses.APPROVED).toBeGreaterThanOrEqual(1);
        expect(planStatuses.UNDER_REVIEW).toBeGreaterThanOrEqual(1);
        expect(planStatuses.SUBMITTED).toBeGreaterThanOrEqual(1);
        expect(planStatuses.NEEDS_REVISION).toBeGreaterThanOrEqual(1);
        expect(planStatuses.DRAFT).toBeGreaterThanOrEqual(1);
        expect(planStatuses.CANCELLED).toBeGreaterThanOrEqual(1);

        // Verify audit events
        const auditRes = await pool.query('SELECT count(*)::int FROM audit_events');
        expect(auditRes.rows[0].count).toBeGreaterThanOrEqual(6);
      });

      it('is rerunnable / idempotent without duplicate constraint errors', async () => {
        // Run seed a second time
        await expect(seedV3()).resolves.toBeDefined();

        const studentRes = await pool.query('SELECT count(*)::int FROM students WHERE user_id IS NOT NULL');
        expect(studentRes.rows[0].count).toBe(5);
      });

      it('re-enables protected triggers after seed completes', async () => {
        await seedV3();

        // Attempting to delete from audit_events should fail because trg_audit_events_immutable is enabled
        await expect(pool.query('DELETE FROM audit_events')).rejects.toThrow(
          /audit_events is append-only/
        );

        // Attempting to delete from advisor_assignments should fail because trg_advisor_assignments_no_delete is enabled
        await expect(pool.query('DELETE FROM advisor_assignments')).rejects.toThrow(
          /advisor_assignments is append-only/
        );
      });

      it('allows IdentityResolver to resolve synthetic student, advisor, and staff users', async () => {
        await seedV3();
        const resolver = new IdentityResolver({ pool });
        const issuer = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_mockPool';

        // Student 1
        const studentCtx = await resolver.resolveIdentity(issuer, 'mock-sub-student-001');
        expect(studentCtx.role).toBe('STUDENT');
        expect(studentCtx.student_number).toBe('650610001');
        expect(studentCtx.department).toBe('CPE');

        // Advisor 1
        const advisorCtx = await resolver.resolveIdentity(issuer, 'mock-sub-advisor-001');
        expect(advisorCtx.role).toBe('ADVISOR');

        // Staff 1
        const staffCtx = await resolver.resolveIdentity(issuer, 'mock-sub-staff-001');
        expect(staffCtx.role).toBe('STAFF');
      });
    });
  });
});
