-- =============================================================================
-- 223 — Public retreat pages and retreat wording (Yvette's second reply of
-- 22 Nov 2026, items 4, 5, 6 public pages and 7 insurance wording).
--
-- 1. retreats: the PUBLIC listing switch for /upcoming-retreats, separate from
--    retreats.published. `published` opens the private guest dashboard (every
--    guest endpoint answers 404 while it is false, migration 218) and Bali's
--    dashboard is still a draft, while Bali's sales page has been public since
--    September. One flag cannot mean both, so:
--      listed_publicly  shown on /upcoming-retreats while end_date (Pacific)
--                       has not passed. Default false: a new or duplicated
--                       retreat is never listed until the owner says so.
--      public_path      where its card links (an internal path or https URL);
--                       NULL = its destination-and-year page /retreats/<slug>.
--      public_summary   one or two sentences for the card.
--      public_image     card photo (site path).
--    Bali is listed, linking to its existing sales page /retreats (which is
--    also served at /retreats/bali-2027). Its summary is the approved hero
--    paragraph of that page; its photo is the page's own hero photo.
--
-- 2. The "Retreat Announcements" tag that /retreat-interest applies. No
--    automation, sequence or email is attached to it.
--
-- 3. Retreat Deposit email (sequence "Retreat Deposit", the only email in it):
--    the Kajabi payment sentence becomes Yvette's exact sentence (item 5); a
--    stray literal "<o:p> </o:p>" Word artefact the email printed is removed.
--
-- 4. Private-room purchase next steps (offer bali-private-room): transport in
--    her item 4 wording; travel insurance "strongly recommended, not required".
--
-- 5. Bali Love Notes 6–8 (DRAFT campaigns, never sent): airport "pickup"
--    wording becomes designated group transfers (never on-demand transport).
--
-- Sends nothing, grants nothing, changes no price, payment, order, signed
-- agreement or member data. Every UPDATE is guarded on the exact old text, so
-- a second run (or an owner edit made in the admin since) is left alone.
-- The signed/assignable PDF agreements (participant_contracts) are NOT touched.
-- =============================================================================

-- 1. Public listing columns ----------------------------------------------------
ALTER TABLE retreats ADD COLUMN IF NOT EXISTS listed_publicly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retreats ADD COLUMN IF NOT EXISTS public_path     TEXT;
ALTER TABLE retreats ADD COLUMN IF NOT EXISTS public_summary  TEXT NOT NULL DEFAULT '';
ALTER TABLE retreats ADD COLUMN IF NOT EXISTS public_image    TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN retreats.listed_publicly IS
  'Shown on the public /upcoming-retreats page until its end_date passes (Pacific). Independent of published, which opens the private guest dashboard.';
COMMENT ON COLUMN retreats.public_path IS
  'Where the public card links: a site path (/retreats) or an https URL. NULL = /retreats/<slug>.';

-- Only a site path ("/x", never "//host") or an https URL may be stored.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retreats_public_path_safe') THEN
    ALTER TABLE retreats ADD CONSTRAINT retreats_public_path_safe
      CHECK (public_path IS NULL OR public_path ~ '^/([^/]|$)' OR public_path ~ '^https://');
  END IF;
END $$;

UPDATE retreats
   SET listed_publicly = true,
       public_path     = '/retreats',
       public_summary  = 'A six-day, five-night Bali retreat for women in mental health and wellness who want room to rest, enjoy themselves, and connect beyond the provider role.',
       public_image    = '/images/retreat-villa-aerial.webp',
       updated_at      = now()
 WHERE slug = 'bali-2027'
   AND listed_publicly = false
   AND public_path IS NULL
   AND public_summary = '';

-- 2. The announcement-list tag ---------------------------------------------------
INSERT INTO tags (name, slug, description)
VALUES ('Retreat Announcements', 'retreat-announcements',
        'Signed up at /retreat-interest for emails announcing new FlourisHealer retreats. Nothing is sent automatically.')
ON CONFLICT (slug) DO NOTHING;

-- 3. Retreat Deposit email: item 5 -------------------------------------------------
UPDATE sequence_emails e
   SET body_md = replace(
                   replace(e.body_md,
                     'You can make payments at any time through your Kajabi account.',
                     'Please manage your payments through the account where you originally began your payment plan. If your payment access changes, we’ll email you updated instructions and a secure link to pay your remaining balance.'),
                   '&lt;o:p&gt; &lt;/o:p&gt;', ''),
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.name = 'Retreat Deposit'
   AND position('You can make payments at any time through your Kajabi account.' IN e.body_md) > 0;

-- 4. Private-room purchase next steps: items 4 and 7 -------------------------------
UPDATE offers
   SET welcome_next_steps = replace(welcome_next_steps,
         'Airport transportation is provided during June 15–20 through designated group transfers. Exact pickup windows will be coordinated with guests.',
         'Airport transportation is provided through designated group transfers during these dates. Final shuttle windows will be coordinated with guests and shared before travel.'),
       updated_at = now()
 WHERE slug = 'bali-private-room'
   AND position('Airport transportation is provided during June 15–20 through designated group transfers. Exact pickup windows will be coordinated with guests.' IN welcome_next_steps) > 0;

UPDATE offers
   SET welcome_next_steps = replace(
                              replace(welcome_next_steps, '2. Get Travel Insurance', '2. Consider Travel Insurance'),
                              'Because all payments are non-refundable, travel insurance is your primary financial protection.',
                              'Travel insurance is strongly recommended, not required. Because all payments are non-refundable, travel insurance is your primary financial protection.'),
       updated_at = now()
 WHERE slug = 'bali-private-room'
   AND position('2. Get Travel Insurance' IN welcome_next_steps) > 0
   AND position('strongly recommended, not required' IN welcome_next_steps) = 0;

-- 5. Bali Love Notes 6–8 (drafts only) ---------------------------------------------
UPDATE email_campaigns
   SET body_md = replace(
                   replace(body_md,
                     'Our luxury shuttle picks you up.',
                     'Airport transportation is provided through designated group transfers during June 15–20, 2027. Final shuttle windows will be coordinated with guests and shared before travel.'),
                   'so I can coordinate your airport pickup:',
                   'so we can coordinate your designated group transfer:'),
       updated_at = now()
 WHERE name = 'Bali Love Note 6 — January (5 months)'
   AND status = 'draft'
   AND position('Our luxury shuttle picks you up.' IN body_md) > 0;

UPDATE email_campaigns
   SET body_md = replace(body_md,
                   'so your airport pickup is arranged:',
                   'so your designated group transfer can be coordinated:'),
       updated_at = now()
 WHERE name = 'Bali Love Note 7 — February (4 months)'
   AND status = 'draft'
   AND position('so your airport pickup is arranged:' IN body_md) > 0;

UPDATE email_campaigns
   SET body_md = replace(body_md,
                   'Airport pickups are being scheduled:',
                   'Designated group transfers are being coordinated:'),
       updated_at = now()
 WHERE name = 'Bali Love Note 8 — April (2 months)'
   AND status = 'draft'
   AND position('Airport pickups are being scheduled:' IN body_md) > 0;
