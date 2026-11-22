-- =============================================================================
-- 225: Post-retreat alumni emails, Yvette's round-2 answers (22 Nov 2026, item 6)
--
-- She approved the four-email flow (migration 220) with these changes:
--   * Email 4 preview text: "Stay connected to what's next for FlourisHealer."
--   * Email 4's first-access paragraph replaced with her exact paragraph.
--   * Email 4's button: "Explore upcoming retreats" -> the permanent
--     /upcoming-retreats page. {{retreatNextUrl}} now defaults to that page
--     (services/retreatAnchor.ts); retreat_alumni_settings.next_url stays an
--     optional per-retreat override, so future retreats need no edit.
--   * "First access" removed everywhere: Email 4 above, and the Bali dashboard's
--     "Join Us Again" intro (seeded by 218) loses its "or join the first-access
--     list" clause. Only exact, never-edited seed text is touched.
--   * Email 4 stays DISABLED (sequence_emails.enabled = false) until the
--     /upcoming-retreats page and /retreat-interest signup are live and tested.
--
-- Source text: services/retreatAlumniEmails.ts (retreatAlumniEmails.test.ts
-- pins the copy). Emails 1-3 are unchanged.
--
-- NOTHING IS SWITCHED ON HERE: the sequence stays 'draft' and the enrolment job
-- stays disabled. Nobody is enrolled and nothing is sent. No member data is
-- touched. Idempotent: every UPDATE is guarded on the old text, so a re-run (or
-- an owner's later edit) is left alone, and Email 4 is switched off only in the
-- same statement that applies the revision — a re-run never switches it off again.
--
-- SWITCH ON Emails 1-3 (one statement; after testing; Bali must be published
-- before its Day +3, 23 Jun 2027, or every email holds and then skips):
--   WITH seq AS (
--     UPDATE email_sequences SET status = 'active', updated_at = now()
--      WHERE slug = 'retreat-alumni' AND status = 'draft' RETURNING id)
--   UPDATE job_schedules SET enabled = true, next_run_at = now(), updated_at = now()
--    WHERE name = 'retreat-alumni-enrol' AND EXISTS (SELECT 1 FROM seq);
--
-- SWITCH ON Email 4 (once https://www.bossclinician.com/upcoming-retreats and
-- /retreat-interest are verified live; BEFORE Bali's Day +14, 4 Jul 2027 —
-- a guest whose run passes Email 3 while Email 4 is off finishes the sequence):
--   UPDATE sequence_emails SET enabled = true, updated_at = now()
--    WHERE position = 4
--      AND sequence_id = (SELECT id FROM email_sequences WHERE slug = 'retreat-alumni');
-- =============================================================================

-- 1. Email 4: preview text ----------------------------------------------------

UPDATE sequence_emails e
   SET preview_text = $new$Stay connected to what's next for FlourisHealer.$new$,
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.slug = 'retreat-alumni'
   AND e.position = 4
   AND e.preview_text = $old$First access to whatever FlourisHealer creates next.$old$;

-- 2. Email 4: paragraph + button, and switched off until its page is live ------

UPDATE sequence_emails e
   SET body_md = replace(
                   replace(e.body_md,
                     $oldp$If we've announced a retreat that feels like your next yes, you can explore the full details and decide whether it's right for you. If dates aren't announced yet, you can join the first-access list instead.$oldp$,
                     $newp$If an upcoming retreat catches your eye, you can explore the details and decide whether it fits your next chapter. If nothing is announced yet, you can sign up to hear when new retreats are available.$newp$),
                   $oldb$[EXPLORE WHAT'S NEXT / JOIN FIRST ACCESS]({{retreatNextUrl}} "button")$oldb$,
                   $newb$[Explore upcoming retreats]({{retreatNextUrl}} "button")$newb$),
       enabled = false,
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.slug = 'retreat-alumni'
   AND e.position = 4
   AND strpos(e.body_md, $oldb$[EXPLORE WHAT'S NEXT / JOIN FIRST ACCESS]({{retreatNextUrl}} "button")$oldb$) > 0;

-- 3. The sequence's admin description -----------------------------------------

UPDATE email_sequences
   SET description = replace(
                       replace(description,
                         $o1$anybody holding active, unrefunded access to the retreat's booking product (retreats.booking_product_id; Bali: product 70).$o1$,
                         $n1$anybody holding active, unrefunded access to the retreat's booking product or its dashboard product (Bali: products 70 / 80), however it was granted; a grant never sends anything by itself.$n1$),
                       $o2$Email 4 waits for its link (retreat_alumni_settings.next_url).$o2$,
                       $n2$Email 4 ("Explore upcoming retreats") opens /upcoming-retreats (retreat_alumni_settings.next_url overrides it) and is switched off until that page is live (migration 225).$n2$),
       updated_at = now()
 WHERE slug = 'retreat-alumni'
   AND strpos(description, $o2$Email 4 waits for its link (retreat_alumni_settings.next_url).$o2$) > 0;

-- 4. Bali dashboard "Join Us Again" intro: drop "or join the first-access list" --

DO $m225$
BEGIN
  IF to_regclass('public.retreats') IS NULL THEN
    RAISE NOTICE '225: retreats table not found (migration 218); dashboard intro skipped';
    RETURN;
  END IF;
  UPDATE retreats
     SET settings = jsonb_set(settings, '{joinUsAgain,intro}',
                              to_jsonb($new$Loved having you with us. Ready for your next FlourisHealer experience? Explore what’s coming next.$new$::text)),
         updated_at = now()
   WHERE settings->'joinUsAgain'->>'intro'
         = $old$Loved having you with us. Ready for your next FlourisHealer experience? Explore what’s coming next—or join the first-access list.$old$;
END
$m225$;
