-- Run as the table owner after all checked-in migrations. Changes ACLs only, never data.
-- No CASCADE or PUBLIC revocation: inherited/external grants require review.
\set ON_ERROR_STOP on
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE
  public.companies, public.positions, public.rounds, public.document_metadata,
  public.users, public.external_identity_links, public.students, public.plans,
  public.advisor_assignments, public.staff_scopes, public.plan_operations,
  public.audit_events, public.document_policies, public.plan_submissions,
  public.placements, public.workflow_receipts, public.workflow_events FROM coed_app;
REVOKE CREATE ON SCHEMA public FROM coed_app;
GRANT USAGE ON SCHEMA public TO coed_app;
REVOKE ALL PRIVILEGES ON public.selection_cohorts, public.selection_receipts, public.selection_opinions FROM coed_app;
GRANT SELECT ON public.selection_cohorts, public.selection_receipts, public.selection_opinions TO coed_app;
-- PostgreSQL requires UPDATE on one column for SELECT ... FOR SHARE. Locking
-- the assigned cohort prevents authorization changes during a review command;
-- grant only non-authorization metadata, never assignment/panel/status columns.
GRANT UPDATE (created_at) ON public.selection_cohorts TO coed_app;
GRANT INSERT ON public.selection_receipts, public.selection_opinions TO coed_app;
GRANT SELECT, INSERT, UPDATE ON public.committee_workspaces TO coed_app;
GRANT SELECT, INSERT ON public.committee_workspace_events TO coed_app;
-- Admin operational metadata, never a right to run migrations.
GRANT SELECT ON public.schema_migrations TO coed_app;
GRANT SELECT ON TABLE
  public.companies, public.positions, public.rounds, public.document_metadata,
  public.users, public.external_identity_links, public.students, public.plans,
  public.advisor_assignments, public.staff_scopes, public.plan_operations,
  public.audit_events, public.document_policies, public.plan_submissions,
  public.placements, public.workflow_receipts, public.workflow_events TO coed_app;
GRANT INSERT, UPDATE ON public.plans TO coed_app;
GRANT UPDATE (contact_address, contact_phone, contact_email, version, updated_at) ON public.students TO coed_app;
GRANT UPDATE (updated_at) ON public.staff_scopes TO coed_app;
GRANT INSERT, UPDATE ON public.advisor_assignments, public.placements TO coed_app;
GRANT INSERT ON public.document_policies, public.plan_submissions,
  public.workflow_receipts, public.workflow_events TO coed_app;
-- Migration 002's Student trigger SELECTs users FOR UPDATE. PostgreSQL requires
-- UPDATE on at least one column for that lock; never grant role/account mutation.
GRANT UPDATE (updated_at) ON public.users TO coed_app;
GRANT INSERT ON public.plan_operations, public.audit_events TO coed_app;

REVOKE ALL PRIVILEGES ON public.phase1_academic_profiles, public.phase1_policies,
  public.phase1_cycle_windows, public.phase1_applications, public.phase1_uploads,
  public.phase1_documents, public.phase1_attachments, public.phase1_submissions,
  public.phase1_operations, public.phase1_events FROM coed_app;
GRANT SELECT ON public.phase1_academic_profiles, public.phase1_policies,
  public.phase1_cycle_windows, public.phase1_applications, public.phase1_uploads,
  public.phase1_documents, public.phase1_attachments, public.phase1_submissions,
  public.phase1_operations, public.phase1_events TO coed_app;
GRANT INSERT ON public.phase1_applications, public.phase1_uploads, public.phase1_documents,
  public.phase1_attachments, public.phase1_submissions, public.phase1_operations,
  public.phase1_events TO coed_app;
GRANT UPDATE(payload,status,version,submitted_at,updated_at) ON public.phase1_applications TO coed_app;
GRANT UPDATE(status) ON public.phase1_uploads TO coed_app;
GRANT UPDATE(document_id) ON public.phase1_attachments TO coed_app;
REVOKE ALL PRIVILEGES ON public.phase1_reviews, public.coordinator_round_schedules, public.coordinator_operations FROM coed_app;
GRANT SELECT, INSERT ON public.phase1_reviews, public.coordinator_round_schedules, public.coordinator_operations TO coed_app;
GRANT UPDATE(submission_id,state,version,reason,actor_id,updated_at) ON public.phase1_reviews TO coed_app;
GRANT UPDATE(review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by,updated_at)
  ON public.coordinator_round_schedules TO coed_app;
-- Scoped, versioned Coordinator schedule commands own these timestamps.
GRANT INSERT ON public.phase1_cycle_windows TO coed_app;
GRANT UPDATE(opens_at,closes_at,confirmation_opens_at,confirmation_closes_at,announced_at,announced_by,
  near_deadline_hours,updated_at,updated_by,version) ON public.phase1_cycle_windows TO coed_app;
