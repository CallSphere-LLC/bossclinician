-- Sheet row 244 follow-up: masterclass Email 1 linked the Practice Freedom Audit on Kajabi's file storage
-- (Kajabi closes ~23 Nov 2026). Point it at the identical file we host (same md5, 716,160 bytes).
UPDATE sequence_emails
   SET body_md = regexp_replace(body_md,
         'https://s3\.amazonaws\.com/kajabi-storefronts-production/file-uploads/sites/2148299891/downloads/[^"]*Practice_Freedom_Audit_Fillable\.pdf',
         'https://www.bossclinician.com/downloads/practice-freedom-audit.pdf', 'g'),
       updated_at = now()
 WHERE sequence_id = 488 AND body_md ~ 'kajabi-storefronts-production/[^"]*Practice_Freedom_Audit_Fillable\.pdf';
