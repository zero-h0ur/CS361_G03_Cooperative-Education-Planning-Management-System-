/**
 * Advisor Assigned-Scope Read Repository for CO-ED V3.
 *
 * Every query independently re-checks the trusted Advisor user, active account,
 * and effective assignment at the request timestamp. This is intentional
 * defense in depth: authorization middleware is required, but database reads
 * must remain scoped even if the repository is called directly.
 *
 * This repository exposes SELECT operations only. It must not grow mutation
 * methods or reuse Student/Staff mutation repositories.
 * Conforms to Issue #53, #62, and #68.
 */

const { getPool } = require('../connection');
const { ServiceUnavailableError } = require('../../api/errors');

const UNAVAILABLE_DB_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  '42P01'
]);

const ACTIVE_ASSIGNMENT_PREDICATE = `
  EXISTS (
    SELECT 1
    FROM advisor_assignments aa
    JOIN users advisor_user ON advisor_user.id = aa.advisor_id
    WHERE aa.advisor_id = $1
      AND aa.student_id = scoped_student.id
      AND aa.status = 'ACTIVE'
      AND aa.revoked_at IS NULL
      AND aa.effective_from <= $2::timestamptz
      AND aa.effective_to > $2::timestamptz
      AND advisor_user.role = 'ADVISOR'
      AND advisor_user.account_status = 'ACTIVE'
  )
`;

class AdvisorReadRepository {
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
      if (UNAVAILABLE_DB_ERROR_CODES.has(err?.code)) {
        throw new ServiceUnavailableError();
      }
      throw err;
    }
  }

  async listAssignedStudents({ advisorUserId, timestampIso, limit, offset }) {
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM students scoped_student
      WHERE ${ACTIVE_ASSIGNMENT_PREDICATE}
    `;

    const pageQuery = `
      SELECT
        scoped_student.id,
        scoped_student.student_number,
        scoped_student.full_name,
        scoped_student.preferred_name,
        scoped_student.department,
        scoped_student.program,
        scoped_student.major,
        scoped_student.academic_year,
        scoped_student.enrollment_status
      FROM students scoped_student
      WHERE ${ACTIVE_ASSIGNMENT_PREDICATE}
      ORDER BY scoped_student.full_name ASC NULLS LAST, scoped_student.id ASC
      LIMIT $3::int OFFSET $4::int
    `;

    const [countResult, pageResult] = await Promise.all([
      this.query(countQuery, [advisorUserId, timestampIso]),
      this.query(pageQuery, [advisorUserId, timestampIso, limit, offset])
    ]);

    return {
      rows: pageResult?.rows || [],
      total: Number(countResult?.rows?.[0]?.total || 0)
    };
  }

  async findAssignedStudent({ advisorUserId, studentId, timestampIso }) {
    const query = `
      SELECT
        scoped_student.id,
        scoped_student.student_number,
        scoped_student.full_name,
        scoped_student.preferred_name,
        scoped_student.department,
        scoped_student.program,
        scoped_student.major,
        scoped_student.academic_year,
        scoped_student.enrollment_status
      FROM students scoped_student
      WHERE scoped_student.id = $3::uuid
        AND ${ACTIVE_ASSIGNMENT_PREDICATE}
      LIMIT 1
    `;

    const result = await this.query(query, [advisorUserId, timestampIso, studentId]);
    return result?.rows?.[0] || null;
  }

  async listAssignedStudentPlans({
    advisorUserId,
    studentId,
    timestampIso,
    cycleId = null,
    status = null,
    limit,
    offset
  }) {
    const planFrom = `
      FROM plans scoped_plan
      JOIN students scoped_student ON scoped_student.id = scoped_plan.student_id
    `;
    const planPredicates = `
      WHERE scoped_student.id = $3::uuid
        AND ${ACTIVE_ASSIGNMENT_PREDICATE}
        AND ($4::uuid IS NULL OR COALESCE(scoped_plan.cycle_id, scoped_plan.round_id) = $4::uuid)
        AND ($5::text IS NULL OR scoped_plan.status = $5::text)
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      ${planFrom}
      ${planPredicates}
    `;

    const pageQuery = `
      SELECT
        scoped_plan.id,
        COALESCE(scoped_plan.cycle_id, scoped_plan.round_id) AS cycle_id,
        scoped_plan.status,
        scoped_plan.updated_at,
        company.id AS company_id,
        company.name AS company_name,
        position.id AS position_id,
        position.title AS position_title
      ${planFrom}
      LEFT JOIN companies company
        ON company.id = scoped_plan.company_id
       AND company.visibility = 'public'
      LEFT JOIN positions position
        ON position.id = scoped_plan.position_id
       AND position.company_id = company.id
       AND position.visibility = 'public'
      ${planPredicates}
      ORDER BY scoped_plan.updated_at DESC, scoped_plan.id ASC
      LIMIT $6::int OFFSET $7::int
    `;

    const params = [
      advisorUserId,
      timestampIso,
      studentId,
      cycleId,
      status
    ];
    const [countResult, pageResult] = await Promise.all([
      this.query(countQuery, params),
      this.query(pageQuery, [...params, limit, offset])
    ]);

    return {
      rows: pageResult?.rows || [],
      total: Number(countResult?.rows?.[0]?.total || 0)
    };
  }

  async findAssignedPlan({ advisorUserId, planId, timestampIso }) {
    const query = `
      SELECT
        scoped_plan.id,
        COALESCE(scoped_plan.cycle_id, scoped_plan.round_id) AS cycle_id,
        scoped_plan.status,
        scoped_plan.notes,
        scoped_plan.version,
        scoped_plan.created_at,
        scoped_plan.updated_at,
        company.id AS company_id,
        company.name AS company_name,
        position.id AS position_id,
        position.title AS position_title
      FROM plans scoped_plan
      JOIN students scoped_student ON scoped_student.id = scoped_plan.student_id
      LEFT JOIN companies company
        ON company.id = scoped_plan.company_id
       AND company.visibility = 'public'
      LEFT JOIN positions position
        ON position.id = scoped_plan.position_id
       AND position.company_id = company.id
       AND position.visibility = 'public'
      WHERE scoped_plan.id = $3::uuid
        AND ${ACTIVE_ASSIGNMENT_PREDICATE}
      LIMIT 1
    `;

    const result = await this.query(query, [advisorUserId, timestampIso, planId]);
    return result?.rows?.[0] || null;
  }
}

module.exports = {
  AdvisorReadRepository
};
