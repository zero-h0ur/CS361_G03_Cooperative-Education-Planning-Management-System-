/**
 * TU Authentication Routes for CO-ED V3/V4.
 * Provides public login endpoint POST /api/v3/auth/tu-login and GET /api/v3/auth/tu-status.
 * Server-verified TU only; no offline/local authentication fallback.
 */

const { parseJsonBody, assertAllowedQueryParameters } = require('../router');
const { sendSuccess } = require('../response');
const { TuAuthService } = require('../../auth/tu-auth-service');

const TU_LOGIN_PATH = '/api/v3/auth/tu-login';
const TU_STATUS_PATH = '/api/v3/auth/tu-status';

/**
 * Registers TU Authentication public routes on the application router.
 *
 * @param {import('../router').Router} router
 * @param {object} [options]
 * @param {TuAuthService} [options.tuAuthService]
 */
function registerTuAuthRoutes(router, options = {}) {
  const tuAuthService =
    options.tuAuthService || new TuAuthService(options);

  // 1. POST /api/v3/auth/tu-login
  router.post(TU_LOGIN_PATH, async (request, response) => {
    const body = await parseJsonBody(request);
    const result = await tuAuthService.login(body);

    sendSuccess(response, result, 200, null, {'Cache-Control':'no-store'});
  });

  // 2. GET /api/v3/auth/tu-status
  router.get(TU_STATUS_PATH, async (request, response, context = {}) => {
    if (context.url?.searchParams) {
      assertAllowedQueryParameters(context.url.searchParams, new Set());
    }

    sendSuccess(
      response,
      {
        configured: tuAuthService.isRealApiConfigured(),
        mode: 'tu_api'
      },
      200
    );
  });
}

module.exports = {
  TU_LOGIN_PATH,
  TU_STATUS_PATH,
  registerTuAuthRoutes
};
