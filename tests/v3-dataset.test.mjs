import assert from "node:assert/strict";
import test from "node:test";

import {
  loadFixtures,
  loadV2Dataset,
  validateFixtures,
} from "../scripts/validate-v3-fixtures.mjs";

function freshFixtures() {
  return structuredClone(loadFixtures());
}

function freshV2Dataset() {
  return structuredClone(loadV2Dataset());
}

test("canonical V3 fixtures pass full validation against V2 base dataset", () => {
  const fixtures = freshFixtures();
  const v2 = freshV2Dataset();
  const errors = validateFixtures(fixtures, v2);
  assert.deepEqual(errors, []);
});

test("canonical V3 fixtures have declared record counts and deterministic structure", () => {
  const fixtures = freshFixtures();
  assert.deepEqual(fixtures.dataset_metadata.expected_counts, {
    users: 11,
    external_identity_links: 11,
    students: 5,
    rounds: 2,
    plans: 6,
    advisor_assignments: 5,
    staff_scopes: 4,
    plan_operations: 2,
    audit_events: 6,
  });
});

test("all entity IDs in V3 fixtures are deterministic UUID v4 values", () => {
  const fixtures = freshFixtures();
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const u of fixtures.users) assert.match(u.id, uuidV4);
  for (const l of fixtures.external_identity_links) assert.match(l.id, uuidV4);
  for (const s of fixtures.students) assert.match(s.id, uuidV4);
  for (const r of fixtures.rounds) assert.match(r.id, uuidV4);
  for (const p of fixtures.plans) assert.match(p.id, uuidV4);
  for (const a of fixtures.advisor_assignments) assert.match(a.id, uuidV4);
  for (const sc of fixtures.staff_scopes) assert.match(sc.id, uuidV4);
  for (const op of fixtures.plan_operations) assert.match(op.operation_id, uuidV4);
  for (const ev of fixtures.audit_events) assert.match(ev.event_id, uuidV4);
});

test("all students strictly use RFC 2606 reserved domains (@student.example.com)", () => {
  const fixtures = freshFixtures();
  for (const s of fixtures.students) {
    assert.match(
      s.institutional_email,
      /@student\.example\.com$/,
      `Email must end with @student.example.com per RFC 2606: ${s.institutional_email}`
    );
    assert.ok(
      !/@(cmu\.ac\.th|gmail\.com|hotmail\.com|yahoo\.com)$/i.test(s.institutional_email),
      `Email must not use real institutional or public mail domains: ${s.institutional_email}`
    );
  }
});

test("students and staff_scopes strictly use standardized department codes ('CPE', 'EE') per Issue #53", () => {
  const fixtures = freshFixtures();
  const allowed = new Set(["CPE", "EE", "ME"]);
  for (const s of fixtures.students) {
    assert.ok(allowed.has(s.department), `Student department must be one of CPE/EE: ${s.department}`);
  }
  for (const sc of fixtures.staff_scopes) {
    assert.ok(allowed.has(sc.department), `Staff scope department must be standard code: ${sc.department}`);
  }
});

test("all academic_year values use the unified Common Era calendar (2026/2025)", () => {
  const fixtures = freshFixtures();
  for (const r of fixtures.rounds) {
    assert.ok(r.academic_year >= 2020 && r.academic_year <= 2030, `Round year must be C.E.: ${r.academic_year}`);
  }
  for (const s of fixtures.students) {
    assert.equal(s.academic_year, 2026, `Student year must be C.E. 2026: ${s.academic_year}`);
  }
  for (const a of fixtures.advisor_assignments) {
    assert.ok(a.academic_year === 2026 || a.academic_year === 2025, `Assignment year must be C.E.: ${a.academic_year}`);
  }
});

test("V3 fixtures cover required roles: STUDENT, ADVISOR, STAFF, ADMIN", () => {
  const fixtures = freshFixtures();
  const roles = new Set(fixtures.users.map((u) => u.role));
  assert.ok(roles.has("STUDENT"), "Must include STUDENT role");
  assert.ok(roles.has("ADVISOR"), "Must include ADVISOR role");
  assert.ok(roles.has("STAFF"), "Must include STAFF role");
  assert.ok(roles.has("ADMIN"), "Must include ADMIN role");
});

test("V3 fixtures cover all core workflow states: DRAFT, SUBMITTED, UNDER_REVIEW, NEEDS_REVISION, APPROVED, CANCELLED", () => {
  const fixtures = freshFixtures();
  const states = new Set(fixtures.plans.map((p) => p.status));
  assert.ok(states.has("DRAFT"), "Must cover DRAFT state");
  assert.ok(states.has("SUBMITTED"), "Must cover SUBMITTED state");
  assert.ok(states.has("UNDER_REVIEW"), "Must cover UNDER_REVIEW state");
  assert.ok(states.has("NEEDS_REVISION"), "Must cover NEEDS_REVISION state");
  assert.ok(states.has("APPROVED"), "Must cover APPROVED state");
  assert.ok(states.has("CANCELLED"), "Must cover CANCELLED state");
});

test("V3 fixtures cover advisor assignment states: ACTIVE, REVOKED, EXPIRED", () => {
  const fixtures = freshFixtures();
  const statuses = new Set(fixtures.advisor_assignments.map((a) => a.status));
  assert.ok(statuses.has("ACTIVE"), "Must cover ACTIVE assignment");
  assert.ok(statuses.has("REVOKED"), "Must cover REVOKED assignment");
  assert.ok(statuses.has("EXPIRED"), "Must cover EXPIRED assignment");
});

