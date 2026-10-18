/**
 * Student Profile Repository for CO-ED V3.
 * Executes parameterized SQL queries scoped to the resolved Student owner.
 * Does not contain HTTP status or role policy decisions.
 * Conforms to Issue #51, #55, #56, and #65.
 */

const { getPool } = require('../connection');

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

  /**
   * Loads the Student profile row owned by the given (studentId, userId).
   *
   * @param {object} params
   * @param {string} params.studentId
   * @param {string} params.userId
   * @returns {Promise<object|null>}
   */
  async findOwnStudentProfile({ studentId, userId }) {
    const pool = this.getDbPool();
    const query = `
      SELECT
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
      FROM students s
      WHERE s.id = $1
        AND s.user_id = $2
      LIMIT 1
    `;

    const result = await pool.query(query, [studentId, userId]);
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
    const pool = this.getDbPool();
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

    const result = await pool.query(query, [
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
