-- LOCAL REVIEW CANDIDATE ONLY. No automatic deployment or business-row backfill.
-- Preserve018/019/020. Existing canonical submissions keep contract_version1.
DO $gate$ BEGIN
 IF current_user<>'postgres'
   OR current_setting('coed.pending_intake_upgrade',true) IS DISTINCT FROM 'observed020-to021'
   OR NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='020_tu_registration_issuer_alignment.sql'
     AND checksum='3ea3a1fc31ea7a839fff1d8fb94d3d8732d26042edc9dd4a03dbc62610082790')
   OR EXISTS(SELECT 1 FROM schema_migrations WHERE version='021_phase1_pending_intake.sql')
   OR to_regclass(current_schema() || '.phase1_intake_routes') IS NOT NULL
 THEN RAISE EXCEPTION 'PENDING_INTAKE_REVIEWED_OWNER_GATE_REQUIRED'; END IF;
END $gate$;
CREATE TABLE phase1_intake_routes (
 id UUID PRIMARY KEY,
 cycle_id UUID NOT NULL REFERENCES rounds(id),
 cohort_id UUID NOT NULL REFERENCES selection_cohorts(id),
 tu_faculty TEXT NOT NULL CHECK(length(btrim(tu_faculty)) BETWEEN 1 AND 500),
 tu_department TEXT NOT NULL CHECK(length(btrim(tu_department)) BETWEEN 1 AND 500),
 program_type TEXT NOT NULL CHECK(program_type IN ('regular','special')),
 curriculum TEXT NOT NULL CHECK(curriculum IN ('61','66')),
 version INTEGER NOT NULL CHECK(version>0),active BOOLEAN NOT NULL DEFAULT true,
 source TEXT NOT NULL CHECK(length(btrim(source)) BETWEEN 1 AND 500),
 approved_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(cycle_id,tu_faculty,tu_department,program_type,curriculum,version)
);
CREATE FUNCTION guard_phase1_intake_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Intake route versions are immutable' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM selection_cohorts c JOIN users u ON u.id=c.coordinator_id
   WHERE c.id=NEW.cohort_id AND c.cycle_id=NEW.cycle_id AND c.status='ACTIVE'
     AND u.role='COORDINATOR' AND u.account_status='ACTIVE')
   OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.approved_by AND role IN ('ADMIN','COORDINATOR') AND account_status='ACTIVE')
 THEN RAISE EXCEPTION 'Approved intake destination required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(NEW.cycle_id,NEW.tu_faculty,NEW.tu_department,NEW.program_type,NEW.curriculum)::text,0));
 IF NEW.version<>(SELECT COALESCE(max(version),0)+1 FROM phase1_intake_routes WHERE cycle_id=NEW.cycle_id
   AND tu_faculty=NEW.tu_faculty AND tu_department=NEW.tu_department AND program_type=NEW.program_type AND curriculum=NEW.curriculum)
 THEN RAISE EXCEPTION 'Intake route version must advance once' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_intake_route_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_intake_routes
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_intake_route();
REVOKE ALL ON phase1_intake_routes FROM PUBLIC,coed_app;
GRANT SELECT ON phase1_intake_routes TO coed_app;
-- Observed production lacks the lock-only grant in the checked-in runtime ACL.
-- FOR SHARE requires UPDATE on one column; never grant assignment/status writes.
GRANT UPDATE(created_at) ON selection_cohorts TO coed_app;
CREATE FUNCTION protect_phase1_cohort_lock_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='coed_app' AND NEW.created_at IS DISTINCT FROM OLD.created_at
 THEN RAISE EXCEPTION 'Cohort locking does not authorize metadata changes' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_cohort_lock_column_guard BEFORE UPDATE OF created_at ON selection_cohorts
 FOR EACH ROW EXECUTE FUNCTION protect_phase1_cohort_lock_column();

