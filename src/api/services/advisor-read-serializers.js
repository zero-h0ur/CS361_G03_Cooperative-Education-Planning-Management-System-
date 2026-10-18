/**
 * Explicit privacy allowlists for Advisor assigned-scope responses (#53, #68).
 *
 * These serializers deliberately construct new objects. Never spread database
 * rows into API responses because rows can gain protected columns over time.
 */

const ADVISOR_STUDENT_FIELDS = Object.freeze([
  'id',
  'student_number',
  'full_name',
  'preferred_name',
  'department',
  'program',
  'major',
  'academic_year',
  'enrollment_status'
]);

const ADVISOR_PLAN_SUMMARY_FIELDS = Object.freeze([
  'id',
  'cycle_id',
  'company',
  'position',
  'status',
  'updated_at'
]);

const ADVISOR_PLAN_DETAIL_FIELDS = Object.freeze([
  ...ADVISOR_PLAN_SUMMARY_FIELDS,
  'notes',
  'version',
  'created_at'
]);

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}

function toAdvisorStudent(row = {}) {
  const student = {};
  for (const field of ADVISOR_STUDENT_FIELDS) {
    student[field] = normalizeValue(row[field]);
  }
  return Object.freeze(student);
}

function toPublicCompany(row = {}) {
  if (!row.company_id || !row.company_name) return null;
  return Object.freeze({
    id: row.company_id,
    name: row.company_name
  });
}

function toPublicPosition(row = {}) {
  if (!row.position_id || !row.position_title) return null;
  return Object.freeze({
    id: row.position_id,
    title: row.position_title
  });
}

function toAdvisorPlanSummary(row = {}) {
  return Object.freeze({
    id: normalizeValue(row.id),
    cycle_id: normalizeValue(row.cycle_id),
    company: toPublicCompany(row),
    position: toPublicPosition(row),
    status: normalizeValue(row.status),
    updated_at: normalizeValue(row.updated_at)
  });
}

function toAdvisorPlanDetail(row = {}) {
  const summary = toAdvisorPlanSummary(row);
  return Object.freeze({
    ...summary,
    notes: normalizeValue(row.notes),
    version: normalizeValue(row.version),
    created_at: normalizeValue(row.created_at)
  });
}

module.exports = {
  ADVISOR_STUDENT_FIELDS,
  ADVISOR_PLAN_SUMMARY_FIELDS,
  ADVISOR_PLAN_DETAIL_FIELDS,
  toAdvisorStudent,
  toAdvisorPlanSummary,
  toAdvisorPlanDetail
};
