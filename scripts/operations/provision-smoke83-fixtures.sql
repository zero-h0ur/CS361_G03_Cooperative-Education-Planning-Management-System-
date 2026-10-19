-- Owner-authorized isolated #83 fixtures. The wrapper substitutes only a validated
-- synthetic UUID into the placeholder in memory; do not store the rendered SQL.
-- Existing users, scopes, assignments, rounds and demo plans are never updated.
\set ON_ERROR_STOP on
\set VERBOSITY sqlstate
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;
SET LOCAL coed.smoke83.advisor_sub = '__ADVISOR_SUB__';
SELECT pg_advisory_xact_lock(hashtextextended('coed-smoke83-fixtures-v1', 0));

DO $fixture$
DECLARE
  marker CONSTANT text := 'coed-v3-smoke83-v1';
  issuer CONSTANT text := 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_WzzG10dCP';
  subject text := current_setting('coed.smoke83.advisor_sub');
  wanted_advisor CONSTANT uuid := '83000000-0000-4000-8000-000000000001';
  link_id CONSTANT uuid := '83000000-0000-4000-8000-000000000002';
  cycle_id CONSTANT uuid := '83000000-0000-4000-8000-000000000090';
  user_ids uuid[] := ARRAY[
    '83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000011',
    '83000000-0000-4000-8000-000000000021','83000000-0000-4000-8000-000000000031',
    '83000000-0000-4000-8000-000000000041']::uuid[];
  student_ids uuid[] := ARRAY[
    '83000000-0000-4000-8000-000000000012','83000000-0000-4000-8000-000000000022',
    '83000000-0000-4000-8000-000000000032','83000000-0000-4000-8000-000000000042']::uuid[];
  plan_ids uuid[] := ARRAY[
    '83000000-0000-4000-8000-000000000013','83000000-0000-4000-8000-000000000023',
    '83000000-0000-4000-8000-000000000033','83000000-0000-4000-8000-000000000043']::uuid[];
  assignment_ids uuid[] := ARRAY[
    '83000000-0000-4000-8000-000000000014','83000000-0000-4000-8000-000000000024',
    '83000000-0000-4000-8000-000000000034']::uuid[];
  all_ids uuid[];
  baseline jsonb := '{}'::jsonb;
  after_state jsonb := '{}'::jsonb;
  fingerprint text;
  guard record;
  actor uuid;
  correlation uuid := gen_random_uuid();
  existing_user users%ROWTYPE;
  existing_student students%ROWTYPE;
  existing_plan plans%ROWTYPE;
  existing_assignment advisor_assignments%ROWTYPE;
  expected_role text;
  expected_department text;
  expected_program text;
  expected_status text;
  student_number_value text;
  chosen_company uuid;
  chosen_position uuid;
  slot integer;
