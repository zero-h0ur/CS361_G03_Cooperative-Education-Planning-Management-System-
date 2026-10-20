/**
 * Public Company Directory and Health routes for CO-ED V2/V3.
 * Legacy public position fields are limited to synthetic mock records.
 * Real recruitment details are served by the authenticated Directory routes.
 */

const { sendSuccess } = require('../response');
const { assertAllowedQueryParameters, decodePathParameter } = require('../router');

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
    company.positions = record.positions.filter(position => position.data_status === 'mock').map(toPublicPosition);
  }
  return company;
}

/**
 * Registers all public company directory routes onto the router.
 *
 * @param {import('../router').Router} router
 */
function registerPublicCompanyRoutes(router) {
  // 1. Health check
  router.get('/api/health', async (request, response, { url, dal }) => {
    assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
    sendSuccess(response, {
      status: 'ok',
      service: 'co-ed-v2-api'
    });
  });

  // 2. Company list & search
  router.get('/api/companies', async (request, response, { url, dal }) => {
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

    sendSuccess(
      response,
      result.items.map(toPublicCompany),
      200,
      {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages
      }
    );
  });

  // 3. Company positions list
  router.get(/^\/api\/companies\/([^/]+)\/positions$/, async (request, response, { url, params, dal }) => {
    assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
    const companyId = decodePathParameter(params[0], dal.InvalidInputError);
    const positions = await dal.listPublicPositionsByCompany(companyId);
    sendSuccess(response, positions.map(toPublicPosition));
  });

  // 4. Company detail
  router.get(/^\/api\/companies\/([^/]+)$/, async (request, response, { url, params, dal }) => {
    assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
    const companyId = decodePathParameter(params[0], dal.InvalidInputError);
    const company = await dal.getPublicCompanyById(companyId);
    sendSuccess(response, toPublicCompany(company));
  });

  // 5. Position detail
  router.get(/^\/api\/positions\/([^/]+)$/, async (request, response, { url, params, dal }) => {
    assertAllowedQueryParameters(url.searchParams, new Set(), dal.InvalidInputError);
    const positionId = decodePathParameter(params[0], dal.InvalidInputError);
    const position = await dal.getPublicPositionById(positionId);
    sendSuccess(response, toPublicPosition(position));
  });
}

module.exports = {
  registerPublicCompanyRoutes,
  toPublicCompany,
  toPublicPosition,
  COMPANY_PUBLIC_FIELDS,
  POSITION_PUBLIC_FIELDS
};
