const { ACTIONS } = require('../services/authorization-service');
const { AdminOperationsService } = require('../services/admin-operations-service');
const { assertAllowedQueryParameters } = require('../router');
const { ValidationError } = require('../errors');
const { sendSuccess } = require('../response');

function registerAdminOperationsRoutes(router, protect, options = {}) {
  const service = options.adminOperationsService ||
    new AdminOperationsService({ ...options.authOptions, ...options });

  protect(router, {
    method: 'GET',
    pattern: '/api/v3/admin/operations',
    action: ACTIONS.ADMIN_READ_OPERATIONS,
    authOptions: options.authOptions || {},
    handler: async (_req, res, ctx) => {
      assertAllowedQueryParameters(ctx.url.searchParams, new Set(['page']));
      if (ctx.url.searchParams.getAll('page').length > 1) {
        throw new ValidationError('Duplicate page.');
      }
      const value = ctx.url.searchParams.get('page');
      if (value !== null && !/^[1-9][0-9]{0,6}$/.test(value)) {
        throw new ValidationError('Invalid page.');
      }
      const data = await service.read(ctx.authContext, value === null ? 1 : Number(value));
      sendSuccess(res, data, 200, null, { 'Cache-Control': 'no-store' });
    }
  });
}

module.exports = { registerAdminOperationsRoutes };