test("V3 fixtures cover staff scopes with active and inactive statuses", () => {
  const fixtures = freshFixtures();
  const statuses = new Set(fixtures.staff_scopes.map((s) => s.status));
  assert.ok(statuses.has("ACTIVE"), "Must cover ACTIVE scope");
  assert.ok(statuses.has("INACTIVE"), "Must cover INACTIVE scope");
});

test("rejects non-RFC2606 email domain in validator", () => {
  const fixtures = freshFixtures();
  fixtures.students[0].institutional_email = "sommut@cmu.ac.th";
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.ok(errors.some((e) => e.includes("RFC 2606")));
});

test("rejects unstandardized department string in validator", () => {
  const fixtures = freshFixtures();
  fixtures.students[0].department = "Computer Engineering Department";
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.ok(errors.some((e) => e.includes("must be one of standard codes")));
});

test("rejects overlapping active advisor assignments for the same student", () => {
  const fixtures = freshFixtures();
  fixtures.advisor_assignments.push({
    id: "90000000-0000-4000-8000-000000000099",
    advisor_id: "70000000-0000-4000-8000-000000000011",
    student_id: "40000000-0000-4000-8000-000000000101",
    academic_year: 2026,
    semester: 1,
    status: "ACTIVE",
    effective_from: "2026-07-01T00:00:00Z",
    effective_to: "2026-11-30T23:59:59Z",
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
    assigned_by: "70000000-0000-4000-8000-000000000030",
    created_at: "2026-10-01T08:30:00Z",
    updated_at: "2026-10-01T08:30:00Z",
  });
  fixtures.dataset_metadata.expected_counts.advisor_assignments += 1;
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.ok(errors.some((e) => e.includes("overlaps with")));
});

test("fixtures provide both in-scope (200 OK) and out-of-year (403 Forbidden) staff test cases for OPEN round 2026", () => {
  const fixtures = freshFixtures();
  const openRound = fixtures.rounds.find((r) => r.status === "OPEN");
  assert.ok(openRound, "Must have an OPEN round");
  assert.equal(openRound.academic_year, 2026, "OPEN round must be 2026");

  // Check Staff 1: has NULL academic_year -> covers 2026 OPEN round (200 OK)
  const staff1Scopes = fixtures.staff_scopes.filter(
    (sc) => sc.staff_id === "70000000-0000-4000-8000-000000000020" && sc.status === "ACTIVE"
  );
  const staff1Covers2026 = staff1Scopes.some(
    (sc) => sc.academic_year === null || sc.academic_year === openRound.academic_year
  );
  assert.ok(staff1Covers2026, "Must have at least one Staff whose scope covers 2026 OPEN round for 200 OK tests");

  // Check Staff 3: strictly restricted to 2025 -> does NOT cover 2026 OPEN round (403 Forbidden)
  const staff3Scopes = fixtures.staff_scopes.filter(
    (sc) => sc.staff_id === "70000000-0000-4000-8000-000000000022" && sc.status === "ACTIVE"
  );
  assert.ok(staff3Scopes.length > 0, "Staff 3 must have active scope");
  const staff3All2025 = staff3Scopes.every((sc) => sc.academic_year === 2025);
  assert.ok(staff3All2025, "Staff 3 must be strictly restricted to academic_year 2025 for 403 Forbidden tests");
});

test("every staff member has at least one student outside their scope to guarantee 403 test coverage", () => {
  const fixtures = freshFixtures();
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.deepEqual(errors, []);
});

test("validator flags error when a staff member has no out-of-scope students", () => {
  const fixtures = freshFixtures();
  // Give Staff 1 a universal scope covering all departments
  fixtures.staff_scopes.push({
    id: "91000000-0000-4000-8000-000000000099",
    staff_id: "70000000-0000-4000-8000-000000000020",
    department: "EE",
    program: null,
    academic_year: null,
    status: "ACTIVE",
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
  });
  fixtures.dataset_metadata.expected_counts.staff_scopes += 1;
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.ok(
    errors.some((e) => e.includes("has no out-of-scope students")),
    "Should report error when staff member covers all students"
  );
});

test("all rounds define valid end_date timestamps for default assignment effective_to (#53)", () => {
  const fixtures = freshFixtures();
  for (const r of fixtures.rounds) {
    assert.ok(r.end_date, `Round ${r.id} must define end_date`);
    assert.ok(!isNaN(new Date(r.end_date).getTime()), `Round ${r.id} end_date must be valid ISO timestamp`);
  }
});

test("all active plans have student.academic_year matching round.academic_year for consistent predicate evaluation", () => {
  const fixtures = freshFixtures();
  const studentMap = new Map(fixtures.students.map((s) => [s.id, s]));
  const roundMap = new Map(fixtures.rounds.map((r) => [r.id, r]));

  for (const p of fixtures.plans) {
    if (p.cycle_id && p.student_id) {
      const student = studentMap.get(p.student_id);
      const round = roundMap.get(p.cycle_id);
      assert.equal(
        student.academic_year,
        round.academic_year,
        `Plan ${p.id} student.academic_year must equal round.academic_year`
      );
    }
  }
});

test("validator rejects plans where student.academic_year diverges from round.academic_year", () => {
  const fixtures = freshFixtures();
  fixtures.students[0].academic_year = 2025; // Diverges from round 2026
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.ok(
    errors.some((e) => e.includes("staff scope predicate outcome would diverge")),
    "Should report error when student and round academic_year diverge"
  );
});

test("validator rejects rounds without end_date", () => {
  const fixtures = freshFixtures();
  delete fixtures.rounds[0].end_date;
  const errors = validateFixtures(fixtures, freshV2Dataset());
  assert.ok(
    errors.some((e) => e.includes("must have a valid end_date timestamp")),
    "Should report error when round end_date is missing"
  );
});


