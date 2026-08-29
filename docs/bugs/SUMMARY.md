# Whole-app bug sweep — 2026-08-18

Nine hostile reviewers swept the entire application with disjoint file ownership, four
independent verifiers re-derived the riskiest fixes, and four follow-up fixers cleared the
regressions and cross-boundary items the first pass could not touch.

**Result: ~129 defects fixed.** Backend typecheck clean, **470 tests passing** (was 412),
frontend typecheck clean, full client+SSR build succeeds, SSR smoke test renders 8 public
routes to real HTML. 158 files changed.

The starting state was *green* — typecheck passed and 412 tests passed — and it stayed green
through every defect listed below. Nothing here was caught by the type checker or the suite.

---

## The site was not working

Four separate agents, looking at different layers, independently established that the
deployed application was broken in ways no test expressed:

| What | Where | Effect |
|---|---|---|
| CSP blocked `js.stripe.com` | `nginx/site.conf:54` | **No payment could be taken at all** |
| Nested `<Routes>` with absolute child paths | `frontend/src/App.tsx` | **Every member URL rendered a blank page** — login, signup, password reset, verify, account, library, community, coaching, partners |
| `/checkout/success` matched `/` | `frontend/src/App.tsx:301` | Buyers returning from Stripe got the **home page** — no receipt, no order number, and the natural next move is to pay again |
| SSR regex swallowed `/partners/dashboard` | `nginx/site.conf:160` | Affiliate portal answered a JSON 404 |
| Lessons inserted with no `slug` under a `UNIQUE` constraint | `routes/admin/curriculum.ts:193` | Every admin-built course was **one unplayable lesson** |
| `adminAvailabilityRouter` never mounted | `routes/admin/index.ts` | **No coaching package that had been sold could be booked** |
| `RETURNING` referenced tables absent from the `UPDATE` | `jobs/coachingJobs.ts:93` | Coaching reminders had **never** sent; the live queue was dead-lettering every 15 min |

That last one was confirmed against the running system: `coaching.reminders #1155 DEAD:
missing FROM-clause entry for table "m"`.

---

## Money and access

- **`POST /api/billing/portal` had no authentication.** It took an email from the request body
  and returned a Stripe Billing Portal session for whoever matched — anyone knowing a
  customer's address got their invoices, card last4, and the buttons to cancel or replace the
  card. (`routes/public/checkout.ts:193`)
- **Payment plans self-completed after one instalment.** A 500-and-retry on the opening invoice
  re-claimed it and credited instalment 2, so on a 2 × $1,250 plan the customer paid $1,250,
  the plan marked itself "completed", and access was retained. Both halves of the intended fix
  had only half-landed. (`stripeWebhook.ts:1386`, `fulfillment.ts:413`)
- **Coupon caps enforced against a counter nothing incremented** on the legacy path — a 1-use
  50%-off code was usable without limit. (`checkout.ts:146`)
- **Affiliates earned 30% on their own purchases**, in perpetuity, including renewals.
  (`services/affiliates.ts:487`)
- **CEU certificates mintable without playback** — the watch rule keyed on a column no admin
  route can write, so a 6-hour video course certified after opening each lesson and waiting.
  (`services/certificates.ts:671`)
- **Stored XSS via the media library** — uploads kept the uploader's extension, so `notes.html`
  declared as `text/plain` landed at `/uploads/<hex>.html` and `express.static` served it as
  HTML on the site origin. (`routes/admin/media.ts:190`)
- **Campaigns ignored `segment_id` entirely** and mailed the whole subscriber list, with no
  suppression, no unsubscribe link and no postal address — CAN-SPAM exposure on every send.
  (`routes/admin/growth.ts:233`)

---

## What the verify pass caught

Historically in this codebase the *fix* introduces the next defect. It did again:

- The login-throttle fix made the account-wide brute-force ceiling a **no-op** — it moved
  inside the failure branch, so it only changed the status code. Replaced with an escalating
  minimum gap between evaluated attempts, which bounds a distributed attacker below the
  ceiling while still letting the real owner in, and cannot be used to lock anyone out.
