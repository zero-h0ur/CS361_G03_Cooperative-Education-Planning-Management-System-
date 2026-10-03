import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATASET_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  "../data/v2/mock-dataset.json",
);

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_VISIBILITY = new Set(["public", "private"]);
const ALLOWED_DATA_STATUS = new Set(["mock", "to_validate", "verified"]);
const ENTITY_NAMES = [
  "companies",
  "positions",
  "rounds",
  "document_metadata",
  "students",
  "plans",
];
const TOP_LEVEL_KEYS = new Set(["dataset_metadata", ...ENTITY_NAMES]);
const COMMON_FIELDS = ["id", "source", "updated_at", "visibility", "data_status"];

const ENTITY_SPECS = {
  companies: {
    required: [...COMMON_FIELDS, "name"],
    allowed: [
      ...COMMON_FIELDS,
      "name",
      "description",
      "website_url",
      "location",
    ],
  },
  positions: {
    required: [...COMMON_FIELDS, "company_id", "title"],
    allowed: [
      ...COMMON_FIELDS,
      "company_id",
      "title",
      "description",
      "location",
    ],
  },
  rounds: {
    required: [...COMMON_FIELDS, "name", "academic_year"],
    allowed: [...COMMON_FIELDS, "name", "academic_year"],
  },
  document_metadata: {
    required: [...COMMON_FIELDS, "title", "public_url"],
    allowed: [...COMMON_FIELDS, "title", "public_url", "academic_year"],
  },
  students: {
    required: [...COMMON_FIELDS, "anonymous_ref"],
    allowed: [...COMMON_FIELDS, "anonymous_ref"],
  },
  plans: {
    required: [...COMMON_FIELDS, "student_id"],
    allowed: [...COMMON_FIELDS, "student_id", "round_id"],
  },
};

const FORBIDDEN_STUDENT_FIELDS = new Set([
  "name",
  "full_name",
  "email",
  "phone",
  "student_number",
  "student_id_number",
  "gpa",
]);
const FORBIDDEN_PLAN_WORKFLOW_FIELDS = new Set([
  "status",
  "submitted_at",
  "approved_at",
  "rejected_at",
  "choices",
  "plan_choices",
]);

function isNonEmpty(value) {
  return value !== null && value !== undefined && value !== "";
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function collectSensitiveStringErrors(value, errors, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectSensitiveStringErrors(item, errors, [...pathParts, index]),
    );
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) =>
      collectSensitiveStringErrors(child, errors, [...pathParts, key]),
    );
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  const key = String(pathParts.at(-1) ?? "");
  const location = pathParts.join(".");
  const isIdentifier = key === "id" || key.endsWith("_id");

  if (!isIdentifier && /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) {
    errors.push(`${location} resembles an email address`);
  }
  if (!isIdentifier && /(?:\+66|0)\d{8,9}\b/.test(value.replace(/[\s-]/g, ""))) {
    errors.push(`${location} resembles a phone number`);
  }
  if (/\b(?:password|api[_-]?key|access[_-]?key|secret|token)\b\s*[:=]/i.test(value)) {
    errors.push(`${location} resembles a credential`);
  }
}

function validateRecordShape(entityName, record, index, errors) {
  const spec = ENTITY_SPECS[entityName];
  const location = `${entityName}[${index}]`;
  const allowed = new Set(spec.allowed);

  for (const field of spec.required) {
    if (!isNonEmpty(record[field])) {
      errors.push(`${location} is missing required field "${field}"`);
    }
  }

  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      errors.push(`${location} contains unsupported field "${field}"`);
    }
  }

  if (isNonEmpty(record.id) && !UUID_V4_PATTERN.test(record.id)) {
    errors.push(`${location}.id must be a UUID v4`);
  }
  if (isNonEmpty(record.updated_at) && !isIsoDate(record.updated_at)) {
    errors.push(`${location}.updated_at must be an ISO-8601 UTC timestamp`);
  }
  if (isNonEmpty(record.visibility) && !ALLOWED_VISIBILITY.has(record.visibility)) {
    errors.push(`${location}.visibility must be public or private`);
  }
  if (isNonEmpty(record.data_status) && !ALLOWED_DATA_STATUS.has(record.data_status)) {
    errors.push(
      `${location}.data_status must be mock, to_validate, or verified`,
    );
  }
  if (record.data_status !== "mock") {
    errors.push(`${location}.data_status must be mock in the canonical mock seed`);
  }
}

