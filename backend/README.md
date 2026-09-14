# Boss Clinician — Backend

Node 24 + Express + TypeScript (strict) + PostgreSQL REST API and admin CMS backing
the Boss Clinician site (Yvette Howard, LCSW). Implements the full contract in
`../ARCHITECTURE.md`.

## Stack

- Express + TypeScript (strict mode, zero `tsc` errors)
- PostgreSQL via `pg` — no ORM; `src/db/schema.sql` is applied (idempotent
  `CREATE TABLE IF NOT EXISTS`) on every boot, then the database is seeded once.
- `zod` request validation, `bcrypt` + `jsonwebtoken` (HS256, 7d) auth,
  `multer` uploads, `nodemailer` email (console/JSON transport if SMTP unset).

## Getting started

```bash
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, ADMIN_EMAIL/PASSWORD, ...
npm install
npm run dev             # tsx watch — applies schema + seeds on boot, listens on :4000
```

Other scripts:

```bash
npm run build      # tsc -> dist/ (also copies schema.sql + seed data into dist/)
npm start          # node dist/server.js (run build first)
npm run seed       # runs the seed script standalone (also invoked automatically on boot)
npm run typecheck  # tsc --noEmit
```

## Environment variables (`.env.example`)

| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | HS256 signing secret for admin JWTs (7-day expiry) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin user. If `ADMIN_PASSWORD` is unset, a random one-time password is generated and printed to the server log on first boot. |
| `AI_BASE_URL` | Base URL of the FastAPI AI microservice (`/chat`, `/generate/blog`) |
| `FRONTEND_ORIGIN` | CORS origin allowed for the public site/admin UI (`*` in dev) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | If unset, mail is logged to the console via a JSON transport instead of sent — the app never crashes for missing SMTP config |
| `NOTIFY_EMAIL` | Where new-lead notifications are sent |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | Local media upload storage, served at `/uploads/*` |

## Database

Schema lives in `src/db/schema.sql` (applied via `src/db/migrate.ts` on every
boot — safe to re-run). Seeding (`src/seed/seed.ts`) runs once, gated by a
`settings.seed_completed` flag, and is driven by `src/seed/data/content.json`
— a bundled copy of the monorepo's `shared/content.json` scrape (so seeding
works even if this directory is built standalone). If `shared/content.json`
is reachable at runtime (monorepo checkout, or `SHARED_CONTENT_PATH` env var),
it's preferred over the bundled copy.

Extraction logic (`src/seed/extract.ts`) derives:

- **blog_posts** — 8 posts from `blog_*` scrape entries. Slugs come from the
  real `/blog/<slug>` URL (not the truncated JSON key). Body markdown is
  rendered from the post's heading/paragraph/list text nodes, with the shared
  nav and footer boilerplate stripped out. Cover image is the post's second
  scraped image (position 1) — the header/footer logos always occupy 0 and 2.
- **testimonials** — the 3 quote/name pairs on the home page (Kristan L LCSW,
  Sharon S LPC, Deanna H LCSW), matched to the testimonial photos referenced
  in `shared/brand.md`.
- **courses** — 14 training-library cards from `all-courses.json` (parsed by
  ALL-CAPS `h2` title → subtitle/description `p`s → CTA `a`) plus the 3
  consulting packages from `store.json` (`$X,XXX.XX USD` price parsing).
  Card images are matched to titles by keyword overlap (with generic words
  like "private practice therapist" excluded so it doesn't just match
  everything); any card left unmatched falls back to the next unused image
  so every card gets one.
- **resources** — the free masterclass + 3 lead-magnet cards from
  `resources.json`.
- **pages** — best-effort `sections` JSON for `home`, `about`, `work-with-me`
  (hero title/subtitle/body/CTA, plus `home`'s PROVEN/PERSONAL/PREMIUM
  pillars and Freedom/Stability/Flexibility value props). This seeds the CMS
  editing surface; the frontend also ships its own static copy as a fallback.
- **settings** — `nav`, `footer` (legal links), and `contact` (email +
  Instagram handle) rows.
- **admin_users** — one row from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (bcrypt, cost 12).

A handful of scraped source pages have known-thin content (e.g. one blog post
has no body paragraphs in the scrape at all) — those fall back to the page's
`description` so nothing renders blank.

## API surface

All implemented per `../ARCHITECTURE.md`, JSON camelCase, mounted under `/api`:

**Public:** `GET /health`, `GET /pages/:slug`, `GET /blog` (tag/page/limit),
`GET /blog/:slug`, `GET /courses`, `GET /testimonials`, `GET /resources`,
`GET /settings`, `POST /leads`, `POST /subscribe`, `POST /chat` (proxies to
`AI_BASE_URL/chat`, degrades to a friendly canned reply if the AI service is
unreachable/slow — never throws).

**Admin** (`/api/admin/*`, JWT bearer via `POST /admin/login`):
`GET /me`, `GET /stats`, full CRUD on `blog`, `courses`, `testimonials`,
`resources` (`GET/POST/PUT/DELETE`, `GET /:id`), `GET/PUT /pages/:slug`,
`GET /leads` + `PUT /leads/:id` (status), `GET /subscribers`,
`GET/PUT /settings`, `POST /ai/generate-blog` (proxies to
`AI_BASE_URL/generate/blog`; returns 503 with a clear message if the AI
service is down/errors — never crashes the request), `POST /media`
(multipart `file` field → saved under `uploads/`, served at
`/uploads/<name>`, returns `{url}`).

Every `/api/admin/*` route except `/login` requires `Authorization: Bearer <token>`.

## Docker

`Dockerfile` is self-contained with `backend/` as the build context (two-stage:
`npm install && npm run build`, then a slim runtime image with
`npm install --omit=dev`). Seed data ships inside the image via the bundled
`src/seed/data/content.json` copy, so no sibling `shared/` directory needs to
be in the build context.

```bash
docker build -t bossclinician-backend .
docker run --env-file .env -p 4000:4000 bossclinician-backend
```

## Verified

- `npm install` — clean, 0 vulnerabilities (`bcrypt`/`nodemailer` pinned to
  current majors after the defaults pulled in vulnerable transitive deps).
- `npm run build` / `npm run typecheck` — zero TypeScript errors.
- Smoke-tested end-to-end against a disposable Postgres container: schema
  apply, seed (8 blog posts / 3 testimonials / 17 courses / 4 resources / 3
  pages / 1 admin user), every public and admin endpoint (including auth
  rejection, CRUD, pages upsert, settings upsert, media upload with
  type/size validation, and the AI-down fallback paths for `/chat` and
  `/admin/ai/generate-blog`).
