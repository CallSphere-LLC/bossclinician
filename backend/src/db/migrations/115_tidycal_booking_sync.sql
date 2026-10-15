-- Only bookings made after TidyCal is configured carry an external ID.
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS tidycal_booking_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS coaching_sessions_tidycal_booking_id_unique ON coaching_sessions(tidycal_booking_id) WHERE tidycal_booking_id IS NOT NULL;
