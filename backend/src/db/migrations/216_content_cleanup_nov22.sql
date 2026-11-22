-- 22 Nov 2026 — Yvette's answers, items 2, 5, 6, 7 and 10 (content only).
--
-- Every statement is a guarded text replacement: it runs only while the old
-- wording is still present, so re-running is a no-op. No prices, amounts,
-- Stripe ids, orders, purchases, sent campaigns or Kajabi import records change.
-- Old values are recorded in the comments above each statement.
--
-- Existing subscribers: sequence 488 (masterclass) and 487 (Club 24 weeks) are
-- edited in place. Anyone already enrolled gets the corrected wording for any
-- email that has not been sent to them yet; nobody is re-enrolled or re-sent.
-- Automation 1364 (reset-planner form, active) sends the new audit email to
-- future sign-ups only.

-- ── Item 2: masterclass sequence 488, Email 4 (id 1596) — two typos ─────────
-- Emails 11-12 of 488 are not touched here.
UPDATE sequence_emails
   SET body_md = replace(replace(body_md,
         'a tool you will inside The Lounge', 'a tool you will use inside The Lounge'),
         'without an income deep', 'without an income dip'),
       updated_at = now()
 WHERE id = 1596 AND sequence_id = 488
   AND (position('a tool you will inside The Lounge' in body_md) > 0
        OR position('without an income deep' in body_md) > 0);

-- ── Item 5: comparison / "valued at" / discount claims ─────────────────────
-- Selling prices (amount_cents) are unchanged; only the claim text goes.

-- Offer 18 fully-booked-toolkit ($67). Was: "Get 85% off! $444 $67\nDiscount automatically applied.\n"
UPDATE offers
   SET description = replace(description, E'Get 85% off! $444 $67\nDiscount automatically applied.\n', E'$67\n'),
       updated_at = now()
 WHERE id = 18 AND slug = 'fully-booked-toolkit'
   AND position(E'Get 85% off! $444 $67\nDiscount automatically applied.\n' in description) > 0;

-- Offer 19 credentialing-success-formula ($247). Was: five " (valued at $497/$197/$297/$397/$197)"
-- and "Total Value: $1,500+".
UPDATE offers
   SET description = replace(regexp_replace(description, ' \(valued at \$[0-9,]+\)', '', 'g'),
                             E'Total Value: $1,500+\n', ''),
       updated_at = now()
 WHERE id = 19 AND slug = 'credentialing-success-formula'
   AND (description ~ '\(valued at \$' OR position(E'Total Value: $1,500+\n' in description) > 0);

-- Offer 20 private-practice-starter-suite ($27). Was: " ($597 Value)", " ($67 Value)", " ($97 Value)",
-- " ($47 Value)", " ($57 Value)", " ($27 Value)" and "💰 Total Value: $929".
UPDATE offers
   SET description = replace(regexp_replace(description, ' \(\$[0-9,]+ Value\)', '', 'g'),
                             E'💰 Total Value: $929\n', ''),
       updated_at = now()
 WHERE id = 20 AND slug = 'private-practice-starter-suite'
   AND (description ~ '\(\$[0-9,]+ Value\)' OR position(E'💰 Total Value: $929\n' in description) > 0);

-- Offer 33 credential-with-confidence ($127). Was: "Total Value: Over $500".
UPDATE offers
   SET description = replace(description, E'Total Value: Over $500\n', ''),
       updated_at = now()
 WHERE id = 33 AND slug = 'credential-with-confidence'
   AND position(E'Total Value: Over $500\n' in description) > 0;

-- Offer 34 marketing-mastery-for-therapists ($67). Was: "(Regular Price: $147)" in the description
-- and checkout_headline "Regular price $147. Pay $67." (empty falls back to the offer title).
UPDATE offers
   SET description = replace(description, E'(Regular Price: $147)\n', ''),
       updated_at = now()
 WHERE id = 34 AND slug = 'marketing-mastery-for-therapists'
   AND position(E'(Regular Price: $147)\n' in description) > 0;

UPDATE offers
   SET checkout_headline = '',
       updated_at = now()
 WHERE id = 34 AND slug = 'marketing-mastery-for-therapists'
   AND checkout_headline = 'Regular price $147. Pay $67.';

