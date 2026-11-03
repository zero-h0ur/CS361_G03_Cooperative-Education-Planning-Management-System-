-- Converge the workspace 013 and the explicitly recorded external 015 lineage.
-- Never replay/rename either 013, rewrite history, or manufacture missing dates.
-- The external baseline requires the separate upgrade-only history/catalog gate.
DO $alignment$
DECLARE t record; cols text; fingerprint text; workspace boolean; n integer;
BEGIN
  IF to_regclass(format('%I.coordinator_reviews',current_schema())) IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_PARTIAL_OR_ALREADY_APPLIED';
  END IF;
  workspace := EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='phase1_reviews'::regclass AND attname='state' AND NOT attisdropped);
  IF workspace IS DISTINCT FROM (to_regclass(format('%I.coordinator_round_schedules',current_schema())) IS NOT NULL)
     OR workspace IS DISTINCT FROM (to_regclass(format('%I.coordinator_operations',current_schema())) IS NOT NULL)
     OR (NOT workspace AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='phase1_reviews'::regclass AND attname='reviewed_by' AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'ALIGNMENT_UNSUPPORTED_LAYOUT';
  END IF;
  -- Capture all old business columns in the same transaction, under write locks.
  -- Hashes/counts never leave the database; postconditions abort on any loss.
  CREATE TEMP TABLE alignment_preservation(table_name text,columns_sql text,fingerprint text) ON COMMIT DROP;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname=current_schema() AND c.relkind='r' AND c.relname<>'schema_migrations' ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE',t.relname);
    SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum) INTO cols FROM pg_attribute a
      WHERE a.attrelid=format('%I',t.relname)::regclass AND a.attnum>0 AND NOT a.attisdropped;
    EXECUTE format($q$SELECT count(*)::text || ':' || coalesce(md5(string_agg(h,'' ORDER BY h)),md5(''))
      FROM (SELECT md5(row_to_json(x)::text) h FROM (SELECT %s FROM %I) x) q$q$,cols,t.relname) INTO fingerprint;
    INSERT INTO alignment_preservation VALUES(t.relname,cols,fingerprint);
  END LOOP;
END $alignment$;

ALTER TABLE phase1_cycle_windows
  ADD COLUMN IF NOT EXISTS review_opens_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_opens_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS announced_at timestamptz,
  ADD COLUMN IF NOT EXISTS announced_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS near_deadline_hours integer NOT NULL DEFAULT 48 CHECK(near_deadline_hours BETWEEN 1 AND 720),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $schedule$
BEGIN
  IF to_regclass(format('%I.coordinator_round_schedules',current_schema())) IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM coordinator_round_schedules s LEFT JOIN phase1_cycle_windows w USING(cycle_id)
      WHERE w.cycle_id IS NULL OR s.review_opens_at<w.closes_at
        OR (w.review_opens_at IS NOT NULL AND w.review_opens_at IS DISTINCT FROM s.review_opens_at)
        OR (w.review_closes_at IS NOT NULL AND w.review_closes_at IS DISTINCT FROM s.review_closes_at)
        OR (w.confirmation_opens_at IS NOT NULL AND w.confirmation_opens_at IS DISTINCT FROM s.confirmation_opens_at)
        OR (w.confirmation_closes_at IS NOT NULL AND w.confirmation_closes_at IS DISTINCT FROM s.confirmation_closes_at)) THEN
      RAISE EXCEPTION 'ALIGNMENT_SCHEDULE_CONFLICT';
    END IF;
    UPDATE phase1_cycle_windows w SET review_opens_at=s.review_opens_at,review_closes_at=s.review_closes_at,
      confirmation_opens_at=s.confirmation_opens_at,confirmation_closes_at=s.confirmation_closes_at
      FROM coordinator_round_schedules s WHERE s.cycle_id=w.cycle_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='phase1_submissions'::regclass AND c.contype IN ('p','u')
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num)=ARRAY['id','application_id']) THEN
    ALTER TABLE phase1_submissions ADD CONSTRAINT coordinator_submission_identity UNIQUE(id,application_id);
  END IF;
END $schedule$;

