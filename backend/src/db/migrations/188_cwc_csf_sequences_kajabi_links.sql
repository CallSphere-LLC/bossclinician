-- =============================================================================
-- 188: Yvette's real CWC and CSF sequences (31 Oct), and the emails that still
--      lean on Kajabi, which closes 23 Nov.
--
-- A. Sequences 469 (CWC) and 468 (CSF) take her emails word for word, then their
--    automations go on and the offers' own welcome goes off, with migration 182's
--    guards. Future purchases only: no subscription row is written, no event raised.
-- B. Kajabi: footer icons and header images go, mykajabi links point here, and
--    files the site already holds are linked where they are. The three free guides
--    the site does not have yet are for backend/scripts/kajabi-rehost/rehost.mjs.
--
-- A delay counts from the previous email (services/sequences.ts nextSendAt), so
-- her "3 days after purchase" then "7 days after purchase" is 3 days, then 4.
-- A sequence email has no time of day of its own, so CSF's "Day 2 at 8 AM" is day 2
-- from the moment of purchase; a send window would also hold back the "immediately"
-- access email. Kajabi's imported sequences are in the same position.
--
-- No change needed for her Club timing: 486 starts at 0 minutes (immediately) and
-- 487 at 1440 (the day after), as she describes.
-- =============================================================================

-- 1. Her emails. Link labels are hers; her document did not carry the addresses.

CREATE TEMP TABLE _bc188_email (
  sequence_id integer, position integer, delay_minutes integer, subject text, body_md text
) ON COMMIT DROP;

