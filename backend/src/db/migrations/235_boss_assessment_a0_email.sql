-- =============================================================================
-- 235: /boss-assessment results email is now A0 (QA sheet row 255)
--
-- The results email is sent from code (services/bossAssessment.ts), and now uses
-- the A0 copy from the Group Practice Assessment Email Sequence doc. The two old
-- Kajabi PDF emails on this form ("Download your free fillable PDF" and "You
-- built the team. Now the harder part.") were created paused by 099 and marked
-- retired by 177. This makes sure neither can ALSO send: if either was switched
-- on since, it goes back to paused. A no-op when both are already paused.
--
-- Sends nothing and touches no contact. Safe to run twice.
-- =============================================================================

UPDATE automations
   SET status = 'paused',
       updated_at = now()
 WHERE status = 'active'
   AND name IN (
     $ba$Boss assessment — send the Group Practice Self-Assessment$ba$,
     $ba$Form is submitted: Boss Assessment → Send an email: You built the team. Now the harder part.$ba$
   );