ALTER TABLE phase1_cycle_windows ADD CONSTRAINT coordinator_window_order CHECK(
  ((review_opens_at IS NULL AND review_closes_at IS NULL) OR
   (review_opens_at IS NOT NULL AND review_closes_at IS NOT NULL AND closes_at<=review_opens_at AND review_opens_at<review_closes_at))
  AND ((confirmation_opens_at IS NULL AND confirmation_closes_at IS NULL) OR
   (confirmation_opens_at IS NOT NULL AND confirmation_closes_at IS NOT NULL AND closes_at<=confirmation_opens_at
    AND (review_closes_at IS NULL OR review_closes_at<=confirmation_opens_at) AND confirmation_opens_at<confirmation_closes_at)));

CREATE TABLE coordinator_reviews (
  application_id uuid PRIMARY KEY REFERENCES phase1_applications(id),
  submission_id uuid NOT NULL,
  cohort_id uuid NOT NULL REFERENCES selection_cohorts(id),
  state text NOT NULL CHECK(state IN ('PENDING','RETURNED','FORWARDED')),
  version integer NOT NULL CHECK(version>0),
  reason text CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_provenance jsonb,
  FOREIGN KEY(submission_id,application_id) REFERENCES phase1_submissions(id,application_id),
  CHECK((state='RETURNED')=(reason IS NOT NULL))
);
CREATE INDEX coordinator_reviews_cohort ON coordinator_reviews(cohort_id,state,application_id);

DO $import$
DECLARE r record; raw jsonb; a phase1_applications; s phase1_submissions; latest phase1_submissions;
  c selection_cohorts; st students; state_value text; actor_value uuid; time_value timestamptz;
  version_value integer; resubmitted boolean; workspace boolean; imported integer;
BEGIN
  workspace:=EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='phase1_reviews'::regclass AND attname='state' AND NOT attisdropped);
  FOR r IN SELECT * FROM phase1_reviews LOOP
    raw:=to_jsonb(r);
    SELECT * INTO a FROM phase1_applications WHERE id=r.application_id;
    SELECT * INTO s FROM phase1_submissions WHERE id=r.submission_id AND application_id=a.id;
    SELECT * INTO latest FROM phase1_submissions WHERE application_id=a.id ORDER BY application_version DESC LIMIT 1;
    SELECT * INTO c FROM selection_cohorts WHERE id=r.cohort_id;
    SELECT * INTO st FROM students WHERE id=a.student_id;
    state_value:=CASE WHEN workspace THEN raw->>'state' WHEN raw->>'status'='RECEIVED' THEN 'FORWARDED' ELSE raw->>'status' END;
    actor_value:=coalesce(raw->>'actor_id',raw->>'reviewed_by')::uuid;
    time_value:=coalesce(raw->>'updated_at',raw->>'reviewed_at')::timestamptz;
    version_value:=CASE WHEN workspace THEN (raw->>'version')::integer ELSE 1 END;
    resubmitted:=state_value='RETURNED' AND a.status='SUBMITTED' AND latest.application_version=a.version
      AND latest.application_version>s.application_version AND latest.submitted_by=st.user_id;
    IF a.id IS NULL OR s.id IS NULL OR c.id IS NULL OR st.id IS NULL OR c.cycle_id<>a.cycle_id
      OR c.department<>st.department OR c.program<>st.program OR s.submitted_by<>st.user_id
      OR latest.submitted_by<>st.user_id OR time_value IS NULL OR version_value IS NULL OR version_value<1
      OR state_value IS NULL OR state_value NOT IN ('PENDING','RETURNED','FORWARDED')
      OR (NOT resubmitted AND state_value='RETURNED' AND (a.status<>'NEEDS_REVISION' OR a.version<=s.application_version OR latest.id<>s.id))
      OR (NOT resubmitted AND state_value<>'RETURNED' AND (a.status<>'SUBMITTED' OR a.version<>s.application_version OR latest.id<>s.id))
      OR (state_value='PENDING' AND actor_value<>st.user_id)
      OR (state_value<>'PENDING' AND NOT EXISTS(SELECT 1 FROM users WHERE id=actor_value AND role='COORDINATOR')) THEN
      RAISE EXCEPTION 'ALIGNMENT_AMBIGUOUS_REVIEW' USING ERRCODE='23514';
    END IF;
    INSERT INTO coordinator_reviews(application_id,submission_id,cohort_id,state,version,reason,actor_id,updated_at,source_provenance)
      VALUES(a.id,CASE WHEN resubmitted THEN latest.id ELSE s.id END,c.id,CASE WHEN resubmitted THEN 'PENDING' ELSE state_value END,
      version_value,CASE WHEN state_value='RETURNED' AND NOT resubmitted THEN raw->>'reason' ELSE NULL END,
      CASE WHEN resubmitted THEN latest.submitted_by ELSE actor_value END,CASE WHEN resubmitted THEN latest.submitted_at ELSE time_value END,
      jsonb_build_object('layout',CASE WHEN workspace THEN 'workspace013' ELSE 'external015' END,
        'counter',CASE WHEN workspace THEN 'preserved' ELSE 'new-canonical-counter' END,'review',raw,'resubmitted',resubmitted));
  END LOOP;
  SELECT count(*) INTO imported FROM coordinator_reviews;
  IF imported<>(SELECT count(*) FROM phase1_reviews) OR EXISTS(
    SELECT 1 FROM phase1_applications ap WHERE ap.status='NEEDS_REVISION' AND NOT EXISTS(
      SELECT 1 FROM coordinator_reviews rv WHERE rv.application_id=ap.id AND rv.state='RETURNED')) THEN
    RAISE EXCEPTION 'ALIGNMENT_IMPORT_CARDINALITY';
  END IF;
