-- ==============================================================================
-- CO-ED V4: Database Migration & Runtime Grants for RDS PostgreSQL
-- Applies: 012_committee_workspace, 013_coordinator_workspace,
--          Runtime Grants for coed_app, and TU Student Identity Function
-- Database: database-coed-postgres (ap-southeast-2)
-- Run as: RDS master / admin user (e.g. postgres)
-- ==============================================================================

\set ON_ERROR_STOP on
BEGIN;

SET LOCAL search_path = public;
SET LOCAL timezone = 'UTC';
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- ------------------------------------------------------------------------------
-- 1. Apply Migration 012: Committee Workspace
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS committee_workspaces (
  cohort_id UUID PRIMARY KEY REFERENCES selection_cohorts(id),
  version INTEGER NOT NULL CHECK(version>0),
  state JSONB NOT NULL CHECK(jsonb_typeof(state)='object')
);

CREATE TABLE IF NOT EXISTS committee_workspace_events (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  cohort_id UUID NOT NULL REFERENCES selection_cohorts(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  request_hash CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'committee_events_immutable') THEN
    CREATE TRIGGER committee_events_immutable BEFORE UPDATE OR DELETE ON committee_workspace_events
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
  END IF;
END $$;

INSERT INTO schema_migrations(version, checksum)
VALUES('012_committee_workspace.sql', 'e3a15dc2ee3cb73caee4208a3f81e3c836a0f443b7858c42b10b0d3e5aa4985d')
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. Apply Migration 013: Coordinator Workspace & Schedule
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER TABLE phase1_submissions DROP CONSTRAINT phase1_submissions_application_id_key;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE phase1_submissions ADD UNIQUE(application_id,application_version);
  EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE phase1_submissions ADD UNIQUE(id,application_id);
  EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE phase1_applications DROP CONSTRAINT phase1_applications_status_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE phase1_applications ADD CHECK(status IN ('DRAFT','SUBMITTED','NEEDS_REVISION'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

CREATE TABLE IF NOT EXISTS coordinator_round_schedules (
  cycle_id UUID PRIMARY KEY REFERENCES rounds(id),
  review_opens_at TIMESTAMPTZ NOT NULL,
  review_closes_at TIMESTAMPTZ NOT NULL CHECK(review_closes_at>review_opens_at),
  confirmation_opens_at TIMESTAMPTZ NOT NULL,
  confirmation_closes_at TIMESTAMPTZ NOT NULL CHECK(confirmation_closes_at>confirmation_opens_at),
  version INTEGER NOT NULL CHECK(version>0),
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(confirmation_opens_at>=review_closes_at)
);

CREATE TABLE IF NOT EXISTS phase1_reviews (
  application_id UUID PRIMARY KEY REFERENCES phase1_applications(id),
  submission_id UUID NOT NULL,
  cohort_id UUID NOT NULL REFERENCES selection_cohorts(id),
  state TEXT NOT NULL CHECK(state IN ('PENDING','RETURNED','FORWARDED')),
  version INTEGER NOT NULL CHECK(version>0),
  reason TEXT CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(submission_id,application_id) REFERENCES phase1_submissions(id,application_id),
  CHECK((state='RETURNED')=(reason IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS coordinator_operations (
  operation_id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'coordinator_operation_immutable') THEN
    CREATE TRIGGER coordinator_operation_immutable BEFORE UPDATE OR DELETE ON coordinator_operations
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS phase1_submission_latest ON phase1_submissions(application_id,application_version DESC);
CREATE INDEX IF NOT EXISTS phase1_reviews_cohort ON phase1_reviews(cohort_id,state,application_id);

CREATE OR REPLACE FUNCTION guard_phase1_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a phase1_applications; c selection_cohorts; s phase1_submissions;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reviews are retained' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id FOR UPDATE;
  SELECT * INTO c FROM selection_cohorts WHERE id=NEW.cohort_id AND status='ACTIVE';
  SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id AND application_id=a.id;
  IF c.id IS NULL OR s.id IS NULL OR c.cycle_id<>a.cycle_id OR NOT EXISTS(
    SELECT 1 FROM students st WHERE st.id=a.student_id AND st.department=c.department AND st.program=c.program)
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'phase1_review_guard') THEN
    CREATE TRIGGER phase1_review_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_reviews
      FOR EACH ROW EXECUTE FUNCTION guard_phase1_review();
  END IF;
END $$;

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

INSERT INTO schema_migrations(version, checksum)
VALUES('013_coordinator_workspace.sql', 'be4e870e2cf7680bb09f1dc8ee1d57e2fb25ea846f3801f9c8da7f457ffad04c')
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. Apply Runtime Grants for coed_app
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO coed_app;
GRANT SELECT ON public.selection_cohorts, public.selection_receipts, public.selection_opinions TO coed_app;
GRANT UPDATE (created_at) ON public.selection_cohorts TO coed_app;
GRANT INSERT ON public.selection_receipts, public.selection_opinions TO coed_app;
GRANT SELECT, INSERT, UPDATE ON public.committee_workspaces TO coed_app;
GRANT SELECT, INSERT ON public.committee_workspace_events TO coed_app;
GRANT SELECT ON public.schema_migrations TO coed_app;
GRANT SELECT ON TABLE
  public.companies, public.positions, public.rounds, public.document_metadata,
  public.users, public.external_identity_links, public.students, public.plans,
  public.advisor_assignments, public.staff_scopes, public.plan_operations,
  public.audit_events, public.document_policies, public.plan_submissions,
  public.placements, public.workflow_receipts, public.workflow_events TO coed_app;
GRANT INSERT, UPDATE ON public.plans TO coed_app;
GRANT UPDATE (contact_address, contact_phone, contact_email, version, updated_at) ON public.students TO coed_app;
GRANT UPDATE (updated_at) ON public.staff_scopes TO coed_app;
GRANT INSERT, UPDATE ON public.advisor_assignments, public.placements TO coed_app;
GRANT INSERT ON public.document_policies, public.plan_submissions,
  public.workflow_receipts, public.workflow_events TO coed_app;
GRANT UPDATE (updated_at) ON public.users TO coed_app;
GRANT INSERT ON public.plan_operations, public.audit_events TO coed_app;

GRANT SELECT ON public.phase1_academic_profiles, public.phase1_policies,
  public.phase1_cycle_windows, public.phase1_applications, public.phase1_uploads,
  public.phase1_documents, public.phase1_attachments, public.phase1_submissions,
  public.phase1_operations, public.phase1_events TO coed_app;
GRANT INSERT ON public.phase1_applications, public.phase1_uploads, public.phase1_documents,
  public.phase1_attachments, public.phase1_submissions, public.phase1_operations,
  public.phase1_events TO coed_app;
GRANT UPDATE(payload,status,version,submitted_at,updated_at) ON public.phase1_applications TO coed_app;
GRANT UPDATE(status) ON public.phase1_uploads TO coed_app;
GRANT UPDATE(document_id) ON public.phase1_attachments TO coed_app;

GRANT SELECT, INSERT ON public.phase1_reviews, public.coordinator_round_schedules, public.coordinator_operations TO coed_app;
GRANT UPDATE(submission_id,state,version,reason,actor_id,updated_at) ON public.phase1_reviews TO coed_app;
GRANT UPDATE(review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by,updated_at)
  ON public.coordinator_round_schedules TO coed_app;
GRANT INSERT ON public.phase1_cycle_windows TO coed_app;
GRANT UPDATE(opens_at,closes_at,version) ON public.phase1_cycle_windows TO coed_app;

-- ------------------------------------------------------------------------------
-- 4. Secure TU Student Identity Upsert Function (SECURITY DEFINER)
-- Allows coed_app to safely provision real TU students upon authenticated login
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upsert_tu_student_identity(
  p_student_number TEXT,
  p_full_name TEXT,
  p_preferred_name TEXT,
  p_institutional_email TEXT,
  p_department TEXT,
  p_program TEXT,
  p_academic_year INTEGER,
  p_enrollment_status TEXT,
  p_issuer TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_student_id UUID;
  v_student students%ROWTYPE;
BEGIN
  -- 1. Check existing student or user
  SELECT s.user_id, s.id INTO v_user_id, v_student_id
  FROM students s
  WHERE s.student_number = p_student_number;

  IF v_user_id IS NULL THEN
    SELECT user_id INTO v_user_id
    FROM external_identity_links
    WHERE external_issuer = p_issuer AND external_subject = p_student_number;
  END IF;

  IF v_user_id IS NULL THEN
    INSERT INTO users (id, role, account_status)
    VALUES (gen_random_uuid(), 'STUDENT', 'ACTIVE')
    RETURNING id INTO v_user_id;
  END IF;

  -- 2. Upsert external identity link
  INSERT INTO external_identity_links (id, user_id, external_issuer, external_subject, status)
  VALUES (gen_random_uuid(), v_user_id, p_issuer, p_student_number, 'ACTIVE')
  ON CONFLICT (external_issuer, external_subject)
  DO UPDATE SET status = 'ACTIVE', user_id = v_user_id;

  -- 3. Upsert student record
  IF v_student_id IS NULL THEN
    INSERT INTO students (
      id, user_id, anonymous_ref, student_number, full_name, preferred_name,
      institutional_email, department, program, major, academic_year, enrollment_status
    ) VALUES (
      gen_random_uuid(), v_user_id, 'anon-tu-' || p_student_number, p_student_number,
      p_full_name, p_preferred_name, p_institutional_email, p_department, p_program,
      p_department, p_academic_year, p_enrollment_status
    ) RETURNING * INTO v_student;
    v_student_id := v_student.id;
  ELSE
    UPDATE students SET
      user_id = v_user_id,
      full_name = COALESCE(p_full_name, full_name),
      preferred_name = COALESCE(p_preferred_name, preferred_name),
      institutional_email = COALESCE(p_institutional_email, institutional_email),
      department = COALESCE(p_department, department),
      program = COALESCE(p_program, program),
      academic_year = COALESCE(p_academic_year, academic_year),
      enrollment_status = COALESCE(p_enrollment_status, enrollment_status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = v_student_id
    RETURNING * INTO v_student;
  END IF;

  -- 4. Ensure Phase 1 academic profile exists for eligibility checks
  INSERT INTO phase1_academic_profiles (student_id, curriculum, declared_gpax, verified_credits, academic_verified)
  VALUES (v_student_id, '66', '3.00', '{"CS101": 3, "CS102": 3}', true)
  ON CONFLICT (student_id) DO NOTHING;

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'student_id', v_student_id,
    'student', to_jsonb(v_student)
  );
END;
$$;

REVOKE ALL ON FUNCTION upsert_tu_student_identity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_tu_student_identity TO coed_app;

COMMIT;
