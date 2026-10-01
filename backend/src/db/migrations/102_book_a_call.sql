-- Book A Call, on our own site.
--
-- Every "Book A Call" on the site (the header pill, the mobile menu, the Work
-- With Me dropdown, the footer, the practice quiz) and the three VIP call links
-- in The Lounge VIP's "Book Your Strategy Calls" lesson sent visitors to
-- tidycal.com/profitwithyvette. This migration brings those call types home:
--
--   book_a_call_types    one row per kind of call, copied from the TidyCal
--                        booking types (title, length, buffer, notice, how far
--                        ahead, the intake questions), fetched 2026-10-01.
--   book_a_call_windows  each type's weekly hours, in Yvette's own zone
--                        (TidyCal's account timezone is America/Los_Angeles and
--                        its windows are wall-clock times in it).
--
-- A booking is an ordinary `coaching_sessions` row with `call_type_id` set and
-- no member: one calendar, so a discovery call and a member's coaching session
-- can never be booked into the same hour, and the admin's sessions list, the
-- contact timeline and the 24h/1h reminder job all see it without new screens.
--
-- Not brought over:
--   * "Clinical Interview Call" (tidycal.com/profitwithyvette/interviewcall) is
--     Brighter Tomorrow's hiring interview, not a Boss Clinician call.
--   * TidyCal's per-date blocks (her week of 1-7 October) and its live
--     calendar-conflict check. Time off goes in Admin -> Availability as a
--     blocked exception, which every call type here honours.
--
-- The two paid sessions (the $650 consultation, the $350 intensive) are stored
-- with their price but `bookable = false`: taking payment needs a checkout
-- offer, and until one exists their pages point people at the complimentary
-- Practice Alignment Call instead of letting a $650 hour be booked for free.

