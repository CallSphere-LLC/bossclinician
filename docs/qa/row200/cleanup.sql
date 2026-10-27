-- Default is audit-only. qa.py supplies manifest-checked integer IDs and execute_cleanup=false/true.
BEGIN;
CREATE TEMP TABLE qa_members ON COMMIT DROP AS
 SELECT id,email FROM members WHERE
 (id=:member_a AND email='bc-qa-200-20261027-a@example.invalid') OR
 (id=:member_b AND email='bc-qa-200-20261027-b@example.invalid');
CREATE TEMP TABLE qa_contacts ON COMMIT DROP AS
 SELECT id,email FROM contacts WHERE email IN (SELECT email FROM qa_members);
CREATE TEMP TABLE qa_replies ON COMMIT DROP AS
 SELECT id,form_id,member_id,email,contact_id FROM form_submissions
 WHERE member_id IN (SELECT id FROM qa_members) OR email IN (SELECT email FROM qa_members);
CREATE TEMP TABLE qa_events ON COMMIT DROP AS
 SELECT id,event_key FROM domain_events
 WHERE contact_id IN (SELECT id FROM qa_contacts) OR email IN (SELECT email FROM qa_members);
CREATE TEMP TABLE qa_jobs ON COMMIT DROP AS
 SELECT id FROM jobs WHERE
 (kind='domainEvents.dispatch' AND payload->>'eventId' IN (SELECT id::text FROM qa_events))
 OR payload->>'memberId' IN (SELECT id::text FROM qa_members)
 OR payload->>'contactId' IN (SELECT id::text FROM qa_contacts)
 OR EXISTS(SELECT 1 FROM qa_members q WHERE jobs.payload::text LIKE '%' || q.email || '%');

DO $guard$
DECLARE r record; n bigint; allowed boolean; target_form_id integer;
BEGIN
 IF (SELECT count(*) FROM qa_members) <> 2 THEN RAISE EXCEPTION 'Manifest member ID/email mismatch or fixture missing'; END IF;
 SELECT id INTO target_form_id FROM forms WHERE slug='boss-move-intake-survey';
 IF target_form_id IS NULL THEN RAISE EXCEPTION 'Expected survey missing'; END IF;
 IF EXISTS(SELECT 1 FROM members WHERE id IN (SELECT id FROM qa_members) AND contact_id IS NOT NULL AND contact_id NOT IN (SELECT id FROM qa_contacts))
 THEN RAISE EXCEPTION 'Member linked to unexpected contact'; END IF;
 IF EXISTS(SELECT 1 FROM qa_replies WHERE form_id <> (SELECT id FROM forms WHERE slug='boss-move-intake-survey')
    OR member_id NOT IN (SELECT id FROM qa_members) OR member_id IS NULL
    OR email NOT IN (SELECT email FROM qa_members)
    OR (contact_id IS NOT NULL AND contact_id NOT IN (SELECT id FROM qa_contacts)))
 THEN RAISE EXCEPTION 'Unexpected form reply ownership/scope'; END IF;
 IF EXISTS(SELECT 1 FROM access_grants WHERE member_id IN (SELECT id FROM qa_members) AND (product_id<>44 OR source<>'manual' OR expires_at IS NULL))
 THEN RAISE EXCEPTION 'Unexpected grant'; END IF;
 IF EXISTS(SELECT 1 FROM lesson_progress WHERE member_id IN (SELECT id FROM qa_members) AND (lesson_id<>249 OR completed_at IS NOT NULL))
 THEN RAISE EXCEPTION 'Unexpected lesson completion/progress'; END IF;
 IF EXISTS(SELECT 1 FROM domain_events WHERE id IN (SELECT id FROM qa_events)
   AND (event_type<>'form_submitted' OR subject_id<>target_form_id OR source<>'form:boss-move-intake-survey'
        OR event_key NOT IN (SELECT 'form-submitted:' || id::text FROM qa_replies)))
 THEN RAISE EXCEPTION 'Unexpected domain event'; END IF;
 IF EXISTS(SELECT 1 FROM contact_activity WHERE contact_id IN (SELECT id FROM qa_contacts) AND kind<>'form.submitted')
 THEN RAISE EXCEPTION 'Unexpected contact activity'; END IF;
 IF EXISTS(SELECT 1 FROM jobs WHERE id IN (SELECT id FROM qa_jobs) AND
   (kind<>'domainEvents.dispatch' OR payload->>'eventId' NOT IN (SELECT id::text FROM qa_events)))
 THEN RAISE EXCEPTION 'Unexpected queued side effect'; END IF;
 IF EXISTS(SELECT 1 FROM webhook_deliveries WHERE event_key IN (SELECT event_key FROM qa_events)
   OR EXISTS(SELECT 1 FROM qa_members q WHERE webhook_deliveries.payload::text LIKE '%' || q.email || '%'))
 THEN RAISE EXCEPTION 'Unexpected outbound webhook footprint'; END IF;
 IF EXISTS(SELECT 1 FROM automation_runs WHERE event_key IN (SELECT event_key FROM qa_events))
 THEN RAISE EXCEPTION 'Unexpected automation run'; END IF;

 -- Inspect every direct FK, including SET NULL references that would otherwise survive deletion.
 FOR r IN
 SELECT tc.table_schema,tc.table_name,kcu.column_name,ccu.table_name AS target
 FROM information_schema.table_constraints tc
 JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
 JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.constraint_schema
 JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=rc.unique_constraint_name AND ccu.constraint_schema=rc.unique_constraint_schema
 WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=current_schema()
   AND ccu.table_name IN ('members','contacts','form_submissions')
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IN (SELECT id FROM %I)',r.table_schema,r.table_name,r.column_name,
   CASE r.target WHEN 'members' THEN 'qa_members' WHEN 'contacts' THEN 'qa_contacts' ELSE 'qa_replies' END) INTO n;
  allowed := CASE r.target
   WHEN 'members' THEN r.table_name IN ('access_grants','form_submissions','lesson_progress','member_magic_links','member_sessions','member_email_preferences','member_email_verifications','member_password_resets')
   WHEN 'contacts' THEN r.table_name IN ('form_submissions','contact_activity','domain_events','contact_email_preferences','members')
   ELSE false END;
  IF n>0 THEN
    RAISE NOTICE 'Scoped footprint %.%: %',r.table_name,r.column_name,n;
    IF NOT allowed THEN RAISE EXCEPTION 'Unexpected FK footprint %.% (% rows)',r.table_name,r.column_name,n; END IF;
  END IF;
 END LOOP;
 -- Also catch orphan email-address records without member/contact FKs.
 FOR r IN SELECT table_schema,table_name,column_name FROM information_schema.columns
   WHERE table_schema=current_schema() AND column_name IN ('email','recipient_email','to_email')
     AND table_name NOT IN ('members','contacts','form_submissions','domain_events')
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE lower(%I::text) IN (SELECT email::text FROM qa_members)',r.table_schema,r.table_name,r.column_name) INTO n;
  IF n>0 THEN RAISE EXCEPTION 'Unexpected email footprint %.% (% rows)',r.table_name,r.column_name,n; END IF;
 END LOOP;
