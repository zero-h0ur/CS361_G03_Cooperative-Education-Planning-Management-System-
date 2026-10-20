const pick = (row, fields) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const position = row => pick(row, ['id', 'company_id', 'title', 'announcement_ref', 'quota', 'duration', 'academic_year']);
function company(row, includeDetails) {
  const result = pick(row, ['id', 'name', 'location', 'address', 'logo', 'code', 'source', 'updated_at', 'data_status']);
  result.details_available = includeDetails;
  if (includeDetails) result.positions = (row.positions || []).map(position);
  return result;
}

// Authentication/role policy runs in registerProtectedRoute before this service.
// Public methods never return recruitment or representative contact fields.
class DirectoryService {
  constructor(repository) { this.repository = repository; }
  async list(query, includeDetails) {
    const result = await this.repository.list(query, includeDetails);
    return { data: result.items.map(row => company(row, includeDetails)), pagination: result.pagination };
  }
  async detail(id, includeDetails) { return company(await this.repository.detail(id, includeDetails), includeDetails); }
  async positions(id) { return (await this.repository.positions(id)).map(position); }
  async position(id) { return position(await this.repository.position(id)); }
}
module.exports = { DirectoryService };