CREATE TABLE IF NOT EXISTS book_a_call_types (
  id                    SERIAL PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  -- The TidyCal path it replaces, so /book-a-call/alignwithyvette still lands.
  legacy_slug           TEXT NOT NULL DEFAULT '',
  title                 TEXT NOT NULL,
  -- One line for the chooser card.
  summary               TEXT NOT NULL DEFAULT '',
  description_md        TEXT NOT NULL DEFAULT '',
  duration_minutes      INT  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  -- Kept clear either side of the call (TidyCal's "padding").
  padding_minutes       INT  NOT NULL DEFAULT 0 CHECK (padding_minutes BETWEEN 0 AND 240),
  slot_interval_minutes INT  NOT NULL DEFAULT 15 CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  -- How soon a call may start after it is booked.
  min_notice_minutes    INT  NOT NULL DEFAULT 1440 CHECK (min_notice_minutes BETWEEN 0 AND 129600),
  -- How far ahead the calendar is open.
  horizon_days          INT  NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 1 AND 365),
  -- At most this many of this call per day; NULL for no limit.
  max_per_day           INT  CHECK (max_per_day IS NULL OR max_per_day > 0),
  -- The zone the day limit is counted in and the owner's notice is written in.
  timezone              TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  price_cents           INT  NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency              TEXT NOT NULL DEFAULT 'usd',
  location_label        TEXT NOT NULL DEFAULT 'Zoom video call',
  -- Where the call happens. Empty means "the link follows by email".
  meeting_url           TEXT NOT NULL DEFAULT '',
  -- [{ id, label, type: text|textarea|radio|checkbox, required, options[] }]
  questions             JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Shown on /book-a-call. Unlisted types are booked from a direct link
  -- (program welcome lessons), exactly as their TidyCal pages were.
  listed                BOOLEAN NOT NULL DEFAULT true,
  featured              BOOLEAN NOT NULL DEFAULT false,
  bookable              BOOLEAN NOT NULL DEFAULT true,
  sort                  INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS book_a_call_windows (
  id            SERIAL PRIMARY KEY,
  call_type_id  INT  NOT NULL REFERENCES book_a_call_types(id) ON DELETE CASCADE,
  -- 0 = Sunday, matching JS getDay() and coach_availability.
  weekday       INT  NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute  INT  NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    INT  NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  timezone      TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  CONSTRAINT book_a_call_window_ends_after_start CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS idx_book_a_call_windows_type ON book_a_call_windows (call_type_id);

ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS call_type_id INT REFERENCES book_a_call_types(id) ON DELETE SET NULL;
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS guest_name   TEXT NOT NULL DEFAULT '';
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS guest_email  TEXT NOT NULL DEFAULT '';
-- [{ id, label, answer }] — the intake answers, as asked.
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS answers      JSONB NOT NULL DEFAULT '[]'::jsonb;
-- The secret in the guest's "manage your booking" link (they have no account).
ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS manage_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coaching_sessions_manage_token
  ON coaching_sessions (manage_token) WHERE manage_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_call_type
  ON coaching_sessions (call_type_id, scheduled_at) WHERE call_type_id IS NOT NULL;

/* ------------------------------------------------------------------ types */

INSERT INTO book_a_call_types
  (slug, legacy_slug, title, summary, description_md, duration_minutes, padding_minutes,
   slot_interval_minutes, min_notice_minutes, horizon_days, max_per_day, price_cents,
   questions, listed, featured, bookable, sort)
VALUES
(
  'practice-alignment-call', 'alignwithyvette', 'Practice Alignment Call',
  'A quick, complimentary call to see where you are and what support fits your next step.',
  $md$This is a quick, complimentary call to talk through where you are in your private practice, what feels stuck or unclear right now, and what kind of support may make the most sense for your next step.

We'll use this time to make sure we're aligned and determine whether my strategy support is the right fit for what you need.

This is a **fit + alignment call**, not a full strategy session. If we're a good match, I'll point you toward the best next step for your practice.

**If a day or time you need isn't available, [send me a note](/contact) and I'll see what I can do to find a time that works for us both.**$md$,
  15, 15, 15, 15, 14, 1, 0,
  $q$[
    {"id": "social", "label": "Instagram Handle or Facebook Handle", "type": "text", "required": false, "options": []},
    {"id": "license", "label": "What is your license type and how long have you been in practice?", "type": "checkbox", "required": true,
     "options": ["LCSW", "LMFT", "LPC", "PMHNP", "0-1 years", "2-3 years", "4-5+ years"]},
    {"id": "status", "label": "What is your current practice status?", "type": "radio", "required": true,
     "options": ["I’m starting my private practice", "I have an existing solo practice and want to grow it", "I’m expanding into a group practice", "I want to rebrand or restructure", "I’m not sure — I need clarity"]},
    {"id": "feeling", "label": "I am currently feeling…", "type": "checkbox", "required": true,
     "options": ["I feel stuck and unsure about my next steps in private practice", "I feel overwhelmed trying to balance clients, life, and business tasks", "I feel underpaid for the work and energy I give", "I feel confident clinically, but not as a business owner", "I feel ready for a major shift in my practice", "I feel excited but need guidance and structure", "I feel burnt out from agency work and want more freedom", "I feel disconnected from my true earning potential"]},
    {"id": "vision", "label": "What do you want your practice to look and feel like in the next 3-6 months?", "type": "checkbox", "required": true,
     "options": ["I want my practice to be profitable and financially stable", "I want my practice to attract aligned, higher-paying clients", "I want my practice to support my lifestyle, not drain me", "I want my practice to feel organized, structured, and sustainable", "I want my practice to grow without burning me out", "I want my practice to reflect who I am as a strong, ambitious woman", "I want my practice to expand into a group practice or bigger vision", "I want my practice to give me more time, freedom, and peace"]},
    {"id": "invest", "label": "If we determine that working together is a good fit, are you open to investing in paid strategy support?", "type": "checkbox", "required": true,
     "options": ["Yes! I am ready to build and scale my private practice!", "Yes, but I need payment plan options", "I’m just exploring right now. Come back when you are ready"]}
  ]$q$::jsonb,
  true, true, true, 10
),
(
  'client-attraction-audit', 'client-audit', 'Client Attraction Audit',
  'A free diagnostic call on why the clients you want aren''t finding you yet.',
  $md$Stuck at a slow client caseload or not sure why the clients you want aren't finding you? In this free call, we'll look at your ideal client, your current marketing, and your referral sources to identify exactly what's holding your practice back from filling up. You'll leave with a clear picture of the gap and a recommended next step.

This is a diagnostic call, not a sales pitch. Come ready to talk honestly about where your practice stands right now.

**If a day or time you need isn't available, [send me a note](/contact) and I'll see what I can do to find a time that works for us both.**$md$,
  30, 10, 15, 15, 14, NULL, 0,
  $q$[
    {"id": "instagram", "label": "Instagram Handle?", "type": "text", "required": true, "options": []},
    {"id": "license", "label": "What is your license type", "type": "radio", "required": true, "options": ["LCSW", "LMFT", "LPC", "Other"]},
    {"id": "status", "label": "What is your current practice status?", "type": "radio", "required": true,
     "options": ["I’m starting my private practice", "I have an existing solo practice and want to grow it", "I’m expanding into a group practice", "I want to rebrand or restructure", "I’m not sure — I need clarity"]},
    {"id": "vision", "label": "What do you want your practice to look and feel like in the next 3-6 months?", "type": "checkbox", "required": true,
     "options": ["I want my practice to be profitable and financially stable", "I want my practice to attract aligned, higher-paying clients", "I want my practice to support my lifestyle, not drain me", "I want my practice to feel organized, structured, and sustainable", "I want my practice to grow without burning me out", "I want my practice to reflect who I am as a strong, ambitious woman", "I want my practice to expand into a group practice or bigger vision", "I want my practice to give me more time, freedom, and peace"]},
    {"id": "caseload", "label": "How many clients are you currently seeing?", "type": "checkbox", "required": true, "options": ["1-5 just starting out", "5-10", "15-20", "25+"]},
    {"id": "tried", "label": "What have you already tried to attract clients (marketing, referrals, directories, social media, etc)?", "type": "textarea", "required": false, "options": []}
  ]$q$::jsonb,
  true, false, true, 20
),
(
  'profitable-practice-consultation', 'chatprofitwithyvette', 'Profitable Practice Consultation',
  'A 1:1 90-minute strategy session for starting a practice or growing into a group.',
  $md$In the process of starting a private practice or expanding from solo practice to group practice? You are in the right place. In this session you can ask me anything about private practice — whether you are just starting or ready to expand into a group, I am here for you.

**1:1 90-Minute Strategy Session**

During this focused session, we will dive deep into a critical area of your practice, whether it's developing a plan for your business, gaining clarity on your questions, or making sure your business has everything it needs to succeed.

**Here's what you'll gain from our session:**

- **Clear professional goals.** Define your professional aspirations and develop actionable steps to achieve them.
- **Streamlined operations.** Guidance on setting up efficient systems for scheduling, billing, and client management.
- **Service development.** Create and offer services that meet the needs of your clients and align with your business objectives.
- **Goal setting and achievement.** Clear professional and business goals, with a step-by-step action plan to reach them.
- **Legal and ethical considerations.** The legal requirements for starting a private or group practice, and best practices for confidentiality and ethical standards.
- **Business structure and setup.** Choosing the right structure (LLC, S-corp, etc.) — always confirmed with your lawyer or CPA — plus licensing, insurance, and the other paperwork.
- **Client acquisition and retention.** Marketing that attracts new clients, and techniques for building a loyal client base.

After the meeting, you'll receive a follow-up note based on what we discussed and a recording of our call to keep.

> "Consulting with someone who has walked this path and learned the mistakes along the way can ease the pressure. Consulting with Yvette did just that! Her wealth of knowledge and years of experience have created confidence in me that I can build a successful group practice." — **Ashley Blake, LCSW**

> "Yvette was super helpful with answering my questions regarding starting a private practice. The task seemed daunting, but she ironed out my fears and helped me gain the confidence to get out there and put my best foot forward." — **Simone Phillips, LCSW**

> "I am currently a clinician business owner in two states and had questions regarding expansion, onboarding and daily operations. Yvette gave me great insight and details to move forward. Speaking with her saved me time in researching different laws and rules so that I could get started quickly." — **Nicole Williams, LPC**$md$,
  90, 10, 15, 1440, 14, NULL, 65000,
  $q$[
    {"id": "social", "label": "Instagram or Facebook Handle?", "type": "text", "required": true, "options": []},
    {"id": "feeling", "label": "I am currently feeling… (select all that apply)", "type": "checkbox", "required": false,
     "options": ["I feel stuck and unsure about my next steps in private practice", "I feel overwhelmed trying to balance clients, life, and business tasks", "I feel underpaid for the work and energy I give", "I feel confident clinically, but not as a business owner", "I feel ready for a major shift in my practice", "I feel excited but need guidance and structure", "I feel burnt out from agency work and want more freedom", "I feel disconnected from my true earning potential"]},
    {"id": "status", "label": "What is your current practice status?", "type": "radio", "required": true,
     "options": ["I’m starting my private practice", "I have an existing solo practice and want to grow it", "I’m expanding into a group practice", "I want to rebrand or restructure", "I’m not sure — I need clarity"]},
    {"id": "vision", "label": "What do you want your practice to look and feel like in the next 3-6 months? (select all that apply)", "type": "checkbox", "required": true,
     "options": ["I want my practice to be profitable and financially stable", "I want my practice to attract aligned, higher-paying clients", "I want my practice to support my lifestyle, not drain me", "I want my practice to feel organized, structured, and sustainable", "I want my practice to grow without burning me out", "I want my practice to reflect who I am as a strong, ambitious woman", "I want my practice to expand into a group practice or bigger vision", "I want my practice to give me more time, freedom, and peace"]}
  ]$q$::jsonb,
  true, false, false, 30
),
(
  'practice-clarity-intensive', 'practice-clarity-intensive', 'The Practice Clarity Intensive',
  'A focused 60-minute strategy session on one specific business challenge or decision.',
  $md$A focused 60-minute strategy session for therapists and practice owners who need expert guidance on one specific business challenge or decision.

This session is ideal if you need clarity around areas like profitability, clinician compensation, hiring structure, caseload expectations, systems, delegation, owner income, or the next strategic move in your practice.

Before we meet, you'll complete a brief intake so I can understand your current numbers, structure, and goals. During our session, we'll identify what's actually driving the issue, work through the decision together, and leave you with clear recommendations and next steps.

**This is a focused strategy session designed to address one primary business challenge.** The more complete your numbers and answers are beforehand, the more of our 60 minutes we can spend analyzing your situation and developing clear recommendations rather than gathering background information.$md$,
  60, 0, 15, 120, 60, NULL, 35000,
  $q$[
    {"id": "challenge", "label": "What is the #1 business challenge or decision you want us to focus on during this session?", "type": "textarea", "required": true, "options": []},
    {"id": "success", "label": "What would make this session feel successful to you? What do you want to leave with clarity on?", "type": "textarea", "required": true, "options": []},
    {"id": "structure", "label": "What is your current practice structure? (Example: solo practice, group practice, number of clinicians, W-2/1099.)", "type": "textarea", "required": true, "options": []},
    {"id": "pay", "label": "What are your current clinician pay rates and average completed sessions per week?", "type": "textarea", "required": false, "options": []},
    {"id": "reimbursement", "label": "What are your approximate lowest and average insurance reimbursement rates?", "type": "text", "required": false, "options": []},
    {"id": "revenue", "label": "What is your approximate monthly practice revenue and monthly overhead? (A range is fine.)", "type": "text", "required": true, "options": []},
    {"id": "outcome", "label": "What is your desired outcome for the next 90 days?", "type": "text", "required": true, "options": []},
    {"id": "review", "label": "Is there anything specific you want me to review before or during the session? (Example: compensation structure, bonus idea, staffing expectations, expense spreadsheet, current policy, etc.)", "type": "textarea", "required": true, "options": []}
  ]$q$::jsonb,
  true, false, false, 40
),
(
  'retreat-interest-call', 'retreat', 'Retreat Interest Call',
  'A 20-minute call about the Release. Restore. Reconnect. retreat in Bali, June 2027.',
  $md$Hey! I am so glad you are here. This is a quick 20-minute call for women who have expressed interest in the **Release. Restore. Reconnect.** luxury healing retreat in Bali, June 2027.

On this call we will walk through all the details — the experience, the villa, what is included, pricing, and payment options — so you can decide if this feels like the right fit for you.

This retreat is designed exclusively for women in healthcare and wellness who are ready to finally be taken care of the way they take care of everyone else.

Only 12 spots available. Spots are filling through personal invitation. Come ready to ask questions and leave ready to make a decision.$md$,
  20, 10, 15, 1440, 14, NULL, 0,
  '[]'::jsonb,
  true, false, true, 50
),
(
  'boss-move-kickstart-call', 'boss-move-kickstart-call-15-minutes', 'Boss Move Kickstart Call',
  'Your first move in the Club: fifteen minutes with Yvette before you dive in.',
  $md$Welcome to the Club. This call is your first move: fifteen minutes with me, before you dive into the program, to make sure you start in exactly the right place.

This isn't a generic onboarding chat. We'll work from what you tell me below and leave with your first three moves named and clear.

Before we meet, answer a few quick questions when you book:

- Where you're starting from
- The one thing you most want out of this call
- What's actually stopping you right now

Come with whatever is loudest in your head about starting this practice. Fear, a logistics question, a rate you're scared to set, all of it is fair game. Fifteen minutes, fully focused on you and your first move.$md$,
  15, 0, 15, 1440, 14, NULL, 0,
  $q$[
    {"id": "start", "label": "Where are you starting from?", "type": "checkbox", "required": true,
     "options": ["Never seen a private practice client", "Tried before and went back to an agency or platform", "Already seeing clients but it's unstructured"]},
    {"id": "want", "label": "What's the one thing you most want out of this call?", "type": "textarea", "required": true, "options": []},
    {"id": "stopping", "label": "What's stopping you right now?", "type": "textarea", "required": true, "options": []},
    {"id": "building", "label": "Are you building this full time, alongside a job, or alongside an existing practice?", "type": "radio", "required": false,
     "options": ["full time", "alongside a job", "alongside an existing practice"]},
    {"id": "worth", "label": "What would make you feel like this call was worth it?", "type": "textarea", "required": false, "options": []}
  ]$q$::jsonb,
  false, false, true, 60
),
(
  'club-kick-start-call', 'kick-start', 'The Club Kick Start Call',
  'Schedule your follow-up session calls with Yvette.',
  $md$**This is to schedule your follow-up session calls with me.**

If you don't see a date and time that matches your needs, [reach out](/contact) and we'll find one.$md$,
  50, 10, 15, 60, 14, NULL, 0,
  $q$[
    {"id": "proud", "label": "The actions you've taken in the last few weeks that you're feeling really proud of are:", "type": "textarea", "required": true, "options": []},
    {"id": "challenges", "label": "The internal and/or external challenges you've faced in the last week are", "type": "textarea", "required": true, "options": []},
    {"id": "insight", "label": "A personal insight or AHA that you've had recently is", "type": "textarea", "required": true, "options": []},
    {"id": "cover", "label": "Top three things you'd like to cover in this call", "type": "textarea", "required": true, "options": []}
  ]$q$::jsonb,
  false, false, true, 70
),
(
  'vip-kickoff-strategy-call', 'vip-kickoff-strategy-call', 'VIP Kickoff Strategy Call',
  'Welcome to VIP: your numbers, your model, and your priorities for the next six months.',
  $md$Welcome to VIP. This call is where I get to know your practice: your numbers, your model, and what you most want to change in the next six months.

This is not a get-to-know-you chat. We'll work from your actual data and leave with your priorities set for the curriculum ahead.

**Come prepared:**

- Complete your Practice Reset Snapshot (Start Here module)
- Complete your Practice Health Assessment baseline (the Assessment tab of your dashboard)
- Have your dashboard started, even if some numbers are rough for now
- Bring the one question that matters most to you right now

We'll cover your starting point, where the curriculum will hit hardest for your specific practice, and your first structural move. Thirty minutes, fully focused on you.$md$,
  30, 15, 15, 60, 30, NULL, 0,
  $q$[
    {"id": "question", "label": "What's the one question or decision you most want clarity on during this call?", "type": "textarea", "required": true, "options": []}
  ]$q$::jsonb,
  false, false, true, 80
),
(
  'vip-momentum', 'vip-momentum', 'VIP 90-Day Momentum Call',
  'Your midpoint course correction: what moved, what stalled, and the next 90 days.',
  $md$You're at the midpoint of your commitment, and this call is your course correction. What moved since your Kickoff? What stalled? And what does the next 90 days need to look like?

Month three is where most clinicians quietly lose momentum. This call is built so you don't.

**Come prepared:**

- Update your dashboard through the current month
- Complete your Day 60 review in the 90-Day Action Plan, honestly
- Bring the stalled thing, not just the wins. The stuck places are where this call earns its place

We'll compare your numbers against your Kickoff conversation, name what's actually in the way, and set your priorities for the back half of your six months.$md$,
  30, 15, 15, 60, 30, NULL, 0,
  $q$[
    {"id": "stalled", "label": "What's the thing that's stalled or feels stuck right now?", "type": "textarea", "required": true, "options": []}
  ]$q$::jsonb,
  false, false, true, 90
),
(
  'vip-elevation', 'vip-elevation', 'VIP 6-Month Elevation Review',
  'Your before and after, side by side — and what your next season of practice calls for.',
  $md$Six months ago you started with a baseline. This call puts your before and after side by side.

We'll review your Practice Health Assessment scores, your dashboard numbers, and your Transformation Checkpoint: your rate then and now, your income sources, your salary, the time off you actually took. Evidence, not vibes.

**Come prepared:**

- Re-score your Practice Health Assessment (new quarter column in your dashboard)
- Complete your Transformation Checkpoint (end of Module 04)
- Update your dashboard through the current month

Then we look forward: what your next season of practice looks like, and what kind of support it calls for. Come ready to celebrate. You did the work most clinicians only think about.$md$,
  30, 15, 15, 60, 30, NULL, 0,
  $q$[
    {"id": "next", "label": "What does your next season of practice need to look like?", "type": "textarea", "required": true, "options": []}
  ]$q$::jsonb,
  false, false, true, 100
)
ON CONFLICT (slug) DO NOTHING;

/* ---------------------------------------------------------------- windows */

-- TidyCal's weekly windows, as wall-clock minutes in America/Los_Angeles.
-- Inserted only for a type that has none yet, so re-running cannot double them.
-- The Club Kick Start Call had no weekly hours on TidyCal (bookable only on
-- dates she opened by hand); it starts on Mon-Fri 10:00-16:00 here.
INSERT INTO book_a_call_windows (call_type_id, weekday, start_minute, end_minute, timezone)
SELECT t.id, w.weekday, w.start_minute, w.end_minute, 'America/Los_Angeles'
  FROM (VALUES
    ('practice-alignment-call',          1, 11*60,      14*60),
    ('practice-alignment-call',          2,  9*60,      10*60),
    ('practice-alignment-call',          3, 13*60,      16*60),
    ('practice-alignment-call',          4, 14*60,      16*60),
    ('client-attraction-audit',          1, 14*60,      16*60),
    ('client-attraction-audit',          2, 13*60,      15*60),
    ('client-attraction-audit',          3, 13*60,      16*60),
    ('client-attraction-audit',          4, 14*60,      16*60),
    ('profitable-practice-consultation', 1, 15*60,      17*60),
    ('profitable-practice-consultation', 4, 10*60,      13*60),
    ('profitable-practice-consultation', 5, 10*60,      14*60),
    ('practice-clarity-intensive',       4, 13*60 + 30, 17*60),
    ('practice-clarity-intensive',       5, 11*60,      12*60),
    ('retreat-interest-call',            1, 11*60,      18*60),
    ('retreat-interest-call',            2, 11*60 + 30, 18*60),
    ('retreat-interest-call',            3, 13*60,      15*60),
    ('retreat-interest-call',            4, 11*60,      16*60),
    ('boss-move-kickstart-call',         1, 10*60,      16*60),
    ('boss-move-kickstart-call',         2, 10*60,      16*60),
    ('club-kick-start-call',             1, 10*60,      16*60),
    ('club-kick-start-call',             2, 10*60,      16*60),
    ('club-kick-start-call',             3, 10*60,      16*60),
    ('club-kick-start-call',             4, 10*60,      16*60),
    ('club-kick-start-call',             5, 10*60,      16*60),
    ('vip-kickoff-strategy-call',        1, 10*60,      17*60),
    ('vip-kickoff-strategy-call',        2, 10*60,      17*60),
    ('vip-momentum',                     1, 10*60,      17*60),
    ('vip-momentum',                     2, 10*60,      17*60),
    ('vip-elevation',                    1, 10*60,      17*60),
    ('vip-elevation',                    2, 10*60,      17*60)
  ) AS w(slug, weekday, start_minute, end_minute)
  JOIN book_a_call_types t ON t.slug = w.slug
 WHERE NOT EXISTS (SELECT 1 FROM book_a_call_windows x WHERE x.call_type_id = t.id);

/* ------------------------------------------------- links that left the site */

-- The Lounge VIP -> "Book Your Strategy Calls" (course_lessons 40 today) links
-- its three calls to TidyCal. Matched on content, not id, so any other copy of
-- these links moves too.
UPDATE course_lessons
   SET body_md = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                   body_md,
                   'https://tidycal.com/profitwithyvette/vip-kickoff-strategy-call', '/book-a-call/vip-kickoff-strategy-call'),
                   'https://tidycal.com/profitwithyvette/vip-momentum',              '/book-a-call/vip-momentum'),
                   'https://tidycal.com/profitwithyvette/vip-elevation',             '/book-a-call/vip-elevation'),
                   'https://tidycal.com/profitwithyvette/alignwithyvette',           '/book-a-call/practice-alignment-call'),
                   'https://tidycal.com/profitwithyvette/chatprofitwithyvette',      '/book-a-call/profitable-practice-consultation'),
                   'https://tidycal.com/profitwithyvette/client-audit',              '/book-a-call/client-attraction-audit'),
                   'https://tidycal.com/profitwithyvette/practice-clarity-intensive','/book-a-call/practice-clarity-intensive'),
                   'https://tidycal.com/profitwithyvette/retreat',                   '/book-a-call/retreat-interest-call'),
                   'https://tidycal.com/profitwithyvette/boss-move-kickstart-call-15-minutes', '/book-a-call/boss-move-kickstart-call'),
                   'https://tidycal.com/profitwithyvette/kick-start',                '/book-a-call/club-kick-start-call'),
       updated_at = now()
 WHERE body_md ILIKE '%tidycal.com/profitwithyvette%';

