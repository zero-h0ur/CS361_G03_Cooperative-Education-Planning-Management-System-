/**
 * Student Self-Profile Routes for CO-ED V3.
 * Provides GET / PATCH / PUT /api/v3/students/me (and /api/students/me, /students/me).
 * Conforms to Issue #50, #51, #55, #61, #62, and #65.
 */

const { ACTIONS } = require('../services/authorization-service');
const {
  StudentProfileService,
  STUDENT_SELF_PROFILE_FIELDS,
  toStudentSelfProfile,
  validateAndNormalizeStudentProfileUpdate
} = require('../services/student-profile-service');
const {
  assertAllowedQueryParameters,
  decodePathParameter,
  parseJsonBody
} = require('../router');
const { ForbiddenError } = require('../errors');
const { sendSuccess } = require('../response');

const STUDENT_SELF_PROFILE_PATHS = Object.freeze([
  '/api/v3/students/me',
  '/api/students/me',
  '/students/me'
]);

const STUDENT_BY_ID_PATTERNS = Object.freeze([
  /^\/api\/v3\/students\/(?!me$)([^/]+)$/,
  /^\/api\/students\/(?!me$)([^/]+)$/,
  /^\/students\/(?!me$)([^/]+)$/
]);

const ALLOWED_PROFILE_QUERY_PARAMS = new Set([]);

/**
 * Registers Student self-profile GET and UPDATE routes on the V3 router.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 */
function registerStudentProfileRoutes(router, registerProtectedRoute, options = {}) {
  const studentProfileService =
    options.studentProfileService || new StudentProfileService(options);

  const handleGetOwnProfile = async (request, response, context) => {
    assertAllowedQueryParameters(
      context.url.searchParams,
      ALLOWED_PROFILE_QUERY_PARAMS
    );

    const profile = await studentProfileService.getOwnProfile(context.authContext);
    sendSuccess(response, profile, 200);
  };

  const handleUpdateOwnProfile = async (request, response, context) => {
    assertAllowedQueryParameters(
      context.url.searchParams,
      ALLOWED_PROFILE_QUERY_PARAMS
    );

    const body = await parseJsonBody(request);
    const updatedProfile = await studentProfileService.updateOwnProfile(
      context.authContext,
      body
    );
    sendSuccess(response, updatedProfile, 200);
  };

  for (const path of STUDENT_SELF_PROFILE_PATHS) {
    registerProtectedRoute(router, {
      method: 'GET',
      pattern: path,
      action: ACTIONS.STUDENT_READ_PROFILE,
      resolveResource: (req) => ({
        studentId: req.authContext?.studentId || null
      }),
      authOptions: options,
      handler: handleGetMeOrRejectNonStudent(handleGetOwnProfile)
    });

    for (const method of ['PATCH', 'PUT']) {
      registerProtectedRoute(router, {
        method,
        pattern: path,
        action: ACTIONS.STUDENT_UPDATE_SELF_PROFILE,
        resolveResource: (req) => ({
          studentId: req.authContext?.studentId || null
        }),
        authOptions: options,
        handler: handleUpdateOwnProfile
      });
    }
  }

  // Guard /students/:studentId against cross-student read/update attempts (#51 & #65)
  for (const pattern of STUDENT_BY_ID_PATTERNS) {
    registerProtectedRoute(router, {
      method: 'GET',
      pattern,
      action: ACTIONS.STUDENT_READ_PROFILE,
      resolveResource: (req, ctx) => ({
        studentId: decodePathParameter(ctx.params[0])
      }),
      authOptions: options,
      handler: async (request, response, context) => {
        // Self-profile endpoint requires /students/me; reject direct studentId selection by Student
        if (context.authContext?.role === 'STUDENT') {
          throw new ForbiddenError('Access denied.', 'FORBIDDEN');
        }
        const profile = await studentProfileService.getOwnProfile(context.authContext, {
          targetStudentId: decodePathParameter(context.params[0])
        });
        sendSuccess(response, profile, 200);
      }
    });

    for (const method of ['PATCH', 'PUT']) {
      registerProtectedRoute(router, {
        method,
        pattern,
        action: ACTIONS.STUDENT_UPDATE_SELF_PROFILE,
        resolveResource: (req, ctx) => ({
          studentId: decodePathParameter(ctx.params[0])
        }),
        authOptions: options,
        handler: async () => {
          throw new ForbiddenError('Access denied.', 'FORBIDDEN');
        }
      });
    }
  }
}

function handleGetMeOrRejectNonStudent(innerHandler) {
  return async function wrappedGetOwnProfile(request, response, context) {
    if (context.authContext?.role !== 'STUDENT') {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }
    return innerHandler(request, response, context);
  };
}

module.exports = {
  STUDENT_SELF_PROFILE_PATHS,
  STUDENT_SELF_PROFILE_FIELDS,
  toStudentSelfProfile,
  validateAndNormalizeStudentProfileUpdate,
  registerStudentProfileRoutes
};
