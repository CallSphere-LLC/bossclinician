
ALTER TABLE offers ADD COLUMN IF NOT EXISTS show_in_cart boolean NOT NULL DEFAULT true;
-- Owner request: remove these cards from /cart without deleting offers or purchases.
UPDATE offers SET show_in_cart=false,updated_at=now()
WHERE slug IN ('bali-shared-room','practice-reset-intensive','scale-and-reclaim-suite','the-boss-boardroom');
