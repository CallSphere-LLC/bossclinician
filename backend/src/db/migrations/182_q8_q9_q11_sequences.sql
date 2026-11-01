-- =============================================================================
-- 182: Yvette's email decisions of 30 Oct (Q8, Q9, Q11)
--
-- Q8  The paid-course sequences become the welcome: their automations go on and
--     the offer's own welcome email goes off, so a buyer gets one welcome. A
--     brand-new account still gets its set-password email and the receipt
--     (purchaseDelivery.ts: receipt is independent of the switch; the else-branch
--     after the welcome sends the link alone).
-- Q9  New sequence The Lounge VIP on offer 41, plus the Lounge sequence (485) from
--     its second email, so a VIP gets no Lounge welcome.
-- Q11 Free guides reach the sequence or email she built on Kajabi.
--
-- Future events only. No subscription row is written and no event is raised;
-- nobody who already holds an offer or is on a list hears anything. Every switch
-- has its guards: if any fails, that mapping stays as it was and raises a NOTICE.
--
-- Ships together with the code: enrollContact's startAtPosition and sendDueEmail's
-- requires_offer_id check. Without the first, a VIP would get the Lounge welcome.
-- =============================================================================

ALTER TABLE email_sequences
  ADD COLUMN IF NOT EXISTS requires_offer_id INT REFERENCES offers(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_sequences.requires_offer_id IS
  'When set, a subscriber who no longer holds this offer leaves the sequence at their next send.';

-- 1. Copy that cannot go out as imported. Exact strings, on the emails they are in.

-- Links with no page behind them on this site. /coaching, /library and the
-- documents tab are where these buyers' purchases actually are.
UPDATE sequence_emails
   SET body_md = replace(body_md,
         'https://www.bossclinician.com/coaching/one_on_one/boss-clinician-ceo-accelerator',
         'https://www.bossclinician.com/coaching'),
       updated_at = now()
 WHERE sequence_id IN (461, 494)
   AND body_md LIKE '%/coaching/one_on_one/boss-clinician-ceo-accelerator%';

UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         'https://www\.bossclinician\.com/products/credentialing-success-formula(\?cid=[^)[:space:]]*)?',
         'https://www.bossclinician.com/library/credentialing-success-formula', 'g'),
       updated_at = now()
 WHERE sequence_id = 468 AND body_md LIKE '%/products/credentialing-success-formula%';

UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         'https://www\.bossclinician\.com/downloads/(client-consultation-call-script|from-profile-to-profit)(\?cid=[^)[:space:]]*)?',
         'https://www.bossclinician.com/library?tab=documents', 'g'),
       updated_at = now()
 WHERE sequence_id IN (471, 472)
   AND body_md ~ '/downloads/(client-consultation-call-script|from-profile-to-profit)';

UPDATE sequence_emails
   SET body_md = replace(body_md,
         'https://www.bossclinician.com/offers/ifw8koHv',
         'https://www.bossclinician.com/services/directory-makeover-audit'),
       updated_at = now()
 WHERE sequence_id = 472 AND body_md LIKE '%/offers/ifw8koHv%';

-- Sequence 487 (on since 179) sent its last email's readers to the Kajabi site.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         'https://bossclinician\.mykajabi\.com/lounge(\?cid=[^)[:space:]]*)?',
         'https://www.bossclinician.com/lounge', 'g'),
       updated_at = now()
 WHERE sequence_id = 487 AND body_md LIKE '%bossclinician.mykajabi.com/lounge%';

-- Kajabi's own footer, baked into the text with an "Unsubscribe" that links to
-- nothing. Every send already carries the real one.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         '[[:space:]]*Unsubscribe \| Sent by Yvette Howard''s First Site[[:space:]]+848 N Rainbow Blvd, 441 • Las Vegas, NV • 89107[[:space:]]*$',
         ''),
       updated_at = now()
 WHERE sequence_id IN (468, 469) AND body_md LIKE '%Sent by Yvette Howard''s First Site%';

