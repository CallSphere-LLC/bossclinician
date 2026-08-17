# Boss Clinician — Phase 0 Discovery Audit

**Date of measurement:** 2026-08-17
**Repo root:** `/home/ubuntu/apps/bossclinician`
**Scope:** full-stack audit of the deployed platform prior to the rebuild.
**Rule applied throughout:** where the brief and the code disagree, the code wins and the disagreement is called out.

---

## 0. Read this first — four findings that change the plan

| # | Finding | Impact |
|---|---|---|
| 1 | **Migration `001_phase1_member_identity.sql` has never been applied to the live database.** The deployed `dist/db/migrate.js` is an older single-stage runner that only executes `schema.sql`; it contains no migration loop at all. The live DB has **48 tables**, no `schema_migrations` table, no `citext` extension, and `members.email` is still `TEXT`. | The entire member-identity subsystem — 6 tables plus `schema_migrations` — exists **only in source**. Any plan that assumes it is live is wrong. |
| 2 | **The compile blocker reported by the auth-security and ops sweeps is already fixed.** `src/routes/auth/memberAuth.ts` (23,105 B) and `memberAccount.ts` (11,776 B) were written today at 13:10 and 13:11, *after* those sweeps ran. `npx tsc -p tsconfig.json --noEmit` now **exits 0**. | The backend builds again. `docker compose build backend` is no longer blocked. Both sweeps are stale on this point. |
| 3 | **The configured Stripe keys are LIVE mode** (`sk_live_…`, `pk_live_…`, plus a live `whsec_…`). | No end-to-end purchase can be exercised without real money moving. **Test keys are a hard prerequisite for Phase 2 acceptance.** See §5. |
| 4 | ~~**Cross-audience JWT privilege escalation is armed but not yet firing.**~~ `verifyToken` checked no `aud` claim and member tokens were signed with the *same* secret, so a member access token verified cleanly as an admin token with `role === undefined` — and `requireRole('admin')` guards exactly one route. **Confirmed by reproduction, then fixed before deploy.** | ✅ **CLOSED.** `auth/secrets.ts` derives the member signing key from `JWT_SECRET` via HKDF, so the two families are mutually unverifiable at the signature, and `verifyToken` now rejects any token without a non-empty `role` claim. Pinned by `src/auth/tokenSeparation.test.ts` (7 tests). Admin tokens already in browsers stay valid — the admin key is the base secret unchanged. |

---

## 1. Stack map

| Layer | Reality | Evidence |
|---|---|---|
| **Languages** | TypeScript (backend + frontend), Python 3.11 (AI service), SQL | `backend/`, `frontend/`, `ai/` |
| **Backend framework** | Express 4 on Node 20 (`node:20-alpine`), CommonJS output, `strict: true` | `backend/tsconfig.json`, `backend/src/app.ts` |
| **Backend runtime** | Node 20, runs as non-root user `node` (uid 1000) | `docker-compose.yml` |
| **Frontend framework** | React 18.3 + react-router-dom 6.28 + Vite 6 + Tailwind 3.4 + Radix UI + recharts 3 + motion + sonner + react-markdown | `frontend/package.json`, `frontend/vite.config.ts` |
| **Rendering model** | **Pure client-side SPA.** No SSR, no prerender, no static route emission. | `vite.config.ts` — no SSR/prerender plugin |
| **Package manager** | npm (both Node packages); pip for the AI service | `package.json` ×2, `ai/requirements.txt` |
| **Query layer** | **None — no ORM.** Raw `pg` (node-postgres) `pool.query` with `$n` bind parameters, plus a hand-rolled generic repo factory (`src/db/repo.ts`) and an update builder (`src/utils/sqlUpdate.ts`) | `src/db/repo.ts`, `src/db/repos.ts`, `src/db/growthRepos.ts` |
| **DB engine** | PostgreSQL 16 (`postgres:16-alpine`), database `bossclinician`, user `boss`, internal-only (no host port), named volume `db_data` | `docker-compose.yml` |
| **Migrations** | Two-stage in source (`schema.sql` baseline re-run every boot + forward-only `migrations/*.sql`); **single-stage in the deployed image** — see §0.1 | `src/db/migrate.ts` vs deployed `dist/db/migrate.js` |
| **Hosting / deploy** | Docker Compose on the host (5 services), fronted by k3s/Traefik which hairpins to the host bridge IP. **No image registry, no CD, no git, no CI.** | `docker-compose.yml`, `k8s/ingress.yaml` |
| **Ingress / TLS** | Traefik terminates TLS; k8s `Service boss-web` has **no selector** — a manually managed `Endpoints` object points at `172.18.0.1:8088` (compose nginx). Only `bossclinician.callsphere.site` is live. | `k8s/ingress.yaml` |
| **Background job runner** | **ABSENT — there is none.** No cron, no BullMQ/Bull/Agenda/Bree, no Celery/APScheduler, no host crontab, no systemd timer, no worker service in compose. The closest thing is `src/automations/engine.ts`, an in-process **fire-and-forget** trigger engine (`fireTriggerAsync = void fireTrigger(...)`) that runs on the API request's own event loop, with no persistence, no retry and no dead-letter. Nothing time-based can be scheduled anywhere in this system. | `src/automations/engine.ts`; `crontab -l` → none |
| **Mail transport** | nodemailer over SMTP. Real SMTP **only** when `SMTP_HOST` **and** `SMTP_USER` **and** `SMTP_PASS` are all set; otherwise it silently falls back to `jsonTransport` (logs, sends nothing). No SendGrid/Postmark/SES/Resend, no inbound ESP webhooks. `sendMail` **never throws** — it catches everything and returns void. | `src/email/mailer.ts` |
| **File / media storage** | Local disk on the backend container at `/app/uploads`, backed by the **named** Docker volume `uploads_data` (survives rebuild). Uploaded via multer (`POST /api/admin/media`, field name `file`), MIME whitelist with extension fallback, SVG deliberately excluded. Served by `express.static` at `/uploads` with **no authentication**. No S3/R2/CDN. | `src/routes/admin/media.ts`, `app.ts`, `docker-compose.yml` |
| **Error tracking** | **ABSENT.** No Sentry/Bugsnag/Rollbar/Datadog/OTel. Production errors exist only as `console.error` in container stdout, and are destroyed when the container is replaced on the next redeploy. | `src/middleware/errorHandler.ts` |
| **Linting** | **ABSENT.** Zero eslint/prettier/ruff configs. `frontend`'s `npm run lint` is `tsc --noEmit` against a solution-style tsconfig with `files: []` → **checks zero files and always passes.** Use `npx tsc -b` instead. | `frontend/tsconfig.json` |
| **Tests** | Backend: vitest 2.1.9, **1 file / 46 tests**, all passing — `src/services/pricing.test.ts`, pure pricing math only. Zero tests for routes, auth, db, stripe, automations, email. Frontend: **no test runner at all**. AI: pytest declared, not installed on host. | `backend/package.json` |

### 1.1 Services

| Service | Image | Exposure | Notes |
|---|---|---|---|
| `db` | `postgres:16-alpine` | internal | healthcheck `pg_isready`; volume `db_data` |
| `ai` | built from `./ai` (FastAPI + uvicorn + openai 2.37) | internal :8000 | KB built offline by `ai/build_kb.py` from `shared/content.json` |
| `backend` | built from `./backend` | internal :4000 | volume `uploads_data` → `/app/uploads` |
| `frontend` | node build → `nginx:1.27-alpine` | internal :80 | `VITE_*` values are **build-time ARGs** baked into the bundle |
| `nginx` | `nginx:1.27-alpine` + bind-mounted `nginx/site.conf` | `172.18.0.1:8088:80` | edge routing, CSP and all security headers |

### 1.2 Deployed-vs-source drift (critical)

The running backend image was built **2026-08-16 20:20**. Inside it:

- `dist/routes/` contains only `admin/` and `public/` — **no `auth/`, no `member/`, no `middleware/memberAuth`**.
- `dist/db/migrations/` **does not exist**.
- `dist/db/migrate.js` is the old single-stage `applySchema()` that only reads `schema.sql`.

So every member-facing endpoint the frontend references currently 404s in production, and no migration has ever run. `scripts/copy-assets.js` *does* copy `db/migrations/` — the directory simply did not exist when that image was built.

---

## 2. Route inventory

### 2.1 Public site routes (React Router)

Router: `frontend/src/App.tsx`. `/admin/*` splits off to `AdminApp`; everything else renders inside `components/layout/Layout.tsx`. `Home` and `NotFound` are eager; all others are `React.lazy` + Suspense.

| Path | Component | Handler file | Data source |
|---|---|---|---|
| `/` | Home | `frontend/src/pages/Home.tsx` | `api.testimonials` via `useCollection`, fallback `@/content/testimonials` |
| `/about` | About | `frontend/src/pages/About.tsx` | static, in-file (850 lines) |
| `/work-with-me` | WorkWithMe | `frontend/src/pages/WorkWithMe.tsx` | `@/content/site` + `LeadForm` (1015 lines) |
| `/courses` | Courses | `frontend/src/pages/Courses.tsx` | `api.courses` + fallback; `BuyButton` → Stripe Checkout |
| `/resources` | Resources | `frontend/src/pages/Resources.tsx` | `api.resources`, fallback `@/content/resources` |
| `/resource-hub` | ResourceHub | `frontend/src/pages/ResourceHub.tsx` | `@/content/resourceHub`; includes IncomeCalculator |
| `/blog` | Blog | `frontend/src/pages/Blog.tsx` | `api.blogList({tag})`; `?tag=` search param |
| `/blog/:slug` | BlogPost | `frontend/src/pages/BlogPost.tsx` | `api.blogPost` + static fallback; renders markdown |
| `/apply` | Apply | `frontend/src/pages/Apply.tsx` | `LeadForm(source='apply')` |
| `/checkout/success` | CheckoutSuccess | `frontend/src/pages/CheckoutSuccess.tsx` | `api.checkoutOrder(session_id)`, polls 12×1500ms |
| `/contact` | Contact | `frontend/src/pages/Contact.tsx` | `LeadForm(source='contact')` |
| `/retreats` | Retreats | `frontend/src/pages/Retreats.tsx` | static (1352 lines — largest public page) |
| `/store` | Store | `frontend/src/pages/Store.tsx` | static |
| `/practice-quiz` | PracticeQuiz | `frontend/src/pages/PracticeQuiz.tsx` | static |
| `/practice-reset-planner` | PracticeResetPlanner | `frontend/src/pages/PracticeResetPlanner.tsx` | static + `SubscribeForm` |
| `/f/:slug` | FormPage | `frontend/src/pages/FormPage.tsx` | `api.form(slug)` / `api.submitForm` — serves every admin-built form |
| `/funnel/:slug` | FunnelPage | `frontend/src/pages/FunnelPage.tsx` | `api.funnel(slug)`, `api.funnelStepEvent` |
| `/funnel/:slug/:step` | FunnelPage | `frontend/src/pages/FunnelPage.tsx` | same component, step index from param |
| `/privacy-policy` | PrivacyPolicy | `frontend/src/pages/legal/PrivacyPolicy.tsx` | static |
| `/terms` | Terms | `frontend/src/pages/legal/Terms.tsx` | static |
| `/disclaimer` | Disclaimer | `frontend/src/pages/legal/Disclaimer.tsx` | static |
| `/financial-disclaimer` | FinancialDisclaimer | `frontend/src/pages/legal/FinancialDisclaimer.tsx` | static |
| `*` | NotFound | `frontend/src/pages/NotFound.tsx` | static — **renders under HTTP 200, not 404** |

