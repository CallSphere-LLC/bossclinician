-- New completions only; no enrollment or sending during migration.
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS sales_family text;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS sales_start_position integer NOT NULL DEFAULT 0;
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS completion_anchored boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS quiz_followup_state (
 contact_id integer PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
 practice_stage text CHECK(practice_stage IN ('not_launched','first_hire','existing_team')),
 hiring_slug text, hiring_completed_at timestamptz, assessment_completed_at timestamptz,
 active_sequence_id integer REFERENCES email_sequences(id), review_reason text,
 last_sales_sent_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO email_sequences(name,slug,status,topic,skip_weekends,use_contact_timezone,timezone,exit_on_purchase,allow_reentry,sales_family,completion_anchored) VALUES ('Hiring quiz: Ready followup','quiz-hiring-ready','active','marketing',false,false,'America/Los_Angeles',false,false,'hiring',true) ON CONFLICT(slug) DO NOTHING;
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,1,1440,$quiz$Before you write the job post$quiz$,$quiz$What’s the part you’re still trying to figure out?$quiz$,$quiz$Hey!

Now that you’ve started thinking about the role you want to create, what’s the next question that comes up?

Maybe it’s, “How do I know what I can afford to pay?”

Or, “When am I going to train someone if I’m still seeing clients all day?”

Or even, “What if I hire someone and realize I’ve created more work for myself?”

Those questions deserve attention before you write an offer.

Try separating what you know from what you’re assuming.

“I get inquiries every week” is useful. “There will be enough of the right inquiries for this person’s schedule and specialty” is something to look at more closely.

You don’t have to answer every question at once. Start with the one that’s holding up your next decision.

What is that question for you? Hit reply and tell me.

Yvette$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-ready' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=1);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,2,4320,$quiz$I had a team—and another job$quiz$,$quiz$More clinicians didn’t automatically change my workload.$quiz$,$quiz$Hey!

When I started hiring, I wanted to pay people fairly.

I hired contractors because that’s what I saw other practices doing. But I hadn’t fully worked through how the arrangement, expenses, and responsibilities would fit the business I wanted to build.

My team grew.

I was still seeing 25–30 clients a week.

And sometimes, I took another job.

I kept wondering when having a team was supposed to make a difference in what I could pay myself—or how much I had to work.

I didn’t feel comfortable stepping back. Working more felt safer than depending on a business I didn’t fully understand yet.

Looking back, I wish I’d asked more questions about what the practice needed to support the team AND me.

That experience shapes the planning I do with owners inside The Boardroom.

Before you make your next hiring decision, ask yourself:

“What am I expecting this hire to change for me—and have I worked out how that change would actually happen?”

Write down your answer. If there’s a gap between the goal and the plan, that’s a useful place to focus next.

Yvette$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-ready' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=2);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,3,7200,$quiz$Let me show you inside The Boardroom$quiz$,$quiz$A quick look at what working together could look like.$quiz$,$quiz$Hey!

I wanted to show you a little of what working together inside The Boardroom could look like.

You’ve already been thinking about your next hire. This is where we can sit down with the details—what you can offer, what the role needs to cover, and how you’ll support someone as they settle in.

I recorded a short walkthrough so you can see how we bring the numbers, team plans, and leadership decisions together.

[Take a peek inside The Boardroom]([BOARDROOM_WALKTHROUGH_URL] "button")

One thing I wish I’d understood earlier: having someone on the team doesn’t automatically mean there’s less on your plate. You still need to be clear about what you’re handing off and what they need from you.

Take a peek. It’ll give you a better feel for the support before you decide whether to apply.

Yvette

[Take a peek inside The Boardroom]([BOARDROOM_WALKTHROUGH_URL] "button")$quiz$,false FROM email_sequences WHERE slug='quiz-hiring-ready' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=3);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,4,11520,$quiz$“I want to give them a good place to work”$quiz$,$quiz$Start with what you can consistently follow through on.$quiz$,$quiz$Hey!

You want to offer fair pay. You want your clinician to feel supported. And you don’t want them leaving work feeling the way you used to feel at your agency.