-- The import's stand-in for a GIF.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         '\[Open the embedded content \(giphy\.com\)\]\(https://giphy\.com/embed/[^)]*\)[[:space:]]*',
         '', 'g'),
       updated_at = now()
 WHERE sequence_id IN (485, 486) AND body_md LIKE '%Open the embedded content%';

-- The same stand-in in an email the owner has since saved from the editor, as HTML.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         '<p>[[:space:]]*<a href="https://giphy\.com/embed/[^"]*">Open the embedded content \(giphy\.com\)</a>[[:space:]]*</p>[[:space:]]*',
         '', 'g'),
       updated_at = now()
 WHERE sequence_id IN (485, 486) AND body_md LIKE '%Open the embedded content%';

-- The Lounge welcome told every buyer "all sales are final", against the 7-day
-- money-back guarantee (Q1). The line is removed, no wording replaces it; her
-- agreement states the terms. The "P.S. Follow along for more:" beside it lost
-- whatever it pointed at and broke the emphasis around the signature.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         '\*Boss Clinician[[:space:]]+\*\*P\.S\.\*\* Follow along for more:\*[[:space:]]+\*\*No Refund Policy Reminder:\*\*[^' || chr(10) || ']*$',
         'Boss Clinician' || chr(10) || chr(10) || 'Questions? Just reply to this email. We are here to help.'),
       updated_at = now()
 WHERE sequence_id = 485 AND position = 1 AND body_md LIKE '%No Refund Policy Reminder%';

-- And the same line once saved as HTML.
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         '<p>(?:(?!</p>).)*No Refund Policy Reminder(?:(?!</p>).)*</p>[[:space:]]*',
         '', 'g'),
       updated_at = now()
 WHERE sequence_id = 485 AND position = 1 AND body_md LIKE '%No Refund Policy Reminder%';

-- "\1. Don't give up." printed its backslash. Joined into one block, or the four
-- separate lists would each read "1.".
UPDATE sequence_emails
   SET body_md = regexp_replace(
         regexp_replace(body_md, '\\([0-9])\. ([^' || chr(10) || ']*)' || chr(10) || chr(10) || '(?=\\[0-9]\.)', '\1. \2' || chr(10), 'g'),
         '\\([0-9])\.', '\1.', 'g'),
       updated_at = now()
 WHERE sequence_id = 486 AND position = 2 AND body_md ~ '\\[0-9]\.';

-- 2. Q8: the sequence is the welcome.