function validateUniqueIds(dataset, errors) {
  const seen = new Map();

  for (const entityName of ENTITY_NAMES) {
    for (const [index, record] of dataset[entityName].entries()) {
      if (!isNonEmpty(record.id)) {
        continue;
      }
      if (seen.has(record.id)) {
        errors.push(
          `${entityName}[${index}].id duplicates ${seen.get(record.id)}`,
        );
      } else {
        seen.set(record.id, `${entityName}[${index}].id`);
      }
    }
  }
}

function validateRelationships(dataset, errors) {
  const companies = new Map(dataset.companies.map((item) => [item.id, item]));
  const students = new Set(dataset.students.map((item) => item.id));
  const rounds = new Set(dataset.rounds.map((item) => item.id));

  dataset.positions.forEach((position, index) => {
    const company = companies.get(position.company_id);
    if (!company) {
      errors.push(`positions[${index}].company_id does not reference a company`);
      return;
    }
    if (position.visibility === "public" && company.visibility !== "public") {
      errors.push(
        `positions[${index}] is public but references a non-public company`,
      );
    }
  });

  dataset.plans.forEach((plan, index) => {
    if (!students.has(plan.student_id)) {
      errors.push(`plans[${index}].student_id does not reference a student`);
    }
    if (plan.round_id !== null && plan.round_id !== undefined && !rounds.has(plan.round_id)) {
      errors.push(`plans[${index}].round_id does not reference a round`);
    }
  });
}

function validateEntityRules(dataset, errors) {
  dataset.companies.forEach((company, index) => {
    if (!/(?:example|mock|demo)/i.test(company.name ?? "")) {
      errors.push(
        `companies[${index}].name must clearly identify synthetic data`,
      );
    }
    if (
      company.website_url !== null &&
      company.website_url !== undefined &&
      !isHttpsUrl(company.website_url)
    ) {
      errors.push(`companies[${index}].website_url must be an HTTPS URL or null`);
    }
  });

  dataset.rounds.forEach((round, index) => {
    if (!Number.isInteger(round.academic_year)) {
      errors.push(`rounds[${index}].academic_year must be an integer`);
    }
  });

  dataset.document_metadata.forEach((document, index) => {
    if (!isHttpsUrl(document.public_url)) {
      errors.push(`document_metadata[${index}].public_url must be an HTTPS URL`);
    }
    if (
      document.academic_year !== null &&
      document.academic_year !== undefined &&
      !Number.isInteger(document.academic_year)
    ) {
      errors.push(
        `document_metadata[${index}].academic_year must be an integer or null`,
      );
    }
  });

  const anonymousRefs = new Set();
  dataset.students.forEach((student, index) => {
    if (student.visibility !== "private") {
      errors.push(`students[${index}] must be private`);
    }
    if (!/^student-demo-[a-z]\d+$/i.test(student.anonymous_ref ?? "")) {
      errors.push(`students[${index}].anonymous_ref must be synthetic`);
    }
    if (anonymousRefs.has(student.anonymous_ref)) {
      errors.push(`students[${index}].anonymous_ref must be unique`);
    }
    anonymousRefs.add(student.anonymous_ref);

    for (const field of Object.keys(student)) {
      if (FORBIDDEN_STUDENT_FIELDS.has(field)) {
        errors.push(`students[${index}] contains prohibited field "${field}"`);
      }
    }
  });

  dataset.plans.forEach((plan, index) => {
    if (plan.visibility !== "private") {
      errors.push(`plans[${index}] must be private`);
    }
    for (const field of Object.keys(plan)) {
      if (FORBIDDEN_PLAN_WORKFLOW_FIELDS.has(field)) {
        errors.push(
          `plans[${index}] contains deferred workflow field "${field}"`,
        );
      }
    }
  });
}

