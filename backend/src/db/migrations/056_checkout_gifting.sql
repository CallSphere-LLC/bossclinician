ALTER TABLE offers ADD COLUMN IF NOT EXISTS allow_gifting boolean NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_recipient_email text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_member_id integer REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_created_member boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_delivered_at timestamptz;
