/**
 * Student Own Plan service for Issue #66.
 * Enforces trusted ownership, field/state rules, reference integrity,
 * optimistic concurrency, idempotency, and immutable audit recording.
 */

const crypto = require('node:crypto');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} = require('../errors');
const {
  StudentPlanRepository
} = require('../../db/repositories/student-plan-repository');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN_STATES = new Set([
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_REVISION', 'APPROVED', 'CANCELLED'
]);
const EDITABLE_STATES = new Set(['DRAFT', 'NEEDS_REVISION']);
const RESPONSE_FIELDS = Object.freeze([
  'id', 'cycle_id', 'company_id', 'position_id', 'notes', 'status',
  'version', 'created_at', 'updated_at'
]);
const CREATE_FIELDS = new Set([
  'cycle_id', 'company_id', 'position_id', 'notes', 'operation_id', 'correlation_id'
]);
const UPDATE_FIELDS = new Set([
  'cycle_id', 'company_id', 'position_id', 'notes', 'expected_version',
  'operation_id', 'correlation_id'
]);
const CONTENT_FIELDS = ['cycle_id', 'company_id', 'position_id', 'notes'];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
}

function assertAllowedFields(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ValidationError(`Unsupported field: ${key}.`, [
        { field: key, issue: 'field is not writable' }
      ]);
    }
  }
}

function requireUuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new ValidationError(`${field} must be a valid UUID.`, [
      { field, issue: 'invalid UUID' }
    ]);
  }
  return value.toLowerCase();
}

function normalizeNotes(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('notes must be plain text.', [
      { field: 'notes', issue: 'must be a string or null' }
    ]);
  }
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 2000) {
    throw new ValidationError('notes cannot exceed 2000 characters.', [
      { field: 'notes', issue: 'maximum length is 2000 characters' }
    ]);
  }
  return normalized;
}

function toOwnPlan(row) {
  if (!row) return null;
  const result = {};
  for (const field of RESPONSE_FIELDS) {
    const value = row[field];
    result[field] = value instanceof Date ? value.toISOString() : (value ?? null);
  }
  result.version = Number(row.version);
  return result;
}

