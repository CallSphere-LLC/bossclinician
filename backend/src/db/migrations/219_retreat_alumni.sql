-- =============================================================================
-- 219 — FlourisHealer retreat alumni pieces (sheet row 248, item 11), the records
-- the post-retreat alumni emails (sheet row 249) read and link to:
--
--   retreat_feedback    private post-retreat reflection + a SEPARATE optional
--                       public-testimonial consent. Never auto-published:
--                       approved_for_publication_at is set only by the owner,
--                       and only when the guest chose a consent other than 'no'.
--   retreat_interest    International / Domestic Business / Both / Not at this
--                       time, optional destinations and an optional marketing
--                       opt-in. Admin-visible only. marketing_opt_in does NOT
--                       change contacts.email_marketing_status.
--   retreat_offer_cards the owner-configured "Join Us Again" cards (hidden by
--                       default; Draft / Interest List / Registration Open /
--                       Sold Out). No card is seeded: nothing is invented.
--
-- Column names other work queries (agent F):
--   retreat_feedback (retreat_id, contact_id, submitted_at)   submitted_at NULL = draft only
--   retreat_interest (retreat_id, contact_id, interest, marketing_opt_in, updated_at)
-- contact_id is copied from members.contact_id when the guest saves.
--
-- Idempotent; creates tables only, no rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retreat_feedback (
  id                          SERIAL PRIMARY KEY,
  retreat_id                  INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id                   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  contact_id                  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  answers                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  testimonial_text            TEXT NOT NULL DEFAULT '',
  testimonial_consent         TEXT NOT NULL DEFAULT 'no'
                                CHECK (testimonial_consent IN ('no','first_name','first_name_role','full_name')),
  testimonial_role            TEXT NOT NULL DEFAULT '',
  testimonial_consent_at      TIMESTAMPTZ,
  approved_for_publication_at TIMESTAMPTZ,
  approved_by                 INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at                TIMESTAMPTZ,
  UNIQUE (retreat_id, member_id),
  CONSTRAINT retreat_feedback_publication_needs_consent
    CHECK (approved_for_publication_at IS NULL OR testimonial_consent <> 'no')
);
CREATE INDEX IF NOT EXISTS retreat_feedback_contact_idx ON retreat_feedback (retreat_id, contact_id);

CREATE TABLE IF NOT EXISTS retreat_interest (
  retreat_id       INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  contact_id       INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  interest         TEXT NOT NULL CHECK (interest IN ('international','domestic_business','both','not_now')),
  destinations     TEXT NOT NULL DEFAULT '',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  marketing_opt_in_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (retreat_id, member_id)
);
CREATE INDEX IF NOT EXISTS retreat_interest_contact_idx ON retreat_interest (retreat_id, contact_id);

CREATE TABLE IF NOT EXISTS retreat_offer_cards (
  id                 SERIAL PRIMARY KEY,
  retreat_id         INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'international' CHECK (kind IN ('international','domestic_business')),
  destination        TEXT NOT NULL DEFAULT '',
  dates_text         TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  image_url          TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','interest_list','registration_open','sold_out')),
  cta_label          TEXT NOT NULL DEFAULT '',
  cta_url            TEXT NOT NULL DEFAULT '',
  -- A guest holding an active grant on this product sees "You're booked" instead of a CTA.
  booked_product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  visible            BOOLEAN NOT NULL DEFAULT false,
  display_from       TIMESTAMPTZ,
  display_until      TIMESTAMPTZ,
  sort               INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retreat_offer_cards_open_needs_url CHECK (status <> 'registration_open' OR cta_url <> '')
);
