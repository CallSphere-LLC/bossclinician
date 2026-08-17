# Claude Code Prompt — Boss Clinician Platform: Full Kajabi + Dotcom Feature Parity

> Paste everything below the line into Claude Code from the root of the `bossclinician.callsphere.site` repo.
> It is written as one master brief split into ordered phases. Work one phase at a time, ship it, then move on.

---

# MISSION

You are working on **Boss Clinician** — a self-hosted replacement for a Kajabi-powered business.
All three properties below belong to the same owner (Yvette Howard, LCSW). This is a first-party rebuild, not a scrape of someone else's product.

| Property | Role | Status |
|---|---|---|
| `https://bossclinician.callsphere.site` | The new platform (this repo) | Marketing site + admin shell built; **no member-facing product at all** |
| `https://www.bossclinician.com` | Current live site, hosted **on Kajabi** | 125 indexed URLs, the thing being replaced |
| `https://app.kajabi.com/admin/sites/2148299891` | Current back office | 20 products · 57 offers · 111 landing pages · 45 forms · 142 automations · 393 contacts · 22 events · 2 assessments |

**Goal:** the new platform must do everything Kajabi does for this business, for both audiences —
1. **Admin (Yvette):** run products, offers, payments, contacts, email, funnels, pages, community, coaching, analytics.
2. **Member (a therapist who signs up / buys):** create an account, buy, get access, consume content, book coaching, participate in community, manage their own billing.

Right now **audience #2 does not exist on the new platform**. That is the single biggest gap and Phases 1–3 exist to close it.

---

# GROUND RULES

1. **Phase 0 first, always.** Do not write feature code until you have read the repo and produced the discovery report. Everything below describes *what* to build; the repo decides *how*.
2. **Do not invent the stack.** The frontend is confirmed React + TypeScript + Vite + Tailwind + framer-motion + react-router (lazy-loaded route chunks). The backend is a same-origin `/api` service using `Authorization: Bearer <token>`. Read it before extending it.
3. **Extend, don't replace.** The admin already has ~35 working routes and a real database behind it. Every phase below adds to that model — none of it is a rewrite.
4. **Every phase ends green:** typecheck, lint, build, tests pass, and the acceptance checks in that phase are demonstrably true. Do not start the next phase otherwise.
5. **Migrations are forward-only and reversible.** One migration per phase, named for the phase.
6. **No secrets in the repo.** Everything configurable goes to env vars, documented in `.env.example`.
7. **Money code gets tests.** Anything that computes a price, a proration, a commission or a tax amount needs unit tests before it ships.
8. **Security is not a phase.** Apply the Phase 10 hardening rules to every endpoint you write as you write it. (Context: the leads table already contains a hostile probe — a lead named `Robert Sec-Test '); DROP TABLE leads;--`. Assume the public endpoints are being scanned.)
9. **Ask before destructive changes** to existing tables that hold real rows (`leads`, `courses`, `blog_posts`, `pages`, `resources`, `testimonials`).

---

# PHASE 0 — Discovery & baseline

**Do this before anything else.** Produce `docs/AUDIT.md` containing:

1. **Stack map** — languages, frameworks, package manager, backend runtime, ORM/query layer, DB engine, hosting/deploy config, background job runner (or the absence of one), mail transport, file/media storage.
2. **Route inventory** — every public route, every admin route, every `/api` endpoint, with the handler file for each.
3. **Data model** — full schema dump: tables, columns, indexes, foreign keys, row counts.
4. **Auth model** — how the admin Bearer token is issued, stored, validated, expired. Note whether there is *any* non-admin identity concept (expected answer: no).
5. **Payments** — exactly how Stripe is wired today. The admin reports "Stripe connected" and has `/admin/sales/{payments,subscriptions,invoices,plans,coupons,payouts}` plus a public `/checkout/session` endpoint. Determine: which Stripe mode, which API version, which webhooks are handled, whether prices live in Stripe or locally, whether anything has ever actually succeeded end-to-end.
6. **Gap confirmation** — verify each item in the "Confirmed baseline" table below against the code and mark ✅ correct / ⚠️ different-than-described. **If reality differs from this brief, reality wins** — flag it and adjust the plan.
7. **Delivery plan** — for each phase below, the files you expect to touch and the order you'll do them in.

## Confirmed baseline (observed 2026-08-17)

**Public site — exists:** `/` · `/about` · `/work-with-me` · `/apply` · `/courses` · `/store` · `/resources` · `/resource-hub` · `/retreats` · `/blog` · `/blog/:slug` · `/contact` · `/practice-quiz` · `/practice-reset-planner` · `/checkout/success` · `/terms` · `/privacy-policy` · `/disclaimer` · `/financial-disclaimer` · AI chat widget (OpenAI realtime session endpoint).

