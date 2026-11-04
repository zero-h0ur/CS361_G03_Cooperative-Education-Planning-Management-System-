-- LOCAL TEST/REVIEW ARTIFACT ONLY. Apply to production only with separate approval.
-- Run as owner, under the intended database/schema. No password in this script.
-- Initial role is NOLOGIN: an approved secure operator must enable credentials.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='coed_tu_login') THEN
    CREATE ROLE coed_tu_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOREPLICATION NOBYPASSRLS;
    COMMENT ON ROLE coed_tu_login IS 'COED_TU_LOGIN_V1_SELECT_ONLY';
  ELSIF (SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname='coed_tu_login')
      IS DISTINCT FROM 'COED_TU_LOGIN_V1_SELECT_ONLY' THEN
    RAISE EXCEPTION 'Existing role is not owned by this reviewed login-role contract';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO coed_tu_login',current_database());
END $$;
GRANT USAGE ON SCHEMA public TO coed_tu_login;
GRANT SELECT(id,role,account_status) ON public.users TO coed_tu_login;
GRANT SELECT(id,user_id,external_issuer,external_subject,status) ON public.external_identity_links TO coed_tu_login;
GRANT SELECT(id,user_id,student_number,full_name,preferred_name,institutional_email,
  department,program,major,academic_year,enrollment_status,version,
  contact_email,contact_phone,contact_address) ON public.students TO coed_tu_login;
DO $$ DECLARE login_oid oid; BEGIN
  SELECT oid INTO login_oid FROM pg_roles WHERE rolname='coed_tu_login';
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=login_oid AND
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=login_oid)
    OR has_schema_privilege('coed_tu_login','public','CREATE')
    OR has_database_privilege('coed_tu_login',current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND
      (c.relowner=login_oid OR has_table_privilege('coed_tu_login',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('coed_tu_login',c.oid,'INSERT,UPDATE,REFERENCES')))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        AND c.relname NOT IN ('users','students','external_identity_links')
        AND has_any_column_privilege('coed_tu_login',c.oid,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        AND has_column_privilege('coed_tu_login',c.oid,a.attnum,'SELECT') AND NOT (
          (c.relname='users' AND a.attname IN ('id','role','account_status')) OR
          (c.relname='external_identity_links' AND a.attname IN ('id','user_id','external_issuer','external_subject','status')) OR
          (c.relname='students' AND a.attname IN ('id','user_id','student_number','full_name','preferred_name','institutional_email',
            'department','program','major','academic_year','enrollment_status','version','contact_email','contact_phone','contact_address'))))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prorettype<>'trigger'::regtype
        AND (p.prosecdef OR NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
        AND has_function_privilege('coed_tu_login',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Excess effective login-role privileges; rollback and review PUBLIC/inherited grants separately';
  END IF;
  -- No cross-grantor revocation or destructive cleanup is performed here.
END $$;
COMMIT;
