-- Lane G: conditional questions and file-upload answers on public forms.
--
-- Conditional logic needs no schema: a question's `showIf` rule lives inside the
-- form's own `fields` jsonb, next to the rest of the question.
--
-- A file somebody sends through a form is stored in the protected upload root
-- and gets a row in the media library, so it is reachable only through a signed
-- admin link. These columns say whose file it is and which reply brought it in,
-- so it can be opened from the contact and from the form's replies.
--
-- ON DELETE SET NULL on both: deleting a reply or a contact must not silently
-- delete a document somebody sent. The library still lists it, and it can be
-- deleted from there on purpose.

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS contact_id INT
  REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS form_submission_id INT
  REFERENCES form_submissions(id) ON DELETE SET NULL;

-- The question the file answered. Text rather than a reference: questions live
-- in jsonb and have no rows of their own.
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS form_field_key TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_media_assets_contact
  ON media_assets (contact_id, created_at DESC) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_form_submission
  ON media_assets (form_submission_id) WHERE form_submission_id IS NOT NULL;