DO $bc$
DECLARE
  m record;
  v_automation integer;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      (1376, 44, 461),   -- The Boss Boardroom
      (1372, 42, 462),   -- Practice Reset Intensive
      (1373, 43, 494),   -- Scale and Reclaim Suite
      (1349, 40, 485),   -- The Lounge
      (1407, 39, 486),   -- The Club (1406 stays on beside it: weekly emails, no welcome)
      (1398, 21, 467),   -- Private Practice Protection Pack
      (1394, 22, 472),   -- From Profile to Profit
      (1424, 38, 471)    -- Client Consultation Call Script
    ) AS v(automation_id, offer_id, sequence_id)
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
                     JOIN sequence_emails e ON e.sequence_id = q.id AND e.enabled
                    WHERE q.id = m.sequence_id AND q.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM sequence_emails e
                        WHERE e.sequence_id = m.sequence_id
                          AND e.body_md ~ '<o:p|\mRebecca\M|\mSample\M|\mJessica\M|^\*\*EMAIL [0-9]|Open the embedded content|Sent by Yvette|No Refund Policy|/coaching/one_on_one|/products/credentialing|/offers/ifw8koHv|/downloads/(client-consultation|from-profile)');

    IF v_automation IS NULL THEN
      RAISE NOTICE '182: automation % left as it was, offer % welcome unchanged', m.automation_id, m.offer_id;
      CONTINUE;
    END IF;

    UPDATE automations
       SET status = 'active',
           description = trim(description || ' Switched on 2026-10-30 (Q8).'),
           updated_at = now()
     WHERE id = v_automation;

    UPDATE offers SET send_welcome_email = false, updated_at = now()
     WHERE id = m.offer_id AND send_welcome_email;
  END LOOP;

  -- Credential With Confidence Kit stays as it is: automation 1400 paused, the
  -- offer's welcome on. Its sequence (469) has no welcome and no way to the kit,
  -- only a coaching pitch opening "Now that you've got the Insurance Panel Fee
  -- Guide in hand": on Kajabi it followed an "Immediate Delivery & Welcome" email
  -- that was never imported. Sent as the welcome, a buyer loses their access email;
  -- sent beside it, the pitch lands in the same minute as the purchase.
  UPDATE automations
     SET description = trim(description || ' Kept paused (Q8): the sequence has no welcome or access link, it needs the Kajabi "Immediate Delivery & Welcome" email first. The offer''s welcome email stays on.'),
         updated_at = now()
   WHERE id = 1400 AND status = 'paused';

  -- The Lounge's trigger names only the offer, so it holds for any way of paying.
  -- Bought together with VIP, the VIP automation below has this: no Lounge welcome.
  UPDATE automations
     SET conditions = jsonb_build_object(
           'match', 'all',
           'rules', jsonb_build_array(jsonb_build_object('field', 'owns_offer', 'op', 'not_has', 'value', 41))),
         description = trim(description || ' Skipped for anyone holding The Lounge | VIP, who joins this sequence from its second email.'),
         updated_at = now()
   WHERE id = 1349 AND status = 'active'
     AND conditions -> 'rules' = '[]'::jsonb;
END
$bc$;

-- 3. Q9: The Lounge VIP.

INSERT INTO email_sequences
  (name, slug, description, status, topic, use_contact_timezone, timezone,
   exit_on_purchase, allow_reentry, requires_offer_id)
SELECT 'The Lounge VIP', 'the-lounge-vip',
       'VIP milestone emails, from the owner''s document of 30 Oct 2026. Days 0, 30, 75, 105, 165; each delay counts from the previous enabled email. Disabled until sequences can check bookings and benefit use: the kickoff booking email, Reminder A and Reminder B. Sent as they stand they would reach members who already booked, and enabling one pushes every later email back by its delay. Leaves automatically when VIP access ends.',
       'active', 'marketing', false, 'America/Los_Angeles',
       false, false, 41
 WHERE EXISTS (SELECT 1 FROM offers f WHERE f.id = 41 AND f.slug = 'the-lounge-vip' AND f.status = 'published')
   AND NOT EXISTS (SELECT 1 FROM email_sequences s WHERE s.slug = 'the-lounge-vip');