BEGIN
  IF current_database() <> 'coed' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE='P8301', MESSAGE='SMOKE83 wrong database/operator';
  END IF;
  IF subject !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='P8302', MESSAGE='SMOKE83 invalid subject';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations
      WHERE version='002_v3_identity_student_plan_assignment_audit.sql'
      AND checksum='abf94231966248045543d736e3ab745359693c93f082317990489902e1e7484c') THEN
    RAISE EXCEPTION USING ERRCODE='P8303', MESSAGE='SMOKE83 migration mismatch';
  END IF;
  SELECT u.id INTO actor FROM users u WHERE u.role='SYSTEM' AND u.account_status='ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM external_identity_links e WHERE e.user_id=u.id)
    ORDER BY u.id LIMIT 1;
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P8303', MESSAGE='SMOKE83 existing non-login SYSTEM actor required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students s JOIN users u ON u.id=s.user_id
      WHERE s.student_number='TESTPR730001' AND s.visibility='private' AND s.data_status='mock'
      AND s.department='CPE' AND s.program='ISNE' AND s.academic_year=2569
      AND u.role='STUDENT' AND u.account_status='ACTIVE')
      OR NOT EXISTS (SELECT 1 FROM staff_scopes ss JOIN users u ON u.id=ss.staff_id
      WHERE ss.department='CPE' AND ss.program='ISNE' AND ss.academic_year=2569
      AND ss.status='ACTIVE' AND u.role='STAFF' AND u.account_status='ACTIVE')
      OR EXISTS (SELECT 1 FROM staff_scopes WHERE department='SMOKE83_OUTSIDE' AND status='ACTIVE') THEN
    RAISE EXCEPTION USING ERRCODE='P8304', MESSAGE='SMOKE83 expected existing test partition/scope mismatch';
  END IF;

  all_ids := user_ids || student_ids || plan_ids || assignment_ids || ARRAY[link_id,cycle_id];
  -- Compare complete row fingerprints outside the exact reserved fixture IDs.
  -- Values remain in this transaction; only the final boolean summary is output.
  FOR guard IN SELECT * FROM (VALUES
    ('users','id','id',user_ids), ('students','id','id',student_ids),
    ('plans','id','id',plan_ids), ('rounds','id','id',ARRAY[cycle_id]),
    ('external_identity_links','id','id',ARRAY[link_id]),
    ('advisor_assignments','id','id',assignment_ids), ('staff_scopes','id','id',ARRAY[]::uuid[]),
    ('audit_events','event_id','resource_id',all_ids), ('plan_operations','operation_id','plan_id',plan_ids),
    ('companies','id','id',ARRAY[]::uuid[]), ('positions','id','id',ARRAY[]::uuid[])
  ) AS v(table_name,key_column,filter_column,excluded_ids) LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.%I)::text,''[]'')) FROM %I x WHERE NOT (x.%I = ANY($1))',
      guard.key_column,guard.table_name,guard.filter_column) INTO fingerprint USING guard.excluded_ids;
    baseline := baseline || jsonb_build_object(guard.table_name,fingerprint);
  END LOOP;

  FOR slot IN 1..5 LOOP
    expected_role := CASE WHEN slot=1 THEN 'ADVISOR' ELSE 'STUDENT' END;
    SELECT * INTO existing_user FROM users WHERE id=user_ids[slot];
    IF FOUND THEN
      IF existing_user.role<>expected_role OR existing_user.account_status<>'ACTIVE'
          OR NOT EXISTS (SELECT 1 FROM audit_events WHERE resource_type='USER'
          AND resource_id=user_ids[slot] AND action='USER_PROVISIONED' AND notes=marker) THEN
        RAISE EXCEPTION USING ERRCODE='P8305', MESSAGE='SMOKE83 user ID collision or role/status mismatch';
      END IF;
    ELSE
      INSERT INTO users(id,role,account_status) VALUES(user_ids[slot],expected_role,'ACTIVE');
      INSERT INTO audit_events(event_id,actor_id,actor_role,action,resource_type,resource_id,notes,correlation_id)
        VALUES(gen_random_uuid(),actor,'SYSTEM','USER_PROVISIONED','USER',user_ids[slot],marker,correlation);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM students WHERE user_id=wanted_advisor)
      OR EXISTS (SELECT 1 FROM external_identity_links WHERE user_id=wanted_advisor AND id<>link_id)
      OR EXISTS (SELECT 1 FROM external_identity_links WHERE external_issuer=issuer
        AND external_subject=subject AND id<>link_id) THEN
    RAISE EXCEPTION USING ERRCODE='P8306', MESSAGE='SMOKE83 unexpected existing identity binding';
  END IF;
  IF EXISTS (SELECT 1 FROM external_identity_links WHERE id=link_id) THEN
    IF NOT EXISTS (SELECT 1 FROM external_identity_links WHERE id=link_id AND user_id=wanted_advisor
        AND external_issuer=issuer AND external_subject=subject AND status='ACTIVE') THEN
      RAISE EXCEPTION USING ERRCODE='P8306', MESSAGE='SMOKE83 identity collision or inactive binding';
    END IF;
  ELSE
    INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject,status)
      VALUES(link_id,wanted_advisor,issuer,subject,'ACTIVE');
    INSERT INTO audit_events(event_id,actor_id,actor_role,action,resource_type,resource_id,notes,correlation_id)
      VALUES(gen_random_uuid(),actor,'SYSTEM','IDENTITY_LINK_CREATED','EXTERNAL_IDENTITY_LINK',link_id,marker,correlation);
  END IF;

  IF EXISTS (SELECT 1 FROM rounds WHERE id=cycle_id) THEN
    IF NOT EXISTS (SELECT 1 FROM rounds WHERE id=cycle_id AND source=marker AND visibility='public'
        AND data_status='mock' AND academic_year=2569 AND semester=1 AND status='OPEN'
        AND name='Security Smoke 83 - synthetic test only' AND end_date>CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION USING ERRCODE='P8307', MESSAGE='SMOKE83 cycle collision/closed/expired; no renewal allowed';
    END IF;
  ELSE
    INSERT INTO rounds(id,name,academic_year,semester,status,end_date,source,visibility,data_status)
      VALUES(cycle_id,'Security Smoke 83 - synthetic test only',2569,1,'OPEN',
        CURRENT_TIMESTAMP+interval '7 days',marker,'public','mock');
    INSERT INTO audit_events(event_id,actor_id,actor_role,action,resource_type,resource_id,notes,correlation_id)
      VALUES(gen_random_uuid(),actor,'SYSTEM','SMOKE83_FIXTURE_CREATED','ROUND',cycle_id,marker,correlation);
  END IF;
  SELECT p.company_id,p.id INTO chosen_company,chosen_position FROM positions p
    JOIN companies c ON c.id=p.company_id WHERE p.visibility='public' AND c.visibility='public'
      AND p.data_status='mock' AND c.data_status='mock' ORDER BY p.id LIMIT 1;
  IF chosen_position IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P8307', MESSAGE='SMOKE83 public mock Company/Position pair required';
  END IF;

  FOR slot IN 1..4 LOOP
    expected_department := CASE WHEN slot=4 THEN 'SMOKE83_OUTSIDE' ELSE 'CPE' END;
    expected_program := CASE WHEN slot=4 THEN 'SMOKE83_OUTSIDE' ELSE 'ISNE' END;
    expected_status := (ARRAY['DRAFT','SUBMITTED','UNDER_REVIEW','DRAFT'])[slot];
    student_number_value := 'SMOKE83'||lpad(slot::text,4,'0');
    IF EXISTS (SELECT 1 FROM external_identity_links WHERE user_id=user_ids[slot+1]) THEN
      RAISE EXCEPTION USING ERRCODE='P8308', MESSAGE='SMOKE83 fixture Student must not become a login identity';
    END IF;
    SELECT * INTO existing_student FROM students WHERE id=student_ids[slot];
    IF FOUND THEN
      IF existing_student.source<>marker OR existing_student.user_id IS DISTINCT FROM user_ids[slot+1]
          OR existing_student.student_number IS DISTINCT FROM student_number_value
          OR existing_student.department IS DISTINCT FROM expected_department
          OR existing_student.program IS DISTINCT FROM expected_program
          OR existing_student.academic_year IS DISTINCT FROM 2569
          OR existing_student.visibility<>'private' OR existing_student.data_status<>'mock'
          OR existing_student.enrollment_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION USING ERRCODE='P8308', MESSAGE='SMOKE83 Student collision or partition mismatch';
      END IF;
    ELSE
      INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,preferred_name,
        institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES(student_ids[slot],user_ids[slot+1],'SMOKE83-SYNTHETIC-'||slot,student_number_value,
        'Smoke83 Synthetic Student '||slot,'Smoke83 Test '||slot,
        'smoke83-'||slot||'@student.example.com',expected_department,expected_program,'TEST',2569,'ACTIVE',marker,'private','mock');
      INSERT INTO audit_events(event_id,actor_id,actor_role,action,resource_type,resource_id,notes,correlation_id)
        VALUES(gen_random_uuid(),actor,'SYSTEM','SMOKE83_FIXTURE_CREATED','STUDENT',student_ids[slot],marker,correlation);
    END IF;
    SELECT * INTO existing_plan FROM plans WHERE id=plan_ids[slot];
    IF FOUND THEN
      IF existing_plan.source<>marker OR existing_plan.student_id<>student_ids[slot]
          OR existing_plan.cycle_id IS DISTINCT FROM cycle_id OR existing_plan.legacy_compatibility
          OR existing_plan.visibility<>'private' OR existing_plan.data_status<>'mock'
          OR NOT EXISTS (SELECT 1 FROM positions p JOIN companies c ON c.id=p.company_id
            WHERE p.id=existing_plan.position_id AND c.id=existing_plan.company_id
            AND p.visibility='public' AND c.visibility='public' AND p.data_status='mock' AND c.data_status='mock') THEN
        RAISE EXCEPTION USING ERRCODE='P8309', MESSAGE='SMOKE83 Plan collision/reference mismatch';
      END IF;
      -- Never reset a fixture Plan's current state/content/version on a rerun.
    ELSE
      INSERT INTO plans(id,student_id,round_id,cycle_id,company_id,position_id,notes,status,
        version,legacy_compatibility,source,visibility,data_status)
      VALUES(plan_ids[slot],student_ids[slot],cycle_id,cycle_id,chosen_company,chosen_position,
        'Isolated security smoke fixture; initial state '||expected_status,expected_status,1,false,marker,'private','mock');
      INSERT INTO audit_events(event_id,plan_id,actor_id,actor_role,action,resource_type,resource_id,
        to_state,notes,correlation_id)
      VALUES(gen_random_uuid(),plan_ids[slot],actor,'SYSTEM','SMOKE83_FIXTURE_CREATED','PLAN',plan_ids[slot],
        expected_status,marker||'; seeded test state, not an executed Student/Staff transition',correlation);
    END IF;
    IF slot<=3 THEN
      SELECT * INTO existing_assignment FROM advisor_assignments WHERE id=assignment_ids[slot];
      IF FOUND THEN
        IF existing_assignment.advisor_id<>wanted_advisor OR existing_assignment.student_id<>student_ids[slot]
            OR existing_assignment.status<>'ACTIVE' OR existing_assignment.academic_year<>2569
            OR existing_assignment.semester<>1 OR existing_assignment.effective_from>CURRENT_TIMESTAMP
            OR existing_assignment.effective_to<=CURRENT_TIMESTAMP
            OR NOT EXISTS (SELECT 1 FROM audit_events WHERE resource_type='ADVISOR_ASSIGNMENT'
              AND resource_id=assignment_ids[slot] AND action='ADVISOR_ASSIGNED' AND notes=marker) THEN
          RAISE EXCEPTION USING ERRCODE='P8310', MESSAGE='SMOKE83 assignment mismatch/expired; no reactivation allowed';
        END IF;
      ELSE
        INSERT INTO advisor_assignments(id,advisor_id,student_id,academic_year,semester,status,
          effective_from,effective_to,assigned_by)
        VALUES(assignment_ids[slot],wanted_advisor,student_ids[slot],2569,1,'ACTIVE',
          CURRENT_TIMESTAMP-interval '1 minute',CURRENT_TIMESTAMP+interval '7 days',actor);
        INSERT INTO audit_events(event_id,actor_id,actor_role,action,resource_type,resource_id,notes,correlation_id)
          VALUES(gen_random_uuid(),actor,'SYSTEM','ADVISOR_ASSIGNED','ADVISOR_ASSIGNMENT',assignment_ids[slot],marker,correlation);
      END IF;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM advisor_assignments WHERE advisor_assignments.advisor_id=wanted_advisor AND status='ACTIVE')<>3
      OR EXISTS (SELECT 1 FROM advisor_assignments WHERE advisor_assignments.advisor_id=wanted_advisor
        AND NOT (id=ANY(assignment_ids)))
      OR EXISTS (SELECT 1 FROM advisor_assignments WHERE student_id=student_ids[4] AND status='ACTIVE') THEN
    RAISE EXCEPTION USING ERRCODE='P8310', MESSAGE='SMOKE83 assignment expanded outside three fixtures';
  END IF;

  FOR guard IN SELECT * FROM (VALUES
    ('users','id','id',user_ids), ('students','id','id',student_ids),
    ('plans','id','id',plan_ids), ('rounds','id','id',ARRAY[cycle_id]),
    ('external_identity_links','id','id',ARRAY[link_id]),
    ('advisor_assignments','id','id',assignment_ids), ('staff_scopes','id','id',ARRAY[]::uuid[]),
    ('audit_events','event_id','resource_id',all_ids), ('plan_operations','operation_id','plan_id',plan_ids),
    ('companies','id','id',ARRAY[]::uuid[]), ('positions','id','id',ARRAY[]::uuid[])
  ) AS v(table_name,key_column,filter_column,excluded_ids) LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.%I)::text,''[]'')) FROM %I x WHERE NOT (x.%I = ANY($1))',
      guard.key_column,guard.table_name,guard.filter_column) INTO fingerprint USING guard.excluded_ids;
    after_state := after_state || jsonb_build_object(guard.table_name,fingerprint);
  END LOOP;
  IF baseline IS DISTINCT FROM after_state THEN
    RAISE EXCEPTION USING ERRCODE='P8311', MESSAGE='SMOKE83 existing non-fixture rows changed; rollback';
  END IF;
END
$fixture$;

-- Verify/output inside the transaction; a disconnected caller may rerun safely.
SELECT json_build_object(
  'AdvisorRole','ADVISOR','IdentityStatus','ACTIVE','AssignedStudents',3,
  'PrivateFixtureStudents',4,'PrivateFixturePlans',4,'AssignmentDays',7,
  'ExistingRowsUnchanged',true,'DemoPlansTouched',false,
  'FixturePlanStates',(SELECT json_agg(json_build_object('Case',s.student_number,'State',p.status,'Version',p.version)
    ORDER BY s.student_number) FROM plans p JOIN students s ON s.id=p.student_id
    WHERE p.source='coed-v3-smoke83-v1')
)::text;
COMMIT;
