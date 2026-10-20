-- QA Bugs row 127: restore The Boss Move's First 30 Day Success Planner.
-- Kajabi post 2187370737 has a 5,162,162-byte PDF download. The exact bytes
-- (SHA-256 dd4bd0f369f402c00138d2db05cfded73fd36baa5e763147cb706b2b7b5483e4)
-- were stored first in the app's protected, KMS-encrypted media S3 bucket at
-- protected:kajabi-boss-move-first-30-days-success-planner.pdf.
-- The lesson is intentionally switched to pdf so the player renders the
-- attachment and an Open the document link alongside the existing directions.
INSERT INTO media_assets
  (filename, original_name, url, mime, kind, size_bytes, title, folder)
SELECT
  'kajabi-boss-move-first-30-days-success-planner.pdf',
  'The_First_30_Days_Success_Planner.pdf.pdf',
  'protected:kajabi-boss-move-first-30-days-success-planner.pdf',
  'application/pdf', 'document', 5162162,
  'The First 30 Days Success Planner', 'Kajabi import'
WHERE NOT EXISTS (
  SELECT 1 FROM media_assets
   WHERE url = 'protected:kajabi-boss-move-first-30-days-success-planner.pdf'
);

UPDATE course_lessons l
   SET attachment_url = 'protected:kajabi-boss-move-first-30-days-success-planner.pdf',
       content_type = 'pdf',
       updated_at = now()
  FROM course_modules m
  JOIN courses c ON c.id = m.course_id
 WHERE l.module_id = m.id
   AND c.slug = 'the-boss-move'
   AND l.kajabi_id = '2187370737'
   AND l.attachment_url = ''
   AND l.content_type = 'text';