**Public API — exists:** `POST /leads` · `POST /subscribe` · `GET /courses` · `GET /resources` · `GET /testimonials` · `GET /blog` · `GET /blog/:slug` · `GET /pages/:slug` · `GET /settings` · `POST /chat` · `POST /checkout/session` · `POST /api/forms/:slug/submit` · `GET /api/funnels/:slug` · `GET /api/podcast/:slug/rss.xml`.

**Admin — exists:** overview · analytics + 4 reports (audience / content / funnels / subscriptions) · products · courses + curriculum (modules, lessons) · coaching (offers, sessions) · community (channels, posts, comments, challenges, badges, leaderboard, events, members) · podcasts (+ episodes, private feed tokens) · newsletters (+ issues) · media library · blog (+ AI generation) · pages (raw JSON section editor, 3 pages) · resources · testimonials · marketing (campaigns, automations, funnels, forms, events) · sales (payments, subscriptions, invoices, plans, coupons, payouts) · leads · members (+ enrollments) · subscribers · settings (raw JSON blob).

**Admin — real data today:** 17 courses (14 published + 3 draft) with **0 lessons total**, 8 blog posts, 1 community (0 channels, 0 members), 0 plans, 0 members, 0 payments, 0 subscriptions, 0 campaigns, 0 automations, 0 funnels, 1 lead, 0 B media stored, $0 all-time revenue.

**Does not exist anywhere:** member signup/login · member session · member dashboard/library · course player · lesson progress · downloads delivery · certificates · member-facing community · coaching booking · member billing portal · checkout page (only the success page) · offers as a separate concept from products · payment plans · order bumps/upsells · affiliates · tags/segments · email sequences · assessments/quiz engine · page builder · sitemap/robots/SSR · admin roles · webhooks/integrations.

---

# PHASE 1 — Member identity & account

**Why:** nobody can sign up. Everything downstream depends on this.

## 1.1 Data
- `members` table (may already exist as an admin-only record — extend it): `id, email (citext, unique), password_hash, first_name, last_name, avatar_url, timezone, locale, status (active|suspended|deleted), email_verified_at, last_login_at, created_at, updated_at`.
- `member_sessions`: opaque refresh tokens, `id, member_id, token_hash, user_agent, ip, expires_at, revoked_at`.
- `member_password_resets`, `member_email_verifications`: single-use, hashed, TTL'd tokens.
- Unify: a `members` row and a `leads`/`subscribers` row for the same email must resolve to **one contact** (see Phase 4). Do not create a fourth silo.

## 1.2 Endpoints (`/api/auth/*`)
`POST /register` · `POST /login` · `POST /logout` · `POST /refresh` · `POST /forgot-password` · `POST /reset-password` · `POST /verify-email` · `POST /resend-verification` · `GET /me` · `PATCH /me` · `POST /me/password` · `POST /me/avatar`.

- Argon2id (or bcrypt cost ≥ 12) hashing.
- Access token short-lived (15 min); refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie with rotation and reuse-detection.
- Rate limit: 5 attempts / 15 min / IP+email on login and forgot-password. Generic error text — never reveal whether an email exists.
- Optional **magic-link sign-in** (Kajabi offers passwordless member sign-in) — build it behind a settings flag.

## 1.3 Frontend
New routes: `/login` · `/signup` · `/forgot-password` · `/reset-password/:token` · `/verify-email/:token` · `/account` · `/account/profile` · `/account/security` · `/account/billing` · `/account/purchases`.
- `<RequireMember>` route guard + `MemberAuthProvider` context; redirect unauthenticated users to `/login?next=...`.
- Member chrome is **distinct from admin chrome** — this is the customer-facing brand surface, not the back office.

## 1.4 Admin side
- `/admin/members` gains: search, filter by status/product, impersonate ("view as member", audit-logged), reset password, suspend, delete (GDPR), manual enrollment grant/revoke, CSV import/export.

**Acceptance:** a brand-new visitor can register, verify email, log out, log back in, reset a forgotten password, update their profile, and appears in `/admin/members` — with no admin intervention.

---

# PHASE 2 — Offers, checkout & billing (the revenue path)

**Why:** Kajabi's core commercial model is missing. On Kajabi this business runs **20 products behind 57 offers** — one product is sold at many prices.

## 2.1 The Product ≠ Offer split (critical)
- **Product** = the thing that grants access (course, download, community, coaching, access group, podcast, newsletter, bundle).
- **Offer** = a sellable package: one or more products + a pricing model + a checkout page. Multiple offers per product.

Real examples to model against (all live on Kajabi today):

