# Kajabi → Boss Clinician admin — deep parity audit & Codex brief

Paste into Codex as a single brief. Every "Kajabi has" line below was read off the live
Kajabi account (site `2148299891`); every "Today" line was read off
`bossclinician.callsphere.site/admin`, mostly by creating records rather than just looking.

> ## Verified implementation update — 2 September 2026
>
> This section supersedes the older **Today** and **STILL-OPEN BUGS** statements below.
> The original observations are retained as historical evidence, but they are not the current
> implementation state. Verification covered the checked-out source, all database migrations,
> the production health endpoint, the production container health, a scratch Postgres database,
> unit tests, integration tests, TypeScript builds, and practical HTTP workflows.

### Verification Round 4 closure — deployed 2 September 2026

Round 4 was checked against both production data and the executable code rather than accepting the
screen report at face value. The release is live. The six reported bugs remain closed, and the
following Round 4 work is now deployed and practically verified:

| Round 4 item | Current verified result |
|---|---|
| B1 coupon rejection reasons | The cited `ZZONLYOTHER` code had already been deleted before the Round 4 test, so “We couldn't find that discount code” was the correct answer for that request. A fresh live restricted coupon was then exercised through the public quote endpoint. Unknown, wrong-offer, expired, exhausted and already-used states returned five different buyer-facing messages while leaving the total unchanged. The eligible offer accepted the same code. |
| C2 email image block | The shared campaign/sequence composer now opens the existing media library for Image. It supports search, previews existing public images and permits an upload without leaving the composer; selecting an asset inserts its real stored URL. A disposable PNG was uploaded, found after an API reload, fetched through the public URL with `image/png`, then deleted through the production media endpoint. |
| C7 funnel blueprints | Funnel purpose is no longer just a label. Opt-in, webinar, sales and launch choices transactionally scaffold connected stages, a published/draft capture form, a funnel-specific tag, a follow-up sequence and starter emails. Sales/launch can attach an offer. The detail panel now deterministically selects the newly created/clicked funnel, and a readiness card links the owned resources. Blueprint deletion cleans up those owned resources. A live webinar probe persisted 4 stages and 3 emails, exposed its public funnel and form, and left zero residue after deletion. |
| C1 customer payments | The customer-facing `/account/billing` portal was already live with card updates, invoice/receipt history and subscription pause/resume/cancel; Stripe webhook dunning was already idempotent. The admin payment settings now expose the portal, statement descriptor, receipt rule (every/first/non-zero), refund receipts, trial-ending and upcoming-payment reminder offsets, immediate first-failure access revocation, and an editable cancellation-reason library. Hourly idempotent reminder jobs, renewal receipts and refund confirmations use editable templates. A live save/reload/member-read probe passed and restored the original settings afterward. |
| C5 in-lesson assessments | The existing graded-assessment engine is now linked into course lessons instead of hidden as a standalone lead quiz. A lesson can select a graded test and pass mark/max attempts; an authenticated course member's attempts and scores are stored, a pass completes the assessment lesson, and prerequisite logic unlocks the next lesson. The member player embeds the test and refreshes immediately after a pass. A live 100% attempt persisted against a disposable member and unlocked the next lesson. |

Round 4 also repeated several stale “missing” claims. Campaign folders and deterministic subject A/B
were already live. Offer currency, tax, bumps, upsells and downsells were already present. Event replay
expiry, per-event reminders and `.ics` invitations were already implemented. Reports already contain
revenue by payment method, subscription retention and future-instalment forecasting. Plan entitlements
already cover every product kind rather than only communities.

This deployment does **not** turn the audit into a claim of total Kajabi feature parity. The genuine
remaining work is the narrower list under **What is really still missing** below: advanced course
product authoring, the remaining commerce controls, advanced email/template scheduling, reusable
custom fields and the complete form confirmation/conditional/multi-step flow, event recurrence and
physical locations, plus vendor-dependent integrations.

#### Round 4 verification evidence

- Production and SSR builds passed. Backend unit tests: **601 passed**; database-backed integration
  tests: **109 passed**; frontend tests: **27 passed**.
- Migrations `029_funnel_blueprints.sql` and `030_billing_controls.sql` applied during a health-checked
  backend/frontend rollout. Both containers reported healthy.
- The post-deploy public smoke suite passed **18/18**, including migration parity, member-route
  authentication, protected-file refusal and live queue freshness.
- Practical live acceptance passed the funnel blueprint/public form, media upload/library/public fetch,
  all five coupon rejection cases plus the valid case, billing setting persistence/member cancellation
  reasons, and graded-attempt persistence/prerequisite unlock. No checkout or charge was created.
- The first synthetic graded attempt used an impossible 1.2-second completion and was correctly treated
  as a bot. The realistic 3-second retry persisted normally; this was test-data correction, not an app
  defect.
- The named Round 4 funnel `ZZ Verify - webinar funnel` and every new disposable acceptance record were
  removed. Exact residue counts are zero. Test settings were restored, test admin sessions were logged
  out, and there are zero active loopback/scripted admin sessions.

### Verification Round 3 closure — deployed 2 September 2026

The post-claim live report was treated as a new defect report and reproduced against production.
The following changes are now deployed and verified:

