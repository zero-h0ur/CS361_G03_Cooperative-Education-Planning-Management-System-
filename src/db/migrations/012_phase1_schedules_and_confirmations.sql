-- Phase 1 application schedule, confirmation deadline, decision outcomes,
-- audit events and in-app notifications.
ALTER TABLE phase1_cycle_windows ADD COLUMN confirmation_opens_at TIMESTAMPTZ;
ALTER TABLE phase1_cycle_windows ADD COLUMN confirmation_closes_at TIMESTAMPTZ;
ALTER TABLE phase1_cycle_windows ADD COLUMN announced_at TIMESTAMPTZ;
ALTER TABLE phase1_cycle_windows ADD COLUMN announced_by UUID REFERENCES users(id);
ALTER TABLE phase1_cycle_windows ADD COLUMN near_deadline_hours INTEGER NOT NULL DEFAULT 48 CHECK (near_deadline_hours BETWEEN 1 AND 720);
ALTER TABLE phase1_cycle_windows ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE phase1_cycle_windows ADD COLUMN updated_by UUID REFERENCES users(id);

ALTER TABLE phase1_cycle_windows ADD CONSTRAINT chk_phase1_cycle_windows_confirmation CHECK (
  confirmation_closes_at IS NULL OR (
    confirmation_opens_at IS NOT NULL
    AND confirmation_closes_at > confirmation_opens_at
    AND confirmation_closes_at > closes_at
  )
);

ALTER TABLE phase1_cycle_windows ADD CONSTRAINT chk_phase1_cycle_windows_announced CHECK (
  announced_at IS NULL OR (
    confirmation_opens_at IS NULL OR confirmation_opens_at >= announced_at
  )
);

CREATE TABLE phase1_selection_results (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES rounds(id),
  application_id UUID REFERENCES phase1_applications(id),
  plan_id UUID REFERENCES plans(id),
  student_id UUID NOT NULL REFERENCES students(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('SELECTED','NOT_SELECTED')),
  confirmation_status TEXT CHECK (
    (outcome = 'NOT_SELECTED' AND confirmation_status IS NULL) OR
    (outcome = 'SELECTED' AND confirmation_status IN ('PENDING_CONFIRMATION','CONFIRMED','WAIVED','AUTO_WAIVED','TEAM_JOINED'))
  ),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by UUID REFERENCES users(id),
  announced_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  auto_waived_at TIMESTAMPTZ,
  team_joined_at TIMESTAMPTZ,
  response_notes TEXT CHECK (response_notes IS NULL OR (length(btrim(response_notes)) <= 1000)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cycle_id, student_id)
);

CREATE INDEX phase1_selection_results_cycle ON phase1_selection_results(cycle_id, outcome, confirmation_status);
CREATE INDEX phase1_selection_results_student ON phase1_selection_results(student_id);

CREATE TABLE phase1_schedule_events (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES rounds(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'SCHEDULE_UPDATED',
    'RESULTS_ANNOUNCED',
    'CONFIRMATION_SUBMITTED',
    'CONFIRMATION_WAIVED',
    'CONFIRMATION_AUTO_WAIVED',
    'TEAM_JOINED_CONFIRMED'
  )),
  actor_id UUID REFERENCES users(id),
  actor_role TEXT CHECK (actor_role IN ('STUDENT','COORDINATOR','COMMITTEE','SYSTEM','ADMIN','STAFF')),
  student_id UUID REFERENCES students(id),
  operation_id UUID,
  payload JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX phase1_schedule_events_cycle ON phase1_schedule_events(cycle_id, created_at DESC);
CREATE INDEX phase1_schedule_events_student ON phase1_schedule_events(student_id, created_at DESC);

CREATE TABLE phase1_notifications (
  id UUID PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES rounds(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('STUDENT','COORDINATOR','COMMITTEE')),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'APPLICATION_WINDOW_OPEN',
    'APPLICATION_NEAR_DEADLINE',
    'APPLICATION_DEADLINE_EXPIRED',
    'APPLICATION_NEEDS_REVISION',
    'SELECTION_ANNOUNCED',
    'CONFIRMATION_NEAR_DEADLINE',
    'CONFIRMATION_AUTO_WAIVED',
    'CONFIRMATION_RECEIVED'
  )),
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 200),
  message TEXT NOT NULL CHECK (length(btrim(message)) > 0 AND length(message) <= 1000),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX phase1_notifications_recipient ON phase1_notifications(recipient_user_id, read_at, created_at DESC);