| Offer | Pricing model |
|---|---|
| `90 Day 1:1 Coaching Support - 3 x Payments` | payment plan — 3 × $1,250 |
| `90 Day 1:1 Coaching Support - One Time Payment` | one-time $3,500 |
| `12 Month 1:1 Consulting Support - 4 x Payments` | $3,000 every 3 months |
| `Private Room` | 10 × $400/mo |
| `Shared Room PIF` | one-time $3,500 |
| `Credentialing With Confidence Kit` | one-time $27 |
| `Lounge PIF Plan` | one-time $190 |
| `Therapist Directory Guide` | one-time $97 **and** 2 × $50 (two offers, one product) |
| `CEU course only` | one-time $149 |

## 2.2 Data
- `offers`: `id, title, slug, status (draft|published|archived), description, checkout_headline, thumbnail_url, currency, pricing_type (one_time|subscription|payment_plan|free|pwyw), amount_cents, interval, interval_count, installment_count, trial_days, collect_tax, collect_address, collect_phone, terms_url, redirect_url, thank_you_page_id, access_expires_after_days, created_at, updated_at`.
- `offer_products` (many-to-many), `offer_bumps` (order bumps), `offer_upsells` (post-purchase one-click, with `downsell_offer_id`).
- `orders`, `order_items`, `transactions`, `subscriptions`, `payment_plans`, `refunds`, `invoices`, `tax_records`, `abandoned_checkouts`.
- `coupons`: percentage/fixed, per-offer or global, max redemptions, expiry, first-payment-only vs forever; `coupon_redemptions`.

## 2.3 Checkout
- **New public route `/checkout/:offerSlug`** (does not exist today — only the success page does).
- Stripe Payment Element. Support: card, Apple Pay / Google Pay, and 3DS/SCA.
- Order form fields configurable per offer (name, email, address for tax, phone, custom fields, terms checkbox).
- Coupon field with live revalidation.
- **Order bumps** rendered inline on the checkout page.
- **Post-purchase upsell/downsell** flow: `/checkout/:offerSlug/upsell/:step` — one-click charge against the saved payment method, no re-entry of card details.
- Guest checkout that provisions a member account and emails a set-password link; if the email already has an account, attach the purchase to it.
- **Abandoned checkout capture** — persist email as soon as it's entered; recovery emails at +1h, +24h, +72h (Kajabi reports revenue recovered from these; the report must exist in Phase 9).
- Success → `/checkout/success` (already exists) → then straight into `/library`.

## 2.4 Webhooks & lifecycle
Handle at minimum: `checkout.session.completed`, `payment_intent.succeeded|payment_failed`, `invoice.paid|payment_failed`, `customer.subscription.created|updated|deleted`, `charge.refunded`, `charge.dispute.created`. Idempotency keys on every write; store the raw event; retry-safe.
Lifecycle rules: grant access on first successful payment · revoke on subscription cancel/expiry (configurable grace) · dunning emails on failed payment · pause/resume · proration on plan change.

## 2.5 Member billing portal (`/account/billing`)
View + download invoices/receipts · update payment method · view upcoming charges and remaining installments · cancel subscription with a **reason capture** (Kajabi reports on cancellation reasons — capture them) · pause · view full purchase history.

## 2.6 Admin
`/admin/sales/offers` (list, editor, duplicate, publish) · upsells tab · issue full/partial refund · manually grant/revoke an offer · resend receipt · charge an existing customer · tax settings · payouts view.

**Acceptance:** you can create an offer with a 3-payment plan, add an order bump and one upsell, buy it end-to-end in Stripe test mode as a brand-new person, land in `/library` with access, see the invoice in `/account/billing`, cancel with a reason, and see the whole thing reflected in `/admin/sales/*`.

---

# PHASE 3 — Product delivery: the member experience

**Why:** 17 courses exist as marketing entries with **zero lessons** and no way for anyone to consume anything.

## 3.1 Member library (`/library`)
Grid of everything the member has access to, grouped by type, with progress rings, "continue where you left off", and expiring-access badges.

## 3.2 Course player (`/library/:productSlug` and `/library/:productSlug/:lessonSlug`)
- Sidebar outline: modules → lessons, completion ticks, locked/dripped states.
- Lesson body types: **video, audio, text/rich content, PDF/file downloads, embed**. Video needs a real player (HLS or a hosted provider), resume-at-timestamp, playback speed, captions/transcript.
- Mark complete (manual + auto at 90% watched), prev/next, overall progress %.
- **Drip scheduling**: unlock by days-after-enrollment or by fixed date; a site-wide "drip release time of day" setting (Kajabi has exactly this).
- Per-lesson **comments** with admin replies and moderation.
- Member **notes** per lesson.
- Downloadable assets with signed, expiring URLs.
- Mobile-first layout — a large share of this audience is on a phone.

