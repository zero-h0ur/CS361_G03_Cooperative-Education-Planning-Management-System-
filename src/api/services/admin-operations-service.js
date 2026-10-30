const { getPool } = require('../../db/connection');
const { ForbiddenError, UnauthorizedError, ValidationError } = require('../errors');

// Operational metadata only: this area never reads Student profiles or Plans.
class AdminOperationsService {
  constructor(options = {}) {
    this.pool = options.pool;
  }

  async read(actor, page = 1) {
    if (!actor?.isAuthenticated) throw new UnauthorizedError();
    if (actor.role !== 'ADMIN') throw new ForbiddenError();
    if (!Number.isSafeInteger(page) || page < 1) throw new ValidationError('Invalid page.');
    const c = await (this.pool || getPool()).connect();
    try {
      await c.query('BEGIN');
      const current = (await c.query(
        'SELECT role,account_status FROM users WHERE id=$1 FOR SHARE', [actor.userId]
      )).rows[0];
      if (current?.role !== 'ADMIN' || current.account_status !== 'ACTIVE') {
        throw new ForbiddenError();
      }
      const accounts = (await c.query(`SELECT id,role,account_status,version FROM users
        ORDER BY id LIMIT 50 OFFSET $1`, [(page - 1) * 50])).rows;
      const total = Number((await c.query('SELECT count(*)::int AS total FROM users')).rows[0].total);
      const migrations = (await c.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row => row.version);
      const catalogue = (await c.query(`SELECT
        (SELECT count(*)::int FROM companies WHERE catalog_key IS NOT NULL) AS companies,
        (SELECT count(*)::int FROM positions WHERE announcement_ref IS NOT NULL) AS positions`)).rows[0];
      await c.query('COMMIT');
      return {
        accounts,
        pagination: { page, pageSize: 50, total, totalPages: Math.ceil(total / 50) },
        migrations,
        catalogue,
        operations: ['change-account-role-status', 'reviewed-partner-import', 'synthetic-challenge-provision'],
        student_workflow_access: false
      };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
}

module.exports = { AdminOperationsService };
