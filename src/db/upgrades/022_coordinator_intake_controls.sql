-- LOCAL forward-upgrade proposal after021. Final migration number/runner and
-- production metadata require a separately verified/approved live manifest.
DO $gate$ BEGIN
 IF current_user<>'postgres' OR current_setting('coed.intake_controls_upgrade',true) IS DISTINCT FROM 'observed021-controls'
 OR NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='021_phase1_pending_intake.sql'
   AND checksum='e7beab8e04c60434649339a79dc857295ad4cc15d651ba5dd95f2fe30fd70442')
 THEN RAISE EXCEPTION 'INTAKE_CONTROLS_OWNER_GATE_REQUIRED'; END IF;
END $gate$;
CREATE TABLE phase1_intake_controls (
 cycle_id UUID PRIMARY KEY REFERENCES rounds(id),mode TEXT NOT NULL CHECK(mode IN ('SCHEDULED','MANUAL_OPEN','CLOSED')),
 opens_at TIMESTAMPTZ,closes_at TIMESTAMPTZ,version INTEGER NOT NULL CHECK(version>0),
 updated_by UUID NOT NULL REFERENCES users(id),updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),operation_id UUID,
 CHECK(mode='CLOSED' AND opens_at IS NULL AND closes_at IS NULL OR
   mode='MANUAL_OPEN' AND opens_at IS NOT NULL AND closes_at IS NULL OR
   mode='SCHEDULED' AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at>opens_at)
);
CREATE TABLE phase1_intake_control_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,cycle_id UUID NOT NULL REFERENCES phase1_intake_controls(cycle_id),
 operation_id UUID NOT NULL UNIQUE,actor_id UUID NOT NULL REFERENCES users(id),
 previous_state JSONB NOT NULL,next_state JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION guard_phase1_intake_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake controls are retained' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
    OR NEW.mode<>'CLOSED' OR NEW.version<>1 OR NEW.operation_id IS NOT NULL
  THEN RAISE EXCEPTION 'Owner provisions closed controls only' USING ERRCODE='42501'; END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || OLD.cycle_id::text,0));
  IF NEW.cycle_id<>OLD.cycle_id OR NEW.version<>OLD.version+1 OR NEW.operation_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.updated_by AND role='COORDINATOR' AND account_status='ACTIVE')
    OR NOT EXISTS(SELECT 1 FROM selection_cohorts WHERE cycle_id=NEW.cycle_id AND status='ACTIVE')
    OR EXISTS(SELECT 1 FROM selection_cohorts WHERE cycle_id=NEW.cycle_id AND status='ACTIVE' AND coordinator_id IS DISTINCT FROM NEW.updated_by)
    OR NOT EXISTS(SELECT 1 FROM rounds WHERE id=NEW.cycle_id AND status='OPEN')
    OR EXISTS(SELECT 1 FROM phase1_cycle_windows WHERE cycle_id=NEW.cycle_id AND announced_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Assigned active round control required' USING ERRCODE='23514'; END IF;
 END IF;
 -- JavaScript/JSON receipts preserve milliseconds; avoid unrepresentable
 -- microseconds causing a false provenance conflict on the actual Submit path.
 NEW.updated_at:=date_trunc('milliseconds',clock_timestamp());
 IF NEW.mode='MANUAL_OPEN' THEN NEW.opens_at:=NEW.updated_at;NEW.closes_at:=NULL;
 ELSIF NEW.mode='CLOSED' THEN NEW.opens_at:=NULL;NEW.closes_at:=NULL;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_intake_control_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_intake_controls
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_intake_control();
CREATE FUNCTION audit_phase1_intake_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO phase1_intake_control_events(cycle_id,operation_id,actor_id,previous_state,next_state)
 VALUES(NEW.cycle_id,NEW.operation_id,NEW.updated_by,to_jsonb(OLD),to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER phase1_intake_control_audit AFTER UPDATE ON phase1_intake_controls
 FOR EACH ROW EXECUTE FUNCTION audit_phase1_intake_control();
CREATE FUNCTION guard_phase1_intake_control_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Intake control history is immutable' USING ERRCODE='55000';END IF;
 IF pg_trigger_depth()<>2 OR NOT EXISTS(SELECT 1 FROM phase1_intake_controls c WHERE c.cycle_id=NEW.cycle_id
   AND c.operation_id=NEW.operation_id AND c.updated_by=NEW.actor_id AND to_jsonb(c)=NEW.next_state)
 THEN RAISE EXCEPTION 'Control change audit only' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_intake_control_event_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_intake_control_events
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_intake_control_event();
-- Legacy submissions/rounds remain unchanged. New controlled submissions carry
-- the exact committed control version; returned corrections use only their
-- recorded review deadline, never the manual opening as a substitute.
CREATE FUNCTION guard_phase1_controlled_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a phase1_applications; c phase1_intake_controls; n TIMESTAMPTZ; return_version INTEGER;
BEGIN
 SELECT * INTO a FROM phase1_applications WHERE id=NEW.application_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase1:cycle:' || a.cycle_id::text,0));
 SELECT * INTO c FROM phase1_intake_controls WHERE cycle_id=a.cycle_id;
 IF c.cycle_id IS NULL THEN RETURN NEW;END IF;
 n:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM rounds WHERE id=a.cycle_id AND status='OPEN')
   OR NEW.snapshot->'intake_control'->>'mode' IS DISTINCT FROM c.mode
   OR NEW.snapshot->'intake_control'->>'version' IS DISTINCT FROM c.version::text
   OR (NEW.snapshot->'intake_control'->>'opens_at')::timestamptz IS DISTINCT FROM c.opens_at
   OR (NEW.snapshot->'intake_control'->>'closes_at')::timestamptz IS DISTINCT FROM c.closes_at
 THEN RAISE EXCEPTION 'Current intake control provenance required' USING ERRCODE='23514';END IF;
 IF a.status='NEEDS_REVISION' THEN
  SELECT rv.version INTO return_version FROM phase1_reviews rv JOIN selection_cohorts sc ON sc.id=rv.cohort_id AND sc.status='ACTIVE'
   JOIN phase1_cycle_windows w ON w.cycle_id=sc.cycle_id LEFT JOIN coordinator_round_schedules s ON s.cycle_id=sc.cycle_id
   WHERE rv.application_id=a.id AND rv.state='RETURNED' AND sc.cycle_id=a.cycle_id
     AND n>=w.opens_at AND n<COALESCE(s.review_closes_at,w.closes_at);
  IF return_version IS NULL OR NEW.snapshot->'intake_control'->>'exception' IS DISTINCT FROM 'RETURNED'
    OR NEW.snapshot->'intake_control'->>'return_version' IS DISTINCT FROM return_version::text
  THEN RAISE EXCEPTION 'Recorded correction window required' USING ERRCODE='23514';END IF;
 ELSIF a.status<>'DRAFT' OR NEW.snapshot->'intake_control'->>'exception' IS NOT NULL
   OR NOT (c.mode='MANUAL_OPEN' AND c.opens_at<=n OR c.mode='SCHEDULED' AND c.opens_at<=n AND n<c.closes_at)
 THEN RAISE EXCEPTION 'Intake is closed for ordinary drafts' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phase1_controlled_submission_guard BEFORE INSERT ON phase1_submissions
 FOR EACH ROW EXECUTE FUNCTION guard_phase1_controlled_submission();
REVOKE ALL ON phase1_intake_controls,phase1_intake_control_events FROM PUBLIC,coed_app;
GRANT SELECT ON phase1_intake_controls,phase1_intake_control_events TO coed_app;
GRANT UPDATE(mode,opens_at,closes_at,version,updated_by,updated_at,operation_id) ON phase1_intake_controls TO coed_app;
GRANT INSERT ON phase1_intake_control_events TO coed_app;
GRANT USAGE,SELECT ON SEQUENCE phase1_intake_control_events_id_seq TO coed_app;