## 3.3 Digital downloads
Most Kajabi products here are type **Download** (`Private Practice Protection Pack`, `Fully Booked Toolkit`, `Client Consultation Call Script`, `Provider Partnership Guide`, `From Profile to Profit`, `Marketing Mastery for Therapists`, `Therapist Niche Clarity Accelerator`, `Prepare to Profit`, `The Private Practice Planner`). Build a proper download product type: file list, signed expiring links, download counts, re-download from `/library`.

## 3.4 Certificates
Kajabi products expose a **Certificates** tab, and this business sells **CEU** courses (`CEU course only — $149`, `/continuing-education-boss-clinician`, `/ceu-terms-boss-clinician`). Build:
- Certificate template per product (title, body, signature image, logo).
- Issue on 100% completion (and/or on passing an assessment).
- Generated PDF with a unique verification code + public `/verify/:code` page.
- CEU fields: credit hours, provider number, completion date.

## 3.5 Community (member-facing)
The admin has channels/posts/comments/challenges/badges/leaderboard/events; **members have no way in**. Build `/community`:
feed + channels · create post (rich text, image, video, poll) · comment threads · likes/reactions · @mentions · notifications (in-app + email digest) · member directory & profiles · **challenges** with entry submission and approval · **badges** and **leaderboard** display · community **events** with RSVP and calendar links · moderation tools (pin, lock, hide, report, ban) · search.

## 3.6 Coaching (member-facing)
Admin has coaching offers + sessions; members can't book. Build:
- Coach availability rules + calendar connection (Google/Outlook), timezone-correct.
- `/coaching` booking flow: pick package → pick slot → confirm → calendar invite + video link (Zoom is already referenced in the codebase; TidyCal and Calendly are referenced too — support at minimum one native flow plus an embed fallback).
- Session detail page: agenda, shared notes, attachments, recording link, reschedule/cancel with policy window.
- Package credit tracking ("3 of 6 sessions used").
- Reminder emails at 24h and 1h.

## 3.7 Podcast & newsletter (member-facing)
- Public podcast pages: show page + episode pages + player (mirrors `bossclinician.com/podcasts/lyrical-reflections` and its 9 episodes).
- **Private podcast feeds**: the admin already mints tokens — expose a member page that shows their personal RSS URL with copy-to-clipboard and Apple/Spotify instructions.
- Newsletter issue archive + per-member subscription preferences.

**Acceptance:** a member who bought in Phase 2 can open a course, watch a dripped video lesson, resume it on another device, complete it, download the PDF workbook, receive a certificate PDF, post in a community channel, and book a coaching session — all without an admin touching anything.

---

# PHASE 4 — Unified contacts, tags & segments

**Why:** the platform has three disconnected silos (`leads`, `subscribers`, `members`). Kajabi has **one Contact object with 393 rows**, carrying tags, lifetime value, last activity and email-marketing status — and the entire automation system keys off it.

- Introduce `contacts` as the single identity, keyed on email. `leads`, `subscribers`, `members` become roles/attributes on a contact, not separate people. Write a migration that merges existing rows by email and preserves every foreign key.
- Contact fields: `name, email, phone, timezone, email_marketing_status (subscribed|opted_out|bounced|complained), lifetime_value_cents, last_activity_at, source, custom_fields (jsonb)`.
- **Tags**: `tags`, `contact_tags`. The live Kajabi account drives its whole quiz funnel off tags like `quiz-visionary`, `quiz-steady`, `quiz-careful`, `quiz-reluctant`, `Retreat Waitlist 2027`, `Bali 2027 Attendee`. Tag CRUD, bulk tag/untag, tag-based access.
- **Segments**: saved filters over any attribute/tag/purchase/activity, used as email audiences and automation conditions.
- **Activity timeline** per contact: form submissions, page views, email opens/clicks, purchases, refunds, enrollments, lesson completions, community posts, session bookings, tag changes.
- CSV import (with field mapping + dedupe) and export.
- `/admin/contacts` replaces the three separate list pages; keep redirects from the old admin routes.

**Acceptance:** one person who opted in as a lead, subscribed to the newsletter, and later bought a course appears as **one** contact with a full timeline, correct lifetime value, and their tags.

---

# PHASE 5 — Email sequences & automations

**Why:** the platform has one-off campaigns only. Kajabi runs **142 automations** and multi-email **sequences** here.

## 5.1 Deliverability first
Replace raw SMTP with a transactional/marketing provider that reports engagement (Resend, Postmark, SendGrid or SES + webhooks). The current admin explicitly notes opens/clicks stay at zero on plain SMTP — that is a real blocker for the reports in Phase 9. Implement: SPF/DKIM/DMARC setup docs, a verified sending domain, bounce/complaint handling that flips `email_marketing_status`, and a suppression list.

