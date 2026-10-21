/**
 * Staff Review Service for CO-ED V3.
 * Validates Staff search/review-queue filters and serializes results through explicit
 * response allowlists (#50). Scope is enforced by the repository SQL (#53); the caller
 * must already be authorized by the centralized policy (#62).
 * Conforms to Issue #50, #52, #53, #54, #55, and #67.
 */

const { ForbiddenError, ValidationError } = require('../errors');
const {
  StaffReviewRepository,
  REVIEW_QUEUE_STATES,
  PLAN_SORT_COLUMNS
} = require('../../db/repositories/staff-review-repository');

const PLAN_STATES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'APPROVED',
  'CANCELLED', 'REJECTED'
]);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_KEYWORD_LENGTH = 100;
// Team decision (#53 Academic Year clarification): academic_year is Buddhist Era
const BE_YEAR_MIN = 2500;
const BE_YEAR_MAX = 2700;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STUDENT_QUERY_PARAMS = Object.freeze(['page', 'pageSize', 'q', 'academic_year', 'advisor_id']);
const PLAN_QUERY_PARAMS = Object.freeze([
  'page', 'pageSize', 'q', 'academic_year', 'round_id', 'status', 'company_id', 'advisor_id', 'sort', 'order'
]);
const REVIEW_QUEUE_QUERY_PARAMS = PLAN_QUERY_PARAMS;

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

/**
 * Reads one optional query parameter. Empty values count as "not provided" (V2 behavior);
 * repeated parameters are rejected so the effective filter is never ambiguous.
 */
function readParam(searchParams, name, details) {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    details.push({ field: name, issue: 'must be provided at most once' });
    return null;
  }
  const value = (values[0] ?? '').trim();
  return value === '' ? null : value;
}

function parsePositiveInteger(raw, name, details, { max } = {}) {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    details.push({ field: name, issue: 'must be a positive integer' });
    return null;
  }
  const value = Number(raw);
  if (max && value > max) {
    details.push({ field: name, issue: `must not exceed ${max}` });
    return null;
  }
  return value;
}

function parseAcademicYear(raw, details) {
  if (raw === null) return null;
  const value = /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= BE_YEAR_MIN && value <= BE_YEAR_MAX)) {
    details.push({ field: 'academic_year', issue: 'must be a Buddhist Era year (e.g. 2569)' });
    return null;
  }
  return value;
}

function parseUuid(raw, name, details) {
  if (raw === null) return null;
  if (!UUID_REGEX.test(raw)) {
    details.push({ field: name, issue: 'must be a UUID' });
    return null;
  }
  return raw.toLowerCase();
}

function parseEnum(raw, name, allowed, details) {
  if (raw === null) return null;
  if (!allowed.includes(raw)) {
    details.push({ field: name, issue: `must be one of: ${allowed.join(', ')}` });
    return null;
  }
  return raw;
}

function parseKeyword(raw, details) {
  if (raw === null) return null;
  if (raw.length > MAX_KEYWORD_LENGTH) {
    details.push({ field: 'q', issue: `must not exceed ${MAX_KEYWORD_LENGTH} characters` });
    return null;
  }
  return raw;
}

function rejectUnknownParams(searchParams, allowed, details) {
  const allowedSet = new Set(allowed);
  for (const key of new Set(searchParams.keys())) {
    if (!allowedSet.has(key)) {
      details.push({ field: key, issue: 'is not a supported query parameter' });
    }
  }
}

function throwIfInvalid(details) {
  if (details.length > 0) {
    throw new ValidationError('Invalid search filters.', details);
  }
}

