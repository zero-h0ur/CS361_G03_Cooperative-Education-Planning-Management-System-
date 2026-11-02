/**
 * TU Authentication Routes for CO-ED V3/V4.
 * Provides public login endpoint POST /api/v3/auth/tu-login and GET /api/v3/auth/tu-status.
 * Supports Hybrid mode (Real TU API when configured, else Local DB fallback).
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
    const result = await tuAuthService.login({
      studentId: body?.studentId,
      password: body?.password
    });

    sendSuccess(response, result, 200);
  });

  // 2. GET /api/v3/auth/tu-status
  router.get(TU_STATUS_PATH, async (request, response, context = {}) => {
    if (context.url?.searchParams) {
      assertAllowedQueryParameters(context.url.searchParams, new Set());
    }

    sendSuccess(
      response,
      {
        configured: true,
        mode: tuAuthService.isRealApiConfigured() ? 'tu_api' : 'local_fallback',
        tuApiUrl: tuAuthService.tuApiUrl,
        hasAppKey: tuAuthService.isRealApiConfigured()
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
