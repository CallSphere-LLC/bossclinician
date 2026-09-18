-- Scheduled newsletter issues, which until now never sent.
--
-- An issue could be saved with status 'scheduled' and a `scheduled_at`, and the
-- only thing that ever sent one was the "Send now" button. This is the tick
-- that reads the two: `newsletter.sendScheduled` (jobs/newsletterJobs.ts)
-- claims every scheduled issue whose time has come and sends it.
--
-- Five minutes, because "send at nine" should mean nine and not twenty past.
INSERT INTO job_schedules (name, kind, every_minutes, next_run_at, payload)
VALUES ('newsletter-send-scheduled', 'newsletter.sendScheduled', 5, now(), '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;
