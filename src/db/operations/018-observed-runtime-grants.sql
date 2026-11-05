-- Upgrade-only targeted ACL delta; execute in the same transaction as018.
-- No business DML, shared schema revokes, role creation or CASCADE.
REVOKE UPDATE,DELETE ON committee_workspace_events,coordinator_operations,
  coordinator_round_schedules,phase1_reviews FROM coed_app;
REVOKE DELETE ON committee_workspaces FROM coed_app;
REVOKE INSERT,UPDATE ON phase1_selection_results FROM coed_app;
-- Remove direct column grants on only the narrowed tables, then allow exactly
-- the columns used by versioned commands. Other roles/grantors are not changed.
DO $$ DECLARE t text; cols text; BEGIN
  FOREACH t IN ARRAY ARRAY['committee_workspace_events','coordinator_operations',
    'coordinator_round_schedules','phase1_reviews','phase1_selection_results'] LOOP
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols
      FROM pg_attribute WHERE attrelid=format('%I.%I',current_schema(),t)::regclass
        AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE UPDATE(%s) ON %I.%I FROM coed_app',cols,current_schema(),t);
    IF t='phase1_selection_results' THEN
      EXECUTE format('REVOKE INSERT(%s) ON %I.%I FROM coed_app',cols,current_schema(),t);
    END IF;
  END LOOP;
END $$;
GRANT UPDATE(submission_id,state,version,reason,actor_id,updated_at) ON phase1_reviews TO coed_app;
GRANT UPDATE(review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by,updated_at)
  ON coordinator_round_schedules TO coed_app;
GRANT UPDATE(confirmation_status,announced_at,responded_at,auto_waived_at,team_joined_at,response_notes,version,updated_at)
  ON phase1_selection_results TO coed_app;
REVOKE ALL PRIVILEGES ON phase1_submission_deliveries,tu_identity_link_events FROM coed_app;
GRANT SELECT ON phase1_submission_deliveries TO coed_app;
GRANT INSERT(submission_id,application_id,application_version,cohort_id,coordinator_id_at_send,department,program,snapshot_checksum)
  ON phase1_submission_deliveries TO coed_app;
