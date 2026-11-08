-- Observed022-to023 only. No business-row backfill or policy publication.
DO $gate$ BEGIN
 IF current_database()<>'coed' OR current_schema()<>'public' OR current_user<>'postgres' OR current_setting('coed.academic_review_upgrade',true) IS DISTINCT FROM 'observed022-to023'
  OR NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='022_coordinator_intake_controls.sql' AND checksum='40ea01888fdfac3ea7892e08b0f6bc043ecc16b28271e74b6a318ae461c42d97')
  OR EXISTS(SELECT 1 FROM schema_migrations WHERE version='023_phase1_academic_review.sql')
  OR to_regclass(current_schema() || '.phase1_academic_reviews') IS NOT NULL
  THEN RAISE EXCEPTION 'ACADEMIC_REVIEW_OWNER_GATE_REQUIRED'; END IF;
END $gate$;
-- Additive review evidence. Never update submitted snapshots or academic profiles.
CREATE TABLE phase1_academic_reviews (
 id UUID PRIMARY KEY,application_id UUID NOT NULL REFERENCES phase1_applications(id),
 submission_id UUID NOT NULL,submission_checksum CHAR(64) NOT NULL CHECK(submission_checksum ~ '^[a-f0-9]{64}$'),
 cohort_id UUID NOT NULL REFERENCES selection_cohorts(id),actor_id UUID NOT NULL REFERENCES users(id),
 policy_id UUID NOT NULL REFERENCES phase1_policies(id),policy_version INTEGER NOT NULL CHECK(policy_version>0),
 version INTEGER NOT NULL CHECK(version>0),checks JSONB NOT NULL CHECK(jsonb_typeof(checks)='object'),
 assessment JSONB NOT NULL CHECK(jsonb_typeof(assessment)='object'),
 note TEXT NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 operation_id UUID NOT NULL UNIQUE REFERENCES coordinator_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(submission_id,application_id) REFERENCES phase1_submissions(id,application_id),
 UNIQUE(submission_id,version)
);
CREATE FUNCTION guard_phase1_academic_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a phase1_applications;s phase1_submissions;p phase1_policies;required TEXT[];code TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Academic reviews are immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || a.cycle_id::text,0));
 SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id AND application_id=a.id;
 SELECT * INTO p FROM phase1_policies WHERE id=NEW.policy_id;
 IF a.status<>'SUBMITTED' OR EXISTS(SELECT 1 FROM phase1_reviews rv WHERE rv.application_id=a.id AND rv.state='FORWARDED') OR s.id IS NULL OR s.application_version<>a.version OR s.checksum<>NEW.submission_checksum
  OR s.snapshot->'assessment'->>'review_required' IS DISTINCT FROM 'true'
  OR NOT EXISTS(SELECT 1 FROM selection_cohorts c JOIN users u ON u.id=c.coordinator_id
    JOIN phase1_submission_deliveries d ON d.cohort_id=c.id AND d.submission_id=s.id
    WHERE c.id=NEW.cohort_id AND c.cycle_id=a.cycle_id AND c.status='ACTIVE' AND u.id=NEW.actor_id
      AND u.role='COORDINATOR' AND u.account_status='ACTIVE')
  OR NOT EXISTS(SELECT 1 FROM rounds r LEFT JOIN coordinator_round_schedules cs ON cs.cycle_id=r.id LEFT JOIN phase1_cycle_windows w ON w.cycle_id=r.id
    WHERE r.id=a.cycle_id AND r.status='OPEN' AND clock_timestamp()>=COALESCE(cs.review_opens_at,w.opens_at) AND clock_timestamp()<COALESCE(cs.review_closes_at,w.closes_at))
  THEN RAISE EXCEPTION 'Current submission and assigned Coordinator required' USING ERRCODE='23514'; END IF;
 IF p.id IS NULL OR p.cycle_id<>a.cycle_id OR NOT p.verified OR p.synthetic OR p.source_year<>2568
  OR p.curriculum IS DISTINCT FROM s.snapshot->'declared_academic'->>'curriculum'
  OR p.version<>NEW.policy_version OR p.version<>(SELECT max(version) FROM phase1_policies WHERE cycle_id=p.cycle_id AND curriculum=p.curriculum)
  OR p.data->>'criteria_id' IS DISTINCT FROM 'TU_CS_2568_CONFIRMED_2026_11_08'
  OR p.data->>'repeat_rule' IS DISTINCT FROM 'HIGHEST' OR p.data->>'alternative_rule' IS DISTINCT FROM 'PROGRAM_TYPE'
  OR p.data->>'course_grade_min' IS DISTINCT FROM '2.00' OR p.data->>'grade_input' IS DISTINCT FROM 'HIGHEST_ONLY'
  THEN RAISE EXCEPTION 'Latest verified policy required' USING ERRCODE='23514'; END IF;
 required:=CASE p.curriculum WHEN '66' THEN ARRAY['CS100','CS101','CS102','CS111','CS213','CS216','CS251','CS261']
  ELSE ARRAY['CS101','CS102','CS111','CS213','CS216','CS251','CS264'] END;
 FOREACH code IN ARRAY required LOOP
  IF COALESCE(p.data->'credits'->>code,'') !~ '^[0-9]+(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION 'Verified credits required' USING ERRCODE='23514'; END IF;
  IF (p.data->'credits'->>code)::numeric<>3 THEN RAISE EXCEPTION 'Confirmed course credits must be 3' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NEW.version<>(SELECT COALESCE(max(version),0)+1 FROM phase1_academic_reviews WHERE submission_id=s.id)
  OR NEW.checks IS DISTINCT FROM '{"curriculum":true,"program_type":true,"entry_year":true,"grades":true,"documents":true,"declarations":true}'::jsonb
  OR NEW.assessment->>'eligibility' IS DISTINCT FROM 'PASS' OR NEW.assessment->>'can_confirm' IS DISTINCT FROM 'true'
  OR NEW.assessment->'blockers' IS DISTINCT FROM '[]'::jsonb
  OR NEW.assessment->'policy'->>'id' IS DISTINCT FROM p.id::text
  OR NEW.assessment->>'curriculum' IS DISTINCT FROM p.curriculum
  OR NEW.assessment->'criteria'->>'id' IS DISTINCT FROM 'TU_CS_2568_CONFIRMED_2026_11_08'
  THEN RAISE EXCEPTION 'Complete academic review required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_academic_review_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_academic_reviews
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_academic_review();
CREATE FUNCTION audit_phase1_academic_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM coordinator_operations op WHERE op.operation_id=NEW.operation_id AND op.actor_id=NEW.actor_id
   AND op.action='academic-review' AND op.resource_id=NEW.application_id AND op.result->>'academic_review_id'=NEW.id::text)
  THEN RAISE EXCEPTION 'Academic review audit required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER phase1_academic_review_audit AFTER INSERT ON phase1_academic_reviews
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION audit_phase1_academic_review();
CREATE FUNCTION guard_phase1_academic_forward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s phase1_submissions;a phase1_applications;ar phase1_academic_reviews;p phase1_policies;
BEGIN
 IF NEW.state<>'FORWARDED' THEN RETURN NEW; END IF;
 SELECT * INTO s FROM phase1_submissions WHERE id=NEW.submission_id;
 IF s.snapshot->'assessment'->>'review_required' IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || a.cycle_id::text,0));
 SELECT * INTO ar FROM phase1_academic_reviews WHERE submission_id=s.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO p FROM phase1_policies WHERE cycle_id=a.cycle_id AND curriculum=s.snapshot->'declared_academic'->>'curriculum' ORDER BY version DESC LIMIT 1;
 IF ar.id IS NULL OR ar.submission_checksum<>s.checksum OR ar.cohort_id<>NEW.cohort_id OR ar.actor_id<>NEW.actor_id
  OR p.id IS NULL OR ar.policy_id<>p.id OR ar.policy_version<>p.version OR NOT p.verified OR p.synthetic
  OR ar.assessment->>'eligibility' IS DISTINCT FROM 'PASS'
  THEN RAISE EXCEPTION 'Academic review required before forwarding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_academic_forward_guard BEFORE INSERT OR UPDATE ON phase1_reviews
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_academic_forward();
REVOKE ALL ON phase1_academic_reviews FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coed_app') THEN
  REVOKE ALL ON phase1_academic_reviews FROM coed_app;
  GRANT SELECT,INSERT ON phase1_academic_reviews TO coed_app;
 END IF;
END $$;
