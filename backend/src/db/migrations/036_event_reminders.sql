-- =============================================================================
-- Event reminders — configuration, and a per-registrant record of what went out
--
-- The public event page has always said "I'll hold you a place and remind you
-- before we start", and the confirmation said "I'll send you a reminder before
-- we begin". Neither was configurable and neither was observable: three
-- hard-coded steps lived in a job file, stamped a timestamp column on the
-- registration, and left no way to tell a reminder that reached somebody from
-- one the mail provider refused. With SES currently rejecting everything at the
-- account level, that distinction is the whole difference between a working
-- feature and a silent one.
--
-- Two tables, because they answer two different questions. `event_reminders` is
-- what the owner configured. `event_reminder_sends` is what happened to one
-- person for one session — the idempotency key and the audit trail in the same
-- row.
-- =============================================================================

-- --- configuration -----------------------------------------------------------

/**
 * One reminder on one event.
 *
 * `kind` splits the two things a reminder can be measured from. 'registration'
 * fires when somebody signs up, which is a confirmation. 'before' fires a fixed
 * distance ahead of that registrant's own session — their own, because an
 * evergreen event gives every registrant a different one.
 *
 * Several rows per event is the natural model: "the day before" and "an hour
 * before" are different emails with different jobs, and a single
 * reminder_hours column would have forced a choice between them.
 */
CREATE TABLE event_reminders (
  id             SERIAL PRIMARY KEY,
  event_id       INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  kind           TEXT NOT NULL CHECK (kind IN ('registration', 'before')),
  -- Minutes before the session starts. 0 on a 'before' row means "as it
  -- starts", which is a different and deliberate reminder from the hour-before
  -- one. Capped at four weeks: further out than that and the reminder arrives
  -- before the reader has any idea what it is about.
  offset_minutes INT NOT NULL DEFAULT 0
                   CHECK (offset_minutes >= 0 AND offset_minutes <= 40320),

  -- Blank means "use the wording the platform writes for this offset", which is
  -- what almost every event will want. A filled-in subject or body overrides it
  -- and may use the same {{firstName}} / {{eventTitle}} / {{sessionLabel}} /
  -- {{joinLink}} tokens the rest of the mail path understands.
  subject        TEXT NOT NULL DEFAULT '',
  body_md        TEXT NOT NULL DEFAULT '',

  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reminder_shape CHECK (
    kind <> 'registration' OR offset_minutes = 0
  )
);

-- One reminder per slot per event, so a double-click in the editor cannot
-- configure "24 hours before" twice and mail everybody twice.
CREATE UNIQUE INDEX idx_event_reminders_slot
  ON event_reminders (event_id, kind, offset_minutes);

-- --- delivery ----------------------------------------------------------------

/**
 * One reminder, one registrant, one session.
 *
 * The unique index is the idempotency guarantee, and it is deliberately three
 * columns rather than two: `session_at` is on the row because a registrant who
 * signs up again for a later evergreen session must get a fresh set of
 * reminders rather than inherit the stamps from the session they missed. The
 * previous design solved this by NULLing three timestamp columns on
 * re-registration, which is the same idea with nowhere to record what had
 * already been sent.
 *
 * `status` is the honesty requirement. A row moves queued → sending → sent only
 * when the mail path actually accepted the message, and `email_message_id`
 * points at the delivery log entry that carries the provider's id — so once
 * SES is out of probation, "did it arrive, was it handed over, did it bounce"
 * is a join away rather than a guess. A message the provider refused lands on
 * 'failed' with the provider's own words in `detail`, never on 'sent'.
 *
 * 'skipped' is the state that keeps a restart safe. A reminder whose moment
 * passed while nothing was running is recorded, with a reason, and not sent.
 */
CREATE TABLE event_reminder_sends (
  id               BIGSERIAL PRIMARY KEY,
  reminder_id      INT NOT NULL REFERENCES event_reminders(id) ON DELETE CASCADE,
  registration_id  BIGINT NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
  -- Denormalised from the registration so the admin's per-event view is one
  -- index scan rather than a join through a table with every registrant in it.
  event_id         INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  session_at       TIMESTAMPTZ NOT NULL,
  scheduled_for    TIMESTAMPTZ NOT NULL,

  status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts         INT NOT NULL DEFAULT 0,
  -- The delivery-log row, which owns the provider message id and the
  -- delivered/bounced/complained state the SES webhook writes.
  email_message_id BIGINT REFERENCES email_messages(id) ON DELETE SET NULL,
  -- Why it failed, or why it was skipped. Plain words: this is what somebody
  -- reads when a registrant says they never got anything.
  detail           TEXT NOT NULL DEFAULT '',

  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_event_reminder_sends_once
  ON event_reminder_sends (reminder_id, registration_id, session_at);

-- The scheduler's scan: only rows that could still go.
CREATE INDEX idx_event_reminder_sends_due
  ON event_reminder_sends (scheduled_for)
  WHERE status IN ('queued', 'failed', 'sending');

CREATE INDEX idx_event_reminder_sends_event
  ON event_reminder_sends (event_id, status);

CREATE INDEX idx_event_reminder_sends_registration
  ON event_reminder_sends (registration_id);

-- --- the defaults every existing event keeps ---------------------------------

/**
 * The reminders the hard-coded job was already sending, made explicit.
 *
 * Not a behaviour change: 24 hours before, an hour before and at the start are
 * exactly the three steps `jobs/eventJobs.ts` shipped, so an event that was
 * getting reminders goes on getting the same ones, now visible in the editor
 * and now recorded when they go.
 *
 * The registration confirmation is genuinely new — it was promised in the copy
 * and never sent. It is safe to add here precisely because the scheduler will
 * only ever schedule a 'registration' reminder for a registration taken at or
 * after the reminder's own `created_at`: every registration that exists on the
 * day this migration runs predates the row, so switching the confirmation on
 * cannot mail the back catalogue. That is the failure this deliberately avoids.
 */
INSERT INTO event_reminders (event_id, kind, offset_minutes)
SELECT e.id, v.kind, v.offset_minutes
  FROM events e
  CROSS JOIN (VALUES
    ('registration', 0),
    ('before',    1440),
    ('before',      60),
    ('before',       0)
  ) AS v(kind, offset_minutes)
ON CONFLICT (event_id, kind, offset_minutes) DO NOTHING;

/**
 * No `event_reminder_sends` rows are created here, deliberately.
 *
 * The scheduler writes the plan on its own tick, and it writes 'skipped' for
 * anything whose moment has already gone. Backfilling rows in a migration
 * would be the one way to make a deploy fire a backlog, so it is not done: the
 * first tick after this migration schedules only reminders that are still in
 * the future, and records the rest as skipped.
 */

-- A five-minute tick rather than fifteen. An "at the start" reminder that can be
-- a quarter of an hour late is not a reminder about the start.
UPDATE job_schedules
   SET every_minutes = 5, updated_at = now()
 WHERE name = 'event-reminders';
