-- Narrow cutover delta. Owner only, INSIDE the upgrade transaction.
-- No data writes, PUBLIC/CASCADE revokes, role creation or unrelated ACL reset.
-- External 013-015 result/notification/announcement privileges stay untouched.
REVOKE ALL PRIVILEGES ON public.phase1_reviews FROM coed_app;
-- The recorded external ACL grants UPDATE/DELETE on this already-immutable
-- audit table. Tighten only those ineffective write rights, retain append/read.
REVOKE UPDATE,DELETE,TRUNCATE ON public.committee_workspace_events FROM coed_app;
DO $archive_acl$
DECLARE c record;
BEGIN
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.committee_workspace_events'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE UPDATE (%I) ON public.committee_workspace_events FROM coed_app',c.attname);
  END LOOP;
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.phase1_reviews'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.phase1_reviews FROM coed_app',c.attname,c.attname,c.attname);
  END LOOP;
  IF to_regclass('public.coordinator_round_schedules') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.coordinator_round_schedules FROM coed_app;
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.coordinator_round_schedules'::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.coordinator_round_schedules FROM coed_app',c.attname,c.attname,c.attname);
    END LOOP;
    GRANT SELECT ON public.coordinator_round_schedules TO coed_app;
  END IF;
END $archive_acl$;
GRANT SELECT ON public.phase1_reviews,public.coordinator_reviews,public.coordinator_operations TO coed_app;
GRANT INSERT(application_id,submission_id,cohort_id,state,version,reason,actor_id,updated_at) ON public.coordinator_reviews TO coed_app;
GRANT UPDATE(submission_id,state,version,reason,actor_id,updated_at) ON public.coordinator_reviews TO coed_app;
GRANT INSERT ON public.coordinator_operations TO coed_app;
GRANT INSERT(cycle_id,opens_at,closes_at,review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by)
  ON public.phase1_cycle_windows TO coed_app;
GRANT UPDATE(opens_at,closes_at,review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by,updated_at)
  ON public.phase1_cycle_windows TO coed_app;
-- PostgreSQL row locks require UPDATE on at least one non-authorizing column.
GRANT UPDATE(created_at) ON public.selection_cohorts TO coed_app;
GRANT UPDATE(updated_at) ON public.users TO coed_app;

DO $effective_acl$
BEGIN
  IF has_any_column_privilege('coed_app','public.phase1_reviews','INSERT,UPDATE')
    OR has_table_privilege('coed_app','public.phase1_reviews','DELETE,TRUNCATE')
    OR has_column_privilege('coed_app','public.coordinator_reviews','source_provenance','INSERT,UPDATE')
    OR has_table_privilege('coed_app','public.coordinator_reviews','DELETE,TRUNCATE')
    OR has_table_privilege('coed_app','public.coordinator_operations','UPDATE,DELETE,TRUNCATE')
    OR has_column_privilege('coed_app','public.users','role','UPDATE')
    OR has_column_privilege('coed_app','public.users','account_status','UPDATE')
    OR has_column_privilege('coed_app','public.students','full_name','UPDATE')
    OR has_column_privilege('coed_app','public.selection_cohorts','coordinator_id','UPDATE')
    OR has_column_privilege('coed_app','public.selection_cohorts','committee_one','UPDATE')
    OR has_column_privilege('coed_app','public.selection_cohorts','committee_two','UPDATE')
    OR has_column_privilege('coed_app','public.selection_cohorts','committee_three','UPDATE')
    OR has_column_privilege('coed_app','public.selection_cohorts','status','UPDATE')
    OR has_column_privilege('coed_app','public.phase1_cycle_windows','cycle_id','UPDATE')
    OR has_table_privilege('coed_app','public.phase1_cycle_windows','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.phase1_submissions','UPDATE')
    OR has_table_privilege('coed_app','public.phase1_submissions','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.phase1_documents','UPDATE')
    OR has_table_privilege('coed_app','public.phase1_documents','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.phase1_operations','UPDATE')
    OR has_table_privilege('coed_app','public.phase1_operations','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.phase1_events','UPDATE')
    OR has_table_privilege('coed_app','public.phase1_events','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.committee_workspace_events','UPDATE')
    OR has_table_privilege('coed_app','public.committee_workspace_events','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.phase1_policies','INSERT,UPDATE')
    OR has_table_privilege('coed_app','public.phase1_policies','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.phase1_academic_profiles','INSERT,UPDATE')
    OR has_table_privilege('coed_app','public.phase1_academic_profiles','DELETE,TRUNCATE')
    OR has_any_column_privilege('coed_app','public.audit_events','UPDATE')
    OR has_table_privilege('coed_app','public.audit_events','DELETE,TRUNCATE')
    OR has_schema_privilege('coed_app','public','CREATE') THEN
    RAISE EXCEPTION 'ALIGNMENT_EXCESS_EFFECTIVE_PRIVILEGES';
  END IF;
  IF to_regclass('public.coordinator_round_schedules') IS NOT NULL AND (
    has_any_column_privilege('coed_app','public.coordinator_round_schedules','INSERT,UPDATE') OR
    has_table_privilege('coed_app','public.coordinator_round_schedules','DELETE,TRUNCATE')) THEN
    RAISE EXCEPTION 'ALIGNMENT_ARCHIVE_EFFECTIVE_PRIVILEGES';
  END IF;
END $effective_acl$;
