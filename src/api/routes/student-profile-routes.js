/**
 * Student Self-Profile Routes for CO-ED V3.
 * Provides GET / PATCH / PUT /api/v3/students/me.
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
  parseJsonBody
} = require('../router');
const { getRequestContext } = require('../context');
const { ForbiddenError } = require('../errors');
const { sendSuccess } = require('../response');

// Single canonical path under the protected /api/v3 prefix (#48, #59).
// The owner always comes from the trusted identity context (#65 coordination note), so no
// /students/:studentId variant is registered here; that path belongs to Staff/Advisor (#67, #68).
const STUDENT_SELF_PROFILE_PATH = '/api/v3/students/me';

const ALLOWED_PROFILE_QUERY_PARAMS = new Set([]);

// Ownership target is the caller's own linked Student record from the trusted context (#61)
function resolveOwnStudent(request) {
  return { studentId: getRequestContext(request).studentId || null };
}

/**
 * Registers Student self-profile GET and UPDATE routes on the V3 router.
 *
 * @param {import('../router').Router} router
 * @param {Function} registerProtectedRoute
 * @param {object} [options]
 * @param {object} [options.authOptions] Auth/authz dependency overrides (tests)
 * @param {object} [options.studentProfileRepository] Repository override (tests)
 * @param {StudentProfileService} [options.studentProfileService] Service override (tests)
 */
function registerStudentProfileRoutes(router, registerProtectedRoute, options = {}) {
  const authOptions = options.authOptions || {};
  const studentProfileService =
    options.studentProfileService ||
    new StudentProfileService({
      ...authOptions,
      studentProfileRepository: options.studentProfileRepository
    });

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

  registerProtectedRoute(router, {
    method: 'GET',
    pattern: STUDENT_SELF_PROFILE_PATH,
    action: ACTIONS.STUDENT_READ_PROFILE,
    resolveResource: resolveOwnStudent,
    authOptions,
    handler: handleGetMeOrRejectNonStudent(handleGetOwnProfile)
  });

  for (const method of ['PATCH', 'PUT']) {
    registerProtectedRoute(router, {
      method,
      pattern: STUDENT_SELF_PROFILE_PATH,
      action: ACTIONS.STUDENT_UPDATE_SELF_PROFILE,
      resolveResource: resolveOwnStudent,
      authOptions,
      handler: handleUpdateOwnProfile
    });
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
  STUDENT_SELF_PROFILE_PATH,
  STUDENT_SELF_PROFILE_FIELDS,
  toStudentSelfProfile,
  validateAndNormalizeStudentProfileUpdate,
  registerStudentProfileRoutes
};
