/**
 * Staff Review Repository for CO-ED V3.
 * Executes parameterized, scope-restricted read queries for Staff Student/Plan search
 * and the review queue. Scope is enforced inside SQL with the same predicate as
 * is_in_staff_scope (#53 section 3.2), so totals never include out-of-scope rows.
 * Does not contain HTTP status or role policy decisions.
 * Conforms to Issue #50, #53, #56, and #67.
 */

const { getPool } = require('../connection');
const { ServiceUnavailableError } = require('../../api/errors');

const UNAVAILABLE_DB_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', '42P01']);

const REVIEW_QUEUE_STATES = Object.freeze(['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION']);

// Allowlisted ORDER BY fragments; callers pass keys, never raw SQL.
const PLAN_SORT_COLUMNS = Object.freeze({
  submitted_at: "COALESCE((SELECT MAX(a.created_at) FROM audit_events a WHERE a.plan_id=p.id AND a.action='PLAN_SUBMITTED'), p.updated_at)",
  updated_at: 'p.updated_at',
  created_at: 'p.created_at',
  student_number: 's.student_number'
});

// Active Staff scopes of the caller; mirrors the user/role/status checks of is_in_staff_scope
const ACTIVE_STAFF_SCOPE_CTE = `
  WITH staff_scope AS (
    SELECT ss.department, ss.program, ss.academic_year
    FROM staff_scopes ss
    JOIN users u ON u.id = ss.staff_id
    WHERE ss.staff_id = $1
      AND ss.status = 'ACTIVE'
      AND u.role = 'STAFF'
      AND u.account_status = 'ACTIVE'
  )
`;

// Same scope predicate as is_in_staff_scope for a Plan (year compared with the Round, #53)
const PLAN_IN_STAFF_SCOPE_CONDITION = `EXISTS (
          SELECT 1 FROM staff_scope sc
          WHERE s.department = sc.department
            AND (sc.program IS NULL OR sc.program = s.program)
            AND (sc.academic_year IS NULL OR sc.academic_year = r.academic_year)
        )`;

const PLAN_FROM_CLAUSE = `FROM plans p
      JOIN students s ON s.id = p.student_id
      JOIN rounds r ON r.id = p.cycle_id
      LEFT JOIN companies c ON c.id = p.company_id
      LEFT JOIN positions po ON po.id = p.position_id`;

const PLAN_SELECT_COLUMNS = `p.id,
        p.status,
        p.version,
        p.created_at,
        p.updated_at,
        r.id AS cycle_id,
        r.name AS cycle_name,
        r.academic_year AS cycle_academic_year,
        r.semester AS cycle_semester,
        r.status AS cycle_status,
        c.id AS company_id,
        CASE WHEN c.visibility = 'public' THEN c.name END AS company_name,
        po.id AS position_id,
        CASE WHEN po.visibility = 'public' THEN po.title END AS position_title,
        s.id AS student_id,
        s.student_number,
        s.full_name,
        s.preferred_name,
        s.department,
        s.program,
        s.academic_year AS student_academic_year`;

function escapeLikePattern(value) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

class QueryBuilder {
  constructor(staffUserId) {
    this.params = [staffUserId];
    this.conditions = [];
  }

  bind(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  where(condition) {
    this.conditions.push(condition);
  }

  get whereClause() {
    return this.conditions.length > 0 ? `WHERE ${this.conditions.join('\n        AND ')}` : '';
  }
}

function addStudentKeywordFilter(builder, keyword) {
  if (!keyword) return;
  const pattern = builder.bind(escapeLikePattern(keyword));
  builder.where(`(
          s.student_number ILIKE ${pattern} ESCAPE '\\'
          OR s.full_name ILIKE ${pattern} ESCAPE '\\'
          OR s.preferred_name ILIKE ${pattern} ESCAPE '\\'
        )`);
}

function addAdvisorFilter(builder, advisorId) {
  if (!advisorId) return;
  const advisor = builder.bind(advisorId);
  builder.where(`EXISTS (
          SELECT 1
          FROM advisor_assignments aa
          WHERE aa.student_id = s.id
            AND aa.advisor_id = ${advisor}
            AND aa.status = 'ACTIVE'
            AND aa.effective_from <= CURRENT_TIMESTAMP
            AND aa.effective_to > CURRENT_TIMESTAMP
        )`);
}

class StaffReviewRepository {
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

