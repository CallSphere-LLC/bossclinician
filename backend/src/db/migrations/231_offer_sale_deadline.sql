-- =============================================================================
-- 231: sale deadline and countdown for an offer (QA sheet row 250).
--
-- Owner request: "a countdown option for emails and website pages. If I am
-- selling something and want a countdown timer, show it in the emails and on
-- the website so that once the timer is over, the customer can no longer
-- purchase and it sends them to the original priced page."
--
-- Until now only a pricing option could close (sales_start_at / sales_end_at,
-- migration 139). The offer itself had no deadline and nowhere to send a
-- visitor once it had passed. Four columns on offers:
--
--   sales_end_at          when the offer stops taking NEW orders. NULL: never.
--                         An order started before it can still finish paying.
--   after_close_offer_id  the "original price" offer a visitor is sent to once
--                         this one has ended. Never the offer itself.
--   after_close_path      or a same-site path ("/store") used when no fallback
--                         offer is set, or the fallback is not on sale either.
--   show_countdown        show the timer on the checkout and the sales page.
--
-- offers.redirect_url is the AFTER-PURCHASE redirect and is not touched.
-- Pricing-option windows keep working unchanged. Read by
-- services/offerDeadline.ts. Idempotent.
-- =============================================================================

ALTER TABLE offers ADD COLUMN IF NOT EXISTS sales_end_at timestamptz;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS after_close_offer_id int REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS after_close_path text NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN IF NOT EXISTS show_countdown boolean NOT NULL DEFAULT true;

DO $m231$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offers_after_close_not_self') THEN
    ALTER TABLE offers ADD CONSTRAINT offers_after_close_not_self
      CHECK (after_close_offer_id IS NULL OR after_close_offer_id <> id);
  END IF;
  -- A same-site path only: "/store", never "//host", "/\host" or a full URL.
  -- The countdown link in an email redirects here, so it must not be able to
  -- leave the site.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offers_after_close_path_safe') THEN
    ALTER TABLE offers ADD CONSTRAINT offers_after_close_path_safe
      CHECK (after_close_path = '' OR after_close_path ~ '^/([^/\\]|$)');
  END IF;
END
$m231$;

-- The recovery sweep and the countdown routes look up offers that have a deadline.
CREATE INDEX IF NOT EXISTS offers_sales_end_at_idx ON offers (sales_end_at) WHERE sales_end_at IS NOT NULL;