- The automation delay fix made a **duplicate email** possible: a DB blip after a delayed send
  requeued the job with the "already delayed" flag still set. Now claimed atomically per
  action, at-most-once.
- The community route fix was correct but **greedy**, swallowing the sidebar's "N members"
  link into a channel-not-found error. (The member directory page already existed; only the
  route was missing.)
- The nginx SSR fix patched **one instance of a class** — fifteen other paths still returned
  raw API JSON instead of the branded 404.

One verifier also **rejected** a proposed `trust proxy` change with evidence, and was then
itself corrected: the rejection held only because of a concurrent nginx edit. See below.

---

## Two traps worth remembering

**1. The nginx config was bind-mounted as a single file.** That pins the inode, so the running
container still held the *old* config: host inode 1025876 / 11240 B vs container 1017411 /
5399 B. A `docker compose restart nginx` would have applied none of the fixes — not the CSP,
so still no payments — with no error anywhere. Now a directory mount, with the check procedure
written into `DEPLOY.md`.

**2. Per-IP rate limiting does not work on this deployment, and the fix for it is not enough.**
nginx was appending to `X-Forwarded-For` while the app trusted one hop, so `req.ip` was the
docker bridge gateway for every visitor — proven from the live log. That is fixed. But the k3d
load balancer is a plain TCP proxy and the Traefik Service uses `externalTrafficPolicy:
Cluster`, so the visitor's address is destroyed *upstream* regardless. `req.ip` is still a
constant: every per-IP limiter is effectively global and `consentIp` records are not evidence.
Fixing it needs PROXY protocol on the k3d LB and the Traefik entrypoints together — a
shared-cluster decision, flagged not applied. The coupling is documented at `app.ts`'s
`trust proxy` line and in `nginx/site.conf`.

Also fixed during final verification: the SSR bundle was emitted as `entry-server.js` under a
`package.json` declaring `"type": "module"`, so `require()` threw and the renderer silently
served a client-only shell. Production survived only by accident — the bundle is copied next to
the backend's own `package.json`, which has no `"type"`. Now `.cjs`, and verified by actually
rendering.

---

## Before deploying

1. **Commit the untracked migrations.** `018_purchase_delivery.sql`, `019_redirect_backfill.sql`
   and `020_payment_plan_backfill.sql` are untracked. The migration runner reads the directory
   from disk, so a deploy from git skips them — and `deliverPurchase` swallows its own errors,
   so the symptom of missing 018 is that **every paid order silently sends no receipt and no
   set-password link**.
2. **Deploy with `docker compose up -d`**, not `restart`. See `DEPLOY.md`.
3. **Run 020** to backfill payment plans created before the fix; it reports what it could not
   safely repair.

## Left undone, deliberately

- **Admin two-step sign-in stays disabled.** The toggle worked but login never sends a code, so
  enabling it is a permanent lockout. Needs a backend MFA challenge nobody has built.
- **The practice quiz has no home.** Its CTA points at the apex domain, which after cutover is
  the page the visitor is already on, and seven legacy quiz URLs funnel there. Either rebuild
  it as an assessment here or host the engine somewhere that survives the cutover — a content
  decision, documented in `pages/PracticeQuiz.tsx`.
- **Newsletter open/click attribution** is stopped from corrupting campaign stats, but per-issue
  reporting needs a new `source_type` across a migration and four files.
- **`/podcasts/<show>` redirect targets** have no correct destination — no per-show route exists.
- **Public podcast audio** uploaded as public cannot be signed; the fix belongs at upload time.

## Per-area detail

`backend-auth.md` · `backend-commerce.md` · `backend-access.md` · `backend-growth.md` ·
`backend-platform.md` · `frontend-core.md` · `frontend-admin.md` · `frontend-public.md` ·
`infra.md` — each with the concrete exploit or failure, the fix, and an explicit record of
where the reviewer looked hard and found nothing.
