-- QA row 211: a purchase or a single admin grant starts the emails that come
-- with the offer. Those emails hang off the Kajabi-imported offer_purchased
-- automations, every one of which was imported paused.
--
-- Nothing here emails anybody. No subscription row is written and no event is
-- raised: the automations below only react to purchases and grants made after
-- this runs, and sequence_subscriptions was empty when it was written. People
-- who already hold these offers, 101 'import' grants among them, are not touched.

-- 1. The sequences that belong to a course, whether switched on now or by the
--    owner later. The Kajabi import rendered the preview person's name into the
--    text ("Hey Yvette", "Hey Sample", "Hi Jessica") or lost it ("Hey ,"); to a
--    customer that reads as somebody else's email. {{firstName}} says "there"
--    when no name is known. Only whole-line greetings and the "..., Sample."
--    closing lines are changed, so "Yvette here" and her signature stay.
UPDATE sequence_emails
   SET body_md = regexp_replace(
         regexp_replace(
           regexp_replace(
             body_md,
             '^(\*\*)?(Hey|Hi)( (Sample|Yvette|Jessica))?[ ]*,?(\*\*)?[ ]*$',
             '\1\2 {{firstName}},\5',
             'gn'),
           ', (Sample|Jessica|Yvette)([.!])',
           ', {{firstName}}\2',
           'g'),
         '</?o:p>',
         '',
         'g'),
       updated_at = now()
 WHERE sequence_id IN (461, 462, 465, 466, 467, 468, 469, 470, 471, 472, 485, 486, 487, 494)
   AND (body_md ~ '(?n)^(\*\*)?(Hey|Hi)( (Sample|Yvette|Jessica))?[ ]*,?(\*\*)?[ ]*$'
        OR body_md ~ ', (Sample|Jessica|Yvette)[.!]'
        OR body_md ~ '</?o:p>');

-- 2. exit_on_purchase is how a sequence that sells something stops selling it.
--    On these it would mean a $7 guide bought in week 3 ends a six-month course
--    series, so a later purchase no longer ends them.
UPDATE email_sequences
   SET exit_on_purchase = false, updated_at = now()
 WHERE id IN (461, 462, 465, 466, 467, 468, 469, 470, 471, 472, 485, 486, 487, 494)
   AND exit_on_purchase;

-- 3. Switched on: the offer is published with something in it, the only step is
--    "start this sequence", the sequence is active with emails in it, and its
--    first email waits at least a day, so it cannot land on top of the welcome
--    email that goes out at the moment of purchase.
--
--      1423  The Fully Booked Therapist Toolkit -> Fully Booked Toolkit (2 days)
--      1408  Private Practice Starter Suite     -> Starter Suite emails (1 day)
--      1396  Ramp Up Rate Pricing Formula       -> Ramp Up Revenue (1 day)
--      1406  The Club                           -> The Club 24 Weeks Update (1 day)
UPDATE automations a
   SET status = 'active', updated_at = now()
  FROM (VALUES (1423, 18, 470), (1408, 20, 465), (1396, 23, 466), (1406, 39, 487))
         AS v(automation_id, offer_id, sequence_id)
 WHERE a.id = v.automation_id
   AND a.status = 'paused'
   AND a.trigger_type = 'offer_purchased'
   AND a.trigger_config ->> 'offerId' = v.offer_id::text
   AND EXISTS (SELECT 1 FROM offers f
                 JOIN offer_products op ON op.offer_id = f.id
                WHERE f.id = v.offer_id AND f.status = 'published')
   AND EXISTS (SELECT 1 FROM automation_actions x
                WHERE x.automation_id = a.id
                  AND x.action_type = 'subscribe_sequence'
                  AND x.config ->> 'sequenceId' = v.sequence_id::text)
   AND NOT EXISTS (SELECT 1 FROM automation_actions x
                    WHERE x.automation_id = a.id
                      AND x.action_type <> 'subscribe_sequence')
   AND EXISTS (SELECT 1 FROM email_sequences q
                 JOIN sequence_emails e ON e.sequence_id = q.id AND e.enabled
                WHERE q.id = v.sequence_id AND q.status = 'active');

-- Left paused, for the owner to decide:
--
-- Matched, but the first email goes at once alongside the welcome email (two
-- welcomes at purchase). Greeting and exit fixes above are already applied, so
-- each only needs switching on, with the offer's welcome email turned off if she
-- wants just one (a brand-new account still gets its set-password link):
--   1376 The Boss Boardroom -> BC Aligned Expansion Welcome (461)
--   1372 Practice Reset Intensive -> BC Elite Welcome (462)
--   1373 Scale and Reclaim Suite -> BC Scale and Sustain Welcome (494)
--   1349 The Lounge -> The Lounge-Purchase (485)
--   1407 The Club -> The Club Paid for Course Emails (486)
--   1417 Credentialing Success Formula -> CSF Purchased (468)
--   1400 Credential With Confidence Kit -> CWC Purchased (469)
--   1398 Private Practice Protection Pack -> Practice Protection Pack (467)
--   1394 From Profile to Profit -> Therapist Directory Guide (472)
--   1424 Client Consultation Call Script -> Client Consultation Call Script (471)
--
-- Not safe to send as written:
--   1368, 1369 Bali -> Retreat Deposit (493): addressed to one named person and
--     quotes one room's dollar amounts.
--
-- Single emails rather than sequences, on top of the welcome email:
--   1388, 1389, 1392, 1393 (offers 35, 34, 24, 36)
--   1377 Directory Audit (offer 32): the intake email already goes from the code.
--
-- Point at offers that cannot be bought (draft):
--   1335, 1336 (109), 1342 (106), 1343 (105), 1380 (111), 1381 (113), 1382 (114),
--   1383, 1385 (112), 1390 (117), 1395 (118), 1421 (45)
--
-- Point at a Kajabi offer that was never imported (no offer to match):
--   1374, 1375, 1378, 1379, 1420
--
-- Not emails, or already handled:
--   1334, 1336, 1337 unsubscribe from Maxed Out: exit_on_purchase already does it.
--   1350, 1351 add the Bali tag.
--   1399 grants offer 21 to people who just got offer 21.
--
-- Gap: the published offer The Lounge | VIP (41) starts no sequence at all; only
-- the draft duplicate (109) does, through 1335.
