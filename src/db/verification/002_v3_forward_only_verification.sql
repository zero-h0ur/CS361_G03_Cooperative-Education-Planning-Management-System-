-- Read-only verification for Issue #56 / migration 002.
-- Run after deployment with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/verification/002_v3_forward_only_verification.sql
-- Every query returns only aggregate metadata/counts; no private field values.

SELECT
    'migration checksum recorded' AS check_name,
    COUNT(*) = 1 AS passed,
    COUNT(*) AS observed
FROM schema_migrations
WHERE version = '002_v3_identity_student_plan_assignment_audit.sql'
  AND checksum ~ '^[0-9a-f]{64}$';

SELECT
    'btree_gist installed' AS check_name,
    COUNT(*) = 1 AS passed,
    COUNT(*) AS observed
FROM pg_extension
WHERE extname = 'btree_gist';

WITH required(name) AS (
    VALUES
        ('users'),
        ('external_identity_links'),
        ('students'),
        ('plans'),
        ('advisor_assignments'),
        ('staff_scopes'),
        ('plan_operations'),
        ('audit_events')
)
SELECT
    'required tables present' AS check_name,
    COUNT(*) FILTER (WHERE to_regclass(name) IS NOT NULL) = COUNT(*) AS passed,
    COUNT(*) FILTER (WHERE to_regclass(name) IS NULL) AS observed
FROM required;

WITH required(name) AS (
    VALUES
        ('uq_external_identity_links_identity'),
        ('uq_students_user'),
        ('fk_plans_cycle'),
        ('fk_plans_position_company'),
        ('chk_plans_v3_cycle_required'),
        ('ex_advisor_assignment_no_overlap'),
        ('chk_advisor_assignments_revoked'),
        ('chk_staff_scopes_status')
)
SELECT
    'required constraints present' AS check_name,
    COUNT(*) FILTER (WHERE constraint_oid IS NOT NULL) = COUNT(*) AS passed,
    COUNT(*) FILTER (WHERE constraint_oid IS NULL) AS observed
FROM (
    SELECT required.name, pg_constraint.oid AS constraint_oid
    FROM required
    LEFT JOIN pg_constraint
      ON pg_constraint.conname = required.name
     AND pg_constraint.connamespace = (
         SELECT oid FROM pg_namespace WHERE nspname = current_schema()
     )
) checked;

SELECT
    'legacy plan backfill valid' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM plans
WHERE legacy_compatibility
  AND (
      status <> 'DRAFT'
      OR version <> 1
      OR (round_id IS NOT NULL AND cycle_id IS DISTINCT FROM round_id)
  );

SELECT
    'identity and Student references valid' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM (
    SELECT identity.id
    FROM external_identity_links identity
    LEFT JOIN users ON users.id = identity.user_id
    WHERE users.id IS NULL
    UNION ALL
    SELECT students.id
    FROM students
    LEFT JOIN users ON users.id = students.user_id
    WHERE students.user_id IS NOT NULL AND users.id IS NULL
) invalid;

SELECT
    'Plan references valid' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM plans
LEFT JOIN students ON students.id = plans.student_id
LEFT JOIN rounds ON rounds.id = plans.cycle_id
LEFT JOIN companies ON companies.id = plans.company_id
LEFT JOIN positions
  ON positions.id = plans.position_id
 AND positions.company_id = plans.company_id
WHERE students.id IS NULL
   OR (plans.cycle_id IS NOT NULL AND rounds.id IS NULL)
   OR (plans.company_id IS NOT NULL AND companies.id IS NULL)
   OR (plans.position_id IS NOT NULL AND positions.id IS NULL);

SELECT
    'Plan state and version valid' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM plans
WHERE version < 1
   OR status NOT IN (
       'DRAFT', 'SUBMITTED', 'UNDER_REVIEW',
       'NEEDS_REVISION', 'APPROVED', 'CANCELLED'
   )
   OR (
       status NOT IN ('DRAFT', 'CANCELLED')
       AND (cycle_id IS NULL OR company_id IS NULL OR position_id IS NULL)
   );

SELECT
    'non-cancelled Plan cardinality valid' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM (
    SELECT student_id, cycle_id
    FROM plans
    WHERE status <> 'CANCELLED' AND cycle_id IS NOT NULL
    GROUP BY student_id, cycle_id
    HAVING COUNT(*) > 1
) duplicates;

SELECT
    'active identity cardinality valid' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM (
    SELECT user_id
    FROM external_identity_links
    WHERE status = 'ACTIVE'
    GROUP BY user_id
    HAVING COUNT(*) > 1
) duplicates;

SELECT
    'active Advisor periods do not overlap' AS check_name,
    COUNT(*) = 0 AS passed,
    COUNT(*) AS observed
FROM advisor_assignments first_assignment
JOIN advisor_assignments second_assignment
  ON second_assignment.student_id = first_assignment.student_id
 AND second_assignment.id > first_assignment.id
 AND second_assignment.status = 'ACTIVE'
 AND first_assignment.status = 'ACTIVE'
 AND tstzrange(
       first_assignment.effective_from,
       first_assignment.effective_to,
       '[)'
     ) && tstzrange(
       second_assignment.effective_from,
       second_assignment.effective_to,
       '[)'
     );

SELECT
    'required protection triggers enabled' AS check_name,
    COUNT(*) = 7 AS passed,
    COUNT(*) AS observed
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgenabled <> 'D'
  AND tgrelid IN (
      'users'::regclass,
      'students'::regclass,
      'plans'::regclass,
      'audit_events'::regclass,
      'plan_operations'::regclass,
      'advisor_assignments'::regclass
  )
  AND tgname IN (
      'trg_students_user_role',
      'trg_users_student_role',
      'trg_plans_legacy_compatibility_guard',
      'trg_plans_no_delete',
      'trg_audit_events_immutable',
      'trg_plan_operations_immutable',
      'trg_advisor_assignments_no_delete'
  );