> `frontend/src/components/LegalPage.tsx` (249 lines) is exported but imported by nothing — dead code.

### 2.2 Admin routes (React Router)

Router: `frontend/src/pages/admin/AdminApp.tsx`; shell `AdminLayout.tsx`; nav IA `pages/admin/ui/nav.ts`.

| Path | Component | Handler file | Capability | Status |
|---|---|---|---|---|
| `/admin/login` | Login | `pages/admin/Login.tsx` | auth | complete (not in nav) |
| `/admin` | Dashboard | `pages/admin/Dashboard.tsx` | read | complete (664 ln) |
| `/admin/products` | Products | `pages/admin/Products.tsx` | read-only by design | complete (258 ln) |
| `/admin/courses` | CoursesAdmin | `pages/admin/CoursesAdmin.tsx` | full CRUD | complete (439 ln) |
| `/admin/courses/:id/curriculum` | CourseBuilder | `pages/admin/CourseBuilder.tsx` | full CRUD | complete (719 ln, not in nav) |
| `/admin/community` | CommunityList | `pages/admin/CommunityList.tsx` | create/delete | complete (278 ln) |
| `/admin/community/:id` | CommunityDetail | `pages/admin/CommunityDetail.tsx` | full CRUD, tabbed | complete (1225 ln, not in nav) |
| `/admin/media` | MediaLibrary | `pages/admin/MediaLibrary.tsx` | upload/list/delete | complete (378 ln) |
| `/admin/coaching` | Coaching | `pages/admin/Coaching.tsx` | full CRUD | complete (626 ln) |
| `/admin/podcasts` | Podcasts | `pages/admin/Podcasts.tsx` | full CRUD | complete (1140 ln) |
| `/admin/newsletters` | Newsletters | `pages/admin/Newsletters.tsx` | full CRUD + send | complete (640 ln) |
| `/admin/sales/payments` | PaymentsPage | `pages/admin/SalesPages.tsx` | read-only | complete |
| `/admin/sales/plans` | PlansPage | `pages/admin/SalesPages.tsx` | create/delete | complete — **no edit UI** |
| `/admin/sales/subscriptions` | SubscriptionsPage | `pages/admin/SalesPages.tsx` | read-only | complete |
| `/admin/sales/invoices` | InvoicesPage | `pages/admin/SalesPages.tsx` | read-only | complete |
| `/admin/sales/coupons` | CouponsPage | `pages/admin/SalesPages.tsx` | create/toggle/delete | complete |
| `/admin/sales/payouts` | PayoutsPage | `pages/admin/SalesPages.tsx` | none | **intentional deferral** — EmptyState deep-linking to dashboard.stripe.com |
| `/admin/blog` | BlogList | `pages/admin/BlogList.tsx` | list/delete | complete (182 ln) |
| `/admin/blog/new` | BlogEditor | `pages/admin/BlogEditor.tsx` | create + AI draft | complete (805 ln, not in nav) |
| `/admin/blog/:id` | BlogEditor | `pages/admin/BlogEditor.tsx` | update | complete (not in nav) |
| `/admin/testimonials` | TestimonialsAdmin | `pages/admin/TestimonialsAdmin.tsx` | full CRUD | complete (64 ln, via CrudManager) |
| `/admin/resources` | ResourcesAdmin | `pages/admin/ResourcesAdmin.tsx` | full CRUD | complete (71 ln, via CrudManager) |
| `/admin/pages` | PagesAdmin | `pages/admin/PagesAdmin.tsx` | read/update | complete **with scoped limitation** — editable fields come from a hand-maintained block map |
| `/admin/marketing/events` | Events | `pages/admin/Events.tsx` | create/delete | complete **with gap — no edit path** |
| `/admin/marketing/campaigns` | Campaigns | `pages/admin/Campaigns.tsx` | full CRUD + send | complete (597 ln) |
| `/admin/marketing/funnels` | Funnels | `pages/admin/Funnels.tsx` | full CRUD | complete (730 ln) |
| `/admin/marketing/automations` | Automations | `pages/admin/Automations.tsx` | full CRUD + test-fire | complete (1181 ln) |
| `/admin/marketing/forms` | Forms | `pages/admin/Forms.tsx` | full CRUD | complete (676 ln) |
| `/admin/leads` | Leads | `pages/admin/Leads.tsx` | read/update status | complete — no delete |
| `/admin/conversations` | Conversations | `pages/admin/Conversations.tsx` | read/delete | complete (268 ln) |
| `/admin/members` | Members | `pages/admin/Members.tsx` | create/delete/enroll | complete **with gap — no member edit** |
| `/admin/subscribers` | Subscribers | `pages/admin/Subscribers.tsx` | read + CSV export | complete — no unsubscribe action |
| `/admin/analytics` | Analytics | `pages/admin/Analytics.tsx` | read-only | complete (234 ln) |
| `/admin/analytics/reports` | Reports | `pages/admin/Reports.tsx` | read + CSV export | complete (354 ln) |
| `/admin/settings` | SettingsPage | `pages/admin/Settings.tsx` | read/update | complete UI, **known wiring caveat** — header/footer still read `content/site`, so saves are not reflected publicly (documented at `Settings.tsx:36-44`) |
| `/admin/*` | `Navigate → /admin` | `AdminApp.tsx` catch-all | — | — |

**Genuinely inert controls (only two in the whole admin):**
1. `AdminLayout.tsx:288-295` — topbar global search input has no `value`/`onChange`/`onSubmit` and no consumer. Visible on every admin screen.
2. `PayoutsPage` — deliberate deep-link out, per in-file rationale.

Zero `coming soon` / TODO / FIXME / WIP markers exist anywhere in `src/pages`. Every nav target resolves to a real, API-wired screen; no `ready: false` "Soon" pills are in use.

### 2.3 `/api` endpoints — public (23)

Mounted `app.use("/api", publicRouter)` (`app.ts:35`). All 14 sub-routers mount at root, so each literal path appends directly to `/api`. **No endpoint in this tree is authenticated.**

| Method | Path | Handler file | Rate limit | Zod | Writes |
|---|---|---|---|---|---|
| GET | `/api/health` | `routes/public/health.ts:5` | — | — | — |
| GET | `/api/pages/:slug` | `routes/public/pages.ts:10` | — | — | — |
| GET | `/api/blog` | `routes/public/blog.ts:13` | — | hand-clamped | — |
| GET | `/api/blog/:slug` | `routes/public/blog.ts:51` | — | — | — |
| GET | `/api/courses` | `routes/public/courses.ts:7` | — | — | — |
| GET | `/api/testimonials` | `routes/public/testimonials.ts:7` | — | — | — |
| GET | `/api/resources` | `routes/public/resources.ts:7` | — | — | — |
| GET | `/api/settings` | `routes/public/settings.ts:7` | — | — | — |
| POST | `/api/leads` | `routes/public/leads.ts:44` | 30/10min | `leadSchema` | `leads` |
| POST | `/api/subscribe` | `routes/public/subscribe.ts:13` | 30/10min | `subscribeSchema` | `subscribers` |
| POST | `/api/chat` | `routes/public/chat.ts:21` | 20/10min | `chatSchema` | `chat_sessions`, `chat_messages` |
| POST | `/api/chat/transcript` | `routes/public/chat.ts:83` | 120/10min | `chatTranscriptSchema` | `chat_sessions`, `chat_messages` |
| POST | `/api/realtime/session` | `routes/public/realtime.ts:20` | 20/10min | — | — |
| POST | `/api/checkout/session` | `routes/public/checkout.ts:33` | 15/10min | inline | `orders` (pending) |
| POST | `/api/checkout/subscription` | `routes/public/checkout.ts:125` | 15/10min | inline | — |
| POST | `/api/billing/portal` | `routes/public/checkout.ts:193` | 15/10min | inline | — |
| GET | `/api/checkout/session/:id` | `routes/public/checkout.ts:224` | — | — | — |
| POST | `/api/stripe/webhook` | `routes/public/stripeWebhook.ts:20` | — | HMAC sig | `members`, `subscriptions`, `community_memberships`, `orders`, `invoices` |
| GET | `/api/podcast/:slug/rss.xml` | `routes/public/growthPublic.ts:42` | — | — | — |
| GET | `/api/forms/:slug` | `routes/public/growthPublic.ts:113` | **none** | — | **`forms.views` (write on a GET)** |
| POST | `/api/forms/:slug/submit` | `routes/public/growthPublic.ts:134` | **none** | inline | `form_submissions`, `leads` |
| GET | `/api/funnels/:slug` | `routes/public/growthPublic.ts:174` | — | — | — |
| POST | `/api/funnels/steps/:id/:event` | `routes/public/growthPublic.ts:201` | **none** | — | `funnel_steps.views/conversions` |

**Unauthenticated + unthrottled writers** (the exposed surface): `GET /api/forms/:slug`, `POST /api/forms/:slug/submit`, `POST /api/funnels/steps/:id/:event`.

Other notable public-surface facts:
- `POST /api/realtime/session` is the most expensive unauthenticated endpoint — it mints an OpenAI Realtime client secret and starts a billable audio session.
- `POST /api/billing/portal` is unauthenticated: **knowing an email address is enough to open that customer's Stripe billing portal.**
- `GET /api/checkout/session/:id` returns the buyer's email to anyone holding the session id, with no rate limit.
- `POST /api/forms/:slug/submit` is the unprotected twin of `POST /api/leads` — no honeypot, no limiter — and its `source` string (`form:<slug>`) bypasses the `leadSchema` source enum.
- All SQL is parameterized. The only dynamic fragment is `growthPublic.ts:206`, a two-branch ternary picking a column name — not injectable.

