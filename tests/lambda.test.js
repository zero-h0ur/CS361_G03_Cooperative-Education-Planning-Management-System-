const {
  DALError,
  InvalidInputError,
  RecordNotFoundError
} = require('../src/db/dal');
const { buildRequestUrl, createLambdaHandler } = require('../src/lambda');

function makeDal(overrides = {}) {
  return {
    listPublicCompanies: jest.fn().mockResolvedValue({
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Example Company',
        location: 'กรุงเทพฯ',
        source: 'mock',
        updated_at: '2026-10-05T00:00:00.000Z',
        visibility: 'public',
        data_status: 'mock',
        private_note: 'must not be exposed'
      }],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    }),
    searchPublicCompaniesAndPositions: jest.fn(),
    getPublicCompanyById: jest.fn(),
    listPublicPositionsByCompany: jest.fn(),
    getPublicPositionById: jest.fn(),
    DALError,
    InvalidInputError,
    RecordNotFoundError,
    ...overrides
  };
}

function httpApiEvent(rawPath, rawQueryString = '', method = 'GET') {
  return {
    rawPath,
    rawQueryString,
    requestContext: { http: { method } }
  };
}

describe('API Gateway HTTP API Lambda adapter', () => {
  test('builds the request URL from a payload v2 event', () => {
    expect(buildRequestUrl(httpApiEvent('/api/companies', 'page=2&pageSize=5')))
      .toBe('/api/companies?page=2&pageSize=5');
  });

  test('returns the existing health contract', async () => {
    const response = await createLambdaHandler({ dal: makeDal() })(
      httpApiEvent('/api/health')
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(response.body)).toEqual({
      data: { status: 'ok', service: 'co-ed-v2-api' }
    });
    expect(response.isBase64Encoded).toBe(false);
  });

  test('reuses the company route and public field allowlist', async () => {
    const dal = makeDal();
    const response = await createLambdaHandler({ dal })(
      httpApiEvent('/api/companies', 'page=1&pageSize=10')
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(dal.listPublicCompanies).toHaveBeenCalledWith({ page: '1', pageSize: '10' });
    expect(body.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(body.data[0]).not.toHaveProperty('visibility');
    expect(body.data[0]).not.toHaveProperty('private_note');
  });

  test('preserves API error mapping when the database is unavailable', async () => {
    const dal = makeDal({
      listPublicCompanies: jest.fn().mockRejectedValue(
        new DALError('Database unavailable.', 'CONNECTION_ERROR')
      )
    });
    const response = await createLambdaHandler({ dal })(
      httpApiEvent('/api/companies')
    );

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'CONNECTION_ERROR',
        message: 'Service temporarily unavailable.'
      }
    });
  });

  test('rejects unsupported methods through the existing API contract', async () => {
    const response = await createLambdaHandler({ dal: makeDal() })(
      httpApiEvent('/api/companies', '', 'POST')
    );

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET');
    expect(JSON.parse(response.body).error.code).toBe('METHOD_NOT_ALLOWED');
  });
});