END $import$;

CREATE TABLE IF NOT EXISTS coordinator_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  resource_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $operations$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='coordinator_operations'::regclass AND tgname='coordinator_operation_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER coordinator_operation_immutable BEFORE UPDATE OR DELETE ON coordinator_operations
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
  END IF;
END $operations$;

CREATE FUNCTION guard_coordinator_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a phase1_applications; c selection_cohorts; s phase1_submissions;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reviews are retained' USING ERRCODE='55000'; END IF;
  SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || a.cycle_id::text,0));
  SELECT * INTO c FROM selection_cohorts WHERE id=NEW.cohort_id AND status='ACTIVE';
  SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id AND application_id=a.id;
  IF c.id IS NULL OR s.id IS NULL OR c.cycle_id<>a.cycle_id OR NOT EXISTS(
    SELECT 1 FROM students st WHERE st.id=a.student_id AND st.department=c.department AND st.program=c.program)
    OR NOT EXISTS(SELECT 1 FROM rounds r JOIN phase1_cycle_windows w ON w.cycle_id=r.id WHERE r.id=a.cycle_id
      AND r.status='OPEN' AND clock_timestamp()>=w.review_opens_at AND clock_timestamp()<w.review_closes_at) THEN
    RAISE EXCEPTION 'Review scope/window mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.source_provenance IS NOT NULL OR NEW.version<>1 OR NEW.state NOT IN ('RETURNED','FORWARDED') THEN
      RAISE EXCEPTION 'Invalid initial review/provenance' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.application_id<>OLD.application_id OR NEW.cohort_id<>OLD.cohort_id OR NEW.version<>OLD.version+1
      OR NEW.source_provenance IS DISTINCT FROM OLD.source_provenance OR OLD.state='FORWARDED' THEN
      RAISE EXCEPTION 'Review changed or already forwarded' USING ERRCODE='23514'; END IF;
    IF OLD.state='RETURNED' AND NEW.state='PENDING' AND NEW.submission_id<>OLD.submission_id
      AND s.application_version=a.version+1 AND a.status='NEEDS_REVISION'
      AND s.submitted_by=NEW.actor_id AND EXISTS(SELECT 1 FROM students st JOIN users u ON u.id=st.user_id
        WHERE st.id=a.student_id AND u.id=NEW.actor_id AND u.role='STUDENT' AND u.account_status='ACTIVE') THEN RETURN NEW; END IF;
    IF OLD.state<>'PENDING' OR NEW.submission_id<>OLD.submission_id THEN
      RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF a.status<>'SUBMITTED' OR NEW.state NOT IN ('RETURNED','FORWARDED') OR s.application_version<>a.version
    OR NEW.actor_id<>c.coordinator_id OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='COORDINATOR' AND account_status='ACTIVE') THEN
    RAISE EXCEPTION 'Current submission and assigned Coordinator required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coordinator_review_guard BEFORE INSERT OR UPDATE OR DELETE ON coordinator_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_coordinator_review();

-- Archived sources cannot remain a second mutable source of truth, even for an
-- accidentally retained runtime grant. Owners retain all original rows/guards.
CREATE FUNCTION reject_coordinator_archive_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Legacy Coordinator archive is read only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER coordinator_review_archive BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON phase1_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION reject_coordinator_archive_write();
DO $archive$
BEGIN
  IF to_regclass(format('%I.coordinator_round_schedules',current_schema())) IS NOT NULL THEN
    CREATE TRIGGER coordinator_schedule_archive BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON coordinator_round_schedules
      FOR EACH STATEMENT EXECUTE FUNCTION reject_coordinator_archive_write();
  END IF;