### 2.4 `/api/admin` endpoints — 184 total

Mounted `app.use("/api/admin", adminRouter)`. Only `POST /api/admin/login` is public; `authRouter` mounts at `/` **without** `requireAuth`, and every other sub-router receives `requireAuth` at the mount in `routes/admin/index.ts`.

**Composition:** 99 hand-written + 85 generated by `crudFactory.ts` (17 resources × 5 routes).

#### 2.4.1 Hand-written admin endpoints (99)

| Method | Path | Handler file | Auth |
|---|---|---|---|
| POST | `/api/admin/login` | `routes/admin/auth.ts` | **public** (+ `loginIpLimiter`, `loginEmailLimiter`) |
| GET | `/api/admin/me` | `routes/admin/auth.ts` | requireAuth |
| GET | `/api/admin/stats` | `routes/admin/stats.ts` | requireAuth |
| GET | `/api/admin/stats/overview` | `routes/admin/stats.ts` | requireAuth |
| GET | `/api/admin/pages` | `routes/admin/pages.ts` | requireAuth |
| GET | `/api/admin/pages/:slug` | `routes/admin/pages.ts` | requireAuth |
| PUT | `/api/admin/pages/:slug` | `routes/admin/pages.ts` | requireAuth |
| GET | `/api/admin/leads` | `routes/admin/leads.ts` | requireAuth |
| PUT | `/api/admin/leads/:id` | `routes/admin/leads.ts` | requireAuth |
| GET | `/api/admin/subscribers` | `routes/admin/subscribers.ts` | requireAuth |
| GET | `/api/admin/settings` | `routes/admin/settings.ts` | requireAuth |
| PUT | `/api/admin/settings` | `routes/admin/settings.ts` | requireAuth |
| POST | `/api/admin/ai/generate-blog` | `routes/admin/ai.ts` | requireAuth |
| GET | `/api/admin/media` | `routes/admin/media.ts` | requireAuth |
| POST | `/api/admin/media` | `routes/admin/media.ts` | requireAuth (+ multer) |
| PATCH | `/api/admin/media/:id` | `routes/admin/media.ts` | requireAuth |
| DELETE | `/api/admin/media/:id` | `routes/admin/media.ts` | requireAuth |
| GET | `/api/admin/curriculum/:courseId` | `routes/admin/curriculum.ts` | requireAuth |
| POST | `/api/admin/curriculum/:courseId/modules` | `routes/admin/curriculum.ts` | requireAuth |
| PUT | `/api/admin/curriculum/modules/:id` | `routes/admin/curriculum.ts` | requireAuth |
| DELETE | `/api/admin/curriculum/modules/:id` | `routes/admin/curriculum.ts` | requireAuth |
| POST | `/api/admin/curriculum/modules/:moduleId/lessons` | `routes/admin/curriculum.ts` | requireAuth |
| PUT | `/api/admin/curriculum/lessons/:id` | `routes/admin/curriculum.ts` | requireAuth |
| DELETE | `/api/admin/curriculum/lessons/:id` | `routes/admin/curriculum.ts` | requireAuth |
| GET | `/api/admin/members` | `routes/admin/members.ts` | requireAuth |
| POST | `/api/admin/members` | `routes/admin/members.ts` | requireAuth |
| PUT | `/api/admin/members/:id` | `routes/admin/members.ts` | requireAuth |
| DELETE | `/api/admin/members/:id` | `routes/admin/members.ts` | requireAuth |
| GET | `/api/admin/members/:id/enrollments` | `routes/admin/members.ts` | requireAuth |
| POST | `/api/admin/members/:id/enrollments` | `routes/admin/members.ts` | requireAuth |
| DELETE | `/api/admin/members/:id/enrollments/:courseId` | `routes/admin/members.ts` | requireAuth |
| GET/POST | `/api/admin/community` | `routes/admin/community.ts` | requireAuth |
| GET/PUT/DELETE | `/api/admin/community/:id` | `routes/admin/community.ts` | requireAuth |
| POST | `/api/admin/community/:id/channels` | `routes/admin/community.ts` | requireAuth |
| PUT/DELETE | `/api/admin/community/channels/:channelId` | `routes/admin/community.ts` | requireAuth |
| GET/POST | `/api/admin/community/channels/:channelId/posts` | `routes/admin/community.ts` | requireAuth |
| PUT/DELETE | `/api/admin/community/posts/:postId` | `routes/admin/community.ts` | requireAuth |
| GET | `/api/admin/community/posts/:postId/comments` | `routes/admin/community.ts` | requireAuth |
| DELETE | `/api/admin/community/comments/:commentId` | `routes/admin/community.ts` | requireAuth |
| GET/POST | `/api/admin/community/:id/members` | `routes/admin/community.ts` | requireAuth |
| PUT/DELETE | `/api/admin/community/memberships/:membershipId` | `routes/admin/community.ts` | requireAuth |
| GET | `/api/admin/community/:id/leaderboard` | `routes/admin/community.ts` | requireAuth |
| GET/POST | `/api/admin/community/:id/challenges` | `routes/admin/community.ts` | requireAuth |
| PUT/DELETE | `/api/admin/community/challenges/:challengeId` | `routes/admin/community.ts` | requireAuth |
| GET | `/api/admin/community/challenges/:challengeId/entries` | `routes/admin/community.ts` | requireAuth |
| PUT | `/api/admin/community/entries/:entryId/approve` | `routes/admin/community.ts` | requireAuth (transactional, idempotent) |
| GET/POST | `/api/admin/community/:id/events` | `routes/admin/community.ts` | requireAuth |
| PUT/DELETE | `/api/admin/community/events/:eventId` | `routes/admin/community.ts` | requireAuth |
| GET/POST | `/api/admin/community/:id/badges` | `routes/admin/community.ts` | requireAuth |
| DELETE | `/api/admin/community/badges/:badgeId` | `routes/admin/community.ts` | requireAuth |
| GET/POST | `/api/admin/sales/plans` | `routes/admin/sales.ts` | requireAuth |
| PUT/DELETE | `/api/admin/sales/plans/:id` | `routes/admin/sales.ts` | requireAuth |
| GET | `/api/admin/sales/payments` | `routes/admin/sales.ts` | requireAuth |
| GET | `/api/admin/sales/subscriptions` | `routes/admin/sales.ts` | requireAuth |
| GET | `/api/admin/sales/invoices` | `routes/admin/sales.ts` | requireAuth |
| GET | `/api/admin/sales/revenue` | `routes/admin/sales.ts` | requireAuth |
| GET/POST | `/api/admin/sales/coupons` | `routes/admin/sales.ts` | requireAuth |
| PUT/DELETE | `/api/admin/sales/coupons/:id` | `routes/admin/sales.ts` | requireAuth |
| GET | `/api/admin/sales/stripe-status` | `routes/admin/sales.ts` | requireAuth (live Stripe call, uncached) |
| GET | `/api/admin/sales/balance` | `routes/admin/sales.ts` | requireAuth — **dead, zero callers** |
| GET | `/api/admin/growth/coaching/sessions` | `routes/admin/growth.ts:46` | requireAuth — **shadows the generated list** |
| GET | `/api/admin/growth/podcasts/:id/episodes` | `routes/admin/growth.ts` | requireAuth |
| GET/POST | `/api/admin/growth/podcasts/:id/tokens` | `routes/admin/growth.ts` | requireAuth |
| DELETE | `/api/admin/growth/tokens/:tokenId` | `routes/admin/growth.ts` | requireAuth (revoke, not delete) |
| GET | `/api/admin/growth/newsletters/:id/issues` | `routes/admin/growth.ts` | requireAuth |
| POST | `/api/admin/growth/issues/:id/send` | `routes/admin/growth.ts` | requireAuth — 202, detached |
| GET | `/api/admin/growth/campaigns/audience/:audience` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/campaigns/:id/sends` | `routes/admin/growth.ts` | requireAuth |
| POST | `/api/admin/growth/campaigns/:id/send` | `routes/admin/growth.ts` | requireAuth — 202, detached |
| GET | `/api/admin/growth/funnels/:id/steps` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/automations/:id/actions` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/automations/:id/runs` | `routes/admin/growth.ts` | requireAuth |
| POST | `/api/admin/growth/automations/:id/test` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/forms/:id/submissions` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/reports/subscriptions` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/reports/audience` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/reports/funnels` | `routes/admin/growth.ts` | requireAuth |
| GET | `/api/admin/growth/reports/content` | `routes/admin/growth.ts` | requireAuth |
| GET/:id, DELETE | `/api/admin/chats`, `/api/admin/chats/:id` | `routes/admin/chats.ts` | requireAuth (DELETE returns 200, not 204) |

#### 2.4.2 Generated CRUD resources (17 × 5 = 85)

Factory: `routes/admin/crudFactory.ts` — `buildAdminCrudRouter(repo, createSchema, updateSchema, orderBy?)`. Each resource gets `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`. **`DELETE /:id` is the only route in the entire codebase carrying `requireRole('admin')`.**

| Prefix | Repo | Table | orderBy | Schemas | Registered in |
|---|---|---|---|---|---|
| `/api/admin/blog` | `blogRepo` | `blog_posts` | `created_at DESC` | `blogSchema` / `blogUpdateSchema` | `admin/blog.ts` |
| `/api/admin/courses` | `coursesRepo` | `courses` | default | `courseSchema` / `courseUpdateSchema` | `admin/courses.ts` |
| `/api/admin/testimonials` | `testimonialsRepo` | `testimonials` | default | `testimonialSchema` / update | `admin/testimonials.ts` |
| `/api/admin/resources` | `resourcesRepo` | `resources` | default | `resourceSchema` / update | `admin/resources.ts` |
| `/api/admin/growth/coaching/sessions` | `coachingSessionsRepo` | `coaching_sessions` | `scheduled_at DESC NULLS LAST` | **`anySchema`** | `growth.ts:63` |
| `/api/admin/growth/coaching/offers` | `coachingOffersRepo` | `coaching_offers` | default | **`anySchema`** | `growth.ts:64` |
| `/api/admin/growth/episodes` | `podcastEpisodesRepo` | `podcast_episodes` | `id DESC` | **`anySchema`** | `growth.ts:121` |
| `/api/admin/growth/podcasts` | `podcastsRepo` | `podcasts` | `id DESC` | **`anySchema`** | `growth.ts:122` |
| `/api/admin/growth/issues` | `newsletterIssuesRepo` | `newsletter_issues` | `created_at DESC` | **`anySchema`** | `growth.ts:192` |
| `/api/admin/growth/newsletters` | `newslettersRepo` | `newsletters` | `id DESC` | **`anySchema`** | `growth.ts:193` |
| `/api/admin/growth/campaigns` | `campaignsRepo` | `email_campaigns` | `created_at DESC` | **`anySchema`** | `growth.ts:299` |
| `/api/admin/growth/steps` | `funnelStepsRepo` | `funnel_steps` | default | **`anySchema`** | `growth.ts:314` |
| `/api/admin/growth/funnels` | `funnelsRepo` | `funnels` | `id DESC` | **`anySchema`** | `growth.ts:315` |
| `/api/admin/growth/actions` | `automationActionsRepo` | `automation_actions` | default | **`anySchema`** | `growth.ts:359` — **PUT is broken, see §3.4** |
| `/api/admin/growth/automations` | `automationsRepo` | `automations` | `id DESC` | **`anySchema`** | `growth.ts:360` |
| `/api/admin/growth/forms` | `formsRepo` | `forms` | `id DESC` | **`anySchema`** | `growth.ts:375` |
| `/api/admin/growth/saved-reports` | `savedReportsRepo` | `saved_reports` | `created_at DESC` | **`anySchema`** | `growth.ts:379` |

**Routing hazards to preserve or fix in the rebuild:**
- `GET /api/admin/growth/coaching/sessions` (generated) is **unreachable** — the custom handler at `growth.ts:46` is registered before the `.use()` at line 63. The generated `GET /:id`, `POST`, `PUT`, `DELETE` remain reachable.
- Child collections mount under **sibling** prefixes, not nested paths: episodes at `/growth/episodes`, issues at `/growth/issues`, steps at `/growth/steps`, actions at `/growth/actions`.
- 13 of 17 generated resources validate with `anySchema` (`z.record(z.unknown())`) — **zod validates nothing**; the repo column whitelist is the only input guard. `trigger_type`, `action_type`, `status` and `audience` are unvalidated free text.
- `resolveAudience()` falls back to `all_subscribers` for any unrecognised key — **a typo silently mails the entire subscriber list.**
- Status-code inconsistencies: `DELETE /admin/chats/:id` → 200; every other hand-written DELETE → 204. `POST /admin/members/:id/enrollments` → 200 when already enrolled, else 201.

---

## 3. Data model

**Live database: 48 tables** (verified `information_schema.tables`, 2026-08-17). All 48 come from the `schema.sql` baseline.

**A further 7 tables are defined in source but DO NOT EXIST in the live database** — the 6 from `migrations/001_phase1_member_identity.sql` plus `schema_migrations`. See §0.1. Row counts below are `n/a (table absent)` for those.

### 3.1 Core content & CMS

| Table | Key columns | Indexes | FKs | Rows |
|---|---|---|---|---|
| `admin_users` | `id SERIAL PK`, `email TEXT UNIQUE`, `password_hash`, `name`, `role TEXT DEFAULT 'admin'`, `created_at` | email unique | — | **1** |
| `blog_posts` | `id`, `slug UNIQUE`, `title`, `excerpt`, `body_md`, `cover_image`, `tags TEXT[]`, `author`, `read_minutes`, `published`, `published_at`, `created_at`, `updated_at` | `idx_blog_posts_published (published, published_at DESC)`; `idx_blog_posts_tags` GIN | — | **8** |
| `courses` | `id`, `slug UNIQUE`, `title`, `subtitle`, `description`, `price_text`, `image`, `url DEFAULT '#'`, `features JSONB`, `sort`, `published`, `price_cents INT NULL`, `currency`, `stripe_price_id` | slug unique | — | **17** (14 published, 3 draft) |
| `testimonials` | `id`, `name`, `credential`, `quote`, `practice`, `image`, `sort`, `published` | — | — | **7** |
| `resources` | `id`, `slug UNIQUE`, `title`, `description`, `image`, `cta_label`, `cta_url`, `kind`, `sort`, `published` | slug unique | — | **4** |
| `pages` | **`slug TEXT PK`** (no integer id), `title`, `description`, `sections JSONB`, `updated_at` — no `created_at` | slug PK | — | **3** |
| `settings` | `key TEXT PK`, `value JSONB` | key PK | — | **4** |
| `media_assets` | `id`, `filename`, `original_name`, `url`, `mime`, `kind`, `size_bytes BIGINT`, `title`, `folder`, `created_at` | `idx_media_assets_kind (kind, created_at DESC)` | — | **0** |

### 3.2 Courses & curriculum

| Table | Key columns | Indexes | FKs | Rows |
|---|---|---|---|---|
| `course_modules` | `id`, `course_id`, `title`, `summary`, `sort`, timestamps | `idx_course_modules_course (course_id, sort)` | `course_id → courses.id` **CASCADE** | **0** |
| `course_lessons` | `id`, `module_id`, `title`, `body_md`, `video_url`, `attachment_url`, `duration_minutes`, `preview`, `published`, `sort` | `idx_course_lessons_module (module_id, sort)` | `module_id → course_modules.id` **CASCADE** | **0** |
| `enrollments` | `id`, `member_id`, `course_id`, `progress INT`, `created_at`, `UNIQUE (member_id, course_id)` | `idx_enrollments_course (course_id)` | `member_id → members` CASCADE; `course_id → courses` CASCADE | **0** |

### 3.3 Contacts & conversations

| Table | Key columns | Indexes | FKs | Rows |
|---|---|---|---|---|
| `leads` | `id`, `name`, `email TEXT` **(not unique, case-sensitive)**, `phone`, `message`, `source`, `meta JSONB`, `status`, `created_at` — **no `updated_at`** | `idx_leads_status (status)` | — | **1** |
| `subscribers` | `id`, `email TEXT UNIQUE` **(case-sensitive)**, `source`, `created_at` | email unique | — | **0** |
| `members` | **live:** `id`, `email TEXT UNIQUE`, `name`, `status` CHECK, `created_at`, `updated_at`. **Source-only (migration 001, unapplied):** `email` retyped to `CITEXT`, `password_hash`, `first_name`, `last_name`, `avatar_url`, `timezone`, `locale`, `email_verified_at`, `last_login_at` | email unique | — | **0** |
| `chat_sessions` | `id TEXT PK`, `started_at`, `meta JSONB` | id PK | — | 1 |
| `chat_messages` | `id`, `session_id TEXT`, `role`, `content`, `created_at` | `idx_chat_messages_session (session_id)` | `session_id → chat_sessions.id` **CASCADE** | — |

> **Hostile probe row.** `leads` holds exactly one row, and it is not a real enquiry: `id=1`, name `Robert Sec-Test '); DROP TABLE leads;--`, email `sectest+sqltest@example.com`, source `contact`, status `new`, created `2026-07-26 20:54:06+00`. This is a **SQL-injection probe against the public lead form**. The attack failed — all SQL is parameterized and the payload was stored as inert text — but it confirms the public endpoints are being actively probed, and it means the "1 lead" in the DB is **zero real leads**. Exclude it from any migration or demo dataset.