-- Course 9 (same product). Was price_text "$67 (regular price $147)".
UPDATE courses
   SET price_text = '$67',
       updated_at = now()
 WHERE id = 9 AND slug = 'marketing-mastery-for-therapists'
   AND price_text = '$67 (regular price $147)';

-- Offer 36 rate-negotiation-letter-template ($7). Was: "(Value: $121)" line and " ($47 value)" x2,
-- " ($27 value)".
UPDATE offers
   SET description = regexp_replace(replace(description, E'(Value: $121)\n', ''), ' \(\$[0-9,]+ value\)', '', 'g'),
       updated_at = now()
 WHERE id = 36 AND slug = 'rate-negotiation-letter-template'
   AND (position(E'(Value: $121)\n' in description) > 0 OR description ~ '\(\$[0-9,]+ value\)');

-- Course 5 private-practice-starter-suite sales_page (jsonb). Was: " [$597 value]", " [$57 value]" ...,
-- " — $597 Value" ... list labels, the paragraph "**Total Value: $929**" and the hero highlights
-- "USUALLY $197", "YOU'RE SAVING $170" (kept: "ONLY $27 TODAY", the selling price).
UPDATE courses
   SET sales_page = replace(replace(
         regexp_replace(regexp_replace(sales_page::text,
           ' \[\$[0-9,]+ value\]', '', 'g'),
           ' — \$[0-9,]+ Value', '', 'g'),
         '"**Total Value: $929**", ', ''),
         ', "USUALLY $197", "YOU''RE SAVING $170"', '')::jsonb,
       updated_at = now()
 WHERE id = 5 AND slug = 'private-practice-starter-suite'
   AND sales_page::text ~ '(\[\$[0-9,]+ value\]| — \$[0-9,]+ Value|\*\*Total Value: \$929\*\*|USUALLY \$197)';

-- CSF Purchased sequence 468, email 1518 (active). Was: "Bonus: Credentialing Follow-Up Scripts &
-- Email Templates ($97 Value) – FREE!"
UPDATE sequence_emails
   SET body_md = replace(body_md, 'Email Templates ($97 Value) – FREE!', 'Email Templates – FREE!'),
       updated_at = now()
 WHERE id = 1518 AND sequence_id = 468
   AND position('Email Templates ($97 Value) – FREE!' in body_md) > 0;

-- ── Item 6: old Boss Builders Collective addresses and name ────────────────

-- Support address on product pages. Was support@profitableprivatepractices.com (offers 19, 33).
UPDATE offers
   SET description = replace(description, 'support@profitableprivatepractices.com', 'support@bossclinician.com'),
       updated_at = now()
 WHERE id IN (19, 33)
   AND position('support@profitableprivatepractices.com' in description) > 0;

-- Course 53 (Profitable Private Practices training) sales page. Was: "contact
-- yvette@profitableprivatepractices.com" and "the creator of Boss Builders Collective , where she coaches".
UPDATE courses
   SET sales_page = replace(replace(sales_page::text,
         'yvette@profitableprivatepractices.com', 'support@bossclinician.com'),
         'the creator of Boss Builders Collective , where she coaches', 'the creator of Boss Clinician, where she coaches')::jsonb,
       updated_at = now()
 WHERE id = 53 AND slug = 'profitable-private-practices-training'
   AND (position('yvette@profitableprivatepractices.com' in sales_page::text) > 0
        OR position('the creator of Boss Builders Collective , where she coaches' in sales_page::text) > 0);

-- Directory Makeover Audit purchase emails (automations 1377-1379, 1390; paused Kajabi imports).
-- Was: 📧 [yvette@profitableprivatepractices.com](mailto:yvette@profitableprivatepractices.com)
UPDATE automation_actions
   SET config = jsonb_set(config, '{bodyMd}',
         to_jsonb(replace(config->>'bodyMd', 'yvette@profitableprivatepractices.com', 'support@bossclinician.com'))),
       updated_at = now()
 WHERE id IN (1382, 1383, 1384, 1395) AND action_type = 'send_email'
   AND position('yvette@profitableprivatepractices.com' in config->>'bodyMd') > 0;

