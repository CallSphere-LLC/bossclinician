ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_cart boolean NOT NULL DEFAULT false;
-- Per-offer totals allow recovered revenue to allocate only the purchased item,
-- never multiply a multi-item payment by the number of abandoned offer rows.
CREATE TABLE IF NOT EXISTS order_offer_totals (
 order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 offer_id integer NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
 subtotal_cents integer NOT NULL, discount_cents integer NOT NULL,
 tax_cents integer NOT NULL, total_cents integer NOT NULL,
 PRIMARY KEY(order_id,offer_id)
);
