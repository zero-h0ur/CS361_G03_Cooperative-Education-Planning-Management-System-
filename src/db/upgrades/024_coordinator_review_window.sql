-- Observed023-to024 only. No date backfill, intake change or policy publication.
DO $gate$ BEGIN
 IF current_database()<>'coed' OR current_schema()<>'public' OR current_user<>'postgres'
  OR current_setting('coed.review_schedule_upgrade',true) IS DISTINCT FROM 'observed023-to024'
  OR NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='023_phase1_academic_review.sql'
    AND checksum='68b8f3d9f4ad257868933e9e5371a256a78bd08efedf692b343bd10c1e117b9d')
  OR EXISTS(SELECT 1 FROM schema_migrations WHERE version='024_coordinator_review_window.sql')
  OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='coordinator_round_schedules'::regclass
    AND conname='coordinator_schedule_confirmation_pair')
 THEN RAISE EXCEPTION 'REVIEW_SCHEDULE_OWNER_GATE_REQUIRED'; END IF;
END $gate$;
-- Review dates may be configured before the later confirmation stage.
-- Retain all existing dates, review ordering, versions, grants and audit rows.
ALTER TABLE coordinator_round_schedules
  ALTER COLUMN confirmation_opens_at DROP NOT NULL,
  ALTER COLUMN confirmation_closes_at DROP NOT NULL;
ALTER TABLE coordinator_round_schedules ADD CONSTRAINT coordinator_schedule_confirmation_pair CHECK (
  (confirmation_opens_at IS NULL AND confirmation_closes_at IS NULL)
  OR (confirmation_opens_at IS NOT NULL AND confirmation_closes_at IS NOT NULL
    AND confirmation_opens_at >= review_closes_at AND confirmation_closes_at > confirmation_opens_at)
);
