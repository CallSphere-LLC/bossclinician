-- The remainder of the 4 Sep brief: community access groups, channel view
-- modes, an editable gamification rule engine, and the email campaign depth
-- from section 3.

/* =========================================================== access groups */

-- The scoping layer the brief calls missing. A community with no groups behaves
-- exactly as it does today: `access_group_id IS NULL` on a channel means "the
-- whole community", so this is additive rather than a migration of behaviour.
CREATE TABLE IF NOT EXISTS community_access_groups (
  id           serial PRIMARY KEY,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_access_groups_name_check CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT community_access_groups_unique UNIQUE (community_id, name)
);

CREATE TABLE IF NOT EXISTS community_access_group_members (
  group_id  integer NOT NULL REFERENCES community_access_groups(id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Only ever 'manual'. Purchase-based tier membership is DERIVED from a live
  -- grant rather than written here, for the same reason the room itself is:
  -- a row nobody deletes is a door that never closes, and a refunded member
  -- would keep the tier. The column stays for the audit trail and in case a
  -- future import needs to distinguish.
  source    text NOT NULL DEFAULT 'manual',
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_id),
  CONSTRAINT community_access_group_members_source_check
    CHECK (source IN ('manual', 'purchase'))
);

CREATE INDEX IF NOT EXISTS idx_access_group_members_member
  ON community_access_group_members (member_id);

-- A community product may name a group, so buying it puts the member in that
-- tier rather than only in the room.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS access_group_id integer
    REFERENCES community_access_groups(id) ON DELETE SET NULL;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS access_group_id integer
    REFERENCES community_access_groups(id) ON DELETE SET NULL;

/* ======================================================= channels, deepened */

ALTER TABLE community_channels
  ADD COLUMN IF NOT EXISTS access_group_id integer
    REFERENCES community_access_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cover_image text NOT NULL DEFAULT '',
  -- Kajabi's "Available View Modes" (multi-select, at least one) and
  -- "Default View Mode". Stored as an array because the set is the setting.
  ADD COLUMN IF NOT EXISTS view_modes text[] NOT NULL DEFAULT ARRAY['feed']::text[],
  ADD COLUMN IF NOT EXISTS default_view_mode text NOT NULL DEFAULT 'feed';

-- The default has to be one of the modes actually offered, or a member opens a
-- channel into a layout its owner switched off.
ALTER TABLE community_channels
  DROP CONSTRAINT IF EXISTS community_channels_view_modes_check;
ALTER TABLE community_channels
  ADD CONSTRAINT community_channels_view_modes_check
  CHECK (
    array_length(view_modes, 1) >= 1
    AND view_modes <@ ARRAY['feed', 'forum', 'gallery']::text[]
    AND default_view_mode = ANY (view_modes)
  );

/* =================================================== gamification, editable */

-- One row per rule per community, so the points and the cap are Yvette's to
-- set. Seeded below with Kajabi's own numbers.
CREATE TABLE IF NOT EXISTS community_point_rules (
  id             serial PRIMARY KEY,
  community_id   integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  action         text NOT NULL,
  points         integer NOT NULL DEFAULT 0,
  -- Kajabi's MAXIMUM column: how many times this rule may pay out per period.
  -- NULL means uncapped.
  max_per_period integer,
  period         text NOT NULL DEFAULT 'day',
  CONSTRAINT community_point_rules_unique UNIQUE (community_id, action),
  CONSTRAINT community_point_rules_points_check CHECK (points BETWEEN 0 AND 10000),
  CONSTRAINT community_point_rules_period_check CHECK (period IN ('day', 'week', 'month', 'all')),
  CONSTRAINT community_point_rules_max_check CHECK (max_per_period IS NULL OR max_per_period > 0)
);

