const { getPool, close } = require('../src/db/connection');
const { seed } = require('../src/db/seed');
const { 
  listPublicCompanies, 
  listPublicPositionsByCompany, 
  searchPublicCompaniesAndPositions,
  getPublicCompanyById,
  getPublicPositionById,
  getMockStudentByAnonymousRef,
  listMockPlansByStudentId
} = require('../src/db/dal');

describe('Data Access Layer', () => {
  beforeAll(async () => {
    // We assume the DB is running and DATABASE_URL is set
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
  });

  describe('AP1: Public list and Pagination', () => {
    it('should return public companies with pagination info', async () => {
      const result = await listPublicCompanies({ page: 1, pageSize: 5 });
      expect(result.items.length).toBe(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(5);
      expect(result.total).toBeGreaterThan(0);
      // Ensure no private records
      const privateRec = result.items.find(c => c.visibility === 'private');
      expect(privateRec).toBeUndefined();
    });

    it('should return positions by company ID', async () => {
      const companies = await listPublicCompanies({ page: 1, pageSize: 5 });
      const companyId = companies.items[0].id;
      const positions = await listPublicPositionsByCompany(companyId);
      expect(Array.isArray(positions)).toBe(true);
      if (positions.length > 0) {
        expect(positions[0].company_id).toBe(companyId);
        expect(positions[0].visibility).toBe('public');
      }
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
      const sRes = await pool.query("SELECT id FROM students LIMIT 1");
      const sId = sRes.rows[0].id;

      const plans = await listMockPlansByStudentId(sId);
      expect(Array.isArray(plans)).toBe(true);
      if (plans.length > 0) {
        expect(plans[0].student_id).toBe(sId);
        expect(plans[0].visibility).toBe('private');
      }
    });
  });

  describe('Persistence Check', () => {
    it('data is preserved after connection is closed and reopened', async () => {
      await close(); // Close existing pool
      
      // Attempt to query again, pool should automatically re-initialize in connection.js
      const pool = getPool();
      const res = await pool.query("SELECT COUNT(*) FROM companies");
      expect(parseInt(res.rows[0].count, 10)).toBe(12); // Should be 12 based on the 53 records breakdown
    });
  });
});
