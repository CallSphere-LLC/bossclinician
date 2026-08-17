-- Boss Clinician backend schema. Idempotent — safe to run on every boot.

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  excerpt       TEXT NOT NULL DEFAULT '',
  body_md       TEXT NOT NULL DEFAULT '',
  cover_image   TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  author        TEXT NOT NULL DEFAULT 'Yvette Howard, LCSW',
  read_minutes  INT NOT NULL DEFAULT 4,
  published     BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  subtitle      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  price_text    TEXT NOT NULL DEFAULT '',
  image         TEXT,
  url           TEXT NOT NULL DEFAULT '#',
  features      JSONB NOT NULL DEFAULT '[]',
  sort          INT NOT NULL DEFAULT 0,
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS testimonials (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  credential    TEXT NOT NULL DEFAULT '',
  quote         TEXT NOT NULL DEFAULT '',
  practice      TEXT,
  image         TEXT,
  sort          INT NOT NULL DEFAULT 0,
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  image         TEXT,
  cta_label     TEXT NOT NULL DEFAULT 'Download',
  cta_url       TEXT NOT NULL DEFAULT '#',
  kind          TEXT NOT NULL DEFAULT 'guide',
  sort          INT NOT NULL DEFAULT 0,
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  sections      JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  message       TEXT,
  source        TEXT NOT NULL DEFAULT 'contact',
  meta          JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'new',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscribers (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  source        TEXT NOT NULL DEFAULT 'newsletter',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id            TEXT PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta          JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id            SERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- Stripe checkout
-- ---------------------------------------------------------------------------

-- A course is purchasable once it has EITHER a stripe_price_id (a Price created
-- in the Stripe dashboard — preferred, keeps pricing in one place) OR a
-- price_cents amount (checkout builds an inline price_data from it).
-- price_text stays the display string ("$497", "3 payments of $199").
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS practice TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_cents      INT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS stripe_price_id  TEXT;

CREATE TABLE IF NOT EXISTS orders (
  id                       SERIAL PRIMARY KEY,
  course_id                INT REFERENCES courses(id) ON DELETE SET NULL,
  course_slug              TEXT NOT NULL DEFAULT '',
  course_title             TEXT NOT NULL DEFAULT '',
  email                    TEXT NOT NULL DEFAULT '',
  amount_cents             INT NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  -- pending -> paid | failed | expired
  status                   TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id        TEXT UNIQUE NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts (published, published_at DESC);
-- No index on stripe_session_id: the UNIQUE constraint already provides one.
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_tags ON blog_posts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id);

-- ---------------------------------------------------------------------------
-- Media library
-- ---------------------------------------------------------------------------

-- Uploads used to be fire-and-forget (POST returned a URL and nothing recorded
-- it). Tracking them makes a browsable library possible and lets lessons point
-- at an asset the admin can still find a month later.
CREATE TABLE IF NOT EXISTS media_assets (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT '',
  -- image | video | audio | document | file — derived from mime at upload time
  -- so the UI can filter without re-parsing MIME strings.
  kind          TEXT NOT NULL DEFAULT 'file',
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  title         TEXT NOT NULL DEFAULT '',
  folder        TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_kind ON media_assets (kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- Curriculum: course -> modules -> lessons
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_modules (
  id            SERIAL PRIMARY KEY,
  course_id     INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id               SERIAL PRIMARY KEY,
  module_id        INT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '',
  body_md          TEXT NOT NULL DEFAULT '',
  video_url        TEXT NOT NULL DEFAULT '',
  attachment_url   TEXT NOT NULL DEFAULT '',
  duration_minutes INT NOT NULL DEFAULT 0,
  -- free preview lesson, viewable before purchase
  preview          BOOLEAN NOT NULL DEFAULT false,
  published        BOOLEAN NOT NULL DEFAULT true,
  sort             INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_modules_course ON course_modules (course_id, sort);
CREATE INDEX IF NOT EXISTS idx_course_lessons_module ON course_lessons (module_id, sort);

-- ---------------------------------------------------------------------------
-- Members & enrollments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS members (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  -- active | invited | cancelled
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id            SERIAL PRIMARY KEY,
  member_id     INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  course_id     INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  -- 0-100, updated as lessons are completed
  progress      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_id);

-- ---------------------------------------------------------------------------
-- Community
--
-- Mirrors the Kajabi model: a community contains channels (feed- or chat-
-- formatted), channels contain posts, posts carry comments and reactions.
-- Engagement is gamified through a points ledger, badges and time-bound
-- challenges.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS communities (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  cover_image   TEXT NOT NULL DEFAULT '',
  -- free | paid — paid communities gate on an active subscription
  access        TEXT NOT NULL DEFAULT 'free',
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_channels (
  id            SERIAL PRIMARY KEY,
  community_id  INT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  -- feed (threaded posts) | chat (group messages)
  format        TEXT NOT NULL DEFAULT 'feed',
  -- public (all members) | private (invite only)
  visibility    TEXT NOT NULL DEFAULT 'public',
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (community_id, slug)
);

CREATE TABLE IF NOT EXISTS community_memberships (
  id            SERIAL PRIMARY KEY,
  community_id  INT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id     INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- member | moderator | admin
  role          TEXT NOT NULL DEFAULT 'member',
  points        INT NOT NULL DEFAULT 0,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (community_id, member_id)
);

CREATE TABLE IF NOT EXISTS community_posts (
  id            SERIAL PRIMARY KEY,
  channel_id    INT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  -- NULL author = posted by the host/admin rather than a member
  member_id     INT REFERENCES members(id) ON DELETE SET NULL,
  author_name   TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  media_url     TEXT NOT NULL DEFAULT '',
  pinned        BOOLEAN NOT NULL DEFAULT false,
  -- visible | hidden — moderation without destroying the record
  status        TEXT NOT NULL DEFAULT 'visible',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_comments (
  id            SERIAL PRIMARY KEY,
  post_id       INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  member_id     INT REFERENCES members(id) ON DELETE SET NULL,
  author_name   TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'visible',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_reactions (
  id            SERIAL PRIMARY KEY,
  post_id       INT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  member_id     INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  emoji         TEXT NOT NULL DEFAULT '👍',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, member_id, emoji)
);

CREATE TABLE IF NOT EXISTS community_challenges (
  id            SERIAL PRIMARY KEY,
  community_id  INT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  cover_image   TEXT NOT NULL DEFAULT '',
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  points        INT NOT NULL DEFAULT 10,
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_challenge_entries (
  id            SERIAL PRIMARY KEY,
  challenge_id  INT NOT NULL REFERENCES community_challenges(id) ON DELETE CASCADE,
  member_id     INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  proof_url     TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  approved      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, member_id)
);

CREATE TABLE IF NOT EXISTS community_events (
  id            SERIAL PRIMARY KEY,
  community_id  INT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  starts_at     TIMESTAMPTZ,
  duration_minutes INT NOT NULL DEFAULT 60,
  location_url  TEXT NOT NULL DEFAULT '',
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_badges (
  id            SERIAL PRIMARY KEY,
  community_id  INT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  emoji         TEXT NOT NULL DEFAULT '🏅',
  -- points threshold at which the badge is earned
  threshold     INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channels_community ON community_channels (community_id, sort);
CREATE INDEX IF NOT EXISTS idx_posts_channel ON community_posts (channel_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON community_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memberships_points ON community_memberships (community_id, points DESC);

-- ---------------------------------------------------------------------------
-- Recurring revenue: plans, subscriptions, coupons
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plans (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price_cents     INT NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'usd',
  -- month | year
  interval        TEXT NOT NULL DEFAULT 'month',
  stripe_price_id TEXT,
  features        JSONB NOT NULL DEFAULT '[]',
  -- optional community this plan unlocks
  community_id    INT REFERENCES communities(id) ON DELETE SET NULL,
  trial_days      INT NOT NULL DEFAULT 0,
  published       BOOLEAN NOT NULL DEFAULT true,
  sort            INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     SERIAL PRIMARY KEY,
  member_id              INT REFERENCES members(id) ON DELETE SET NULL,
  plan_id                INT REFERENCES plans(id) ON DELETE SET NULL,
  email                  TEXT NOT NULL DEFAULT '',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  -- mirrors Stripe: trialing | active | past_due | canceled | incomplete | unpaid
  status                 TEXT NOT NULL DEFAULT 'incomplete',
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  amount_cents           INT NOT NULL DEFAULT 0,
  currency               TEXT NOT NULL DEFAULT 'usd',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupons (
  id               SERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  -- exactly one of percent_off / amount_off_cents is set
  percent_off      INT,
  amount_off_cents INT,
  currency         TEXT NOT NULL DEFAULT 'usd',
  stripe_coupon_id TEXT,
  max_redemptions  INT,
  redeemed         INT NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Coaching: offers -> booked sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS coaching_offers (
  id               SERIAL PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  -- how many sessions the package includes; 0 = open ended
  session_count    INT NOT NULL DEFAULT 1,
  duration_minutes INT NOT NULL DEFAULT 60,
  price_cents      INT NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'usd',
  stripe_price_id  TEXT,
  -- individual | group
  format           TEXT NOT NULL DEFAULT 'individual',
  booking_url      TEXT NOT NULL DEFAULT '',
  published        BOOLEAN NOT NULL DEFAULT true,
  sort             INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coaching_sessions (
  id               SERIAL PRIMARY KEY,
  offer_id         INT REFERENCES coaching_offers(id) ON DELETE SET NULL,
  member_id        INT REFERENCES members(id) ON DELETE CASCADE,
  scheduled_at     TIMESTAMPTZ,
  duration_minutes INT NOT NULL DEFAULT 60,
  -- scheduled | completed | cancelled | no_show
  status           TEXT NOT NULL DEFAULT 'scheduled',
  meeting_url      TEXT NOT NULL DEFAULT '',
  agenda           TEXT NOT NULL DEFAULT '',
  -- coach-only notes; never exposed on any public route
  private_notes    TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_schedule ON coaching_sessions (scheduled_at);

-- ---------------------------------------------------------------------------
-- Podcasts: show -> episodes (public or member-only via RSS token)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS podcasts (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  cover_image   TEXT NOT NULL DEFAULT '',
  author        TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'Business',
  language      TEXT NOT NULL DEFAULT 'en-us',
  explicit      BOOLEAN NOT NULL DEFAULT false,
  -- public | private — private feeds require a subscriber token
  visibility    TEXT NOT NULL DEFAULT 'public',
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS podcast_episodes (
  id               SERIAL PRIMARY KEY,
  podcast_id       INT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  show_notes_md    TEXT NOT NULL DEFAULT '',
  audio_url        TEXT NOT NULL DEFAULT '',
  audio_bytes      BIGINT NOT NULL DEFAULT 0,
  duration_seconds INT NOT NULL DEFAULT 0,
  episode_number   INT,
  season           INT NOT NULL DEFAULT 1,
  published        BOOLEAN NOT NULL DEFAULT false,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON podcast_episodes (podcast_id, published_at DESC);

-- Per-member token for private podcast feeds, so a leaked URL can be revoked
-- for one listener without rotating everyone's feed.
CREATE TABLE IF NOT EXISTS podcast_feed_tokens (
  id          SERIAL PRIMARY KEY,
  podcast_id  INT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  member_id   INT REFERENCES members(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Newsletters: publication -> issues
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS newsletters (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  -- free | paid — paid gates on plan_id
  access        TEXT NOT NULL DEFAULT 'free',
  plan_id       INT REFERENCES plans(id) ON DELETE SET NULL,
  published     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_issues (
  id              SERIAL PRIMARY KEY,
  newsletter_id   INT NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  preview_text    TEXT NOT NULL DEFAULT '',
  body_md         TEXT NOT NULL DEFAULT '',
  -- draft | scheduled | sent
  status          TEXT NOT NULL DEFAULT 'draft',
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  recipient_count INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Email campaigns
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_campaigns (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  preview_text    TEXT NOT NULL DEFAULT '',
  body_md         TEXT NOT NULL DEFAULT '',
  -- all_subscribers | all_members | leads | community
  audience        TEXT NOT NULL DEFAULT 'all_subscribers',
  -- draft | scheduled | sending | sent | failed
  status          TEXT NOT NULL DEFAULT 'draft',
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  recipient_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,
  opened_count    INT NOT NULL DEFAULT 0,
  clicked_count   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per recipient: makes resends idempotent and open tracking possible.
CREATE TABLE IF NOT EXISTS email_sends (
  id           SERIAL PRIMARY KEY,
  campaign_id  INT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  -- queued | sent | failed | opened
  status       TEXT NOT NULL DEFAULT 'queued',
  error        TEXT NOT NULL DEFAULT '',
  opened_at    TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_sends_campaign ON email_sends (campaign_id, status);

-- ---------------------------------------------------------------------------
-- Funnels: funnel -> ordered steps, with view/conversion counters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS funnels (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  -- opt_in | webinar | sales | launch
  kind          TEXT NOT NULL DEFAULT 'opt_in',
  published     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funnel_steps (
  id            SERIAL PRIMARY KEY,
  funnel_id     INT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL DEFAULT '',
  -- landing | opt_in | offer | upsell | thank_you
  step_type     TEXT NOT NULL DEFAULT 'landing',
  headline      TEXT NOT NULL DEFAULT '',
  body_md       TEXT NOT NULL DEFAULT '',
  cta_label     TEXT NOT NULL DEFAULT 'Continue',
  cta_url       TEXT NOT NULL DEFAULT '',
  sort          INT NOT NULL DEFAULT 0,
  views         INT NOT NULL DEFAULT 0,
  conversions   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_steps ON funnel_steps (funnel_id, sort);

-- ---------------------------------------------------------------------------
-- Automations: trigger -> conditions -> ordered actions, with a run log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS automations (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  -- lead_created | subscriber_created | order_paid | member_created
  -- | community_joined | challenge_approved
  trigger_type  TEXT NOT NULL,
  -- optional "only if" filter, e.g. {"source":"apply"}
  conditions    JSONB NOT NULL DEFAULT '{}',
  -- active | paused
  status        TEXT NOT NULL DEFAULT 'active',
  run_count     INT NOT NULL DEFAULT 0,
  last_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_actions (
  id            SERIAL PRIMARY KEY,
  automation_id INT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  -- send_email | create_member | enroll_course | join_community
  -- | award_points | notify_admin
  action_type   TEXT NOT NULL,
  config        JSONB NOT NULL DEFAULT '{}',
  sort          INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id            SERIAL PRIMARY KEY,
  automation_id INT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  -- success | partial | failed | skipped
  status        TEXT NOT NULL DEFAULT 'success',
  subject_email TEXT NOT NULL DEFAULT '',
  log           JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations (trigger_type, status);
CREATE INDEX IF NOT EXISTS idx_automation_runs ON automation_runs (automation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forms (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  -- [{key,label,type,required,options[]}]
  fields          JSONB NOT NULL DEFAULT '[]',
  submit_label    TEXT NOT NULL DEFAULT 'Submit',
  success_message TEXT NOT NULL DEFAULT 'Thanks — we got it.',
  -- also create a Lead row on submission
  create_lead     BOOLEAN NOT NULL DEFAULT true,
  published       BOOLEAN NOT NULL DEFAULT true,
  views           INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id          SERIAL PRIMARY KEY,
  form_id     INT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}',
  email       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions ON form_submissions (form_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Saved reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS saved_reports (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  -- revenue | subscriptions | audience | content | funnel
  kind          TEXT NOT NULL DEFAULT 'revenue',
  -- {days:30} etc
  config        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- createCrudRepo.update() always writes updated_at, so every table exposed
-- through the shared CRUD factory needs the column.
ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE newsletters      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE funnel_steps     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE saved_reports    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE forms            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Subscription invoices, recorded by webhook so Sales > Invoices has real data.
CREATE TABLE IF NOT EXISTS invoices (
  id                 SERIAL PRIMARY KEY,
  stripe_invoice_id  TEXT UNIQUE NOT NULL,
  subscription_id    INT REFERENCES subscriptions(id) ON DELETE SET NULL,
  email              TEXT NOT NULL DEFAULT '',
  amount_paid_cents  INT NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'usd',
  status             TEXT NOT NULL DEFAULT 'open',
  hosted_invoice_url TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