REVOKE ALL PRIVILEGES ON public.phase1_selection_results, public.phase1_schedule_events, public.phase1_notifications FROM coed_app;
GRANT SELECT ON public.phase1_selection_results, public.phase1_schedule_events, public.phase1_notifications TO coed_app;
-- Results are provisioned by a separately approved decision command/operator,
-- never by the web runtime. Runtime may announce and update response state only.
GRANT UPDATE(confirmation_status,announced_at,responded_at,auto_waived_at,team_joined_at,response_notes,version,updated_at)
  ON public.phase1_selection_results TO coed_app;
GRANT INSERT ON public.phase1_schedule_events, public.phase1_notifications TO coed_app;
GRANT UPDATE(read_at) ON public.phase1_notifications TO coed_app;

REVOKE ALL PRIVILEGES ON public.phase1_submission_deliveries, public.tu_identity_link_events FROM coed_app;
GRANT SELECT ON public.phase1_submission_deliveries TO coed_app;
GRANT INSERT(submission_id,application_id,application_version,cohort_id,coordinator_id_at_send,department,program,snapshot_checksum)
  ON public.phase1_submission_deliveries TO coed_app;

DO $acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='upsert_tu_student_identity'
      AND has_function_privilege('coed_app',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Retired TU provisioning remains executable; review inherited grants before release.';
  END IF;
  IF has_table_privilege('coed_app','public.audit_events','DELETE')
     OR has_table_privilege('coed_app','public.phase1_submission_deliveries','UPDATE,DELETE,TRUNCATE')
     OR has_any_column_privilege('coed_app','public.phase1_submission_deliveries','UPDATE')
     OR has_column_privilege('coed_app','public.phase1_submission_deliveries','provenance','INSERT')
     OR has_table_privilege('coed_app','public.tu_identity_link_events','INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('coed_app','public.audit_events','UPDATE')
     OR has_table_privilege('coed_app','public.phase1_selection_results','INSERT,DELETE,TRUNCATE')
     OR has_column_privilege('coed_app','public.phase1_selection_results','outcome','UPDATE')
     OR has_table_privilege('coed_app','public.phase1_schedule_events','UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('coed_app','public.phase1_notifications','DELETE,TRUNCATE')
     OR has_column_privilege('coed_app','public.phase1_notifications','recipient_user_id','UPDATE')
     OR has_table_privilege('coed_app','public.audit_events','TRUNCATE')
     OR has_table_privilege('coed_app','public.plan_operations','DELETE')
     OR has_table_privilege('coed_app','public.plan_operations','UPDATE')
     OR has_column_privilege('coed_app','public.users','role','UPDATE')
     OR has_column_privilege('coed_app','public.users','account_status','UPDATE')
     OR has_column_privilege('coed_app','public.selection_cohorts','coordinator_id','UPDATE')
     OR has_column_privilege('coed_app','public.selection_cohorts','committee_one','UPDATE')
     OR has_column_privilege('coed_app','public.selection_cohorts','committee_two','UPDATE')
     OR has_column_privilege('coed_app','public.selection_cohorts','committee_three','UPDATE')
     OR has_column_privilege('coed_app','public.selection_cohorts','status','UPDATE')
     OR has_column_privilege('coed_app','public.students','full_name','UPDATE')
     OR has_table_privilege('coed_app','public.phase1_policies','INSERT,UPDATE,DELETE')
     OR has_table_privilege('coed_app','public.phase1_academic_profiles','INSERT,UPDATE,DELETE')
     OR has_table_privilege('coed_app','public.phase1_documents','UPDATE,DELETE')
     OR has_table_privilege('coed_app','public.phase1_submissions','UPDATE,DELETE')
     OR has_any_column_privilege('coed_app','public.phase1_policies','INSERT,UPDATE')
     OR has_any_column_privilege('coed_app','public.phase1_academic_profiles','INSERT,UPDATE')
     OR has_column_privilege('coed_app','public.phase1_cycle_windows','cycle_id','UPDATE')
     OR has_table_privilege('coed_app','public.phase1_cycle_windows','DELETE,TRUNCATE')
     OR has_table_privilege('coed_app','public.coordinator_operations','UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('coed_app','public.phase1_reviews','DELETE,TRUNCATE')
     OR has_any_column_privilege('coed_app','public.phase1_documents','UPDATE')
     OR has_any_column_privilege('coed_app','public.phase1_submissions','UPDATE')
     OR has_table_privilege('coed_app','public.phase1_documents','TRUNCATE')
     OR has_table_privilege('coed_app','public.phase1_submissions','TRUNCATE')
     OR has_schema_privilege('coed_app','public','CREATE') THEN
    RAISE EXCEPTION 'Excess effective privileges remain; all ACL changes rolled back. Review PUBLIC or other grantors, do not use CASCADE.';
  END IF;
END
$acl$;
COMMIT;

SELECT
  has_table_privilege('coed_app','public.external_identity_links','SELECT') AS can_read_identity,
  has_table_privilege('coed_app','public.plans','INSERT,UPDATE') AS can_write_plan,
  has_table_privilege('coed_app','public.audit_events','INSERT') AS can_append_audit,
  has_table_privilege('coed_app','public.audit_events','DELETE') AS can_delete_audit,
  has_column_privilege('coed_app','public.users','role','UPDATE') AS can_change_role;