## 5.2 Sequences (drip)
- `email_sequences`, `sequence_emails` (delay in days/hours, send window, subject, body, from-name), `sequence_subscriptions` (contact, position, state, next_send_at).
- Live shape to match: `SEQUENCE 1 · THE VISIONARY BUILDER`, `SEQUENCE 2 · THE CAREFUL CLINICIAN`, `SEQUENCE 3 · THE STEADY GROWER`, `SEQUENCE 4 · THE RELUCTANT CEO` — each ~5 emails over 8 days, each fired by a different quiz result form and each emitting a tag on completion.
- Support: pause/resume, skip weekends, per-contact timezone send, exit conditions (e.g. on purchase), re-entry rules.

## 5.3 Broadcasts
Extend the existing campaign feature with: audience = segment, scheduling, timezone-aware send, A/B subject test, preview/test send, plain-text alternative, **folders** (Kajabi groups them), duplication, and per-broadcast open/click/unsub reporting.

## 5.4 Automations engine
Visual (or at minimum structured) rule builder: **When → If → Then**.

Triggers to support (all in live use): form is submitted · offer is purchased · email sequence is completed · tag is added/removed · subscription cancelled/payment failed · event registered/attended · assessment completed/passed · lesson or course completed · community post created · contact created · date/anniversary · abandoned checkout.

Actions to support: send an email · subscribe/unsubscribe to a sequence · add/remove a tag · grant/revoke an offer or product · register for an event · create a task/notification · fire an outbound **webhook** · wait N days · branch on condition.

Also required: run history per automation, a **test-this-automation** action (the admin UI already implies one), and safeguards against infinite loops.

## 5.5 Preferences & compliance
Granular email preferences (per newsletter/topic, not just global unsubscribe) · one-click unsubscribe header · physical address + unsubscribe link in every marketing email · CAN-SPAM/GDPR consent capture with timestamp and source · double opt-in option.

## 5.6 System email templates
Editable templates for: welcome, email verification, password reset, purchase receipt, invoice, access granted, payment failed, subscription cancelled, coaching reminder, community digest, certificate issued.

**Acceptance:** submitting the "Quiz — Visionary Builder" form tags the contact `quiz-visionary`, enrolls them in a 5-email sequence over 8 days, and on completion adds a second tag — visible in the contact's timeline and in the automation's run history.

---

# PHASE 6 — Forms, assessments/quizzes & events

## 6.1 Form builder
Kajabi has **45 forms** here. Build: drag-order field builder (text, email, phone, select, radio, checkbox, textarea, date, file, hidden, consent), required/validation rules, custom field → contact field mapping, spam protection (honeypot + rate limit + optional Turnstile/reCAPTCHA), post-submit action (redirect, inline message, download, trigger automation), embeddable snippet + public hosted page, submission list with export.

## 6.2 Assessments / quizzes with scored branching
This is a core acquisition mechanic and the platform only has one hardcoded quiz page.
- Question bank, answer weights, scoring, pass mark.
- **Result branching**: score → one of N result pages. Live example: the offer quiz routes to 4 archetypes (Visionary Builder / Steady Grower / Careful Clinician / Reluctant CEO) each with its own landing page, form, tag and email sequence.
- Live quizzes to reproduce: `/practice-quiz`, `/offer-quiz`, `/hiring-quiz`, `/boss-assessment`, `/start-your-own-private-practice-quiz`, `/practice-set-up-quiz`, plus in-course assessments (`Post-Test: Audit Proof Your Practice`, `4-Step Blueprint to Building a Profitable Private Practice`).
- In-course graded assessments with attempts, feedback, and pass → certificate.

## 6.3 Events & webinars
Kajabi has **22 events** here, including recurring/evergreen ones ("Every 15 minutes", "Hourly", "Daily", "Every 4 days").
- Event types: **live** (fixed datetime), **evergreen/just-in-time** (recurring every N minutes/hours/days relative to the visitor), **replay** with an expiry window ("End of Replay" events are in live use).
- Registration page + form → confirmation → calendar file → reminder emails (24h, 1h, at-start) → live room (embed/Zoom) → replay page with countdown-to-expiry → post-event automation split by attended / didn't attend / attended-but-didn't-buy (these exact segments exist as live forms).
- Registrant list, attendance tracking, conversion reporting.

**Acceptance:** an evergreen masterclass can be registered for at any time, sends reminders, opens a just-in-time room, expires its replay on schedule, and splits registrants into attended / no-show automations.

---

# PHASE 7 — Pages, funnels, CMS, SEO & migration off Kajabi

