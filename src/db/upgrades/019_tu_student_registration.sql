-- Forward-only from the reviewed observed018 lineage. Never replay historical SQL.
DO $$ BEGIN
 IF current_setting('coed.registration_upgrade',true) IS DISTINCT FROM 'observed018-to019'
  OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='018_observed_tu_delivery.sql'
    AND checksum='1b5712d287ad44ef745a0f4c862df53b17aa9586329aa5487faf8d1bb65109e0')
  OR to_regclass('public.tu_student_registrations') IS NOT NULL THEN
  RAISE EXCEPTION 'REGISTRATION_UPGRADE_GATE_REQUIRED';
 END IF;
END $$;

CREATE ROLE coed_tu_registration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE coed_tu_registration NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
COMMENT ON ROLE coed_tu_registration_owner IS 'COED_TU_REGISTRATION_V1_FUNCTION_OWNER';
COMMENT ON ROLE coed_tu_registration IS 'COED_TU_REGISTRATION_V1_EXECUTE_ONLY';
GRANT USAGE ON SCHEMA public TO coed_tu_registration_owner,coed_tu_registration;
-- RDS postgres is not a PostgreSQL superuser. Temporary membership/schema CREATE
-- is used only for ownership transfer in this owner transaction and revoked below.
GRANT CREATE ON SCHEMA public TO coed_tu_registration_owner;
GRANT coed_tu_registration_owner TO postgres;
DO $$ BEGIN
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO coed_tu_registration',current_database());
END $$;

ALTER TABLE public.students ADD COLUMN identity_source TEXT NOT NULL DEFAULT 'CANONICAL'
 CHECK(identity_source IN ('CANONICAL','TU_ONBOARDING'));
ALTER TABLE public.students DROP CONSTRAINT chk_students_linked_profile_complete;
ALTER TABLE public.students ADD CONSTRAINT chk_students_linked_profile_complete CHECK (
 (identity_source='CANONICAL' AND (user_id IS NULL OR (
  student_number IS NOT NULL AND length(btrim(student_number))>0 AND full_name IS NOT NULL AND length(btrim(full_name))>0
  AND institutional_email IS NOT NULL AND length(btrim(institutional_email))>0
  AND department IS NOT NULL AND length(btrim(department))>0 AND program IS NOT NULL AND length(btrim(program))>0
  AND major IS NOT NULL AND length(btrim(major))>0 AND academic_year IS NOT NULL AND enrollment_status IS NOT NULL)))
 OR (identity_source='TU_ONBOARDING' AND user_id IS NOT NULL AND student_number ~ '^[0-9]{10}$'
  AND full_name IS NOT NULL AND length(btrim(full_name))>0 AND institutional_email IS NOT NULL
  AND length(btrim(institutional_email))>0 AND enrollment_status='ACTIVE'
  AND department IS NULL AND program IS NULL AND major IS NULL AND academic_year IS NULL
  AND source='TU_VERIFIED' AND data_status='to_validate'));
-- Only the new provenance-backed model may contain genuine, not-mock identity.
ALTER TABLE public.students DROP CONSTRAINT students_data_status_check;
ALTER TABLE public.students ADD CONSTRAINT students_data_status_check CHECK (
 (identity_source='CANONICAL' AND data_status='mock') OR (identity_source='TU_ONBOARDING' AND data_status='to_validate'));