-- Automation emails (099_kajabi_quizzes.sql's offer-quiz result emails offer
-- "Book a free Practice Alignment Call" on TidyCal). An email needs an absolute
-- link, on the same host 099 already uses for every other link in them.
UPDATE automation_actions
   SET config = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                  config::text,
                  'https://tidycal.com/profitwithyvette/vip-kickoff-strategy-call', 'https://bossclinician.callsphere.site/book-a-call/vip-kickoff-strategy-call'),
                  'https://tidycal.com/profitwithyvette/vip-momentum',              'https://bossclinician.callsphere.site/book-a-call/vip-momentum'),
                  'https://tidycal.com/profitwithyvette/vip-elevation',             'https://bossclinician.callsphere.site/book-a-call/vip-elevation'),
                  'https://tidycal.com/profitwithyvette/alignwithyvette',           'https://bossclinician.callsphere.site/book-a-call/practice-alignment-call'),
                  'https://tidycal.com/profitwithyvette/chatprofitwithyvette',      'https://bossclinician.callsphere.site/book-a-call/profitable-practice-consultation'),
                  'https://tidycal.com/profitwithyvette/client-audit',              'https://bossclinician.callsphere.site/book-a-call/client-attraction-audit'),
                  'https://tidycal.com/profitwithyvette/practice-clarity-intensive','https://bossclinician.callsphere.site/book-a-call/practice-clarity-intensive'),
                  'https://tidycal.com/profitwithyvette/retreat',                   'https://bossclinician.callsphere.site/book-a-call/retreat-interest-call'),
                  'https://tidycal.com/profitwithyvette/boss-move-kickstart-call-15-minutes', 'https://bossclinician.callsphere.site/book-a-call/boss-move-kickstart-call'),
                  'https://tidycal.com/profitwithyvette/kick-start',                'https://bossclinician.callsphere.site/book-a-call/club-kick-start-call')::jsonb
 WHERE config::text ILIKE '%tidycal.com/profitwithyvette%';

-- The archived test package "90-day practice accelerator" still carried a
-- developer's personal Calendly as its booking link.
UPDATE coaching_offers
   SET booking_url = '', updated_at = now()
 WHERE booking_url ILIKE '%calendly.com%' OR booking_url ILIKE '%tidycal.com%';
