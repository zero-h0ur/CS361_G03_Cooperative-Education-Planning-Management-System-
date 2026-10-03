import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  listCompanies, getCompanyById,
  listPositions, getPositionById, listPositionsByCompany,
  listRounds, getRoundById,
  listDocuments, getDocumentById,
  getMockStudentByAnonymousRef, listPlansByMockStudent
} from '../services/data-access.js';

// Note: These tests expect the database to be seeded via `npm run seed` before execution.

test('Data Access Layer - Companies', async (t) => {
  await t.test('listCompanies - should return paginated list of public companies', async () => {
    const res = await listCompanies({ pageSize: 5 });
    assert.ok(res.items);
    assert.ok(Array.isArray(res.items));
    assert.equal(res.pagination.pageSize, 5);
    if (res.items.length > 0) {
      assert.equal(res.items[0].visibility, 'public');
    }
  });

  await t.test('listCompanies - should filter by location', async () => {
    const res = await listCompanies({ location: 'Bangkok' });
    assert.ok(res.items.every(c => c.location === 'Bangkok'));
  });

  await t.test('listCompanies - should partial search by name', async () => {
    const res = await listCompanies({ q: 'Demo' });
    assert.ok(res.items.every(c => c.name.includes('Demo') || c.title?.includes('Demo')));
  });

  await t.test('getCompanyById - should return details for valid public company', async () => {
    const res = await listCompanies({ pageSize: 1 });
    if (res.items.length > 0) {
      const companyId = res.items[0].id;
      const company = await getCompanyById(companyId);
      assert.ok(company);
      assert.equal(company.id, companyId);
      assert.ok(Array.isArray(company.positions));
    }
  });

  await t.test('getCompanyById - should return null for non-existent ID', async () => {
    const company = await getCompanyById('00000000-0000-0000-0000-000000000000');
    assert.equal(company, null);
  });
});

test('Data Access Layer - Positions', async (t) => {
  await t.test('listPositions - should return paginated list', async () => {
    const res = await listPositions({ pageSize: 5 });
    assert.ok(Array.isArray(res.items));
  });

  await t.test('listPositionsByCompany - should return positions for specific company', async () => {
    const resComp = await listCompanies({ pageSize: 1 });
    if (resComp.items.length > 0) {
      const companyId = resComp.items[0].id;
      const res = await listPositionsByCompany(companyId);
      assert.ok(res.items.every(p => p.company_id === companyId));
    }
  });
});

test('Data Access Layer - Mock Student and Plan (VP1)', async (t) => {
  await t.test('getMockStudentByAnonymousRef - should return valid mock student', async () => {
    const ref = 'mock-student-1';
    const student = await getMockStudentByAnonymousRef(ref);
    if (student) {
      assert.equal(student.anonymous_ref, ref);
      assert.equal(student.visibility, 'private');
      assert.equal(student.data_status, 'mock');
      
      const plans = await listPlansByMockStudent(student.id);
      assert.ok(Array.isArray(plans));
      assert.ok(plans.every(p => p.student_id === student.id));
    }
  });
});

