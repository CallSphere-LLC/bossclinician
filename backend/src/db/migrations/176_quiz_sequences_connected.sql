-- =============================================================================
-- 176: Quizzes reach the email sequences the owner built on Kajabi (QA sheet row 208)
--
-- The Kajabi import brought the sequences and their automations in paused, so
-- no quiz taker has ever been put on one. This connects only the two quizzes
-- whose sequence is certain:
--
--   Practice Set Up Quiz (/practice-quiz/take, /visionary-form, /careful-form,
--   /steady-form, /reluctant-form): forms quiz-*. Kajabi's own automations, by
--   kajabi_id, are switched on. The stopgap result emails from 095 are paused in
--   the same statement, because each sequence's first email is that result: with
--   both on, one submission gets two.
--
--   Private Practice For You quiz (/private-practice-for-you): one form with the
--   result as a hidden answer, where Kajabi had one form per result (unpublished
--   here, nothing submits them). The sequences' first emails name the quiz's
--   exact results, so three new automations on the live form do the same job,
--   chosen by `result` (growthPublic.ts now carries it on the event). This quiz
--   promised a result by email and had no automation at all.
--
-- The emails are repaired first, or activating them would mail nonsense:
--   * Word's <o:p> tags are in nearly every paragraph, and the email renderer
--     escapes them, so they would print as text;
--   * the import read Kajabi's preview, so Kajabi's first-name tag came through
--     as whoever was being previewed ("Hey Rebecca", "Hey Sample", "Hey Yvette");
--   * one email opens with the owner's drafting notes (EMAIL 3 / Subject / Preview).
--
-- Guards:
--   * Future submissions only. Nobody is enrolled here and no existing
--     submission is replayed. An automation only ever reacts to new events.
--   * Sequences must be active with an enabled email and clean copy, or that
--     mapping is skipped and left paused.
--   * A retake with a different result does not start a second sequence from the
--     same quiz (`in_sequence not_has`). allow_reentry is already off on all seven.
--
-- Left paused on purpose: the tag automations 1356-1363 (the quiz-* forms already
-- apply those tags), and everything else from the import.
-- Sends nothing and touches no contact. Safe to run twice.
-- =============================================================================

-- 1. Repair the seven sequences' copy.

UPDATE sequence_emails e
   SET body_md = regexp_replace(
         regexp_replace(e.body_md, '<o:p[^>]*>[[:space:]' || chr(160) || ']*</o:p>', '', 'g'),
         '</?o:p[^>]*>', '', 'g'),
       updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.kajabi_id IN (2148866444, 2148866472, 2148866491, 2148866513,
                       2148292207, 2148292525, 2148292526)
   AND e.body_md LIKE '%o:p%';

-- The preview names. "Yvette Howard" is the signature and stays.
UPDATE sequence_emails e
   SET body_md = regexp_replace(e.body_md, '\mYvette\M(?! Howard)', '{{firstName}}', 'g'), updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.kajabi_id IN (2148866491, 2148866513) -- Steady Grower, Reluctant CEO
   AND e.body_md ~ '\mYvette\M(?! Howard)';

UPDATE sequence_emails e
   SET body_md = regexp_replace(e.body_md, '\mSample\M', '{{firstName}}', 'g'), updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.kajabi_id = 2148866472 -- Careful Clinician
   AND e.body_md ~ '\mSample\M';

UPDATE sequence_emails e
   SET body_md = regexp_replace(e.body_md, '\mRebecca\M', '{{firstName}}', 'g'), updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.kajabi_id = 2148866444 -- Visionary Builder
   AND e.body_md ~ '\mRebecca\M';

-- The drafting notes above the greeting of Not Yet Ready's third email.
UPDATE sequence_emails e
   SET body_md = substr(e.body_md, position('Hi {{firstName}},' in e.body_md)), updated_at = now()
  FROM email_sequences s
 WHERE s.id = e.sequence_id
   AND s.kajabi_id = 2148292207
   AND e.body_md LIKE '**EMAIL 3 %'
   AND position('Hi {{firstName}},' in e.body_md) > 0;

-- 2. Practice Set Up Quiz: Kajabi's automation on, the stopgap result email off.

DO $bc$
DECLARE
  m record;
  v_sequence integer;
  v_automation integer;
  v_family integer[];
