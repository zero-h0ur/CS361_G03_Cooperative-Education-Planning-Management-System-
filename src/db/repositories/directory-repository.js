const { getPool } = require('../connection');
const { ValidationError, NotFoundError } = require('../../api/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANY_FIELDS = 'c.id, c.name, c.location, c.address, c.logo_path AS logo, c.directory_code AS code, c.source, c.updated_at, c.data_status';
const POSITION_FIELDS = 'p.id, p.company_id, p.title, p.announcement_ref, p.quota_text AS quota, p.duration_text AS duration, p.academic_year';
// Prefer the imported catalogue without changing legacy companies/Plan references.
const CATALOG = `c.visibility = 'public' AND (c.catalog_key IS NOT NULL OR NOT EXISTS
  (SELECT 1 FROM companies catalog WHERE catalog.catalog_key IS NOT NULL AND catalog.visibility = 'public'))`;

function parseDirectoryQuery(params, authenticated) {
  const allowed = new Set(['q', 'location', 'page', 'pageSize']);
  if (authenticated) ['role', 'duration', 'recruitingOnly'].forEach(key => allowed.add(key));
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new ValidationError('Invalid directory filters.');
  }
  const page = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 12);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ValidationError('Invalid pagination.');
  }
  const result = { page, pageSize };
  for (const key of ['q', 'location', 'role', 'duration']) {
    result[key] = (params.get(key) || '').trim();
    if (result[key].length > 200) throw new ValidationError('Directory filter is too long.');
  }
  const recruiting = params.get('recruitingOnly');
  if (recruiting !== null && !['true', 'false'].includes(recruiting)) throw new ValidationError('Invalid directory filters.');
  result.recruitingOnly = recruiting === 'true';
  return result;
}

class DirectoryRepository {
  constructor({ pool } = {}) { this.pool = pool || getPool(); }

  async positions(companyId) {
    if (!UUID.test(companyId)) throw new ValidationError('Invalid company ID.');
    const result = await this.pool.query(`SELECT ${POSITION_FIELDS}
      FROM positions p JOIN companies c ON c.id = p.company_id
      WHERE c.id = $1 AND c.visibility = 'public' AND p.visibility = 'public'
      ORDER BY p.announcement_ref NULLS LAST, p.title, p.id`, [companyId]);
    return result.rows;
  }

  async position(id) {
    if (!UUID.test(id)) throw new ValidationError('Invalid position ID.');
    const result = await this.pool.query(`SELECT ${POSITION_FIELDS}
      FROM positions p JOIN companies c ON c.id = p.company_id
      WHERE p.id = $1 AND c.visibility = 'public' AND p.visibility = 'public'`, [id]);
    if (!result.rows[0]) throw new NotFoundError('Position not found.');
    return result.rows[0];
  }

  async detail(id, authenticated = false) {
    if (!UUID.test(id)) throw new ValidationError('Invalid company ID.');
    const result = await this.pool.query(`SELECT ${COMPANY_FIELDS} FROM companies c
      WHERE c.id = $1 AND c.visibility = 'public'`, [id]);
    if (!result.rows[0]) throw new NotFoundError('Company not found.');
    const company = result.rows[0];
    if (authenticated) company.positions = await this.positions(id);
    return { ...company, details_available: authenticated };
  }

  async list(query, authenticated = false) {
    const values = [query.q ? '%' + query.q.replace(/[\\%_]/g, '\\$&') + '%' : '',
      query.location, query.role ? '%' + query.role.replace(/[\\%_]/g, '\\$&') + '%' : '',
      query.duration, query.recruitingOnly];
    const visible = `p.company_id = c.id AND p.visibility = 'public'`;
    const conditions = `${CATALOG}
      AND ($1 = '' OR c.name ILIKE $1 OR c.directory_code ILIKE $1 OR c.address ILIKE $1
        ${authenticated ? `OR EXISTS (SELECT 1 FROM positions p WHERE ${visible} AND p.title ILIKE $1)` : ''})
      AND ($2 = '' OR c.location = $2)
      AND ($3 = '' OR EXISTS (SELECT 1 FROM positions p WHERE ${visible} AND p.title ILIKE $3))
      AND ($4 = '' OR EXISTS (SELECT 1 FROM positions p WHERE ${visible} AND p.duration_text = $4))
      AND (NOT $5::boolean OR EXISTS (SELECT 1 FROM positions p WHERE ${visible}))`;
    const count = await this.pool.query(`SELECT count(*)::integer AS total FROM companies c WHERE ${conditions}`, values);
    const rows = await this.pool.query(`SELECT ${COMPANY_FIELDS} FROM companies c WHERE ${conditions}
      ORDER BY c.name, c.id LIMIT $6 OFFSET $7`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize]);
    const items = rows.rows.map(row => ({ ...row, details_available: authenticated }));
    if (authenticated && items.length) {
      const positions = await this.pool.query(`SELECT ${POSITION_FIELDS} FROM positions p
        WHERE p.company_id = ANY($1::uuid[]) AND p.visibility = 'public'
        ORDER BY p.announcement_ref NULLS LAST, p.title, p.id`, [items.map(row => row.id)]);
      for (const company of items) company.positions = positions.rows.filter(p => p.company_id === company.id);
    }
    const locations = await this.pool.query(`SELECT DISTINCT c.location FROM companies c
      WHERE ${CATALOG} AND c.location IS NOT NULL ORDER BY c.location`);
    const filters = { locations: locations.rows.map(row => row.location) };
    if (authenticated) {
      const result = await this.pool.query(`SELECT DISTINCT p.duration_text FROM positions p
        JOIN companies c ON c.id = p.company_id WHERE ${CATALOG} AND p.visibility = 'public'
        AND p.duration_text IS NOT NULL ORDER BY p.duration_text`);
      filters.durations = result.rows.map(row => row.duration_text);
    }
    const total = count.rows[0].total;
    return { items, pagination: { page: query.page, pageSize: query.pageSize, total,
      totalPages: Math.ceil(total / query.pageSize), details_available: authenticated, filters } };
  }
}
module.exports = { DirectoryRepository, parseDirectoryQuery };