END
$guard$;
SELECT 'members' AS scope,count(*) FROM qa_members UNION ALL
SELECT 'contacts',count(*) FROM qa_contacts UNION ALL
SELECT 'replies',count(*) FROM qa_replies UNION ALL
SELECT 'events',count(*) FROM qa_events UNION ALL
SELECT 'jobs',count(*) FROM qa_jobs;

\if :execute_cleanup
-- Claim exact queue rows; do not race an in-flight dispatch.
SELECT id FROM jobs WHERE id IN (SELECT id FROM qa_jobs) FOR UPDATE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM jobs WHERE id IN (SELECT id FROM qa_jobs) AND status='running')
 THEN RAISE EXCEPTION 'QA event job is running; wait for completion and re-audit'; END IF;
END $guard$;
DELETE FROM jobs WHERE id IN (SELECT id FROM qa_jobs);
DELETE FROM domain_events WHERE id IN (SELECT id FROM qa_events);
UPDATE forms SET submit_count=GREATEST(0,submit_count-(SELECT count(*)::int FROM qa_replies))
 WHERE id=(SELECT id FROM forms WHERE slug='boss-move-intake-survey');
DELETE FROM form_submissions WHERE id IN (SELECT id FROM qa_replies);
DELETE FROM members WHERE id IN (SELECT id FROM qa_members);
DELETE FROM contacts WHERE id IN (SELECT id FROM qa_contacts);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM members WHERE id IN (SELECT id FROM qa_members))
 OR EXISTS(SELECT 1 FROM contacts WHERE id IN (SELECT id FROM qa_contacts))
 OR EXISTS(SELECT 1 FROM form_submissions WHERE id IN (SELECT id FROM qa_replies))
 OR EXISTS(SELECT 1 FROM domain_events WHERE id IN (SELECT id FROM qa_events))
 OR EXISTS(SELECT 1 FROM jobs WHERE id IN (SELECT id FROM qa_jobs))
 THEN RAISE EXCEPTION 'Cleanup zero-footprint verification failed'; END IF;
END $guard$;
SELECT 'PASS: captured fixture identities/replies/events/jobs removed; admin/audit/shared content preserved' AS result;
COMMIT;
\else
ROLLBACK;
\endif
