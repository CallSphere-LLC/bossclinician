-- =============================================================================
-- Phase 10.5 — background job queue
--
-- Pulled ahead of the rest of Phase 10 because four phases are waiting on it:
-- sequences and broadcasts (5) need to send on a schedule, contacts (4) need
-- activity rollups, affiliates (8) need commission accrual, and reports (9) need
-- nightly aggregates. Every one of them is otherwise forced to do its work
-- inside a request, which is how a page load ends up sending four hundred
-- emails.
--
-- Postgres rather than Redis: this deployment already has one database to back
-- up and one to lose, and `FOR UPDATE SKIP LOCKED` gives a correct
-- multi-consumer queue without a second piece of infrastructure. The volume
-- here — a few thousand emails on a launch day — is nowhere near where that
-- stops being true.
-- =============================================================================

CREATE TABLE jobs (
  id             BIGSERIAL PRIMARY KEY,
  kind           TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}',

  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','succeeded','failed','dead','cancelled')),
  -- Higher runs first. Ordinary work is 0; a password-reset email jumps ahead of
  -- a ten-thousand-recipient broadcast that was queued first.
  priority       INT NOT NULL DEFAULT 0,

  run_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts       INT NOT NULL DEFAULT 0,
  max_attempts   INT NOT NULL DEFAULT 5,

  -- Set while a worker holds it. A row whose lease has expired is reclaimable:
  -- that is what stops a crashed worker from stranding a job forever.
  locked_at      TIMESTAMPTZ,
  locked_by      TEXT,
  lease_expires_at TIMESTAMPTZ,

  last_error     TEXT NOT NULL DEFAULT '',
  result         JSONB,

  /**
   * Deduplication key.
   *
   * Two callers asking for the same work — "send sequence email 3 to contact
   * 91", enqueued by both the scheduler and a manual retry — must produce one
   * job. Partial-unique on the live states only, so the same key can legitimately
   * be enqueued again once the earlier one has finished.
   */
  dedupe_key     TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ
);

-- The claim query's index: ready work, best-first. Partial so the millions of
-- finished rows a busy month leaves behind cost nothing to skip.
CREATE INDEX idx_jobs_ready ON jobs (priority DESC, run_at, id)
  WHERE status IN ('queued', 'running');

CREATE UNIQUE INDEX idx_jobs_dedupe ON jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE INDEX idx_jobs_kind ON jobs (kind, status, created_at DESC);
-- The dead-letter view the brief asks for.
CREATE INDEX idx_jobs_dead ON jobs (finished_at DESC) WHERE status = 'dead';

/**
 * Recurring work, in cron-ish terms the app evaluates itself.
 *
 * Deliberately not a real cron expression parser: the schedules this platform
 * needs are "every N minutes" and "daily at HH:MM in a named zone", and a full
 * parser is a dependency plus a class of bug for expressiveness nothing here
 * asks for.
 */
CREATE TABLE job_schedules (
  id             SERIAL PRIMARY KEY,
  name           TEXT UNIQUE NOT NULL,
  kind           TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}',

  every_minutes  INT CHECK (every_minutes IS NULL OR every_minutes > 0),
  -- Minutes past midnight in `timezone`, for a daily schedule.
  daily_at_minute INT CHECK (daily_at_minute IS NULL OR daily_at_minute BETWEEN 0 AND 1439),
  timezone       TEXT NOT NULL DEFAULT 'America/New_York',

  enabled        BOOLEAN NOT NULL DEFAULT true,
  last_run_at    TIMESTAMPTZ,
  next_run_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT schedule_has_a_cadence CHECK (
    (every_minutes IS NOT NULL AND daily_at_minute IS NULL) OR
    (every_minutes IS NULL AND daily_at_minute IS NOT NULL)
  )
);

CREATE INDEX idx_job_schedules_due ON job_schedules (next_run_at) WHERE enabled;

-- The recurring work the platform needs from day one. Enqueued by name, so a
-- deploy that renames a handler shows up as a job failing rather than as work
-- quietly never happening again.
INSERT INTO job_schedules (name, kind, every_minutes, daily_at_minute, timezone) VALUES
  ('sequence-tick',        'sequence.tick',        5,    NULL, 'America/New_York'),
  ('broadcast-tick',       'broadcast.tick',       5,    NULL, 'America/New_York'),
  ('abandoned-cart-sweep', 'checkout.abandoned',   30,   NULL, 'America/New_York'),
  ('stale-order-sweep',    'orders.sweepStale',    60,   NULL, 'America/New_York'),
  ('plan-default-sweep',   'plans.sweepDefaulted', 360,  NULL, 'America/New_York'),
  ('access-expiry-sweep',  'access.sweepExpired',  360,  NULL, 'America/New_York'),
  ('coaching-reminders',   'coaching.reminders',   15,   NULL, 'America/New_York'),
  ('event-reminders',      'events.reminders',     15,   NULL, 'America/New_York'),
  ('webhook-retry',        'webhooks.retry',       5,    NULL, 'America/New_York'),
  ('report-rollup',        'reports.rollup',       NULL, 180,  'America/New_York'),
  ('community-digest',     'community.digest',     NULL, 480,  'America/New_York'),
  ('job-retention',        'jobs.retention',       NULL, 210,  'America/New_York')
ON CONFLICT (name) DO NOTHING;