| Round 3 item | Current verified result |
|---|---|
| B1 coupon failure feedback | Checkout now distinguishes unknown, inactive, not-yet-active, expired, wrong-offer, usage-cap, currency and already-used failures. The field is visibly red, uses `aria-invalid`, and announces the exact reason. A disposable wrong-offer coupon returned `That discount code isn't valid for this offer.` over the live public quote API while leaving the total unchanged. |
| B2 coupon editing | Coupons now have a prefilled Edit dialog for amount/percentage, expiry, cap, duration and offer restrictions. The local coupon id and redemption rows are preserved; when Stripe is configured the immutable Stripe coupon is replaced transactionally. The cap cannot be lowered below the redemption count. A live create → edit → read → delete probe preserved the id and all changed rules, then removed both local and Stripe metadata. |
| B3 Insights drill-through | Every headline metric, opt-out reason and engagement cohort now links to a real server-side filter. `audience`, `status`, `optOut` and `engagement` filters use the same definitions as the Insights counts. Live `engagement=unengaged` and `status=bounced` requests both returned filtered contact collections. |
| B4 dead Quiz lesson option | Removed from the lesson-type selector. There are no assessment lessons or graded lesson attempts in production, so retaining a non-functional choice was misleading. The existing standalone assessment system remains available; true in-lesson assessment selection/pass gating is still a product gap. |
| B5 phantom sessions | Migration `028_admin_session_visibility.sql` marks loopback and scripted clients non-interactive, revokes the historical rows and excludes them from the security screen. New human sign-ins replace duplicate rows for the same browser/IP fingerprint. Production now has zero active internal sessions; the old loopback rows are retained only as revoked audit history. |
| B6 Insights navigation | Insights is now a first-class entry in the Contacts navigation group. |
| D1 tight controls | Shared admin small buttons and icon buttons now have a 44px minimum target. Checkbox labels in the changed flows carry the click target rather than requiring a centre hit. |
| D2 confirmations | No defect reproduced: destructive confirmations use Radix `Dialog`, `Dialog.Title` and `Dialog.Description`, with labelled action buttons and managed focus. |
| D3 plan grants | Stale report item: plan-to-product entitlements for courses, downloads and the rest of the catalogue were already deployed and are integration-tested. |
| D4 community id | Production contains no community `id=1`, so that URL correctly has no record to resolve. The real production community (`id=2`) returned HTTP 200 through the authenticated API after this deploy. |

Round 3 also exposed existing but unreachable campaign capabilities. Campaign folders and the
already-implemented deterministic subject A/B split are now available in the composer and persist
through the API. Campaigns and sequence emails now share a starter-template/block composer with text,
headings, lists, images, CTA buttons and dividers plus desktop preview; the outbound renderer produces
escaped, email-safe HTML for those blocks. This is not yet the full §3.3 target: custom saveable
templates, a media-library picker, mobile preview, two-column/product/social blocks, a merge-tag picker,
and use in newsletters/system emails remain open.

The Round 3 test records named in the verification report were removed: the `$8 x 3` pricing option,
`ZZFIXED5`, `ZZONLYOTHER`, the Sunday/Wednesday availability additions, the pending team invitation,
and the Priya Formtest/Nina contacts. The live acceptance campaign and coupon were also deleted in a
`finally` cleanup; residue counts are zero. The underlying `ZZ Test - checkout probe` offer was left
live because the report marked only its added pricing option as safe to delete.

### What this pass shipped

| Area | Verified result |
|---|---|
| Plan access | A recurring plan can now unlock any number of catalogue products—courses, downloads, communities, coaching, podcasts, newsletters, access groups or bundles. The Stripe subscription webhook creates subscription-bound grants and revokes only those grants when the subscription ends. Existing `community_id` plans are migrated without losing access. |
| Course lessons | The editor and API now persist audio lessons, lesson thumbnails, “finish the previous lesson first”, and multiple protected downloads. The member outline enforces prerequisites across section boundaries and explains exactly which lesson must be finished. |
| Contact Insights | `/admin/contacts/insights` now shows contacts, new contacts, mailable subscribers, new subscribers, customers, new customers, manual opt-outs, other opt-outs, bounces, spam complaints, never-subscribed contacts, and the 0–90 / 91–180 / 181–270 / 270+ day engagement cohorts. |
| Contact bulk actions | The existing checkboxes now drive add/remove tag, start sequence, grant offer, CSV export and confirmed bulk deletion. Mutating actions require `contacts.manage`; CSV output neutralises spreadsheet formulas. |
| Coupons | The coupon form now supports percentage or fixed-amount discounts, expiry dates, redemption limits, selected-offer restrictions, currency for fixed discounts, and first-payment versus every-payment duration. These rules are enforced by the existing checkout coupon ledger, not only displayed in the admin. |
| Multiple offer prices | One offer can now carry additional labeled one-time, subscription, payment-plan, free or pay-what-you-want options. One option can be recommended, the public checkout renders the choices, quote and order endpoints re-resolve the selected database row, recurring options pin their own Stripe Price, and orders retain the selected option id. |
| Test safety and data | The integration runner is serialised and forcibly disables SMTP, SES, Resend and workers. New acceptance cases use realistic people, course, download, plan, lesson, offer and coupon data and verify behavior over real HTTP and Postgres. No test can send a customer/staff email or touch Stripe. |

### Verification and live deployment evidence

- Backend unit suite: **601 passed**; integration suite: **107 passed**; frontend suite:
  **27 passed**. Backend TypeScript, frontend production and SSR builds, and the final diff
  whitespace check all passed.
- The production deployment completed on **2 September 2026** with the AI, backend, frontend,
  database and proxy services running; the backend and frontend containers reported healthy.
  Migrations `025_plan_product_entitlements.sql`, `026_lesson_depth.sql`,
  `027_offer_pricing_options.sql` and `028_admin_session_visibility.sql` were applied, producing
  the expected **135 public tables** plus the session-visibility column/index.
- A production owner session exercised the new endpoints with realistic disposable data:
  Maya Thompson, a two-product B.O.S.S. Club plan, and a Clinical CEO Intensive draft with a
  recommended six-payment option. Contact Insights, safe selected CSV export, bulk deletion,
  plan create/product-only update/read/delete and payment-option create/reprice/read/delete all
  passed: **18/18 acceptance checks**. The final residue query returned zero records.