CREATE TABLE public.tu_student_registrations (
 student_id UUID PRIMARY KEY REFERENCES public.students(id),
 user_id UUID NOT NULL UNIQUE REFERENCES public.users(id),
 subject TEXT NOT NULL UNIQUE CHECK(subject ~ '^[0-9]{10}$'),
 identity JSONB NOT NULL CHECK(jsonb_typeof(identity)='object'),
 program_type TEXT NOT NULL CHECK(program_type IN ('regular','special')),
 entry_year INTEGER NOT NULL CHECK(entry_year BETWEEN 2500 AND 2700),
 study_source TEXT NOT NULL DEFAULT 'self_reported' CHECK(study_source='self_reported'),
 academic_verification TEXT NOT NULL DEFAULT 'pending' CHECK(academic_verification='pending'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.tu_registration_receipts (
 jti UUID PRIMARY KEY, operation_id UUID NOT NULL UNIQUE,
 request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 student_id UUID NOT NULL REFERENCES public.students(id), user_id UUID NOT NULL REFERENCES public.users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Production has default CRUD grants to coed_app. Remove those ONLY from these
-- newly created tables, then grant the reviewed read columns below. Do not alter
-- global/default grants or any existing table permissions.
REVOKE ALL ON public.tu_student_registrations,public.tu_registration_receipts
 FROM PUBLIC,coed_app,coed_tu_login,coed_tu_registration;
CREATE TRIGGER tu_registrations_immutable BEFORE UPDATE OR DELETE ON public.tu_student_registrations
 FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_row_mutation();
CREATE TRIGGER tu_registration_receipts_immutable BEFORE UPDATE OR DELETE ON public.tu_registration_receipts
 FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_row_mutation();

CREATE FUNCTION public.guard_tu_registration_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.identity_source='TU_ONBOARDING' AND NOT EXISTS(
  SELECT 1 FROM public.tu_student_registrations r JOIN public.users u ON u.id=r.user_id
  JOIN public.external_identity_links l ON l.user_id=u.id AND l.external_issuer='urn:coed:tu-auth'
   AND l.external_subject=r.subject AND l.status='ACTIVE'
  WHERE r.student_id=NEW.id AND r.user_id=NEW.user_id AND r.subject=NEW.student_number
   AND r.identity->>'subject'=NEW.student_number AND r.identity->>'nameTh'=NEW.full_name
   AND r.identity->>'email'=NEW.institutional_email AND r.identity->>'tuStatus'='ปกติ'
   AND r.identity->>'statusId' IS DISTINCT FROM '40' AND u.role='STUDENT') THEN
  RAISE EXCEPTION 'Registration provenance required' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tu_registration_profile_required AFTER INSERT OR UPDATE ON public.students
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_tu_registration_profile();

CREATE FUNCTION public.complete_tu_registration(p_issuer TEXT,p_jti UUID,p_operation UUID,p_identity JSONB,
 p_program TEXT,p_year INTEGER,p_expires TIMESTAMPTZ) RETURNS TABLE(user_id UUID,student_id UUID)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_subject TEXT; v_user UUID; v_student UUID; v_hash TEXT; v_receipt public.tu_registration_receipts;
BEGIN
 IF p_issuer IS DISTINCT FROM 'urn:coed:tu-auth' OR p_jti IS NULL OR p_operation IS NULL
  OR p_program IS NULL OR p_program NOT IN ('regular','special') OR p_year IS NULL OR p_year NOT BETWEEN 2500 AND 2700
  OR p_expires IS NULL OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '305 seconds'
  OR p_identity IS NULL OR jsonb_typeof(p_identity)<>'object'
  OR (SELECT count(*) FROM jsonb_object_keys(p_identity))<>8
  OR NOT p_identity ?& ARRAY['subject','nameTh','nameEn','email','faculty','department','tuStatus','statusId']
 THEN RAISE EXCEPTION 'Registration rejected'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_identity) e WHERE
   (e.key IN ('nameEn','statusId') AND jsonb_typeof(e.value) NOT IN ('string','null'))
   OR (e.key NOT IN ('nameEn','statusId') AND jsonb_typeof(e.value)<>'string')
   OR (jsonb_typeof(e.value)='string' AND (length(e.value #>> '{}') NOT BETWEEN 1 AND 500
    OR e.value #>> '{}' <> btrim(e.value #>> '{}') OR e.value #>> '{}' ~ '[[:cntrl:]]')))
  OR p_identity->>'subject' !~ '^[0-9]{10}$' OR p_identity->>'tuStatus' IS DISTINCT FROM 'ปกติ'
  OR p_identity->>'statusId'='40' OR p_identity->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 THEN RAISE EXCEPTION 'Registration rejected'; END IF;
 v_subject:=p_identity->>'subject';
 -- Shared subject lock serializes all new-account attempts; unique indexes remain final guards.
 PERFORM pg_advisory_xact_lock(hashtextextended('coed-tu-registration:'||v_subject,0));
 v_hash:=encode(sha256(convert_to(jsonb_build_array(p_issuer,p_jti,p_operation,p_identity,p_program,p_year)::text,'UTF8')),'hex');
 SELECT * INTO v_receipt FROM public.tu_registration_receipts r WHERE r.jti=p_jti OR r.operation_id=p_operation;
 IF FOUND THEN
  IF v_receipt.jti=p_jti AND v_receipt.operation_id=p_operation AND v_receipt.request_hash=v_hash
   AND EXISTS(SELECT 1 FROM public.students s JOIN public.users u ON u.id=s.user_id
    JOIN public.external_identity_links l ON l.user_id=u.id
    WHERE s.id=v_receipt.student_id AND u.id=v_receipt.user_id AND u.role='STUDENT' AND u.account_status='ACTIVE'
     AND s.student_number=v_subject AND s.identity_source='TU_ONBOARDING' AND l.external_issuer=p_issuer
     AND l.external_subject=v_subject AND l.status='ACTIVE') THEN
   RETURN QUERY SELECT v_receipt.user_id,v_receipt.student_id; RETURN;
  END IF;
  RAISE EXCEPTION 'Registration conflict';
 END IF;
 IF EXISTS(SELECT 1 FROM public.students s WHERE s.student_number=v_subject)
  OR EXISTS(SELECT 1 FROM public.external_identity_links l WHERE l.external_issuer=p_issuer AND l.external_subject=v_subject)
 THEN RAISE EXCEPTION 'Registration conflict'; END IF;
 v_user:=gen_random_uuid();v_student:=gen_random_uuid();
 INSERT INTO public.users(id,role,account_status) VALUES(v_user,'STUDENT','ACTIVE');
 INSERT INTO public.students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,enrollment_status,
  source,visibility,data_status,identity_source)
 VALUES(v_student,v_user,gen_random_uuid()::text,v_subject,p_identity->>'nameTh',p_identity->>'email','ACTIVE',
  'TU_VERIFIED','private','to_validate','TU_ONBOARDING');
 INSERT INTO public.external_identity_links(id,user_id,external_issuer,external_subject,status)
 VALUES(gen_random_uuid(),v_user,p_issuer,v_subject,'ACTIVE');
 INSERT INTO public.tu_student_registrations(student_id,user_id,subject,identity,program_type,entry_year)
 VALUES(v_student,v_user,v_subject,p_identity,p_program,p_year);
 INSERT INTO public.tu_registration_receipts(jti,operation_id,request_hash,student_id,user_id)
 VALUES(p_jti,p_operation,v_hash,v_student,v_user);
 INSERT INTO public.audit_events(event_id,actor_id,actor_role,action,resource_type,resource_id,correlation_id)
 VALUES(gen_random_uuid(),v_user,'STUDENT','TU_STUDENT_REGISTERED','student',v_student,p_operation);
 RETURN QUERY SELECT v_user,v_student;
END $$;
REVOKE ALL ON FUNCTION public.complete_tu_registration(TEXT,UUID,UUID,JSONB,TEXT,INTEGER,TIMESTAMPTZ) FROM PUBLIC,coed_app,coed_tu_login;
ALTER FUNCTION public.complete_tu_registration(TEXT,UUID,UUID,JSONB,TEXT,INTEGER,TIMESTAMPTZ) OWNER TO coed_tu_registration_owner;
GRANT EXECUTE ON FUNCTION public.complete_tu_registration(TEXT,UUID,UUID,JSONB,TEXT,INTEGER,TIMESTAMPTZ) TO coed_tu_registration;
-- No runtime memberships in the NOLOGIN function owner. FOR UPDATE in the existing
-- Student-role trigger requires a single-column UPDATE privilege, never exposed to login.
GRANT SELECT,INSERT ON public.users,public.students,public.external_identity_links,
 public.tu_student_registrations,public.tu_registration_receipts TO coed_tu_registration_owner;
GRANT UPDATE(id) ON public.users TO coed_tu_registration_owner;
GRANT INSERT ON public.audit_events TO coed_tu_registration_owner;
GRANT SELECT(identity_source) ON public.students TO coed_tu_login;
GRANT SELECT(student_id,user_id,identity,program_type,entry_year,study_source,academic_verification)
 ON public.tu_student_registrations TO coed_tu_login,coed_app;
REVOKE ALL ON FUNCTION public.guard_tu_registration_profile() FROM PUBLIC;
ALTER FUNCTION public.guard_tu_registration_profile() OWNER TO coed_tu_registration_owner;
REVOKE CREATE ON SCHEMA public FROM coed_tu_registration_owner;
REVOKE coed_tu_registration_owner FROM postgres;
