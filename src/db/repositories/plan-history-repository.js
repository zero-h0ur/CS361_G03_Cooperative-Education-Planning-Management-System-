/**
 * Plan History Repository for CO-ED V3.
 * Reads the append-only audit_events of one Plan in chronological order
 * (idx_audit_events_plan_created). Authorization is decided before this is called.
 * Conforms to Issue #49, #50, #54, #56, and #76.
 */

const { getPool } = require('../connection');
const { ServiceUnavailableError } = require('../../api/errors');

const UNAVAILABLE_DB_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', '42P01']);

class PlanHistoryRepository {
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

  async listPlanHistory(planId) {
    const result = await this.query(`
      SELECT
        ae.event_id,
        ae.action,
        ae.from_state,
        ae.to_state,
        ae.actor_role,
        ae.notes,
        ae.created_at
      FROM audit_events ae
      WHERE ae.plan_id = $1
      ORDER BY ae.created_at ASC, ae.event_id ASC
    `, [planId]);
    return result?.rows || [];
  }
}

module.exports = {
  PlanHistoryRepository
};
