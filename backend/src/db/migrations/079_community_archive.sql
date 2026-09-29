-- 079: archived communities.
--
-- Kajabi keeps a retired product (e.g. "Boss Clinician Boss Builders Community",
-- archived there with 4 holders) out of the product list without deleting who
-- held it. `published = false` alone reads as "Draft" in the admin, which says
-- "not launched yet" about something that has been retired. An archived
-- community is also unpublished, so every member-side query (all gated on
-- `c.published`) already keeps it out of reach; this column only tells the
-- admin to file it under "Archived" instead of among the live spaces.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS archived_at timestamptz;