function parsePagination(searchParams, details) {
  const page = parsePositiveInteger(readParam(searchParams, 'page', details), 'page', details) || 1;
  const pageSize =
    parsePositiveInteger(readParam(searchParams, 'pageSize', details), 'pageSize', details, {
      max: MAX_PAGE_SIZE
    }) || DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

function parseStudentFilters(searchParams) {
  const details = [];
  rejectUnknownParams(searchParams, STUDENT_QUERY_PARAMS, details);
  const filters = {
    ...parsePagination(searchParams, details),
    keyword: parseKeyword(readParam(searchParams, 'q', details), details),
    academicYear: parseAcademicYear(readParam(searchParams, 'academic_year', details), details),
    advisorId: parseUuid(readParam(searchParams, 'advisor_id', details), 'advisor_id', details)
  };
  throwIfInvalid(details);
  return filters;
}

function parsePlanFilters(searchParams, { reviewQueue }) {
  const details = [];
  rejectUnknownParams(searchParams, reviewQueue ? REVIEW_QUEUE_QUERY_PARAMS : PLAN_QUERY_PARAMS, details);
  const filters = {
    ...parsePagination(searchParams, details),
    keyword: parseKeyword(readParam(searchParams, 'q', details), details),
    academicYear: parseAcademicYear(readParam(searchParams, 'academic_year', details), details),
    roundId: parseUuid(readParam(searchParams, 'round_id', details), 'round_id', details),
    status: parseEnum(
      readParam(searchParams, 'status', details),
      'status',
      reviewQueue ? REVIEW_QUEUE_STATES : PLAN_STATES,
      details
    ),
    companyId: parseUuid(readParam(searchParams, 'company_id', details), 'company_id', details),
    advisorId: parseUuid(readParam(searchParams, 'advisor_id', details), 'advisor_id', details),
    // Review queue defaults to oldest-waiting first; search defaults to most recently updated
    sort: parseEnum(readParam(searchParams, 'sort', details), 'sort', Object.keys(PLAN_SORT_COLUMNS), details) ||
      (reviewQueue ? 'submitted_at' : 'updated_at'),
    order: parseEnum(readParam(searchParams, 'order', details), 'order', ['asc', 'desc'], details) ||
      (reviewQueue ? 'asc' : 'desc')
  };
  throwIfInvalid(details);
  return filters;
}

// Response allowlists (#50): list views carry only what Staff needs to pick a record.
// Institutional email, Plan notes, review comments, user/identity ids and legacy columns are excluded.
function toStaffStudentSummary(row) {
  return Object.freeze({
    id: row.id,
    student_number: row.student_number,
    full_name: row.full_name,
    preferred_name: row.preferred_name ?? null,
    department: row.department,
    program: row.program,
    major: row.major,
    academic_year: row.academic_year,
    enrollment_status: row.enrollment_status
  });
}

function toStaffPlanSummary(row) {
  return Object.freeze({
    id: row.id,
    status: row.status,
    version: row.version,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    cycle: Object.freeze({
      id: row.cycle_id,
      name: row.cycle_name,
      academic_year: row.cycle_academic_year,
      semester: row.cycle_semester ?? null,
      status: row.cycle_status
    }),
    company: row.company_id
      ? Object.freeze({ id: row.company_id, name: row.company_name ?? null })
      : null,
    position: row.position_id
      ? Object.freeze({ id: row.position_id, title: row.position_title ?? null })
      : null,
    student: Object.freeze({
      id: row.student_id,
      student_number: row.student_number,
      full_name: row.full_name,
      preferred_name: row.preferred_name ?? null,
      department: row.department,
      program: row.program,
      academic_year: row.student_academic_year
    })
  });
}

// Detail view (#77): the summary plus the Student's Plan notes, which scoped Staff may read (#50).
// Review comments are served by the history route, never on the Plan itself.
function toStaffPlanDetail(row) {
  return Object.freeze({
    ...toStaffPlanSummary(row),
    notes: row.notes ?? null
  });
}

function toPagination({ page, pageSize }, total) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
  };
}

class StaffReviewService {
  /**
   * @param {object} [options]
   * @param {object} [options.pool]
   * @param {StaffReviewRepository} [options.staffReviewRepository]
   */
  constructor(options = {}) {
    this.repository =
      options.staffReviewRepository || new StaffReviewRepository({ pool: options.pool || null });
  }

  async searchStudents(staffUserId, searchParams) {
    const filters = parseStudentFilters(searchParams);
    const { rows, total } = await this.repository.searchStudents({ staffUserId, ...filters });
    return { items: rows.map(toStaffStudentSummary), pagination: toPagination(filters, total) };
  }

  async searchPlans(staffUserId, searchParams) {
    const filters = parsePlanFilters(searchParams, { reviewQueue: false });
    const { rows, total } = await this.repository.searchPlans({ staffUserId, reviewQueue: false, ...filters });
    return { items: rows.map(toStaffPlanSummary), pagination: toPagination(filters, total) };
  }

  async getReviewQueue(staffUserId, searchParams) {
    const filters = parsePlanFilters(searchParams, { reviewQueue: true });
    const { rows, total } = await this.repository.searchPlans({ staffUserId, reviewQueue: true, ...filters });
    return { items: rows.map(toStaffPlanSummary), pagination: toPagination(filters, total) };
  }

  async getPlanDetail(staffUserId, planId) {
    const row = await this.repository.findScopedPlan({ staffUserId, planId });
    // The policy already returned 403/404; a missing row here means scope changed in between
    if (!row) {
      throw new ForbiddenError('Access denied.', 'FORBIDDEN');
    }
    return toStaffPlanDetail(row);
  }
}

module.exports = {
  StaffReviewService,
  PLAN_STATES,
  REVIEW_QUEUE_STATES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  toStaffStudentSummary,
  toStaffPlanSummary,
  toStaffPlanDetail
};