-- The ledger. Caps used to be counted with a bespoke query per action, which
-- meant a new rule needed new SQL and a cap could only ever be daily. Counting
-- payouts instead makes both generic, and gives the weekly and monthly
-- leaderboards something to sum that is not the running total on a membership.
CREATE TABLE IF NOT EXISTS community_point_events (
  id           bigserial PRIMARY KEY,
  community_id integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id    integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  action       text NOT NULL,
  points       integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_events_cap
  ON community_point_events (community_id, member_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_events_leaderboard
  ON community_point_events (community_id, created_at DESC);

-- Which leaderboards members may see, each independently, per 2.7.
ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS leaderboard_weekly boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS leaderboard_monthly boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS leaderboard_all_time boolean NOT NULL DEFAULT true,
  -- "Earned a title" pays points in Kajabi's table; badges already exist here,
  -- so this is the number they pay rather than a second concept.
  ADD COLUMN IF NOT EXISTS points_per_title integer NOT NULL DEFAULT 0;

-- Kajabi's shipped rule set, for every community that exists. ON CONFLICT so a
-- re-run is harmless and so hand-edited numbers are never stamped back.
INSERT INTO community_point_rules (community_id, action, points, max_per_period, period)
SELECT c.id, r.action, r.points, r.max_per_period, r.period
  FROM communities c
 CROSS JOIN (VALUES
   ('challenge_completed', 100, NULL::integer, 'day'),
   ('challenge_comment',     3, NULL::integer, 'day'),
   ('challenge_reaction',    1, NULL::integer, 'day'),
   ('challenge_reaction_received', 1, NULL::integer, 'day'),
   ('post',                  1, 5,             'day'),
   ('post_reaction',         1, 5,             'day'),
   ('poll_response',         1, NULL::integer, 'day'),
   ('comment',               2, 10,            'day'),
   ('event_rsvp',           25, NULL::integer, 'day')
 ) AS r(action, points, max_per_period, period)
ON CONFLICT (community_id, action) DO NOTHING;

/* ============================================================ email: section 3 */

-- 3.1 folders, which campaigns already had and sequences did not.
ALTER TABLE email_sequences
  ADD COLUMN IF NOT EXISTS folder text NOT NULL DEFAULT '';

-- 3.2 a saved template library. Separate from `email_templates`, which is the
-- system store keyed by purpose (purchase_receipt, trial_ending …) and must not
-- gain rows a person can rename or delete.
CREATE TABLE IF NOT EXISTS email_saved_templates (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  subject    text NOT NULL DEFAULT '',
  body_md    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_saved_templates_name_check CHECK (length(name) BETWEEN 1 AND 160)
);

-- 3.3 event-relative scheduling. The brief's highest-value item: campaigns
-- scheduled as "24 hours before <event>" rather than at a wall-clock time,
-- which is also what event reminder emails should have been driven by.
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS anchor_kind text NOT NULL DEFAULT 'absolute',
  ADD COLUMN IF NOT EXISTS anchor_event_id integer REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anchor_offset_minutes integer NOT NULL DEFAULT 0,
  -- 3.4 which subject won, and when it was decided.
  ADD COLUMN IF NOT EXISTS ab_winner text,
  ADD COLUMN IF NOT EXISTS ab_decided_at timestamptz;

ALTER TABLE email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_anchor_kind_check;
ALTER TABLE email_campaigns
  ADD CONSTRAINT email_campaigns_anchor_kind_check
  CHECK (anchor_kind IN ('absolute', 'event_start', 'event_registration'));

ALTER TABLE email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_ab_winner_check;
ALTER TABLE email_campaigns
  ADD CONSTRAINT email_campaigns_ab_winner_check
  CHECK (ab_winner IS NULL OR ab_winner IN ('a', 'b'));

-- An event-anchored campaign has to name its event, or it can never resolve a
-- send time. Enforced here rather than only in the route, because a row that
-- cannot be scheduled is a row the sweeper would pick up forever.
ALTER TABLE email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_anchor_event_check;
ALTER TABLE email_campaigns
  ADD CONSTRAINT email_campaigns_anchor_event_check
  CHECK (anchor_kind = 'absolute' OR anchor_event_id IS NOT NULL);

-- 3.7 sequence excludes, made specific. The single global "stop the moment they
-- buy something" stays as `exit_on_purchase`; these narrow it to named offers
-- and named forms.
CREATE TABLE IF NOT EXISTS sequence_exclude_offers (
  sequence_id integer NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  offer_id    integer NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  PRIMARY KEY (sequence_id, offer_id)
);

CREATE TABLE IF NOT EXISTS sequence_exclude_forms (
  sequence_id integer NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  form_id     integer NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  PRIMARY KEY (sequence_id, form_id)
);
