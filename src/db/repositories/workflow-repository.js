/**
 * Workflow Repository for CO-ED V3.
 * Executes parameterized SQL transactions for Plan state transitions,
 * optimistic concurrency locks, immutable audit events, and operation records.
 * Does not contain HTTP or role policy decisions.
 * Conforms to Issue #54, #56, #62, and #63.
 */

const { getPool } = require('../connection');
const { ServiceUnavailableError } = require('../../api/errors');

const UNAVAILABLE_DB_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', '42P01']);

class WorkflowRepository {
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
   * Acquires a client connection from the pool for a transaction.
   * @returns {Promise<object>}
   */
  async getClient() {
    try {
      return await this.getDbPool().connect();
    } catch (err) {
      if (UNAVAILABLE_DB_ERROR_CODES.has(err?.code)) {
        throw new ServiceUnavailableError('Database service unavailable.');
      }
      throw err;
    }
  }

  /**
   * Executes a query against pool or client with error mapping.
   */
  async query(text, params, client = null) {
    const executor = client || this.getDbPool();
    try {
      return await executor.query(text, params);
    } catch (err) {
      if (UNAVAILABLE_DB_ERROR_CODES.has(err?.code)) {
        throw new ServiceUnavailableError('Database service unavailable.');
      }
      throw err;
    }
  }