  async paginate(builder, fromClause, selectColumns, orderBy, { page, pageSize }) {
    const countResult = await this.query(
      `${ACTIVE_STAFF_SCOPE_CTE}
      SELECT COUNT(*)::int AS total
      ${fromClause}
      ${builder.whereClause}`,
      [...builder.params]
    );

    const limit = builder.bind(pageSize);
    const offset = builder.bind((page - 1) * pageSize);
    const rowsResult = await this.query(
      `${ACTIVE_STAFF_SCOPE_CTE}
      SELECT ${selectColumns}
      ${fromClause}
      ${builder.whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
      [...builder.params]
    );

    return {
      rows: rowsResult?.rows || [],
      total: Number(countResult?.rows?.[0]?.total || 0)
    };
  }

  /**
   * Searches linked Students inside the caller's Staff scope.
   * Year scope compares students.academic_year (#53: no Plan context).
   */
  async searchStudents({ staffUserId, academicYear = null, keyword = null, advisorId = null, page, pageSize }) {
    const builder = new QueryBuilder(staffUserId);
    builder.where('s.user_id IS NOT NULL');
    builder.where(`EXISTS (
          SELECT 1 FROM staff_scope sc
          WHERE s.department = sc.department
            AND (sc.program IS NULL OR sc.program = s.program)
            AND (sc.academic_year IS NULL OR sc.academic_year = s.academic_year)
        )`);
    if (academicYear !== null) {
      builder.where(`s.academic_year = ${builder.bind(academicYear)}`);
    }
    addStudentKeywordFilter(builder, keyword);
    addAdvisorFilter(builder, advisorId);

    return this.paginate(
      builder,
      'FROM students s',
      `s.id,
        s.student_number,
        s.full_name,
        s.preferred_name,
        s.department,
        s.program,
        s.major,
        s.academic_year,
        s.enrollment_status`,
      's.student_number ASC, s.id ASC',
      { page, pageSize }
    );
  }

  /**
   * Searches V3 Plans inside the caller's Staff scope.
   * Year scope compares the Plan round's academic_year (#53: Plan context).
   * With reviewQueue=true, only pending states in OPEN rounds are returned (#53 section 3.3).
   */
  async searchPlans({
    staffUserId,
    reviewQueue = false,
    academicYear = null,
    roundId = null,
    status = null,
    companyId = null,
    advisorId = null,
    keyword = null,
    sort = 'updated_at',
    order = 'desc',
    page,
    pageSize
  }) {
    const builder = new QueryBuilder(staffUserId);
    builder.where('p.legacy_compatibility = FALSE');
    builder.where('s.user_id IS NOT NULL');
    builder.where(PLAN_IN_STAFF_SCOPE_CONDITION);

    if (reviewQueue) {
      builder.where(`r.status = 'OPEN'`);
      builder.where(`p.status = ANY(${builder.bind(REVIEW_QUEUE_STATES)}::text[])`);
    }
    if (academicYear !== null) builder.where(`r.academic_year = ${builder.bind(academicYear)}`);
    if (roundId) builder.where(`p.cycle_id = ${builder.bind(roundId)}`);
    if (status) builder.where(`p.status = ${builder.bind(status)}`);
    if (companyId) builder.where(`p.company_id = ${builder.bind(companyId)}`);
    addAdvisorFilter(builder, advisorId);
    addStudentKeywordFilter(builder, keyword);

    const sortColumn = PLAN_SORT_COLUMNS[sort] || PLAN_SORT_COLUMNS.updated_at;
    const direction = order === 'asc' ? 'ASC' : 'DESC';

    return this.paginate(
      builder,
      PLAN_FROM_CLAUSE,
      PLAN_SELECT_COLUMNS,
      `${sortColumn} ${direction}, p.id ${direction}`,
      { page, pageSize }
    );
  }

  /**
   * One Plan inside the caller's Staff scope, including the Student's Plan notes (#50:
   * scoped Staff may read Plan content). The policy has already checked scope; the SQL
   * predicate is repeated so this query can never return an out-of-scope row by itself.
   */
  async findScopedPlan({ staffUserId, planId }) {
    const result = await this.query(
      `${ACTIVE_STAFF_SCOPE_CTE}
      SELECT ${PLAN_SELECT_COLUMNS},
        p.notes
      ${PLAN_FROM_CLAUSE}
      WHERE p.id = $2
        AND p.legacy_compatibility = FALSE
        AND s.user_id IS NOT NULL
        AND ${PLAN_IN_STAFF_SCOPE_CONDITION}`,
      [staffUserId, planId]
    );
    return result?.rows?.[0] || null;
  }
}

module.exports = {
  StaffReviewRepository,
  REVIEW_QUEUE_STATES,
  PLAN_SORT_COLUMNS
};
