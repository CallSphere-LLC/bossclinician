-- =============================================================================
-- Phase 4 — Unified contacts, tags & segments
--
-- The platform has three disconnected silos: `leads`, `subscribers`, `members`.
-- Kajabi has ONE contact object with 393 rows carrying tags, lifetime value and
-- last activity, and the entire automation system keys off it. Someone who
-- opted in as a lead, joined the newsletter, and later bought a course is one
-- person and currently appears as three.
--
-- The silos are NOT dropped. `members` in particular is referenced by 20-odd
-- foreign keys — sessions, grants, orders, community, coaching — and rewriting
-- all of them is a migration with no safe rollback. Instead `contacts` becomes
-- the identity every silo points AT, so the three keep working while everything
-- new reads one row per person.
-- =============================================================================

CREATE TABLE contacts (
  id            SERIAL PRIMARY KEY,
  email         CITEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',

  -- Kajabi's own vocabulary, because the reports and the sending rules are
  -- written in it. `bounced` and `complained` are set by the provider webhook
  -- and are the reason a suppression list is not a separate table.
  email_marketing_status TEXT NOT NULL DEFAULT 'subscribed'
    CHECK (email_marketing_status IN ('subscribed','opted_out','bounced','complained','unconfirmed')),
  opted_in_at   TIMESTAMPTZ,
  opted_out_at  TIMESTAMPTZ,
  -- CAN-SPAM/GDPR: what they agreed to and where, not just that they did.
  consent_source TEXT NOT NULL DEFAULT '',
  consent_ip     TEXT NOT NULL DEFAULT '',

  -- Denormalised because every contact list sorts and filters on them, and
  -- recomputing a lifetime total across orders per row makes the list unusable
  -- at a few thousand contacts. Maintained by the rollup job.
  lifetime_value_cents INT NOT NULL DEFAULT 0,
  order_count          INT NOT NULL DEFAULT 0,
  last_activity_at     TIMESTAMPTZ,
  last_ordered_at      TIMESTAMPTZ,

  source        TEXT NOT NULL DEFAULT '',
  custom_fields JSONB NOT NULL DEFAULT '{}',
  notes         TEXT NOT NULL DEFAULT '',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_activity ON contacts (last_activity_at DESC NULLS LAST);
CREATE INDEX idx_contacts_value    ON contacts (lifetime_value_cents DESC);
CREATE INDEX idx_contacts_status   ON contacts (email_marketing_status);
-- Trigram-free name search: the list's search box is a prefix match on either
-- name or email, and a plain lower() index serves that without an extension.
CREATE INDEX idx_contacts_name     ON contacts (lower(name));

-- --- the silos point at the contact -----------------------------------------

ALTER TABLE leads       ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE members     ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact       ON leads (contact_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_contact ON subscribers (contact_id);
CREATE INDEX IF NOT EXISTS idx_members_contact     ON members (contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact      ON orders (contact_id);

-- --- tags -------------------------------------------------------------------

CREATE TABLE tags (
  id          SERIAL PRIMARY KEY,
  -- The display name. `slug` is what automations match on, so renaming a tag in
  -- the admin does not silently detach every rule that referenced it.
  name        TEXT NOT NULL,
  slug        CITEXT UNIQUE NOT NULL,
  colour      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Denormalised for the tag list; maintained by the rollup job.
  contact_count INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_tags (
  contact_id INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  -- Which automation or import applied it, so a tag storm can be traced back.
  applied_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX idx_contact_tags_tag ON contact_tags (tag_id);

-- The tags the live Kajabi account actually drives its quiz funnel off.
INSERT INTO tags (name, slug, description) VALUES
  ('Quiz — Visionary Builder',  'quiz-visionary',       'Offer quiz result'),
  ('Quiz — Steady Grower',      'quiz-steady',          'Offer quiz result'),
  ('Quiz — Careful Clinician',  'quiz-careful',         'Offer quiz result'),
  ('Quiz — Reluctant CEO',      'quiz-reluctant',       'Offer quiz result'),
  ('Retreat Waitlist 2027',     'retreat-waitlist-2027', ''),
  ('Bali 2027 Attendee',        'bali-2027-attendee',    '')
ON CONFLICT (slug) DO NOTHING;

-- --- segments ---------------------------------------------------------------

/**
 * A saved filter, stored as structured rules rather than SQL.
 *
 * Storing SQL would make a segment an injection vector reachable from an admin
 * screen, and would tie every saved segment to today's schema. The rules are
 * interpreted into a parameterised query at read time — see services/segments.ts.
 */
CREATE TABLE segments (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        CITEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- {match: 'all'|'any', rules: [{field, op, value}]}
  definition  JSONB NOT NULL DEFAULT '{"match":"all","rules":[]}',
  -- Denormalised count, refreshed by the rollup job; segments are used as email
  -- audiences and counting live on every page view of the list is expensive.
  contact_count INT NOT NULL DEFAULT 0,
  counted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- activity timeline ------------------------------------------------------

/**
 * Everything a contact has done, in one stream.
 *
 * Append-only and deliberately denormalised: a timeline entry keeps its own
 * title and body so a purchase from 2026 still reads correctly after the offer
 * is renamed or deleted. `subject_type`/`subject_id` are a soft reference for
 * linking, never a join that must resolve.
 */
CREATE TABLE contact_activity (
  id           BIGSERIAL PRIMARY KEY,
  contact_id   INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  subject_type TEXT NOT NULL DEFAULT '',
  subject_id   TEXT NOT NULL DEFAULT '',
  meta         JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_activity ON contact_activity (contact_id, occurred_at DESC);
CREATE INDEX idx_contact_activity_kind ON contact_activity (kind, occurred_at DESC);

-- --- backfill ---------------------------------------------------------------

-- One contact per distinct address across all three silos. `ON CONFLICT` makes
-- the order of these three statements irrelevant, and the later ones fill in
-- fields the earlier ones did not have.
INSERT INTO contacts (email, name, phone, source, created_at)
SELECT lower(l.email), max(l.name), max(COALESCE(l.phone, '')), 'lead', min(l.created_at)
  FROM leads l WHERE l.email <> ''
 GROUP BY lower(l.email)
ON CONFLICT (email) DO NOTHING;

INSERT INTO contacts (email, source, created_at)
SELECT lower(s.email), 'subscriber', min(s.created_at)
  FROM subscribers s WHERE s.email <> ''
 GROUP BY lower(s.email)
ON CONFLICT (email) DO NOTHING;

INSERT INTO contacts (email, name, first_name, last_name, timezone, source, created_at)
SELECT lower(m.email::text), max(m.name), max(m.first_name), max(m.last_name),
       max(m.timezone), 'member', min(m.created_at)
  FROM members m WHERE m.email::text <> ''
 GROUP BY lower(m.email::text)
ON CONFLICT (email) DO UPDATE
  SET name       = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
      first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), contacts.first_name),
      last_name  = COALESCE(NULLIF(EXCLUDED.last_name, ''), contacts.last_name),
      source     = 'member';

-- Compared AS citext, not by casting the contact's address down to text.
-- `lower(l.email) = c.email::text` is a text-to-text comparison and therefore
-- case-sensitive: it happens to match today only because the inserts above
-- lowercase everything, so the first writer to store a mixed-case address in
-- `contacts` would silently stop linking. Letting citext decide makes the join
-- mean what it says.
UPDATE leads       l SET contact_id = c.id FROM contacts c WHERE l.email::citext = c.email AND l.contact_id IS NULL;
UPDATE subscribers s SET contact_id = c.id FROM contacts c WHERE s.email::citext = c.email AND s.contact_id IS NULL;
UPDATE members     m SET contact_id = c.id FROM contacts c WHERE m.email        = c.email AND m.contact_id IS NULL;
UPDATE orders      o SET contact_id = c.id FROM contacts c WHERE o.email::citext = c.email AND o.contact_id IS NULL;

-- The rollup that maintains lifetime_value_cents, order_count and the cached
-- tag/segment counts. Without a schedule those figures sit at zero forever;
-- migration 011 seeded the platform's other twelve schedules before this table
-- existed, so it belongs here rather than there.
INSERT INTO job_schedules (name, kind, every_minutes, timezone)
VALUES ('contact-rollup', 'contacts.rollup', 60, 'America/New_York')
ON CONFLICT (name) DO NOTHING;
