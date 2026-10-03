const { getPool } = require('./connection');

class DALError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DALError';
    this.code = code;
  }
}

class RecordNotFoundError extends DALError {
  constructor(message) {
    super(message, 'RECORD_NOT_FOUND');
    this.name = 'RecordNotFoundError';
  }
}

class InvalidInputError extends DALError {
  constructor(message) {
    super(message, 'INVALID_INPUT');
    this.name = 'InvalidInputError';
  }
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function validatePagination(page, pageSize) {
  const p = Number(page);
  const ps = Number(pageSize);
  
  if (!Number.isInteger(p) || p < 1) throw new InvalidInputError("Page must be a positive integer.");
  if (!Number.isInteger(ps) || ps < 1) throw new InvalidInputError("PageSize must be a positive integer.");
  if (ps > MAX_PAGE_SIZE) throw new InvalidInputError(`PageSize cannot exceed ${MAX_PAGE_SIZE}.`);
  
  return { page: p, pageSize: ps };
}

async function executeQuery(text, params) {
  const pool = getPool();
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      throw new DALError("Database connection unavailable.", 'CONNECTION_ERROR');
    }
    if (err.code === '22P02') { // invalid_text_representation
      throw new InvalidInputError("Invalid input format (e.g., malformed UUID).");
    }
    if (err.code === '23502') { // not_null_violation
      throw new DALError("Required field is missing.", 'CONSTRAINT_VIOLATION');
    }
    if (err.code === '23505') { // unique_violation
      throw new DALError("Unique constraint violation.", 'CONSTRAINT_VIOLATION');
    }
    if (err.code === '23503') { // foreign_key_violation
      throw new DALError("Foreign key constraint violation.", 'CONSTRAINT_VIOLATION');
    }
    if (err.code === '23514') { // check_violation
      throw new DALError("Check constraint violation.", 'CONSTRAINT_VIOLATION');
    }
    if (err.code === '42P01') { // undefined_table
      throw new DALError("Migration or Schema not ready.", 'SCHEMA_NOT_READY');
    }
    // generic query failure
    throw new DALError("Query failed.", 'QUERY_FAILURE');
  }
}

async function listPublicCompanies({ page = 1, pageSize = DEFAULT_PAGE_SIZE }) {
  const { page: p, pageSize: ps } = validatePagination(page, pageSize);
  const offset = (p - 1) * ps;

  const countQuery = `SELECT COUNT(*) FROM companies WHERE visibility = 'public'`;
  const countRes = await executeQuery(countQuery, []);
  const total = parseInt(countRes.rows[0].count, 10);

  const query = `
    SELECT * FROM companies 
    WHERE visibility = 'public' 
    ORDER BY name ASC 
    LIMIT $1 OFFSET $2
  `;
  const res = await executeQuery(query, [ps, offset]);

  return {
    items: res.rows,
    page: p,
    pageSize: ps,
    total,
    totalPages: Math.ceil(total / ps)
  };
}

async function listPublicPositionsByCompany(companyId) {
  if (!companyId) throw new InvalidInputError("Company ID is required.");
  
  const query = `
    SELECT p.* FROM positions p
    JOIN companies c ON p.company_id = c.id
    WHERE p.company_id = $1 
      AND p.visibility = 'public' 
      AND c.visibility = 'public'
    ORDER BY p.title ASC
  `;
  const res = await executeQuery(query, [companyId]);
  return res.rows;
}