END $archive$;

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
      SELECT 1 FROM coordinator_reviews r JOIN phase1_submissions s ON s.id=r.submission_id
      WHERE r.application_id=OLD.id AND r.state='RETURNED' AND s.application_version=OLD.version) THEN
      RAISE EXCEPTION 'Submitted content requires an explicit return' USING ERRCODE='55000'; END IF;
  ELSIF OLD.status='NEEDS_REVISION' AND NEW.status NOT IN ('NEEDS_REVISION','SUBMITTED') THEN
    RAISE EXCEPTION 'Invalid correction transition' USING ERRCODE='23514';
  ELSIF OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','SUBMITTED') THEN
    RAISE EXCEPTION 'Invalid Draft transition' USING ERRCODE='23514';
  END IF;
  IF NEW.status='NEEDS_REVISION' AND NOT EXISTS(SELECT 1 FROM coordinator_reviews WHERE application_id=NEW.id AND state='RETURNED') THEN
    RAISE EXCEPTION 'Active return required' USING ERRCODE='23514'; END IF;
  IF OLD.status='NEEDS_REVISION' THEN
    IF NOT EXISTS(SELECT 1 FROM rounds r JOIN phase1_cycle_windows w ON w.cycle_id=r.id WHERE r.id=OLD.cycle_id
      AND r.status='OPEN' AND clock_timestamp()>=w.review_opens_at AND clock_timestamp()<w.review_closes_at) THEN
      RAISE EXCEPTION 'Correction period is closed or not configured' USING ERRCODE='55000'; END IF;
    IF NEW.status='SUBMITTED' AND NOT EXISTS(SELECT 1 FROM coordinator_reviews rv JOIN phase1_submissions sub ON sub.id=rv.submission_id
      WHERE rv.application_id=NEW.id AND rv.state='PENDING' AND sub.application_version=NEW.version) THEN
      RAISE EXCEPTION 'Correction review must reference the new snapshot' USING ERRCODE='23514'; END IF;
  END IF;
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
    (a.status='NEEDS_REVISION' AND EXISTS(SELECT 1 FROM coordinator_reviews r WHERE r.application_id=a.id AND r.state='RETURNED'))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted attachments are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_coordinator_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Schedules are retained' USING ERRCODE='55000'; END IF;
  IF NEW.cycle_id<>OLD.cycle_id THEN RAISE EXCEPTION 'Schedule identity is immutable' USING ERRCODE='55000'; END IF;
  IF OLD.announced_at IS NOT NULL AND ROW(NEW.announced_at,NEW.announced_by) IS DISTINCT FROM ROW(OLD.announced_at,OLD.announced_by) THEN
    RAISE EXCEPTION 'Published announcement metadata is immutable' USING ERRCODE='55000'; END IF;
  IF ROW(NEW.opens_at,NEW.closes_at,NEW.review_opens_at,NEW.review_closes_at,NEW.confirmation_opens_at,NEW.confirmation_closes_at)
    IS DISTINCT FROM ROW(OLD.opens_at,OLD.closes_at,OLD.review_opens_at,OLD.review_closes_at,OLD.confirmation_opens_at,OLD.confirmation_closes_at) THEN
    IF OLD.announced_at IS NOT NULL THEN RAISE EXCEPTION 'Published schedules are read only' USING ERRCODE='55000'; END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Schedule version must increment' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coordinator_window_guard BEFORE UPDATE OR DELETE ON phase1_cycle_windows
  FOR EACH ROW EXECUTE FUNCTION guard_coordinator_window();

DO $preserved$
DECLARE t record; actual text;
BEGIN
  FOR t IN SELECT * FROM alignment_preservation LOOP
    EXECUTE format($q$SELECT count(*)::text || ':' || coalesce(md5(string_agg(h,'' ORDER BY h)),md5(''))
      FROM (SELECT md5(row_to_json(x)::text) h FROM (SELECT %s FROM %I) x) q$q$,t.columns_sql,t.table_name) INTO actual;
    IF actual IS DISTINCT FROM t.fingerprint THEN RAISE EXCEPTION 'ALIGNMENT_PRESERVATION_FAILED'; END IF;
  END LOOP;
END $preserved$;
DROP TABLE alignment_preservation;

CREATE FUNCTION coordinator_schema_revision() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 16';
