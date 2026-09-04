-- Schedules for the section-3 email work. Separate from 034 because that
-- migration had already been applied when these handlers were written, and an
-- applied migration is a historical record rather than a file to edit.

-- The per-registrant sender for "upon registration" campaigns. Two minutes,
-- because "two hours after they register" should not become "two hours and
-- twenty-nine minutes".
INSERT INTO job_schedules (name, kind, every_minutes, next_run_at, payload)
VALUES ('broadcast-registration-tick', 'broadcast.registrationTick', 2, now(), '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Decides A/B subject winners a few hours after a campaign goes out, once
-- there are enough opens for the answer to mean anything.
INSERT INTO job_schedules (name, kind, every_minutes, next_run_at, payload)
VALUES ('broadcast-ab-decide', 'broadcast.abDecide', 60, now(), '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;
