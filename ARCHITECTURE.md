# Boss Clinician — Custom Build Architecture

Migration of https://www.bossclinician.com (Kajabi) to a custom stack.
Business: **Yvette Howard, LCSW** — coaching for therapists building independent private practices (the B.O.S.S Blueprint).

Target: **https://bossclinician.callsphere.site** (deployed on this server via Docker Compose + nginx).

## Services & ports
| Service   | Stack                                   | Dev port | Role |
|-----------|-----------------------------------------|----------|------|
| frontend  | React + Vite + TS + Tailwind + Framer   | 5173     | Public marketing site + `/admin` CMS UI |
| backend   | Node + Express + TS + Postgres (pg)     | 4000     | REST API, admin auth (JWT), CMS, leads, email |
| ai        | Python + FastAPI + OpenAI               | 8000     | Coaching chatbot, blog/content generation |
| db        | Postgres 16                             | 5432     | Data store |
| nginx     | reverse proxy                           | 80/443   | `/`→frontend, `/api`→backend, backend→ai internally |

nginx routing: `/` → frontend static build; `/api/*` → backend; backend proxies AI calls to `ai:8000` (browser never calls AI directly — key stays server-side).

## Repo layout
```
bossclinician/
  frontend/          # React app (public site + admin UI)
  backend/           # Express API + CMS + Postgres
  ai/                # FastAPI AI microservice
  shared/            # content.json (scraped seed), contracts
  _scrape/           # raw scrape (source material; not deployed)
  docker-compose.yml
  nginx/
```

## Design direction
**Total redesign — more dynamic & beautiful than the Kajabi original.** Keep Yvette's copy, photos, and brand feel; elevate everything. See `shared/brand.md`. Motion via Framer Motion (scroll reveals, parallax, animated gradients, hover states). Must be fully responsive and accessible.

## Data model (Postgres)
- `admin_users(id, email, password_hash, name, role, created_at)`
- `blog_posts(id, slug UNIQUE, title, excerpt, body_md, cover_image, tags text[], author, read_minutes, published bool, published_at, created_at, updated_at)`
- `courses(id, slug UNIQUE, title, subtitle, description, price_text, image, url, features jsonb, sort int, published bool)`
- `testimonials(id, name, credential, quote, image, sort int, published bool)`
- `resources(id, slug, title, description, image, cta_label, cta_url, kind, sort int, published bool)`
- `pages(slug PK, title, description, sections jsonb)`  # editable marketing copy (hero, blocks)
- `leads(id, name, email, phone, message, source, meta jsonb, status, created_at)`  # applications/contact
- `subscribers(id, email UNIQUE, source, created_at)`   # masterclass/newsletter
- `chat_sessions(id, started_at, meta jsonb)` / `chat_messages(id, session_id, role, content, created_at)`
- `settings(key PK, value jsonb)`  # nav, footer, contact info, feature flags

## REST API contract (backend, base `/api`) — JSON, camelCase
### Public (no auth)
- `GET  /api/health`
- `GET  /api/pages/:slug` → `{slug,title,description,sections}`
- `GET  /api/blog?tag=&page=&limit=` → `{items:[BlogCard], total, page, pageSize}`
- `GET  /api/blog/:slug` → `BlogPost`
- `GET  /api/courses` → `Course[]`
- `GET  /api/testimonials` → `Testimonial[]`
- `GET  /api/resources` → `Resource[]`
- `GET  /api/settings` → `{ nav, footer, contact, ... }`
- `POST /api/leads` `{name,email,phone?,message?,source}` → `{ok:true,id}`  (source: "apply"|"contact"|"work-with-me")
- `POST /api/subscribe` `{email,source}` → `{ok:true}`
- `POST /api/chat` `{sessionId?, message}` → `{sessionId, reply, suggestions?[]}`  (proxies to ai:/chat)

### Admin (JWT bearer; obtain via login)
- `POST /api/admin/login` `{email,password}` → `{token, user}`
- `GET  /api/admin/me` → `user`
- `GET  /api/admin/stats` → `{leads, subscribers, posts, chats, ...}`
- `GET/POST/PUT/DELETE /api/admin/blog[/:id]`
- `GET/POST/PUT/DELETE /api/admin/courses[/:id]`
- `GET/POST/PUT/DELETE /api/admin/testimonials[/:id]`
- `GET/POST/PUT/DELETE /api/admin/resources[/:id]`
- `GET/PUT /api/admin/pages/:slug`
- `GET /api/admin/leads` , `PUT /api/admin/leads/:id` (status)
- `GET /api/admin/subscribers`
- `GET/PUT /api/admin/settings`
- `POST /api/admin/ai/generate-blog` `{topic,tone?,keywords?[]}` → `{title,excerpt,bodyMd,tags}` (proxies to ai:/generate/blog)
- `POST /api/admin/media` (multipart upload, whole file in one request) → media asset
- `POST /api/admin/media/uploads` → open or resume a chunked upload → `{uploadId, offset, chunkSize}`
- `GET  /api/admin/media/uploads` → unfinished uploads for this administrator (any device)
- `GET  /api/admin/media/uploads/:id` → `{offset, sizeBytes, status}`
- `PUT  /api/admin/media/uploads/:id?offset=N` (raw `application/octet-stream` chunk) → `{offset, complete}`
- `POST /api/admin/media/uploads/:id/complete` → media asset (idempotent)
- `DELETE /api/admin/media/uploads/:id` → discard the half-file

### Resumable uploads
Course videos are hundreds of megabytes over connections that drop, and one
POST of the whole file has nowhere to keep the bytes when it does. `/uploads`
accumulates them in a `.part` file inside the destination volume and records the
acknowledged offset in `media_upload_sessions`, so an interrupted upload resumes
from that byte — after a dropped connection, a closed tab, a sign-out, or a
redeploy. `received_bytes` is the only authority on where to resume; the part
file is truncated back to it before each write, so an unacknowledged tail can
never end up spliced into the middle of the file. The browser half
(`frontend/src/lib/uploads/`) is a module singleton, so uploads keep running as
she moves between admin screens, and IndexedDB holds the `File` handle so a
reload comes back with a Resume button. Abandoned sessions and orphaned part
files are swept hourly (`media.sweepUploads`). Uploading a file whose name and
size the library already holds returns the existing asset instead of storing it
twice; the same name with different content is refused.

## AI service contract (FastAPI, internal — called by backend only)
- `GET  /health`
- `POST /chat` `{sessionId, message, history?[]}` → `{reply, suggestions[], leadSignal:bool}`  (RAG over site content in `ai/knowledge/`)
- `POST /generate/blog` `{topic, tone?, keywords?[]}` → `{title, excerpt, bodyMd, tags[]}`
- `POST /qualify-lead` `{text}` → `{score:int, summary}`

Env: `OPENAI_MODEL` (chat), `OPENAI_API_KEY`. Default model `gpt-5.5-2026-04-23` for text; keep configurable.

## Shared seed
`shared/content.json` — 23 scraped pages with `{slug,title,description,images[],texts[]}`. Images already copied to `frontend/public/images/`. Backend seeds blog/courses/testimonials/resources/pages from this; frontend uses it for static marketing copy + image paths.

## Conventions
- TypeScript everywhere in front/back. Strict mode.
- Frontend fetches collections from `/api`; falls back to bundled defaults if API down (so the site always renders).
- No secrets in git. `.env.example` in each service; real `.env` gitignored.
- Auth: bcrypt password hash, JWT (HS256), 7-day expiry. Admin routes require valid token.