- The public post-deploy smoke suite passed **18/18**: health, primary pages, crawler files,
  redirects, anonymous member API refusal, forged protected-file refusal, migration parity and
  queue freshness. No payment or checkout was attempted against the live Stripe account.
- The Round 3 live acceptance pass added **15/15** checks for the new migration, session filtering,
  Insights/filter agreement, campaign folder/A-B persistence, explicit wrong-offer coupon feedback
  and cleanup. A separate authenticated request resolved the real community id. It created no charge,
  checkout, Stripe object or outbound email.
- A separate coupon lifecycle probe passed **4/4** against the configured live Stripe account: create,
  edit without changing the local id, read-after-edit and delete. Only coupon metadata was created;
  no customer, checkout, payment, charge or email was involved, and the final residue count was zero.
- The queue retains **92 historical dead letters** from 17–18 August 2026, all produced by the
  old coaching-reminder SQL alias defect. The repaired handler has completed **96 successful
  sweeps in the latest 24-hour window** with no fresh dead letters. They were deliberately not
  retried because doing so could send obsolete appointment reminders; the smoke test now fails
  on fresh dead letters while still reporting retained historical evidence.

### Reality corrections to the original audit

The repository and live database were already considerably ahead of this document. These are
implemented today and must not be rebuilt as if absent:

- Coaching has weekly availability, overrides/blackouts, caps and booking windows, member booking,
  rescheduling/cancellation, credit-safe concurrency, `.ics` invitations, session files and recordings.
  External Google/Microsoft calendar conflict sync is still absent.
- Community has rich post types, images/video, polls, replies, reactions, moderation and both member
  and admin leaderboards. Scheduled posts and channel-level entitlement rules remain gaps.
- Podcast publishing already rejects a live episode without audio. Private-feed tokens and signed
  episode audio are implemented. Chapters, transcript authoring and submission checklists remain gaps.
- Newsletters already have scheduled issues, paid access and a member archive. An anonymous public
  archive remains a gap.
- The customer account already has subscriptions, self-serve pause/resume/cancel, cancellation reason
  capture, card update with Stripe Billing Portal plus a SetupIntent fallback, invoices and HTML receipts.
- Reports already include revenue by payment method, subscription retention and future-instalment
  forecasts, alongside the large report catalogue. The original “missing entirely” statements are stale.
- Team roles and permissions, invitations/suspension, TOTP MFA and recovery codes, webhook event
  catalogue/delivery logs/retries, API keys, and the admin audit log already exist.
- Media already supports search, rename and folders; usage tracing, tags, alt text and replace-in-place
  are the remaining media work.
- Forms store double-opt-in and spam-provider choices, but the public challenge/confirmation flows are
  not fully wired. Configuration fields alone are not counted as a finished feature.
- The seven bugs in §7 are closed: six were already fixed in the current tree; product-level plan
  access was the remaining confirmed defect and is included in this pass.

### What is really still missing

These are confirmed product gaps, not regressions fixed by this pass:

1. **Course product shell:** limited-access/paywall twins, course-level settings and comment lock state,
   live rooms, course-to-community presentation, a per-course customer/progress screen, the certificate
   designer UI, and drag-and-drop authoring. Certificate issuance, unique verification codes, PDF files,
   completion checks and email delivery already exist underneath the missing designer.
2. **Commerce depth:** scheduled access starts, quantity/time availability limits, detailed per-offer tax classification,
   gift checkout, and a site-level shared upsell library. Stripe automatic payment methods are enabled,
   but Klarna/Afterpay availability depends on the connected Stripe account and PayPal is not implemented.
3. **Marketing authoring:** finish the shared composer with custom saveable templates, advanced
   blocks, mobile preview, merge-tag selection and newsletter/system-email use;
   event-relative campaign timing and automatic A/B winners; first-class object-scoped automation
   panels; sequence inline reports; global reusable custom fields; and the complete double-opt-in/
   bot-challenge public flow. Campaign folders and live subject splits are no longer gaps.
4. **Programme depth:** coaching programme outlines/default sessions/client progress, group attendance,
   multiple reminder offsets and notification matrix; richer funnel blueprint catalogue/statistics;
   recurring event rules and physical locations.
5. **External integrations:** Google/Microsoft calendar OAuth and conflict reads, PayPal payouts/checkout,
   and live DNS verification for a custom sending domain require vendor applications, redirect URLs,
   credentials and/or DNS changes that are not present in this repository. They cannot be truthfully
   marked “working” from code alone.

This is therefore a verified parity ledger, not a claim that Boss Clinician is a byte-for-byte Kajabi
clone. The excluded scope below remains excluded, and vendor-dependent items remain explicitly blocked
until the corresponding accounts and credentials are supplied.

## SCOPE — what is deliberately excluded

Do **not** build any of these:

- The website / page builder, themes, section editor, custom code editor, checkout page
  templates, landing pages, blog and testimonial page design, Kajabi Templates library.
