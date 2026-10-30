-- 180: the owner's opt-in and purchase emails reach the owner (sheet row 213).
--
-- "When a customer opts into a resource or purchases an item as the admin I am
-- not getting notified about it."
--
-- Two separate reasons, both data rather than code:
--
--  1. settings.notifications.notifyEmail still held the address set for a QA
--     pause on 09-19, so every email the site sends the owner went there. Moved
--     only while it is still that address: anything she has saved since stands.
--
--  2. Almost every published opt-in (lead magnets, quizzes, sign-ups) was seeded
--     with its "email me when someone sends this" switch off, so those replies
--     were filed and nobody was told. Published forms only: the unpublished rows
--     are Kajabi imports and in-lesson forms, which are not opt-ins, and the
--     switch stays hers to turn back off per form.
--
-- Applies to replies from now on. Nothing already filed is announced, and nothing
-- here sends to a contact. Idempotent: both updates match nothing a second time.

UPDATE settings
   SET value = jsonb_set(value, '{notifyEmail}', '"yvette@bossclinician.com"'::jsonb),
       updated_at = now()
 WHERE key = 'notifications'
   AND lower(trim(value->>'notifyEmail')) = 'sagar@callsphere.tech';

UPDATE forms
   SET notify_on_submit = true,
       updated_at = now()
 WHERE published = true
   AND notify_on_submit = false;
