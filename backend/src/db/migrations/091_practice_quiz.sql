-- =============================================================================
-- 091 — The Practice Set Up Quiz takes its leads here
--
-- /practice-quiz's "Take the free quiz" button used to open the quiz on
-- bossclinician.com. The quiz now runs on this site at /practice-quiz/take
-- (frontend/src/content/practiceQuiz.ts holds its questions and results).
--
-- On Kajabi the quiz ends by sending the visitor to one of four forms, one per
-- practice builder type (/visionary-form, /careful-form, /steady-form,
-- /reluctant-form), each asking First Name, Last Name and Email. These are the
-- same four forms as builder forms, so a quiz taker:
--   * appears under Forms → <the form> → replies, with the result, the per-type
--     totals and the answer chosen for each of the six questions;
--   * is added to (or updated on) the contact list with first and last name;
--   * gets the matching "Quiz — …" tag, which already exists (ids differ per
--     database, so it is looked up by slug).
--
-- create_lead is off, as for the masterclass sign-up (077): a lead would email
-- the owner for every quiz taker and fill the enquiries inbox with people who
-- did not write in. Turn it on per form in the builder if she wants that.
--
-- No email sequence is attached: none exists for the quiz on this database.
-- The form copy promises "your personalized result plus your free action plan",
-- so a sequence (or an automation on the tag) should be attached in the builder.
--
-- The answers are declared as hidden questions so the replies list labels them
-- and a re-save in the builder does not drop them. Hidden questions are never
-- required (formLogic.answerProblem skips them).
-- =============================================================================

INSERT INTO forms (
  slug, name, description, fields, submit_label, success_message,
  create_lead, published, post_action, spam_protection, apply_tag_ids
)
SELECT
  v.slug,
  v.name,
  v.description,
  $fields$[
    {"key": "first_name", "label": "First Name", "type": "text", "required": true, "contactField": "firstName"},
    {"key": "last_name", "label": "Last Name", "type": "text", "required": true, "contactField": "lastName"},
    {"key": "email", "label": "Email", "type": "email", "required": true, "contactField": "email"},
    {"key": "result", "label": "Practice builder type", "type": "hidden", "required": false},
    {"key": "scores", "label": "Score by type", "type": "hidden", "required": false},
    {"key": "q1", "label": "Q1 · Income", "type": "hidden", "required": false},
    {"key": "q2", "label": "Q2 · Operations", "type": "hidden", "required": false},
    {"key": "q3", "label": "Q3 · Marketing", "type": "hidden", "required": false},
    {"key": "q4", "label": "Q4 · Schedule", "type": "hidden", "required": false},
    {"key": "q5", "label": "Q5 · Vision", "type": "hidden", "required": false},
    {"key": "q6", "label": "Q6 · Biggest Block", "type": "hidden", "required": false}
  ]$fields$::jsonb,
  'GET MY RESULT',
  'Your result is ready.',
  false,
  true,
  'message',
  'honeypot',
  COALESCE((SELECT ARRAY[t.id] FROM tags t WHERE t.slug = v.slug), '{}')
FROM (VALUES
  ('quiz-visionary', 'Quiz — Visionary Builder',
   $d$Practice Set Up Quiz result form for The Visionary Builder. Filled in automatically by the quiz at /practice-quiz/take; the page draws its own fields, so edits to the questions here do not change the quiz.$d$),
  ('quiz-careful', 'Quiz — Careful Clinician',
   $d$Practice Set Up Quiz result form for The Careful Clinician. Filled in automatically by the quiz at /practice-quiz/take; the page draws its own fields, so edits to the questions here do not change the quiz.$d$),
  ('quiz-steady', 'Quiz — Steady Grower',
   $d$Practice Set Up Quiz result form for The Steady Grower. Filled in automatically by the quiz at /practice-quiz/take; the page draws its own fields, so edits to the questions here do not change the quiz.$d$),
  ('quiz-reluctant', 'Quiz — Reluctant CEO',
   $d$Practice Set Up Quiz result form for The Reluctant CEO. Filled in automatically by the quiz at /practice-quiz/take; the page draws its own fields, so edits to the questions here do not change the quiz.$d$)
) AS v(slug, name, description)
ON CONFLICT (slug) DO NOTHING;
