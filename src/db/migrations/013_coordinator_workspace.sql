-- Forward-only Phase 1 review, correction history and round scheduling.
-- Prior submission/document snapshots remain immutable. No legacy Plans are created.
ALTER TABLE phase1_submissions DROP CONSTRAINT phase1_submissions_application_id_key;
ALTER TABLE phase1_submissions ADD UNIQUE(application_id,application_version);
ALTER TABLE phase1_submissions ADD UNIQUE(id,application_id);
ALTER TABLE phase1_applications DROP CONSTRAINT phase1_applications_status_check;
ALTER TABLE phase1_applications ADD CHECK(status IN ('DRAFT','SUBMITTED','NEEDS_REVISION'));

CREATE TABLE coordinator_round_schedules (
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
CREATE TABLE phase1_reviews (
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
CREATE TABLE coordinator_operations (
  operation_id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER coordinator_operation_immutable BEFORE UPDATE OR DELETE ON coordinator_operations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE INDEX phase1_submission_latest ON phase1_submissions(application_id,application_version DESC);
CREATE INDEX phase1_reviews_cohort ON phase1_reviews(cohort_id,state,application_id);

CREATE FUNCTION guard_phase1_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
CREATE TRIGGER phase1_review_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_phase1_review();

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
