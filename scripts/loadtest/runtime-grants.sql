-- ONLY the new synthetic test DB, never production runtime grants.
-- No BEGIN/COMMIT here: the guarded local bootstrap owns the transaction.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM coed_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO coed_app;
GRANT SELECT ON public.companies,public.positions,public.rounds,public.users,
  public.external_identity_links,public.students,public.plans,
  public.plan_operations,public.audit_events,public.schema_migrations TO coed_app;
GRANT INSERT,UPDATE ON public.plans TO coed_app;
GRANT INSERT ON public.plan_operations,public.audit_events TO coed_app;
-- Existing Student trigger locks its user row; never grant role/status updates.
GRANT UPDATE(updated_at) ON public.users TO coed_app;
