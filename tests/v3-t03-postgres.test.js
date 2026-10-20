/** Issue #80: real transaction/locking/audit verification in disposable schemas. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../src/db/migrate');
const { createLambdaHandler } = require('../src/lambda');
const { TokenValidator } = require('../src/auth/token-validator');
const { IdentityResolver } = require('../src/auth/identity-resolver');
const { AuthorizationService } = require('../src/api/services/authorization-service');
const { WorkflowService } = require('../src/api/services/workflow-service');
const { WorkflowRepository } = require('../src/db/repositories/workflow-repository');

jest.setTimeout(20000);
const IDS = {
  studentUser: '70000000-0000-4000-8000-000000008001',
  staffUser: '70000000-0000-4000-8000-000000008002',
  student: '40000000-0000-4000-8000-000000008001',
  plan: '50000000-0000-4000-8000-000000008001',
  cycle: '30000000-0000-4000-8000-000000008001',
  company: '10000000-0000-4000-8000-000000008001',
  position: '20000000-0000-4000-8000-000000008001'
};
const ISSUER = 'https://identity.example.com/issue80';
const STUDENT = { isAuthenticated: true, userId: IDS.studentUser,
  studentId: IDS.student, role: 'STUDENT', accountStatus: 'ACTIVE' };

describe('Issue #80 PostgreSQL workflow guarantees (required test database)', () => {
  let admin;
  let pool;
  let schema;
  let service;
  let handler;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error('A separate TEST_DATABASE_URL is required for workflow transaction verification.');
    }
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
  });

  beforeEach(async () => {
    schema = `issue80_${process.pid}_${crypto.randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const bootstrap = await admin.connect();
    try {
      // Exclude public while creating the initial tables/tracker so IF NOT
      // EXISTS cannot accidentally reuse the shared test database's tables.
      await bootstrap.query(`SET search_path TO "${schema}"`);
      await bootstrap.query(fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial_schema.sql'), 'utf8'));
      await bootstrap.query('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)');
    } finally {
      await bootstrap.query('RESET search_path');
      bootstrap.release();
    }
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`, application_name: schema, max: 6 });
    await migrate({ pool, logger: { log() {}, error() {} } });
    await pool.query(`INSERT INTO users (id, role) VALUES ($1, 'STUDENT'), ($2, 'STAFF')`,
      [IDS.studentUser, IDS.staffUser]);
    await pool.query(`INSERT INTO students (id, anonymous_ref, source, visibility, data_status,
      user_id, student_number, full_name, institutional_email, department, program, major, academic_year, enrollment_status)
      VALUES ($1, 'ISSUE80-TEST', 'issue80-test', 'private', 'mock', $2,
      'TEST-WORKFLOW-001', 'Synthetic Workflow Student', 'workflow@student.example.com', 'CPE', 'CPE', 'CPE', 2569, 'ACTIVE')`,
    [IDS.student, IDS.studentUser]);
    await pool.query(`INSERT INTO rounds (id, name, academic_year, semester, status, source, visibility, data_status)
      VALUES ($1, 'Synthetic cycle', 2569, 1, 'OPEN', 'issue80-test', 'private', 'mock')`, [IDS.cycle]);
    await publishTestPolicy(IDS.cycle);
    await pool.query(`INSERT INTO companies (id, name, source, visibility, data_status)
      VALUES ($1, 'Synthetic Company', 'issue80-test', 'public', 'mock')`, [IDS.company]);
    await pool.query(`INSERT INTO positions (id, company_id, title, source, visibility, data_status)
      VALUES ($1, $2, 'Synthetic Position', 'issue80-test', 'public', 'mock')`, [IDS.position, IDS.company]);
    await pool.query(`INSERT INTO plans (id, student_id, cycle_id, round_id, company_id, position_id,
      notes, status, version, source, visibility, data_status, project_title)
      VALUES ($1, $2, $3, $3, $4, $5, 'Student-authored notes', 'DRAFT', 1, 'issue80-test', 'private', 'mock', 'Synthetic workflow project')`,
    [IDS.plan, IDS.student, IDS.cycle, IDS.company, IDS.position]);
    await pool.query(`INSERT INTO staff_scopes (id, staff_id, department, academic_year)
      VALUES ($1, $2, 'CPE', 2569)`, [crypto.randomUUID(), IDS.staffUser]);
    for (const [userId, sub] of [[IDS.studentUser, 'student'], [IDS.staffUser, 'staff']]) {
      await pool.query(`INSERT INTO external_identity_links (id, user_id, external_issuer, external_subject)
        VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), userId, ISSUER, sub]);
    }
    const authorizationService = new AuthorizationService({ pool });
    service = new WorkflowService({ repository: new WorkflowRepository({ pool }), authorizationService });
    handler = createLambdaHandler({ workflowService: service, authOptions: {
      pool, authorizationService, identityResolver: new IdentityResolver({ pool }),
      tokenValidator: new TokenValidator({ expectedIssuer: ISSUER, expectedClientId: 'issue80-client', requiredScope: 'coed-api/access' })
    } });
  });

  afterEach(async () => {
    if (pool) { await pool.end(); pool = null; }
    if (schema && admin) {
      if (!/^issue80_[0-9]+_[a-f0-9]+$/.test(schema)) throw new Error('Invalid disposable schema');
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      schema = null;
    }
  });
  afterAll(async () => { if (admin) await admin.end(); });

  async function publishTestPolicy(cycleId) {
    // No required documents in this transaction-focused fixture; the policy
    // itself remains mandatory and is pinned by the real submission trigger.
    await pool.query(`INSERT INTO document_policies
      (id, cycle_id, department, version, requirements, published_by)
      VALUES ($1, $2, 'CPE', 1, '[]', $3)`, [crypto.randomUUID(), cycleId, IDS.staffUser]);
  }

  function command(action, sub, version, operationId = crypto.randomUUID(), notes, planId = IDS.plan) {
    return handler({ rawPath: `/api/v3/plans/${planId}/${action}`,
      body: JSON.stringify({ expected_version: version, operation_id: operationId,
        ...(notes === undefined ? {} : { review_notes: notes }) }),
      requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: {
        iss: ISSUER, sub, client_id: 'issue80-client', token_use: 'access',
        scope: 'coed-api/access', exp: Math.floor(Date.now() / 1000) + 3600
      } } } } });
  }

  async function state() {
    const plan = await pool.query('SELECT status, version, notes FROM plans WHERE id = $1', [IDS.plan]);
    const audits = await pool.query('SELECT * FROM audit_events WHERE plan_id = $1 ORDER BY created_at, event_id', [IDS.plan]);
    const operations = await pool.query('SELECT * FROM plan_operations WHERE plan_id = $1 ORDER BY created_at, operation_id', [IDS.plan]);
    const submissions = await pool.query('SELECT * FROM plan_submissions WHERE plan_id = $1 ORDER BY plan_version', [IDS.plan]);
    return { plan: plan.rows[0], audits: audits.rows, operations: operations.rows, submissions: submissions.rows };
  }

  async function race(actions) {
    const blocker = await pool.connect();
    let pending;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM plans WHERE id = $1 FOR UPDATE', [IDS.plan]);
      pending = Promise.all(actions.map((run) => run()));
      // Both independent transactions must actually be waiting on the row lock.
      // This fails rather than passing a race that happened sequentially.
      const deadline = Date.now() + 5000;
      let blocked = 0;
      while (blocked < actions.length && Date.now() < deadline) {
        const result = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF p%'`, [schema]);
        blocked = result.rows[0].n;
        if (blocked < actions.length) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(actions.length);
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
      if (pending) await pending;
    }
    return pending;
  }

  test('persists the full lifecycle with correct actor/action/from/to/time and preserves Student notes', async () => {
    const steps = [
      ['submit', 'student', 'DRAFT', 'SUBMITTED', 'PLAN_SUBMITTED'],
      ['start-review', 'staff', 'SUBMITTED', 'UNDER_REVIEW', 'PLAN_REVIEW_STARTED'],
      ['return', 'staff', 'UNDER_REVIEW', 'NEEDS_REVISION', 'PLAN_RETURNED', 'Please revise'],
      ['submit', 'student', 'NEEDS_REVISION', 'SUBMITTED', 'PLAN_SUBMITTED'],
      ['start-review', 'staff', 'SUBMITTED', 'UNDER_REVIEW', 'PLAN_REVIEW_STARTED'],
      ['approve', 'staff', 'UNDER_REVIEW', 'APPROVED', 'PLAN_APPROVED']
    ];
    for (let index = 0; index < steps.length; index++) {
      const [action, sub, from, to, auditAction, notes] = steps[index];
      const opId = crypto.randomUUID();
      const started = Date.now();
      const result = await command(action, sub, index + 1, opId, notes);
      expect(result.statusCode).toBe(200);
      const snapshot = await state();
      expect(snapshot.plan).toEqual({ status: to, version: index + 2, notes: 'Student-authored notes' });
      expect(snapshot.audits).toHaveLength(index + 1);
      expect(snapshot.operations).toHaveLength(index + 1);
      const audit = snapshot.audits.find((row) => row.operation_id === opId);
      expect(audit).toMatchObject({ actor_id: sub === 'student' ? IDS.studentUser : IDS.staffUser,
        actor_role: sub.toUpperCase(), action: auditAction, from_state: from, to_state: to, notes: notes || null });
      expect(audit.created_at.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(audit.created_at.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  test.each(['DRAFT', 'NEEDS_REVISION'])('cancels %s through WorkflowService and persists one audit/operation', async (from) => {
    await pool.query('UPDATE plans SET status = $1 WHERE id = $2', [from, IDS.plan]);
    await service.cancelPlan({ actor: STUDENT, plan_id: IDS.plan, expected_version: 1, operation_id: crypto.randomUUID() });
    const snapshot = await state();
    expect(snapshot.plan.status).toBe('CANCELLED');
    expect(snapshot.plan.version).toBe(2);
    expect(snapshot.operations).toHaveLength(1);
    expect(snapshot.audits).toHaveLength(1);
    expect(snapshot.audits[0]).toMatchObject({ action: 'PLAN_CANCELLED', from_state: from, to_state: 'CANCELLED' });
  });

  test('rejects cancellation while SUBMITTED without modifying the plan, snapshot or history', async () => {
    expect((await command('submit', 'student', 1)).statusCode).toBe(200);
    const before = await state();
    const response = await command('cancel', 'student', 2);
    expect(response.statusCode).toBe(422);
    expect(await state()).toEqual(before);
  });

  test.each([['plans', 'UPDATE'], ['plan_operations', 'INSERT'], ['audit_events', 'INSERT']])(
    'rolls back all writes after a real PostgreSQL failure on %s', async (table, event) => {
      // All identifiers come from the fixed test matrix, in this test's schema.
      await pool.query(`CREATE FUNCTION issue80_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Injected issue80 constraint failure' USING ERRCODE = '23514'; END $$`);
      await pool.query(`CREATE TRIGGER issue80_fail BEFORE ${event} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION issue80_fail()`);
      const before = await state();
      const response = await command('submit', 'student', 1);
      expect(response.statusCode).toBe(500);
      expect(await state()).toEqual(before);
    }
  );

  test('database triggers reject UPDATE and DELETE of persisted audit and operation rows', async () => {
    expect((await command('submit', 'student', 1)).statusCode).toBe(200);
    const before = await state();
    for (const table of ['audit_events', 'plan_operations']) {
      await expect(pool.query(`UPDATE ${table} SET actor_id = actor_id WHERE plan_id = $1`, [IDS.plan]))
        .rejects.toMatchObject({ code: '55000' });
      await expect(pool.query(`DELETE FROM ${table} WHERE plan_id = $1`, [IDS.plan]))
        .rejects.toMatchObject({ code: '55000' });
    }
    expect(await state()).toEqual(before);
  });

  test('two overlapping review commands yield one success and one stale conflict without losing the winner', async () => {
    await pool.query("UPDATE plans SET status = 'UNDER_REVIEW' WHERE id = $1", [IDS.plan]);
    const responses = await race([
      () => command('approve', 'staff', 1),
      () => command('return', 'staff', 1, crypto.randomUUID(), 'Revise')
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const conflict = JSON.parse(responses.find((r) => r.statusCode === 409).body);
    expect(conflict.error.code).toBe('STALE_RECORD_CONFLICT');
    const winner = JSON.parse(responses.find((r) => r.statusCode === 200).body).data;
    const snapshot = await state();
    expect(snapshot.plan.status).toBe(winner.status);
    expect(snapshot.plan.version).toBe(2);
    expect(snapshot.audits).toHaveLength(1);
    expect(snapshot.operations).toHaveLength(1);
    expect(snapshot.audits[0].to_state).toBe(winner.status);
  });

  test('overlapping identical retries replay one operation; changed payload and stale version cannot write', async () => {
    const opId = crypto.randomUUID();
    const responses = await race([
      () => command('submit', 'student', 1, opId),
      () => command('submit', 'student', 1, opId)
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses.map((r) => JSON.parse(r.body).data.idempotent_replay).sort()).toEqual([false, true]);
    const before = await state();
    expect(before.plan.version).toBe(2);
    expect(before.audits).toHaveLength(1);
    expect(before.operations).toHaveLength(1);
    const reused = await command('start-review', 'staff', 2, opId);
    expect(reused.statusCode).toBe(409);
    expect(JSON.parse(reused.body).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const stale = await command('submit', 'student', 1);
    expect(stale.statusCode).toBe(409);
    expect(JSON.parse(stale.body).error.code).toBe('STALE_RECORD_CONFLICT');
    expect(await state()).toEqual(before);
  });

  test('reusing a completed operation with changed review notes is rejected without another write', async () => {
    await pool.query("UPDATE plans SET status = 'UNDER_REVIEW' WHERE id = $1", [IDS.plan]);
    const opId = crypto.randomUUID();
    expect((await command('return', 'staff', 1, opId, 'First feedback')).statusCode).toBe(200);
    const before = await state();
    const changed = await command('return', 'staff', 1, opId, 'Different feedback');
    expect(changed.statusCode).toBe(409);
    expect(JSON.parse(changed.body).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await state()).toEqual(before);
  });

  test('concurrent reuse of one operation ID across different Plans returns conflict and rolls back the loser', async () => {
    const otherPlan = crypto.randomUUID();
    const otherCycle = crypto.randomUUID();
    await pool.query(`INSERT INTO rounds (id, name, academic_year, semester, status, source, visibility, data_status)
      VALUES ($1, 'Other synthetic cycle', 2569, 2, 'OPEN', 'issue80-test', 'private', 'mock')`, [otherCycle]);
    await publishTestPolicy(otherCycle);
    await pool.query(`INSERT INTO plans (id, student_id, cycle_id, round_id, company_id, position_id,
      status, source, visibility, data_status, project_title) VALUES ($1, $2, $3, $3, $4, $5, 'DRAFT', 'issue80-test', 'private', 'mock', 'Other synthetic project')`,
    [otherPlan, IDS.student, otherCycle, IDS.company, IDS.position]);
    const opId = crypto.randomUUID();
    const blocker = await pool.connect();
    let responses;
    try {
      await blocker.query('BEGIN');
      // Let both transactions observe no cached operation, then stop both at
      // INSERT. Separate Plan locks cannot serialize this globally unique key.
      await blocker.query('LOCK TABLE plan_operations IN SHARE MODE');
      responses = Promise.all([
        command('submit', 'student', 1, opId),
        command('submit', 'student', 1, opId, undefined, otherPlan)
      ]);
      let blocked = 0;
      const deadline = Date.now() + 5000;
      while (blocked < 2 && Date.now() < deadline) {
        const result = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE '%INSERT INTO plan_operations%'`, [schema]);
        blocked = result.rows[0].n;
        if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(2);
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
      if (responses) await responses;
    }
    const results = await responses;
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(JSON.parse(results.find((r) => r.statusCode === 409).body).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const plans = await pool.query('SELECT status, version FROM plans ORDER BY id');
    expect(plans.rows.filter((row) => row.status === 'SUBMITTED' && row.version === 2)).toHaveLength(1);
    expect(plans.rows.filter((row) => row.status === 'DRAFT' && row.version === 1)).toHaveLength(1);
    expect((await pool.query('SELECT * FROM plan_operations')).rows).toHaveLength(1);
    expect((await pool.query('SELECT * FROM audit_events')).rows).toHaveLength(1);
  });
});
