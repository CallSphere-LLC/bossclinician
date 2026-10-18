-- 122 — The free Practice Prep Training, and the masterclass video on /watch-now.
--
-- QA sheet, owner 15 Oct 2026:
--   row 93  "create this landing page … https://www.bossclinician.com/practicepreptraining
--            once they sign up then it should take them to the training page:
--            https://www.bossclinician.com/preparing-for-pp-video"
--   row 94  "This video https://share.descript.com/view/bN8cgjQ1QqX should be on the
--            follow up page for the freedom master class page" (/watch-now)
--
-- Pages: frontend/src/pages/kajabi/leadmagnets/PracticePrepTraining.tsx and
-- PracticePrepVideo.tsx, at the same two paths as on Kajabi.
--
-- PREREQUISITE: backend/scripts/kajabi-import/place-descript-videos.sh must have
-- run first. It puts the two re-encoded recordings at
--   /uploads/landing-practice-prep-training-720p.mp4
--   /uploads/landing-freedom-masterclass-720p.mp4
-- which sections 4 and 5 below point at.
--
-- What this file does, in order (097's pattern):
--   1. A tag for everyone who signs up for the training.
--   2. The sign-up form, slug = the page path, with the four questions her
--      Kajabi form 2149750481 asked (first name, last name, email, biggest
--      concern). Contact, not lead (create_lead false — 077/097): no owner
--      email per sign-up. The page goes on to /preparing-for-pp-video.
--      NOTE: form 528 'how-to-prepare-for-a-private-practice-of-your-own'
--      (name + email, hand-made on 12 Oct, no replies) is left alone; it is a
--      likely duplicate the owner can delete from the Forms screen.
--   3. An automation: form submitted -> email the link to the training page,
--      so someone who closes the tab can come back to it. Plain automation,
--      editable in Admin -> Automations. Absolute link to the callsphere.site
--      address, as 097's: update at domain cutover.
--   4. Media Library rows for the two recordings (folder "Kajabi import").
--   5. The masterclass setting's video, only if none is set: Settings -> Your
--      website -> Free masterclass -> "Masterclass video" stays hers to change.
--   6. Any redirect row for the two new paths goes (nginx answers from the map
--      before the app; none exists today, this keeps it that way).
--
-- Idempotent: ON CONFLICT DO NOTHING / WHERE NOT EXISTS throughout; the setting
-- is only written while its videoUrl is empty.

-- ── 1. Tag ──────────────────────────────────────────────────────────────────

INSERT INTO tags (name, slug, description) VALUES
  ('Freebie: Practice Prep Training', 'freebie-practice-prep-training',
   'Signed up for the free Practice Prep Training ("How to Prepare for a Private Practice of Your Own") at /practicepreptraining.')
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Form ─────────────────────────────────────────────────────────────────

INSERT INTO forms (slug, name, description, fields, submit_label, success_message,
                   create_lead, published, post_action, redirect_url, spam_protection, apply_tag_ids)
VALUES
  ('practicepreptraining',
   'Practice Prep Training — sign-up',
   'The free Practice Prep Training ("How to Prepare for a Private Practice of Your Own"), from /practicepreptraining (was Kajabi form 2149750481). The page then goes to /preparing-for-pp-video, where the recording plays; the "Practice Prep Training email" automation emails the link.',
   $f$[
     {"key":"name","type":"text","label":"First Name","required":true,"contactField":"firstName"},
     {"key":"last_name","type":"text","label":"Last Name","required":true,"contactField":"lastName"},
     {"key":"email","type":"email","label":"Email","required":true,"contactField":"email"},
     {"key":"biggest_concern","type":"select","label":"What is your biggest concern about building a practice of your own?","required":true,
      "options":["Replacing my income.","Planning for benefits, retirement, and time off.","Getting consistent clients.","Knowing where to start.","Finding time to build.","Knowing when I’m ready to leave.","Something else."],
      "contactField":"biggest_concern"}
   ]$f$::jsonb,
   'I''M READY',
   'Your free masterclass is ready.',
   false, true, 'redirect', '/preparing-for-pp-video', 'honeypot',
   COALESCE((SELECT ARRAY[id] FROM tags WHERE slug = 'freebie-practice-prep-training'), '{}'))
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Delivery email ───────────────────────────────────────────────────────

WITH form AS (SELECT id FROM forms WHERE slug = 'practicepreptraining'),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, status)
  SELECT $lm$Practice Prep Training email$lm$,
         $lm$Emails the link to the free Practice Prep Training when the practicepreptraining form is submitted at /practicepreptraining.$lm$,
         'form_submitted', jsonb_build_object('formId', form.id), 'active'
    FROM form
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $lm$Practice Prep Training email$lm$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $lm${"subject":"{{firstName}}, your free masterclass is ready","bodyMd":"Hey {{firstName}}!\n\nThank you for signing up for **How to Prepare for a Private Practice of Your Own**: 3 strategic moves to help you leave agency or platform work with a clearer plan and greater confidence.\n\n[Watch the free masterclass →](https://bossclinician.callsphere.site/preparing-for-pp-video)\n\nGrab something to take notes on, press play, and let's dive in. As you watch, choose one decision you want to work on next. You can pause and return to the training as needed.\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"marketing"}$lm$::jsonb, 0
  FROM new_automation;

-- ── 4. Media Library rows ───────────────────────────────────────────────────

INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title, folder, tags)
SELECT v.filename, v.original_name, v.url, 'video/mp4', 'video', v.size_bytes, v.title, 'Kajabi import',
       ARRAY['descript', 'landing-training']
  FROM (VALUES
    ('landing-practice-prep-training-720p.mp4', 'descript-Z8lLBnUYfkk.mp4',
     '/uploads/landing-practice-prep-training-720p.mp4', 74839461::bigint,
     $t$How to Prepare for a Private Practice of Your Own — free training (720p)$t$),
    ('landing-freedom-masterclass-720p.mp4', 'descript-bN8cgjQ1QqX.mp4',
     '/uploads/landing-freedom-masterclass-720p.mp4', 105945371::bigint,
     $t$Freedom Masterclass — How to Create a Private Practice That Supports Your Income, Energy and Future (720p)$t$)
  ) AS v(filename, original_name, url, size_bytes, title)
 WHERE NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.url = v.url);

-- ── 5. The /watch-now video ─────────────────────────────────────────────────
-- No `masterclass` row exists today (the page reads the defaults and says the
-- video is coming soon). Written only while no video is set.

INSERT INTO settings (key, value, group_key, label, description)
VALUES (
  'masterclass',
  jsonb_build_object('videoUrl', '/uploads/landing-freedom-masterclass-720p.mp4', 'actionGuideUrl', ''),
  'website',
  'Free masterclass',
  'What people see on the Watch Now page after they sign up for the Freedom Masterclass.'
)
ON CONFLICT (key) DO UPDATE
   SET value = settings.value || jsonb_build_object('videoUrl', '/uploads/landing-freedom-masterclass-720p.mp4'),
       updated_at = now()
 WHERE COALESCE(settings.value->>'videoUrl', '') = '';

-- ── 6. Redirects ────────────────────────────────────────────────────────────

DELETE FROM redirects
 WHERE lower(from_path) IN ('/practicepreptraining', '/preparing-for-pp-video');
