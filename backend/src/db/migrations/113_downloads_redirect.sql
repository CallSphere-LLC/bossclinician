-- 113: /downloads now lives as the Documents tab of the member Library.
--
-- The SPA route redirects in-app, but a direct load of /downloads never reaches
-- it: frontend/public/downloads/ (the lead-magnet files) is a real directory, so
-- nginx answers with its own trailing-slash 301 and then a 404. A redirects-table
-- row lands in nginx/redirects.map, which is checked before static files.
-- Idempotent.

INSERT INTO redirects (from_path, to_path, status_code, note)
SELECT v.from_path, '/library?tab=documents', 301, 'Member downloads moved to Library > Documents'
  FROM (VALUES ('/downloads'), ('/downloads/')) AS v(from_path)
 WHERE NOT EXISTS (SELECT 1 FROM redirects r WHERE r.from_path = v.from_path);