BEGIN
  SELECT array_agg(s.id) INTO v_family
    FROM email_sequences s
   WHERE s.kajabi_id IN (2148866444, 2148866472, 2148866491, 2148866513);

  FOR m IN
    SELECT * FROM (VALUES
      (2155548628::bigint, 2148866444::bigint, 'quiz-visionary', 'Quiz result email — Visionary Builder'),
      (2155548634::bigint, 2148866472::bigint, 'quiz-careful',   'Quiz result email — Careful Clinician'),
      (2155548637::bigint, 2148866491::bigint, 'quiz-steady',    'Quiz result email — Steady Grower'),
      (2155548638::bigint, 2148866513::bigint, 'quiz-reluctant', 'Quiz result email — Reluctant CEO')
    ) AS v(automation_kajabi, sequence_kajabi, form_slug, old_name)
  LOOP
    SELECT s.id INTO v_sequence
      FROM email_sequences s
     WHERE s.kajabi_id = m.sequence_kajabi
       AND s.status = 'active'
       AND EXISTS (SELECT 1 FROM sequence_emails e WHERE e.sequence_id = s.id AND e.enabled)
       AND NOT EXISTS (
         SELECT 1 FROM sequence_emails e
          WHERE e.sequence_id = s.id
            AND e.body_md ~ '<o:p|\mRebecca\M|\mSample\M|^\*\*EMAIL [0-9]|^(Hey )?Yvette\M');

    SELECT a.id INTO v_automation
      FROM automations a
      JOIN automation_actions x ON x.automation_id = a.id AND x.action_type = 'subscribe_sequence'
      JOIN forms f ON f.slug = m.form_slug AND f.published
     WHERE a.kajabi_id = m.automation_kajabi
       AND a.trigger_type = 'form_submitted'
       AND a.status = 'paused'
       AND (a.trigger_config->>'formId')::integer = f.id
       AND (x.config->>'sequenceId')::integer = v_sequence;

    IF v_sequence IS NULL OR v_automation IS NULL THEN
      RAISE NOTICE '176: % left as it was', m.form_slug;
      CONTINUE;
    END IF;

    UPDATE automations a
       SET status = 'active',
           conditions = jsonb_build_object(
             'match', 'all',
             'rules', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('field', 'in_sequence', 'op', 'not_has', 'value', other))
                 FROM unnest(v_family) AS other
                WHERE other <> v_sequence
             ), '[]'::jsonb)),
           description = trim(a.description || ' Switched on 2026-10-30 (row 208). Skipped for anyone already on another Practice Set Up Quiz sequence, so a retake does not start a second one.'),
           updated_at = now()
     WHERE a.id = v_automation;

    UPDATE automations a
       SET status = 'paused',
           description = trim(a.description || ' Paused 2026-10-30 (row 208): the first email of the Kajabi sequence now sends the result. Switching this back on would send two.'),
           updated_at = now()
     WHERE a.name = m.old_name
       AND a.trigger_type = 'form_submitted'
       AND a.status = 'active';
  END LOOP;
END
$bc$;

-- 3. Private Practice For You quiz: one automation per result on the live form.

DO $bc$
DECLARE
  m record;
  v_form integer;
  v_sequence integer;
  v_tag integer;
  v_new integer;
  v_family integer[];
BEGIN
  SELECT f.id INTO v_form FROM forms f WHERE f.slug = 'private-practice-for-you' AND f.published;
  IF v_form IS NULL THEN
    RAISE NOTICE '176: private-practice-for-you is not here, skipped';
    RETURN;
  END IF;

  SELECT array_agg(s.id) INTO v_family
    FROM email_sequences s
   WHERE s.kajabi_id IN (2148292207, 2148292525, 2148292526);

  FOR m IN
    SELECT * FROM (VALUES
      ('Ready to Build', 2148292526::bigint, 2151205573::bigint, ARRAY[2151205574, 2151205573]::bigint[]),
      ('Almost Ready',   2148292525::bigint, 2151205569::bigint, ARRAY[2151205572, 2151205569]::bigint[]),
      ('Not Quite Yet',  2148292207::bigint, 2151205568::bigint, ARRAY[2151181618, 2151205568]::bigint[])
    ) AS v(result_label, sequence_kajabi, tag_automation_kajabi, kajabi_automations)
  LOOP
    SELECT s.id INTO v_sequence
      FROM email_sequences s
     WHERE s.kajabi_id = m.sequence_kajabi
       AND s.status = 'active'
       AND EXISTS (SELECT 1 FROM sequence_emails e WHERE e.sequence_id = s.id AND e.enabled)
       AND NOT EXISTS (
         SELECT 1 FROM sequence_emails e
          WHERE e.sequence_id = s.id
            AND e.body_md ~ '<o:p|\mRebecca\M|\mSample\M|^\*\*EMAIL [0-9]|^(Hey )?Yvette\M');
    IF v_sequence IS NULL THEN
      RAISE NOTICE '176: % left as it was', m.result_label;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM automations a
                WHERE a.name = 'Private Practice For You quiz — ' || m.result_label) THEN
      CONTINUE;
    END IF;

    -- The tag Kajabi gave this result, read from its own automation.
    SELECT (x.config->>'tagId')::integer INTO v_tag
      FROM automations a
      JOIN automation_actions x ON x.automation_id = a.id AND x.action_type = 'add_tag'
     WHERE a.kajabi_id = m.tag_automation_kajabi;

    INSERT INTO automations (name, description, trigger_type, trigger_config, conditions, status)
    VALUES (
      'Private Practice For You quiz — ' || m.result_label,
      'Starts the sequence for the "' || m.result_label || '" result of the quiz at /private-practice-for-you (row 208). Does what Kajabi did with one form per result; this site has one form and the result as a hidden answer. Skipped for anyone already on another result''s sequence.',
      'form_submitted',
      jsonb_build_object('formId', v_form),
      jsonb_build_object(
        'match', 'all',
        'rules', jsonb_build_array(jsonb_build_object('field', 'result', 'op', 'is', 'value', m.result_label))
          || COALESCE((
               SELECT jsonb_agg(jsonb_build_object('field', 'in_sequence', 'op', 'not_has', 'value', other))
                 FROM unnest(v_family) AS other
                WHERE other <> v_sequence
             ), '[]'::jsonb)),
      'active'
    )
    RETURNING id INTO v_new;

    IF v_tag IS NOT NULL THEN
      INSERT INTO automation_actions (automation_id, action_type, config, sort)
      VALUES (v_new, 'add_tag', jsonb_build_object('tagId', v_tag), 0);
    END IF;
    INSERT INTO automation_actions (automation_id, action_type, config, sort)
    VALUES (v_new, 'subscribe_sequence', jsonb_build_object('sequenceId', v_sequence), 1);

    UPDATE automations a
       SET description = trim(a.description || ' Kept paused (row 208): nothing submits this Kajabi form on this site. "Private Practice For You quiz — ' || m.result_label || '" does this job now.'),
           updated_at = now()
     WHERE a.kajabi_id = ANY(m.kajabi_automations)
       AND a.status = 'paused';
  END LOOP;
END
$bc$;