-- Club 24-week sequence 487, email 1591 (Week 20, active). Was: "in the Boss Builders Collective journey".
UPDATE sequence_emails
   SET body_md = replace(body_md, 'in the Boss Builders Collective journey', 'in the Boss Clinician Club journey'),
       updated_at = now()
 WHERE id = 1591 AND sequence_id = 487
   AND position('in the Boss Builders Collective journey' in body_md) > 0;

-- Starter Suite (course 5) upsell lessons, both pointing at /club.
-- Lesson 133 title was "... [Preview Of The Boss Builders Collective]".
UPDATE course_lessons
   SET title = replace(title, '[Preview Of The Boss Builders Collective]', '[Preview Of The Boss Clinician Club]'),
       updated_at = now()
 WHERE id = 133 AND position('[Preview Of The Boss Builders Collective]' in title) > 0;

-- Lesson 134 was "...marketing funnel—Boss Builders Collective gives you the tools...".
UPDATE course_lessons
   SET body_md = replace(body_md, '—Boss Builders Collective gives you the tools', '—The Boss Clinician Club gives you the tools'),
       updated_at = now()
 WHERE id = 134 AND position('—Boss Builders Collective gives you the tools' in body_md) > 0;

-- Course 53 (Profitable Private Practices), module 32 and its lessons 76/77.
-- Module title was "📌  Tier 2: Boss Builders Collective: Optimize & Systemize for Consistent Income".
UPDATE course_modules
   SET title = replace(title, 'Tier 2: Boss Builders Collective: ', 'Tier 2: '),
       updated_at = now()
 WHERE id = 32 AND course_id = 53 AND position('Tier 2: Boss Builders Collective: ' in title) > 0;

-- Lesson 76 heading was "## Download the Boss Builders Overview Below:".
UPDATE course_lessons
   SET body_md = replace(body_md, '## Download the Boss Builders Overview Below:', '## Download the Tier 2 Overview Below:'),
       updated_at = now()
 WHERE id = 76 AND position('## Download the Boss Builders Overview Below:' in body_md) > 0;

-- Lesson 77 was "In this tier of the Profitable Private Practice Boss Builders Collective, you will focus".
UPDATE course_lessons
   SET body_md = replace(body_md,
         'In this tier of the Profitable Private Practice Boss Builders Collective, you will focus',
         'In this tier of Profitable Private Practices, you will focus'),
       updated_at = now()
 WHERE id = 77
   AND position('In this tier of the Profitable Private Practice Boss Builders Collective, you will focus' in body_md) > 0;

-- ── Item 7: the "Reset Planner" resource is the Practice Freedom Audit ──────
-- The reset-planner form (44) and its automation (1364) keep their slugs and ids.
-- The email used to link the Club's First 30 Days planner
-- (/uploads/kajabi-rehost/the-first-30-days-success-planner-26-907b0269033a.pdf); it now
-- links the one canonical audit file, /downloads/practice-freedom-audit.pdf (also used
-- by masterclass Email 1, migration 213, and the /watch-now page).

-- Form 44. Was name "Practice Reset Planner — opt-in", description "The free Practice Reset Planner,
-- from /reset-planner-form (was Kajabi form 2149654850).", success "You're in. Watch your inbox —
-- The Practice Reset Planner is on its way."
UPDATE forms
   SET name = 'Practice Freedom Audit — opt-in',
       description = replace(description, 'The free Practice Reset Planner', 'The free Practice Freedom Audit'),
       success_message = replace(success_message, 'The Practice Reset Planner', 'The Practice Freedom Audit'),
       updated_at = now()
 WHERE id = 44 AND slug = 'reset-planner'
   AND (name = 'Practice Reset Planner — opt-in'
        OR position('The Practice Reset Planner' in success_message) > 0
        OR position('The free Practice Reset Planner' in coalesce(description, '')) > 0);