### 3.4 Community (9 tables)

| Table | Key columns | Indexes | FKs | Rows |
|---|---|---|---|---|
| `communities` | `id`, `slug UNIQUE`, `name`, `description`, `cover_image`, `access` (free\|paid), `published`, timestamps | slug unique | — | **1** |
| `community_channels` | `id`, `community_id`, `slug`, `name`, `format` (feed\|chat), `visibility`, `sort`, `UNIQUE (community_id, slug)` | `idx_channels_community (community_id, sort)` | `community_id` CASCADE | **0** |
| `community_memberships` | `id`, `community_id`, `member_id`, `role`, `points INT`, `joined_at` (not `created_at`), `UNIQUE (community_id, member_id)` | `idx_memberships_points (community_id, points DESC)` | both CASCADE | — |
| `community_posts` | `id`, `channel_id`, `member_id NULL`, `author_name`, `title`, `body`, `media_url`, `pinned`, `status`, timestamps | `idx_posts_channel (channel_id, pinned DESC, created_at DESC)` | `channel_id` CASCADE; `member_id` SET NULL | — |
| `community_comments` | `id`, `post_id`, `member_id NULL`, `author_name`, `body`, `status` | `idx_comments_post (post_id, created_at)` | `post_id` CASCADE; `member_id` SET NULL | — |
| `community_reactions` | `id`, `post_id`, `member_id`, `emoji`, `UNIQUE (post_id, member_id, emoji)` | — | both CASCADE | — |
| `community_challenges` | `id`, `community_id`, `title`, `description`, `starts_at`, `ends_at`, `points`, `published` | — | `community_id` CASCADE (**unindexed**) | — |
| `community_challenge_entries` | `id`, `challenge_id`, `member_id`, `proof_url`, `note`, `approved`, `UNIQUE (challenge_id, member_id)` | — | both CASCADE | — |
| `community_events` | `id`, `community_id`, `title`, `starts_at`, `duration_minutes`, `location_url`, `published` | — | `community_id` CASCADE (**unindexed**) | — |
| `community_badges` | `id`, `community_id`, `name`, `emoji`, `threshold` | — | `community_id` CASCADE (**unindexed**) | — |

### 3.5 Commerce

| Table | Key columns | Indexes | FKs | Rows |
|---|---|---|---|---|
| `orders` | `id`, `course_id NULL`, `course_slug`, `course_title`, `email TEXT`, `amount_cents`, `currency`, `status` (pending\|paid\|failed\|expired, **no CHECK**), `stripe_session_id UNIQUE`, `stripe_payment_intent_id`, timestamps | `idx_orders_status (status, created_at DESC)` | `course_id → courses` **SET NULL** (unindexed) | **0** |
| `plans` | `id`, `slug UNIQUE`, `name`, `price_cents`, `currency`, `interval`, `stripe_price_id`, `features JSONB`, `community_id NULL`, `trial_days`, `published`, `sort` | slug unique | `community_id → communities` SET NULL (unindexed) | **0** |
| `subscriptions` | `id`, `member_id NULL`, `plan_id NULL`, `email`, `stripe_customer_id`, `stripe_subscription_id UNIQUE **NULLABLE**`, `status`, `current_period_end`, `cancel_at_period_end`, `amount_cents`, `currency` | `idx_subscriptions_status (status, created_at DESC)` | `member_id`, `plan_id` both SET NULL (unindexed) | **0** |
| `invoices` | `id`, `stripe_invoice_id UNIQUE`, `subscription_id NULL`, `email`, `amount_paid_cents`, `currency`, `status`, `hosted_invoice_url` | invoice id unique | `subscription_id → subscriptions` SET NULL (unindexed) | **0** |
| `coupons` | `id`, `code UNIQUE`, `percent_off NULL`, `amount_off_cents NULL`, `currency`, `stripe_coupon_id`, `max_redemptions`, `redeemed INT`, `expires_at`, `active` | code unique | **referenced by nothing** | **0** |

