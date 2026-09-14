# Boss Clinician — instructions for Copilot (chat, code review, cloud agent)

## What this is
A coaching business platform: public marketing site with server-side rendering,
member area, admin CMS, payments (Stripe), email (Amazon SES over SMTP), a
community live room (WebRTC + coturn) and an AI chat service.

- `backend/` — Express + TypeScript + Postgres. Also renders the marketing pages
  (SSR) using the frontend's server bundle.
- `frontend/` — React + Vite + Tailwind. One Vite build produces both the
  browser bundle and the SSR bundle (see `backend/Dockerfile`).
- `ai/` — FastAPI service; works without an OpenAI key via fallback paths.
- `nginx/`, `docker-compose.yml`, `k8s/` — production routing and runtime.
- `scripts/ci/`, `.github/workflows/` — CI/CD. Read `docs/CI-CD.md` first.

## How changes reach production
Push to `main` → CI (`.github/workflows/ci.yml`) → deploy on the production
host's runner (`deploy.yml` → `scripts/ci/deploy-release.sh`). Never suggest
editing files on the server or running deploy commands by hand; the pipeline
refuses to deploy over a hand-edited checkout.

## Checks to run before proposing a change
- Backend: `cd backend && npm ci && npm run typecheck && npm test`
- Backend DB tests: `TEST_DATABASE_URL=… npx vitest run integration.test`
- Frontend: `cd frontend && npm ci && npm run typecheck && npm test`
- AI: `cd ai && pip install -r requirements.txt && python -m pytest -q`
- Pipeline: `python3 -m unittest discover -s scripts/ci/tests`

## Rules that matter here
- Never commit secrets or `.env` files. Secrets live only in the server's
  gitignored `.env`, `backend/.env` and `ai/.env`.
- Migrations in `backend/src/db/migrations/` are forward-only and apply at API
  startup. Write them so the previous release still runs against them (add,
  don't rename or drop in the same release).
- A change under `frontend/` also changes the API image: the server-rendered
  HTML names the browser bundle by content hash.
- `nginx/redirects.map` is generated from the `redirects` table; don't edit it
  by hand.
- `k8s/` manifests are applied by hand, never by the pipeline.
- Access to paid content goes through signed, expiring links from
  `PROTECTED_UPLOAD_DIR`; nothing under it may become reachable from `/uploads`.

## In code review, look hardest at
- Authorization on `/api/member/*` and `/api/admin/*` routes, and the separate
  admin origin (`nginx/admin.conf`).
- SQL built from request input (use the allowlist helpers in `utils/sqlUpdate.ts`).
- Anything that could send real email or charge a card from a test or CI run.
- Changes to `scripts/ci/` without matching tests in `scripts/ci/tests/`.
