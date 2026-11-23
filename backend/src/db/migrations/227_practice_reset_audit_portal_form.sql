-- 23 Nov 2026 — Yvette item 9: "Keep The Practice Reset Intensive and The
-- Practice Reset Audit. Do not swap this audit for the Freedom Audit. Please
-- recreate the existing audit questions as a form inside the customer portal and
-- replace the Google Form link in the welcome email."
--
-- Source: her Google Form https://forms.gle/D8jdqUwvUPztB5G46 ("Boss Clinician Practice Reset Audit"),
-- 42 questions in 6 sections, copied verbatim (the form marks none required).
-- Section titles ride as helpText on each section's first question; the one
-- "Other (please describe)" choice gets a free-text follow-up, as Google did.
--
-- Placement: course 15 "Practice Reset Intensive" (workbook course of coaching
-- product 10, migration 120) had no modules; this adds module "Start Here" and a
-- published lesson `practice-reset-audit` carrying tool_key
-- 'form-practice-reset-audit', so the programme opens as a course in /library and
-- only holders of product 10 can reach the form (services/lessonForms.ts).
-- Admin → Forms edits the questions and lists submissions; empty notify_emails =
-- owner gets each reply (services/formNotifications.ts).
-- Welcome email 1507 (sequence 462): only the exact Google link changes.
-- Nothing is sent, enrolled or granted. Re-running is a no-op.
DO $migration$
DECLARE
  mod_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = 15 AND slug = 'practice-reset-intensive') THEN
    RETURN;
  END IF;

  INSERT INTO forms (slug, name, description_md, fields, submit_label, success_message,
                     create_lead, published, notify_on_submit, notify_emails)
  VALUES (
    'practice-reset-audit',
    $t$Boss Clinician Practice Reset Audit$t$,
    $t$Welcome to the Boss Clinician Practice Foundations Audit. This is a deep, honest mirror. Your answers will shape everything we do together over the next 3 months. Set aside 45–60 minutes and answer every question with full honesty.$t$,
    $fields$[
  {
    "key": "full_name_and_credentials_e_g_jane_smith_lcsw",
    "label": "Full name and credentials (e.g., Jane Smith, LCSW)",
    "type": "text",
    "required": false,
    "helpText": "Section: Who You Are Right Now"
  },
  {
    "key": "what_state_s_are_you_licensed_in",
    "label": "What state(s) are you licensed in?",
    "type": "text",
    "required": false
  },
  {
    "key": "how_long_have_you_been_licensed",
    "label": "How long have you been licensed?",
    "type": "radio",
    "required": false,
    "options": [
      "Less than 1 year",
      "1–2 years",
      "3–5 years",
      "6–10 years",
      "10+ years"
    ]
  },
  {
    "key": "what_is_your_current_work_situation",
    "label": "What is your current work situation?",
    "type": "radio",
    "required": false,
    "options": [
      "I'm still at an agency or group practice — private practice doesn't exist yet",
      "I have a private practice but I'm also working another job",
      "I'm fully in private practice (solo)",
      "Other (please describe)"
    ]
  },
  {
    "key": "what_is_your_current_work_situation_other",
    "label": "If you chose Other, please describe",
    "type": "text",
    "required": false
  },
  {
    "key": "if_you_re_still_at_an_agency_or_another_job_what_i",
    "label": "If you're still at an agency or another job, what is keeping you from going full-time in private practice? Be specific — fear, money, time, uncertainty?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "describe_your_private_practice_right_now_in_one_ho",
    "label": "Describe your private practice right now in one honest paragraph. Not what you wish it was — what it actually is today.",
    "type": "textarea",
    "required": false
  },
  {
    "key": "how_many_clients_are_you_currently_seeing_per_week",
    "label": "How many clients are you currently seeing per week?",
    "type": "text",
    "required": false,
    "helpText": "Section: Your Clients & Caseload"
  },
  {
    "key": "what_does_your_ideal_weekly_caseload_look_like_how",
    "label": "What does your ideal weekly caseload look like? How many clients, at what frequency?",
    "type": "text",
    "required": false
  },
  {
    "key": "how_are_clients_currently_finding_you_select_all_t",
    "label": "How are clients currently finding you? (Select all that apply)",
    "type": "checkboxes",
    "required": false,
    "options": [
      "Psychology Today",
      "Therapist.com or similar directory",
      "Google search / my website",
      "Word of mouth / referrals",
      "Insurance panel",
      "Social media",
      "I don't have consistent referrals coming in",
      "Other"
    ]
  },
  {
    "key": "do_you_have_a_clear_defined_ideal_client_someone_y",
    "label": "Do you have a clear, defined ideal client — someone you light up to work with?",
    "type": "radio",
    "required": false,
    "options": [
      "Yes, I know exactly who I serve",
      "I have a general idea but it's not specific",
      "No, I take whoever comes"
    ]
  },
  {
    "key": "if_you_answered_yes_or_somewhat_describe_your_idea",
    "label": "If you answered yes or somewhat — describe your ideal client in detail. Who are they, what do they struggle with, what do they need from you?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_is_standing_between_you_and_a_full_caseload_o",
    "label": "What is standing between you and a full caseload of ideal clients right now?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "have_you_ever_turned_down_a_client_because_they_we",
    "label": "Have you ever turned down a client because they weren't the right fit?",
    "type": "radio",
    "required": false,
    "options": [
      "Yes, regularly",
      "Yes, but I felt guilty about it",
      "No, I feel like I can't afford to say no",
      "No, I take everyone"
    ]
  },
  {
    "key": "why_did_you_answer_the_way_you_did_above_what_does",
    "label": "Why did you answer the way you did above? What does that reveal about where you are in your CEO identity?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_is_your_current_average_monthly_revenue_from",
    "label": "What is your current average monthly revenue from your practice?",
    "type": "select",
    "required": false,
    "options": [
      "$0 — I haven't started yet",
      "Under $1,000/month",
      "$1,000–$3,000/month",
      "$3,000–$5,000/month",
      "$5,000–$8,000/month",
      "$8,000+/month"
    ],
    "helpText": "Section: Your Money"
  },
  {
    "key": "what_is_your_current_session_rate",
    "label": "What is your current session rate?",
    "type": "text",
    "required": false
  },
  {
    "key": "do_you_accept_insurance",
    "label": "Do you accept insurance?",
    "type": "radio",
    "required": false,
    "options": [
      "Yes, primarily insurance",
      "Mix of insurance and private pay",
      "Private pay only",
      "I'm not sure yet"
    ]
  },
  {
    "key": "how_did_you_arrive_at_your_current_rate_was_it_str",
    "label": "How did you arrive at your current rate? Was it strategic or did you just pick a number?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "when_you_think_about_raising_your_rates_what_comes",
    "label": "When you think about raising your rates, what comes up emotionally? Be honest — guilt, fear, worthiness issues?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_is_your_target_monthly_income_from_your_pract",
    "label": "What is your target monthly income from your practice? Not what feels \"realistic\" right now — what do you actually want?",
    "type": "text",
    "required": false
  },
  {
    "key": "do_you_currently_track_your_revenue_expenses_and_p",
    "label": "Do you currently track your revenue, expenses, and profit monthly?",
    "type": "radio",
    "required": false,
    "options": [
      "Yes, I have a system for this",
      "I do it sometimes but not consistently",
      "No, I avoid looking at the numbers",
      "I don't even know what my profit is"
    ]
  },
  {
    "key": "what_is_your_relationship_with_money_like_honestly",
    "label": "What is your relationship with money like, honestly? Does money feel safe, scary, complicated? Where does that come from?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_ehr_electronic_health_record_system_are_you_u",
    "label": "What EHR (Electronic Health Record) system are you using? (or \"None yet\")",
    "type": "text",
    "required": false,
    "helpText": "Section: Your Systems & Structure"
  },
  {
    "key": "do_you_have_a_private_practice_website",
    "label": "Do you have a private practice website?",
    "type": "radio",
    "required": false,
    "options": [
      "Yes, and it clearly communicates who I serve and how to book",
      "Yes, but it needs work",
      "No"
    ]
  },
  {
    "key": "how_does_a_new_client_currently_go_from_first_cont",
    "label": "How does a new client currently go from first contact to their first session? Walk me through the exact steps.",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_in_that_process_breaks_down_or_frustrates_you",
    "label": "What in that process breaks down or frustrates you?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "do_you_have_written_policies_for_cancellations_no",
    "label": "Do you have written policies for cancellations, no-shows, and late payments?",
    "type": "radio",
    "required": false,
    "options": [
      "Yes, clients sign them",
      "I have something but I don't enforce it consistently",
      "No"
    ]
  },
  {
    "key": "what_happens_in_your_practice_when_you_take_a_day",
    "label": "What happens in your practice when you take a day off?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "be_honest_is_your_practice_currently_running_you_o",
    "label": "Be honest — is your practice currently running you, or are you running your practice?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_made_you_want_to_go_into_private_practice_in",
    "label": "What made you want to go into private practice in the first place? What was the original dream?",
    "type": "textarea",
    "required": false,
    "helpText": "Section: Your Mindset & Identity"
  },
  {
    "key": "how_far_is_your_current_reality_from_that_original",
    "label": "How far is your current reality from that original dream? What has gotten in the way?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "do_you_feel_like_a_ceo_or_do_you_still_feel_primar",
    "label": "Do you feel like a CEO, or do you still feel primarily like a clinician who happens to have a business?",
    "type": "radio",
    "required": false,
    "options": [
      "I feel fully like a CEO",
      "I'm somewhere in between",
      "Mostly clinician — the business side feels foreign or uncomfortable"
    ]
  },
  {
    "key": "what_does_ceo_identity_mean_to_you_and_what_would",
    "label": "What does \"CEO identity\" mean to you, and what would have to shift for you to step into it fully?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_is_the_story_you_tell_yourself_about_why_your",
    "label": "What is the story you tell yourself about why your practice isn't further along?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "is_that_story_true_or_is_it_a_protection_mechanism",
    "label": "Is that story true? Or is it a protection mechanism?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_are_you_most_afraid_of_when_it_comes_to_build",
    "label": "What are you most afraid of when it comes to building a profitable private practice?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_would_it_mean_for_your_life_your_family_your",
    "label": "What would it mean for your life — your family, your freedom, your sense of self — if you built the practice you actually want?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_are_the_top_3_outcomes_you_want_from_this_pro",
    "label": "What are the top 3 outcomes you want from this program? Be specific — not \"grow my practice\" but what that actually means for you.",
    "type": "textarea",
    "required": false,
    "helpText": "Section: Your Goals For Our 3 Months Together"
  },
  {
    "key": "what_would_make_you_say_at_the_end_of_3_months_tha",
    "label": "What would make you say, at the end of 3 months, that this was absolutely worth every dollar?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_tends_to_get_in_the_way_when_you_invest_in_yo",
    "label": "What tends to get in the way when you invest in yourself or your business? What pattern shows up?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "what_do_you_need_from_me_as_your_strategist_to_get",
    "label": "What do you need from me as your strategist to get the most out of this?",
    "type": "textarea",
    "required": false
  },
  {
    "key": "is_there_anything_else_you_want_me_to_know_about_y",
    "label": "Is there anything else you want me to know about you, your practice, or your life that will help me support you better?",
    "type": "textarea",
    "required": false
  }
]$fields$::jsonb,
    'Submit my audit',
    'Thank you. Your Practice Reset Audit has been received. You can now schedule your first coaching call in your portal.',
    false, true, true, ''
  )
  ON CONFLICT (slug) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM course_lessons WHERE tool_key = 'form-practice-reset-audit') THEN
    SELECT id INTO mod_id FROM course_modules WHERE course_id = 15 AND title = 'Start Here' ORDER BY id LIMIT 1;
    IF mod_id IS NULL THEN
      INSERT INTO course_modules (course_id, title, sort) VALUES (15, 'Start Here', 0)
      RETURNING id INTO mod_id;
    END IF;
    INSERT INTO course_lessons (module_id, title, slug, body_md, published, sort, tool_key)
    VALUES (mod_id, 'Practice Reset Audit', 'practice-reset-audit',
      $b$This assessment is the foundation of our work together. It gives me a clear picture of where you are right now and where you want to be, so I can build your customized 90-day plan.

Set aside 45–60 minutes and answer every question with full honesty. This is for *you*.$b$,
      true, 0, 'form-practice-reset-audit');
  END IF;

  UPDATE sequence_emails
     SET body_md = replace(body_md, 'https://forms.gle/D8jdqUwvUPztB5G46', 'https://www.bossclinician.com/library/practice-reset-intensive/lessons/practice-reset-audit'),
         updated_at = now()
   WHERE id = 1507 AND position('https://forms.gle/D8jdqUwvUPztB5G46' in body_md) > 0;
END
$migration$;
