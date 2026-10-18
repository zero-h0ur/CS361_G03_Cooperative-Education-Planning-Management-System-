import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_V3_FIXTURES_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  "../data/v3/fixtures.json",
);
export const DEFAULT_V2_DATASET_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  "../data/v2/mock-dataset.json",
);

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_64_PATTERN = /^[0-9a-f]{64}$/;

const ALLOWED_USER_ROLES = new Set(["STUDENT", "ADVISOR", "STAFF", "ADMIN", "SYSTEM"]);
const ALLOWED_ACCOUNT_STATUS = new Set(["ACTIVE", "DISABLED"]);
const ALLOWED_LINK_STATUS = new Set(["ACTIVE", "REVOKED"]);
const ALLOWED_ENROLLMENT_STATUS = new Set(["ACTIVE", "INACTIVE"]);
const ALLOWED_ROUND_STATUS = new Set(["OPEN", "CLOSED"]);
const ALLOWED_PLAN_STATUS = new Set([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_REVISION",
  "APPROVED",
  "CANCELLED",
]);
const ALLOWED_ASSIGNMENT_STATUS = new Set(["ACTIVE", "REVOKED", "EXPIRED"]);
const ALLOWED_STAFF_SCOPE_STATUS = new Set(["ACTIVE", "INACTIVE"]);

// RFC 2606 reserved domain regex: example.com, example.net, example.org or TLD .example
const RFC2606_EMAIL_PATTERN = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|net|org)|example)$/i;

// Standard department codes used in Issue #53 and engineering curriculum
const ALLOWED_DEPARTMENTS = new Set(["CPE", "EE", "ME"]);

const TOP_LEVEL_KEYS = new Set([
  "dataset_metadata",
  "users",
  "external_identity_links",
  "students",
  "rounds",
  "plans",
  "advisor_assignments",
  "staff_scopes",
  "plan_operations",
  "audit_events",
]);

export function loadFixtures(filePath = DEFAULT_V3_FIXTURES_PATH) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

export function loadV2Dataset(filePath = DEFAULT_V2_DATASET_PATH) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

