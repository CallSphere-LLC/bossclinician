-- 23 Nov 2026 — Yvette's answers (items 11 and 12). Guarded: each UPDATE only
-- fires while the old wording is still there, so re-running is a no-op and an
-- owner edit made in the admin is never overwritten. Nothing here sends email.

-- ── Item 11: Love Note 8 (campaign 1436, stays DRAFT) ────────────────────────
-- "Yes, please link it to the new retreat dashboard. Replace 'Log in this
-- month' with: 'Log in to your retreat dashboard to review your details and
-- complete any outstanding items.'"
-- Was: "Log in this month and confirm your remaining payments will complete by then."
UPDATE email_campaigns
   SET body_md = replace(body_md,
         'Log in this month and confirm your remaining payments will complete by then.',
         '[Log in to your retreat dashboard](https://www.bossclinician.com/retreats/dashboard/bali-2027) to review your details and complete any outstanding items.'),
       updated_at = now()
 WHERE id = 1436 AND status = 'draft'
   AND position('Log in this month and confirm your remaining payments will complete by then.' in body_md) > 0;

-- ── Item 12: Retreat Deposit email (sequence 493, email 1619) ────────────────
-- Removes "at your own pace — in whatever amounts" and uses her sentence. The
-- two fixed room blocks (private AND shared, shown to every buyer) become one
-- block filled per guest from retreat_guests.room_type
-- (services/retreatRoomBlock.ts): shared-room lines only for a confirmed
-- shared-room guest (today Norma and Raelara), private for Sharon, a neutral
-- line for anyone without a confirmed room.
-- The old "Please manage your payments through the account where you
-- originally began..." paragraph said the same thing as her new sentence and
-- is reduced to its reminder line.
UPDATE sequence_emails
   SET body_md = replace(replace(body_md,
         '<p><strong>Private King Suite:</strong></p>
<p>Remaining balance: $5,000</p>
<p>Pay it off in installments at your own pace — in whatever amounts work for you.</p>
<p>Total investment: $5,500</p>
<p><br></p>
<p><strong>Shared Luxury Room:</strong></p>
<p>Remaining balance: $4,000 per person</p>
<p>Pay it off in installments at your own pace — in whatever amounts work for you.</p>
<p>Total investment: $4,500 per person</p>',
         '<p><strong>{{retreat_room_label}}:</strong></p>
<p>{{retreat_room_balance_line}}</p>
<p>Please follow your agreed payment schedule. You can review your plan and make payments through the account where you began your payments. If your plan is being transferred, we’ll send you updated payment instructions.</p>
<p>{{retreat_room_total_line}}</p>'),
         '<p>Please manage your payments through the account where you originally began your payment plan. If your payment access changes, we’ll email you updated instructions and a secure link to pay your remaining balance. We recommend setting personal reminders so your balance is cleared well before the June 8 deadline.</p>',
         '<p>We recommend setting personal reminders so your balance is cleared well before the June 8 deadline.</p>'),
       updated_at = now()
 WHERE id = 1619 AND sequence_id = 493
   AND position('in whatever amounts work for you.' in body_md) > 0;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM sequence_emails WHERE id = 1619 AND position('whatever amounts' in body_md) > 0) THEN
    RAISE EXCEPTION '228: email 1619 wording changed since 23 Nov; review before replacing';
  END IF;
END
$check$;
