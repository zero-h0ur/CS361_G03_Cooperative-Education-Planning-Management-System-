import assert from "node:assert/strict";
import test from "node:test";

import {
  loadDataset,
  validateDataset,
} from "../scripts/validate-v2-dataset.mjs";

function freshDataset() {
  return structuredClone(loadDataset());
}

function assertHasError(errors, text) {
  assert.ok(
    errors.some((error) => error.includes(text)),
    `Expected an error containing "${text}", received:\n${errors.join("\n")}`,
  );
}

test("canonical dataset passes validation", () => {
  assert.deepEqual(validateDataset(freshDataset()), []);
});

test("canonical dataset is repeatable and has the declared record counts", () => {
  const first = freshDataset();
  const second = freshDataset();

  assert.deepEqual(first, second);
  assert.deepEqual(first.dataset_metadata.expected_counts, {
    companies: 12,
    positions: 18,
    rounds: 3,
    document_metadata: 8,
    students: 5,
    plans: 7,
  });
});

test("all record IDs are deterministic UUID v4 values", () => {
  const dataset = freshDataset();
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const entityName of Object.keys(dataset.dataset_metadata.expected_counts)) {
    for (const record of dataset[entityName]) {
      assert.match(record.id, uuidV4);
    }
  }
});

test("duplicate IDs are rejected across entities", () => {
  const dataset = freshDataset();
  dataset.positions[0].id = dataset.companies[0].id;

  assertHasError(validateDataset(dataset), "duplicates");
});

test("malformed UUIDs are rejected", () => {
  const dataset = freshDataset();
  dataset.companies[0].id = "company-demo-001";

  assertHasError(validateDataset(dataset), "must be a UUID v4");
});

test("a position must reference an existing company", () => {
  const dataset = freshDataset();
  dataset.positions[0].company_id =
    "99999999-9999-4999-8999-999999999999";

  assertHasError(validateDataset(dataset), "does not reference a company");
});

test("a plan must reference an existing student", () => {
  const dataset = freshDataset();
  dataset.plans[0].student_id =
    "99999999-9999-4999-8999-999999999999";

  assertHasError(validateDataset(dataset), "does not reference a student");
});

test("a non-null plan round must reference an existing round", () => {
  const dataset = freshDataset();
  dataset.plans[0].round_id =
    "99999999-9999-4999-8999-999999999999";

  assertHasError(validateDataset(dataset), "does not reference a round");
});

test("a public position cannot expose a private company", () => {
  const dataset = freshDataset();
  dataset.positions[0].company_id = dataset.companies.at(-1).id;

  assertHasError(
    validateDataset(dataset),
    "references a non-public company",
  );
});

test("student and plan records remain private mock data", () => {
  const dataset = freshDataset();
  dataset.students[0].visibility = "public";
  dataset.plans[0].data_status = "verified";

  const errors = validateDataset(dataset);
  assertHasError(errors, "students[0] must be private");
  assertHasError(errors, "canonical mock seed");
});

test("personal fields and email-like values are rejected", () => {
  const dataset = freshDataset();
  dataset.students[0].email = "student@example.com";

  const errors = validateDataset(dataset);
  assertHasError(errors, 'contains unsupported field "email"');
  assertHasError(errors, 'contains prohibited field "email"');
  assertHasError(errors, "resembles an email address");
});

test("deferred workflow fields are rejected from plans", () => {
  const dataset = freshDataset();
  dataset.plans[0].status = "submitted";

  assertHasError(validateDataset(dataset), 'deferred workflow field "status"');
});

test("entities deferred by Issue #28 are rejected from the minimum model", () => {
  const dataset = freshDataset();
  dataset.openings = [];

  assertHasError(
    validateDataset(dataset),
    'unsupported top-level key "openings"',
  );
});

test("the canonical dataset exercises pagination and optional round_id", () => {
  const dataset = freshDataset();
  const publicPositions = dataset.positions.filter(
    (position) => position.visibility === "public",
  );

  assert.ok(
    publicPositions.length > dataset.dataset_metadata.test_page_size,
  );
  assert.ok(dataset.plans.some((plan) => plan.round_id === null));
  assert.deepEqual(validateDataset(dataset), []);
});
