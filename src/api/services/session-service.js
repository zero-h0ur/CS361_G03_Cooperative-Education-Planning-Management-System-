/**
 * Session Context Service for CO-ED V3.
 * Builds the sanitized /me bootstrap payload from trusted request identity (#61)
 * and centralized authorization capabilities/scopes (#62).
 *
 * Conforms to Issue #48, #49, #50, #51, #55, #61, #62, and #64.
 */

const {
  ROLES,
  AuthorizationService
} = require('./authorization-service');

class SessionService {
  /**
   * @param {object} [options]
   * @param {AuthorizationService} [options.authorizationService]
   * @param {object} [options.pool]
   * @param {Function} [options.now]
   */
  constructor(options = {}) {
    this.authorizationService =
      options.authorizationService || new AuthorizationService(options);
  }

  /**
   * Resolves the authenticated user's session context, linked profile identifier,
   * role capabilities, navigation flags, and active operational/advisor scopes.
   *
   * @param {object} authContext Trusted identity context from #61
   * @param {object} [options]
   * @returns {Promise<object>} Sanitized session bootstrap payload
   */
  async getSessionContext(authContext, options = {}) {
    const accessSummary = await this.authorizationService.resolveSessionAccessSummary(
      authContext,
      options
    );

    const isStudent = authContext.role === ROLES.STUDENT;
    const studentId = isStudent ? authContext.studentId || null : null;

    const user = Object.freeze({
      id: authContext.userId,
      role: authContext.role,
      accountStatus: authContext.accountStatus
    });

    const profile =
      isStudent && studentId
        ? Object.freeze({
            studentId,
            department: authContext.department ?? null,
            program: authContext.program ?? null,
            major: authContext.major ?? null,
            academicYear: authContext.academicYear ?? null,
            enrollmentStatus: authContext.enrollmentStatus ?? null
          })
        : null;

    const scope = Object.freeze({
      mode: accessSummary.capabilities.scopeMode,
      studentId,
      operationalScopes: accessSummary.operationalScopes,
      assignedStudents: accessSummary.assignedStudents,
      assignedStudentCount: accessSummary.assignedStudents.length
    });

    return Object.freeze({
      user,
      role: authContext.role,
      studentId,
      profile,
      capabilities: accessSummary.capabilities,
      scope
    });
  }
}

module.exports = {
  SessionService
};