- The mobile / branded app and `mobile_app_configs`.
- **Labs** (beta feature flags).
- **Partner Program** (Kajabi's own refer-a-friend / affiliate-of-Kajabi programme).
- **Amplify** (Kajabi's creator network).
- **Expert Agents / AI** (Cofounder, AI chat agents, AI course generator, proactive nudges).
- Everything in Kajabi's **"More"** menu: Capital, Branded App, Expert Services,
  Custom Templates.
- Kajabi's own account/billing pages (Subscription, plan limits, Kajabi Access,
  Partner Dashboard).

Everything else in the Kajabi admin is in scope.

---

# 1. PRODUCTS

## 1.1 Course products
**Kajabi has** — a course product with tabs **Outline / Customize / Offers / Customers /
Certificates / Settings / More**:
- Outline is a drag-and-drop tree of **modules → posts**, each with its own
  Draft/Published state and an "Add Content" action per module.
- **Per-module drip release**, with the release hour set once in Settings → Drip settings.
- A **Paywall** element you drag into the outline. Adding it auto-creates a **"limited
  access product"** twin — a second product that exposes only the content *above* the
  paywall — and you nominate a **paywall offer** shown when a limited member hits gated
  content. (The live account has both `test` and `test - limited access` offers.)
- **Certificates** tab with a designer: logo, certificate title, recipient subtitle, show
  student name, course subtitle, include course title / completion date / **unique
  certificate serial number** / **expiration date** / a custom field, background image.
  Emailed automatically on completion.
- **Live Rooms** — "provide a live video session for this course", up to 200 participants.
- **Community linking** — attach an existing community circle to the course experience.
- **Comment settings** — enable comments per course, override per lesson,
  and **Lock all comments** (existing stay visible, no new ones).
- **Customers** tab per product.

**Today** — `/admin/courses/:id/curriculum` has sections → lessons, with (newly added and
verified) section rename, **per-section drip** (immediately / N days after purchase / on a
date, consuming Settings → Delivery for the hour), reorder up/down on sections and lessons,
and a per-lesson "Edit & schedule".

**Gap → build**
1. **Paywall / limited-access twin** and its paywall offer. Nothing equivalent exists.
2. **Certificate generator + designer** with serial number and optional expiry, wired to the
   existing "Certificate issued" system email. Today that email has nothing behind it.
3. **Per-lesson prerequisites** ("must finish the previous lesson") and a member-facing
   locked state showing the unlock date.
4. **Live room** per course.
5. **Course ↔ community link**.
6. **Per-course Customers tab** (enrolled, progress, last activity).
7. **Comment settings** at course level with per-lesson override and lock-all.
8. Drag-and-drop reordering (arrows exist; dragging does not).

## 1.2 Lessons / posts
**Kajabi has** — title, module selector, **Media: None / Video / Audio**,
**Downloads (multiple attached files)**, a rich body editor, **per-lesson Automations**,
Draft/Published, **lesson thumbnail**, and **Comments: Visible / Hidden / Locked**.

**Today** — name, one video (upload or pasted link), rich-text notes, duration, "free
taster", visible, plus the new "Edit & schedule".

**Gap → build** multiple attachments/downloads per lesson; an audio lesson type; a lesson
thumbnail; per-lesson automations (reuse the global registry); per-lesson comments with
Visible/Hidden/Locked; an embedded assessment block (see §3.6).

## 1.3 Coaching
**Kajabi has** — coaching is a **product type** with tabs **Clients / Package outline /
Offers / Settings**:
- **Package outline** = a numbered session plan (24 in the live example), each session with
  its own actions, plus an "Additional session default" template.
- **Clients** tab with Active / Past and per-client progress.
- Settings → **Scheduling preference**: Kajabi-native ("set availability and book sessions
  inside of Kajabi") **or** an external link (Calendly / Acuity / Google).
- **Location** per session incl. **Kajabi Live Video** (built-in 1-hour room).
- **Per-session reminders** — "send a reminder [N] before the session start time", multiple,
  addable/removable.
- **Kajabi Live Recording** — auto-upload the recording into the session record.
- **Additional purchases** — "offer additional 1:1 coaching sessions" inside the programme.
- **Notification matrix** — coach vs client, per event ("when a change to the coaching
  session is saved (shared notes, resources…)", "when a recording is uploaded").
- Site-level **Scheduling** page: weekly availability grid (Sun–Sat), **slot frequency**,
  **open date range** ("clients can book up to 6 months ahead"), **session limits per day**,
  and **calendar connections** — Google Calendar (live-connected, with "Add to calendar"
  plus "Check for conflicts" across several named calendars), Microsoft 365, Outlook,
  iCloud, Calendly.

**Today** — a coaching *offer* (name, description, session count, minutes, price, pasted
Calendly URL, live toggle) and a **working Sessions tab**: "Book a session" captures client,
parent offer, date/time, status (Booked / Done / Cancelled / Didn't show), meeting link, a
client-visible agenda and private notes. `settings/coaching` holds booking and cancellation
windows, slot granularity and open-window days.

**Gap → build**, in this order
1. **Availability**: weekly grid + date overrides + blackout dates, slot frequency, per-day
   caps — wired to the `settings/coaching` values that already exist.
2. **Calendar sync**: Google first (write the booked session, read several calendars for
   conflicts), then Microsoft/Outlook. Keep the pasted-link mode as an explicit alternative.
3. **Member-facing booking page** honouring availability, windows and caps. Today only the
   admin can create a session.
4. **Coaching programme** entity: numbered session outline with a default template for extra
   sessions, and a **Clients** tab with progress.
5. **Reminders** — multiple configurable offsets, wired to the existing "Coaching reminder"
   system email, plus a coach/client notification matrix.
6. **Recordings** attached to sessions.
7. **Additional session purchases** in-programme.
8. Group coaching (many attendees per session).
9. Let any **contact** be booked, not only people with an account (today the picker lists
   2 of 6 contacts).

## 1.4 Community
**Kajabi has** — a v2 community app (`/admin/communities/v2/:id`) with circles/channels,
and per-user **community access scoping** in the user roles screen.
**Today** — Channels / Members / Challenges / Events / Badges, all working: posting to a
channel, a challenge with points and a date range, scheduled events, and point-threshold
badges (verified by creating them).
**Gap → build** a rich composer (image, video, attachment, poll), a **leaderboard** view
(your own dashboard already advertises leaderboards), scheduled posts, per-channel access
rules, and admin reply / react / moderate on posts (today there is no reply UI, only
counters).

## 1.5 Podcasts
**Kajabi has** — public or members-only shows.
**Today** — shows with a listening/RSS link, episodes with title, audio from the media
library, episode number, season, duration, show notes and a live toggle.
**Gap → build** per-episode members-only gating, transcripts, chapters, and an
Apple/Spotify submission checklist. **Bug:** an episode with no audio saves as **LIVE**
("No audio yet · LIVE") — require audio or default to draft.

## 1.6 Newsletters
**Today** — newsletters with editions (subject, preview line, body, Write/preview), saving
correctly.
**Gap → build** a public archive page, scheduled editions, and paid-tier gating — your own
copy already promises "only for people paying for one of your plans".

## 1.7 Downloads / catalogue
**Kajabi has** a Downloads product type with a Customers count and Published status per item.
**Today** — Catalogue lists Courses and Downloads with "not for sale yet" status.
**Gap** minor: a customers count per download, and file management inside a download.

## 1.8 Media library
**Kajabi has** — 96 files with a **Tags** column and per-file tagging, plus
"Add legacy media to library".
**Today** — a flat list with a public/buyers-only flag, type filters, and upload (verified).
**Gap → build** folders and/or tags, rename, search, replace-file, alt text, and per-file
usage ("used in 3 lessons").

---

# 2. SALES

## 2.1 Offers — the single largest gap
Kajabi's offer editor has four tabs: **Details / Pricing / Purchase flow / Settings**.

### Details
- **Internal title** separate from the customer-facing title.
- **Products in this Offer** — several products bundled (the live example bundles two).
- **Product Access**: "Begin access at a specific date" and "Restrict access to a specific
  amount of days".
*Today:* multiple entitlements ✓, access-expiry presets ✓ (30/60/90 days…), but no
scheduled start date and no internal title.

### Pricing  ⭐
- **Currency** per offer — 130+ currencies.
- **Multiple pricing options per offer**, e.g. *Lounge VIP* sells as `$3,497.00 one-time`
  **and** `$347.00/month for 6 payments` on one checkout. 7 of 44 live offers use this.
- **Recommended pricing option** — one is preselected at checkout, used as the cross-sell
  default, with its own **label**.
- **Collect Sales Tax** per offer, **Include tax in the offer's price**, a **Tax code**
  (Consulting / eBook / eService / Exempt / Reduced / SaaS / Standard) and a
  **Product type** (Good / Service).
- **Payment providers per offer**: Kajabi Payments / Stripe / None, plus **additional
  payment options** — Apple Pay, Google Pay, **Klarna**, **Afterpay** (one-time payments
  only) — and **PayPal** as a third-party option.
- **Offer availability**: "set a quantity limit" and "set a time limit on the Offer".
*Today:* one price per offer, USD only, a single global tax rate, Stripe only, no BNPL, no
PayPal, no quantity or time limits, no tax codes.

### Purchase flow
- Post-purchase destination: **Member's Product Library / Existing Landing Page / Custom
  Thank You Page**.
- **Skip account creation page**.
- Post-purchase email: **Default / Custom / None**.
- **Upsell funnel with upsell *and* downsell pages** in sequence, drawn from a **site-level
  Upsells library** (there is an `Upsells` tab on the offers index).
- **Per-offer automations** in a **When / Then / If** model, using triggers you lack
  (`Payment plan complete`, `Recurring payments cancellation initiated/completed`) and
  actions you lack (`Deactivate from offer`, `Revoke an offer`,
  `Unsubscribe from an email sequence`).
*Today:* thank-you / own page / pasted link ✓, welcome email ✓, per-offer upsells ✓ — but no
downsell branch, no shared upsell library, no skip-account-creation, and no per-offer
automations.

### Settings
- Checkout field toggles (name / phone / address), **Tax ID** field, **custom fields at
  checkout** from the global field library, **geolocation-based default country** with an
  explicit fallback, custom checkout button text.
- **Service agreement**: Not required / default T&C / custom text.
- **Require new customers to create a password at checkout**, or defer it.
- **"Send as a gift"** — buy an offer for someone else (one-time offers only; disables
  bumps/upsells).
- **Order bump**.
- **Send customers to a third-party email provider** (Mailchimp, AWeber, Drip…).
- **Purchase notifications** to a list of your own/team email addresses.
- **Checkout abandonment emails**: enable, recipients (**Customers only** vs **All
  visitors** who entered an email), delay (**1h / 6h / 10h / 24h**), editable template.
- **Per-offer affiliate commission** — fixed amount or percentage.
*Today:* address/phone toggles, free-text extra questions, terms checkbox, order bumps ✓,
discount-code toggle, button colour. Everything else above is missing — and note your
reports page already promises **"Money brought back by reminder emails — carts left behind,
and the ones your reminder emails rescued"**, a report with no feature behind it.

## 2.2 Coupons
**Kajabi has** — discount as **% or fixed $**, restriction to **specific offers**,
**Duration: Once vs Forever** (for recurring — discount the first payment or every one),
redemption count, status, and an **expiry date**.
**Today** — code + **percentage only** + a usage cap (works, shows `0 of 5`) + on/off.
**Gap → build** fixed-amount discounts, expiry date, per-offer restriction, once-vs-forever.

## 2.3 Checkout (site level)
**Kajabi has** — email-opt-in mode (**unchecked / pre-checked / custom message / disabled**),
"automatically subscribe customers who buy a paid offer", gift-recipient opt-in, a
**card-storage opt-in policy** (opted-out / opted-in / hidden), a **purchase webhook URL**,
and checkout header/footer tracking code.
**Today** — button colour, support address, terms link, discount-code toggle.

## 2.4 Customer billing portal, dunning, churn  ⭐
**Kajabi has** (Settings → Customer Payments):
- **Receipts**: customisable receipt, business address + tax number printed on it,
  **refund receipts** with a custom message, **receipt PDF attached to emails**.
- **Receipt rules**: all transactions / **first payment only** / **only when the transaction
  has value** (skip free, trial, 100%-discounted).
- **Statement descriptor** (5–22 chars) for the customer's card statement.
- **Free-trial ending reminder** (e.g. 7 days before), editable template.
- **Upcoming payment reminder** — N days before each subscription/plan payment.
- **Auto-revoke product access after the first failed payment**, auto-restored on success.
- A **customer billing portal** with **self-serve pause** and **self-serve cancel**, a
  **personal "reconsider" message** (300 chars) at the cancel step, an **editable list of
  cancellation reasons**, and a link to the cancellation report.
**Today** — a "Payment failed" template, a `payment fails` trigger, cancel behaviour and a
grace-period cushion. **No customer billing portal at all**, no retry policy, no card-update
page, no pause, no trial/upcoming-payment reminders, no statement descriptor, no receipt
PDF, no cancellation-reason capture — yet your reports promise **"People who left —
cancellations, and the reason each one gave"** and **"What people said when they left"**.
**Build** the portal first, then the reminder set, the retry/auto-revoke policy, the receipt
customiser and rules, and the cancellation-reason editor feeding those two reports.

## 2.5 Payments, invoices, payouts
**Kajabi has** — Kajabi Payments (all major cards, Google Pay, Apple Pay, **BNPL**) or
Stripe; **accounting integrations (Xero, QuickBooks Sync)**; a payments list; invoices;
payouts with balance.
**Today** — Stripe only; a payments list; an invoices list; payouts deep-link to Stripe
(a reasonable choice — keep it).
**Gap** BNPL and PayPal at checkout (see §2.1), and optionally an accounting export/webhook
rather than full Xero/QuickBooks apps.

## 2.6 Affiliates / partners
**Kajabi has** — Overview with a **leaderboard** and **top offers**, Commission setup,
**Share links**, My affiliates, **Transactions** ledger with filters + **Export**,
Announcements, Settings — plus **automatic payouts via PayPal** and a **payout schedule**.
**Today** — Your partners, Paying them (manual mark-off), Things they can use, News for
partners, How it works (share of sale or fixed, recurring toggle, attribution rules).
**Gap → build** a leaderboard and top-offers view, **per-offer share links**, a transactions
ledger with export, and an automated payout rail.

---

# 3. MARKETING

## 3.1 Automations — architecture note
Kajabi has **no global automations page**. Automations are attached to objects — an offer, a
form, a lesson, an email sequence, an event — each with a **When / Then / If** row builder.
Your app has the opposite and arguably better design: one global engine at
`/admin/marketing/automations-v2` with 17 triggers, 11 actions, conditions, a dry run and a
run log — and it now **fires on real events** (verified: tagging a contact enrolled them in
a sequence).
**Gap → build** the object-scoped surface *on top of* the global engine: an "Automations"
panel on an offer, a form, a lesson and a sequence that creates/edits global automations
pre-scoped to that object. Plus the missing triggers and actions listed in §2.1.

## 3.2 Email campaigns
**Kajabi has** — broadcasts and sequences in **one list** with **Folders**, **Manage
Templates**, a Type column and statuses Active / Draft / Scheduled. Campaigns can be
scheduled **relative to an event**:
`24 hours before 'The Do's & Don'ts CEU' event`, `2 hours before`, `7 days before`,
`9 hours after`, and `Upon event registration`.
**Today** — campaigns and sequences are separate lists. Campaigns now have (verified)
audience = presets **plus saved groups plus any tag**, a separate **exclusions** block for
groups and tags, a **live recipient count** that reacts correctly, **Send later** with a
send timezone, and **Send me a test**.
**Gap → build** folders; a shared saved-template library; **event-relative scheduling**;
subject-line A/B with an automatic winner.

## 3.3 The email editor  ⭐
**Kajabi has** — adding an email starts at **"Select a template"**: **22 saved custom
templates** plus ~10 Kajabi templates (Squiggle, Slice, Timber, Strum, Brush…), then a
block editor, with "Use the Classic Editor" as a fallback.
**Today** — campaigns and newsletters get a 6-button inline toolbar (bold, italic, H2,
lists, link) plus a preview; **sequence emails are a plain textarea with no formatting at
all**.
**Gap → build** one shared **block-based composer** used by campaigns, sequences,
newsletters and the system-email editor. Blocks: heading, paragraph, image (from the media
library), button/CTA, divider, spacer, two-column, product/offer card, social row.
Saveable and duplicatable templates. Desktop + mobile preview. A **merge-tag picker** —
today only `{{firstName}}` is documented.

## 3.4 Email sequences
**Kajabi has** — subscribe/unsubscribe **trigger counts**, **per-email stats inline**
(Sent / Opened / Clicked / Unsubscribed), **Duplicate email**, a **Report** tab, sequence
automations, and in Settings a **Sequence Exclude**: "don't email subscribers who have
purchased **these offers**" and "…who have submitted **these forms**".
**Today** — emails with per-step waits, send windows, per-person timezone, completion tag,
"stop the moment they buy something", re-entry control, and a "who's going through" list.
**Gap → build** per-email inline stats; duplicate an email; unsubscribe triggers; a report
tab; and make the exclude rule **offer- and form-specific** rather than a single global
"any purchase".

## 3.5 Site-level marketing / email settings
**Kajabi has** — marketing contact address (anti-spam footer), a **company logo** at the top
of marketing emails, a **custom email domain** with from-name / from-email / reply-to,
**Strict DMARC**, and a domain-setup flow; **Email sequence defaults** (default send time +
default timezone); and **granular email preference categories** so contacts pick topics
instead of unsubscribing from everything — General marketing, Product information, Event
information, Responsive marketing, Notifications.
**Today** — from name, sending address, reply-to, postal address, footer text, a sending-
service picker (own server / Postmark / SendGrid / SES) with a signing secret, and a test
send.
**Gap → build** a logo on marketing emails; a guided custom-domain + DMARC/SPF/DKIM
verification flow; sequence defaults; and **topic-level email preferences** with a
preference-centre page honoured at send time.

## 3.6 Assessments vs quizzes
**Kajabi has** — `/assessments`: graded assessments and **post-tests attached to course
posts**, with title, description and **"Automatically grade assessment"**, plus per-student
submissions.
**Today** — `/admin/marketing/quizzes` supports scored quizzes and graded tests as **public
lead-gen pages** (verified working end to end: authoring, publishing, taking, scoring
3/3, result tag). There is no way to embed one in a lesson or gate progress on it.
**Gap → build** an in-lesson assessment: embed, require a pass to unlock the next lesson,
store per-student attempts and scores, allow manual grading of long answers, notify the
student, and add an "Assessment results" report.

## 3.7 Funnels
**Kajabi has** — a **Funnel Blueprint** catalogue that scaffolds pages *and* an email
sequence in one click: **Freebie, Sales Page (8-email sequence), Product Launch, Zoom
Webinar, Free Book (10-email nurture), Coaching Campaign, Simple Sales Page, Blank**, plus
legacy blueprints (Free Report, Promotional Offer, Sales Page, Webinar, Product Launch,
Virtual Summit). A funnel holds **Pages + an attached Offer**, with a **Funnel Checklist**
("0 Steps Left") and **View Stats**.
**Today** — manual stage lists (landing / sign-up / your offer / extra offer / thank-you)
with headline, body and one button, plus per-stage view counts.
**Gap → build** blueprint templates that scaffold stages + forms + tags + a sequence
together; **email steps as first-class stages**; an attached offer; a readiness checklist;
and per-stage conversion stats (the shell exists).

## 3.8 Events
**Kajabi has** — **recurring / evergreen events** as a first-class schedule:
`Daily next up`, `Hourly next up`, `Every 15 minutes next up`, `Every 4 days next up`;
dedicated **replay-expiry events** ("End of Replay-CEU 9/25/26"); a per-event timezone shown
in the list (PST/PDT/IST); and a **Location** that may be a meeting link **or a physical
address**.
**Today** — One live session / Always on / Watch any time; duration; timezone; join link;
replay link + hours; signup tags; turned-up / didn't-turn-up tags; attendance marking;
registrant list. Registration works end to end (verified: contact created + tag applied).
**Gap → build** a **recurrence rule**; replay expiry as a schedulable moment; a physical-
address location for in-person events; **reminder emails per event** (Kajabi drives these
from event-relative campaigns — see §3.2); and a calendar `.ics` invite.

## 3.9 Forms
**Kajabi has** — **Double opt-in (recommended) vs Single opt-in**, with **reCAPTCHA**
auto-enabled on single opt-in; a **custom confirmation email** and a **custom confirmation
page**; fields drawn from the **global field library** with Edit/Remove; a **When/Then/If
automations** panel; After Submission = **notify your team / send to a third-party email
provider / custom thank-you page**; and tabs for **Submissions** and **Embed**.
**Today** — name + email now always required (verified, including anonymous rejection),
custom questions with 11 field types, map-to-contact-field, required flag, "More rules",
thank-you / redirect / file download, tags, sequence enrolment, replies list + CSV export,
and autosave. The full capture chain works: contact → tag → sequence → enquiry.
**Gap → build** double opt-in mode with a confirmation email; **reCAPTCHA / bot protection**
(your Settings already mentions "keeping junk out of your forms" with nothing behind it);
an **embed snippet**; notify-your-team; third-party provider hand-off; conditional logic;
a file-upload field; and multi-step forms.

## 3.10 Global custom-field library
**Kajabi has** — Forms → Form settings holds a reusable library: standard fields (First/Last
Name, Email, Phone, Address, Address Line 2, City, State, Country, Zip, Business Number)
plus ~45 **custom** fields, each editable and archivable, usable on **any form and at
checkout**.
**Today** — a per-form "A detail of your own…" with no shared library.
**Gap → build** the library, plus use of those fields in segments, merge tags and checkout.

---

# 4. CONTACTS

## 4.1 Contacts list
**Kajabi has** — 400 contacts; a **Segments** picker; search; a
**Category / Conditional / Value** filter builder with **Add filter**; sortable columns
including **Email Marketing** status and **Lifetime Value**; row **Options** menus; a
select-all checkbox column; and **Add contacts** (incl. import).
**Today** — filter chips (subscribed / unsubscribed / bounced / unconfirmed), tag filter,
6 sort orders, search, tags column, spend, purchases, last-heard-from, and checkboxes.
**Gap → build** an explicit multi-condition filter builder on the list (the segment builder
already has the logic — surface it here), and **wire the bulk checkboxes** to bulk tag /
untag / add-to-sequence / grant-offer / export / delete. The checkboxes render today but do
nothing.

## 4.2 Contacts → Insights — missing entirely
**Kajabi has** a list-health dashboard, refreshed every 12 hours, with drill-through
"View list" on every tile:
- **Contacts**: total, new in last 30 days.
- **Subscribed**: total subscribers, new subscribers.
- **Customers**: total, new, customer activity.
- **Unsubscribed**: total, manually unsubscribed, opted out, **bounced**, **marked spam**,
  **never subscribed**.
- **Subscriber Engagement cohorts**: Healthy (0–90 days), Passive (91–180),
  Unengaged (181–270), Inactive (270+).
**Today** — no Insights page at all.
**Gap → build** this page. It is self-contained, high value, and needs no new data model
beyond email-event timestamps.

## 4.3 Contact record
**Kajabi has** — activity timeline, tags, purchases, lifetime value, and per-contact Options.
**Today** — genuinely strong: spend, purchases, first-seen source, timeline, notes, tags,
"Same as someone else" dedupe, timezone, email status, and per-contact actions.
**Gap → build** custom fields on the record (from §3.10); **grant/revoke an offer for a
person**; and per-contact data export / erase (GDPR).

## 4.4 Import
**Kajabi has** — "Add contacts" with an import path.
**Today** — an "Import a list" button.
**Gap → build** an import wizard with **column mapping**, a dry-run preview, duplicate
handling, tag-on-import, and an import history with error rows.

## 4.5 Segments, tags, subscribers, enquiries
**Today** — the segment builder is excellent: 10 rule categories, AND/OR, live count while
editing, plain-English summary (verified). Tags page with usage counts. Subscribers list
with **source attribution** (QUIZ / EVENT / ADDED BY HAND / MEMBER / CUSTOMER / LEAD).
Enquiries with a pipeline (New / I've replied / Good fit / Won / Archived).
**Gap** none material — this area is at or ahead of Kajabi.

---

# 5. ANALYTICS & REPORTS

**Kajabi has** — an Analytics overview with **Customize view**, period-over-period
comparison, gross revenue **by payment method**, top offers, top customers, a
**subscription status** breakdown (Active / Trialing / Past due / Pending cancellation /
Paused), and a **subscription retention cohort table (PMT 1 → PMT 24)**. Plus ~40 reports.
**Today** — an overview with 4 metrics and 4 charts, and a comparable ~40-report catalogue
(in several areas richer than Kajabi's, e.g. three affiliate reports and two email reports).
**Gap → build** the **retention cohort table**, the subscription-status breakdown, revenue
by payment method, period comparison and a customise-view control. Add
"Payment balance summary by month" and **forecasted future instalments** (Kajabi has both),
and CSV export + saved date-range presets on every report.

---

# 6. SETTINGS

**Kajabi has**, in scope: Payment setup · Checkout · Customer payments · Tax ·
Marketing settings · Email templates · Drip settings · Form settings ·
Integrations & Webhooks · Member sign in & security · Scheduling · Manage Users ·
Notifications & privacy · Account tracking · Documents (tax documents).

**Today** — General (notifications + receipt details) · Payments & checkout · Email ·
Customers · Course delivery · Coaching · Forms · Your website · Connected services ·
Who can get in · Connections.

**Gap → build**
1. **Team roles.** Kajabi has **Owner / Administrator / Assistant / Support Specialist**
   with stated boundaries — "Administrators have the same permission as owners, with the
   exception of Payments"; "Assistants can delete and modify site content, but cannot see
   financial report data"; "Support Specialists can moderate comments and manage people" —
   plus per-user **timezone**, **site access scoping**, **community access scoping**, and a
   **Suspended** state. *Today:* Owner only, and the "Invite someone" button has no flow.
2. **2FA.** Your Settings → Who can get in shows "Ask for a code as well as my password —
   COMING SOON". Ship TOTP enrolment, recovery codes, per-user enforcement.
3. **Member social sign-in** — Kajabi offers **Google sign-in** for members.
   *Today:* magic link + email confirmation only.
4. **Webhooks & API.** Kajabi has a per-offer purchase webhook plus site-level Integrations
   & Webhooks. Your Connections screen mints keys and accepts webhook URLs but ships **no
   event catalogue, no delivery log, no retries and no docs**. Build those.
5. **Tax**: per-offer tax codes and product types (§2.1), and a tax-document area.
6. **Notifications & privacy** and **Account tracking** equivalents.
7. **Audit log** — who changed what (neither product has a good one; you should).

---

# 7. STILL-OPEN BUGS (from the last verification pass)

Seven fixes were verified as landed. These remain:

1. **Podcast episodes save as LIVE with no audio.**
2. **Tight hit areas.** Several buttons and tag chips (contact record tag chips, form tag
   checkboxes, Save on the offer editor, Submit on public forms) need a near-centre click;
   an off-centre click silently does nothing. Widen hit areas and add pressed/loading states.
3. **Confirmation dialogs are not exposed as labelled dialogs.** "Stop selling",
   "Remove this step" and similar open a confirm whose buttons don't surface in the
   accessibility tree, so the action looks broken. Give each a `role="dialog"` with an
   accessible name, focus trap and initial focus.
4. **Failed public submissions are silent.** One of two identical event registrations
   produced nothing, with no message to the visitor. Every public submit needs an explicit
   success and failure state.
5. **Plans grant only a community** — not courses or downloads.
6. **`/admin/community/1` errors** ("We couldn't load this community") while `/2` works —
   fix id resolution and render a real 404.
7. **"Send me a test email" gives no feedback** — no success, no error.

---

# 8. SUGGESTED ORDER OF WORK

**Wave 1 — revenue and retention**
§2.1 Pricing (multiple pricing options, currency, availability limits, BNPL/PayPal) ·
§2.4 customer billing portal + dunning + cancellation reasons · §2.1 checkout abandonment
(the report already exists) · §2.2 coupons.

**Wave 2 — the email engine**
§3.3 block composer + template library · §3.2 folders and event-relative scheduling ·
§3.4 per-email stats and offer/form-specific excludes · §3.5 custom domain + topic
preferences.

**Wave 3 — course and coaching depth**
§1.1 paywall + certificates + prerequisites · §1.2 lesson attachments/audio/comments ·
§3.6 in-lesson assessments · §1.3 coaching availability + calendar sync + member booking.

**Wave 4 — operations**
§4.2 Insights · §4.1 bulk actions · §4.4 import wizard · §3.10 custom-field library ·
§5 retention cohort · §6 roles + 2FA + webhook catalogue · §7 remaining bugs.

Reuse what exists: the segment rule builder, the global automation trigger/action registry,
the tag picker, the offer entitlement selector, and the report shell. Every new domain event
must be added to the automation trigger list and every new capability to the action list.
