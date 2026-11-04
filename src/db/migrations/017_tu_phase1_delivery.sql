-- Forward-only LOCAL workspace013 extension. Not an external013/015 repair.
-- Historical migration bytes and existing immutable submissions remain intact.
DO $$ BEGIN
  IF to_regclass('coordinator_round_schedules') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='phase1_reviews' AND column_name='state') THEN
    RAISE EXCEPTION 'Workspace review schema required; inspect external lineage before upgrade';
  END IF;
END $$;

CREATE TABLE phase1_submission_deliveries (
  submission_id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES phase1_applications(id),
  application_version INTEGER NOT NULL CHECK(application_version>0),
  cohort_id UUID NOT NULL REFERENCES selection_cohorts(id),
  coordinator_id_at_send UUID NOT NULL REFERENCES users(id),
  department TEXT NOT NULL,
  program TEXT NOT NULL,
  snapshot_checksum CHAR(64) NOT NULL CHECK(snapshot_checksum ~ '^[a-f0-9]{64}$'),
  provenance TEXT NOT NULL DEFAULT 'SUBMIT' CHECK(provenance IN ('SUBMIT','VERIFIED_EXISTING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(submission_id,application_id) REFERENCES phase1_submissions(id,application_id),
  UNIQUE(application_id,application_version)
);

CREATE FUNCTION guard_phase1_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s phase1_submissions; a phase1_applications; c selection_cohorts;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Delivery receipts are immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id AND application_id=NEW.application_id;
  SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id;
  SELECT * INTO c FROM selection_cohorts WHERE id=NEW.cohort_id FOR SHARE;
  IF s.id IS NULL OR c.id IS NULL OR c.status<>'ACTIVE' OR c.cycle_id<>a.cycle_id
    OR c.department<>NEW.department OR c.program<>NEW.program
    OR c.coordinator_id<>NEW.coordinator_id_at_send
    OR NEW.application_version<>s.application_version OR NEW.snapshot_checksum<>s.checksum
    OR s.snapshot->'official'->>'department' IS DISTINCT FROM NEW.department
    OR s.snapshot->'official'->>'program' IS DISTINCT FROM NEW.program
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
    -- Only the table owner may perform a separately reviewed legacy backfill.
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='phase1_submission_deliveries'::regclass
      AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
      OR s.snapshot->'official'->>'department' IS DISTINCT FROM c.department
      OR s.snapshot->'official'->>'program' IS DISTINCT FROM c.program
    THEN RAISE EXCEPTION 'Verified owner-operated backfill required' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase1_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_submission_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_phase1_delivery();

CREATE FUNCTION require_phase1_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='SUBMITTED' AND NOT EXISTS (
    SELECT 1 FROM phase1_submission_deliveries d WHERE d.application_id=NEW.id AND d.application_version=NEW.version
  ) THEN RAISE EXCEPTION 'Committed submission requires a delivery receipt' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER phase1_delivery_required AFTER INSERT OR UPDATE ON phase1_applications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_phase1_delivery();

CREATE TABLE tu_identity_link_events (
  operation_id UUID PRIMARY KEY,
  operator_id UUID NOT NULL REFERENCES users(id),
  user_id UUID NOT NULL REFERENCES users(id),
  student_id UUID NOT NULL REFERENCES students(id),
  old_link_id UUID NOT NULL REFERENCES external_identity_links(id),
  new_link_id UUID NOT NULL REFERENCES external_identity_links(id),
  request_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER tu_identity_events_immutable BEFORE UPDATE OR DELETE ON tu_identity_link_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();

-- Retire any earlier request-time SECURITY DEFINER provisioning backdoor, if
-- installed manually. Retain its definition for operator inspection, not use.
DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='upsert_tu_student_identity' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coed_app') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM coed_app',f);
    END IF;
  END LOOP;
END $$;


-- Scope follows the delivered immutable submission, never a later profile edit.
CREATE OR REPLACE FUNCTION guard_phase1_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a phase1_applications; c selection_cohorts; s phase1_submissions;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reviews are retained' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id FOR UPDATE;
  SELECT * INTO c FROM selection_cohorts WHERE id=NEW.cohort_id AND status='ACTIVE';
  SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id AND application_id=a.id;
  IF c.id IS NULL OR s.id IS NULL OR c.cycle_id<>a.cycle_id OR NOT EXISTS(
    SELECT 1 FROM phase1_submissions ps LEFT JOIN phase1_submission_deliveries d ON d.submission_id=ps.id
    WHERE ps.id=s.id AND ((d.submission_id IS NOT NULL AND d.cohort_id=c.id AND d.department=c.department AND d.program=c.program)
      OR (d.submission_id IS NULL AND ps.snapshot->'official'->>'department'=c.department AND ps.snapshot->'official'->>'program'=c.program)))
    THEN RAISE EXCEPTION 'Review scope mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.state NOT IN ('RETURNED','FORWARDED') THEN
      RAISE EXCEPTION 'Invalid initial review' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.application_id<>OLD.application_id OR NEW.cohort_id<>OLD.cohort_id OR NEW.version<>OLD.version+1 OR OLD.state='FORWARDED' THEN
      RAISE EXCEPTION 'Review changed or already forwarded' USING ERRCODE='23514'; END IF;
    IF OLD.state='RETURNED' AND NEW.state='PENDING' AND NEW.submission_id<>OLD.submission_id
      AND s.application_version=a.version+1 AND a.status='NEEDS_REVISION'
      AND EXISTS(SELECT 1 FROM students st JOIN users u ON u.id=st.user_id
        WHERE st.id=a.student_id AND u.id=NEW.actor_id AND u.role='STUDENT' AND u.account_status='ACTIVE') THEN RETURN NEW; END IF;
    IF OLD.state<>'PENDING' OR NEW.submission_id<>OLD.submission_id THEN
      RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF a.status<>'SUBMITTED' OR NEW.state NOT IN ('RETURNED','FORWARDED') OR s.application_version<>a.version
    OR NEW.actor_id<>c.coordinator_id OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='COORDINATOR' AND account_status='ACTIVE') THEN
    RAISE EXCEPTION 'Current submission and assigned Coordinator required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
