-- =============================================================================
-- Coaching matches Kajabi: the real programs, the real clients, no dev fixture.
--
-- QA (sheet "Boss clinician", Bugs R33–R35) compared the admin Coaching page
-- with Kajabi's and found (R33) none of Kajabi's coaching programs, only a
-- "90-day practice accelerator" whose description was "Test description." and
-- whose booking link was a developer's personal Calendly, and (R35) a Clients
-- tab with nobody from Kajabi in it. The roster read only access grants on
-- coaching products (none exist) and booked sessions (one, a developer's test).
--
-- 1. Two columns on coaching_offers.
--    archived_at    — a program taken out of the admin lists without deleting
--                     it (the admin list endpoint hides these; ?archived=1
--                     shows them).
--    kajabi_product — the Kajabi product this program was on Kajabi, as the
--                     contacts export names it. It is what the Kajabi clients
--                     below were matched on, shown on the program card.
--
-- 2. coaching_enrollments: who is in a program without having bought it here.
--    A row is NOT an entitlement. It grants nothing (no access_grants row, no
--    coaching_credits, no booking rights) and nothing reads it but the Clients
--    roster (services/coachingRoster.ts). Moving a Kajabi client's access over
--    is a separate decision, still open (see memory note on the Kajabi import).
--
-- 3. The programs, from sources we can quote:
--    - Boss Clinician Club and Boss Clinician Boardroom: the owner's own names
--      and descriptions (sheet tab "Updates & Discussion", verbatim). Club's 12
--      live coaching calls and $1,997 paid-in-full price are from the Club
--      sales page as transcribed from bossclinician.com/club
--      (frontend/src/content/club.ts). The Boardroom's session count and price
--      are left unset on purpose: Kajabi's work-with-me page says 24 sessions
--      and $12,000, the owner's own Boardroom page says an $18,000 mastermind,
--      and choosing between them is hers.
--    - Practice Reset Intensive and Scale and Reclaim Suite: Kajabi's store
--      lists them under "BOSS CLINICIAN CONSULTING SERVICES" with the Boss
--      Boardroom, and bossclinician.com/work-with-me (fetched 2026-09-29) gives
--      their length, sessions (6 and 12, 50 minutes each), prices and taglines,
--      quoted here. They are drafts (unpublished) because the one-to-one work
--      is no longer offered on this site (frontend/src/content/site.ts), but
--      they keep their clients.
--    Session length is the column default (60) wherever no source gives one;
--    the admin shows it as unknown when the session count is unset.
--    Inserted ON CONFLICT (slug) DO NOTHING, so her edits are never undone.
--
-- 4. The Kajabi clients. The contacts import tagged each person with
--    "Bought: <Kajabi product>" from the export's Products column, which lists
--    the products a person held when the export was taken. Everyone holding a
--    program's Kajabi product is enrolled in it (status active, source kajabi).
--    Practice Reset Intensive: 25 people. The Boss Move (the Club's curriculum,
--    "finishing the Boss Move" in the Club FAQ; every holder came through the
--    "Boss Clinician Club Program" or "[PIF] PPP Boss Builders $3997" offer):
--    5 people. The Kajabi test accounts in those lists are kept, because
--    Kajabi's list shows them too. The joined date is the earliest Kajabi
--    purchase of an offer that sells the program (the `purchases` rows from
--    076); left empty where there is none. Nothing here sends mail, fires an
--    event or touches Stripe: it is plain SQL.
--
-- 5. The dev fixture. The "90-day practice accelerator" is archived and
--    unpublished (not deleted), and its one booked session — a developer's
--    test booking on his own account ("Agenda: pricing review.", no files) —
--    is deleted, because a cancelled session would still list him as a client.
--    Both are in backups/sheet-parity-20260929/coaching-before.sql.
--
-- Every statement is guarded so the file is a no-op on a fresh database.
-- =============================================================================

ALTER TABLE coaching_offers
  ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS kajabi_product text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS coaching_enrollments (
  id                SERIAL PRIMARY KEY,
  coaching_offer_id INTEGER NOT NULL REFERENCES coaching_offers(id) ON DELETE CASCADE,
  contact_id        INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  member_id         INTEGER REFERENCES members(id) ON DELETE SET NULL,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('kajabi', 'manual')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  enrolled_at       TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coaching_offer_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_coaching_enrollments_contact ON coaching_enrollments (contact_id);

-- --- 3. The programs ---------------------------------------------------------
INSERT INTO coaching_offers
  (slug, title, description, session_count, duration_minutes, price_cents, format, published, sort, kajabi_product)
VALUES
  ('boss-clinician-club',
   'Boss Clinician Club — 6-Month Coaching Program',
   $d$A structured 6-month program designed to help practice owners strengthen operations, leadership, growth, and profitability with ongoing coaching and accountability.$d$,
   12, 60, 199700, 'group', true, 1, 'The Boss Move'),
  ('boss-clinician-boardroom',
   'Boss Clinician Boardroom — Mastermind',
   $d$An advanced mastermind for established practice owners who want higher-level strategy, peer collaboration, accountability, and support with scaling their business.$d$,
   0, 60, 0, 'group', true, 2, 'The Boss Boardroom'),
  ('practice-reset-intensive',
   'Practice Reset Intensive',
   $d$3 months. Get clear, get structured, and start growing with intention. For clinicians ready to stop guessing and build smart from the start.$d$,
   6, 50, 350000, 'individual', false, 3, 'Practice Reset Intensive'),
  ('scale-and-reclaim-suite',
   'Scale and Reclaim Suite',
   $d$6 months. Full strategy plus implementation — build consistency, stop the income roller coaster, and grow without burning out. For the clinician ready to work less, earn more, and lead with confidence.$d$,
   12, 50, 650000, 'individual', false, 4, 'Scale and Reclaim Suite')
ON CONFLICT (slug) DO NOTHING;

-- --- 4. The Kajabi clients ---------------------------------------------------
WITH program_offers (slug, offer_title) AS (
  VALUES
    ('practice-reset-intensive', 'Boss Clinician Elite - zap'),
    ('practice-reset-intensive', '90 Day 1:1 Coaching Support'),
    ('practice-reset-intensive', '90 Day 1:1 Consulting Support - One Time Payment'),
    ('practice-reset-intensive', '90 day 1:1 Coaching Support - 3 x Payments'),
    ('boss-clinician-club',      'Boss Clinician Club Program'),
    ('boss-clinician-club',      '[PIF] PPP Boss Builders $3997')
),
holders AS (
  SELECT o.id AS offer_id, o.slug, ct.contact_id
    FROM coaching_offers o
    JOIN tags t          ON t.name = 'Bought: ' || o.kajabi_product
    JOIN contact_tags ct ON ct.tag_id = t.id
   WHERE o.kajabi_product <> ''
     AND o.slug IN ('practice-reset-intensive', 'boss-clinician-club', 'scale-and-reclaim-suite', 'boss-clinician-boardroom')
)
INSERT INTO coaching_enrollments (coaching_offer_id, contact_id, member_id, source, status, enrolled_at)
SELECT h.offer_id,
       h.contact_id,
       (SELECT m.id FROM members m
         WHERE m.contact_id = h.contact_id AND m.status <> 'deleted'
         ORDER BY m.id LIMIT 1),
       'kajabi',
       'active',
       (SELECT MIN(p.purchased_at) FROM purchases p
          JOIN program_offers po ON po.offer_title = p.offer_title AND po.slug = h.slug
         WHERE p.contact_id = h.contact_id AND p.source = 'kajabi')
  FROM holders h
ON CONFLICT (coaching_offer_id, contact_id) DO NOTHING;

-- --- 5. The dev fixture ------------------------------------------------------
DELETE FROM coaching_sessions s
 USING coaching_offers o
 WHERE s.offer_id = o.id
   AND o.slug = '90-day-practice-accelerator'
   AND o.description = 'Test description.'
   AND s.agenda = 'Agenda: pricing review.'
   AND NOT EXISTS (SELECT 1 FROM coaching_session_files f WHERE f.session_id = s.id);

UPDATE coaching_offers
   SET archived_at = COALESCE(archived_at, now()),
       published   = false,
       updated_at  = now()
 WHERE slug = '90-day-practice-accelerator'
   AND description = 'Test description.';