function validateScenarioCoverage(dataset, errors) {
  const metadata = dataset.dataset_metadata ?? {};
  const expectedCounts = metadata.expected_counts ?? {};

  for (const entityName of ENTITY_NAMES) {
    if (expectedCounts[entityName] !== dataset[entityName].length) {
      errors.push(
        `dataset_metadata.expected_counts.${entityName} does not match the dataset`,
      );
    }
  }

  const publicCompanies = dataset.companies.filter(
    (company) => company.visibility === "public",
  );
  const publicPositions = dataset.positions.filter(
    (position) => position.visibility === "public",
  );
  const pageSize = metadata.test_page_size;

  if (!Number.isInteger(pageSize) || pageSize < 1) {
    errors.push("dataset_metadata.test_page_size must be a positive integer");
  } else if (publicPositions.length <= pageSize) {
    errors.push(
      "public positions must exceed test_page_size to exercise pagination",
    );
  }

  const searchableValues = [
    ...publicCompanies.map((company) => company.name),
    ...publicPositions.map((position) => position.title),
  ].map((value) => value.toLocaleLowerCase());

  for (const scenario of metadata.scenario_expectations?.search_terms ?? []) {
    const query = String(scenario.query ?? "").toLocaleLowerCase();
    const matches = searchableValues.filter((value) => value.includes(query)).length;

    if (
      Number.isInteger(scenario.minimum_matches) &&
      matches < scenario.minimum_matches
    ) {
      errors.push(
        `search scenario "${scenario.query}" expected at least ${scenario.minimum_matches} matches but found ${matches}`,
      );
    }
    if (
      Number.isInteger(scenario.exact_matches) &&
      matches !== scenario.exact_matches
    ) {
      errors.push(
        `search scenario "${scenario.query}" expected ${scenario.exact_matches} matches but found ${matches}`,
      );
    }
  }

  const publicLocations = new Set(
    publicPositions
      .map((position) => position.location)
      .filter(Boolean),
  );
  for (const location of metadata.scenario_expectations?.locations ?? []) {
    if (!publicLocations.has(location)) {
      errors.push(`location scenario "${location}" has no public position`);
    }
  }
}

export function loadDataset(datasetPath = DEFAULT_DATASET_PATH) {
  return JSON.parse(fs.readFileSync(datasetPath, "utf8"));
}

export function validateDataset(dataset) {
  const errors = [];

  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    return ["dataset must be a JSON object"];
  }

  for (const key of Object.keys(dataset)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push(`dataset contains unsupported top-level key "${key}"`);
    }
  }
  if (!dataset.dataset_metadata || typeof dataset.dataset_metadata !== "object") {
    errors.push("dataset_metadata must be an object");
  } else {
    if (dataset.dataset_metadata.data_status !== "mock") {
      errors.push("dataset_metadata.data_status must be mock");
    }
    if (!isIsoDate(dataset.dataset_metadata.updated_at)) {
      errors.push("dataset_metadata.updated_at must be an ISO-8601 UTC timestamp");
    }
  }

  for (const entityName of ENTITY_NAMES) {
    if (!Array.isArray(dataset[entityName])) {
      errors.push(`${entityName} must be an array`);
    }
  }
  if (errors.some((error) => error.endsWith("must be an array"))) {
    return errors;
  }

  for (const entityName of ENTITY_NAMES) {
    dataset[entityName].forEach((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        errors.push(`${entityName}[${index}] must be an object`);
        return;
      }
      validateRecordShape(entityName, record, index, errors);
    });
  }
  if (errors.some((error) => error.endsWith("must be an object"))) {
    return errors;
  }

  validateUniqueIds(dataset, errors);
  validateRelationships(dataset, errors);
  validateEntityRules(dataset, errors);
  validateScenarioCoverage(dataset, errors);
  collectSensitiveStringErrors(dataset, errors);

  return errors;
}

function runCli() {
  const datasetPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_DATASET_PATH;
  let dataset;

  try {
    dataset = loadDataset(datasetPath);
  } catch (error) {
    console.error(`Dataset could not be loaded: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errors = validateDataset(dataset);
  if (errors.length > 0) {
    console.error(`Dataset validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  const totalRecords = ENTITY_NAMES.reduce(
    (total, entityName) => total + dataset[entityName].length,
    0,
  );
  console.log(
    `Dataset validation passed: ${totalRecords} records across ${ENTITY_NAMES.length} entities.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli();
}
