-- Campaign audience rules beyond one legacy preset or one saved segment.
-- Arrays are intentional: inclusion tags use OR semantics, and exclusions are
-- applied after the base audience so the preview count and send resolve alike.
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS include_tag_ids INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exclude_segment_ids INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exclude_tag_ids INT[] NOT NULL DEFAULT '{}';