I get that.

But you can care deeply about your future team and still need to ask, “What can this practice actually sustain?”

Before promising a compensation package, look at what the role will cost, what income you can reasonably plan around, and what happens during a slower start.

Then look at the working experience you’re offering: clear expectations, realistic responsibilities, and support you can follow through on.

Check which employment requirements apply with qualified HR or legal support. We can work on the business planning around those obligations inside The Boardroom.

The goal is an offer you can stand behind without quietly making your own pay the thing that disappears whenever the numbers get tight.

Yvette

[Plan the business side of my next hire](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-ready' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=4);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,5,15840,$quiz$You can bring the unfinished plan$quiz$,$quiz$Your questions are part of the work.$quiz$,$quiz$Hey!

Maybe you’ve opened a hiring spreadsheet, started filling it out, and thought, “I’m not even sure these are the right numbers.”

Or you’ve written half a job description and stopped because you don’t know what support you can realistically provide.

You don’t need a polished plan to have a useful conversation about it.

You do need to be willing to look at the business honestly and work through the decisions.

The Boardroom brings planning tools and conversations with me into that process. You can bring a specific decision, look at the options, and leave with a clearer next step to implement.

It’s a mastermind where you do the work in your practice. I’m not taking over your hiring or operations.

If you want support thinking through the plan before you commit to it, you can read about the experience and apply below.

Yvette

[Learn more and apply for The Boardroom](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-ready' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=5);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,6,20160,$quiz$What’s the next decision you want help making?$quiz$,$quiz$You don’t need to rush a hire to keep moving forward.$quiz$,$quiz$Hey!

As we wrap up this little series, think about the decision that’s still sitting in front of you.

What can I offer?
Which role makes sense first?
What needs to be ready before someone starts?
How do I make room to lead while I’m still seeing clients?

You can be serious about growing and still want someone to help you think through the details.

If your practice is established and you’re actively preparing to hire, The Boardroom may be the right place for that work.

The next step is an application, followed by a fit conversation before an invitation. Applying gives us a chance to look at whether the support matches what you need.

No pressure to hire on someone else’s timeline. Let’s work toward a decision you understand and can support.

Yvette

[Learn more and apply for The Boardroom](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-ready' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=6);
INSERT INTO email_sequences(name,slug,status,topic,skip_weekends,use_contact_timezone,timezone,exit_on_purchase,allow_reentry,sales_family,completion_anchored) VALUES ('Hiring quiz: Almost Ready followup','quiz-hiring-almost','active','marketing',false,false,'America/Los_Angeles',false,false,'hiring',true) ON CONFLICT(slug) DO NOTHING;
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,1,1440,$quiz$Before you write the job post$quiz$,$quiz$What’s the part you’re still trying to figure out?$quiz$,$quiz$Hey!

When you looked at the part of your hiring plan you felt least certain about, what question kept coming up?

Maybe it’s, “How do I know what I can afford to pay?”

Or, “When am I going to train someone if I’m still seeing clients all day?”

Or even, “What if I hire someone and realize I’ve created more work for myself?”

Those questions deserve attention before you write an offer.

Try separating what you know from what you’re assuming.

“I get inquiries every week” is useful. “There will be enough of the right inquiries for this person’s schedule and specialty” is something to look at more closely.

You don’t have to answer every question at once. Start with the one that’s holding up your next decision.

What is that question for you? Hit reply and tell me.

Yvette$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-almost' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=1);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,2,4320,$quiz$I had a team—and another job$quiz$,$quiz$More clinicians didn’t automatically change my workload.$quiz$,$quiz$Hey!

When I started hiring, I wanted to pay people fairly.

I hired contractors because that’s what I saw other practices doing. But I hadn’t fully worked through how the arrangement, expenses, and responsibilities would fit the business I wanted to build.

My team grew.

I was still seeing 25–30 clients a week.

And sometimes, I took another job.

I kept wondering when having a team was supposed to make a difference in what I could pay myself—or how much I had to work.

I didn’t feel comfortable stepping back. Working more felt safer than depending on a business I didn’t fully understand yet.

Looking back, I wish I’d asked more questions about what the practice needed to support the team AND me.

That experience shapes the planning I do with owners inside The Boardroom.

Before you make your next hiring decision, ask yourself:

“What am I expecting this hire to change for me—and have I worked out how that change would actually happen?”

Write down your answer. If there’s a gap between the goal and the plan, that’s a useful place to focus next.

Yvette$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-almost' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=2);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,3,7200,$quiz$Let me show you inside The Boardroom$quiz$,$quiz$A quick look at what working together could look like.$quiz$,$quiz$Hey!

I wanted to show you a little of what working together inside The Boardroom could look like.

You’ve already been thinking about your next hire. This is where we can sit down with the details—what you can offer, what the role needs to cover, and how you’ll support someone as they settle in.

I recorded a short walkthrough so you can see how we bring the numbers, team plans, and leadership decisions together.

[Take a peek inside The Boardroom]([BOARDROOM_WALKTHROUGH_URL] "button")

One thing I wish I’d understood earlier: having someone on the team doesn’t automatically mean there’s less on your plate. You still need to be clear about what you’re handing off and what they need from you.

Take a peek. It’ll give you a better feel for the support before you decide whether to apply.

Yvette

[Take a peek inside The Boardroom]([BOARDROOM_WALKTHROUGH_URL] "button")$quiz$,false FROM email_sequences WHERE slug='quiz-hiring-almost' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=3);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,4,11520,$quiz$“I want to give them a good place to work”$quiz$,$quiz$Start with what you can consistently follow through on.$quiz$,$quiz$Hey!

You want to offer fair pay. You want your clinician to feel supported. And you don’t want them leaving work feeling the way you used to feel at your agency.

I get that.

But you can care deeply about your future team and still need to ask, “What can this practice actually sustain?”

Before promising a compensation package, look at what the role will cost, what income you can reasonably plan around, and what happens during a slower start.

Then look at the working experience you’re offering: clear expectations, realistic responsibilities, and support you can follow through on.

Check which employment requirements apply with qualified HR or legal support. We can work on the business planning around those obligations inside The Boardroom.

The goal is an offer you can stand behind without quietly making your own pay the thing that disappears whenever the numbers get tight.

Yvette

[Plan the business side of my next hire](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-almost' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=4);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,5,15840,$quiz$You can bring the unfinished plan$quiz$,$quiz$Your questions are part of the work.$quiz$,$quiz$Hey!

Maybe you’ve opened a hiring spreadsheet, started filling it out, and thought, “I’m not even sure these are the right numbers.”

Or you’ve written half a job description and stopped because you don’t know what support you can realistically provide.

You don’t need a polished plan to have a useful conversation about it.

You do need to be willing to look at the business honestly and work through the decisions.

The Boardroom brings planning tools and conversations with me into that process. You can bring a specific decision, look at the options, and leave with a clearer next step to implement.

It’s a mastermind where you do the work in your practice. I’m not taking over your hiring or operations.

If you want support thinking through the plan before you commit to it, you can read about the experience and apply below.

Yvette

[Learn more and apply for The Boardroom](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-almost' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=5);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,6,20160,$quiz$What’s the next decision you want help making?$quiz$,$quiz$You don’t need to rush a hire to keep moving forward.$quiz$,$quiz$Hey!

As we wrap up this little series, think about the decision that’s still sitting in front of you.

What can I offer?
Which role makes sense first?
What needs to be ready before someone starts?
How do I make room to lead while I’m still seeing clients?

You can be serious about growing and still want someone to help you think through the details.

If your practice is established and you’re actively preparing to hire, The Boardroom may be the right place for that work.

The next step is an application, followed by a fit conversation before an invitation. Applying gives us a chance to look at whether the support matches what you need.

No pressure to hire on someone else’s timeline. Let’s work toward a decision you understand and can support.

Yvette

[Learn more and apply for The Boardroom](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-almost' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=6);
INSERT INTO email_sequences(name,slug,status,topic,skip_weekends,use_contact_timezone,timezone,exit_on_purchase,allow_reentry,sales_family,completion_anchored) VALUES ('Hiring quiz: Not Yet followup','quiz-hiring-not-yet','active','marketing',false,false,'America/Los_Angeles',false,false,'hiring',true) ON CONFLICT(slug) DO NOTHING;
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,1,2880,$quiz$You can still want a team$quiz$,$quiz$Let’s separate that goal from what needs relief right now.$quiz$,$quiz$Hey!

I don’t want your quiz result to turn into “I guess I’m not cut out for this.”

You can still want a group practice.

But if the current practice already leaves you guessing about your pay or doing admin late at night, it helps to understand that pressure before adding another clinician.

Try finishing this sentence:

“I’m hoping hiring will help me stop ______.”

If the answer is seeing every client yourself, there’s a clinical-capacity question to work through.

If it’s chasing payments, answering scheduling messages, or being unable to take a day off, those details may point toward a different first step.

The Freedom Masterclass walks you through looking at the practice you already have so you can choose the change that fits what you actually need.

Yvette

[Watch the free Freedom Masterclass](https://www.bossclinician.com/freedom-masterclass "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-not-yet' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=1);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,2,7200,$quiz$A full calendar wouldn’t answer this$quiz$,$quiz$What can your practice consistently support?$quiz$,$quiz$Hey!

It’s easy to think, “Once I’m completely booked, I’ll be ready.”

But a full calendar doesn’t tell you what the practice keeps after expenses, what you can pay yourself, or how much unpaid work you’re doing between appointments.

Start with what’s actually happening.

What was collected last month?
What did it cost to run the practice?
What did you pay yourself?
How many hours did you work outside sessions?

Put those answers together in one place. Notice which number you know and which one you’ve been guessing at.

You’re looking for a clearer starting point, not a reason to criticize yourself.

If you’d like help thinking through how your current practice supports your income and time, start with the free Freedom Masterclass. The included Practice Freedom Audit can help you choose where to focus.

Yvette

[Watch the free Freedom Masterclass](https://www.bossclinician.com/freedom-masterclass "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-not-yet' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=2);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,3,12960,$quiz$What would make next month feel more manageable?$quiz$,$quiz$Let’s choose one useful place to start.$quiz$,$quiz$Hey!

Maybe it’s knowing what you can pay yourself without checking the bank account three times.

Maybe it’s getting billing out of your evenings.

Maybe it’s understanding where your next inquiries are coming from.

Choose one.

You don’t have to rebuild every part of your practice at once to make progress toward the business you want.

Inside The Lounge, the work is looking at your current model and choosing a practical priority for your income, time, and capacity. Hiring can stay part of your longer-term plan.

For now, let’s make sure the practice you’re growing from has room to support you.

If that’s the kind of help you need, you can take a closer look below.

Yvette

[Take a look inside The Lounge](https://www.bossclinician.com/lounge "button")$quiz$,true FROM email_sequences WHERE slug='quiz-hiring-not-yet' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=3);
INSERT INTO email_sequences(name,slug,status,topic,skip_weekends,use_contact_timezone,timezone,exit_on_purchase,allow_reentry,sales_family,completion_anchored) VALUES ('Group practice assessment followup','quiz-assessment-followup','active','marketing',false,false,'America/Los_Angeles',false,false,'assessment',true) ON CONFLICT(slug) DO NOTHING;
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,1,1440,$quiz$“I’ll just answer it really quick”$quiz$,$quiz$What happens when that becomes your whole day?$quiz$,$quiz$Hey!

You finish a session, check your phone, and there it is.

A scheduling question.
A billing issue.
A decision someone is waiting on you to make.

None of it looks huge by itself. But by the end of the day, the time you planned to spend on the business has gone into keeping it moving.

If that feels familiar, look at one question that keeps returning to you.

Does the person need a clear process?
Do they know they’re allowed to decide?
Or is the responsibility still yours because it was never clearly handed over?

Those are different situations. “Delegate more” doesn’t tell you which one you’re dealing with.

Think of one real example from this week. What did someone need from you, and what would have helped them handle it appropriately?

Hit reply and tell me what keeps coming back to your plate.

Yvette$quiz$,true FROM email_sequences WHERE slug='quiz-assessment-followup' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=1);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,2,4320,$quiz$I had to stop being the backup for everything$quiz$,$quiz$Hiring people and sharing responsibility weren’t the same thing.$quiz$,$quiz$Hey!

For a long time, having a team didn’t mean I felt comfortable stepping back.

I was still carrying a heavy caseload and trying to stay on top of what everyone needed.

One of the changes that helped me was developing leadership from within my practice. I brought people into clinical supervisor, clinical manager, and team lead roles.

That gave us a way to share responsibilities I had been carrying—and gave me more room to focus on Boss Clinician.

It wasn’t simply adding titles. I had to think about what each role would own and how I would support the people in it.

Your next step may look different. You might need to clarify one existing responsibility before creating another position.

This is part of the leadership work I care about inside The Boardroom: helping the practice operate without every routine decision depending on the owner.

For today, choose one task you’ve handed off that still regularly comes back to you.

What’s missing: a clear owner, a process, training, or an agreed boundary for when to involve you?

That answer gives you somewhere practical to start.

Yvette$quiz$,true FROM email_sequences WHERE slug='quiz-assessment-followup' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=2);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,3,7200,$quiz$Here’s what working together could look like$quiz$,$quiz$Come take a quick look inside The Boardroom.$quiz$,$quiz$Hey!

Now that you’ve had a chance to look at your assessment, I wanted to show you how we can work through your next steps inside The Boardroom.

Maybe there’s a responsibility you’re ready to hand off, a role you need to clarify, or a staffing decision you want another set of eyes on.

Those are the kinds of things you can bring to our work together.

I recorded a short walkthrough so you can see how we connect the numbers, team responsibilities, and your role as the owner.

[Take a peek inside The Boardroom]([BOARDROOM_WALKTHROUGH_URL] "button")

I remember having a team and still feeling like I needed to be involved in everything. Learning how to lead, delegate, and give people clear responsibilities was a big part of changing that.

Take a look so you can get a feel for the support and whether it fits the work you want to do next.

Yvette

[Take a peek inside The Boardroom]([BOARDROOM_WALKTHROUGH_URL] "button")$quiz$,false FROM email_sequences WHERE slug='quiz-assessment-followup' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=3);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,4,11520,$quiz$Revenue went up. Did your breathing room?$quiz$,$quiz$More money coming in doesn’t answer every question.$quiz$,$quiz$Hey!

When I had a team and was still seeing 25–30 clients a week, I kept wondering why growth wasn’t changing what I could pay myself the way I expected.

I didn’t feel secure enough to step back, so I kept working.

That’s why I want you to look beyond the amount coming into the practice.

What is it costing to produce that revenue?
What responsibilities are you still doing?
What would it cost to support those responsibilities another way?
And what are you consistently able to pay yourself?

Sometimes the next useful move is improving how the current team and practice operate before adding another role.

Inside The Boardroom, we connect those numbers to decisions about staffing, responsibilities, and your workload.

The point is to understand what growth is doing for the business—and for you.

Yvette

[Look at the decisions we work through together](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-assessment-followup' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=4);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,5,15840,$quiz$“I don’t have time for another program”$quiz$,$quiz$You need help with the practice you’re already running.$quiz$,$quiz$Hey!

If your first thought is, “When would I even do this?” I understand.

You have clients, a team, and decisions waiting on you. Adding another commitment needs to make sense.

Before you consider The Boardroom, name the work you actually need support with.

Maybe it’s deciding whether another hire is affordable.
Maybe it’s clarifying a leadership role.
Maybe it’s creating coverage so a day away doesn’t turn into a day answering messages.

Bring that decision into the conversation.

The Boardroom is a 12-month mastermind with working sessions, private strategy time, and support for implementation. It still takes your time and participation; it isn’t someone taking over your operations.

You should be able to see how the commitment connects to a real priority in your practice. The application and fit conversation help us explore that before an invitation.

Yvette

[Review The Boardroom and apply](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-assessment-followup' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=5);
INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,preview_text,body_md,enabled) SELECT id,6,20160,$quiz$Let’s choose what stops landing on your plate$quiz$,$quiz$Your assessment can become a starting point for action.$quiz$,$quiz$Hey!

You took the assessment because you wanted a clearer look at how your practice is running.

Now think about the change you’d most like to feel in an ordinary week.

A team member handling a routine decision without waiting on you.
Knowing what you can pay yourself.
An onboarding process that doesn’t require you to explain every step.
An afternoon away without checking in constantly.

Choose the one that matters most right now.

If you want support working through the decisions behind it, I’d love for you to take a look at The Boardroom.

You can start with the application. From there, we have a fit conversation before an invitation, so we can understand what you’re working toward and whether this is the right support.

You’ve already built the practice. Let’s work on how it runs—and the role you want to have in it.

Yvette

[Learn more and apply for The Boardroom](https://www.bossclinician.com/boardroom "button")$quiz$,true FROM email_sequences WHERE slug='quiz-assessment-followup' AND NOT EXISTS(SELECT 1 FROM sequence_emails WHERE sequence_id=email_sequences.id AND position=6);
-- Mark only established sales nurture, never paid onboarding or bonus reminders.
UPDATE email_sequences SET sales_family=CASE WHEN slug='practice-prep-to-the-club' THEN 'club' ELSE 'masterclass' END WHERE slug IN ('masterclass-invite-emails','maxed-out-masterclass','practice-prep-to-the-club') AND sales_family IS NULL;
-- Application ends Boardroom invitations; a real free-training registration ends Not Yet.
INSERT INTO sequence_exclude_forms(sequence_id,form_id)
SELECT q.id,f.id FROM email_sequences q CROSS JOIN forms f
WHERE ((q.slug IN ('quiz-hiring-ready','quiz-hiring-almost','quiz-assessment-followup') AND f.slug='boardroom-application') OR (q.slug='quiz-hiring-not-yet' AND f.slug='freedom-masterclass'))
ON CONFLICT DO NOTHING;
INSERT INTO sequence_exclude_offers(sequence_id,offer_id)
SELECT q.id,o.id FROM email_sequences q CROSS JOIN offers o
WHERE (q.slug IN ('quiz-hiring-ready','quiz-hiring-almost','quiz-assessment-followup') AND (o.slug ILIKE '%boardroom%')) OR (q.slug='quiz-hiring-not-yet' AND o.slug ILIKE '%lounge%')
ON CONFLICT DO NOTHING;
UPDATE forms SET fields=fields || '[{"key": "practice_stage", "type": "select", "label": "Which describes your practice now?", "options": ["not_launched", "first_hire", "existing_team"], "required": false, "contactField": "practice_stage"}]'::jsonb WHERE slug IN ('hire-form','boss-assessment') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='practice_stage');
UPDATE forms SET fields=fields || '[{"key": "marketing_consent", "type": "checkbox", "label": "Also send me relevant practice-building emails. I can unsubscribe anytime.", "required": false}]'::jsonb WHERE slug IN ('hire-form') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='marketing_consent');

-- These legacy quizzes combine an independently requested result at position 1
-- with later sales nurture. The result remains deliverable; only positions 2+
-- participate in marketing consent, arbitration and daily caps.
UPDATE email_sequences SET sales_family='legacy_quiz',sales_start_position=2
WHERE slug IN ('email-sequence-for-quiz-not-yet-ready','email-sequence-for-quiz-you-re-ready-to-start','email-sequence-for-quiz-you-re-just-about-ready','sequence-4-the-reluctant-ceo','sequence-3-the-steady-grower','sequence-2-the-careful-clinician','sequence-1-the-visionary-builder') AND sales_family IS NULL;

-- H0 automation rows stay active throughout deployment. The new runtime handles
-- only those exact three actions transactionally; the durable action claim stays
-- their single delivery owner. Deploy backend before the new optional-consent UI.
