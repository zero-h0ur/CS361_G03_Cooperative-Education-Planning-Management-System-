/**
 * Advisor Assigned-Scope Read Service for CO-ED V3 (#68).
 *
 * The service validates read filters, preserves generic out-of-scope failures,
 * and delegates only to the dedicated SELECT-only Advisor repository.
 */

const {
  UnauthorizedError,
  ForbiddenError,
  ValidationError
} = require('../errors');
const { ROLES } = require('./authorization-service');
const {
  AdvisorReadRepository
} = require('../../db/repositories/advisor-read-repository');
const {
  toAdvisorStudent,
  toAdvisorPlanSummary,
  toAdvisorPlanDetail
} = require('./advisor-read-serializers');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN_STATUSES = new Set([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'APPROVED',
  'CANCELLED', 'REJECTED'
]);

function genericForbidden() {
  return new ForbiddenError('Access denied.', 'FORBIDDEN');
}

function parsePositiveInteger(value, field, fallback, maximum = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError('Invalid pagination parameters.', [
      { field, issue: 'must be a positive integer' }
    ]);
  }
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new ValidationError('Invalid pagination parameters.', [
      { field, issue: 'must be a positive integer' }
    ]);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) {
    throw new ValidationError('Invalid pagination parameters.', [
      {
        field,
        issue: maximum
          ? `must be an integer between 1 and ${maximum}`
          : 'must be a positive integer'
      }
    ]);
  }
  return parsed;
}

function parsePagination(input = {}) {
  const page = parsePositiveInteger(input.page, 'page', DEFAULT_PAGE);
  const pageSize = parsePositiveInteger(
    input.pageSize,
    'pageSize',
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  return Object.freeze({
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize
  });
}

function assertUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError('Invalid request input.', [
      { field, issue: 'must be a valid UUID' }
    ]);
  }
  return value;
}

function parsePlanFilters(input = {}) {
  const cycleId = input.cycle_id === undefined || input.cycle_id === ''
    ? null
    : assertUuid(input.cycle_id, 'cycle_id');

  let status = null;
  if (input.status !== undefined && input.status !== '') {
    status = String(input.status).toUpperCase();
    if (!PLAN_STATUSES.has(status)) {
      throw new ValidationError('Invalid request input.', [
        { field: 'status', issue: 'must be a valid Plan status' }
      ]);
    }
  }

  return Object.freeze({ cycleId, status });
}

function buildPagination(page, pageSize, total) {
  return Object.freeze({
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
  });
}

class AdvisorReadService {
  constructor(options = {}) {
    this.repository =
      options.advisorReadRepository ||
      options.repository ||
      new AdvisorReadRepository({ pool: options.pool });
    this.now = options.now || (() => new Date());
  }

  requireAdvisor(authContext) {
    if (!authContext?.isAuthenticated || !authContext.userId) {
      throw new UnauthorizedError('Authentication required.', 'UNAUTHORIZED');
    }
    if (authContext.role !== ROLES.ADVISOR || authContext.accountStatus !== 'ACTIVE') {
      throw genericForbidden();
    }
  }

  resolveTimestamp(explicitTimestamp) {
    const raw = explicitTimestamp === undefined ? this.now() : explicitTimestamp;
    const timestamp = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(timestamp.getTime())) {
      throw new ValidationError('Invalid request timestamp.');
    }
    return timestamp.toISOString();
  }

  async listStudents(authContext, input = {}, requestTimestamp) {
    this.requireAdvisor(authContext);
    const pagination = parsePagination(input);
    const result = await this.repository.listAssignedStudents({
      advisorUserId: authContext.userId,
      timestampIso: this.resolveTimestamp(requestTimestamp),
      limit: pagination.limit,
      offset: pagination.offset
    });
    return Object.freeze({
      items: Object.freeze(result.rows.map(toAdvisorStudent)),
      pagination: buildPagination(pagination.page, pagination.pageSize, result.total)
    });
  }

  async getStudent(authContext, studentId, requestTimestamp) {
    this.requireAdvisor(authContext);
    const row = await this.repository.findAssignedStudent({
      advisorUserId: authContext.userId,
      studentId: assertUuid(studentId, 'studentId'),
      timestampIso: this.resolveTimestamp(requestTimestamp)
    });
    if (!row) throw genericForbidden();
    return toAdvisorStudent(row);
  }

  async listStudentPlans(authContext, studentId, input = {}, requestTimestamp) {
    this.requireAdvisor(authContext);
    const normalizedStudentId = assertUuid(studentId, 'studentId');
    const pagination = parsePagination(input);
    const filters = parsePlanFilters(input);
    const result = await this.repository.listAssignedStudentPlans({
      advisorUserId: authContext.userId,
      studentId: normalizedStudentId,
      timestampIso: this.resolveTimestamp(requestTimestamp),
      cycleId: filters.cycleId,
      status: filters.status,
      limit: pagination.limit,
      offset: pagination.offset
    });
    return Object.freeze({
      items: Object.freeze(result.rows.map(toAdvisorPlanSummary)),
      pagination: buildPagination(pagination.page, pagination.pageSize, result.total)
    });
  }

  async getPlan(authContext, planId, requestTimestamp) {
    this.requireAdvisor(authContext);
    const row = await this.repository.findAssignedPlan({
      advisorUserId: authContext.userId,
      planId: assertUuid(planId, 'planId'),
      timestampIso: this.resolveTimestamp(requestTimestamp)
    });
    if (!row) throw genericForbidden();
    return toAdvisorPlanDetail(row);
  }
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PLAN_STATUSES,
  parsePagination,
  parsePlanFilters,
  AdvisorReadService
};
