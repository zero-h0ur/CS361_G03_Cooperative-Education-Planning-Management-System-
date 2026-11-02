CREATE TABLE committee_workspaces (
  cohort_id UUID PRIMARY KEY REFERENCES selection_cohorts(id),
  version INTEGER NOT NULL CHECK(version>0),
  state JSONB NOT NULL CHECK(jsonb_typeof(state)='object')
);
CREATE TABLE committee_workspace_events (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  cohort_id UUID NOT NULL REFERENCES selection_cohorts(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  request_hash CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER committee_events_immutable BEFORE UPDATE OR DELETE ON committee_workspace_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
