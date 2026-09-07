-- Broadcast kinds — Final Email Structure.
--
-- A newsletter is a *type of Broadcast*, not a separate email system. The
-- approved structure collapses the two: one table, one editor, one send path,
-- with the kind deciding what the editor suggests rather than which system the
-- email lives in.
--
-- 'general' is the default because every campaign that already exists was
-- written before kinds did, and calling those "newsletters" would be a claim
-- about their content that nothing in the row supports.

ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_campaigns_kind_check'
  ) THEN
    ALTER TABLE email_campaigns
      ADD CONSTRAINT email_campaigns_kind_check
      CHECK (kind IN ('newsletter','promotion','event_invitation','announcement','program_update','general'));
  END IF;
END $$;

-- The broadcast list filters and groups by kind.
CREATE INDEX IF NOT EXISTS idx_email_campaigns_kind ON email_campaigns (kind, created_at DESC);
