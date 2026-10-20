const { DirectoryRepository, parseDirectoryQuery } = require('../../db/repositories/directory-repository');
const { DirectoryService } = require('../services/directory-service');
const { ACTIONS } = require('../services/authorization-service');
const { sendSuccess } = require('../response');
const { assertAllowedQueryParameters, decodePathParameter } = require('../router');

function handlers(options) {
  // Construct lazily: module imports and unrelated routes must not open a pool.
  const service = () => new DirectoryService(options.directoryRepository || new DirectoryRepository(options.authOptions));
  const list = authenticated => async (request, response, { url }) => {
    const query = parseDirectoryQuery(url.searchParams, authenticated);
    const result = await service().list(query, authenticated);
    sendSuccess(response, result.data, 200, result.pagination, { 'Cache-Control': 'no-store' });
  };
  const detail = authenticated => async (request, response, { url, params }) => {
    assertAllowedQueryParameters(url.searchParams, new Set());
    sendSuccess(response, await service().detail(decodePathParameter(params[0]), authenticated),
      200, null, { 'Cache-Control': 'no-store' });
  };
  return { service, list, detail };
}
function registerPublicDirectoryRoutes(router, options = {}) {
  const { list, detail } = handlers(options);
  router.get('/api/directory/companies', list(false));
  router.get(/^\/api\/directory\/companies\/([^/]+)$/, detail(false));
}
function registerDirectoryRoutes(router, registerProtectedRoute, options = {}) {
  const { service, list, detail } = handlers(options);
  const register = (pattern, handler) => registerProtectedRoute(router, {
    method: 'GET', pattern, action: ACTIONS.DIRECTORY_READ_DETAILS,
    authOptions: options.authOptions || {}, handler
  });
  register('/api/v3/directory/companies', list(true));
  register(/^\/api\/v3\/directory\/companies\/([^/]+)$/, detail(true));
  register(/^\/api\/v3\/directory\/companies\/([^/]+)\/positions$/, async (request, response, { url, params }) => {
    assertAllowedQueryParameters(url.searchParams, new Set());
    sendSuccess(response, await service().positions(decodePathParameter(params[0])),
      200, null, { 'Cache-Control': 'no-store' });
  });
  register(/^\/api\/v3\/directory\/positions\/([^/]+)$/, async (request, response, { url, params }) => {
    assertAllowedQueryParameters(url.searchParams, new Set());
    sendSuccess(response, await service().position(decodePathParameter(params[0])),
      200, null, { 'Cache-Control': 'no-store' });
  });
}
module.exports = { registerDirectoryRoutes, registerPublicDirectoryRoutes };
