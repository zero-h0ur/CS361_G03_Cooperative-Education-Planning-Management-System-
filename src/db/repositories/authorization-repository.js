/**
 * Authorization Repository for CO-ED V3.
 * Executes parameterized SQL queries for Advisor Assignments, Staff Scopes, and Plan ownership.
 * Does not contain HTTP status or role policy decisions.
 * Conforms to Issue #53, #55, #56, and #62.
 */

const { getPool } = require('../connection');

class AuthorizationRepository {
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

  async findActiveAdvisorAssignment({
    advisorUserId,
    studentId,
    academicYear = null,
    semester = null,
    timestampIso
  }) {
    const pool = this.getDbPool();
    const query = `
      SELECT
        aa.id,
        aa.advisor_id,
        aa.student_id,
        aa.academic_year,
        aa.semester,
        aa.status,
        aa.revoked_at,
        aa.effective_from,
        aa.effective_to,
        u.role AS user_role,
        u.account_status AS user_account_status
      FROM advisor_assignments aa
      JOIN users u ON aa.advisor_id = u.id
      WHERE aa.advisor_id = $1
        AND aa.student_id = $2
        AND ($3::int IS NULL OR aa.academic_year = $3::int)
        AND ($4::int IS NULL OR aa.semester = $4::int)
        AND aa.status = 'ACTIVE'
        AND aa.revoked_at IS NULL
        AND aa.effective_from <= $5::timestamptz
        AND aa.effective_to > $5::timestamptz
        AND u.account_status = 'ACTIVE'
        AND u.role = 'ADVISOR'
      LIMIT 1
    `;

    const result = await pool.query(query, [
      advisorUserId,
      studentId,
      academicYear,
      semester,
      timestampIso
    ]);

    return result?.rows?.[0] || null;
  }

  async findStaffScopeMatch({
    staffUserId,
    studentId,
    planId = null,
    isReviewAction = false
  }) {
    const pool = this.getDbPool();
    const query = `
      SELECT
        ss.id AS scope_id,
        ss.department AS scope_department,
        ss.program AS scope_program,
        ss.academic_year AS scope_academic_year,
        ss.status AS scope_status,
        u.role AS user_role,
        u.account_status AS user_account_status,
        s.id AS student_id,
        s.department AS student_department,
        s.program AS student_program,
        s.academic_year AS student_academic_year,
        p.id AS plan_id,
        p.student_id AS plan_student_id,
        r.academic_year AS round_academic_year,
        r.status AS round_status
      FROM users u
      JOIN staff_scopes ss ON ss.staff_id = u.id
      JOIN students s ON s.id = $2
      LEFT JOIN plans p ON ($3::uuid IS NOT NULL AND p.id = $3::uuid AND p.student_id = s.id)
      LEFT JOIN rounds r ON r.id = COALESCE(p.cycle_id, p.round_id)
      WHERE u.id = $1
        AND u.role = 'STAFF'
        AND u.account_status = 'ACTIVE'
        AND ss.status = 'ACTIVE'
        AND s.department = ss.department
        AND (ss.program IS NULL OR ss.program = s.program)
        AND ($3::uuid IS NULL OR p.id IS NOT NULL)
        AND (
          ss.academic_year IS NULL
          OR ($3::uuid IS NOT NULL AND r.academic_year = ss.academic_year)
          OR ($3::uuid IS NULL AND s.academic_year = ss.academic_year)
        )
        AND (
          $4::boolean = FALSE
          OR ($3::uuid IS NOT NULL AND r.status = 'OPEN')
        )
      LIMIT 1
    `;

    const result = await pool.query(query, [
      staffUserId,
      studentId,
      planId,
      Boolean(isReviewAction)
    ]);

    return result?.rows?.[0] || null;
  }

  async listActiveStaffScopes(staffUserId) {
    const pool = this.getDbPool();
    const query = `
      SELECT
        ss.id,
        ss.department,
        ss.program,
        ss.academic_year AS "academicYear"
      FROM staff_scopes ss
      JOIN users u ON u.id = ss.staff_id
      WHERE ss.staff_id = $1
        AND ss.status = 'ACTIVE'
        AND u.role = 'STAFF'
        AND u.account_status = 'ACTIVE'
      ORDER BY ss.department ASC, ss.program ASC NULLS FIRST, ss.academic_year ASC NULLS FIRST
    `;

    const result = await pool.query(query, [staffUserId]);
    return result?.rows || [];
  }

  async listActiveAdvisorAssignments(advisorUserId, timestampIso) {
    const pool = this.getDbPool();
    const query = `
      SELECT
        aa.id,
        aa.student_id AS "studentId",
        aa.academic_year AS "academicYear",
        aa.semester,
        aa.effective_from AS "effectiveFrom",
        aa.effective_to AS "effectiveTo"
      FROM advisor_assignments aa
      JOIN users u ON u.id = aa.advisor_id
      WHERE aa.advisor_id = $1
        AND aa.status = 'ACTIVE'
        AND aa.revoked_at IS NULL
        AND aa.effective_from <= $2::timestamptz
        AND aa.effective_to > $2::timestamptz
        AND u.role = 'ADVISOR'
        AND u.account_status = 'ACTIVE'
      ORDER BY aa.academic_year DESC, aa.semester DESC, aa.student_id ASC
    `;

    const result = await pool.query(query, [advisorUserId, timestampIso]);
    return result?.rows || [];
  }

  async findPlanById(planId) {
    const pool = this.getDbPool();
    const query = `
      SELECT
        p.id AS plan_id,
        p.student_id,
        p.status AS plan_status,
        p.version AS plan_version,
        COALESCE(p.cycle_id, p.round_id) AS cycle_id,
        r.academic_year AS round_academic_year,
        r.semester AS round_semester,
        r.status AS round_status
      FROM plans p
      LEFT JOIN rounds r ON r.id = COALESCE(p.cycle_id, p.round_id)
      WHERE p.id = $1
      LIMIT 1
    `;

    const result = await pool.query(query, [planId]);
    return result?.rows?.[0] || null;
  }
}

module.exports = {
  AuthorizationRepository
};