**Why:** the live Kajabi site has **111 landing pages** and 125 indexed URLs. The new platform has a raw JSON editor for **3 pages** and — critically — **no `sitemap.xml` and no `robots.txt`** (both currently return the SPA shell). As a client-rendered SPA it is effectively invisible to search. Migrating without fixing this will destroy existing organic traffic.

## 7.1 SEO foundation (do this first in the phase)
- **SSR or prerendering** for every public route (Vite SSR, or a prerender step at build time). Non-negotiable.
- Per-page `<title>`, meta description, canonical, Open Graph + Twitter cards, JSON-LD (`Organization`, `Person`, `Article`, `Course`, `FAQPage`, `PodcastEpisode`, `Product`/`Offer`).
- Generated `/sitemap.xml` (pages, blog posts, courses, podcast episodes, landing pages) and a real `/robots.txt`.
- Image optimization + `alt` text everywhere, Core Web Vitals budget.

## 7.2 Redirect map (traffic protection)
Build a `redirects` table + middleware, then create a 301 for **every one of the 125 live URLs** in Appendix B → its new equivalent. Add an admin UI for redirects and a 404 report showing unmatched paths. Ship this in the same deploy as the DNS cutover.

## 7.3 Page & funnel builder
Replace the raw-JSON page editor with a real section-based builder:
- Reusable section library matching the existing design system (hero, offer cards, testimonial carousel, FAQ, pricing table, opt-in form, video, countdown timer, rich text, CTA band, logo strip, Instagram feed).
- Draft/publish, scheduled publish, preview, duplicate, page-level SEO fields, custom head/body scripts.
- **Landing pages** distinct from site pages, each with its own slug and optional funnel membership.
- **Funnels** = ordered steps (opt-in → thank you → sales → checkout → upsell → confirmation) with per-step view/conversion tracking; the API stubs already exist (`GET /api/funnels/:slug`) — finish them.
- **A/B testing** on landing pages with traffic split and a winner report (Kajabi's page list has an A/B test tab in use).
- Navigation editor (header/footer menus) and a branding/theme editor (colors, fonts, logo, favicon) to replace the JSON settings blob.

## 7.4 Blog parity
Tags/categories with archive pages (`/blog?tag=...` is live and indexed — 20+ tag URLs), author profiles, related posts, RSS feed, scheduled publishing, reading time, share buttons. Keep the existing AI-assisted drafting.

## 7.5 Content migration
Port from `bossclinician.com`: all landing pages, thank-you/confirmation pages, quiz pages and result pages, lead-magnet opt-in pages, legal pages (`/terms-of-use`, `/terms-of-service-boss-clinician`, `/coaching-terms`, `/ceu-terms-boss-clinician`, `/retreatagreement`, `/disclaimer`, `/financialdisclaimer`, `/privacy-policy`), the podcast and its 9 episodes, the blog and its posts, the link-in-bio page, and the resource hub.

**Acceptance:** `curl https://<site>/sitemap.xml` returns real XML listing every public URL; view-source on `/blog/<slug>` shows the article text without JS; every URL in Appendix B returns 301 to a live page.

---

# PHASE 8 — Affiliates / partner program

Kajabi has a full Affiliates module (Overview, Commission setup, Share links, My affiliates, Transactions, Announcements, Settings). None of it exists on the new platform.

- Affiliate signup + approval, unique share links per offer, cookie attribution with configurable window, first-click vs last-click.
- Commission rules: % or fixed, per-offer overrides, recurring commissions on subscriptions, cookie-window and refund clawback rules.
- Affiliate portal: dashboard, links, creative assets, transactions, payout history, announcements.
- Admin: approve/reject, adjust commissions, mark payouts paid, export for payment, leaderboard, per-affiliate reporting.

---

# PHASE 9 — Analytics & reporting parity

The platform has 4 reports. Kajabi exposes **35**. Build a reports framework (shared date-range picker, currency selector, comparison-to-previous-period, CSV export, saved views) and implement:

**Payments:** gross revenue · net revenue · refunds · payments by method · payments by pricing type · payments by country/state · free offers over time · paid invoices over time · sales tax · offers sold · cart orders over time.
**Sales:** offer purchases over time · payments by offer · upsell purchases over time · revenue recovered from abandoned checkout emails.
**Subscriptions:** new subscriptions · MRR · canceled subscriptions (with reason breakdown) · customer-initiated cancellation feedback · subscription status by offer · payment retention · churn rate · ARPU · subscription forecast.
**Payment plans:** new payment plans · status by offer · MRR from plans · canceled plans.
**Contacts:** new contacts over time · top customers by spend · opt-ins.
**Products:** product progress (per-member completion).
**Website:** page views by landing page.
**Affiliates:** performance, commission, members referred.
**Email:** sends, opens, clicks, unsubscribes, bounces per broadcast and per sequence email.

Dashboard: gross revenue, subscription revenue, opt-ins, offers sold, net revenue all-time, Stripe balance, trend sparkline vs previous period, customizable metric tiles — matching the Kajabi dashboard the owner uses daily.

---

# PHASE 10 — Settings, roles, integrations & hardening

## 10.1 Replace the JSON settings blob with real settings screens
Payment setup · checkout customization (branding, fields, terms) · customer payments (receipts, subscription rules, access on cancel) · **tax** · site details & SEO · branding · domain · marketing email settings (from-name, address, footer) · **email templates** · **drip release time** · blog settings · form settings & spam protection · **integrations & webhooks** · member sign-in & security · **scheduling/availability** · notifications.

## 10.2 Admin users & roles
Multiple admin users; roles (Owner / Admin / Marketing / Support / Coach) with per-module permissions; invite flow; MFA (TOTP); session list + revoke; **audit log** of every admin mutation (who, what, before/after, when).

## 10.3 Integrations
Outbound webhooks with signed payloads + delivery log and retries · Zapier-compatible REST + API keys · GA4 and Meta Pixel with server-side conversion events · Zoom · Google Calendar / Outlook · Calendly/TidyCal embed fallback · Stripe (already partial) · optional accounting export.

## 10.4 Security (apply retroactively to everything already built)
Parameterized queries only (the leads table already contains an SQLi probe) · input validation on every endpoint with a schema library · output escaping · authorization checks on every admin and member route (deny by default; verify object ownership, not just authentication) · rate limiting on all public POSTs · CSRF protection on cookie-authenticated routes · signed, expiring URLs for all protected media · secure headers + strict CSP · secrets only in env · dependency audit in CI · PII encryption at rest for sensitive fields · GDPR data export + delete-my-account · backup and restore runbook.

## 10.5 Operations
Background job queue with retries and a dead-letter view (sequences, campaigns, webhooks, video processing, report rollups all need it) · error tracking · uptime + webhook-failure alerting · staging environment · seed script · smoke tests on deploy.

---

# DEFINITION OF DONE (whole project)

A therapist who has never heard of Boss Clinician can:
land on an SEO-indexed page → take a quiz → get tagged and dripped a 5-email sequence → register for an evergreen masterclass → buy a $27 offer or a 3-payment $3,750 coaching package with an order bump → get an account, a receipt and instant access → watch dripped lessons, download workbooks, earn a CEU certificate → post in the community → book and attend coaching sessions → manage their own card, invoices and cancellation.

And Yvette can run **all** of it — products, offers, contacts, tags, sequences, automations, funnels, landing pages, community, coaching, affiliates, and 35 reports — without logging into Kajabi.

---

# APPENDIX A — Kajabi modules observed (parity checklist)

| Kajabi nav | Sub-items | New platform status |
|---|---|---|
| Products | All Products, Courses, Coaching, Community, Podcasts, Newsletters, **Downloads** | admin exists; **no member delivery**; downloads type missing |
| Sales | Payments, **Pricing/Offers**, Payouts, **Cart**, Invoices, Coupons, **Affiliates** | offers, cart/checkout, affiliates missing |
| Website | **Design/theme**, **Website Pages**, **Landing Pages**, **Navigation**, Blog | only a 3-page JSON editor + blog |
| Marketing | Overview, Email Campaigns, Funnels, Automations, Events, Forms | UI shells exist, engines missing |
| Contacts | All Contacts, Insights, **Assessments** | three separate silos; no tags/segments/assessments |
| Analytics | Overview, **Reports (35)** | 4 reports |
| Agents / Media Library / Amplify / Partner Program / Backstage | — | media library exists; rest missing (Amplify/Backstage/Capital are Kajabi-network features, out of scope) |
| More | Capital, **Branded App**, Expert Services, **Custom Templates** | branded app + templates missing |
| Settings | 20+ settings screens incl. tax, drip time, integrations & webhooks, member sign-in, scheduling, users, MFA | one raw JSON blob |

Live volumes to size against: 20 products · 57 offers · 111 landing pages · 45 forms · 142 automations · 393 contacts · 22 events · 2 assessments · 1 funnel · 9 podcast episodes · 8+ blog posts with 20+ tags · $12,010 all-time revenue.

---

# APPENDIX B — Live bossclinician.com URLs requiring 301 redirects (104 pages + 21 blog-tag URLs = 125)

```
/                                             /link-in-bio
/5-step-marketing                             /marketing-step-form
/Practice-Protection-Pack                     /masterclass-review-sheet
/Protect-Your-Practice                        /next-steps-consult
/Turn-Doctor-Referrals-Into-Ideal-Client      /offer-quiz
/about                                        /on-demand-audit-your-private-practice
/about_yvette                                 /podcasts/lyrical-reflections
/all-courses                                  /podcasts/lyrical-reflections/episodes/2148691037
/audit-private-practice-replay                /podcasts/lyrical-reflections/episodes/2148691038
/blog                                         /podcasts/lyrical-reflections/episodes/2148691039
/blog/audit-ready-documentation-private-practice          /podcasts/lyrical-reflections/episodes/2148691040
/blog/clinical-notes-vs-audit-ready-notes                 /podcasts/lyrical-reflections/episodes/2148691041
/blog/dont-let-fear-delay-your-private-practice           /podcasts/lyrical-reflections/episodes/2148691042
/blog/how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals   /podcasts/lyrical-reflections/episodes/2148691043
/blog/money-guilt-therapists-charging-fees                /podcasts/lyrical-reflections/episodes/2148691044
/blog/peace-of-mind-for-therapists-audit-preparedness     /podcasts/lyrical-reflections/episodes/2148691045
/blog/what-auditors-look-for-therapist-notes              /practice-planner
/blog/why-your-private-practice-marketing-isn-t-working-and-what-to-do-instead   /practice-planner-thank-you
/boss-assessment                              /practice-quiz
/boss-builders-sales-page                     /practice-reset-audit-ty
/boss-clinician-home                          /practice-reset-planner
/business-plan-guide                          /practice-set-up-quiz-ty
/business-plan-ty                             /privacy-policy
/careful-form                                 /privacy-policy-8b664a08-e1e5-4f19-8d9a-5cb8f33bf104
/ceu-terms-boss-clinician                     /private-practice-for-you
/coaching-terms                               /private-practice-for-you-ty
/confirmation-boss-clinician-lounge           /profile-audit-ty
/confirmation-page-1                          /profiletoprofitguide
/contact                                      /profitable-private-practice-leap-accelerator
/continuing-education-boss-clinician          /protectionpackthanks
/credential-with-confidencekit-Confirmed      /rampedrevenue
/credentialingsuccess                         /reluctant-form
/credentialwithconfidencekit                  /replay-audit-your-ppractice-edu
/csfgrouppractices                            /replay-audit-your-practice
/cwcsolopractice                              /reset-audit
/disclaimer                                   /reset-audit-form
/evergreen-masterclass-register               /reset-planner-form
/financialdisclaimer                          /resourcehub
/fullybooked                                  /retreat-thank-you-page
/fullybookedtherapist                         /retreatagreement
/heyyvettehere                                /start-your-own-private-practice-quiz
/hire-form                                    /starterconfirmed
/hiring-quiz                                  /startersuitecourse
/insurance-guide                              /steady-form
/kickstartguide                               /step-by-step-guide-thank-you-page
/leap-accelerator-thank-you                   /store
                                              /terms-of-service-boss-clinician
                                              /terms-of-use
                                              /thank-you
                                              /thank-you-audit-proof
                                              /thank-you-fullybooked
                                              /thank-you-rate-renegotiate
                                              /the-boss-builders-collective-thank-you-page
                                              /the-directory-makeover-audit
                                              /the-lounge-suite
                                              /visionary-form
                                              /webinar-waitlist-thank-you
                                              /work-with-me
```
Plus 21 indexed blog tag URLs of the form `/blog?tag=<tag>` (audit preparedness, audit readiness, audit-ready notes, boss clinician, clinical documentation, medical necessity, money guilt, practice confidence, practice growth, private practice audit, private practice compliance, private practice mindset, private practice pricing, private practice systems, therapist anxiety, therapist compliance, therapist documentation, therapist entrepreneurship, therapist leadership, therapist money mindset, therapist sustainability) — map to the new tag archive routes.

---

# APPENDIX C — Suggested order & sizing

| Phase | Blocks | Rough size |
|---|---|---|
| 0 Discovery | everything | 0.5 day |
| 1 Member identity | 2, 3 | 1 week |
| 2 Offers & checkout | 3, 8, 9 | 2–3 weeks |
| 3 Product delivery | — | 3–4 weeks |
| 4 Contacts & tags | 5, 6, 9 | 1 week |
| 5 Sequences & automations | 6 | 2 weeks |
| 6 Forms, quizzes, events | 7 | 2 weeks |
| 7 Pages, SEO, migration | cutover | 2–3 weeks |
| 8 Affiliates | — | 1 week |
| 9 Reports | — | 1–2 weeks |
| 10 Settings & hardening | cutover | 1–2 weeks |

**Do not cut over DNS until Phases 1–3, 7 and 10 are done.** Everything else can ship after the switch.