### 3.6 Growth suite

| Table | Key columns | Indexes | FKs | Rows |
|---|---|---|---|---|
| `coaching_offers` | `id`, `slug UNIQUE`, `title`, `session_count`, `duration_minutes`, `price_cents`, `currency`, `stripe_price_id`, `format`, `booking_url`, `published`, `sort` | slug unique | — | **0** |
| `coaching_sessions` | `id`, `offer_id NULL`, `member_id NULL`, `scheduled_at`, `duration_minutes`, `status`, `meeting_url`, `agenda`, `private_notes` | `idx_sessions_schedule (scheduled_at)` | `offer_id` SET NULL; `member_id` **CASCADE on a nullable column** | **0** |
| `podcasts` | `id`, `slug UNIQUE`, `title`, `cover_image`, `author`, `category`, `language`, `explicit`, `visibility`, `published` | slug unique | — | **0** |
| `podcast_episodes` | `id`, `podcast_id`, `title`, `slug` (not unique), `show_notes_md`, `audio_url`, `audio_bytes BIGINT`, `duration_seconds`, `episode_number`, `season`, `published`, `published_at` | `idx_episodes_podcast (podcast_id, published_at DESC)` | `podcast_id` CASCADE | **0** |
| `podcast_feed_tokens` | `id`, `podcast_id`, `member_id NULL`, `token TEXT UNIQUE` **(cleartext)**, `revoked` | token unique | both CASCADE (unindexed) | — |
| `newsletters` | `id`, `slug UNIQUE`, `name`, `access`, `plan_id NULL`, `published` | slug unique | `plan_id → plans` SET NULL (unindexed) | **0** |
| `newsletter_issues` | `id`, `newsletter_id`, `subject`, `preview_text`, `body_md`, `status`, `scheduled_at`, `sent_at`, `recipient_count` | — | `newsletter_id` CASCADE (unindexed) | — |
| `email_campaigns` | `id`, `name`, `subject`, `preview_text`, `body_md`, `audience`, `status`, `scheduled_at`, `sent_at`, `recipient_count`, `delivered_count`, `failed_count`, `opened_count`, `clicked_count` | — | — | **0** |
| `email_sends` | `id`, `campaign_id`, `email`, `status`, `error`, `opened_at`, `sent_at`, `UNIQUE (campaign_id, email)` — **no `created_at`** | `idx_email_sends_campaign (campaign_id, status)` | `campaign_id` CASCADE | — |
| `funnels` | `id`, `slug UNIQUE`, `name`, `kind`, `published` | slug unique | — | **0** |
| `funnel_steps` | `id`, `funnel_id`, `name`, `slug`, `step_type`, `headline`, `body_md`, `cta_label`, `cta_url`, `sort`, `views`, `conversions` | `idx_funnel_steps (funnel_id, sort)` | `funnel_id` CASCADE | — |
| `automations` | `id`, `name`, `trigger_type`, `conditions JSONB`, `status`, `run_count`, `last_run_at` | `idx_automations_trigger (trigger_type, status)` | — | **0** |
| `automation_actions` | `id`, `automation_id`, `action_type`, `config JSONB`, `sort` — **no `created_at`, no `updated_at`** | — | `automation_id` CASCADE (**unindexed**) | — |
| `automation_runs` | `id`, `automation_id`, `status`, `subject_email`, `log JSONB`, `created_at` | `idx_automation_runs (automation_id, created_at DESC)` | `automation_id` CASCADE | — |
| `forms` | `id`, `slug UNIQUE`, `name`, `fields JSONB`, `submit_label`, `success_message`, `create_lead`, `published`, `views` | slug unique | — | **0** |
| `form_submissions` | `id`, `form_id`, `data JSONB`, `email`, `created_at` | `idx_form_submissions (form_id, created_at DESC)` | `form_id` CASCADE | — |
| `saved_reports` | `id`, `name`, `kind`, `config JSONB`, timestamps | — | — | — |

### 3.7 Defined in source but ABSENT from the live database

| Table | Source | Live status |
|---|---|---|
| `schema_migrations` | `src/db/migrate.ts:23` (runtime) | **absent** |
| `member_sessions` | migration 001:50 | **absent** |
| `member_password_resets` | migration 001:68 | **absent** |
| `member_email_verifications` | migration 001:80 | **absent** |
| `member_magic_links` | migration 001:97 | **absent** — also has no index on `member_id` (the other three token tables do) |
| `member_login_attempts` | migration 001:112 | **absent** |
| `admin_audit_log` | migration 001:132 | **absent** — and **zero code writes to it** even in source |

### 3.8 Confirmed schema defects

| # | Defect | Consequence |
|---|---|---|
| 1 | **`automation_actions` has no `updated_at`** but is wired to `createCrudRepo`, whose `update()` unconditionally appends `, updated_at = now()` (`src/db/repo.ts:66`) | **`PUT /api/admin/growth/actions/:id` fails with SQL 42703** — `column "updated_at" of relation "automation_actions" does not exist`. Fix: `ALTER TABLE automation_actions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();` |
| 2 | **No `updated_at` trigger anywhere.** `updated_at` is only correct on rows written through `createCrudRepo.update()`. Every hand-written UPDATE (members, orders, subscriptions, leads, webhooks) must remember it | Silent staleness across the commerce tables |
| 3 | **`subscriptions.stripe_subscription_id` is UNIQUE but NULLABLE** | Postgres permits unlimited NULLs → a webhook race inserting before the id is known produces duplicate subscription rows the unique index will not catch |
| 4 | **22 unindexed foreign keys**, including every `community_*.community_id`, `subscriptions.member_id/plan_id`, `invoices.subscription_id`, `automation_actions.automation_id` | Every DELETE on `members`/`courses`/`communities`/`plans` seq-scans each referencing table, and CASCADE fans out across all of them |
| 5 | **No FK uses RESTRICT** (26 CASCADE, 12 SET NULL, 0 RESTRICT) | Nothing protects a course/plan/community from deletion while paid entitlements reference it. Deleting a plan silently orphans revenue records |
| 6 | **`coaching_sessions.member_id` is CASCADE on a nullable column** | Deleting a member destroys booked-session history including `private_notes` |
| 7 | **Only `members.status` has a CHECK constraint.** All other status columns are free TEXT with vocabularies documented only in comments | Any new state machine inherits the looseness |
| 8 | **Money is INT cents with no `CHECK (>= 0)`**; `currency` is free TEXT DEFAULT `'usd'` on 7 tables with no CHECK | Nothing prevents a usd offer producing an eur order; every revenue SUM mixes currencies |
| 9 | **`admin_users.email` is case-sensitive TEXT** while `members.email` is intended to be CITEXT | The same person can exist as `Admin@x.com` and `admin@x.com` across the two identity stores |
| 10 | **Denormalized counters with no ledger** — `funnel_steps.views/conversions`, `forms.views`, `automations.run_count`, `email_campaigns.*_count`, `coupons.redeemed`, `community_memberships.points` | Every one is a lost-update race under concurrency and none can be recomputed. The `schema.sql:242` comment promises a points ledger that does not exist |

### 3.9 `createCrudRepo` constraints that will shape new tables

- Hardcodes an **integer `id` PK** (`WHERE id = $1`) — `pages`/`settings`/`chat_sessions` can never use it, nor can any UUID-keyed table.
- `update()` always writes `updated_at` → every new CRUD table needs the column from day one.
- `list()` default `orderBy` is `sort ASC, id ASC` → any new table without a `sort` column 500s if a caller forgets an explicit `orderBy`.
- `where` and `orderBy` are **string-interpolated** into SQL (`repo.ts:30-32`). Safe today (literals only) but this is the injection hole the moment filtering becomes request-driven.
- `list()` has **no LIMIT/OFFSET** and routes never pass `where` — admin list endpoints return every row.
- **No soft delete**: `remove()` is a hard DELETE and every FK is CASCADE or SET NULL.

---

## 4. Auth model

### 4.1 The admin bearer token — issuance → storage → validation → expiry

| Stage | Mechanism |
|---|---|
| **Issued by** | `POST /api/admin/login` → `routes/admin/auth.ts:47`. Validates `loginSchema`, `bcrypt.compare` against `admin_users.password_hash` (with a dummy-hash compare on miss for constant timing), then `signToken({ sub: row.id, email: row.email, role: row.role })`. |
| **Signer** | `src/utils/jwt.ts:5` — `jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn, algorithm: 'HS256' })`. |
| **Claims** | `sub` (`admin_users.id`), `email`, `role` (defaults `'admin'`), `iat`, `exp`. **No `aud`, no `iss`, no `jti`, no `kid`.** |
| **TTL** | **7 days**, hardcoded at `src/config/env.ts:24` (`jwtExpiresIn: '7d' as const`). **Not env-overridable.** |
| **Browser storage** | `localStorage`, key **`bc_admin_token`** (`frontend/src/lib/api.ts:47-59`). Readable by any injected script. Sent as `Authorization: Bearer` on every admin request (`api.ts:78-80`) and on the XHR upload path (`api.ts:539-540`). |
| **Validation** | `src/middleware/auth.ts:6-19` `requireAuth` — parses `Bearer `, calls `verifyToken` (`jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] })`), assigns `req.user`. **No DB re-check of the admin account on any request** except `GET /api/admin/me`. |
| **Refresh** | **NONE.** No refresh token, no rotation, no sliding expiry. The 7-day JWT is the only credential. |
| **Revocation** | **NONE.** No denylist, no session table, no token version, no `jti`. Logout is frontend-only (`clearToken()` removes the localStorage key). **A stolen admin token is valid for its full 7 days and cannot be killed** — not by password change, not by deleting the `admin_users` row. |
| **Rate limiting** | `POST /api/admin/login` only: `loginIpLimiter` (5/15min per IP) + `loginEmailLimiter` (5/15min per IP+lowercased email). **Every other `/api/admin/*` route has no limiter of any kind.** |