INSERT INTO _bc188_email VALUES
(469, 1, 0,
$em$Welcome to Credential with Confidence—Your Training and Bonus Are Inside$em$,
$em$Hey {{firstName}},

Welcome to Credential with Confidence! You now have access to the training and tools designed to help you understand the full process—from choosing insurance panels and completing applications to contracting, enrollment, and post-approval setup.

[Start the Credential with Confidence Training](https://www.bossclinician.com/library/credential-with-confidence)

You also receive your bonus Insurance Panel Fee Guide so you can compare reimbursement information and make more informed decisions before applying.

This guide is designed to help you:
✅ See reimbursement rates for major insurance panels at a glance
✅ Decide which panels align with your practice goals
✅ Avoid undercharging by understanding what insurance companies actually pay

💡 Access your guide here: [Download Now](https://www.bossclinician.com/library/credential-with-confidence/lessons/bonus-insurance-panel-fee-guide)

🔍 Next Steps:
Take a moment to review the guide, highlight which panels interest you most, and start aligning your practice rates accordingly.

And if you have any questions about how to leverage insurance without it taking over your life, just hit reply—I’m happy to help!

To your success,
Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(469, 2, 4320,
$em$Have you chosen the right insurance panels for your practice?$em$,
$em$Hey {{firstName}},

Just checking in—have you had a chance to review your Insurance Panel Fee Guide yet?

Understanding reimbursement rates is a key piece of the puzzle when deciding how to structure your practice. If you’re still unsure about:
❌ Which insurance panels are actually worth your time
❌ How to set your private-pay rates alongside insurance reimbursement
❌ How to avoid getting underpaid by low-paying panels

Then this guide is your roadmap! It’s designed to help you stop second-guessing and start making informed, profitable decisions for your private practice.

📌 Pro Tip: If you’re already working through Credential with Confidence, use this guide alongside the Credentialing Tracker to map out your insurance plan step by step.

💡 Need extra help understanding your numbers? Let me know how you’re doing so far, I’m happy to guide you!

To your success,
Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(469, 3, 5760,
$em$What is your next move after credentialing?$em$,
$em$Hey {{firstName}},

I hope you’ve been finding the Insurance Panel Fee Guide helpful in navigating your credentialing process!

I’d love to hear your thoughts—
👉 What’s been your biggest insight so far?
👉 Did anything surprise you about the reimbursement rates?
👉 Is there anything else you’d like help with?

Your feedback helps me continue improving resources for therapists like you! Just hit reply and let me know your thoughts—I truly appreciate it.

And remember, if you’re feeling stuck on anything credentialing or billing-related, your Credential with Confidence training and tracker are here to guide you!

🔗 Need to revisit the Credential with Confidence kit? Access it here: [Get Access Here](https://www.bossclinician.com/library/credential-with-confidence)

Need more support beyond credentialing?

Choose the room that matches the stage of your practice:

The Boss Clinician Club is for therapists and psychiatric nurse practitioners who are starting, rebuilding, or creating the foundation for a private practice that can grow without having to be undone later.

[Explore the Boss Clinician Club](https://www.bossclinician.com/club)

The Boss Clinician Lounge is for established clinicians whose practice is full or nearly full, but who are ready to improve their rates, insurance strategy, systems, income, and time.

[Explore the Boss Clinician Lounge](https://www.bossclinician.com/lounge)

You do not need to join the room that sounds the most advanced. Choose the room that supports the work directly in front of you.

Looking forward to hearing from you!

To your success,
Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(468, 1, 0,
$em$Your Credentialing Success Formula + Special Bonus is Ready!$em$,
$em$Hi {{firstName}},

Great news! You now have everything you need to streamline credentialing and get your clinicians approved faster.

To make your journey even smoother, I’m gifting you an exclusive bonus:

Bonus: Credentialing Follow-Up Scripts & Email Templates ($97 Value) – FREE!

With these done-for-you templates, you’ll be able to speed up credentialing approvals and eliminate delays when working with insurance payers!

Here’s what’s inside your Credentialing Success Formula:
• Step-by-step video lessons to walk you through the credentialing process.
• Credentialing & Billing Management Tracker to track applications, renewals, and panel approvals.
• Supervisory Billing Guides to help you maximize revenue from pre-licensed clinicians.
• Insurance Panel Reference Guide so you can submit applications correctly the first time.

Click here to access your kit: [Gain Access Here](https://www.bossclinician.com/library/credentialing-success-formula)

Download your FREE bonus here: [Download Script Now](https://docs.google.com/spreadsheets/d/1CMd0Xr0QGOVFMMHrlcPW6cK1TnImXwrd/copy?usp=sharing&ouid=103920239567246205586&rtpof=true&sd=true)

Your next step is simple: log in, download your resources, and begin with the first lesson. If you have a question about accessing or using your materials, just hit reply and let me know.

I can’t wait to see how this transforms your credentialing process!

Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(468, 2, 2880,
$em$The Smart Way to Credential Your Team$em$,
$em$Hi {{firstName}},

Since you now have the Credentialing Success Formula, you’re in the perfect position to streamline your credentialing process and reduce delays.

Here’s how to make the most of your system:
• Use the Credentialing & Billing Tracker to stay on top of application progress.
• Follow the Insurance Panel Reference Guide to ensure all required documents are submitted correctly.
• Utilize the Supervisory Billing Guide to bill for pre-licensed clinicians properly.

BONUS ACTION STEP: Make sure you’re using the Credentialing Follow-Up Scripts & Email Templates to stay on top of insurance panels and get faster approvals!

Download your free bonus here: [Download Script Now](https://docs.google.com/spreadsheets/d/1CMd0Xr0QGOVFMMHrlcPW6cK1TnImXwrd/copy?usp=sharing&ouid=103920239567246205586&rtpof=true&sd=true)

ACTION STEP: Take 15 minutes today to review the Credentialing & Billing Tracker—this will help you avoid costly mistakes and keep everything organized.

• Have a question as you work through the materials? Hit reply and let me know where you’re getting stuck—I’m happy to point you back to the right training or resource.

Let me know if you have any questions,

Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(468, 3, 2880,
$em$“This system changed how I do credentialing!”$em$,
$em$Hi {{firstName}},

I love hearing how this system is helping practice owners like you:

“Before using this system, I struggled to track every step of credentialing. Now, I have everything in one place, and my process is seamless!” – Sharon S. LPC

• Have you used the Credentialing & Billing Tracker yet? It will help you manage deadlines, track renewals, and monitor application progress.

Access it here: [Download Tracker Here](https://www.bossclinician.com/library/credentialing-success-formula/lessons/tracking-credentials)

• Your Next Step: Make sure you’re integrating the Credentialing Follow-Up Scripts to communicate with insurance panels efficiently and push for faster approvals.

As you put the Credentialing Success Formula into action, you may realize you want support with the rest of your practice too.

If you’re preparing to hire your first team member or already leading a growing team, explore the Boss Clinician Boardroom.

[Explore the Boss Clinician Boardroom](https://www.bossclinician.com/boardroom)

If your practice is established and full or nearly full, explore the Boss Clinician Lounge.

[Explore the Boss Clinician Lounge](https://www.bossclinician.com/lounge)

Can’t wait to hear your success story!

Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(468, 4, 2880,
$em$Stuck Waiting on Credentialing? Here’s How to Fix It.$em$,
$em$Hi {{firstName}},

By now, you’ve had time to start implementing the Credentialing Success Formula, but I know one of the biggest frustrations is waiting on approvals from insurance panels.

If you’re experiencing delays, check these quick fixes:
• Ensure all CAQH profiles are updated — Missing details are a common cause of credentialing holdups.
• Use the Insurance Panel Reference Guide — Double-check that you’ve submitted all required documents correctly.
• Follow up with insurance payers at 30 and 60 days — Don’t assume they’ll update you—be proactive!

Inside the Credentialing Success Formula, you’ll find:
• Credentialing Timeline Planner – So you always know what’s next.
• Credentialing & Billing Tracker – To monitor progress and avoid errors.

Don’t forget about your FREE bonus:

Your Credentialing Follow-Up Scripts & Email Templates will help you keep insurance panels accountable and get approvals faster—saving you months of unnecessary delays!

Download it here: [Download Script Now](https://docs.google.com/spreadsheets/d/1CMd0Xr0QGOVFMMHrlcPW6cK1TnImXwrd/copy?usp=sharing&ouid=103920239567246205586&rtpof=true&sd=true)

If credentialing delays are exposing bigger gaps in your practice systems, you don’t have to work through them alone.

The Boss Clinician Boardroom supports established solo clinicians preparing to hire and group-practice owners who need stronger leadership, team systems, profitability, and CEO-level decision-making.

[Learn about the Boss Clinician Boardroom](https://www.bossclinician.com/boardroom)

The Boss Clinician Lounge supports established clinicians who are full or nearly full and ready to strengthen their rates, insurance strategy, systems, income, and time.

[Learn about the Boss Clinician Lounge](https://www.bossclinician.com/lounge)

Let me know how it’s going—I’d love to hear your feedback!

Yvette Howard, LCSW
Founder, Boss Clinician$em$),

(468, 5, 5760,
$em$How’s your credentialing process going?$em$,
$em$Hi {{firstName}},

You’ve had some time to dive into the Credentialing Success Formula, and I’d love to hear your thoughts!

• What’s been your biggest takeaway so far?
• Have you seen any improvements in your credentialing process?
• Is there anything you’d like help with?

Hit reply and let me know—I’d love to feature your success story!

If you’re still working through the material, don’t worry! You have lifetime access, so you can go at your own pace.

• Revisit the Credentialing & Billing Tracker today and ensure your credentialing process is running smoothly: [Download Tracker Here](https://www.bossclinician.com/library/credentialing-success-formula/lessons/tracking-credentials)

Final Reminder: If you haven’t downloaded your Credentialing Follow-Up Scripts & Email Templates yet, make sure you do today! These templates make it easy to stay on top of credentialing follow-ups and eliminate unnecessary delays.

Claim your FREE bonus here: [Download Script Now](https://docs.google.com/spreadsheets/d/1CMd0Xr0QGOVFMMHrlcPW6cK1TnImXwrd/copy?usp=sharing&ouid=103920239567246205586&rtpof=true&sd=true)

If you’re ready for support beyond the credentialing process, choose the community that matches the stage of your practice:

Preparing to hire your first team member or already leading a growing team? The Boss Clinician Boardroom gives you CEO-level support with leadership, team systems, profitability, and the decisions required to build a practice that can grow beyond you.

[Apply for the Boss Clinician Boardroom](https://www.bossclinician.com/boardroom)

Already established, full or nearly full, and ready to improve your rates, insurance strategy, systems, income, and time? The Boss Clinician Lounge is your next room.

[Explore the Boss Clinician Lounge](https://www.bossclinician.com/lounge)

I’m cheering you on!

Yvette Howard, LCSW
Founder, Boss Clinician

P.S. If you loved this system, would you be open to leaving a quick testimonial? Your feedback helps me improve the course and support even more practice owners like you!$em$);

-- Only a sequence nobody is on, still holding the one imported email. Anything else
-- (someone joined, she rewrote it in the admin) is left alone and stays paused below.
CREATE TEMP TABLE _bc188_replace ON COMMIT DROP AS
SELECT q.id AS sequence_id
  FROM email_sequences q
 WHERE q.id IN (468, 469)
   AND NOT EXISTS (SELECT 1 FROM sequence_subscriptions u WHERE u.sequence_id = q.id)
   AND (SELECT count(*) FROM sequence_emails e WHERE e.sequence_id = q.id) = 1
   AND EXISTS (SELECT 1 FROM sequence_emails e
                WHERE e.sequence_id = q.id AND e.position = 1
                  AND e.body_md LIKE CASE q.id
                        WHEN 468 THEN '%ready to confidently build or scale%'
                        ELSE '%Insurance Panel Fee Guide in hand%'
                      END);

-- The first email keeps its row; its Kajabi numbers described a different email.
UPDATE sequence_emails e
   SET subject = v.subject,
       body_md = v.body_md,
       delay_minutes = v.delay_minutes,
       enabled = true,
       source = NULL,
       kajabi_id = NULL,
       kajabi_when = NULL,
       kajabi_sent_count = NULL,
       kajabi_opened_pct = NULL,
       kajabi_clicked_pct = NULL,
       kajabi_unsub_pct = NULL,
       updated_at = now()
  FROM _bc188_email v
  JOIN _bc188_replace r ON r.sequence_id = v.sequence_id
 WHERE e.sequence_id = v.sequence_id AND e.position = v.position;

INSERT INTO sequence_emails
  (sequence_id, position, delay_minutes, enabled, subject, body_md, from_name, from_email)
SELECT v.sequence_id, v.position, v.delay_minutes, true, v.subject, v.body_md,
       first_email.from_name, first_email.from_email
  FROM _bc188_email v
  JOIN _bc188_replace r ON r.sequence_id = v.sequence_id
  JOIN sequence_emails first_email
    ON first_email.sequence_id = v.sequence_id AND first_email.position = 1
 WHERE v.position > 1
ON CONFLICT (sequence_id, position) DO NOTHING;

-- 2. The sequence is the welcome (182's Q8), now that these two have one.

DO $bc$
DECLARE
  m record;
  v_automation integer;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      (1400, 33, 469, 3),   -- Credential With Confidence Kit
      (1417, 19, 468, 5)    -- Credentialing Success Formula
    ) AS v(automation_id, offer_id, sequence_id, email_count)
  LOOP
    SELECT a.id INTO v_automation
      FROM automations a
     WHERE a.id = m.automation_id
       AND a.status = 'paused'
       AND a.trigger_type = 'offer_purchased'
       AND a.trigger_config ->> 'offerId' = m.offer_id::text
       AND EXISTS (SELECT 1 FROM offers f
                     JOIN offer_products op ON op.offer_id = f.id
                    WHERE f.id = m.offer_id AND f.status = 'published')
       AND EXISTS (SELECT 1 FROM automation_actions x
                    WHERE x.automation_id = a.id
                      AND x.action_type = 'subscribe_sequence'
                      AND x.config ->> 'sequenceId' = m.sequence_id::text)
       AND NOT EXISTS (SELECT 1 FROM automation_actions x
                        WHERE x.automation_id = a.id
                          AND x.action_type <> 'subscribe_sequence')
       AND EXISTS (SELECT 1 FROM email_sequences q
                    WHERE q.id = m.sequence_id AND q.status = 'active')
       -- Her emails, all of them: a replacement that did not happen stops this.
       AND (SELECT count(*) FROM sequence_emails e
             WHERE e.sequence_id = m.sequence_id AND e.enabled) = m.email_count
       AND NOT EXISTS (SELECT 1 FROM sequence_emails e
                        WHERE e.sequence_id = m.sequence_id
                          AND e.body_md ~ '<o:p|\mRebecca\M|\mSample\M|\mJessica\M|^\*\*EMAIL [0-9]|Open the embedded content|Sent by Yvette|No Refund Policy|kajabi|first_name');

    IF v_automation IS NULL THEN
      RAISE NOTICE '188: automation % left as it was, offer % welcome unchanged', m.automation_id, m.offer_id;
      CONTINUE;
    END IF;

    UPDATE automations
       SET status = 'active',
           description = trim(regexp_replace(description, '[[:space:]]*Kept paused \(Q8\).*$', '')
                              || ' Switched on with the owner''s own emails, 2026-10-31.'),
           updated_at = now()
     WHERE id = v_automation;

    UPDATE offers SET send_welcome_email = false, updated_at = now()
     WHERE id = m.offer_id AND send_welcome_email;
  END LOOP;
END
$bc$;

-- 3. Kajabi. Sent campaigns are history and nothing re-sends them; left alone.

-- Footer icons become plain links on one line, header and picture images go. The
-- site has no email logo of its own (Marketing email settings "logo" is blank); when
-- one is set there, it heads every marketing email.
UPDATE sequence_emails
   SET body_md = regexp_replace(
         regexp_replace(
           regexp_replace(body_md,
             '\[!\[([^]]+)\]\(https://kajabi-storefronts-production\.kajabi-cdn\.com/[^)]*\)\]\(([^)]*)\)',
             '[\1](\2)', 'g'),
           '(\[(?:Facebook|Instagram|LinkedIn|TikTok)\]\([^)]*\))[[:space:]]+(?=\[(?:Facebook|Instagram|LinkedIn|TikTok)\]\()',
           '\1 | ', 'g'),
         '!\[[^]]*\]\(https://kajabi-storefronts-production\.kajabi-cdn\.com/[^)]*\)[[:space:]]*',
         '', 'g'),
       updated_at = now()
 WHERE body_md LIKE '%kajabi-storefronts-production.kajabi-cdn.com%';

-- Addresses, on emails and on automation emails alike. The first three are on the
-- site byte for byte (sha256 compared 31 Oct); the next two are the paid buyer's own
-- copy in their library, unlocked, so no public link to a paid file is needed.
-- /boss-clinician-club has no page here; /club is the Club (101 made the same mapping).
CREATE TEMP TABLE _bc188_link (old_url text, new_url text) ON COMMIT DROP;
INSERT INTO _bc188_link VALUES
  ('https://s3.amazonaws.com/kajabi-storefronts-production/file-uploads/sites/2148299891/downloads/5d56be5-e542-155b-6bff-6bc00e057f0_5-Step_Marketing_Plan_3_.pdf',
   'https://www.bossclinician.com/downloads/5-step-marketing-plan.pdf'),
  ('https://s3.amazonaws.com/kajabi-storefronts-production/file-uploads/sites/2148299891/downloads/864f74b-38ff-42b-14c0-f13e5ef6120_Kick_Start_Guide.pdf',
   'https://www.bossclinician.com/downloads/private-practice-kickstart-guide.pdf'),
  ('https://s3.amazonaws.com/kajabi-storefronts-production/file-uploads/sites/2148299891/downloads/03752ca-f0f-8755-a5f8-beda27363c0f_The_Private_Practice_Starter_Guide.pdf',
   'https://www.bossclinician.com/downloads/private-practice-kickstart-guide.pdf'),
  ('https://s3.amazonaws.com/kajabi-storefronts-production/file-uploads/sites/2148299891/downloads/c22f38e-be3f-e53c-d82-b788f2b7af65_PP_Pack_.pdf.pdf',
   'https://www.bossclinician.com/library?tab=documents'),
  ('https://s3.amazonaws.com/kajabi-storefronts-production/file-uploads/sites/2148299891/downloads/f6cb6b2-1bc0-1c8a-8433-2fe7c42d4d_The_First_30_Days_Success_Planner.pdf_2_.pdf',
   'https://www.bossclinician.com/library/the-boss-move/lessons/the-first-30-day-success-planner'),
  -- Kajabi's own admin screen: a buyer could never open it. Niche Clarity is a
  -- download product, and that is where those are.
  ('https://app.kajabi.com/admin/downloads/collections/287014/files',
   'https://www.bossclinician.com/library?tab=documents'),
  ('https://www.bossclinician.com/boss-clinician-club',
   'https://www.bossclinician.com/club');

DO $bc$
DECLARE
  l record;
BEGIN
  FOR l IN SELECT * FROM _bc188_link LOOP
    UPDATE sequence_emails
       SET body_md = replace(body_md, l.old_url, l.new_url), updated_at = now()
     WHERE strpos(body_md, l.old_url) > 0;

    UPDATE automation_actions
       SET config = jsonb_set(config, '{bodyMd}', to_jsonb(replace(config ->> 'bodyMd', l.old_url, l.new_url))),
           updated_at = now()
     WHERE action_type = 'send_email'
       AND strpos(config ->> 'bodyMd', l.old_url) > 0;
  END LOOP;
END
$bc$;

-- Every mykajabi link in an email is The Lounge's sales page.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         'https://bossclinician\.mykajabi\.com/lounge(\?cid=[^)[:space:]"]*)?',
         'https://www.bossclinician.com/lounge', 'g'),
       updated_at = now()
 WHERE body_md LIKE '%bossclinician.mykajabi.com/lounge%';
