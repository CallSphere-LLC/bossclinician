-- Original QA row 136: editable Club invitation for future Practice Prep signups.
-- Saved as draft with paused automation until owner confirms activation.
-- No historical contact enrolment and no email is sent by migration.
-- The existing immediate training-access email remains separate.
DO $migration$
DECLARE
  sequence_id_new integer;
  signup_form_id integer;
  club_offer_id integer;
  automation_id_new integer;
BEGIN
  SELECT id INTO signup_form_id FROM forms WHERE slug='practicepreptraining';
  SELECT id INTO club_offer_id FROM offers WHERE slug='the-club';
  IF signup_form_id IS NULL OR club_offer_id IS NULL THEN
    RAISE EXCEPTION 'Practice Prep form and Club offer are required';
  END IF;
  -- Preserve any subsequent admin edits and avoid duplicate automations on rerun.
  IF EXISTS (SELECT 1 FROM email_sequences WHERE slug='practice-prep-to-the-club') THEN
    RETURN;
  END IF;
  INSERT INTO email_sequences
    (name,slug,description,status,topic,timezone,use_contact_timezone,
     exit_on_purchase,allow_reentry)
  VALUES
    ('Practice Prep Training → The Club','practice-prep-to-the-club',
     'Five follow-up emails for new Practice Prep Training signups, on days 1, 2, 4, 6 and 8. The immediate training-access email is separate. Stops on a Club purchase. No historical enrolment.',
     'draft','marketing','America/Los_Angeles',true,false,false)
  RETURNING id INTO sequence_id_new;

  INSERT INTO sequence_emails
    (sequence_id,position,delay_minutes,subject,preview_text,body_md,from_name)
  VALUES
  (sequence_id_new,1,1440,'Your next step after Practice Prep',
   'Choose one decision to move forward this week.',
   $body$Hi {{firstName}},

Have you had a chance to watch the free Practice Prep Training?

[Watch the training](https://bossclinician.callsphere.site/preparing-for-pp-video)

As you watch, write down one decision you want to make about your practice. It might be where to start, how to plan your time, or what you need to understand before leaving agency or platform work.

You do not have to make every decision today. Start with one clear next step.

If you want structure and support as you work through those decisions, [explore The Club](https://bossclinician.callsphere.site/club). It is a six-month coaching program for clinicians building a private practice.

To your next step,
Yvette
$body$,'Yvette at Boss Clinician'),
  (sequence_id_new,2,1440,'A practice plan that fits your life',
   'Start with the time and capacity you actually have.',
   $body$Hi {{firstName}},

Before you add another task to your practice-building list, pause and ask:

- How much time can I consistently set aside each week?
- Which decision is holding up my next step?
- What support would help me follow through?

A plan is more useful when it fits your current responsibilities. Choose a manageable block of time and one task you can finish in it.

Inside The Club, the Boss Move program, planning tools, coaching calls and community help you turn the next step into a practical plan.

[See what is included in The Club](https://bossclinician.callsphere.site/club)

Yvette
$body$,'Yvette at Boss Clinician'),
  (sequence_id_new,3,2880,'You do not have to figure out every step alone',
   'A place to bring the questions that come up as you build.',
   $body$Hi {{firstName}},

Watching a training can give you ideas. Applying those ideas often brings new questions.

Which task comes first? What needs attention now? How do I make a plan I can keep using?

The Club combines the Boss Move curriculum with two live coaching calls per month and a community of clinicians building their practices. You can bring your questions and work through the next stage with support.

It is business education and coaching, and it does not promise a particular income or replace legal, tax or clinical advice.

[Take a look inside The Club](https://bossclinician.callsphere.site/club)

Yvette
$body$,'Yvette at Boss Clinician'),
  (sequence_id_new,4,2880,'Is The Club the right next step for you?',
   'Consider the support, commitment and fit before you join.',
   $body$Hi {{firstName}},

The Club may be a fit if you want a structured six-month program while you build your private practice and are ready to make time to apply what you learn.

You will find the Boss Move curriculum, coaching calls, community support, templates and the First 30 Days Success Planner.

Before enrolling, review the program details, payment options and enrollment terms so you can decide whether the commitment works for you.

[Review The Club and its current enrollment options](https://bossclinician.callsphere.site/club)

Have a question about fit? Reply to this email.

Yvette
$body$,'Yvette at Boss Clinician'),
  (sequence_id_new,5,2880,'Ready to turn your practice plan into action?',
   'Your invitation to continue with The Club.',
   $body$Hi {{firstName}},

This is the last email in your Practice Prep follow-up series.

If the training helped you see what you want to build, choose one step you can take this week. A small, deliberate action can help you learn what to do next.

If you would like ongoing structure, coaching and community as you build, you are invited to join The Club.

[Explore The Club](https://bossclinician.callsphere.site/club)

[Review enrollment and payment options](https://bossclinician.callsphere.site/club/checkout)

If now is not the right time, you can still return to [your free training](https://bossclinician.callsphere.site/preparing-for-pp-video).

Yvette
$body$,'Yvette at Boss Clinician');

  INSERT INTO sequence_exclude_offers(sequence_id,offer_id)
  VALUES(sequence_id_new,club_offer_id);
  INSERT INTO automations(name,description,trigger_type,trigger_config,conditions,status)
  VALUES('Practice Prep Training → The Club',
    'Starts the Club follow-up sequence for future Practice Prep form submissions. Existing Club owners are excluded; repeat submissions do not restart the sequence.',
    'form_submitted',jsonb_build_object('formId',signup_form_id),
    jsonb_build_object('match','all','rules',jsonb_build_array(
      jsonb_build_object('field','owns_offer','op','not_has','value',club_offer_id))),
    'paused')
  RETURNING id INTO automation_id_new;
  INSERT INTO automation_actions(automation_id,action_type,config,sort)
  VALUES(automation_id_new,'subscribe_sequence',jsonb_build_object('sequenceId',sequence_id_new),0);
END
$migration$;