ALTER TABLE phase1_submissions ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE phase1_submissions ALTER COLUMN policy_id DROP NOT NULL;
ALTER TABLE phase1_submissions ADD CONSTRAINT phase1_submission_contract CHECK(
 (contract_version=1 AND policy_id IS NOT NULL)
 OR (contract_version=2 AND snapshot->>'contract_version'='2'
   AND snapshot->'assessment'->>'eligibility'='UNKNOWN'
   AND snapshot->'assessment'->>'review_required'='true'
   AND snapshot->'assessment'->>'source'='STUDENT_DECLARED'));
-- Explicitly reject SQL NULL/JSON missing keys, not merely a nullable CHECK.
CREATE FUNCTION guard_phase1_intake_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a phase1_applications; st students; r phase1_intake_routes; p phase1_policies; reg jsonb;
BEGIN
 IF NEW.contract_version=1 THEN RETURN NEW; END IF;
 IF NEW.contract_version IS DISTINCT FROM 2 OR NEW.snapshot->>'contract_version' IS DISTINCT FROM '2'
   OR NEW.snapshot->'assessment'->>'eligibility' IS DISTINCT FROM 'UNKNOWN'
   OR NEW.snapshot->'assessment'->>'review_required' IS DISTINCT FROM 'true'
   OR NEW.snapshot->'assessment'->>'source' IS DISTINCT FROM 'STUDENT_DECLARED'
   OR NEW.snapshot->'declared_academic'->>'source' IS DISTINCT FROM 'STUDENT_DECLARED'
 THEN RAISE EXCEPTION 'Explicit pending assessment required' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id;
 SELECT * INTO st FROM students WHERE id=a.student_id AND user_id=NEW.submitted_by;
 IF st.id IS NULL OR to_jsonb(st)->>'identity_source' IS DISTINCT FROM 'TU_ONBOARDING'
   OR NEW.snapshot->'official'->>'student_id' IS DISTINCT FROM st.id::text
   OR NEW.snapshot->'official'->>'student_number' IS DISTINCT FROM st.student_number
   OR NEW.snapshot->'official'->>'academic_verified' IS DISTINCT FROM 'false'
   OR NEW.snapshot->'official'->'department' IS DISTINCT FROM 'null'::jsonb
   OR NEW.snapshot->'official'->'program' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'Bound TU identity required' USING ERRCODE='23514'; END IF;
 -- Relation is intentionally resolved only on this new TU-specific contract.
 SELECT jsonb_build_object('identity',t.identity,'program_type',t.program_type,'entry_year',t.entry_year) INTO reg
   FROM tu_student_registrations t WHERE t.student_id=st.id AND t.user_id=st.user_id;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(jsonb_build_array(a.cycle_id,reg->'identity'->>'faculty',
   reg->'identity'->>'department',reg->>'program_type',NEW.snapshot->'payload'->>'curriculum')::text,0));
 SELECT * INTO r FROM phase1_intake_routes WHERE id::text=NEW.snapshot->'intake'->>'route_id';
 IF reg IS NULL OR r.id IS NULL OR NOT r.active OR r.cycle_id<>a.cycle_id
   OR r.tu_faculty IS DISTINCT FROM reg->'identity'->>'faculty'
   OR r.tu_department IS DISTINCT FROM reg->'identity'->>'department'
   OR r.program_type IS DISTINCT FROM reg->>'program_type'
   OR r.curriculum IS DISTINCT FROM NEW.snapshot->'payload'->>'curriculum'
   OR r.version::text IS DISTINCT FROM NEW.snapshot->'intake'->>'route_version'
   OR r.version<>(SELECT max(v.version) FROM phase1_intake_routes v WHERE v.cycle_id=r.cycle_id
      AND v.tu_faculty=r.tu_faculty AND v.tu_department=r.tu_department AND v.program_type=r.program_type AND v.curriculum=r.curriculum)
   OR NEW.snapshot->'declared_academic'->>'curriculum' IS DISTINCT FROM r.curriculum
   OR NEW.snapshot->'declared_academic'->>'major_group' IS DISTINCT FROM NEW.snapshot->'payload'->>'major_group'
   OR NEW.snapshot->'declared_academic'->>'program_type' IS DISTINCT FROM reg->>'program_type'
   OR NEW.snapshot->'declared_academic'->>'entry_year' IS DISTINCT FROM reg->>'entry_year'
   OR NEW.snapshot->'delivery'->>'cohort_id' IS DISTINCT FROM r.cohort_id::text
 THEN RAISE EXCEPTION 'Versioned intake route required' USING ERRCODE='23514'; END IF;
 IF NEW.policy_id IS NULL THEN
   IF NEW.snapshot->'policy' IS DISTINCT FROM 'null'::jsonb OR NEW.snapshot->'assessment'->'group_gpa' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'Unknown policy cannot claim calculated eligibility' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO p FROM phase1_policies WHERE id=NEW.policy_id;
   IF p.id IS NULL OR p.cycle_id<>a.cycle_id OR p.curriculum<>r.curriculum
     OR NEW.snapshot->'policy'->>'id' IS DISTINCT FROM p.id::text
     OR NEW.snapshot->'policy'->>'version' IS DISTINCT FROM p.version::text
     OR NEW.snapshot->'policy'->>'verified' IS DISTINCT FROM p.verified::text
     OR NEW.snapshot->'policy'->>'synthetic' IS DISTINCT FROM p.synthetic::text
     OR NEW.snapshot->'policy'->'data' IS DISTINCT FROM p.data
   THEN RAISE EXCEPTION 'Exact immutable policy reference required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_intake_snapshot_guard BEFORE INSERT ON phase1_submissions
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_intake_snapshot();