export function validateFixtures(fixtures, v2Dataset = null) {
  const errors = [];

  if (!fixtures || typeof fixtures !== "object") {
    return ["Fixtures must be a valid JSON object"];
  }

  // 1. Check top-level keys
  for (const key of Object.keys(fixtures)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unexpected top-level key: "${key}"`);
    }
  }

  const meta = fixtures.dataset_metadata;
  if (!meta || typeof meta !== "object") {
    errors.push("Missing dataset_metadata object");
    return errors;
  }

  const expectedCounts = meta.expected_counts || {};

  // 2. Validate users
  const users = fixtures.users || [];
  if (expectedCounts.users !== undefined && users.length !== expectedCounts.users) {
    errors.push(`users count mismatch: expected ${expectedCounts.users}, got ${users.length}`);
  }
  const userMap = new Map();
  for (const u of users) {
    if (!u.id || !UUID_V4_PATTERN.test(u.id)) {
      errors.push(`user id is not a valid UUID v4: "${u.id}"`);
    }
    if (userMap.has(u.id)) {
      errors.push(`Duplicate user ID: "${u.id}"`);
    }
    userMap.set(u.id, u);

    if (!ALLOWED_USER_ROLES.has(u.role)) {
      errors.push(`Invalid user role "${u.role}" for user ${u.id}`);
    }
    if (!ALLOWED_ACCOUNT_STATUS.has(u.account_status)) {
      errors.push(`Invalid account status "${u.account_status}" for user ${u.id}`);
    }
    if (!Number.isInteger(u.version) || u.version < 1) {
      errors.push(`Invalid user version "${u.version}" for user ${u.id}`);
    }
  }

  // 3. Validate external identity links
  const links = fixtures.external_identity_links || [];
  if (expectedCounts.external_identity_links !== undefined && links.length !== expectedCounts.external_identity_links) {
    errors.push(`external_identity_links count mismatch: expected ${expectedCounts.external_identity_links}, got ${links.length}`);
  }
  const linkIdSet = new Set();
  const identityPairSet = new Set();
  const activeUserLinkCount = new Map();

  for (const link of links) {
    if (!link.id || !UUID_V4_PATTERN.test(link.id)) {
      errors.push(`external_identity_link id is not a valid UUID v4: "${link.id}"`);
    }
    if (linkIdSet.has(link.id)) {
      errors.push(`Duplicate external_identity_link ID: "${link.id}"`);
    }
    linkIdSet.add(link.id);

    if (!userMap.has(link.user_id)) {
      errors.push(`external_identity_link references non-existent user_id: "${link.user_id}"`);
    }

    const pair = `${link.external_issuer}::${link.external_subject}`;
    if (identityPairSet.has(pair)) {
      errors.push(`Duplicate external identity (issuer, subject): "${pair}"`);
    }
    identityPairSet.add(pair);

    if (!link.external_issuer || link.external_issuer !== link.external_issuer.trim()) {
      errors.push(`external_issuer must be trimmed non-empty string in link ${link.id}`);
    }
    if (!link.external_subject || link.external_subject !== link.external_subject.trim()) {
      errors.push(`external_subject must be trimmed non-empty string in link ${link.id}`);
    }

    if (!ALLOWED_LINK_STATUS.has(link.status)) {
      errors.push(`Invalid link status "${link.status}" in link ${link.id}`);
    }

    if (link.status === "ACTIVE") {
      activeUserLinkCount.set(link.user_id, (activeUserLinkCount.get(link.user_id) || 0) + 1);
      if (link.revoked_at !== null || link.revoked_by !== null) {
        errors.push(`ACTIVE link must have null revoked_at and revoked_by in link ${link.id}`);
      }
    } else if (link.status === "REVOKED") {
      if (!link.revoked_at || !link.revoked_by) {
        errors.push(`REVOKED link must have non-null revoked_at and revoked_by in link ${link.id}`);
      }
      if (link.revoked_by && !userMap.has(link.revoked_by)) {
        errors.push(`revoked_by references non-existent user_id: "${link.revoked_by}" in link ${link.id}`);
      }
    }
  }

  for (const [userId, count] of activeUserLinkCount.entries()) {
    if (count > 1) {
      errors.push(`User ${userId} has ${count} active external identity links; at most 1 allowed`);
    }
  }

  // 4. Validate students
  const students = fixtures.students || [];
  if (expectedCounts.students !== undefined && students.length !== expectedCounts.students) {
    errors.push(`students count mismatch: expected ${expectedCounts.students}, got ${students.length}`);
  }
  const studentMap = new Map();
  const studentNumberSet = new Set();
  const studentUserSet = new Set();

  for (const s of students) {
    if (!s.id || !UUID_V4_PATTERN.test(s.id)) {
      errors.push(`student id is not a valid UUID v4: "${s.id}"`);
    }
    if (studentMap.has(s.id)) {
      errors.push(`Duplicate student ID: "${s.id}"`);
    }
    studentMap.set(s.id, s);

    if (s.user_id) {
      if (studentUserSet.has(s.user_id)) {
        errors.push(`Duplicate student user_id: "${s.user_id}"`);
      }
      studentUserSet.add(s.user_id);

      const linkedUser = userMap.get(s.user_id);
      if (!linkedUser) {
        errors.push(`student references non-existent user_id: "${s.user_id}"`);
      } else if (linkedUser.role !== "STUDENT") {
        errors.push(`student user_id "${s.user_id}" references user with role "${linkedUser.role}", must be "STUDENT"`);
      }

      // Check linked complete profile per Issue #51 & #56
      const requiredFields = [
        "student_number",
        "full_name",
        "institutional_email",
        "department",
        "program",
        "major",
        "academic_year",
        "enrollment_status",
      ];
      for (const f of requiredFields) {
        if (!s[f] || (typeof s[f] === "string" && s[f] !== s[f].trim())) {
          errors.push(`Linked student ${s.id} is missing or has untrimmed required field: "${f}"`);
        }
      }

      // Exact department matching per Issue #53: must be standard department code (e.g. 'CPE', 'EE')
      if (s.department && !ALLOWED_DEPARTMENTS.has(s.department)) {
        errors.push(
          `Student department "${s.department}" must be one of standard codes: ${Array.from(ALLOWED_DEPARTMENTS).join(', ')}`
        );
      }

      // Academic year calendar check: C.E. year (e.g. 2026) per Issue #53
      if (s.academic_year && (s.academic_year < 2000 || s.academic_year > 2100)) {
        errors.push(`Student academic_year "${s.academic_year}" must be a Common Era year (e.g. 2026)`);
      }

      if (s.student_number) {
        if (studentNumberSet.has(s.student_number)) {
          errors.push(`Duplicate student_number: "${s.student_number}"`);
        }
        studentNumberSet.add(s.student_number);
      }

      if (!ALLOWED_ENROLLMENT_STATUS.has(s.enrollment_status)) {
        errors.push(`Invalid enrollment_status "${s.enrollment_status}" for student ${s.id}`);
      }

      // RFC 2606 privacy check on email: must end in an RFC 2606 reserved domain (e.g. @student.example.com or .example)
      if (s.institutional_email && !RFC2606_EMAIL_PATTERN.test(s.institutional_email)) {
        errors.push(
          `Student email must strictly use an RFC 2606 reserved domain (e.g. @student.example.com, @example.com, .example): "${s.institutional_email}"`
        );
      }
    }
  }

  // 5. Validate rounds
  const rounds = fixtures.rounds || [];
  if (expectedCounts.rounds !== undefined && rounds.length !== expectedCounts.rounds) {
    errors.push(`rounds count mismatch: expected ${expectedCounts.rounds}, got ${rounds.length}`);
  }
  const roundMap = new Map();
  for (const r of rounds) {
    if (!r.id || !UUID_V4_PATTERN.test(r.id)) {
      errors.push(`round id is not a valid UUID v4: "${r.id}"`);
    }
    if (roundMap.has(r.id)) {
      errors.push(`Duplicate round ID: "${r.id}"`);
    }
    roundMap.set(r.id, r);

    if (!ALLOWED_ROUND_STATUS.has(r.status)) {
      errors.push(`Invalid round status "${r.status}" for round ${r.id}`);
    }
    // Academic year calendar check: C.E. year (e.g. 2026)
    if (!Number.isInteger(r.academic_year) || r.academic_year < 2000 || r.academic_year > 2100) {
      errors.push(`Round academic_year "${r.academic_year}" must be a Common Era year (e.g. 2026) in round ${r.id}`);
    }
    if (r.semester !== undefined && r.semester !== null && (!Number.isInteger(r.semester) || r.semester <= 0)) {
      errors.push(`Invalid round semester "${r.semester}" for round ${r.id}`);
    }
    // rounds.end_date check to support default advisor_assignment effective_to per Issue #53
    if (!r.end_date || isNaN(new Date(r.end_date).getTime())) {
      errors.push(`Round ${r.id} must have a valid end_date timestamp to support default assignment effective_to (#53)`);
    }
  }

  // Optional: load V2 dataset for cross-entity checks
  const v2Companies = new Set();
  const v2Positions = new Map();
  if (v2Dataset) {
    for (const c of v2Dataset.companies || []) v2Companies.add(c.id);
    for (const p of v2Dataset.positions || []) v2Positions.set(p.id, p.company_id);
  }

  // 6. Validate plans
  const plans = fixtures.plans || [];
  if (expectedCounts.plans !== undefined && plans.length !== expectedCounts.plans) {
    errors.push(`plans count mismatch: expected ${expectedCounts.plans}, got ${plans.length}`);
  }
  const planMap = new Map();
  const activeStudentCycleMap = new Set();

  for (const p of plans) {
    if (!p.id || !UUID_V4_PATTERN.test(p.id)) {
      errors.push(`plan id is not a valid UUID v4: "${p.id}"`);
    }
    if (planMap.has(p.id)) {
      errors.push(`Duplicate plan ID: "${p.id}"`);
    }
    planMap.set(p.id, p);

    if (!studentMap.has(p.student_id)) {
      errors.push(`plan references non-existent student_id: "${p.student_id}"`);
    }

    if (!ALLOWED_PLAN_STATUS.has(p.status)) {
      errors.push(`Invalid plan status "${p.status}" for plan ${p.id}`);
    }

    if (p.cycle_id && !roundMap.has(p.cycle_id)) {
      errors.push(`plan references non-existent cycle_id: "${p.cycle_id}"`);
    }
    if (p.round_id && p.cycle_id && p.round_id !== p.cycle_id) {
      errors.push(`plan round_id "${p.round_id}" must match cycle_id "${p.cycle_id}"`);
    }

    // Submittable fields rule
    if (p.status !== "DRAFT" && p.status !== "CANCELLED") {
      if (!p.cycle_id || !p.company_id || !p.position_id) {
        errors.push(`Plan ${p.id} with status "${p.status}" must have cycle_id, company_id, and position_id`);
      }
    }

    // Position requires company
    if (p.position_id && !p.company_id) {
      errors.push(`Plan ${p.id} has position_id but missing company_id`);
    }

    // Cross reference with V2 companies/positions if available
    if (v2Dataset && p.company_id) {
      if (!v2Companies.has(p.company_id)) {
        errors.push(`Plan ${p.id} references unknown company_id "${p.company_id}"`);
      }
      if (p.position_id) {
        const expectedCompanyId = v2Positions.get(p.position_id);
        if (!expectedCompanyId) {
          errors.push(`Plan ${p.id} references unknown position_id "${p.position_id}"`);
        } else if (expectedCompanyId !== p.company_id) {
          errors.push(`Plan ${p.id} position "${p.position_id}" belongs to company "${expectedCompanyId}", not "${p.company_id}"`);
        }
      }
    }

    // Unique active plan per student and cycle
    if (p.status !== "CANCELLED" && p.cycle_id) {
      const studentCycleKey = `${p.student_id}::${p.cycle_id}`;
      if (activeStudentCycleMap.has(studentCycleKey)) {
        errors.push(`Student ${p.student_id} has multiple active plans in cycle ${p.cycle_id}`);
      }
      activeStudentCycleMap.add(studentCycleKey);
    }

    // Alignment check between student academic_year and round academic_year per Issue #53:
    // Predicate checks r.academic_year when plan exists and s.academic_year when reviewing student only.
    if (p.cycle_id && p.student_id) {
      const student = studentMap.get(p.student_id);
      const round = roundMap.get(p.cycle_id);
      if (student && round && student.academic_year && round.academic_year) {
        if (student.academic_year !== round.academic_year) {
          errors.push(
            `Plan ${p.id}: student academic_year (${student.academic_year}) does not match round academic_year (${round.academic_year}); staff scope predicate outcome would diverge between student and plan evaluation`
          );
        }
      }
    }
  }

  // 7. Validate advisor assignments
  const assignments = fixtures.advisor_assignments || [];
  if (expectedCounts.advisor_assignments !== undefined && assignments.length !== expectedCounts.advisor_assignments) {
    errors.push(`advisor_assignments count mismatch: expected ${expectedCounts.advisor_assignments}, got ${assignments.length}`);
  }
  const assignmentMap = new Map();
  const activeAssignmentsByStudent = new Map();

  for (const a of assignments) {
    if (!a.id || !UUID_V4_PATTERN.test(a.id)) {
      errors.push(`advisor_assignment id is not a valid UUID v4: "${a.id}"`);
    }
    if (assignmentMap.has(a.id)) {
      errors.push(`Duplicate advisor_assignment ID: "${a.id}"`);
    }
    assignmentMap.set(a.id, a);

    const advisor = userMap.get(a.advisor_id);
    if (!advisor) {
      errors.push(`assignment references non-existent advisor_id: "${a.advisor_id}"`);
    } else if (advisor.role !== "ADVISOR") {
      errors.push(`advisor_id "${a.advisor_id}" references role "${advisor.role}", must be "ADVISOR"`);
    }

    if (!studentMap.has(a.student_id)) {
      errors.push(`assignment references non-existent student_id: "${a.student_id}"`);
    }

    const assigner = userMap.get(a.assigned_by);
    if (!assigner) {
      errors.push(`assignment references non-existent assigned_by: "${a.assigned_by}"`);
    } else if (assigner.role !== "ADMIN") {
      errors.push(`assigned_by "${a.assigned_by}" must reference an ADMIN`);
    }

    if (!ALLOWED_ASSIGNMENT_STATUS.has(a.status)) {
      errors.push(`Invalid assignment status "${a.status}" in assignment ${a.id}`);
    }

    // Academic year calendar check: C.E. year (e.g. 2026)
    if (!Number.isInteger(a.academic_year) || a.academic_year < 2000 || a.academic_year > 2100) {
      errors.push(`Assignment academic_year "${a.academic_year}" must be a Common Era year (e.g. 2026) in assignment ${a.id}`);
    }

    const fromDate = new Date(a.effective_from);
    const toDate = new Date(a.effective_to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || toDate <= fromDate) {
      errors.push(`Invalid effective period in assignment ${a.id}: effective_to must be after effective_from`);
    }

    if (a.status === "REVOKED") {
      if (!a.revoked_at || !a.revoked_by) {
        errors.push(`REVOKED assignment ${a.id} must have non-null revoked_at and revoked_by`);
      }
      if (a.revoked_by && !userMap.has(a.revoked_by)) {
        errors.push(`assignment revoked_by references non-existent user: "${a.revoked_by}"`);
      }
    } else {
      if (a.revoked_at !== null || a.revoked_by !== null || a.revocation_reason !== null) {
        errors.push(`Non-REVOKED assignment ${a.id} must have null revoked_at, revoked_by, and revocation_reason`);
      }
    }

    // Check overlap for active assignments of the same student
    if (a.status === "ACTIVE") {
      const studentList = activeAssignmentsByStudent.get(a.student_id) || [];
      for (const prev of studentList) {
        const prevFrom = new Date(prev.effective_from);
        const prevTo = new Date(prev.effective_to);
        if (fromDate < prevTo && toDate > prevFrom) {
          errors.push(`Active assignment ${a.id} overlaps with ${prev.id} for student ${a.student_id}`);
        }
      }
      studentList.push(a);
      activeAssignmentsByStudent.set(a.student_id, studentList);
    }
  }

  // 8. Validate staff scopes
  const scopes = fixtures.staff_scopes || [];
  if (expectedCounts.staff_scopes !== undefined && scopes.length !== expectedCounts.staff_scopes) {
    errors.push(`staff_scopes count mismatch: expected ${expectedCounts.staff_scopes}, got ${scopes.length}`);
  }
  const scopeIdSet = new Set();
  const scopeUniqueKeySet = new Set();
  const staffScopeDepartments = new Set();

  for (const sc of scopes) {
    if (!sc.id || !UUID_V4_PATTERN.test(sc.id)) {
      errors.push(`staff_scope id is not a valid UUID v4: "${sc.id}"`);
    }
    if (scopeIdSet.has(sc.id)) {
      errors.push(`Duplicate staff_scope ID: "${sc.id}"`);
    }
    scopeIdSet.add(sc.id);

    const staff = userMap.get(sc.staff_id);
    if (!staff) {
      errors.push(`staff_scope references non-existent staff_id: "${sc.staff_id}"`);
    } else if (staff.role !== "STAFF") {
      errors.push(`staff_id "${sc.staff_id}" references role "${staff.role}", must be "STAFF"`);
    }

    if (!sc.department || sc.department !== sc.department.trim()) {
      errors.push(`staff_scope department must be a trimmed non-empty string in ${sc.id}`);
    } else if (!ALLOWED_DEPARTMENTS.has(sc.department)) {
      errors.push(
        `Staff scope department "${sc.department}" must be one of standard codes: ${Array.from(ALLOWED_DEPARTMENTS).join(', ')}`
      );
    }

    if (sc.status === "ACTIVE") {
      staffScopeDepartments.add(sc.department);
    }

    if (sc.academic_year !== null && sc.academic_year !== undefined) {
      if (!Number.isInteger(sc.academic_year) || sc.academic_year < 2000 || sc.academic_year > 2100) {
        errors.push(`Staff scope academic_year "${sc.academic_year}" must be a Common Era year in ${sc.id}`);
      }
    }

    if (!ALLOWED_STAFF_SCOPE_STATUS.has(sc.status)) {
      errors.push(`Invalid staff_scope status "${sc.status}" in ${sc.id}`);
    }

    const uniqueKey = `${sc.staff_id}::${sc.department}::${sc.program || ""}::${sc.academic_year || 0}`;
    if (scopeUniqueKeySet.has(uniqueKey)) {
      errors.push(`Duplicate staff scope unique key: "${uniqueKey}" in ${sc.id}`);
    }
    scopeUniqueKeySet.add(uniqueKey);
  }

  // Cross-entity check per Issue #60 & #53:
  // Ensure that every active Staff member has at least one student outside their scope
  // to guarantee testability of 403 Forbidden authorization failure.
  const activeStaffMembers = users.filter((u) => u.role === "STAFF" && u.account_status === "ACTIVE");
  for (const staff of activeStaffMembers) {
    const staffActiveScopes = scopes.filter((sc) => sc.staff_id === staff.id && sc.status === "ACTIVE");
    const hasOutOfScopeStudent = students.some((s) => {
      const isInScope = staffActiveScopes.some((sc) => {
        const deptMatch = sc.department === s.department;
        const progMatch = !sc.program || sc.program === s.program;
        const yearMatch = !sc.academic_year || sc.academic_year === s.academic_year;
        return deptMatch && progMatch && yearMatch;
      });
      return !isInScope;
    });

    if (!hasOutOfScopeStudent && students.length > 0) {
      errors.push(
        `Staff ${staff.id} has no out-of-scope students to test 403 Forbidden authorization failure`
      );
    }
  }

  // 9. Validate plan operations
  const operations = fixtures.plan_operations || [];
  if (expectedCounts.plan_operations !== undefined && operations.length !== expectedCounts.plan_operations) {
    errors.push(`plan_operations count mismatch: expected ${expectedCounts.plan_operations}, got ${operations.length}`);
  }
  const opMap = new Map();
  for (const op of operations) {
    if (!op.operation_id || !UUID_V4_PATTERN.test(op.operation_id)) {
      errors.push(`plan_operation id is not a valid UUID v4: "${op.operation_id}"`);
    }
    if (opMap.has(op.operation_id)) {
      errors.push(`Duplicate operation_id: "${op.operation_id}"`);
    }
    opMap.set(op.operation_id, op);

    if (!planMap.has(op.plan_id)) {
      errors.push(`plan_operation references non-existent plan_id: "${op.plan_id}"`);
    }
    if (!userMap.has(op.actor_id)) {
      errors.push(`plan_operation references non-existent actor_id: "${op.actor_id}"`);
    }
    if (!HASH_64_PATTERN.test(op.request_hash)) {
      errors.push(`plan_operation request_hash must be a 64-hex string in ${op.operation_id}`);
    }
    if (typeof op.response_status !== "number" || op.response_status < 200 || op.response_status > 299) {
      errors.push(`plan_operation response_status must be 200-299 in ${op.operation_id}`);
    }
    if (!op.response_payload || typeof op.response_payload !== "object") {
      errors.push(`plan_operation response_payload must be an object in ${op.operation_id}`);
    }
  }

  // 10. Validate audit events
  const auditEvents = fixtures.audit_events || [];
  if (expectedCounts.audit_events !== undefined && auditEvents.length !== expectedCounts.audit_events) {
    errors.push(`audit_events count mismatch: expected ${expectedCounts.audit_events}, got ${auditEvents.length}`);
  }
  const auditIdSet = new Set();
  for (const ev of auditEvents) {
    if (!ev.event_id || !UUID_V4_PATTERN.test(ev.event_id)) {
      errors.push(`audit_event id is not a valid UUID v4: "${ev.event_id}"`);
    }
    if (auditIdSet.has(ev.event_id)) {
      errors.push(`Duplicate audit_event ID: "${ev.event_id}"`);
    }
    auditIdSet.add(ev.event_id);

    if (ev.plan_id && !planMap.has(ev.plan_id)) {
      errors.push(`audit_event references non-existent plan_id: "${ev.plan_id}"`);
    }
    if (!userMap.has(ev.actor_id)) {
      errors.push(`audit_event references non-existent actor_id: "${ev.actor_id}"`);
    }
    if (!ALLOWED_USER_ROLES.has(ev.actor_role)) {
      errors.push(`audit_event invalid actor_role: "${ev.actor_role}"`);
    }
    if (ev.operation_id && !opMap.has(ev.operation_id)) {
      errors.push(`audit_event references non-existent operation_id: "${ev.operation_id}"`);
    }
    if (ev.from_state && !ALLOWED_PLAN_STATUS.has(ev.from_state)) {
      errors.push(`audit_event invalid from_state: "${ev.from_state}"`);
    }
    if (ev.to_state && !ALLOWED_PLAN_STATUS.has(ev.to_state)) {
      errors.push(`audit_event invalid to_state: "${ev.to_state}"`);
    }
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtures = loadFixtures();
  const v2Dataset = fs.existsSync(DEFAULT_V2_DATASET_PATH) ? loadV2Dataset() : null;
  const errors = validateFixtures(fixtures, v2Dataset);
  if (errors.length > 0) {
    console.error("V3 Fixtures validation failed with errors:");
    for (const e of errors) {
      console.error(" - ", e);
    }
    process.exit(1);
  } else {
    console.log("V3 Fixtures validation passed successfully.");
  }
}
