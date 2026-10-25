-- Correct the punctuation damaged in the initial intake form import.
UPDATE forms SET name = 'Directory Makeover Audit - Intake'
 WHERE slug = 'directory-makeover-audit-intake'
   AND name = 'Directory Makeover Audit ? Intake';
