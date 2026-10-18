/**
 * Own Plan repository for CO-ED V3.
 * All writes are parameterized and transaction-aware. Policy decisions belong
 * to StudentPlanService; this repository only reads and persists data.
 */

const { WorkflowRepository } = require('./workflow-repository');

const PLAN_COLUMNS = `
  p.id,
  p.cycle_id,
  p.company_id,
  p.position_id,
  p.notes,
  p.status,
  p.version,
  p.created_at,
  p.updated_at
`;

class StudentPlanRepository extends WorkflowRepository {
  async listCycleOptions({ userId, studentId }) {
    const result = await this.query(`
      SELECT r.id, r.name, r.academic_year, r.semester, r.status
      FROM rounds r
      WHERE r.visibility = 'public'
        AND EXISTS (
          SELECT 1 FROM students s
          JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND u.id = $2
            AND u.role = 'STUDENT' AND u.account_status = 'ACTIVE'
        )
      ORDER BY r.academic_year DESC, r.semester DESC NULLS LAST, r.name ASC, r.id ASC
    `, [studentId, userId]);
    return result.rows || [];
  }

  async findActiveStudentLink(client, { userId, studentId }) {
    const result = await this.query(`
      SELECT s.id, s.user_id, u.role, u.account_status
      FROM students s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.user_id = $2
        AND u.role = 'STUDENT'
        AND u.account_status = 'ACTIVE'
      LIMIT 1
    `, [studentId, userId], client);
    return result?.rows?.[0] || null;
  }

  async findCycle(client, cycleId) {
    const result = await this.query(`
      SELECT id, status
      FROM rounds
      WHERE id = $1
      LIMIT 1
    `, [cycleId], client);
    return result?.rows?.[0] || null;
  }

  async findPublicCompany(client, companyId) {
    if (companyId === null) return null;
    const result = await this.query(`
      SELECT id
      FROM companies
      WHERE id = $1 AND visibility = 'public'
      LIMIT 1
    `, [companyId], client);
    return result?.rows?.[0] || null;
  }

  async findPublicPosition(client, positionId) {
    if (positionId === null) return null;
    const result = await this.query(`
      SELECT id, company_id
      FROM positions
      WHERE id = $1 AND visibility = 'public'
      LIMIT 1
    `, [positionId], client);
    return result?.rows?.[0] || null;
  }

  async insertPlan(client, {
    planId,
    studentId,
    cycleId,
    companyId,
    positionId,
    notes
  }) {
    const result = await this.query(`
      INSERT INTO plans (
        id, student_id, cycle_id, round_id, company_id, position_id, notes,
        status, version, source, visibility, data_status, legacy_compatibility,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, NULL, $4, $5, $6,
        'DRAFT', 1, 'v3-student-api', 'private', 'mock', FALSE,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING
        id, cycle_id, company_id, position_id, notes, status, version,
        created_at, updated_at
    `, [planId, studentId, cycleId, companyId, positionId, notes], client);
    return result?.rows?.[0] || null;
  }

  async findOwnPlanById(studentId, planId, client = null) {
    const result = await this.query(`
      SELECT ${PLAN_COLUMNS}
      FROM plans p
      WHERE p.id = $1 AND p.student_id = $2
      LIMIT 1
    `, [planId, studentId], client);
    return result?.rows?.[0] || null;
  }

  async listOwnPlans({ studentId, cycleId = null, status = null, page, pageSize }) {
    const offset = (page - 1) * pageSize;
    const params = [studentId, cycleId, status, pageSize, offset];
    const [itemsResult, countResult] = await Promise.all([
      this.query(`
        SELECT ${PLAN_COLUMNS}
        FROM plans p
        WHERE p.student_id = $1
          AND ($2::uuid IS NULL OR p.cycle_id = $2::uuid)
          AND ($3::text IS NULL OR p.status = $3::text)
        ORDER BY p.updated_at DESC, p.id ASC
        LIMIT $4 OFFSET $5
      `, params),
      this.query(`
        SELECT COUNT(*)::int AS total
        FROM plans p
        WHERE p.student_id = $1
          AND ($2::uuid IS NULL OR p.cycle_id = $2::uuid)
          AND ($3::text IS NULL OR p.status = $3::text)
      `, params.slice(0, 3))
    ]);
    return {
      items: itemsResult?.rows || [],
      total: Number(countResult?.rows?.[0]?.total || 0)
    };
  }

  async updateOwnPlan(client, {
    planId,
    studentId,
    expectedVersion,
    cycleId,
    companyId,
    positionId,
    notes
  }) {
    const result = await this.query(`
      UPDATE plans p
      SET
        cycle_id = $4,
        company_id = $5,
        position_id = $6,
        notes = $7,
        version = p.version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE p.id = $1
        AND p.student_id = $2
        AND p.version = $3
        AND p.status IN ('DRAFT', 'NEEDS_REVISION')
      RETURNING
        id, cycle_id, company_id, position_id, notes, status, version,
        created_at, updated_at
    `, [
      planId,
      studentId,
      expectedVersion,
      cycleId,
      companyId,
      positionId,
      notes
    ], client);
    return result?.rows?.[0] || null;
  }
}

module.exports = {
  StudentPlanRepository
};
