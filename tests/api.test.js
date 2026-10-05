const http = require('node:http');

const { createApiServer } = require('../src/api/app');
const {
  DALError,
  InvalidInputError,
  RecordNotFoundError
} = require('../src/db/dal');

const company = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Example Company',
  description: 'Example description',
  website_url: 'https://example.com',
  location: 'กรุงเทพฯ',
  source: 'mock',
  updated_at: '2026-10-05T00:00:00.000Z',
  visibility: 'public',
  data_status: 'mock',
  private_note: 'must not be exposed'
};

const position = {
  id: '22222222-2222-4222-8222-222222222222',
  company_id: company.id,
  title: 'Software Engineer Intern',
  description: 'Example position',
  location: 'กรุงเทพฯ',
  source: 'mock',
  updated_at: '2026-10-05T00:00:00.000Z',
  visibility: 'public',
  data_status: 'mock',
  private_note: 'must not be exposed'
};

function makeDal(overrides = {}) {
  return {
    listPublicCompanies: jest.fn().mockResolvedValue({
      items: [company],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    }),
    searchPublicCompaniesAndPositions: jest.fn().mockResolvedValue({
      items: [{ ...company, positions: [position] }],
      page: 2,
      pageSize: 5,
      total: 1,
      totalPages: 1
    }),
    getPublicCompanyById: jest.fn().mockResolvedValue(company),
    listPublicPositionsByCompany: jest.fn().mockResolvedValue([position]),
    getPublicPositionById: jest.fn().mockResolvedValue(position),
    DALError,
    InvalidInputError,
    RecordNotFoundError,
    ...overrides
  };
}

function request(server, path, { method = 'GET' } = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path,
      method
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: JSON.parse(body)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(dal, callback) {
  const server = createApiServer({ dal });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  try {
    return await callback(server);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('CO-ED V2 public API', () => {
  test('returns a safe health response', async () => {
    await withServer(makeDal(), async (server) => {
      const response = await request(server, '/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: { status: 'ok', service: 'co-ed-v2-api' }
      });
      expect(JSON.stringify(response.body)).not.toMatch(/password|credential|database_url/i);
    });
  });

  test('lists companies with pagination and a public field allowlist', async () => {
    const dal = makeDal();
    await withServer(dal, async (server) => {
      const response = await request(server, '/api/companies');
      expect(response.status).toBe(200);
      expect(dal.listPublicCompanies).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
      expect(response.body.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
      expect(response.body.data[0]).not.toHaveProperty('visibility');
      expect(response.body.data[0]).not.toHaveProperty('private_note');
    });
  });

  test('passes search, location, and pagination to the existing DAL operation', async () => {
    const dal = makeDal();
    await withServer(dal, async (server) => {
      const response = await request(
        server,
        '/api/companies?q=Engineer&location=%E0%B8%81%E0%B8%A3%E0%B8%B8%E0%B8%87%E0%B9%80%E0%B8%97%E0%B8%9E%E0%B8%AF&page=2&pageSize=5'
      );
      expect(response.status).toBe(200);
      expect(dal.searchPublicCompaniesAndPositions).toHaveBeenCalledWith({
        q: 'Engineer',
        location: 'กรุงเทพฯ',
        page: '2',
        pageSize: '5'
      });
      expect(response.body.data[0].positions[0]).not.toHaveProperty('visibility');
      expect(response.body.data[0].positions[0]).not.toHaveProperty('private_note');
    });
  });

  test('returns company detail through the DAL', async () => {
    const dal = makeDal();
    await withServer(dal, async (server) => {
      const response = await request(server, `/api/companies/${company.id}`);
      expect(response.status).toBe(200);
      expect(dal.getPublicCompanyById).toHaveBeenCalledWith(company.id);
      expect(response.body.data.name).toBe(company.name);
    });
  });

  test('returns public positions belonging to a company', async () => {
    const dal = makeDal();
    await withServer(dal, async (server) => {
      const response = await request(server, `/api/companies/${company.id}/positions`);
      expect(response.status).toBe(200);
      expect(dal.listPublicPositionsByCompany).toHaveBeenCalledWith(company.id);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe(position.title);
      expect(response.body.data[0]).not.toHaveProperty('visibility');
      expect(response.body.data[0]).not.toHaveProperty('private_note');
    });
  });

  test('returns position detail through the DAL', async () => {
    const dal = makeDal();
    await withServer(dal, async (server) => {
      const response = await request(server, `/api/positions/${position.id}`);
      expect(response.status).toBe(200);
      expect(dal.getPublicPositionById).toHaveBeenCalledWith(position.id);
      expect(response.body.data.title).toBe(position.title);
    });
  });

  test('rejects unsupported query parameters', async () => {
    await withServer(makeDal(), async (server) => {
      const response = await request(server, '/api/companies?academicYear=2569');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });
  });

  test('returns 400 when pagination is invalid', async () => {
    const dal = makeDal({
      listPublicCompanies: jest.fn().mockRejectedValue(
        new InvalidInputError('Page must be a positive integer.')
      )
    });
    await withServer(dal, async (server) => {
      const response = await request(server, '/api/companies?page=0');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });
  });

  test('returns 400 when a path UUID is malformed', async () => {
    const dal = makeDal({
      getPublicCompanyById: jest.fn().mockRejectedValue(
        new InvalidInputError('Invalid input format (e.g., malformed UUID).')
      )
    });
    await withServer(dal, async (server) => {
      const response = await request(server, '/api/companies/not-a-uuid');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.each([
    [new InvalidInputError('Invalid UUID.'), 400, 'INVALID_INPUT'],
    [new RecordNotFoundError('Company not found.'), 404, 'RECORD_NOT_FOUND'],
    [new DALError('Database unavailable.', 'CONNECTION_ERROR'), 503, 'CONNECTION_ERROR'],
    [new DALError('Schema unavailable.', 'SCHEMA_NOT_READY'), 503, 'SCHEMA_NOT_READY'],
    [new Error('Sensitive internal error.'), 500, 'INTERNAL_ERROR']
  ])('maps DAL errors without exposing internals', async (error, status, code) => {
    const dal = makeDal({ getPublicCompanyById: jest.fn().mockRejectedValue(error) });
    await withServer(dal, async (server) => {
      const response = await request(server, `/api/companies/${company.id}`);
      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
      expect(JSON.stringify(response.body)).not.toContain('Sensitive internal error.');
    });
  });

  test('returns 405 for unsupported HTTP methods', async () => {
    await withServer(makeDal(), async (server) => {
      const response = await request(server, '/api/companies', { method: 'POST' });
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('GET');
    });
  });

  test('does not expose private Student or Plan routes', async () => {
    await withServer(makeDal(), async (server) => {
      const studentResponse = await request(server, '/api/students');
      const planResponse = await request(server, '/api/plans');
      expect(studentResponse.status).toBe(404);
      expect(planResponse.status).toBe(404);
    });
  });
});
