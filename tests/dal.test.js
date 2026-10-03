const { getPool, close } = require('../src/db/connection');
const { seed } = require('../src/db/seed');
const { 
  listPublicCompanies, 
  listPublicPositionsByCompany, 
  searchPublicCompaniesAndPositions,
  getPublicCompanyById,
  getPublicPositionById,
  getMockStudentByAnonymousRef,
  listMockPlansByStudentId,
  InvalidInputError,
  RecordNotFoundError
} = require('../src/db/dal');

describe('Data Access Layer', () => {
  beforeAll(async () => {
    // Requires NODE_ENV=test and ALLOW_DB_RESET=true
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DB_RESET = 'true';
    await seed();
  });

  afterAll(async () => {
    await close();
  });

  describe('Migration & Seed', () => {
    it('should have 53 records in total', async () => {
      const pool = getPool();
      let total = 0;
      const tables = ['companies', 'positions', 'rounds', 'document_metadata', 'students', 'plans'];
      for (const table of tables) {
        const res = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        total += parseInt(res.rows[0].count, 10);
      }
      expect(total).toBe(53);
    });

    it('running seed again does not duplicate records (repeatable)', async () => {
      await seed();
      const pool = getPool();
      let total = 0;
      const tables = ['companies', 'positions', 'rounds', 'document_metadata', 'students', 'plans'];
      for (const table of tables) {
        const res = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        total += parseInt(res.rows[0].count, 10);
      }
      expect(total).toBe(53);
    });
    
    it('should have schema_migrations tracking table', async () => {
      const pool = getPool();
      const res = await pool.query(`SELECT version FROM schema_migrations ORDER BY version`);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].version).toBe('001_initial_schema.sql');
    });
  });

  describe('Seed Reset Safety', () => {
    it('rejects reset when ALLOW_DB_RESET is not true', async () => {
      const originalFlag = process.env.ALLOW_DB_RESET;
      process.env.ALLOW_DB_RESET = 'false';

      await expect(seed()).rejects.toThrow('Seed/Reset requires ALLOW_DB_RESET=true flag.');

      process.env.ALLOW_DB_RESET = originalFlag;
    });

    it('rejects test reset without TEST_DATABASE_URL', async () => {
      const originalTestUrl = process.env.TEST_DATABASE_URL;
      delete process.env.TEST_DATABASE_URL;

      await expect(seed()).rejects.toThrow(
        'Test reset requires a TEST_DATABASE_URL that differs from DATABASE_URL.'
      );

      process.env.TEST_DATABASE_URL = originalTestUrl;
    });

    it('rejects test reset when TEST_DATABASE_URL matches DATABASE_URL', async () => {
      const originalTestUrl = process.env.TEST_DATABASE_URL;
      process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;

      await expect(seed()).rejects.toThrow(
        'Test reset requires a TEST_DATABASE_URL that differs from DATABASE_URL.'
      );

      process.env.TEST_DATABASE_URL = originalTestUrl;
    });
  });

  describe('Database Constraints', () => {
    it('should enforce Foreign Key constraint on positions', async () => {
      const pool = getPool();
      await expect(pool.query(`
        INSERT INTO positions (id, company_id, title, source, visibility, data_status)
        VALUES (gen_random_uuid(), gen_random_uuid(), 'Test', 'test', 'public', 'mock')
      `)).rejects.toThrow();
    });

    it('should enforce Check constraint on visibility', async () => {
      const pool = getPool();
      await expect(pool.query(`
        INSERT INTO companies (id, name, source, visibility, data_status)
        VALUES (gen_random_uuid(), 'Test Co', 'test', 'invalid_vis', 'mock')
      `)).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should throw InvalidInputError for invalid pagination', async () => {
      await expect(listPublicCompanies({ page: '1abc', pageSize: 10 })).rejects.toThrow(InvalidInputError);
      await expect(listPublicCompanies({ page: 1, pageSize: 1.5 })).rejects.toThrow(InvalidInputError);
      await expect(listPublicCompanies({ page: -1, pageSize: 10 })).rejects.toThrow(InvalidInputError);
    });

    it('should throw RecordNotFoundError for missing records', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(getPublicCompanyById(fakeId)).rejects.toThrow(RecordNotFoundError);
    });

    it('should throw InvalidInputError for malformed UUID', async () => {
      await expect(getPublicCompanyById('not-a-uuid')).rejects.toThrow(InvalidInputError);
    });
  });

  describe('AP1: Public list and Pagination', () => {
    it('should return public companies with pagination info', async () => {
      const result = await listPublicCompanies({ page: 1, pageSize: 5 });
      expect(result.items.length).toBe(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(5);
      expect(result.total).toBeGreaterThan(0);
      
      const privateRec = result.items.find(c => c.visibility === 'private');
      expect(privateRec).toBeUndefined();
    });

    it('should return positions by company ID and not leak private positions/companies', async () => {
      const pool = getPool();
      const companies = await listPublicCompanies({ page: 1, pageSize: 5 });
      const companyId = companies.items[0].id;
      const positions = await listPublicPositionsByCompany(companyId);
      expect(Array.isArray(positions)).toBe(true);
      for (const p of positions) {
        expect(p.company_id).toBe(companyId);
        expect(p.visibility).toBe('public');
      }

      const privateCompany = await pool.query(
        "SELECT id FROM companies WHERE visibility = 'private' LIMIT 1"
      );
      expect(privateCompany.rows).toHaveLength(1);
      await expect(getPublicCompanyById(privateCompany.rows[0].id)).rejects.toThrow(RecordNotFoundError);
      await expect(listPublicPositionsByCompany(privateCompany.rows[0].id)).resolves.toEqual([]);

      const privatePosition = await pool.query(
        "SELECT id FROM positions WHERE visibility = 'private' LIMIT 1"
      );
      expect(privatePosition.rows).toHaveLength(1);
      await expect(getPublicPositionById(privatePosition.rows[0].id)).rejects.toThrow(RecordNotFoundError);
    });
  });

  describe('AP2 & AP3: Search and Filter', () => {
    it('partial search by name in Thai or English', async () => {
      const result = await searchPublicCompaniesAndPositions({ q: 'tech', page: 1, pageSize: 10 });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      
      const thaiResult = await searchPublicCompaniesAndPositions({ q: 'นักวิเคราะห์', page: 1, pageSize: 10 });
      expect(thaiResult.items.length).toBeGreaterThanOrEqual(1);
    });

    it('filter by location', async () => {
      const result = await searchPublicCompaniesAndPositions({ location: 'กรุงเทพฯ', page: 1, pageSize: 10 });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty result when no match', async () => {
      const result = await searchPublicCompaniesAndPositions({ q: 'ไม่พบข้อมูลตัวอย่างนี้', page: 1, pageSize: 10 });
      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('AP4: Detail by ID', () => {
    it('get company by ID', async () => {
      const list = await listPublicCompanies({ page: 1, pageSize: 1 });
      const company = await getPublicCompanyById(list.items[0].id);
      expect(company.id).toBe(list.items[0].id);
    });

    it('get position by ID', async () => {
      const pool = getPool();
      const posRes = await pool.query("SELECT id FROM positions WHERE visibility = 'public' LIMIT 1");
      const positionId = posRes.rows[0].id;
      
      const position = await getPublicPositionById(positionId);
      expect(position.id).toBe(positionId);
    });
  });

  describe('VP1: Mock Student and Plan', () => {
    it('get student by anonymous ref', async () => {
      const pool = getPool();
      const sRes = await pool.query("SELECT anonymous_ref FROM students LIMIT 1");
      const ref = sRes.rows[0].anonymous_ref;

      const student = await getMockStudentByAnonymousRef(ref);
      expect(student.anonymous_ref).toBe(ref);
      expect(student.visibility).toBe('private');
    });

    it('get plans by student ID', async () => {
      const pool = getPool();
      const sRes = await pool.query(`
        SELECT DISTINCT s.id
        FROM students s
        JOIN plans p ON p.student_id = s.id
        LIMIT 1
      `);
      const sId = sRes.rows[0].id;

      const plans = await listMockPlansByStudentId(sId);
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) {
        expect(plan.student_id).toBe(sId);
        expect(plan.visibility).toBe('private');
      }
    });
  });

  describe('Persistence Check', () => {
    it('data count and relationships are preserved after connection is closed and reopened', async () => {
      const tables = ['companies', 'positions', 'rounds', 'document_metadata', 'students', 'plans'];
      const beforeCounts = {};
      const poolBeforeClose = getPool();

      for (const table of tables) {
        const res = await poolBeforeClose.query(`SELECT COUNT(*) FROM ${table}`);
        beforeCounts[table] = parseInt(res.rows[0].count, 10);
      }

      const relationshipsBefore = await poolBeforeClose.query(`
        SELECT COUNT(*)
        FROM plans p
        JOIN students s ON s.id = p.student_id
        LEFT JOIN rounds r ON r.id = p.round_id
        WHERE p.round_id IS NULL OR r.id IS NOT NULL
      `);
      const relationshipCountBefore = parseInt(relationshipsBefore.rows[0].count, 10);
      expect(relationshipCountBefore).toBe(7);

      await close();

      const poolAfterReopen = getPool();
      const afterCounts = {};
      for (const table of tables) {
        const res = await poolAfterReopen.query(`SELECT COUNT(*) FROM ${table}`);
        afterCounts[table] = parseInt(res.rows[0].count, 10);
      }

      const relationshipsAfter = await poolAfterReopen.query(`
        SELECT COUNT(*)
        FROM plans p
        JOIN students s ON s.id = p.student_id
        LEFT JOIN rounds r ON r.id = p.round_id
        WHERE p.round_id IS NULL OR r.id IS NOT NULL
      `);
      const relationshipCountAfter = parseInt(relationshipsAfter.rows[0].count, 10);

      expect(afterCounts).toEqual(beforeCounts);
      expect(Object.values(afterCounts).reduce((sum, count) => sum + count, 0)).toBe(53);
      expect(relationshipCountAfter).toBe(relationshipCountBefore);
    });
  });
});
