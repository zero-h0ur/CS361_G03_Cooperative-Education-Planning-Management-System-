-- Upgrade-only observed current schema, NOT reconstructed migration014/015.
-- Run ONLY through present-schema-upgrade.mjs with its exact catalog/history gate.
-- No historic rows, identities or snapshots are changed or backfilled.
DO $$ BEGIN
  IF current_setting('coed.present_upgrade_profile',true) IS DISTINCT FROM 'observed-coed-20261104'
    OR to_regclass('phase1_submission_deliveries') IS NOT NULL
    OR to_regclass('tu_identity_link_events') IS NOT NULL THEN
    RAISE EXCEPTION 'OBSERVED_UPGRADE_GATE_REQUIRED';
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


-- Repair the actual status/state routine mismatch, preserving version/return rules.
CREATE OR REPLACE FUNCTION guard_phase1_application() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Applications must start as version-one Drafts' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Applications are retained' USING ERRCODE='55000'; END IF;
  IF NEW.id<>OLD.id OR NEW.student_id<>OLD.student_id OR NEW.cycle_id<>OLD.cycle_id OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Application identity/version mismatch' USING ERRCODE='23514'; END IF;
  IF OLD.status='SUBMITTED' THEN
    IF NEW.status<>'NEEDS_REVISION' OR NEW.payload IS DISTINCT FROM OLD.payload OR NOT EXISTS(
      SELECT 1 FROM phase1_reviews r JOIN phase1_submissions s ON s.id=r.submission_id
      WHERE r.application_id=OLD.id AND r.state='RETURNED' AND s.application_version=OLD.version) THEN
      RAISE EXCEPTION 'Submitted content requires an explicit return' USING ERRCODE='55000'; END IF;
  ELSIF OLD.status='NEEDS_REVISION' AND NEW.status NOT IN ('NEEDS_REVISION','SUBMITTED') THEN
    RAISE EXCEPTION 'Invalid correction transition' USING ERRCODE='23514';
  ELSIF OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','SUBMITTED') THEN
    RAISE EXCEPTION 'Invalid Draft transition' USING ERRCODE='23514';
  END IF;
  IF NEW.status='NEEDS_REVISION' AND NOT EXISTS(SELECT 1 FROM phase1_reviews WHERE application_id=NEW.id AND state='RETURNED') THEN
    RAISE EXCEPTION 'Active return required' USING ERRCODE='23514'; END IF;
  IF NEW.status='SUBMITTED' AND NOT EXISTS(SELECT 1 FROM phase1_submissions WHERE application_id=NEW.id AND application_version=NEW.version) THEN
    RAISE EXCEPTION 'Submission snapshot required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_phase1_attachment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE app UUID;
BEGIN
  app:=CASE WHEN TG_OP='DELETE' THEN OLD.application_id ELSE NEW.application_id END;
  IF TG_OP='UPDATE' AND (NEW.application_id<>OLD.application_id OR NEW.kind<>OLD.kind) THEN
    RAISE EXCEPTION 'Attachment cannot move applications' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM phase1_applications a WHERE a.id=app AND (a.status='DRAFT' OR
    (a.status='NEEDS_REVISION' AND EXISTS(SELECT 1 FROM phase1_reviews r WHERE r.application_id=a.id AND r.state='RETURNED'))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted attachments are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
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

-- Retain the retired definition for audit; remove only its reviewed execution capability.
REVOKE ALL ON FUNCTION upsert_tu_student_identity(text,text,text,text,text,text,text,text,text) FROM PUBLIC,coed_app;
