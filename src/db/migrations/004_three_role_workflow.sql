-- Forward only. Historical migrations and submitted records are not rewritten.
ALTER TABLE students ADD COLUMN contact_address TEXT,
  ADD COLUMN contact_phone TEXT,
  ADD CONSTRAINT chk_student_contact_address CHECK (char_length(contact_address) <= 1000),
  ADD CONSTRAINT chk_student_contact_phone CHECK (char_length(contact_phone) <= 40);
ALTER TABLE plans ADD COLUMN project_title TEXT,
  ADD COLUMN document_references JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN requirement_policy_id UUID,
  ADD CONSTRAINT chk_plan_project_title CHECK (char_length(project_title) BETWEEN 1 AND 300),
  ADD CONSTRAINT chk_plan_references CHECK (jsonb_typeof(document_references) = 'array');
ALTER TABLE plans DROP CONSTRAINT chk_plans_status,
  ADD CONSTRAINT chk_plans_status CHECK (status IN
    ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_REVISION','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE audit_events DROP CONSTRAINT chk_audit_events_from_state,
  DROP CONSTRAINT chk_audit_events_to_state,
  ADD CONSTRAINT chk_audit_events_from_state CHECK (from_state IS NULL OR from_state IN
    ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_REVISION','APPROVED','REJECTED','CANCELLED')),
  ADD CONSTRAINT chk_audit_events_to_state CHECK (to_state IS NULL OR to_state IN
    ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_REVISION','APPROVED','REJECTED','CANCELLED'));

CREATE TABLE document_policies (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES rounds(id),
  department TEXT NOT NULL CHECK (char_length(department) BETWEEN 1 AND 200),
  program TEXT NOT NULL DEFAULT '' CHECK (char_length(program) <= 200),
  version INTEGER NOT NULL CHECK (version >= 1),
  requirements JSONB NOT NULL CHECK (jsonb_typeof(requirements) = 'array'),
  published_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (cycle_id, department, program, version)
);
ALTER TABLE plans ADD CONSTRAINT fk_plans_requirement_policy
  FOREIGN KEY (requirement_policy_id) REFERENCES document_policies(id);

CREATE TABLE plan_submissions (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plans(id),
  plan_version INTEGER NOT NULL,
  policy_id UUID NOT NULL REFERENCES document_policies(id),
  snapshot JSONB NOT NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (plan_id, plan_version)
);

-- Receipts/events for non-plan resources: do not fake plan_operations.plan_id.
CREATE TABLE workflow_receipts (
  operation_id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE workflow_events (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES workflow_receipts(operation_id),
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_id UUID NOT NULL,
  plan_id UUID REFERENCES plans(id),
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_workflow_events_plan ON workflow_events(plan_id, created_at);

CREATE TABLE placements (
  plan_id UUID PRIMARY KEY REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SUBMITTED','AWAITING_COMPANY','NEEDS_REVISION','CONFIRMED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  payload JSONB NOT NULL DEFAULT '{}',
  submitted_payload JSONB,
  sent_reference TEXT,
  sent_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  evidence JSONB,
  feedback TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'CONFIRMED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
    AND evidence IS NOT NULL AND submitted_payload IS NOT NULL))
);
ALTER TABLE advisor_assignments ADD COLUMN plan_id UUID REFERENCES plans(id),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TRIGGER document_policies_immutable BEFORE UPDATE OR DELETE ON document_policies
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER plan_submissions_immutable BEFORE UPDATE OR DELETE ON plan_submissions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER workflow_receipts_immutable BEFORE UPDATE OR DELETE ON workflow_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON workflow_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();

-- All writers, including the runtime SQL role, serialize on Advisor user rows.
-- Count at interval starts (where occupancy can increase), not just today's count.
CREATE FUNCTION enforce_advisor_capacity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM users WHERE id IN (NEW.advisor_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.advisor_id ELSE NEW.advisor_id END)
    ORDER BY id FOR UPDATE;
  IF NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM (
      SELECT NEW.effective_from AS instant
      UNION SELECT a.effective_from FROM advisor_assignments a
      WHERE a.advisor_id = NEW.advisor_id AND a.status = 'ACTIVE' AND a.id <> NEW.id
        AND a.effective_from >= NEW.effective_from AND a.effective_from < NEW.effective_to
    ) points WHERE (
      SELECT count(DISTINCT a.student_id) FROM advisor_assignments a
      WHERE a.advisor_id = NEW.advisor_id AND a.status = 'ACTIVE' AND a.id <> NEW.id
        AND a.effective_from <= points.instant AND a.effective_to > points.instant
        AND a.student_id <> NEW.student_id
    ) >= 5
  ) THEN
    RAISE EXCEPTION 'Advisor simultaneous capacity of five exceeded'
      USING ERRCODE = '23514', CONSTRAINT = 'advisor_capacity_five';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER advisor_capacity_guard BEFORE INSERT OR UPDATE ON advisor_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_advisor_capacity();

-- Audit-preserving cancellation cannot be used to bypass a final rejection.
CREATE FUNCTION guard_student_plan_terminal_state() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('REJECTED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal plan is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_terminal_guard BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION guard_student_plan_terminal_state();
