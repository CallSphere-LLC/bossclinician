-- 24 Nov 2026 — sheet row 254: hiring quiz "Are You Ready to Hire Your First
-- Clinician?" results emails (doc "Boss Clinician — Hiring Quiz Email Sequence",
-- sections H0-R, H0-A, H0-N).
--
-- The quiz's result email is the one send_email action of each of the three
-- "Hiring quiz result email — …" automations made in migration 099 (form_submitted
-- on hiring-quiz-ready / hiring-quiz-almost / hiring-quiz-not-yet, filed by
-- /hiring-quiz). Scoring and the outcome → form mapping are unchanged
-- (frontend/src/content/hiringQuiz.ts): Ready → H0-R, Almost Ready → H0-A,
-- Not Yet → H0-N. Only subject, previewText and bodyMd are replaced; fromName,
-- fromEmail and topic are kept. No buttons; H0-R has the one P.S. text link.
-- The doc's em dashes are written as a colon or comma (house rule for new copy).
-- H1-H6 / N1-N3 are NOT built here.
--
-- Idempotent: each UPDATE is matched on automation name + trigger form +
-- action type and skips a row that already has the new subject.

UPDATE automation_actions x
   SET config = x.config || jsonb_build_object(
         'subject', $hq$Your hiring quiz result: let’s plan the next step$hq$,
         'previewText', $hq$Start with the role you actually need.$hq$,
         'bodyMd', $hq$Hey!

Your result from “Are You Ready to Hire Your First Clinician?” is:

Ready: Let’s plan your next hire.

Based on your answers, you have several pieces in place to begin planning.

Here’s where I’d start: write down what you want this hire to make possible.

Maybe you want to serve clients you’re currently turning away. Maybe you want to reduce your own sessions and make room to lead.

Then finish this sentence:

“I’m hiring someone to take responsibility for ______, so the practice can ______.”

Be specific about the clients, schedule, and responsibilities. You’ll use that to work through the cost of the role and the support they’ll need.

You don’t have to figure out the entire hiring process today. Start by getting clear on what you’re building toward.

Your result reflects your answers. It isn’t a financial review or a guarantee that a hire is affordable; you’ll still need to confirm the numbers and requirements before moving ahead.

Yvette

P.S. Already looking for support with your hiring plan? [You can learn about The Boardroom here.](https://www.bossclinician.com/boardroom)$hq$),
       updated_at = now()
  FROM automations a
  JOIN forms f ON f.id::text = a.trigger_config->>'formId'
 WHERE x.automation_id = a.id
   AND a.name = $hq$Hiring quiz result email — Ready$hq$
   AND a.trigger_type = 'form_submitted'
   AND f.slug = 'hiring-quiz-ready'
   AND x.action_type = 'send_email'
   AND x.config->>'subject' IS DISTINCT FROM $hq$Your hiring quiz result: let’s plan the next step$hq$;

UPDATE automation_actions x
   SET config = x.config || jsonb_build_object(
         'subject', $hq$Your hiring quiz result: a few things to work through$hq$,
         'previewText', $hq$Choose one area to look at first.$hq$,
         'bodyMd', $hq$Hey!

Your result from “Are You Ready to Hire Your First Clinician?” is:

Almost Ready: A few gaps to work through first.

You can want a team and still have questions about how you’re going to make it work.

Instead of turning this result into a long to-do list, think about the question you felt least certain answering.

Was it what you could afford?

Whether you had enough demand for another clinician?

Or how you would train someone when so much still lives in your head?

Choose that one area and write down what you know, and what you still need to find out.

For example: “I know what I’d like to pay someone. I haven’t worked out the full cost or how I’d cover it while their caseload grows.”

That gives you a specific decision to work toward.

You don’t need to fix everything this week. Start with the question that would make your next step clearer.

This result reflects what you shared; it isn’t a financial review or a final hiring decision.

Yvette$hq$),
       updated_at = now()
  FROM automations a
  JOIN forms f ON f.id::text = a.trigger_config->>'formId'
 WHERE x.automation_id = a.id
   AND a.name = $hq$Hiring quiz result email — Almost Ready$hq$
   AND a.trigger_type = 'form_submitted'
   AND f.slug = 'hiring-quiz-almost'
   AND x.action_type = 'send_email'
   AND x.config->>'subject' IS DISTINCT FROM $hq$Your hiring quiz result: a few things to work through$hq$;

UPDATE automation_actions x
   SET config = x.config || jsonb_build_object(
         'subject', $hq$Your hiring quiz result: here’s where I’d start$hq$,
         'previewText', $hq$Your goal can stay. Let’s look at what needs attention first.$hq$,
         'bodyMd', $hq$Hey!

Your result from “Are You Ready to Hire Your First Clinician?” is:

Not Yet: Strengthen the practice you’re building from.

If you were hoping hiring would give you some breathing room, I understand why this might feel disappointing.

This doesn’t mean you can’t build a team. Your answers suggest there are parts of the current practice worth looking at before adding another clinician.

For now, finish this sentence:

“The part of running my practice I most need help with is ______.”

Be specific. Is it keeping up with inquiries? Seeing every client yourself? Getting billing done after your last session? Knowing what you can pay yourself?

That answer helps you look at whether another clinician would address the pressure, or whether a different change needs to come first.

You don’t have to fill every hour of your own calendar to earn the right to hire. You need to understand what the role would solve and what the business can support.

Your result reflects your answers, not a final judgment about your business or your future.

Yvette$hq$),
       updated_at = now()
  FROM automations a
  JOIN forms f ON f.id::text = a.trigger_config->>'formId'
 WHERE x.automation_id = a.id
   AND a.name = $hq$Hiring quiz result email — Not Yet$hq$
   AND a.trigger_type = 'form_submitted'
   AND f.slug = 'hiring-quiz-not-yet'
   AND x.action_type = 'send_email'
   AND x.config->>'subject' IS DISTINCT FROM $hq$Your hiring quiz result: here’s where I’d start$hq$;
