-- A coaching client can exist in the CRM without having a password/account.
ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS contact_id INT REFERENCES contacts(id) ON DELETE SET NULL;

-- A CRM deletion must not erase the historical coaching record. The contact
-- link is nullable for the same reason, so make the older member link match.
ALTER TABLE coaching_sessions
  DROP CONSTRAINT IF EXISTS coaching_sessions_member_id_fkey;

ALTER TABLE coaching_sessions
  ADD CONSTRAINT coaching_sessions_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

UPDATE coaching_sessions s
   SET contact_id = m.contact_id
  FROM members m
 WHERE s.member_id = m.id
   AND s.contact_id IS NULL
   AND m.contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coaching_sessions_contact
  ON coaching_sessions (contact_id, scheduled_at DESC);