function stableHash(payload) {
  const ordered = Object.keys(payload).sort().reduce((result, key) => {
    result[key] = payload[key];
    return result;
  }, {});
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function parseStoredPayload(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function assertStudentActor(actor) {
  if (!actor?.isAuthenticated) throw new UnauthorizedError();
  if (
    actor.role !== 'STUDENT' ||
    actor.accountStatus !== 'ACTIVE' ||
    !UUID_REGEX.test(actor.userId || '') ||
    !UUID_REGEX.test(actor.studentId || '')
  ) {
    throw new ForbiddenError('Access denied.', 'FORBIDDEN');
  }
}

class StudentPlanService {
  constructor(options = {}) {
    this.repository = options.repository || new StudentPlanRepository(options);
    this.uuid = options.uuid || (() => crypto.randomUUID());
  }

  async assertActiveStudent(client, actor) {
    const row = await this.repository.findActiveStudentLink(client, {
      userId: actor.userId,
      studentId: actor.studentId
    });
    if (!row) throw new ForbiddenError('Access denied.', 'FORBIDDEN');
  }

  async assertReferences(client, { cycleId, companyId, positionId }) {
    if (!await this.repository.findCycle(client, cycleId)) {
      throw new ValidationError('Selected cycle does not exist.', [
        { field: 'cycle_id', issue: 'unknown reference' }
      ]);
    }
    if (companyId !== null && !await this.repository.findPublicCompany(client, companyId)) {
      throw new ValidationError('Selected company is not public or does not exist.', [
        { field: 'company_id', issue: 'invalid public reference' }
      ]);
    }
    if (positionId !== null) {
      const position = await this.repository.findPublicPosition(client, positionId);
      if (!position || position.company_id !== companyId) {
        throw new ValidationError('Selected position is not public or does not belong to the selected company.', [
          { field: 'position_id', issue: 'invalid company/position reference' }
        ]);
      }
    }
  }

  assertReplay(operation, { actor, action, requestHash, planId = null }) {
    if (
      operation.actor_id !== actor.userId ||
      operation.action !== action ||
      operation.request_hash !== requestHash ||
      (planId && operation.plan_id !== planId)
    ) {
      throw new ConflictError('Idempotency key was already used for a different request.', 'IDEMPOTENCY_KEY_REUSED');
    }
    return {
      plan: toOwnPlan(parseStoredPayload(operation.response_payload)),
      idempotentReplay: true
    };
  }

  async createOwnPlan(actor, body) {
    assertStudentActor(actor);
    assertPlainObject(body);
    assertAllowedFields(body, CREATE_FIELDS);

    const cycleId = requireUuid(body.cycle_id, 'cycle_id');
    const companyId = hasOwn(body, 'company_id')
      ? requireUuid(body.company_id, 'company_id', { nullable: true })
      : null;
    const positionId = hasOwn(body, 'position_id')
      ? requireUuid(body.position_id, 'position_id', { nullable: true })
      : null;
    const notes = normalizeNotes(body.notes) ?? null;
    const operationId = requireUuid(body.operation_id, 'operation_id');
    const correlationId = hasOwn(body, 'correlation_id')
      ? requireUuid(body.correlation_id, 'correlation_id', { nullable: true })
      : null;
    if (positionId !== null && companyId === null) {
      throw new ValidationError('position_id requires company_id.');
    }

    const action = 'plan:create';
    const requestHash = stableHash({ cycleId, companyId, positionId, notes });
    const client = await this.repository.getClient();
    try {
      await client.query('BEGIN');
      await this.assertActiveStudent(client, actor);

      const prior = await this.repository.findOperationById(client, operationId);
      if (prior) {
        const replay = this.assertReplay(prior, { actor, action, requestHash });
        await client.query('COMMIT');
        return replay;
      }

      await this.assertReferences(client, { cycleId, companyId, positionId });
      const planId = this.uuid();
      const row = await this.repository.insertPlan(client, {
        planId,
        studentId: actor.studentId,
        cycleId,
        companyId,
        positionId,
        notes
      });
      const plan = toOwnPlan(row);
      await this.repository.insertPlanOperation(client, {
        operationId,
        planId,
        actorId: actor.userId,
        action,
        requestHash,
        responseStatus: 201,
        responsePayload: plan,
        resultVersion: 1
      });
      await this.repository.insertAuditEvent(client, {
        eventId: this.uuid(),
        planId,
        actorId: actor.userId,
        actorRole: 'STUDENT',
        action: 'PLAN_CREATED',
        resourceId: planId,
        fromState: null,
        toState: 'DRAFT',
        notes: null,
        correlationId,
        operationId
      });
      await client.query('COMMIT');
      return { plan, idempotentReplay: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        throw new ConflictError('An active Plan already exists for this cycle.', 'CONFLICT');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listOwnPlans(actor, filters = {}) {
    assertStudentActor(actor);
    const page = Number(filters.page ?? 1);
    const pageSize = Number(filters.pageSize ?? 10);
    if (!Number.isInteger(page) || page < 1) throw new ValidationError('page must be an integer greater than or equal to 1.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ValidationError('pageSize must be an integer from 1 to 100.');
    const cycleId = filters.cycle_id === undefined ? null : requireUuid(filters.cycle_id, 'cycle_id');
    const status = filters.status === undefined ? null : String(filters.status).toUpperCase();
    if (status !== null && !PLAN_STATES.has(status)) throw new ValidationError('status is invalid.');
    const result = await this.repository.listOwnPlans({
      studentId: actor.studentId,
      cycleId,
      status,
      page,
      pageSize
    });
    return {
      items: result.items.map(toOwnPlan),
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize)
      }
    };
  }

  async getOwnPlan(actor, planId) {
    assertStudentActor(actor);
    const id = requireUuid(planId, 'planId');
    const row = await this.repository.findOwnPlanById(actor.studentId, id);
    if (!row) throw new NotFoundError('Plan not found.', 'PLAN_NOT_FOUND');
    return toOwnPlan(row);
  }

  async updateOwnPlan(actor, planId, body) {
    assertStudentActor(actor);
    const id = requireUuid(planId, 'planId');
    assertPlainObject(body);
    assertAllowedFields(body, UPDATE_FIELDS);
    if (!CONTENT_FIELDS.some((field) => hasOwn(body, field))) {
      throw new ValidationError('At least one Plan content field is required.');
    }
    if (!Number.isInteger(body.expected_version) || body.expected_version < 1) {
      throw new ValidationError('expected_version must be an integer greater than or equal to 1.');
    }
    const operationId = requireUuid(body.operation_id, 'operation_id');
    const correlationId = hasOwn(body, 'correlation_id')
      ? requireUuid(body.correlation_id, 'correlation_id', { nullable: true })
      : null;
    if (hasOwn(body, 'company_id') && !hasOwn(body, 'position_id')) {
      throw new ValidationError('Changing company_id requires position_id in the same request.');
    }

    const normalizedPatch = {};
    if (hasOwn(body, 'cycle_id')) normalizedPatch.cycle_id = requireUuid(body.cycle_id, 'cycle_id');
    if (hasOwn(body, 'company_id')) normalizedPatch.company_id = requireUuid(body.company_id, 'company_id', { nullable: true });
    if (hasOwn(body, 'position_id')) normalizedPatch.position_id = requireUuid(body.position_id, 'position_id', { nullable: true });
    if (hasOwn(body, 'notes')) normalizedPatch.notes = normalizeNotes(body.notes);
    const action = 'plan:update_content';
    const requestHash = stableHash({ planId: id, expectedVersion: body.expected_version, ...normalizedPatch });
    const client = await this.repository.getClient();
    try {
      await client.query('BEGIN');
      await this.assertActiveStudent(client, actor);
      const current = await this.repository.findPlanByIdForUpdate(client, id);
      if (!current) throw new NotFoundError('Plan not found.', 'PLAN_NOT_FOUND');
      if (current.student_id !== actor.studentId) throw new ForbiddenError('Access denied.', 'FORBIDDEN');

      const prior = await this.repository.findOperationById(client, operationId);
      if (prior) {
        const replay = this.assertReplay(prior, { actor, action, requestHash, planId: id });
        await client.query('COMMIT');
        return replay;
      }

      if (!EDITABLE_STATES.has(current.status)) {
        throw new ForbiddenError('Plan content is not editable in its current state.', 'PLAN_STATE_NOT_EDITABLE');
      }
      if (Number(current.version) !== body.expected_version) {
        throw new ConflictError('Plan has been updated by another request.', 'STALE_RECORD_CONFLICT');
      }

      const next = {
        cycleId: normalizedPatch.cycle_id ?? current.cycle_id,
        companyId: hasOwn(normalizedPatch, 'company_id') ? normalizedPatch.company_id : current.company_id,
        positionId: hasOwn(normalizedPatch, 'position_id') ? normalizedPatch.position_id : current.position_id,
        notes: hasOwn(normalizedPatch, 'notes') ? normalizedPatch.notes : current.notes
      };
      if (next.positionId !== null && next.companyId === null) {
        throw new ValidationError('position_id requires company_id.');
      }
      await this.assertReferences(client, next);
      const updated = await this.repository.updateOwnPlan(client, {
        planId: id,
        studentId: actor.studentId,
        expectedVersion: body.expected_version,
        ...next
      });
      if (!updated) throw new ConflictError('Plan has been updated by another request.', 'STALE_RECORD_CONFLICT');
      const plan = toOwnPlan(updated);
      await this.repository.insertPlanOperation(client, {
        operationId,
        planId: id,
        actorId: actor.userId,
        action,
        requestHash,
        responseStatus: 200,
        responsePayload: plan,
        resultVersion: plan.version
      });
      await this.repository.insertAuditEvent(client, {
        eventId: this.uuid(),
        planId: id,
        actorId: actor.userId,
        actorRole: 'STUDENT',
        action: 'PLAN_DRAFT_UPDATED',
        resourceId: id,
        fromState: current.status,
        toState: current.status,
        notes: null,
        correlationId,
        operationId
      });
      await client.query('COMMIT');
      return { plan, idempotentReplay: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') throw new ConflictError('An active Plan already exists for this cycle.', 'CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  StudentPlanService,
  toOwnPlan,
  normalizeNotes,
  RESPONSE_FIELDS
};
