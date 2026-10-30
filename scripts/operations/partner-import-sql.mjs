import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG = 'partner-registry-2569';
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
const PRIVATE_TABLES = ['users', 'external_identity_links', 'students', 'plans',
  'advisor_assignments', 'staff_scopes', 'rounds', 'document_metadata', 'audit_events', 'plan_operations'];
const digestQuery = PRIVATE_TABLES.map(table => `SELECT '${table}' AS name, count(*) AS rows,
  md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t`).join('\nUNION ALL\n');

export function buildImportSql(payload) {
  if (payload.catalog_key !== CATALOG || !Array.isArray(payload.companies) || !Array.isArray(payload.positions)) {
    throw new Error('Invalid catalogue payload.');
  }
  // Explicitly reviewed history: unknown migrations must still fail closed.
  // Only migration 003 is executed by this importer; later entries verify history.
  const migrations = [
    '001_initial_schema.sql',
    '002_v3_identity_student_plan_assignment_audit.sql',
    '003_partner_directory.sql',
    '004_three_role_workflow.sql',
    '005_submission_snapshots.sql',
    '006_advisor_display_name.sql',
    '007_submission_policy_integrity.sql',
    '008_returned_plan_cancellation.sql',
  ]
    .map(name => ({ name, sql: fs.readFileSync(path.join(ROOT, 'src/db/migrations', name), 'utf8') }))
    .map(item => ({ ...item, hash: crypto.createHash('sha256').update(item.sql).digest('hex') }));
  const expected = migrations.map(m => '(' + quote(m.name) + ',' + quote(m.hash) + ')').join(',');
  return `\\set ON_ERROR_STOP on
-- Default is a dry run. Use psql -v apply=true only after reviewing the report.
\\if :{?apply}
\\else
\\set apply false
\\endif
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(563003056);
SELECT pg_advisory_xact_lock(129);
CREATE TEMP TABLE expected_migrations(version text,checksum text) ON COMMIT DROP;
INSERT INTO expected_migrations VALUES ${expected};
DO $guard$
BEGIN
  IF current_database() <> 'coed' AND current_setting('coed.allow_local_import', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Wrong database target';
  END IF;
  IF EXISTS (SELECT 1 FROM schema_migrations m LEFT JOIN expected_migrations e USING(version)
    WHERE e.checksum IS DISTINCT FROM m.checksum)
    OR (SELECT count(*) FROM schema_migrations WHERE version IN
      ('001_initial_schema.sql','002_v3_identity_student_plan_assignment_audit.sql')) <> 2 THEN
    RAISE EXCEPTION 'Migration history differs from reviewed source';
  END IF;
END $guard$;
${migrations[2].sql}
INSERT INTO schema_migrations(version,checksum) VALUES ('003_partner_directory.sql',${quote(migrations[2].hash)}) ON CONFLICT DO NOTHING;
CREATE TEMP TABLE import_payload ON COMMIT DROP AS SELECT ${quote(JSON.stringify(payload))}::jsonb AS body;
CREATE TEMP TABLE private_baseline ON COMMIT DROP AS ${digestQuery};
CREATE TEMP TABLE import_companies ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset((SELECT body->'companies' FROM import_payload))
  AS c(id uuid,code text,name text,address text,location text,logo text,source text,data_status text,updated_at timestamptz);
CREATE TEMP TABLE import_positions ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset((SELECT body->'positions' FROM import_payload))
  AS p(id uuid,company_id uuid,title text,announcement_ref text,quota text,duration text,
    academic_year integer,source text,data_status text,updated_at timestamptz);
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM import_companies i JOIN companies c ON c.id=i.id OR c.directory_code=i.code
    WHERE c.catalog_key IS DISTINCT FROM '${CATALOG}' OR c.id<>i.id OR c.directory_code IS DISTINCT FROM i.code)
    OR EXISTS (SELECT 1 FROM import_positions i JOIN positions p ON p.id=i.id
      WHERE p.source <> '${CATALOG}' OR p.company_id<>i.company_id
        OR p.announcement_ref IS DISTINCT FROM i.announcement_ref) THEN
    RAISE EXCEPTION 'Existing record collision; no records committed';
  END IF;
END $guard$;
INSERT INTO companies(id,directory_code,name,address,location,logo_path,source,visibility,data_status,updated_at,catalog_key)
SELECT id,code,name,address,location,logo,source,'public',data_status,updated_at,'${CATALOG}' FROM import_companies
ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,location=excluded.location,
  logo_path=excluded.logo_path,updated_at=excluded.updated_at
WHERE (companies.name,companies.address,companies.location,companies.logo_path) IS DISTINCT FROM
      (excluded.name,excluded.address,excluded.location,excluded.logo_path);
INSERT INTO positions(id,company_id,title,announcement_ref,quota_text,duration_text,academic_year,source,visibility,data_status,updated_at)
SELECT id,company_id,title,announcement_ref,quota,duration,academic_year,source,'public',data_status,updated_at FROM import_positions
ON CONFLICT(id) DO UPDATE SET title=excluded.title,quota_text=excluded.quota_text,
  duration_text=excluded.duration_text,updated_at=excluded.updated_at
WHERE (positions.title,positions.quota_text,positions.duration_text) IS DISTINCT FROM
      (excluded.title,excluded.quota_text,excluded.duration_text);
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM private_baseline b JOIN (${digestQuery}) a USING(name)
    WHERE (a.rows,a.digest) IS DISTINCT FROM (b.rows,b.digest)) THEN RAISE EXCEPTION 'Private records changed'; END IF;
  IF EXISTS (SELECT 1 FROM import_companies i LEFT JOIN companies c USING(id) WHERE c.id IS NULL)
    OR EXISTS (SELECT 1 FROM import_positions i LEFT JOIN positions p USING(id) WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Import count mismatch';
  END IF;
END $guard$;
SELECT (SELECT count(*) FROM import_companies) AS companies,
  (SELECT count(*) FROM import_positions) AS positions, 'private records unchanged' AS verification;
\\if :apply
COMMIT;
\\else
ROLLBACK;
\\endif
`;
}
