-- A funnel blueprint creates a connected journey, not just a category label.
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS form_id INT REFERENCES forms(id) ON DELETE SET NULL;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS tag_id INT REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS sequence_id INT REFERENCES email_sequences(id) ON DELETE SET NULL;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS offer_id INT REFERENCES offers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_funnels_offer ON funnels (offer_id) WHERE offer_id IS NOT NULL;
