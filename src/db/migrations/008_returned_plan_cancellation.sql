-- Retain previously submitted review history. New drafts remain soft-cancellable.
-- Add a guard instead of rewriting existing records or historical migrations.
CREATE FUNCTION guard_returned_plan_cancellation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'NEEDS_REVISION' AND NEW.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Returned plans must be revised or resubmitted, not cancelled'
      USING ERRCODE = '23514', CONSTRAINT = 'returned_plan_cannot_cancel';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER returned_plan_cancellation_guard BEFORE UPDATE OF status ON plans
  FOR EACH ROW EXECUTE FUNCTION guard_returned_plan_cancellation();
