-- Run as the table owner after migration 002. Changes ACLs only, never data.
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
GRANT SELECT ON TABLE
  public.companies, public.positions, public.rounds, public.document_metadata,
  public.users, public.external_identity_links, public.students, public.plans,
  public.advisor_assignments, public.staff_scopes, public.plan_operations,
  public.audit_events, public.document_policies, public.plan_submissions,
  public.placements, public.workflow_receipts, public.workflow_events TO coed_app;
GRANT INSERT, UPDATE ON public.plans TO coed_app;
GRANT UPDATE (preferred_name, contact_address, contact_phone, version, updated_at) ON public.students TO coed_app;
GRANT UPDATE (updated_at) ON public.staff_scopes TO coed_app;
GRANT INSERT, UPDATE ON public.advisor_assignments, public.placements TO coed_app;
GRANT INSERT ON public.document_policies, public.plan_submissions,
  public.workflow_receipts, public.workflow_events TO coed_app;
-- Migration 002's Student trigger SELECTs users FOR UPDATE. PostgreSQL requires
-- UPDATE on at least one column for that lock; never grant role/account mutation.
GRANT UPDATE (updated_at) ON public.users TO coed_app;
GRANT INSERT ON public.plan_operations, public.audit_events TO coed_app;

DO $acl$
BEGIN
  IF has_table_privilege('coed_app','public.audit_events','DELETE')
     OR has_table_privilege('coed_app','public.audit_events','UPDATE')
     OR has_table_privilege('coed_app','public.audit_events','TRUNCATE')
     OR has_table_privilege('coed_app','public.plan_operations','DELETE')
     OR has_table_privilege('coed_app','public.plan_operations','UPDATE')
     OR has_column_privilege('coed_app','public.users','role','UPDATE')
     OR has_column_privilege('coed_app','public.users','account_status','UPDATE')
     OR has_column_privilege('coed_app','public.students','full_name','UPDATE')
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
