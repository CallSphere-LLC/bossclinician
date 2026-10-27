-- Called only by qa.py fixture after its authorization guard and live preflight.
BEGIN;
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM members WHERE email IN ('bc-qa-200-20261027-a@example.invalid','bc-qa-200-20261027-b@example.invalid'))
 OR EXISTS (SELECT 1 FROM contacts WHERE email IN ('bc-qa-200-20261027-a@example.invalid','bc-qa-200-20261027-b@example.invalid'))
 OR EXISTS (SELECT 1 FROM form_submissions WHERE email IN ('bc-qa-200-20261027-a@example.invalid','bc-qa-200-20261027-b@example.invalid'))
 THEN RAISE EXCEPTION 'Synthetic identities already exist; inspect, do not reuse'; END IF;
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=44 AND course_id=52 AND slug='the-boss-move')
 THEN RAISE EXCEPTION 'Expected Boss Move product mapping changed'; END IF;
END
$guard$;
INSERT INTO members(email,name,first_name,last_name,timezone,email_verified_at)
VALUES ('bc-qa-200-20261027-a@example.invalid','QA Intake A','QA','Intake A','America/Los_Angeles',now()),
       ('bc-qa-200-20261027-b@example.invalid','','','','America/Los_Angeles',now());
INSERT INTO access_grants(member_id,product_id,source,status,expires_at)
SELECT id,44,'manual','active',now()+interval '2 hours' FROM members
WHERE email IN ('bc-qa-200-20261027-a@example.invalid','bc-qa-200-20261027-b@example.invalid');
SELECT json_build_object('members',(SELECT json_agg(json_build_object('id',id,'email',email) ORDER BY email) FROM members
 WHERE email IN ('bc-qa-200-20261027-a@example.invalid','bc-qa-200-20261027-b@example.invalid')),
 'productId',44,'courseId',52,'lessonId',249,'createdAt',now())::text;
COMMIT;
