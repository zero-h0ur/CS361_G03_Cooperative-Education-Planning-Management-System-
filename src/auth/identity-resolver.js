/**
 * Identity Resolver for CO-ED V3.
 * Maps validated external Cognito identity to internal User, Role, and Student context.
 * Conforms to Issue #48, #49, #50, #51, #56, and #61.
 */

const { ForbiddenError } = require('../api/errors');
const { getPool } = require('../db/connection');

const ALLOWED_ROLES = new Set(['STUDENT', 'ADVISOR', 'STAFF', 'ADMIN', 'SYSTEM']);

function createForbidden(message, reason) {
  const err = new ForbiddenError(message, reason || 'FORBIDDEN');
  Object.defineProperty(err, 'reason', {
    value: reason || 'FORBIDDEN',
    enumerable: false,
    writable: false
  });
  return err;
}

function isNonEmptyExactString(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function hasCompleteStudentProfile(record) {
  // If database row only mocks student_id without optional profile columns in minimal unit mocks,
  // verify any provided official fields are non-empty; if student_number or full_name is explicitly null, reject.
  const requiredTextFields = [
    'student_number',
    'full_name',
    'institutional_email',
    'department',
    'program',
    'major',
    'enrollment_status'
  ];

  for (const field of requiredTextFields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      if (!isNonEmptyExactString(record[field])) {
        return false;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(record, 'academic_year')) {
    if (!Number.isInteger(record.academic_year) || record.academic_year <= 0) {
      return false;
    }
  }

  return true;
}

class IdentityResolver {
  /**
   * @param {object} [options]
   * @param {object} [options.pool] Optional database connection pool override
   */
  constructor(options = {}) {
    this.pool = options.pool || null;
  }

  getDbPool() {
    return this.pool || getPool();
  }

  /**
   * Resolves internal User and Role from external issuer and subject.
   * Performs exact comparison on (external_issuer, external_subject) per Issue #51.
   *
   * @param {string} issuer
   * @param {string} subject
   * @returns {Promise<object>} Resolved trusted user context
   */
  async resolveIdentity(issuer, subject) {
    if (!isNonEmptyExactString(issuer) || !isNonEmptyExactString(subject)) {
      throw createForbidden(
        'External issuer and subject must be exact non-empty strings.',
        'INVALID_IDENTITY_KEY'
      );
    }

    const pool = this.getDbPool();
    const query = `
      SELECT
        u.id AS user_id,
        u.role,
        u.account_status,
        eil.id AS identity_link_id,
        eil.status AS link_status,
        (
          SELECT COUNT(*)::int
          FROM external_identity_links active_eil
          WHERE active_eil.user_id = u.id
            AND active_eil.status = 'ACTIVE'
        ) AS active_link_count,
        s.id AS student_id,
        s.student_number,
        s.full_name,
        s.preferred_name,
        s.institutional_email,
        s.department,
        s.program,
        s.major,
        s.academic_year,
        s.enrollment_status
      FROM external_identity_links eil
      JOIN users u ON u.id = eil.user_id
      LEFT JOIN students s ON s.user_id = u.id
      WHERE eil.external_issuer = $1
        AND eil.external_subject = $2
    `;

    const res = await pool.query(query, [issuer, subject]);

    // 1. Identity not linked
    if (!res?.rows || res.rows.length === 0) {
      throw createForbidden(
        'Identity is not linked to an application account.',
        'UNLINKED_IDENTITY'
      );
    }

    // 2. Guard against unexpected duplicate links
    if (res.rows.length > 1) {
      throw createForbidden(
        'Duplicate identity links found.',
        'DUPLICATE_IDENTITY'
      );
    }

    const record = res.rows[0];

    // 3. Link revoked
    if (record.link_status !== 'ACTIVE') {
      throw createForbidden(
        'Identity link has been revoked.',
        'REVOKED_IDENTITY'
      );
    }

    // 4. Multiple active links on the same internal user
    if (
      record.active_link_count !== undefined &&
      record.active_link_count !== null &&
      Number(record.active_link_count) !== 1
    ) {
      throw createForbidden(
        'Duplicate active identity links found for user.',
        'DUPLICATE_IDENTITY'
      );
    }

    // 5. User account disabled
    if (record.account_status !== 'ACTIVE') {
      throw createForbidden(
        'Application account is disabled.',
        'ACCOUNT_DISABLED'
      );
    }

    // 6. Role validity check
    if (!ALLOWED_ROLES.has(record.role)) {
      throw createForbidden(
        'User role is not recognized.',
        'INVALID_ROLE'
      );
    }

    // 7. Student role completeness and ownership link check per Issue #51
    if (record.role === 'STUDENT') {
      if (!record.student_id || !hasCompleteStudentProfile(record)) {
        throw createForbidden(
          'Student account provisioning is incomplete.',
          'INCOMPLETE_PROVISIONING'
        );
      }
    } else if (record.student_id) {
      throw createForbidden(
        'Non-student user cannot be linked to a student profile.',
        'ROLE_MISMATCH'
      );
    }

    return {
      userId: record.user_id,
      role: record.role,
      accountStatus: record.account_status,
      identityLinkId: record.identity_link_id || null,
      studentId: record.student_id || null,
      department: record.department || null,
      program: record.program || null,
      major: record.major || null,
      academicYear: record.academic_year || null,
      enrollmentStatus: record.enrollment_status || null
    };
  }
}

module.exports = {
  IdentityResolver
};
