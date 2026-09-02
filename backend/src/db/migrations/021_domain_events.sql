-- Durable domain events for automations and outbound integrations.
--
-- A mutation is already committed by the time its event is published.  The row
-- below is the durable hand-off to the worker: a process restart can delay an
-- automation, but it can no longer make the event disappear.
CREATE TABLE IF NOT EXISTS domain_events (
  id            BIGSERIAL PRIMARY KEY,
  event_key     TEXT NOT NULL UNIQUE,
  event_type    TEXT NOT NULL,
  contact_id    INT REFERENCES contacts(id) ON DELETE CASCADE,
  email         CITEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT '',
  subject_id    INT,
  source        TEXT NOT NULL DEFAULT '',
  facts         JSONB NOT NULL DEFAULT '{}',
  processed_at  TIMESTAMPTZ,
  last_error    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_events_unprocessed
  ON domain_events (created_at) WHERE processed_at IS NULL;

-- A queue lease can expire after the automation actions have completed but
-- before the event row is stamped.  This key makes that replay harmless: one
-- automation gets at most one run for one domain event.
ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_event
  ON automation_runs (automation_id, event_key)
  WHERE event_key IS NOT NULL AND NOT is_test;

-- One business occurrence creates at most one delivery per subscribed endpoint.
-- This closes the crash window between recording/queueing deliveries and
-- marking the parent domain event processed.
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON webhook_deliveries (endpoint_id, event_type, event_key)
  WHERE event_key IS NOT NULL;

-- Sweep events whose enqueue was interrupted between the durable INSERT and
-- the queue write.  The handler itself remains the authority for processed_at.
INSERT INTO job_schedules (name, kind, every_minutes, timezone, enabled)
VALUES ('domain-events-sweep', 'domainEvents.sweep', 5, 'UTC', true)
ON CONFLICT (name) DO UPDATE SET
  kind = EXCLUDED.kind,
  every_minutes = EXCLUDED.every_minutes,
  daily_at_minute = NULL,
  timezone = EXCLUDED.timezone,
  enabled = true,
  updated_at = now();

INSERT INTO job_schedules (name, kind, daily_at_minute, timezone, enabled)
VALUES ('contact-anniversaries', 'domainEvents.anniversaries', 15, 'UTC', true)
ON CONFLICT (name) DO UPDATE SET
  kind = EXCLUDED.kind,
  every_minutes = NULL,
  daily_at_minute = EXCLUDED.daily_at_minute,
  timezone = EXCLUDED.timezone,
  enabled = true,
  updated_at = now();