INSERT INTO sequence_emails (sequence_id, position, delay_minutes, enabled, subject, body_md)
SELECT s.id, v.position, v.delay_minutes, v.enabled, v.subject, v.body_md
  FROM email_sequences s
 CROSS JOIN (VALUES
  (1, 0, true,
   $vip$Welcome to The Lounge VIP — Let’s Make Some Boss Moves!$vip$,
   $vip$Hey {{firstName}},

Welcome to The Boss Clinician Lounge VIP!

You’re officially stepping into a space designed to help you stop figuring everything out alone and start making strategic moves in your private practice.

Inside The Lounge, you have the education, tools, and community to support your growth. As a VIP member, you also have personalized support to help put those strategies into action.

Here’s what I want you to focus on first:

1. Complete your Practice Reset Snapshot. This helps us understand where your practice stands today.
2. Schedule your VIP Kickoff Call. We’ll identify your biggest priorities and create a plan to move forward.
3. Explore your VIP resources. You’ll have opportunities to submit questions and eligible materials for personalized feedback throughout your membership.

Being a boss clinician doesn’t mean doing everything yourself. It means making informed decisions and building a practice that supports the life you want.

Your next step — access your VIP Dashboard: [https://www.bossclinician.com/login](https://www.bossclinician.com/login)

Let’s grow your practice with intention.

Yvette Howard, LCSW
Founder, Boss Clinician$vip$),
  (2, 4320, false,
   $vip$Let’s Get Your VIP Strategy Session Scheduled$vip$,
   $vip$Hey {{firstName}},

You’ve joined The Lounge VIP, and now it’s time to put your personalized support to work!

Your VIP Kickoff Call is an opportunity for us to talk through what’s happening in your practice and identify where your attention should go first.

Before our call, think about three things:
• What’s currently working well in your practice?
• What’s taking up more of your time or energy than it should?
• What would you love to accomplish over the next 90 days?

You don’t need to have everything figured out before we meet. That’s part of why you’re here.

Schedule your VIP Kickoff Call: [https://schedule.bossclinician.com/vip-kickoff-strategy-call](https://schedule.bossclinician.com/vip-kickoff-strategy-call)

My goal is for you to leave our conversation with greater clarity about your next steps—not another overwhelming to-do list.

Let’s make those boss moves!

Yvette$vip$),
  (3, 10080, false,
   $vip$Quick Reminder: Your VIP Kickoff Call$vip$,
   $vip$Hey {{firstName}},

Just checking in because your VIP Kickoff Call hasn’t been scheduled yet.

I want to make sure you have the opportunity to use the personalized support included with your membership.

Your Kickoff Call is where we identify your immediate priorities and talk about the next steps for your practice.

Book your VIP Kickoff Call: [https://schedule.bossclinician.com/vip-kickoff-strategy-call](https://schedule.bossclinician.com/vip-kickoff-strategy-call)

If you’ve already scheduled or need assistance, reach out to support@bossclinician.com.

See you soon!

Yvette$vip$),
  (4, 43200, true,
   $vip$Your VIP Support Is Here — Don’t Figure It All Out Alone$vip$,
   $vip$Hey {{firstName}},

We’re moving into another month inside The Lounge VIP, and I want to remind you of something important.

You don’t have to wait until you’re completely stuck to ask for support.

Maybe you’re trying to improve your referral strategy, update your website, figure out your next marketing move, or make a decision about how to grow your practice.

Those are exactly the kinds of things I want you to bring into your VIP experience.

This month, I encourage you to use your available VIP feedback opportunities. Submit an eligible question or business material for review through your VIP portal, according to your membership benefits.

Sign in to your VIP Dashboard to find your submission resources: [https://www.bossclinician.com/login](https://www.bossclinician.com/login)

Here’s my challenge: Don’t just collect resources. Choose one strategy, implement it, and pay attention to what happens.

That’s how we turn information into results.

You’ve got this!

Yvette$vip$),
  (5, 64800, true,
   $vip$90 Days In — Let’s Talk About What’s Working$vip$,
   $vip$Hey {{firstName}},

Can you believe you’re approaching your first 90 days inside The Lounge VIP?

This is a great time to look at your progress, celebrate what you’ve accomplished, and identify what needs to change.

I don’t want you measuring success only by how many new clients you’ve booked. Sometimes progress looks like better boundaries, clearer marketing messages, stronger referral relationships, or better systems.

Let’s use your 90-Day Momentum Session to evaluate where you are and what comes next.

Before the session, revisit your Practice Reset Snapshot and think about:
1. What have I implemented over the past 90 days?
2. What results or changes have I noticed?
3. Where am I still experiencing challenges?
4. What needs to become my priority for the next 90 days?

Schedule your Momentum Session: [https://schedule.bossclinician.com/vip-momentum](https://schedule.bossclinician.com/vip-momentum)

We’re not chasing busy. We’re building a practice that works.

See you soon!

Yvette$vip$),
  (6, 43200, true,
   $vip$Before You Create Something New, Let’s Review What You Have$vip$,
   $vip$Hey {{firstName}},

I have a question for you.

Are you spending more time creating new things for your practice than improving what’s already there?

Sometimes we think the answer to getting more clients is another social media post, another service, or another marketing idea. But often, the opportunity is in something we’ve already created that needs attention.

Maybe it’s your website messaging, referral outreach strategy, consultation process, or client follow-up system.

As a VIP member, you have access to personalized feedback opportunities designed to help you make more intentional decisions.

This month, identify one thing in your practice that could work better with a few strategic adjustments. Submit an eligible item through your VIP portal.

Sign in to your VIP Dashboard for feedback submission instructions: [https://www.bossclinician.com/login](https://www.bossclinician.com/login)

Growth isn’t always about doing more. Sometimes it’s about making what you’re already doing more effective.

Keep moving like a boss!

Yvette$vip$),
  (7, 86400, true,
   $vip$Six Months of Boss Moves — Let’s Plan What’s Next$vip$,
   $vip$Hey {{firstName}},

You’re approaching an important milestone inside The Lounge VIP!

Over the past several months, you’ve had opportunities to evaluate your practice, strengthen your strategies, and make more intentional business decisions.

Now it’s time to look at the bigger picture.

Your VIP Elevation Review is about identifying what’s changed, what’s still holding you back, and what your next season of growth should look like.

Before your session, revisit your original goals:
• What am I doing differently in my practice today?
• What systems or strategies have improved?
• What am I ready to stop doing?
• What are my three biggest priorities for the next six months?

Schedule your VIP Elevation Review: [https://schedule.bossclinician.com/vip-elevation](https://schedule.bossclinician.com/vip-elevation)

Completing your initial six-month commitment doesn’t mean your growth journey ends. If you’re continuing your membership, The Lounge remains your space for ongoing strategy, implementation resources, and community support.

You’ve invested in becoming a stronger practice owner. Keep building on that investment.

Yvette$vip$),
  (8, 43200, false,
   $vip$Have a Practice Question? Your VIP Support Is Available$vip$,
   $vip$Hey {{firstName}},

A quick reminder that your VIP membership includes opportunities for personalized support.

If there’s a decision you’ve been sitting on, a strategy you want feedback on, or an eligible business material you’d like reviewed, this is your reminder to use the resources available to you.

Visit Your VIP Dashboard: [https://www.bossclinician.com/login](https://www.bossclinician.com/login)

You don’t have to make every practice decision alone.

Let’s keep building with intention.

Yvette

────────────────────────────────────────$vip$)
 ) AS v(position, delay_minutes, enabled, subject, body_md)
 WHERE s.slug = 'the-lounge-vip'
ON CONFLICT (sequence_id, position) DO NOTHING;

DO $bc$
DECLARE
  v_vip integer;
  v_new integer;
BEGIN
  SELECT s.id INTO v_vip FROM email_sequences s
   WHERE s.slug = 'the-lounge-vip' AND s.status = 'active'
     AND EXISTS (SELECT 1 FROM sequence_emails e WHERE e.sequence_id = s.id AND e.enabled);

  IF v_vip IS NULL
     OR NOT EXISTS (SELECT 1 FROM offers f JOIN offer_products op ON op.offer_id = f.id
                     WHERE f.id = 41 AND f.status = 'published')
     -- Position 1 must still be the welcome being skipped, position 2 must be there.
     OR NOT EXISTS (SELECT 1 FROM email_sequences q
                      JOIN sequence_emails e1 ON e1.sequence_id = q.id AND e1.position = 1
                      JOIN sequence_emails e2 ON e2.sequence_id = q.id AND e2.position = 2 AND e2.enabled
                     WHERE q.id = 485 AND q.status = 'active' AND NOT q.exit_on_purchase
                       AND e1.subject LIKE '%Welcome to the Boss Clinician Lounge%') THEN
    RAISE NOTICE '182: VIP automation not created, offer 41 welcome unchanged';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM automations a WHERE a.name = 'The Lounge | VIP: VIP emails and Lounge emails') THEN
    RETURN;
  END IF;

  INSERT INTO automations (name, description, trigger_type, trigger_config, conditions, status)
  VALUES (
    'The Lounge | VIP: VIP emails and Lounge emails',
    'Starts The Lounge VIP, and The Lounge-Purchase from its second email so a VIP gets one welcome (Q9). If the Lounge emails are ever reordered, its welcome must stay first.',
    'offer_purchased',
    jsonb_build_object('offerId', 41),
    jsonb_build_object('match', 'all', 'rules', '[]'::jsonb),
    'active'
  )
  RETURNING id INTO v_new;

  INSERT INTO automation_actions (automation_id, action_type, config, sort) VALUES
    (v_new, 'subscribe_sequence', jsonb_build_object('sequenceId', v_vip), 0),
    (v_new, 'subscribe_sequence', jsonb_build_object('sequenceId', 485, 'startAtPosition', 2), 1);

  -- The VIP sequence's first email is the welcome.
  UPDATE offers SET send_welcome_email = false, updated_at = now()
   WHERE id = 41 AND send_welcome_email;
END
$bc$;

-- 4. Q11: free guides. The guide's own file email stays on wherever there is one.

DO $bc$
DECLARE
  m record;
  v_automation integer;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      (1433, 'insurance-guide',  475, ''),                                 -- 475's first email repeats the file from automation 12
      (1434, 'practice-planner', 474, ''),                                 -- nothing else emails this file
      (1366, 'reset-audit',      NULL::int, 'Something to share!'),        -- one email, not a sequence; the page promises it
      (1364, 'reset-planner',    NULL::int, 'Your Practice Reset Planner is here%')
    ) AS v(automation_id, form_slug, sequence_id, subject_like)
  LOOP
    SELECT a.id INTO v_automation
      FROM automations a
      JOIN forms f ON f.slug = m.form_slug AND f.published
      JOIN automation_actions x ON x.automation_id = a.id
     WHERE a.id = m.automation_id
       AND a.status = 'paused'
       AND a.trigger_type = 'form_submitted'
       AND (a.trigger_config ->> 'formId')::integer = f.id
       -- A form that starts a sequence itself must not be doubled.
       AND f.subscribe_sequence_id IS NULL
       AND (SELECT count(*) FROM automation_actions y WHERE y.automation_id = a.id) = 1
       AND CASE
             WHEN m.sequence_id IS NOT NULL THEN
               x.action_type = 'subscribe_sequence'
               AND (x.config ->> 'sequenceId')::integer = m.sequence_id
               AND EXISTS (SELECT 1 FROM email_sequences q
                             JOIN sequence_emails e ON e.sequence_id = q.id AND e.enabled
                            WHERE q.id = m.sequence_id AND q.status = 'active')
               AND NOT EXISTS (SELECT 1 FROM sequence_emails e
                                WHERE e.sequence_id = m.sequence_id
                                  AND e.body_md ~ '<o:p|\mRebecca\M|\mSample\M|\mJessica\M|^\*\*EMAIL [0-9]|Open the embedded content|Sent by Yvette')
             ELSE
               x.action_type = 'send_email'
               AND x.config ->> 'subject' LIKE m.subject_like
               AND x.config ->> 'bodyMd' !~ '<o:p|\mRebecca\M|\mSample\M|\mJessica\M|^\*\*EMAIL [0-9]|Open the embedded content|Sent by Yvette'
           END;

    IF v_automation IS NULL THEN
      RAISE NOTICE '182: % left as it was', m.form_slug;
      CONTINUE;
    END IF;

    UPDATE automations
       SET status = 'active',
           description = trim(description || ' Switched on 2026-10-30 (Q11).'),
           updated_at = now()
     WHERE id = v_automation;
  END LOOP;

  UPDATE automations
     SET description = trim(description || ' Kept paused (Q11): the form itself starts this sequence (its "start a sequence" setting), so this would add nothing.'),
         updated_at = now()
   WHERE id = 1416 AND status = 'paused';

  UPDATE automations
     SET description = trim(description || ' Kept paused (Q11): "5-Step Marketing Plan email" already sends this file; with both on one sign-up gets it twice.'),
         updated_at = now()
   WHERE id = 1367 AND status = 'paused';
END
$bc$;
