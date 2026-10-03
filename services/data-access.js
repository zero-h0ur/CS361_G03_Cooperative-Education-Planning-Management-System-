import { query } from '../config/database.js';

function parsePageOptions(page, pageSize) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 10));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

// 1. Companies
export async function listCompanies({ q, location, visibility = 'public', page = 1, pageSize = 10 } = {}) {
  const { page: p, pageSize: ps, offset } = parsePageOptions(page, pageSize);
  
  let baseQuery = `FROM companies WHERE visibility = $1`;
  const params = [visibility];
  
  if (q) {
    params.push(`%${q}%`);
    baseQuery += ` AND name ILIKE $${params.length}`;
  }
  if (location) {
    params.push(location);
    baseQuery += ` AND location = $${params.length}`;
  }

  try {
    const countRes = await query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = parseInt(countRes.rows[0].total, 10);
    
    const dataRes = await query(`
      SELECT id, name, description, website_url, location, source, updated_at, data_status
      ${baseQuery}
      ORDER BY name ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, ps, offset]);

    return {
      items: dataRes.rows,
      pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps), hasNextPage: offset + ps < total }
    };
  } catch (error) {
    throw new Error('Failed to retrieve companies');
  }
}

export async function searchCompanies(options) {
  return listCompanies(options);
}

export async function getCompanyById(id) {
  try {
    const res = await query(`SELECT id, name, description, website_url, location, source, updated_at, data_status FROM companies WHERE id = $1 AND visibility = 'public'`, [id]);
    return res.rows.length ? res.rows[0] : null;
  } catch (error) { throw new Error('Failed to retrieve company details'); }
}

// 2. Positions
export async function listPositions({ companyId, location, q, visibility = 'public', page = 1, pageSize = 10 } = {}) {
  const { page: p, pageSize: ps, offset } = parsePageOptions(page, pageSize);
  
  let baseQuery = `FROM positions WHERE visibility = $1`;
  const params = [visibility];
  
  if (companyId) { params.push(companyId); baseQuery += ` AND company_id = $${params.length}`; }
  if (location) { params.push(location); baseQuery += ` AND location = $${params.length}`; }
  if (q) { params.push(`%${q}%`); baseQuery += ` AND title ILIKE $${params.length}`; }

  try {
    const countRes = await query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = parseInt(countRes.rows[0].total, 10);
    const dataRes = await query(`SELECT id, company_id, title, description, location, source, updated_at, data_status ${baseQuery} ORDER BY title ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, ps, offset]);
    return { items: dataRes.rows, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps), hasNextPage: offset + ps < total } };
  } catch (error) { throw new Error('Failed to retrieve positions'); }
}

export async function listPositionsByCompany(companyId, options = {}) {
  return listPositions({ ...options, companyId });
}

export async function getPositionById(id) {
  try {
    const res = await query(`SELECT id, company_id, title, description, location, source, updated_at, data_status FROM positions WHERE id = $1 AND visibility = 'public'`, [id]);
    return res.rows.length ? res.rows[0] : null;
  } catch (error) { throw new Error('Failed to retrieve position details'); }
}

// 3. Rounds
export async function listRounds({ visibility = 'public', page = 1, pageSize = 10 } = {}) {
  const { page: p, pageSize: ps, offset } = parsePageOptions(page, pageSize);
  try {
    const countRes = await query(`SELECT COUNT(*) as total FROM rounds WHERE visibility = $1`, [visibility]);
    const total = parseInt(countRes.rows[0].total, 10);
    const dataRes = await query(`SELECT id, name, academic_year, source, updated_at, data_status FROM rounds WHERE visibility = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [visibility, ps, offset]);
    return { items: dataRes.rows, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps), hasNextPage: offset + ps < total } };
  } catch (error) { throw new Error('Failed to retrieve rounds'); }
}

export async function getRoundById(id) {
  try {
    const res = await query(`SELECT id, name, academic_year, source, updated_at, data_status FROM rounds WHERE id = $1 AND visibility = 'public'`, [id]);
    return res.rows.length ? res.rows[0] : null;
  } catch (error) { throw new Error('Failed to retrieve round'); }
}

// 4. Document Metadata
export async function listDocuments({ visibility = 'public', page = 1, pageSize = 10 } = {}) {
  const { page: p, pageSize: ps, offset } = parsePageOptions(page, pageSize);
  try {
    const countRes = await query(`SELECT COUNT(*) as total FROM document_metadata WHERE visibility = $1`, [visibility]);
    const total = parseInt(countRes.rows[0].total, 10);
    const dataRes = await query(`SELECT id, title, public_url, academic_year, source, updated_at, data_status FROM document_metadata WHERE visibility = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [visibility, ps, offset]);
    return { items: dataRes.rows, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps), hasNextPage: offset + ps < total } };
  } catch (error) { throw new Error('Failed to retrieve documents'); }
}

export async function getDocumentById(id) {
  try {
    const res = await query(`SELECT id, title, public_url, academic_year, source, updated_at, data_status FROM document_metadata WHERE id = $1 AND visibility = 'public'`, [id]);
    return res.rows.length ? res.rows[0] : null;
  } catch (error) { throw new Error('Failed to retrieve document'); }
}

// 5. Mock Student and Plan (VP1)
export async function getMockStudentByAnonymousRef(anonymousRef) {
  try {
    const res = await query(`SELECT id, anonymous_ref, source, updated_at, data_status FROM students WHERE anonymous_ref = $1 AND visibility = 'private' AND data_status = 'mock'`, [anonymousRef]);
    return res.rows.length ? res.rows[0] : null;
  } catch (error) { throw new Error('Failed to retrieve mock student'); }
}

export async function listPlansByMockStudent(studentId) {
  try {
    const res = await query(`SELECT id, student_id, round_id, source, updated_at, data_status FROM plans WHERE student_id = $1 AND visibility = 'private' AND data_status = 'mock'`, [studentId]);
    return res.rows;
  } catch (error) { throw new Error('Failed to retrieve mock plans'); }
}

