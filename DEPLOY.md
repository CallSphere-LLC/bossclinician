# Deploy — bossclinician.callsphere.site

## Server topology (discovered 2026-07-26)
- Ports 80/443 are owned by **k3d/k3s** (`k3d-bt-serverlb`, Traefik ingress) — serves brightertomorrowtherapy.com. Single public entrypoint; routes by Host header.
- Host Postgres `postgres_db` (pgvector) on 127.0.0.1:5432 belongs to the healthcare app — **do NOT reuse**. Boss Clinician runs its own Postgres in compose.
- Docker + Compose v5 available.

## Plan: isolated compose stack + k3s ingress route
1. Run this repo's `docker-compose.yml` → nginx published on host `127.0.0.1:8088` (isolated; own DB volume). Non-HIPAA, so local Postgres is fine (no PHI — B2B coaching only).
2. In the k3s cluster, add for host `bossclinician.callsphere.site`:
   - a headless `Service` + `Endpoints` (or `ExternalName`) pointing at the host bridge IP `:8088`, and
   - an `Ingress` (Traefik) with TLS for that host (reuse cluster cert-manager / Let's Encrypt).
3. DNS: `A` record `bossclinician.callsphere.site` → server public IP. Provider for `callsphere.site` = TBD (ask user).

## Storage
Two volumes, and they are not interchangeable:
- `uploads_data` → `/app/uploads` (`UPLOAD_DIR`). Served at `/uploads` to anyone: blog covers, testimonial photos, member avatars.
- `protected_uploads_data` → `/app/uploads-protected` (`PROTECTED_UPLOAD_DIR`). Course video, lesson attachments, download-product files, coaching session files, certificate PDFs. Nothing serves this directory; the app hands out signed, expiring, member-bound links instead.

Back both up. The second holds every course video, and nothing in a database dump can rebuild it. `PROTECTED_UPLOAD_DIR` must not point inside `UPLOAD_DIR` — the backend refuses to start if it does.

## Secrets needed from user (put in gitignored .env files, never commit)
- `OPENAI_API_KEY` → `ai/.env` (separate business; ideally its own key).
- `SMTP_*` + `NOTIFY_EMAIL` → `backend/.env` (optional; logs until provided).
- Generate strong `JWT_SECRET`, `DB_PASSWORD`, `ADMIN_PASSWORD` at deploy time.

## Go-live checklist
- [ ] `.env` files populated (OpenAI key, DB pw, JWT secret, admin creds).
- [ ] `docker compose build && docker compose up -d`, verify `/api/health`, AI `/health`, frontend loads.
- [ ] Seed ran (blog/courses/testimonials/resources/admin user present).
- [ ] k3s ingress + DNS + TLS for the subdomain.
- [ ] Smoke test: home renders, chat widget replies, admin login + CRUD, lead form writes to DB.