**Authorization granularity.** `requireRole('admin')` appears in **exactly one place** — `crudFactory.ts:71`, the generated `DELETE /:id`. Every hand-written DELETE (`community.ts`, `members.ts`, `media.ts`, `chats.ts`, `curriculum.ts`, growth tokens) needs only a valid JWT regardless of role. **There is effectively one privilege level.**

### 4.2 Is there a non-admin identity? — the brief is wrong

**The brief's premise that no non-admin identity concept exists anywhere is FALSE.** A complete member (customer) identity subsystem has been written. What is true is that **none of it is deployed**, and the reasons differ from what the sweeps reported.

| Component | Source status | Live status |
|---|---|---|
| `migrations/001_phase1_member_identity.sql` | exists | **never applied** — no `schema_migrations`, no `citext`, `members.email` still TEXT, no `password_hash` |
| `src/auth/memberSession.ts`, `password.ts`, `tokens.ts` | exist | not in deployed `dist/` |
| `src/middleware/memberAuth.ts` | exists | not in deployed `dist/` |
| `src/routes/auth/index.ts` | exists | not in deployed `dist/routes/` |
| `src/routes/auth/memberAuth.ts` | **written today 13:10** (23,105 B) | not deployed |
| `src/routes/auth/memberAccount.ts` | **written today 13:11** (11,776 B) | not deployed |
| `src/routes/member/index.ts` | exists — applies `requireMember` then **mounts nothing** ("Phase 2 mounts billing here") | not deployed |
| `frontend/src/lib/memberApi.ts`, `hooks/useMember.tsx` | exist | shipped in the bundle, calling endpoints that 404 |

**Correction to the auth-security and ops sweeps:** both reported the backend as non-compiling because `routes/auth/index.ts` imported two non-existent modules. Those modules have since been written and **`npx tsc -p tsconfig.json --noEmit` now exits 0.** The build blocker is cleared; the *deployment* gap remains.

**Orphaned frontend calls** (15 endpoints the frontend references that do not exist in the deployed backend): `/api/auth/register`, `/login`, `/logout`, `/refresh`, `/me`, `/me/password`, `/me/avatar`, `/me/sessions`, `/me/sessions/:id`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`, `/magic-link`, `/magic-link/consume`.

**Member token design as written** (good, but unreachable): HS256 access JWT with `aud='bc:member'`, TTL 900s; opaque 32-byte CSPRNG refresh token stored **SHA-256-hashed only**, TTL 30d, in an HttpOnly cookie `bc_member_refresh` (`sameSite=lax`, `path=/api/auth`, `secure` only when `NODE_ENV=production`); rotation via `SELECT … FOR UPDATE` with **reuse detection** that revokes the member's entire session set; members re-read from the DB on every request so suspend/delete takes effect immediately; access token held in a module-scope JS variable, **not** localStorage. This is a materially better design than the admin token and should become the template for both.

### 4.3 CRITICAL — cross-audience privilege escalation

`verifyToken` (`src/utils/jwt.ts:13`) passes **no `audience` option**, while `signMemberAccessToken` (`src/auth/memberSession.ts:38`) signs with `audience: 'bc:member'` using **the same `env.jwtSecret`**.

Empirically proven: a token signed exactly as `signMemberAccessToken` does is **accepted by the admin `verifyToken`**, yielding `req.user = { sub: 123, email: 'customer@example.com', aud: 'bc:member' }` with `role = undefined`. The reverse direction correctly rejects (`jwt audience invalid`). The comment at `memberSession.ts:23-27` asserts the two token types "can never be interchanged" — **that guarantee holds in only one direction.**

**Blast radius:** because `requireRole('admin')` guards only the generated DELETE, a member token with `role=undefined` passes **every admin GET/POST/PUT plus every hand-written DELETE**.

**Not currently exploitable** only because no deployed code path can mint a member token. **It becomes live the moment `routes/auth/memberAuth.ts` is deployed — which is now one `docker compose build backend` away.**

**Fix:** add `{ audience: 'bc:admin' }` to both `signToken` and `verifyToken`, or use separate secrets. Note that rotating `JWT_SECRET` invalidates every admin session, and the single secret currently signs both families.

### 4.4 Transport & platform security

| Control | State |
|---|---|
| Security headers | Set **only** by edge nginx (`nginx/site.conf:18-28`, all `always`). **No helmet** in the backend. HSTS `max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a strict CSP. |
| **CSP breaks voice** | `connect-src 'self'` blocks `useVoiceAgent.ts:203` fetching `https://api.openai.com/v1/realtime/calls`, **and** `Permissions-Policy: microphone=()` revokes mic access for the whole origin. **The WebRTC voice agent is broken in production by these two headers.** |
| CORS | `FRONTEND_ORIGIN=https://bossclinician.callsphere.site` in `backend/.env` → single fixed origin, `credentials: true`. Correct. **But the default when unset is `'*'` → `origin: true`, which reflects any Origin.** |
| CSRF | **No CSRF token anywhere.** The member refresh cookie relies solely on SameSite=Lax + `path=/api/auth`. |
| SQL injection | **No injectable site found.** Every user-controlled value reaches Postgres as a bind parameter; all dynamic fragments are developer-supplied constants or allowlisted column names. |
| `/uploads/*` | `express.static` with **no authentication** (`app.ts:41`). Course videos and all admin uploads are world-readable by URL — security by obscurity for paid content. |
| Secrets | `backend/.env` (mode 0600, not in git — **the repo is not a git working tree at all**) holds a live `JWT_SECRET`. |
| Rate-limit store | `express-rate-limit` **in-process memory** — not shared across replicas, resets on every deploy. `member_login_attempts` was purpose-built for durable throttling but **no code reads or writes it**. |

---

## 5. Payments

### 5.1 Configuration — LIVE KEYS, READ THIS BEFORE PHASE 2

> ### ⚠ The configured Stripe keys are LIVE mode, not test mode.
>
> - `STRIPE_SECRET_KEY=sk_live_…` (`backend/.env`)
> - `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…` (root `.env`, **baked into the browser bundle at build time**)
> - `STRIPE_WEBHOOK_SECRET=whsec_…` (live endpoint)
>
> **Consequence: no end-to-end purchase can be exercised without real money changing hands.** Every checkout attempt against this configuration creates a real charge on a real card and a real payout obligation. Stripe test cards (`4242…`) are rejected outright by a live key, so the flow cannot even be smoke-tested.
>
> **Test-mode keys are a hard prerequisite for Phase 2 acceptance.** Nothing in the payment path can be demonstrated, validated, or signed off until `sk_test_`/`pk_test_` keys and a test-mode webhook secret are installed. Because the publishable key is a **Vite build ARG**, swapping it requires `docker compose build frontend`, not just a restart.
>
> Recommended: separate `.env` profiles for test and live, with the live keys reinstated only at go-live, plus `stripe listen --forward-to` for local webhook delivery.

### 5.2 Stripe mode, SDK and API version