-- Automation 1364 → action 1369. Old subject "Your Practice Reset Planner is here 🎉"; old body opened
-- "Your Practice Reset Planner is on its way." and described "30 days of focused, intentional action to
-- audit what's draining you, redesign your income model, build toward scalable revenue, and put real
-- systems and boundaries in place.\n\nThis isn't about doing everything perfectly. It's about taking
-- one aligned action each day and letting those small shifts build into something real." and
-- "The planner gets you clear." New wording comes from the audit PDF itself.
UPDATE automation_actions
   SET config = jsonb_set(jsonb_set(config,
         '{subject}', to_jsonb('Your Practice Freedom Audit is here 🎉'::text)),
         '{bodyMd}', to_jsonb(
           replace(replace(replace(replace(config->>'bodyMd',
             'Your Practice Reset Planner is on its way.',
             'Your Practice Freedom Audit is on its way.'),
             'https://www.bossclinician.com/uploads/kajabi-rehost/the-first-30-days-success-planner-26-907b0269033a.pdf',
             'https://www.bossclinician.com/downloads/practice-freedom-audit.pdf'),
             E'30 days of focused, intentional action to audit what''s draining you, redesign your income model, build toward scalable revenue, and put real systems and boundaries in place.\n\nThis isn''t about doing everything perfectly. It''s about taking one aligned action each day and letting those small shifts build into something real.',
             E'As you move through it, you’ll look at four areas of your practice: Capacity. Income. Dependence. Future Fit.\n\nNot so you can fix everything today. But so you can see what may be making your current practice difficult to sustain—and identify the first thing that needs your attention.'),
             'The planner gets you clear.',
             'The audit gets you clear.'))),
       updated_at = now()
 WHERE id = 1369 AND automation_id = 1364 AND action_type = 'send_email'
   AND position('the-first-30-days-success-planner-26-907b0269033a.pdf' in config->>'bodyMd') > 0;

-- Admin-facing name of automation 1364. Was "Form is submitted: Practice Reset Planner → Send an
-- email: Your Practice Reset Planner is here 🎉". trigger_config (Kajabi import record) is left as is.
UPDATE automations
   SET name = 'Form is submitted: Practice Freedom Audit → Send an email: Your Practice Freedom Audit is here 🎉',
       updated_at = now()
 WHERE id = 1364
   AND name = 'Form is submitted: Practice Reset Planner → Send an email: Your Practice Reset Planner is here 🎉';

-- ── Item 10: restore the Nevada Board approval line on the two blog posts ──
-- Migration 211 (21 Nov) removed "**3.5 Ethics CEUs. Nevada Board Approved.**" from both posts
-- together with the past live-session date. The approval (#2026-18) is still active, so the
-- line goes back where it was; the date and the old registration link stay removed.
UPDATE blog_posts
   SET body_md = replace(body_md,
         'If someone asked for your records tomorrow, could you hand them over with confidence?',
         E'**3.5 Ethics CEUs. Nevada Board Approved.**\n\nIf someone asked for your records tomorrow, could you hand them over with confidence?'),
       updated_at = now()
 WHERE slug = 'toolkit-before-my-audit-registration-closes-september-25'
   AND position('Nevada Board Approved' in body_md) = 0
   AND (length(body_md) - length(replace(body_md, 'If someone asked for your records tomorrow, could you hand them over with confidence?', '')))
       = length('If someone asked for your records tomorrow, could you hand them over with confidence?');

UPDATE blog_posts
   SET body_md = replace(body_md,
         'If no one ever sat you down and taught you this either, what would change for you if someone finally did?',
         E'**3.5 Ethics CEUs. Nevada Board Approved.**\n\nIf no one ever sat you down and taught you this either, what would change for you if someone finally did?'),
       updated_at = now()
 WHERE slug = 'dos-and-donts-of-clinical-documentation'
   AND position('Nevada Board Approved' in body_md) = 0
   AND (length(body_md) - length(replace(body_md, 'If no one ever sat you down and taught you this either, what would change for you if someone finally did?', '')))
       = length('If no one ever sat you down and taught you this either, what would change for you if someone finally did?');


-- Item 5 (parent, 22-Nov): the Club offer's bonus line claimed "$197 value, sold
-- separately" (the Ramp-Up sells at $97). Keep the NBCC note, drop the value claim.
UPDATE offers
   SET description = replace(description, '($197 value, sold separately. Does not carry NBCC credit.)', '(Does not carry NBCC credit.)'),
       updated_at = now()
 WHERE id = 39
   AND description LIKE '%($197 value, sold separately. Does not carry NBCC credit.)%';
