-- =============================================================================
-- Sheet row 104 (19 Oct): the Freedom Masterclass sign-up gets the two
-- practice questions from her Kajabi form back, and the address is confirmed
-- by email before the video link is handed over ("email validation").
--
-- Her Kajabi form (forms/2148559492) asked First Name, Email, then three
-- dropdowns: "Did you confirm your email was registered correctly?",
-- "Where are you in your private practice right now?" and a second question,
-- mislabelled with the same words, whose answers are what she wants to build.
-- The first dropdown was Kajabi's stand-in for real validation and is replaced
-- by the confirmation email; the other two are kept, word for word.
--
-- `double_opt_in` has existed on forms since 014 and been shown in the Forms
-- screen since, but nothing honoured it until now: the public submit route
-- (routes/public/growthPublic.ts) now sends a confirmation link for any form
-- with the flag, and GET /api/forms/confirm/:token stamps the reply and the
-- contact before sending the person to `redirect_url`.
--
-- UPDATE rather than ON CONFLICT DO NOTHING: she asked for these questions on
-- this form, so the seeded two-box shape is replaced. Labels stay editable in
-- the Forms screen afterwards; the page draws its own boxes from the same keys.
-- =============================================================================
UPDATE forms
   SET fields = $fields$[
    {"key": "name", "label": "First name", "type": "text", "required": true, "contactField": "firstName"},
    {"key": "email", "label": "Email", "type": "email", "required": true, "contactField": "email"},
    {"key": "practice_stage", "label": "Where are you in your private practice right now?", "type": "select", "required": true,
     "options": ["I’m just getting started", "I’m rebuilding or restarting", "I have an established solo practice", "I own a group practice"]},
    {"key": "practice_goal", "label": "What do you want to build next?", "type": "select", "required": true,
     "options": ["A stronger solo practice", "A group practice/team", "More income without adding more 1:1 clients", "More flexibility and time freedom", "I’m not sure yet"]}
   ]$fields$::jsonb,
       double_opt_in = true,
       redirect_url = COALESCE(NULLIF(redirect_url, ''), '/watch-now'),
       success_message = $msg$Almost there — check your inbox and click the link to watch.$msg$,
       description = $desc$The sign-up on the /freedom-masterclass page. The page draws its own boxes (first name, email, two practice questions), emails a confirmation link, and the link takes people to /watch-now, where the video is; change the video in Settings → Your website → Free masterclass.$desc$,
       updated_at = now()
 WHERE slug = 'freedom-masterclass';
