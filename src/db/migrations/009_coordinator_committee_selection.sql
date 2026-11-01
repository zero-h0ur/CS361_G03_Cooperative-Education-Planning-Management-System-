-- Additive role separation. Never rename Staff/Advisor, overwrite historical
-- decisions, fabricate grades, or turn three opinions into an approval.
ALTER TABLE users DROP CONSTRAINT chk_users_role;
ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK
  (role IN ('STUDENT','STAFF','ADVISOR','ADMIN','SYSTEM','COORDINATOR','COMMITTEE'));
ALTER TABLE audit_events DROP CONSTRAINT chk_audit_events_actor_role;
ALTER TABLE audit_events ADD CONSTRAINT chk_audit_events_actor_role CHECK
  (actor_role IN ('STUDENT','STAFF','ADVISOR','ADMIN','SYSTEM','COORDINATOR','COMMITTEE'));

-- Panels and their exact curriculum/cycle scope are configured by an operator,
-- not by a browser role claim. A panel always has three distinct committee users.
CREATE TABLE selection_cohorts (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  department TEXT NOT NULL CHECK (length(btrim(department))>0 AND department=btrim(department)),
  program TEXT NOT NULL CHECK (length(btrim(program))>0 AND program=btrim(program)),
  coordinator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  committee_one UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  committee_two UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  committee_three UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cycle_id,department,program),
  CHECK (committee_one<>committee_two AND committee_one<>committee_three AND committee_two<>committee_three),
  CHECK (coordinator_id NOT IN (committee_one,committee_two,committee_three))
);

CREATE TABLE selection_receipts (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL UNIQUE REFERENCES plans(id) ON DELETE RESTRICT,
  cohort_id UUID NOT NULL REFERENCES selection_cohorts(id) ON DELETE RESTRICT,
  acknowledged_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_version INTEGER NOT NULL CHECK (plan_version>0),
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE selection_opinions (
  id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL REFERENCES selection_receipts(id) ON DELETE RESTRICT,
  committee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  selected BOOLEAN NOT NULL,
  comment TEXT NOT NULL CHECK (length(comment) BETWEEN 1 AND 2000 AND comment=btrim(comment)),
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(receipt_id,committee_id)
);

CREATE FUNCTION guard_selection_panel() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.coordinator_id AND role='COORDINATOR' AND account_status='ACTIVE')
    OR (SELECT count(*) FROM users WHERE id IN (NEW.committee_one,NEW.committee_two,NEW.committee_three)
      AND role='COMMITTEE' AND account_status='ACTIVE')<>3 THEN
    RAISE EXCEPTION 'Panel requires an active Coordinator and three distinct active Committee users' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selection_panel_guard BEFORE INSERT OR UPDATE ON selection_cohorts
  FOR EACH ROW EXECUTE FUNCTION guard_selection_panel();

CREATE FUNCTION guard_selection_receipt() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM selection_cohorts c JOIN users u ON u.id=c.coordinator_id
    JOIN plans p ON p.id=NEW.plan_id JOIN students s ON s.id=p.student_id
    JOIN rounds r ON r.id=p.cycle_id
    WHERE c.id=NEW.cohort_id AND c.status='ACTIVE' AND c.coordinator_id=NEW.acknowledged_by
      AND u.role='COORDINATOR' AND u.account_status='ACTIVE'
      AND p.cycle_id=c.cycle_id AND s.department=c.department AND s.program=c.program
      AND p.status='SUBMITTED' AND p.version=NEW.plan_version AND NOT p.legacy_compatibility
      AND r.status='OPEN'
      AND (SELECT count(*) FROM users m WHERE m.id IN (c.committee_one,c.committee_two,c.committee_three)
        AND m.role='COMMITTEE' AND m.account_status='ACTIVE')=3
  ) THEN
    RAISE EXCEPTION 'Coordinator receipt is outside the submitted application scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selection_receipt_guard BEFORE INSERT ON selection_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_selection_receipt();

CREATE FUNCTION guard_selection_opinion() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM selection_receipts a JOIN selection_cohorts c ON c.id=a.cohort_id
    JOIN users u ON u.id=NEW.committee_id JOIN plans p ON p.id=a.plan_id
    JOIN rounds r ON r.id=c.cycle_id
    WHERE a.id=NEW.receipt_id AND c.status='ACTIVE' AND r.status='OPEN'
      AND NEW.committee_id IN (c.committee_one,c.committee_two,c.committee_three)
      AND u.role='COMMITTEE' AND u.account_status='ACTIVE'
      AND p.status IN ('SUBMITTED','UNDER_REVIEW') AND p.version=a.plan_version
  ) THEN
    RAISE EXCEPTION 'Opinion requires an active panel membership and an unchanged received application' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selection_opinion_guard BEFORE INSERT ON selection_opinions
  FOR EACH ROW EXECUTE FUNCTION guard_selection_opinion();
CREATE TRIGGER selection_receipts_immutable BEFORE UPDATE OR DELETE ON selection_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER selection_opinions_immutable BEFORE UPDATE OR DELETE ON selection_opinions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();

CREATE INDEX selection_cohorts_coordinator ON selection_cohorts(coordinator_id,status);
CREATE INDEX selection_receipts_cohort ON selection_receipts(cohort_id,acknowledged_at);
