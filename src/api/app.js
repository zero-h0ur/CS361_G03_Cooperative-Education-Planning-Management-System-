const http = require('node:http');

const defaultDal = require('../db/dal');

const COMPANY_PUBLIC_FIELDS = [
  'id',
  'name',
  'description',
  'website_url',
  'location',
  'source',
  'updated_at',
  'data_status'
];

const POSITION_PUBLIC_FIELDS = [
  'id',
  'company_id',
  'title',
  'description',
  'location',
  'source',
  'updated_at',
  'data_status'
];

function pickFields(record, fields) {
  return fields.reduce((result, field) => {
    if (record[field] !== undefined) result[field] = record[field];
    return result;
  }, {});
}

function toPublicPosition(record) {
  return pickFields(record, POSITION_PUBLIC_FIELDS);
}

function toPublicCompany(record) {
  const company = pickFields(record, COMPANY_PUBLIC_FIELDS);
  if (Array.isArray(record.positions)) {
    company.positions = record.positions.map(toPublicPosition);
  }
  return company;
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, code, message, headers = {}) {
  sendJson(response, statusCode, { error: { code, message } }, headers);
}

function assertAllowedQueryParameters(searchParams, allowed, InvalidInputError) {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new InvalidInputError(`Unsupported query parameter: ${key}.`);
    }
  }
}

function decodePathParameter(value, InvalidInputError) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InvalidInputError('Invalid path parameter.');
  }
}

function mapError(error, dal) {
  if (error instanceof dal.InvalidInputError) {
    return { status: 400, code: error.code, message: error.message };
  }

  if (error instanceof dal.RecordNotFoundError) {
    return { status: 404, code: error.code, message: error.message };
  }

  if (error instanceof dal.DALError) {
    if (error.code === 'CONNECTION_ERROR' || error.code === 'SCHEMA_NOT_READY') {
      return { status: 503, code: error.code, message: 'Service temporarily unavailable.' };
    }
    return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error.' };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error.' };
}

function createRequestHandler(dal = defaultDal) {
  return async function requestHandler(request, response) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = url.pathname.length > 1
        ? url.pathname.replace(/\/$/, '')
        : url.pathname;

      if (request.method !== 'GET') {
        sendError(
          response,
          405,
          'METHOD_NOT_ALLOWED',
          'Method not allowed.',
          { Allow: 'GET' }
        );
        return;
      }

      if (pathname === '/api/health') {
        assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
        sendJson(response, 200, {
          data: {
            status: 'ok',
            service: 'co-ed-v2-api'
          }
        });
        return;
      }

      if (pathname === '/api/companies') {
        assertAllowedQueryParameters(
          url.searchParams,
          new Set(['q', 'location', 'page', 'pageSize']),
          dal.InvalidInputError
        );

        const q = (url.searchParams.get('q') || '').trim();
        const locationValue = (url.searchParams.get('location') || '').trim();
        const location = locationValue || null;
        const page = url.searchParams.get('page') || 1;
        const pageSize = url.searchParams.get('pageSize') || 10;

        const result = q || location
          ? await dal.searchPublicCompaniesAndPositions({ q, location, page, pageSize })
          : await dal.listPublicCompanies({ page, pageSize });

        sendJson(response, 200, {
          data: result.items.map(toPublicCompany),
          pagination: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: result.totalPages
          }
        });
        return;
      }

      const companyPositionsMatch = pathname.match(/^\/api\/companies\/([^/]+)\/positions$/);
      if (companyPositionsMatch) {
        assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
        const companyId = decodePathParameter(companyPositionsMatch[1], dal.InvalidInputError);
        const positions = await dal.listPublicPositionsByCompany(companyId);
        sendJson(response, 200, { data: positions.map(toPublicPosition) });
        return;
      }

      const companyMatch = pathname.match(/^\/api\/companies\/([^/]+)$/);
      if (companyMatch) {
        assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
        const companyId = decodePathParameter(companyMatch[1], dal.InvalidInputError);
        const company = await dal.getPublicCompanyById(companyId);
        sendJson(response, 200, { data: toPublicCompany(company) });
        return;
      }

      const positionMatch = pathname.match(/^\/api\/positions\/([^/]+)$/);
      if (positionMatch) {
        assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
        const positionId = decodePathParameter(positionMatch[1], dal.InvalidInputError);
        const position = await dal.getPublicPositionById(positionId);
        sendJson(response, 200, { data: toPublicPosition(position) });
        return;
      }

      sendError(response, 404, 'ROUTE_NOT_FOUND', 'Route not found.');
    } catch (error) {
      const mappedError = mapError(error, dal);
      sendError(response, mappedError.status, mappedError.code, mappedError.message);
    }
  };
}

function createApiServer({ dal = defaultDal } = {}) {
  return http.createServer(createRequestHandler(dal));
}

module.exports = {
  createApiServer,
  createRequestHandler,
  toPublicCompany,
  toPublicPosition
};