async function searchPublicCompaniesAndPositions({ q = '', location = null, page = 1, pageSize = DEFAULT_PAGE_SIZE }) {
  const { page: p, pageSize: ps } = validatePagination(page, pageSize);
  const offset = (p - 1) * ps;
  
  const searchPattern = `%${q}%`;
  
  // Find distinct companies matching the criteria (either company matches or its position matches)
  const countQuery = `
    SELECT COUNT(DISTINCT c.id) 
    FROM companies c
    LEFT JOIN positions pos ON c.id = pos.company_id AND pos.visibility = 'public'
    WHERE c.visibility = 'public'
      AND (
        (c.name ILIKE $1 OR pos.title ILIKE $1)
      )
      AND ($2::text IS NULL OR c.location = $2 OR pos.location = $2)
  `;
  const countRes = await executeQuery(countQuery, [searchPattern, location]);
  const total = parseInt(countRes.rows[0].count, 10);

  const query = `
    SELECT DISTINCT c.* 
    FROM companies c
    LEFT JOIN positions pos ON c.id = pos.company_id AND pos.visibility = 'public'
    WHERE c.visibility = 'public'
      AND (
        (c.name ILIKE $1 OR pos.title ILIKE $1)
      )
      AND ($2::text IS NULL OR c.location = $2 OR pos.location = $2)
    ORDER BY c.name ASC
    LIMIT $3 OFFSET $4
  `;
  const res = await executeQuery(query, [searchPattern, location, ps, offset]);
  
  const companies = res.rows;
  if (companies.length > 0) {
    const companyIds = companies.map(c => c.id);
    const posQuery = `
      SELECT p.* FROM positions p
      JOIN companies c ON p.company_id = c.id
      WHERE p.company_id = ANY($1) 
        AND p.visibility = 'public'
        AND c.visibility = 'public'
        AND (p.title ILIKE $2 OR $2 = '%%')
        AND ($3::text IS NULL OR p.location = $3)
      ORDER BY p.title ASC
    `;
    const posRes = await executeQuery(posQuery, [companyIds, searchPattern, location]);
    
    const posMap = {};
    for (const pos of posRes.rows) {
      if (!posMap[pos.company_id]) posMap[pos.company_id] = [];
      posMap[pos.company_id].push(pos);
    }
    
    for (const c of companies) {
      c.positions = posMap[c.id] || [];
    }
  }

  return {
    items: companies,
    page: p,
    pageSize: ps,
    total,
    totalPages: Math.ceil(total / ps)
  };
}

async function getPublicCompanyById(companyId) {
  if (!companyId) throw new InvalidInputError("Company ID is required.");
  
  const query = `SELECT * FROM companies WHERE id = $1 AND visibility = 'public'`;
  const res = await executeQuery(query, [companyId]);
  
  if (res.rows.length === 0) {
    throw new RecordNotFoundError(`Company with ID ${companyId} not found or not public.`);
  }
  return res.rows[0];
}

async function getPublicPositionById(positionId) {
  if (!positionId) throw new InvalidInputError("Position ID is required.");
  
  const query = `
    SELECT p.* FROM positions p
    JOIN companies c ON p.company_id = c.id
    WHERE p.id = $1 
      AND p.visibility = 'public'
      AND c.visibility = 'public'
  `;
  const res = await executeQuery(query, [positionId]);
  
  if (res.rows.length === 0) {
    throw new RecordNotFoundError(`Position with ID ${positionId} not found or not public.`);
  }
  return res.rows[0];
}

async function getMockStudentByAnonymousRef(anonymousRef) {
  if (!anonymousRef) throw new InvalidInputError("Anonymous Ref is required.");
  
  const query = `SELECT * FROM students WHERE anonymous_ref = $1 AND visibility = 'private' AND data_status = 'mock'`;
  const res = await executeQuery(query, [anonymousRef]);
  
  if (res.rows.length === 0) {
    throw new RecordNotFoundError(`Mock student with ref ${anonymousRef} not found.`);
  }
  return res.rows[0];
}

async function listMockPlansByStudentId(studentId) {
  if (!studentId) throw new InvalidInputError("Student ID is required.");
  
  const query = `SELECT * FROM plans WHERE student_id = $1 AND visibility = 'private' AND data_status = 'mock'`;
  const res = await executeQuery(query, [studentId]);
  return res.rows;
}

module.exports = {
  listPublicCompanies,
  listPublicPositionsByCompany,
  searchPublicCompaniesAndPositions,
  getPublicCompanyById,
  getPublicPositionById,
  getMockStudentByAnonymousRef,
  listMockPlansByStudentId,
  DALError,
  RecordNotFoundError,
  InvalidInputError
};
