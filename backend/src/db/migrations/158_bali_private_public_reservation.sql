-- The public retreat page now reserves the $5,500 private suite.
-- Keep the shared offer addressable for existing buyers, but remove it from
-- the cart catalogue. The private offer is already published and priced.
UPDATE offers
SET show_in_cart = CASE slug WHEN 'bali-private-room' THEN true ELSE false END,
    updated_at = now()
WHERE slug IN ('bali-private-room', 'bali-shared-room')
  AND show_in_cart IS DISTINCT FROM CASE slug WHEN 'bali-private-room' THEN true ELSE false END;