  /**
   * Locks and retrieves a Plan row by ID within an active transaction.
   * @param {object} client Active database client
   * @param {string} planId
   * @returns {Promise<object|null>}
   */
  async findPlanByIdForUpdate(client, planId) {
    const sql = `
      SELECT
        p.id,
        p.student_id,
        p.cycle_id,
        p.round_id,
        p.company_id,
        p.position_id,
        p.notes,
        p.status,
        p.version,
        p.legacy_compatibility,
        p.created_at,
        p.updated_at,
        r.academic_year AS round_academic_year,
        r.semester AS round_semester,
        r.status AS round_status,
        s.department AS student_department,
        s.program AS student_program,
        s.academic_year AS student_academic_year,
        c.visibility AS company_visibility,
        pos.visibility AS position_visibility,
        pos.company_id AS position_company_id
      FROM plans p
      LEFT JOIN rounds r ON r.id = COALESCE(p.cycle_id, p.round_id)
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN companies c ON c.id = p.company_id
      LEFT JOIN positions pos ON pos.id = p.position_id
      WHERE p.id = $1
      FOR UPDATE OF p
    `;
    const result = await this.query(sql, [planId], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Finds an existing plan operation by operation ID for idempotent retry.
   * @param {object|null} client Active database client or null for pool
   * @param {string} operationId UUID
   * @returns {Promise<object|null>}
   */
  async findOperationById(client, operationId) {
    const sql = `
      SELECT
        operation_id,
        plan_id,
        actor_id,
        action,
        request_hash,
        response_status,
        response_payload,
        result_version,
        created_at
      FROM plan_operations
      WHERE operation_id = $1
      LIMIT 1
    `;
    const result = await this.query(sql, [operationId], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Finds an existing plan operation by request hash and plan ID for idempotent retry.
   * @param {object|null} client Active database client or null for pool
   * @param {string} planId
   * @param {string} requestHash 64-character hex hash
   * @returns {Promise<object|null>}
   */
  async findOperationByRequestHash(client, planId, requestHash) {
    const sql = `
      SELECT
        operation_id,
        plan_id,
        actor_id,
        action,
        request_hash,
        response_status,
        response_payload,
        result_version,
        created_at
      FROM plan_operations
      WHERE plan_id = $1 AND request_hash = $2
      LIMIT 1
    `;
    const result = await this.query(sql, [planId, requestHash], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Updates Plan status, version, and timestamp with optimistic lock condition.
   * Student-authored Plan notes are intentionally not writable by workflow commands.
   * @param {object} client Active database client
   * @param {object} params
   * @returns {Promise<object|null>}
   */
  async updatePlanStatus(client, { planId, status, nextVersion, expectedVersion }) {
    const sql = `
      UPDATE plans
      SET
        status = $1,
        version = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND version = $4
      RETURNING
        id,
        student_id,
        cycle_id,
        round_id,
        company_id,
        position_id,
        notes,
        status,
        version,
        created_at,
        updated_at
    `;
    const result = await this.query(sql, [status, nextVersion, planId, expectedVersion], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Inserts an immutable operation record.
   * @param {object} client Active database client
   * @param {object} params
   * @returns {Promise<object>}
   */
  async insertPlanOperation(client, {
    operationId,
    planId,
    actorId,
    action,
    requestHash,
    responseStatus = 200,
    responsePayload,
    resultVersion
  }) {
    const sql = `
      INSERT INTO plan_operations (
        operation_id,
        plan_id,
        actor_id,
        action,
        request_hash,
        response_status,
        response_payload,
        result_version,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      RETURNING
        operation_id,
        plan_id,
        actor_id,
        action,
        request_hash,
        response_status,
        response_payload,
        result_version,
        created_at
    `;
    const result = await this.query(sql, [
      operationId,
      planId,
      actorId,
      action,
      requestHash,
      responseStatus,
      JSON.stringify(responsePayload),
      resultVersion
    ], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Inserts an immutable audit event.
   * @param {object} client Active database client
   * @param {object} params
   * @returns {Promise<object>}
   */
  async insertAuditEvent(client, {
    eventId,
    planId,
    actorId,
    actorRole,
    action,
    resourceType = 'plan',
    resourceId,
    fromState,
    toState,
    notes = null,
    correlationId = null,
    operationId = null
  }) {
    const sql = `
      INSERT INTO audit_events (
        event_id,
        plan_id,
        actor_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        from_state,
        to_state,
        notes,
        correlation_id,
        operation_id,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      RETURNING
        event_id,
        plan_id,
        actor_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        from_state,
        to_state,
        notes,
        correlation_id,
        operation_id,
        created_at
    `;
    const result = await this.query(sql, [
      eventId,
      planId,
      actorId,
      actorRole,
      action,
      resourceType,
      resourceId,
      fromState,
      toState,
      notes,
      correlationId,
      operationId
    ], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Checks if staff user is in active scope for student/plan and round is OPEN.
   */
  async findStaffScopeMatch({ client, staffUserId, studentId, planId, isReviewAction = true }) {
    const sql = `
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
    const result = await this.query(sql, [staffUserId, studentId, planId, Boolean(isReviewAction)], client);
    return result?.rows?.[0] || null;
  }

  /**
   * Retrieves all audit events for a plan ordered chronologically.
   * @param {object|null} client Active database client or null for pool
   * @param {string} planId
   * @returns {Promise<Array>}
   */
  async listAuditEventsByPlanId(client, planId) {
    const sql = `
      SELECT
        event_id,
        plan_id,
        actor_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        from_state,
        to_state,
        notes,
        correlation_id,
        operation_id,
        created_at
      FROM audit_events
      WHERE plan_id = $1
      ORDER BY created_at ASC, event_id ASC
    `;
    const result = await this.query(sql, [planId], client);
    return result?.rows || [];
  }

  /**
   * Retrieves all plan operations for a plan.
   * @param {object|null} client Active database client or null for pool
   * @param {string} planId
   * @returns {Promise<Array>}
   */
  async listPlanOperationsByPlanId(client, planId) {
    const sql = `
      SELECT
        operation_id,
        plan_id,
        actor_id,
        action,
        request_hash,
        response_status,
        response_payload,
        result_version,
        created_at
      FROM plan_operations
      WHERE plan_id = $1
      ORDER BY created_at ASC
    `;
    const result = await this.query(sql, [planId], client);
    return result?.rows || [];
  }
}

module.exports = {
  WorkflowRepository
};
