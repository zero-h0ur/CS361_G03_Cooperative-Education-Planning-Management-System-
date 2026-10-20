/**
 * Student Profile Repository for CO-ED V3.
 * Executes parameterized SQL queries scoped to the resolved Student owner.
 * Does not contain HTTP status or role policy decisions.
 * Conforms to Issue #51, #55, #56, and #65.
 */

const { getPool } = require('../connection');
const { ServiceUnavailableError } = require('../../api/errors');

const UNAVAILABLE_DB_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', '42P01']);

class StudentProfileRepository {
  /**
   * @param {object} [options]
   * @param {object} [options.pool] Database connection pool override
   */
  constructor(options = {}) {
    this.pool = options.pool || null;
  }

  getDbPool() {
    return this.pool || getPool();
  }

  async query(text, params) {
    try {
      return await this.getDbPool().query(text, params);
    } catch (err) {
      // Match DAL behavior: connection/schema failures are 503, anything else is a sanitized 500
      if (UNAVAILABLE_DB_ERROR_CODES.has(err?.code)) {
        throw new ServiceUnavailableError();
      }
      throw err;
    }
  }

  /**
   * Loads the Student profile row owned by the given (studentId, userId).
   *
   * @param {object} params
   * @param {string} params.studentId
   * @param {string} params.userId
   * @returns {Promise<object|null>}
   */
  async findOwnStudentProfile({ studentId, userId }) {
    const query = `
      SELECT
        s.id,
        s.user_id,
        s.student_number,
        s.full_name,
        s.preferred_name,
        s.contact_address,
        s.contact_phone,
        s.institutional_email,
        s.department,
        s.program,
        s.major,
        s.academic_year,
        s.enrollment_status,
        s.created_at,
        s.updated_at,
        s.version
      FROM students s
      WHERE s.id = $1
        AND s.user_id = $2
      LIMIT 1
    `;

    const result = await this.query(query, [studentId, userId]);
    return result?.rows?.[0] || null;
  }

  /**
   * Updates only preferred_name (and increments version) for the owned Student profile.
   *
   * @param {object} params
   * @param {string} params.studentId
   * @param {string} params.userId
   * @param {string|null} params.preferredName
   * @param {number|null} [params.expectedVersion]
   * @returns {Promise<object|null>}
   */
  async updateOwnPreferredName({
    studentId,
    userId,
    preferredName,
    expectedVersion = null
  }) {
    const query = `
      UPDATE students AS s
      SET
        preferred_name = $3,
        version = s.version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE s.id = $1
        AND s.user_id = $2
        AND ($4::int IS NULL OR s.version = $4::int)
      RETURNING
        s.id,
        s.user_id,
        s.student_number,
        s.full_name,
        s.preferred_name,
        s.institutional_email,
        s.department,
        s.program,
        s.major,
        s.academic_year,
        s.enrollment_status,
        s.created_at,
        s.updated_at,
        s.version
    `;

    const result = await this.query(query, [
      studentId,
      userId,
      preferredName,
      expectedVersion
    ]);

    return result?.rows?.[0] || null;
  }
}

module.exports = {
  StudentProfileRepository
};