| Item | Value |
|---|---|
| **Mode** | **LIVE** (`sk_live_` / `pk_live_`) |
| **SDK** | `stripe` — declared `^22.3.2` (`backend/package.json:28`), installed `22.3.2`. **Caret range, not pinned** — a minor bump changes the bundled API version with no code change |
| **API version in code** | **Not set.** `new Stripe(env.stripe.secretKey)` at `src/stripe/client.ts:17` — no options object, no `apiVersion` |
| **Effective outbound version** | **`2026-06-24.dahlia`** (stripe-node's bundled default, `node_modules/stripe/cjs/apiVersion.js:5`). stripe-node pins its own version per request, so **the account default is not used for outbound calls** |
| **Inbound webhook version** | Rendered at whatever version the **dashboard endpoint** is configured for — a separate, unversioned-in-code setting. The handler already reads new-API-only fields (`invoice.parent.subscription_details.subscription`, `subscription.items.data[0].current_period_end`); on an older endpoint version both resolve to undefined and the code **silently writes NULL** rather than erroring |
| **Client lifecycle** | Lazily constructed singleton; throws `HttpError(503)` when `STRIPE_SECRET_KEY` is unset |

### 5.3 Webhooks handled

Handler: `src/routes/public/stripeWebhook.ts`, `POST /api/stripe/webhook`. Signature verified via `stripe().webhooks.constructEvent`. Raw body mount (`express.raw({type:'application/json', limit:'1mb'})`) **must stay ahead of `express.json()`** in `app.ts`.

| Event | Branch | Writes | Idempotency |
|---|---|---|---|
| `checkout.session.completed` | `mode='subscription'` | `members` upsert → `subscriptions` upsert → `community_memberships` insert | `ON CONFLICT (stripe_subscription_id) DO UPDATE` |
| `checkout.session.completed` | `mode='payment'` && `payment_status='paid'` | `UPDATE orders SET status='paid', …` + fires `order_paid` automation + notify email | `WHERE status <> 'paid'` |
| `checkout.session.expired` | — | `UPDATE orders SET status='expired' WHERE status='pending'` | predicate |
| `checkout.session.async_payment_failed` | — | `UPDATE orders SET status='failed' WHERE status <> 'paid'` | predicate |
| `customer.subscription.created` | shared | `UPDATE subscriptions SET status, current_period_end, cancel_at_period_end` | UPDATE-only |
| `customer.subscription.updated` | shared | same | UPDATE-only |
| `customer.subscription.deleted` | shared | same, status forced `'canceled'` | UPDATE-only |
| `invoice.paid` | shared | `INSERT INTO invoices … ON CONFLICT (stripe_invoice_id) DO UPDATE` | conflict key |
| `invoice.payment_failed` | shared | same INSERT with `status='failed'` | conflict key |

**Not handled** (falls through `default: break` → 200 `{received:true}`, nothing recorded): `charge.refunded`, `charge.dispute.created/closed`, `payment_intent.succeeded/payment_failed/processing`, `invoice.payment_action_required/finalized/upcoming`, `customer.subscription.trial_will_end/paused/resumed`, `checkout.session.async_payment_succeeded`, `payout.*`, `radar.*`, `customer.*`.

**Webhook defects:**
1. **No transaction anywhere.** The subscription branch does 3 dependent writes with no BEGIN/COMMIT — a mid-branch failure leaves a member with no subscription (or a subscription with no community grant), then the 500 makes Stripe replay the whole event on top of committed writes.
2. **Subscription status is hardcoded `'active'`** even when the session has a trial (should be `'trialing'`), corrected only if a later `customer.subscription.*` event lands.
3. **A paid course order grants no access.** The payment branch writes only the `orders` row — no enrollment, no entitlement, no member row. The success page's "Access details are on their way to your inbox" is **not backed by any code**.
4. **Subscription purchases write no `orders` row**, so they never appear on the admin Payments screen.
5. **No raw event storage** — no `stripe_events` table, no event-id dedupe, no replay/backfill capability, no dead-letter queue. `grep -rn 'webhook_event|stripe_event|event.id' backend/src` → 0 matches. A failing event 500s until Stripe gives up after ~3 days, then is lost silently.
6. **No idempotency keys on any outbound call** (`grep -rn 'idempotenc' backend/src` → 0 matches). A retried `POST /checkout/session` creates a second Stripe session and a second pending order.

### 5.4 Where prices live — split, neither Stripe-canonical nor locally-canonical

| Sellable | Price storage | Stripe Price created? | Behaviour |
|---|---|---|---|
| **Courses** | `courses.price_cents` (**nullable**), `currency`, `stripe_price_id` — all added by `ALTER` at `schema.sql:127-129`. Original table has only `price_text`, a display string | **No** | `checkout.ts:57-66` — uses `stripe_price_id` if present, else builds **inline `price_data`** per session, creating an ad-hoc Product/Price on every checkout. Stripe-side product reporting is meaningless for one-time sales |
| **Plans** | `plans.price_cents`, `currency`, `interval`, `stripe_price_id`, `trial_days` | **Yes**, on create (`sales.ts:64-72`) | `PUT /admin/sales/plans/:id` updates **the local row only** — editing a price never touches Stripe, so displayed price and charged price silently diverge. DELETE removes the local row only; **the Stripe price and all live subscriptions keep billing** |
| **Coaching offers** | `coaching_offers.price_cents`, `currency`, `stripe_price_id` | No | **No checkout path at all** — `grep coaching_offers backend/src/routes/public` → 0 matches |
| **Coupons** | `coupons` + mirrored into Stripe on create | Yes | `expires_at` is **never sent** as Stripe's `redeem_by`; `duration` defaults to `'once'`. Delete is best-effort after the local row is already gone |

**Server-side price authority: yes for the amount.** Price is always read from the DB by slug, never from the request body (`checkout.ts:43-48`, `135-139`). This is correct and must be preserved.

### 5.5 Has anything ever succeeded end to end? — **No.**

**`orders` has 0 rows.** So do `subscriptions`, `invoices`, `plans`, `members` and `coupons`. **No purchase — one-time or recurring — has ever completed through this system.** The entire commerce path is unexercised in production, and given §5.1 it *cannot* be exercised without real money until test keys are installed.

Compounding this:

| Surface | State |
|---|---|
| `POST /api/checkout/subscription` | **Dead** — no frontend caller (`grep 'checkout/subscription\|planSlug' frontend/src` → 0 matches). Plans can be created and priced but **there is no public UI to buy one** |
| `POST /api/billing/portal` | **Dead** — no caller. One-time buyers have no `stripe_customer_id` anywhere, so they could never reach a portal regardless |
| `GET /api/admin/sales/balance` | **Dead** — defined at `sales.ts:342-352`, zero frontend callers |
| `POST /api/checkout/session` | The **only** live purchase path — reached from `BuyButton.tsx` on `/courses` only |
| `coupons.redeemed` | **Never incremented by any code path.** The local `redeemed < max_redemptions` gate therefore never trips, and the admin "Used" column reads "Not used yet" forever |
| Coupons on one-time purchases | **Impossible** — `POST /checkout/session` takes no `couponCode` and passes no `discounts`. Course sales, the only flow with a UI, cannot be discounted |

### 5.6 Commerce capability gaps

No order items (single denormalized row, quantity hardcoded to 1, no cart, no multi-item purchase). No refunds table or `charge.refunded` handler — refunding in the Stripe dashboard leaves the local order permanently `'paid'` and permanently counted in `grossCents`. No disputes/chargebacks. No tax (no `automatic_tax`, no address collection, no subtotal/tax/discount split). No payment plans or installments — a $2000 course can only be a single charge or an open-ended subscription; installments exist solely as a display string in `courses.price_text`. No customer record for one-time buyers. No abandoned-checkout recovery (subscription checkout writes no pending row, so it is completely invisible). No dunning. No plan change/proration. No net revenue (Stripe fees never captured; every SUM mixes currencies). No reconciliation against Stripe. Reporting is hard `LIMIT 500` with no pagination, date filter, or CSV export. **Zero commerce tests** — vitest is configured and the only test file covers pure pricing math.

---

## 6. Gap confirmation — brief's "Confirmed baseline" vs reality

| # | Claim from the brief | Verdict | Reality |
|---|---|---|---|
| 1 | No `sitemap.xml` and no `robots.txt` | **DIFFERENT — worse than described** | See §6.1 |
| 2 | Admin routes exist for marketing/sales/etc. as scaffolding | **DIFFERENT** | See §6.2 |
| 3 | No non-admin identity concept exists anywhere | **DIFFERENT — materially wrong** | A complete member identity subsystem exists in source (§4.2). What is true is that it is **undeployed** and its migration has **never been applied** |
| 4 | No background job runner | **CORRECT** | No cron/queue/worker of any kind. The automations engine is in-process fire-and-forget (§1) |
| 5 | No end-to-end payment has succeeded | **CORRECT** | `orders` = 0 rows. Additionally the keys are **LIVE**, so it cannot be tested (§5.1) |
| 6 | No error tracking | **CORRECT** | No Sentry/equivalent; errors live only in container stdout and die on redeploy |
| 7 | No tests | **PARTIALLY DIFFERENT** | Backend has vitest + **46 passing tests** in `src/services/pricing.test.ts` (pure pricing math). Frontend has **no test runner at all**. Zero tests for routes/auth/db/stripe/automations/email |
| 8 | No linting | **CORRECT, and worse** | No linter exists. `frontend`'s `npm run lint` checks **zero files** and always passes — a false green |
| 9 | Backend does not compile | **NO LONGER TRUE** | The two missing modules were written today at 13:10/13:11; `tsc --noEmit` exits 0 (§0.2) |
| 10 | 48 tables | **CORRECT for the live DB** | Verified 48. But source defines **7 more** that were never applied (§3.7) |
| 11 | Course/blog/etc. row counts | **CORRECT** | All 28 counts re-verified against the live DB and match exactly |

### 6.1 Gap (a) — sitemap.xml and robots.txt: confirmed, and worse than a 404

**Both paths return HTTP 200 serving the SPA HTML shell.** Verified live:

| Path | Status | Content-Type | Size |
|---|---|---|---|
| `/sitemap.xml` | **200** | `text/html` | 1580 |
| `/robots.txt` | **200** | `text/html` | 1580 |
| `/totally-made-up-path` | **200** | `text/html` | 1580 |

All three return byte-identical `<!doctype html>` with `<title>Boss Clinician | Private Practice Strategist for Therapists</title>`.

**Why:** neither path matches `/api/` or `/uploads/` in `nginx/site.conf`, so edge nginx proxies to the frontend container, whose `try_files $uri $uri/ /index.html` finds no such file (`frontend/public/` contains **only** an `images/` directory) and falls through to the catch-all.

**Why this is worse than a 404.** A 404 tells a crawler "nothing here, drop it." A **200 with an HTML body tells the crawler this is a real page** — so search engines index the SPA shell as the content of `/sitemap.xml`, `/robots.txt`, and **every mistyped or stale URL in existence**. Consequences: garbage in the index; `robots.txt` parsed as HTML means **no crawl directives are honoured at all**; the SPA fallback is unconditional, so genuine 404s are masked and no broken link ever reports as broken. `grep -r sitemap` and `grep -r robots` across the repo return **zero hits** — nothing generates, serves, or routes either file.

**Fix shape.** (a) Drop static `frontend/public/sitemap.xml` + `robots.txt` so Vite copies them into `dist/` — simplest, but the sitemap goes stale as blog/course content changes. (b) Add a backend route **plus** a matching `location = /sitemap.xml` block in `nginx/site.conf` pointing at `backend:4000` so it can be generated from the DB — note the backend **never sees these paths today**, so an Express route alone is not reachable. Separately, the SPA should return a real 404 status for unknown routes.

### 6.2 Gap (b) — admin marketing/sales routes are real, not shells

The brief lists admin routes for marketing/sales/etc. as if they were scaffolding. **They are backed by real CRUD.** Verified across the frontend and backend sweeps:

| Route | Reality |
|---|---|
| `/admin/marketing/campaigns` | **Real** — full CRUD + send, audience preview, markdown editor (597 ln) |
| `/admin/marketing/funnels` | **Real** — funnel + step builder with reorder, per-step conversions (730 ln) |
| `/admin/marketing/automations` | **Real** — trigger/action builder, run history, test-fire (1181 ln) |
| `/admin/marketing/forms` | **Real** — field builder, submissions viewer, share link (676 ln) |
| `/admin/marketing/events` | **Real, with a gap** — create/delete only; **no update path**, editing means delete + recreate |
| `/admin/sales/payments` | **Real** — read-only DataTable over `orders` |
| `/admin/sales/plans` | **Real, with a gap** — create/delete only; `PUT` exists on the API but is **unreachable from the UI** |
| `/admin/sales/subscriptions` | **Real** — read-only |
| `/admin/sales/invoices` | **Real** — read-only (but only ever populated by subscription invoices) |
| `/admin/sales/coupons` | **Real** — create/toggle/delete |
| `/admin/sales/payouts` | **Shell, deliberately** — the only route with no in-app content; EmptyState deep-linking to Stripe, per in-file rationale |
| `/admin/settings` | **Real UI, wiring caveat** — saves persist, but the public header/footer still read `content/site`, so changes are not reflected on the site (documented at `Settings.tsx:36-44`) |
| `/admin/pages` | **Real, scoped** — editable fields come from a hand-maintained block map; unrecognised blocks fall back to `humanizeKey` |

**The distinction that matters is not "real vs shell" but "real UI over an empty table."** Every one of these screens works; `forms`, `funnels`, `automations`, `email_campaigns`, `podcasts`, `newsletters`, `plans` and `coaching_offers` all have **0 rows**. The admin is fully built and entirely unused.

**Genuinely inert:** only the `AdminLayout` topbar search (`AdminLayout.tsx:288-295`, no binding, no consumer) and `PayoutsPage`. Zero TODO/FIXME/WIP markers exist in `src/pages`.

### 6.3 Gap (c) — the hostile SQLi probe row in `leads`

`leads` contains exactly one row, and it is an attack probe, not a customer:

```
id | name                                    | email                       | source  | status | created_at
 1 | Robert Sec-Test '); DROP TABLE leads;-- | sectest+sqltest@example.com | contact | new    | 2026-07-26 20:54:06+00
```

**Assessment:** the injection **failed** — `POST /api/leads` binds every value as `$n`, so the payload was stored as inert text and no SQL was executed. The defence held. But three things follow:

1. **The public endpoints are being actively probed.** `POST /api/leads` at least has a honeypot, a min-fill-time trap and a 30/10min limiter. `POST /api/forms/:slug/submit` — its functional twin — has **no honeypot, no captcha and no rate limit at all**, and additionally fires automations and sends email. That is the endpoint to harden first.
2. **The real lead count is zero.** Any dashboard, migration or demo dataset treating "1 lead" as genuine is wrong. Delete this row as part of the rebuild's data cleanup.
3. **Parameterization must remain a standing invariant.** `repo.ts:30-32` interpolates `where`/`orderBy` as strings — safe today only because every call site passes a literal. The moment filtering becomes request-driven, this row's payload becomes a working exploit.

---

## 7. Delivery plan — Phases 1–10, file level

Phases below are the brief's own, from `BOSS-CLINICIAN-FEATURE-PARITY-PROMPT.md`. Status column reflects the state as of 2026-08-17.

### Phase 0.5 — Prerequisites (not a phase; blocks validation of everything else)

| # | File / action | Status |
|---|---|---|
| 1 | **Swap `sk_live_`/`pk_live_`/live `whsec_` for test-mode keys.** The publishable key is a Vite build ARG, so this needs `docker compose build frontend`, not a restart | ⛔ **blocked on the owner** — no end-to-end purchase can be demonstrated until this is done |
| 2 | `backend/src/auth/secrets.ts`, `backend/src/utils/jwt.ts` — close the cross-audience privilege escalation (§4.3) | ✅ done — HKDF-derived member key + `role` claim assertion, pinned by `src/auth/tokenSeparation.test.ts` (7 tests) |
| 3 | `backend/src/db/migrate.ts` — forward-only migration runner with `schema_migrations` | ✅ done |
| 4 | Deploy the runner: `docker compose build backend && docker compose up -d backend`, then confirm `[migrate] applied` in the logs | ⏳ pending deploy |
| 5 | `automation_actions` missing `updated_at`, which `createCrudRepo.update()` requires (§3.8) | ⏳ folded into migration 005 |
| 6 | `nginx/site.conf` — `connect-src`/`Permissions-Policy` block the voice widget (§4.4) | ⏳ pending |
| 7 | Delete the SQLi probe row from `leads` (§6.3) | ⏳ pending |
| 8 | **Initialize git.** There is no VCS in this directory — every edit is live on disk with no history and no rollback | ⛔ **recommended before further work** |

### Phase 1 — Member identity & account

| File | Action | Status |
|---|---|---|
| `db/migrations/001_phase1_member_identity.sql` | `members` extended (citext email, password_hash, names, avatar, tz, locale, verified/last-login); `member_sessions`, `member_password_resets`, `member_email_verifications`, `member_magic_links`, `member_login_attempts`, `admin_audit_log` | ✅ written, verified against a clone of live data |
| `auth/{tokens,password,memberSession,secrets}.ts` | Token primitives, bcrypt cost 12, refresh rotation with reuse detection, domain-separated keys | ✅ |
| `middleware/memberAuth.ts` | `requireMember`, `optionalMember`, `requireVerifiedEmail` | ✅ |
| `routes/auth/{index,memberAuth,memberAccount}.ts` | The 12 `/api/auth` endpoints | ✅ |
| `routes/admin/members.ts`, `services/adminAudit.ts` | Search/filter/impersonate/reset/suspend/GDPR-delete/CSV | ✅ |
| `frontend/src/lib/memberApi.ts`, `hooks/useMember.tsx` | In-memory access token, single-flight refresh, `<RequireMember>` | ✅ |
| `frontend/src/pages/member/*`, `components/member/*` | Login, signup, forgot/reset, verify, account, profile, security | ✅ |
| `frontend/src/App.tsx` | Route wiring + `MemberAuthProvider` | ⏳ main session |

### Phase 2 — Offers, checkout & billing

| File | Action | Status |
|---|---|---|
| `db/migrations/002_phase2_offers_and_checkout.sql` | `products` (+files, bundles), `offers` (+products, bumps, upsells), `order_items`, `transactions`, `refunds`, `payment_plans` (+installments), `tax_records`, `abandoned_checkouts`, `access_grants`, `stripe_events`, `coupon_offers`; `orders`/`coupons`/`subscriptions`/`invoices` extended | ✅ written, applies clean; backfilled 17 courses → products |
| `services/pricing.ts` + `.test.ts` | Totals, coupons, tax, installment schedules, proration, DST-safe interval maths | ✅ 46 tests |
| `services/access.ts` | Grant/revoke/check — the single source of truth for entitlement | ✅ |
| `routes/public/checkoutV2.ts`, `offersPublic.ts` | `/checkout/:offerSlug`, Payment Element, bumps, upsell steps, guest checkout, abandoned capture | ⏳ |
| `routes/public/stripeWebhook.ts` | Persist raw events; add `payment_intent.*`, `charge.refunded`, `charge.dispute.created`; transactions per branch | ⏳ |
| `routes/admin/offers.ts` | Offer CRUD, duplicate, publish, upsells, refunds, manual grant | ⏳ |
| `routes/member/billing.ts` | Invoices, payment method, upcoming charges, cancel with reason capture | ⏳ |
| `frontend/src/pages/Checkout.tsx`, `CheckoutUpsell.tsx`, `pages/admin/Offers.tsx` | | ⏳ |

### Phase 3 — Product delivery

| File | Action | Status |
|---|---|---|
| `db/migrations/003_phase3_product_delivery.sql` | Typed lessons + drip, `lesson_progress`, `course_progress`, `lesson_comments`/`notes`/`files`, `download_events`, `certificates` (+templates, CEU fields), community polls/RSVPs/reports/notifications, coach availability + credits, member email preferences | ✅ written, applies clean |
| `services/drip.ts` + `.test.ts` | Timezone-correct unlock times, module-gates-lesson, DST boundaries | ✅ 24 tests |
| `routes/member/{library,player,progress,downloads,certificates,community,coaching}.ts` | | ⏳ |
| `frontend/src/pages/member/{Library,CoursePlayer,Community,Coaching}.tsx` | | ⏳ |

### Phase 4 — Unified contacts, tags & segments
`db/migrations/005_phase4_contacts.sql` — `contacts` keyed on email, merging `leads`/`subscribers`/`members` by email while preserving every FK; `tags`, `contact_tags`, `segments`, `contact_activity`. `/admin/contacts` replaces three list pages, with redirects from the old routes. ⏳ **Depends on a job runner** (Phase 10.5) for activity rollups.

### Phase 5 — Email sequences & automations
Replace SMTP with a provider that reports engagement (§ blocker: opens/clicks are structurally 0 on plain SMTP). `email_sequences`, `sequence_emails`, `sequence_subscriptions`; broadcasts with segment audiences and A/B subjects; the When→If→Then engine extending `automations/engine.ts` from 6 triggers to the brief's 12. ⏳ **Depends on the job runner.**

### Phase 6 — Forms, assessments & events
Field-builder over the existing `forms.fields` JSONB; `assessments`, `assessment_questions`, `assessment_attempts` with scored branching to N result pages; `events` with live/evergreen/replay types and attendance splits. ⏳

### Phase 7 — Pages, funnels, SEO & migration off Kajabi

| File | Action | Status |
|---|---|---|
| `db/migrations/004_phase7_redirects_and_seo.sql` | `redirects` (94 seeded from Appendix B, 55 flagged `target_exists = false`), `not_found_log` | ✅ |
| `routes/public/seo.ts` | Generated `/sitemap.xml` (static routes + posts + courses + pages + podcasts + 21 tag archives), environment-aware `/robots.txt` | ✅ |
| `nginx/site.conf`, `nginx/redirects.map`, `scripts/generate-nginx-redirects.js` | Edge 301s from a generated map — verified `nginx -t` clean and confirmed empirically that nginx map keys match case-insensitively, so Kajabi's mixed-case URLs hit the lowercase keys | ✅ |
| `services/redirects.ts` + `.test.ts` | Path normalisation + runtime fallback + 404 capture | ✅ 10 tests |
| **SSR or prerendering for every public route** | Non-negotiable per the brief; nothing is indexable without it | ⛔ **not started — the largest remaining cutover blocker** |
| Per-page meta, canonical, OG/Twitter, JSON-LD | | ⏳ |
| Section-based page builder replacing the raw-JSON editor; funnels; A/B tests; nav + theme editors | | ⏳ |
| Content migration: 111 landing pages, quiz result pages, legal pages, podcast + 9 episodes | | ⏳ — this is what clears the 55 `target_exists = false` rows |

### Phase 8 — Affiliates
`affiliates`, `affiliate_links`, `affiliate_clicks`, `affiliate_commissions`, `affiliate_payouts`; cookie attribution with a configurable window, recurring commissions, refund clawback. ⏳ **Depends on the job runner** for commission accrual.

### Phase 9 — Analytics & reporting parity
A reports framework (shared date range, comparison period, CSV export, saved views) over `transactions`/`orders`/`subscriptions`/`payment_plans`/`contacts`, then the 35 named reports. Most are queries over tables that now exist; the email reports are blocked on Phase 5's provider swap. ⏳

### Phase 10 — Settings, roles, integrations & hardening
Real settings screens replacing the JSON blob; admin roles + MFA + audit log (the table already exists); outbound webhooks with signed payloads; **a background job queue with retries and a dead-letter view** — which Phases 4, 5, 8 and 9 all depend on, so it should be pulled forward. ⏳

### Critical path

```
Phase 0.5 (test Stripe keys, git init, deploy migration runner)
   └─> Phase 1 ──> Phase 2 ──> Phase 3        the member product
   └─> Phase 10.5 job runner ──> Phases 4, 5, 8, 9
   └─> Phase 7 SSR + content migration ──┐
                                          ├──> DNS CUTOVER
   Phases 1–3, 7, 10 all complete ───────┘
```

The brief's own rule: **do not cut over DNS until Phases 1–3, 7 and 10 are done.** Phase 7's SSR requirement is currently the single largest gap between here and that gate.
