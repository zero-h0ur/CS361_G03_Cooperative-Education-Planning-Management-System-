-- RETIRED: this former hand-written deploy bundle duplicated migrations,
-- recorded unrelated checksums and provisioned synthetic verified academic data.
-- It must not be used against any database. Inspect actual lineage first, then
-- use the checksum-reviewed migration runner and separately reviewed runtime ACL.
-- No production upgrade path is implied by local workspace migration 017.
\set ON_ERROR_STOP on
DO $$ BEGIN
  RAISE EXCEPTION 'Retired unsafe deployment script. Use reviewed migrations after schema/lineage review.';
END $$;
