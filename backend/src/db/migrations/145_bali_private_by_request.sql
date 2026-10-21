-- Owner: shared $4,500 remains public with pay-in-full and deadline plan.
-- Keep the $5,500 private offer for individual requests; preserve purchases.
UPDATE offers SET show_in_cart=false,updated_at=now() WHERE slug='bali-private-room';