CREATE OR REPLACE FUNCTION guard_phase1_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s phase1_submissions; a phase1_applications; c selection_cohorts;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Delivery receipts are immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id AND application_id=NEW.application_id;
 SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id;
 SELECT * INTO c FROM selection_cohorts WHERE id=NEW.cohort_id FOR SHARE;
 IF s.id IS NULL OR c.id IS NULL OR c.status<>'ACTIVE' OR c.cycle_id<>a.cycle_id
   OR c.department<>NEW.department OR c.program<>NEW.program OR c.coordinator_id<>NEW.coordinator_id_at_send
   OR NEW.application_version<>s.application_version OR NEW.snapshot_checksum<>s.checksum
   OR (s.contract_version=1 AND (s.snapshot->'official'->>'department' IS DISTINCT FROM NEW.department
     OR s.snapshot->'official'->>'program' IS DISTINCT FROM NEW.program))
   OR (s.contract_version=2 AND (NEW.provenance IS DISTINCT FROM 'SUBMIT' OR NOT EXISTS(
     SELECT 1 FROM phase1_intake_routes rt WHERE rt.id::text=s.snapshot->'intake'->>'route_id'
       AND rt.cohort_id=c.id AND rt.cycle_id=c.cycle_id AND rt.version::text=s.snapshot->'intake'->>'route_version')))
   OR NOT EXISTS(SELECT 1 FROM users WHERE id=c.coordinator_id AND role='COORDINATOR' AND account_status='ACTIVE')
   OR NOT EXISTS(SELECT 1 FROM students WHERE id=a.student_id AND user_id=s.submitted_by)
 THEN RAISE EXCEPTION 'Delivery destination mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.provenance='SUBMIT' THEN
   IF s.snapshot->'delivery'->>'cohort_id' IS DISTINCT FROM NEW.cohort_id::text
     OR s.snapshot->'delivery'->>'department' IS DISTINCT FROM NEW.department
     OR s.snapshot->'delivery'->>'program' IS DISTINCT FROM NEW.program
     OR s.snapshot->'delivery'->>'coordinator_id' IS DISTINCT FROM NEW.coordinator_id_at_send::text
     OR s.application_version<>a.version+1 OR a.status NOT IN ('DRAFT','NEEDS_REVISION')
   THEN RAISE EXCEPTION 'Current submission and destination snapshot required' USING ERRCODE='23514'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='phase1_submission_deliveries'::regclass
     AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
     OR s.snapshot->'official'->>'department' IS DISTINCT FROM c.department
     OR s.snapshot->'official'->>'program' IS DISTINCT FROM c.program
   THEN RAISE EXCEPTION 'Verified owner-operated backfill required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
