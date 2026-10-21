/**
 * Student Self-Profile Service for CO-ED V3.
 * Enforces Student ownership via centralized authorization (#62),
 * explicit read allowlist (#50, #51), and strict preferred_name update allowlist (#51, #65).
 */

const {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} = require('../errors');
const {
  ROLES,
  ACTIONS,
  AuthorizationService
} = require('./authorization-service');
const {
  StudentProfileRepository
} = require('../../db/repositories/student-profile-repository');

const MAX_PREFERRED_NAME_LENGTH = 100;
const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;

/**
 * Explicit allowlist of Student profile fields permitted in self-profile read responses (#50 & #51).
 * Excludes internal/legacy columns such as user_id, anonymous_ref, year_level,
 * source, data_source, visibility, data_status, and private_note.
 */
const STUDENT_SELF_PROFILE_FIELDS = Object.freeze([
  'id',
  'student_number',
  'full_name',
  'preferred_name',
  'contact_address',
  'contact_phone',
  'institutional_email',
  'department',
  'program',
  'major',
  'academic_year',
  'enrollment_status',
  'created_at',
  'updated_at',
  'version'
]);

/**
 * Internal/legacy columns that must always be masked from Student self-profile responses (#50 & #51).
 */
const STUDENT_SELF_MASKED_FIELDS = Object.freeze([
  'user_id',
  'anonymous_ref',
  'year_level',
  'source',
  'data_source',
  'visibility',
  'data_status',
  'private_note',
  'external_issuer',
  'external_subject'
]);

/**
 * Explicit allowlist of fields editable by the Student (#51 & #65).
 */
const STUDENT_SELF_EDITABLE_FIELDS = Object.freeze(['contact_address','contact_phone']);

/**
 * Explicit allowlist of fields accepted in Student self-profile update payloads (#51 & #65).
 * Only preferred_name is student-editable; version is optionally accepted for optimistic concurrency.
 */
const ALLOWED_UPDATE_PAYLOAD_FIELDS = new Set(['preferred_name', 'version']);

const IMMUTABLE_OR_OFFICIAL_FIELDS = new Set([
  'id',
  'user_id',
  'student_id',
  'studentId',
  'student_number',
  'full_name',
  'institutional_email',
  'department',
  'program',
  'major',
  'academic_year',
  'enrollment_status',
  'data_source',
  'data_status',
  'source',
  'visibility',
  'anonymous_ref',
  'year_level',
  'created_at',
  'updated_at',
  'role',
  'account_status'
]);

/**
 * Serializes a database student row using the explicit self-profile allowlist.
 *
 * @param {object} row
 * @returns {object}
 */
function toStudentSelfProfile(row = {}) {
  const serialized = {};
  for (const field of STUDENT_SELF_PROFILE_FIELDS) {
    const val = row[field];
    serialized[field] = val instanceof Date ? val.toISOString() : val !== undefined ? val : null;
  }
  return Object.freeze(serialized);
}

/**
 * Validates and normalizes a Student self-profile update payload (#51 & #65).
 * Rejects the entire request if any immutable, staff-owned, or unknown field is present.
 * Trims preferred_name and normalizes empty strings to null.
 *
 * @param {object} payload
 * @returns {{ preferredName: string|null, expectedVersion: number|null }}
 */
function validateAndNormalizeStudentProfileUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Update payload must be a JSON object.', [
      { field: 'body', issue: 'must be a JSON object' }
    ]);
  }

  const keys = Object.keys(payload);
  const details = [];

  for (const key of keys) {
    if (!ALLOWED_UPDATE_PAYLOAD_FIELDS.has(key)) {
      const reason = IMMUTABLE_OR_OFFICIAL_FIELDS.has(key)
        ? 'field is official or immutable and cannot be modified by student'
        : 'field is not allowed in student profile update';
      details.push({ field: key, issue: reason });
    }
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'preferred_name')) {
    details.push({
      field: 'preferred_name',
      issue: 'preferred_name is required in profile update payload'
    });
  }

  let normalizedPreferredName = null;
  if (Object.prototype.hasOwnProperty.call(payload, 'preferred_name')) {
    const rawValue = payload.preferred_name;
    if (rawValue !== null && typeof rawValue !== 'string') {
      details.push({
        field: 'preferred_name',
        issue: 'preferred_name must be a string or null'
      });
    } else if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (CONTROL_CHAR_REGEX.test(trimmed)) {
        details.push({
          field: 'preferred_name',
          issue: 'preferred_name must not contain control characters'
        });
      } else if (trimmed.length > MAX_PREFERRED_NAME_LENGTH) {
        details.push({
          field: 'preferred_name',
          issue: `preferred_name must not exceed ${MAX_PREFERRED_NAME_LENGTH} characters`
        });
      } else {
        normalizedPreferredName = trimmed.length === 0 ? null : trimmed;
      }
    }
  }

  let expectedVersion = null;
  if (Object.prototype.hasOwnProperty.call(payload, 'version') && payload.version !== undefined) {
    if (!Number.isInteger(payload.version) || payload.version < 1) {
      details.push({
        field: 'version',
        issue: 'version must be a positive integer'
      });
    } else {
      expectedVersion = payload.version;
    }
  }

  if (details.length > 0) {
    throw new ValidationError(
      'Invalid student profile update payload.',
      details,
      'VALIDATION_ERROR'
    );
  }

  return {
    preferredName: normalizedPreferredName,
    expectedVersion
  };
}

class StudentProfileService {
  /**
   * @param {object} [options]
   * @param {object} [options.pool]
   * @param {StudentProfileRepository} [options.repository]
   * @param {StudentProfileRepository} [options.studentProfileRepository]
   * @param {AuthorizationService} [options.authorizationService]
   */
  constructor(options = {}) {
    this.pool = options.pool || null;
    this.contactService = options.threeRoleService || null;
    this.repository =
      options.studentProfileRepository ||
      options.repository ||
      new StudentProfileRepository({ pool: this.pool });
    this.authorizationService =
      options.authorizationService || new AuthorizationService(options);
  }

  /**
   * Reads the authenticated Student's own profile.
   *
   * @param {object} authContext Trusted identity context from #61
   * @param {object} [options]
   * @param {string} [options.targetStudentId] Optional target studentId (used to reject cross-user attempts)
   * @returns {Promise<object>}
   */
  async getOwnProfile(authContext, options = {}) {
    if (authContext?.isAuthenticated && authContext.role !== ROLES.STUDENT) {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    const requestedStudentId = options.targetStudentId || authContext?.studentId;
    await this.authorizationService.authorize(
      authContext,
      ACTIONS.STUDENT_READ_PROFILE,
      { studentId: requestedStudentId }
    );

    const row = await this.repository.findOwnStudentProfile({
      studentId: authContext.studentId,
      userId: authContext.userId
    });

    if (!row) {
      throw new NotFoundError('Student profile not found.', 'RECORD_NOT_FOUND');
    }

    if (row.id !== authContext.studentId || (row.user_id && row.user_id !== authContext.userId)) {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    return toStudentSelfProfile(row);
  }

  /**
   * Updates the authenticated Student's own preferred_name.
   *
   * @param {object} authContext Trusted identity context from #61
   * @param {object} payload Request body
   * @param {object} [options]
   * @param {string} [options.targetStudentId] Optional target studentId (used to reject cross-user attempts)
   * @returns {Promise<object>}
   */
  async updateOwnProfile(authContext, payload, options = {}) {
    if (authContext?.isAuthenticated && authContext.role !== ROLES.STUDENT) {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }

    const requestedStudentId = options.targetStudentId || authContext?.studentId;
    await this.authorizationService.authorize(
      authContext,
      ACTIONS.STUDENT_UPDATE_SELF_PROFILE,
      { studentId: requestedStudentId }
    );

    // Keep historical preferred_name readable, but no unversioned/unaudited legacy
    // write path. The contact command enforces its allowlist before opening a DB client.
    return (this.contactService || new (require('./three-role-service').ThreeRoleService)({pool:this.pool})).saveContact(authContext,payload);
  }
}

module.exports = {
  STUDENT_SELF_PROFILE_FIELDS,
  STUDENT_SELF_MASKED_FIELDS,
  STUDENT_SELF_EDITABLE_FIELDS,
  ALLOWED_UPDATE_PAYLOAD_FIELDS,
  MAX_PREFERRED_NAME_LENGTH,
  toStudentSelfProfile,
  validateAndNormalizeStudentProfileUpdate,
  StudentProfileService
};
