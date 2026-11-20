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
