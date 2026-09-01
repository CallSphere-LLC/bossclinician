# Deploy — bossclinician.callsphere.site

## Server topology (discovered 2026-07-26)
- Ports 80/443 are owned by **k3d/k3s** (`k3d-bt-serverlb`, Traefik ingress) — serves brightertomorrowtherapy.com. Single public entrypoint; routes by Host header.
- Host Postgres `postgres_db` (pgvector) on 127.0.0.1:5432 belongs to the healthcare app — **do NOT reuse**. Boss Clinician runs its own Postgres in compose.
- Docker + Compose v5 available.

## Plan: isolated compose stack + k3s ingress route
1. Run this repo's `docker-compose.yml` → nginx published on **`10.42.0.1:8088`** (isolated; own DB volume). Non-HIPAA, so local Postgres is fine (no PHI — B2B coaching only).

   Not `127.0.0.1`. k3s on this box runs as a host service, so a pod reaches the host at the **cni0 gateway, `10.42.0.1`** — the same address the cluster's own host-Postgres route already uses. Loopback is not an address a pod can reach, and pointing the binding there makes every Traefik route to this stack a 502. `k8s/ingress.yaml` hard-codes the same address in its `Endpoints`, so **the two must move together — either one alone is a silent 502.** Verify with `ip -4 addr show cni0` before changing either.

   On the previous 8GB box this was `172.18.0.1`, because k3s ran under k3d and its nodes were *containers* on a docker bridge. If you ever see this stack 502 after a host move, this pair of values is the first thing to check.
2. In the k3s cluster, add for host `bossclinician.callsphere.site`:
   - a headless `Service` + `Endpoints` (or `ExternalName`) pointing at the host bridge IP `:8088`, and
   - an `Ingress` (Traefik) with TLS for that host (reuse cluster cert-manager / Let's Encrypt).
3. DNS: `A` record `bossclinician.callsphere.site` → server public IP. Provider for `callsphere.site` = TBD (ask user).

## Storage
Two volumes, and they are not interchangeable:
- `uploads_data` → `/app/uploads` (`UPLOAD_DIR`). Served at `/uploads` to anyone: blog covers, testimonial photos, member avatars.
- `protected_uploads_data` → `/app/uploads-protected` (`PROTECTED_UPLOAD_DIR`). Course video, lesson attachments, download-product files, coaching session files, certificate PDFs. Nothing serves this directory; the app hands out signed, expiring, member-bound links instead.

Back both up. The second holds every course video, and nothing in a database dump can rebuild it. Note that `backups/` currently holds only hand-made `pg_dump` snapshots — **nothing backs up either upload volume**, and `docker compose down -v` would destroy both. `PROTECTED_UPLOAD_DIR` must not point inside `UPLOAD_DIR` — the backend refuses to start if it does.

## Secrets needed from user (put in gitignored .env files, never commit)
- `OPENAI_API_KEY` → `ai/.env` (separate business; ideally its own key).
- `SMTP_*` + `NOTIFY_EMAIL` → `backend/.env` (optional; logs until provided).
- Generate strong `JWT_SECRET`, `DB_PASSWORD`, `ADMIN_PASSWORD` at deploy time.

## Building on this box (8GB, 2 cores, shared with k3s)
The images are built on the server that serves the site, and the Vite build of
the React app is the biggest memory spike in the system (~1.5–2GB). Two rules:

- The app is built **once**. `backend/Dockerfile` has a `frontend` stage that
  both runtime stages copy from — `api` (the Express image, which also carries
  the SSR bundle and the document shell) and `web` (nginx with the browser
  bundle). The compose `frontend` service targets that same Dockerfile, so
  BuildKit runs the build once instead of racing two copies of it.
- Build serially: `COMPOSE_PARALLEL_LIMIT=1 docker compose build`. Compose
  builds services in parallel by default, and a Node build racing the Python
  image on a box with ~4.7GB free invites the kernel OOM killer, which picks by
  score — usually Postgres or a k3s pod, not the build.

Migrations and the first-boot seed run inside the API process at startup
(`src/server.ts` → `applySchema()`), before it listens. Nothing else applies
them, and only one backend replica runs, so there is no separate migration
step and no concurrent-migration hazard. The backend's healthcheck is what
tells you that work finished — `docker compose up -d --wait`.

## Deploying a change (read this before typing a command)

- **Code or image change:** `./scripts/deploy.sh`. It builds serially, waits
  for every changed service to become healthy, then removes only superseded
  images and excess build cache. To deploy a subset, pass service names, for
  example `./scripts/deploy.sh backend frontend`.
- **A migration that adds redirects:** the above is *not enough*. Migrations write
  the `redirects` table, but nginx serves 301s from the generated
  `nginx/redirects.map`, which nothing regenerates on deploy. The rows go live in
  the database and the URLs still 200 to the SPA until you rebuild the map:

  ```
  docker compose exec -T backend node scripts/generate-nginx-redirects.js /tmp/redirects.map
  docker compose cp backend:/tmp/redirects.map ./nginx/redirects.map
  docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
  ```

  Run the generator *inside* the backend container: Postgres is not published to
  the host, so running it from the host authenticates as the wrong user and fails.
  Verify with `curl -sI <host>/<a-new-from_path>` and expect a 301, not a 200.
- **`docker-compose.yml` change:** `docker compose up -d` — and only that.
  `docker compose restart <svc>` restarts the *existing* container from the
  *existing* definition and applies nothing; it exits 0 and looks like a deploy.
- **nginx config change (`nginx/site.conf`, `nginx/redirects.map`):**

  ```
  docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
  ```

  This works because `./nginx` is mounted as a **directory**. It did not always:
  the two files used to be mounted individually, and a single-file bind mount
  pins the inode, so every write-by-rename (any editor, `sed -i`, and
  `generate-nginx-redirects.js` itself) left the container reading the old file
  indefinitely — reload and restart both silently re-read the stale copy. If you
  ever see a config change not take effect, check it inside the container before
  believing anything else:

  ```
  docker compose exec nginx sha256sum /etc/nginx/conf.d/site.conf
  sha256sum nginx/site.conf
  ```

  Never validate a config by mounting the host file into a throwaway container
  and calling that proof the running container has it — those are two different
  questions.

## Go-live checklist
- [ ] `.env` files populated (OpenAI key, DB pw, JWT secret, admin creds).
      Root `./.env` also needs `DB_PASSWORD` and `VITE_STRIPE_PUBLISHABLE_KEY`
      — compose reads it at **build** time, and a bundle built without the
      publishable key cannot open a payment form.
- [ ] `./scripts/deploy.sh`, verify `/api/health`, AI `/health`, frontend loads.
- [ ] Seed ran (blog/courses/testimonials/resources/admin user present).
- [ ] k3s ingress + DNS + TLS for the subdomain.
- [ ] `./scripts/smoke-test.sh https://bossclinician.callsphere.site` passes.
- [ ] Smoke test by hand: home renders, chat widget replies, admin login + CRUD, lead form writes to DB.
