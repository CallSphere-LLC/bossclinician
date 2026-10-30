-- =============================================================================
-- 177: /boss-assessment becomes the assessment itself (QA sheet row 209)
--
-- The page used to be a sign-up promising a fillable PDF by email. It now scores
-- the ten statements on the page and emails the results, which the server works
-- out again from the answers (services/bossAssessment.ts). This migration:
--
--   1. re-describes the `boss-assessment` form for what the page now sends. The
--      old last-name and practice questions stay, optional, so the replies already
--      filed still read correctly. `create_lead` goes on so a taker also appears
--      under Leads; `notify_on_submit` is left off, so that emails nobody.
--   2. marks the two PDF emails on this form as retired. Both are paused and have
--      never run. Switching either on would send a link to the old PDF (one is a
--      placeholder, the other is hosted on Kajabi) to people who were promised
--      results. They are kept because one is imported Kajabi content, and they are
--      not deleted or switched on here.
--
-- Sends nothing and touches no contact. Safe to run twice.
-- =============================================================================

UPDATE forms
   SET description = $ba$The group practice self-assessment at /boss-assessment. The page draws its own fields and the server works out the total, tier and blocker scores from the ten answers (services/bossAssessment.ts), so edits to the questions here do not change the assessment. The results email is sent by that code, not by an automation.$ba$,
       submit_label = $ba$Email my results$ba$,
       success_message = $ba$Your results are on their way.$ba$,
       create_lead = true,
       fields = $ba$[
         {"key":"first_name","label":"First Name","type":"text","required":true,"contactField":"firstName"},
         {"key":"email","label":"Email","type":"email","required":true,"contactField":"email"},
         {"key":"marketing_consent","label":"Also wants Boss Clinician emails","type":"checkbox","required":false},
         {"key":"total","label":"Total blocker score (out of 50)","type":"hidden","required":false},
         {"key":"tier","label":"Result","type":"hidden","required":false},
         {"key":"highest_blockers","label":"Highest blocker(s)","type":"hidden","required":false},
         {"key":"leadership_dependency","label":"Leadership Dependency (out of 10)","type":"hidden","required":false},
         {"key":"broken_pay_structure","label":"Broken Pay Structure (out of 10)","type":"hidden","required":false},
         {"key":"missing_systems","label":"Missing Systems (out of 10)","type":"hidden","required":false},
         {"key":"team_misalignment","label":"Team Misalignment (out of 10)","type":"hidden","required":false},
         {"key":"no_exit_strategy","label":"No Exit Strategy (out of 10)","type":"hidden","required":false},
         {"key":"commitment","label":"One change I'll make this month","type":"hidden","required":false},
         {"key":"q1","label":"Q1 · My team asks for my input or approval before making decisions they could reasonably make on their own.","type":"hidden","required":false},
         {"key":"q2","label":"Q2 · When I’m unavailable — out of the office, in a session, or on vacation — things slow down or fall apart.","type":"hidden","required":false},
         {"key":"q3","label":"Q3 · I know what my clinicians earn but I’m not consistently clear on what I should be paying myself.","type":"hidden","required":false},
         {"key":"q4","label":"Q4 · After covering payroll, overhead, and taxes, my take-home pay doesn’t reflect the volume of work moving through my practice.","type":"hidden","required":false},
         {"key":"q5","label":"Q5 · If a new clinician joined today, there is no documented onboarding process they could follow without my direct involvement.","type":"hidden","required":false},
         {"key":"q6","label":"Q6 · Key processes — intake, scheduling, billing, documentation review — depend on my personal knowledge rather than written systems.","type":"hidden","required":false},
         {"key":"q7","label":"Q7 · My clinicians do good clinical work but don’t understand or actively participate in the culture and direction of the practice.","type":"hidden","required":false},
         {"key":"q8","label":"Q8 · Retaining clinicians is a recurring challenge — I spend significant time or money on turnover that disrupts the practice.","type":"hidden","required":false},
         {"key":"q9","label":"Q9 · I have not clearly defined what my role in this practice looks like when I am fully leading it — rather than operating in it daily.","type":"hidden","required":false},
         {"key":"q10","label":"Q10 · A real vacation, maternity leave, or extended time away would currently create a significant disruption to operations or revenue.","type":"hidden","required":false},
         {"key":"last_name","label":"Last Name","type":"text","required":false,"contactField":"lastName"},
         {"key":"years_group_owner","label":"How Long Have You Been A Group Practice Owner","type":"select","required":false,"options":["I haven't hired just yet, but feel ready","1-2 years","3-4 years","5-10+ years"],"contactField":"years_group_owner"},
         {"key":"team_size","label":"How Many Employees/Contractors Do You Have","type":"select","required":false,"options":["1-2","3-5","5-10","10+"],"contactField":"team_size"}
       ]$ba$::jsonb,
       updated_at = now()
 WHERE slug = 'boss-assessment';

UPDATE automations
   SET description = $ba$RETIRED, do not switch on. /boss-assessment no longer offers the PDF: it emails each person their own results from the page's code. This email would send a link to the old PDF.$ba$,
       updated_at = now()
 WHERE status = 'paused'
   AND name IN (
     $ba$Boss assessment — send the Group Practice Self-Assessment$ba$,
     $ba$Form is submitted: Boss Assessment → Send an email: You built the team. Now the harder part.$ba$
   );
