-- Phase 1 admissions are separate from legacy company/project Plans.
-- No grades, credits or verified identities are invented or backfilled.
CREATE TABLE phase1_academic_profiles (
  student_id UUID PRIMARY KEY REFERENCES students(id),
  curriculum TEXT NOT NULL CHECK (curriculum IN ('61','66')),
  entry_year INTEGER NOT NULL CHECK (entry_year BETWEEN 2500 AND 2700),
  institution TEXT NOT NULL CHECK (institution = 'TU_CS'),
  source TEXT NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 500),
  verified_by UUID NOT NULL REFERENCES users(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE phase1_policies (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES rounds(id),
  curriculum TEXT NOT NULL CHECK (curriculum IN ('61','66')),
  version INTEGER NOT NULL CHECK (version > 0),
  source_year INTEGER NOT NULL CHECK (source_year BETWEEN 2500 AND 2700),
  source TEXT NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 500),
  verified BOOLEAN NOT NULL DEFAULT false,
  synthetic BOOLEAN NOT NULL DEFAULT false,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cycle_id,curriculum,version)
);
CREATE TABLE phase1_cycle_windows (
  cycle_id UUID PRIMARY KEY REFERENCES rounds(id),
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL CHECK (closes_at > opens_at),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE phase1_applications (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id),
  cycle_id UUID NOT NULL REFERENCES rounds(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  payload JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id,cycle_id),
  CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL))
);
CREATE TABLE phase1_uploads (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES phase1_applications(id),
  kind TEXT NOT NULL CHECK (kind IN ('resume','transcript','conduct','photo')),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  staging_key TEXT NOT NULL UNIQUE,
  expected_version INTEGER NOT NULL CHECK (expected_version > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ATTACHED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (kind <> 'photo' OR (byte_size <= 5242880 AND content_type <> 'application/pdf')),
  CHECK (kind = 'photo' OR content_type = 'application/pdf')
);
CREATE TABLE phase1_documents (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES phase1_applications(id),
  ticket_id UUID NOT NULL UNIQUE REFERENCES phase1_uploads(id),
  kind TEXT NOT NULL CHECK (kind IN ('resume','transcript','conduct','photo')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  object_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,application_id,kind)
);
CREATE TABLE phase1_attachments (
  application_id UUID NOT NULL REFERENCES phase1_applications(id),
  kind TEXT NOT NULL,
  document_id UUID NOT NULL UNIQUE,
  PRIMARY KEY(application_id,kind),
  FOREIGN KEY(document_id,application_id,kind) REFERENCES phase1_documents(id,application_id,kind)
);
CREATE TABLE phase1_submissions (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL UNIQUE REFERENCES phase1_applications(id),
  application_version INTEGER NOT NULL,
  policy_id UUID NOT NULL REFERENCES phase1_policies(id),
  snapshot JSONB NOT NULL,
  checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  submitted_by UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE phase1_operations (
  operation_id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES phase1_applications(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE phase1_events (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES phase1_operations(operation_id),
  application_id UUID NOT NULL REFERENCES phase1_applications(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  application_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION guard_phase1_application() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Applications are retained' USING ERRCODE='55000'; END IF;
  IF OLD.status='SUBMITTED' OR NEW.id<>OLD.id OR NEW.student_id<>OLD.student_id OR NEW.cycle_id<>OLD.cycle_id THEN
    RAISE EXCEPTION 'Application identity and submitted content are immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Application version must advance once' USING ERRCODE='23514'; END IF;
  IF NEW.status='SUBMITTED' AND NOT EXISTS(SELECT 1 FROM phase1_submissions
    WHERE application_id=NEW.id AND application_version=NEW.version) THEN
    RAISE EXCEPTION 'Submission snapshot required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase1_application_guard BEFORE UPDATE OR DELETE ON phase1_applications
  FOR EACH ROW EXECUTE FUNCTION guard_phase1_application();
CREATE FUNCTION guard_phase1_attachment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE app UUID;
BEGIN
  app:=CASE WHEN TG_OP='DELETE' THEN OLD.application_id ELSE NEW.application_id END;
  IF TG_OP='UPDATE' AND (NEW.application_id<>OLD.application_id OR NEW.kind<>OLD.kind) THEN
    RAISE EXCEPTION 'Attachment cannot move applications' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM phase1_applications WHERE id=app AND status='DRAFT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted attachments are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase1_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON phase1_attachments
  FOR EACH ROW EXECUTE FUNCTION guard_phase1_attachment();
CREATE TRIGGER phase1_policy_immutable BEFORE UPDATE OR DELETE ON phase1_policies
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER phase1_document_immutable BEFORE UPDATE OR DELETE ON phase1_documents
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER phase1_submission_immutable BEFORE UPDATE OR DELETE ON phase1_submissions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER phase1_operation_immutable BEFORE UPDATE OR DELETE ON phase1_operations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE TRIGGER phase1_event_immutable BEFORE UPDATE OR DELETE ON phase1_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
CREATE INDEX phase1_applications_cycle ON phase1_applications(cycle_id,status,created_at,id);
CREATE INDEX phase1_uploads_app ON phase1_uploads(application_id,status);

-- Serialize eligibility metadata publication with submission without granting the
-- application role UPDATE rights on verified profiles, policies or deadlines.
CREATE FUNCTION lock_phase1_metadata() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; prefix TEXT;
BEGIN
  IF TG_TABLE_NAME='phase1_academic_profiles' THEN
    target:=CASE WHEN TG_OP='DELETE' THEN OLD.student_id ELSE NEW.student_id END;
    prefix:='phase1:profile:';
  ELSIF TG_TABLE_NAME='rounds' THEN
    target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    prefix:='phase1:cycle:';
  ELSE
    target:=CASE WHEN TG_OP='DELETE' THEN OLD.cycle_id ELSE NEW.cycle_id END;
    prefix:='phase1:cycle:';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(prefix || target::text,0));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase1_profile_lock BEFORE INSERT OR UPDATE OR DELETE ON phase1_academic_profiles
  FOR EACH ROW EXECUTE FUNCTION lock_phase1_metadata();
CREATE TRIGGER phase1_policy_lock BEFORE INSERT ON phase1_policies
  FOR EACH ROW EXECUTE FUNCTION lock_phase1_metadata();
CREATE TRIGGER phase1_window_lock BEFORE INSERT OR UPDATE OR DELETE ON phase1_cycle_windows
  FOR EACH ROW EXECUTE FUNCTION lock_phase1_metadata();
CREATE TRIGGER phase1_round_lock BEFORE UPDATE OR DELETE ON rounds
  FOR EACH ROW EXECUTE FUNCTION lock_phase1_metadata();
