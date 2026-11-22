-- =============================================================================
-- 205 — Website copy handoff of 21 Nov 2026 (QA sheet row 245)
--
-- Section 3 of the handoff, confirmed by Yvette: use "Brighter Tomorrow" in
-- Boss Clinician marketing copy, replacing the outdated practice name
-- "Brighter Tomorrow Counseling Services". The About page keeps its wording
-- (it is code, not data, and is not touched here); contracts and legal
-- records are not marketing copy and are not touched either.
--
-- A read-only sweep of the live database (pages, products, courses, lessons,
-- blog posts, settings, testimonials, offers, forms, funnels, events,
-- resources, podcasts, newsletters, campaigns, email templates, contracts,
-- assessments and their results, automations, certificate templates)
-- found the old name in exactly two rows, both emails of
-- "SEQUENCE 4 · THE RELUCTANT CEO" (sequence 489): ids 1599 and 1601.
-- The sequence had no subscribers when this was written, so nobody is sent
-- anything because of this change; anyone who joins later gets the new wording.
--
-- Idempotent: each statement only touches rows that still contain the old name.
-- Other row-245 copy changes (from the agents working on other pages) are
-- appended below by the parent when merged.
-- =============================================================================

UPDATE sequence_emails
   SET body_md      = replace(body_md, 'Brighter Tomorrow Counseling Services', 'Brighter Tomorrow'),
       subject      = replace(subject, 'Brighter Tomorrow Counseling Services', 'Brighter Tomorrow'),
       preview_text = replace(preview_text, 'Brighter Tomorrow Counseling Services', 'Brighter Tomorrow'),
       updated_at   = now()
 WHERE body_md      LIKE '%Brighter Tomorrow Counseling Services%'
    OR subject      LIKE '%Brighter Tomorrow Counseling Services%'
    OR preview_text LIKE '%Brighter Tomorrow Counseling Services%';
