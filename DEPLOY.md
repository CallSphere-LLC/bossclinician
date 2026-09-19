# Deploy — Boss Clinician

## Current production: direct K3s releases (2026-09-19)

Run `./scripts/deploy-k3s.sh` on this host after validation. It builds the local
working tree with a unique timestamp/commit release ID, imports immutable images
into K3s, rolls out API/static frontend/gateway together and the AI service,
checks readiness and the exact release through public HTTPS, then runs scoped
image retention. Every image carries `io.bossclinician.source-sha256`, hashing actual deployment
inputs including uncommitted/new files. A source manifest is saved under
`/var/lib/bossclinician/releases/<release>/source-manifest.json`; compare it with
`python3 scripts/release-source-manifest.py` after the final commit. The release
refuses to proceed if source changes while images build. Secrets and generated
outputs are excluded. It does not fetch or push Git. Push source only after live
verification; GitHub Actions now run validation only, including on main.

For a first migration or a release requiring inspection, use
`./scripts/deploy-k3s.sh stage`. Inspect service `boss-web-preview`, then call
`./scripts/k3s-cutover.sh <release>` to change the existing `boss-web` selector.
The stage command leaves ingress routing unchanged on the first migration.
Once the service already selects K3s pods, a normal deployment rolls out live.
`APP_RELEASE=<unique-id>` can select a release ID; never reuse one.

The deployment pins app pods to this host because uploaded data stays in the
existing Docker volumes. Public and protected uploads remain separate and use
`hostPath` with `type: Directory` (missing storage fails closed). Postgres stays
in its existing Compose container and volume; it is neither copied nor reset.
A tiny `db-bridge` container publishes Postgres only on the private CNI gateway
`10.42.0.1:15432`; its Docker DNS resolver follows the database after restarts.
The existing Boss Clinician TURN relay also stays running with its existing
ports and secret, independent of the neighboring telehealth relay.

Effective env files are read through Compose and sent directly to immutable,
release-specific Kubernetes Secrets; they are never written into manifests or
logs. Previous ReplicaSets retain their own configuration for rollback.

After confirming the K3s release, stop only the former application containers:
`docker compose stop nginx backend frontend ai`. Leave `db`, `coturn`, and
`db-bridge` running. Keep the stopped app containers for initial rollback.
`docker compose start ai backend frontend nginx` restores that fallback; then
restore the selectorless service and endpoint `10.42.0.1:8088` if required.
For subsequent K3s rollbacks use `kubectl -n bossclinician rollout undo deployment/boss-app`
and `rollout undo deployment/boss-ai`, wait for readiness, and recheck HTTPS.

Image cleanup is scoped to `bossclinician-k3-*`. It retains every image referenced
by cluster workloads (including rollback ReplicaSets) or Docker containers and
at least the three newest tags per component. `sudo python3 scripts/prune-k3s-images.py
--dry-run` shows candidates. Cleanup runs after successful releases and daily via
`bossclinician-image-prune.timer`; it never deletes data, volumes, other apps'
images, or shared build caches. Builds remain serialized by the shared host lock.
The old Compose deploy script is retained only as an explicit recovery tool.

## Historical Compose deployment reference

The following describes the prior deployment. Use the K3s procedure above for production.

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

**Normal path: push to `main`.** GitHub Actions tests the commit and deploys it,
rebuilding only what changed and rolling back if the live site fails its checks.
It also regenerates `nginx/redirects.map` and reloads nginx on every deploy. See
[docs/CI-CD.md](docs/CI-CD.md). Do not edit this checkout on the server: the
pipeline refuses to deploy over a hand edit.

Everything below is the **break-glass** path, for when the pipeline itself is
unavailable, and a reference for what the pipeline does.

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

## TURN relay for the community live room

**There are two coturn instances on this box and they must stay separate.**

| | Telehealth | Boss Clinician |
|---|---|---|
| Managed by | k3s (`callsphere-health` ns, `deployment/coturn`) | this repo's `docker-compose.yml` |
| Port | 3478 (UDP+TCP) | **3479** (UDP+TCP) |
| Relay range | 49160-49200 | **49210-49409** |
| Realm | `health.callsphere.ai` | `bossclinician.callsphere.site` |
| Secret | k8s secret `ehr-ui-turn` | root `.env` |

They shared one relay and one `--static-auth-secret` until 2026-09-04. It
worked, and it was wrong on three counts, all of which the split fixes:

- The secret is a bearer key to a relay. This app's `.env` held the clinical
  app's secret, so a leak here was a leak there.
- Rotating it for one app silently broke the other.
- coturn's quotas are **per-server, not per-realm**. `--total-quota` was one
  shared pool, so a busy community room could refuse allocations to a
  telehealth consult — the wrong way round for which of the two may degrade.

### Rules

- `TURN_HOST`, `TURN_PORT` and `TURN_STATIC_AUTH_SECRET` live **only in the
  root `.env`**. `docker-compose.yml` feeds them both to coturn's flags and to
  the backend's `environment:` (which overrides `backend/.env`). Do not add a
  second copy to `backend/.env`: the API mints the credentials this relay
  validates, and a mismatch produces a room that gathers no relay candidates
  and fails *only* for users behind symmetric NAT — the hardest failure here
  to notice, because it looks fine to whoever is testing.
- Never point `TURN_*` at the telehealth relay again.
- `network_mode: host`, not published ports: a relay advertises its own
  address in ICE candidates and needs the whole `--min-port`/`--max-port`
  range reachable. Mapping 200 UDP ports through docker-proxy would cost a
  process per port and rewrite the addresses the relay reports.
- The relay range must not overlap 49160-49200, and one allocation consumes
  one relay port — so the range width and `--total-quota` are the same number
  (200) by intent.
- Nothing may bind `listening-port + 1` (coturn's RFC 5780 alternate port),
  which is how you collide with the neighbouring relay. `--alt-listening-port=0`
  does not prevent that — 0 means "default", i.e. `listening-port + 1`. What
  does is that RFC 5780 never starts: it is off unless `--rfc5780` is given
  (coturn 4.7+), and coturn refuses it whenever `--external-ip` is set. Never
  add `--rfc5780`.
- The coturn image is pinned to a full release (`4.18.0-r0-alpine`). A bump is
  a change to review, not a tag edit: 4.18 exits on flags 4.6 accepted
  (`--no-tlsv1_1`). Run the command on the new image before merging.
- The `--denied-peer-ip` list is what stops this being an open proxy into the
  host's private networks — including `10.42/16`, the k3s pod network, i.e.
  every telehealth service. Do not trim it.
- A deploy recreates the coturn container, which drops relayed media for any
  call in progress. Deploy the live room outside office hours if that matters.

### Verifying it after a deploy

```
# 1. listening on the right port, both transports
sudo ss -lunp | grep -c :3479 && sudo ss -ltnp | grep -c :3479

# 2. mint a credential the way the API does, and allocate for real.
#    Expect "Received relay addr: 192.99.63.81:<49210-49409>".
#    A 403 *after* that line is correct — coturn refuses to relay to its own
#    address, and every other local address is denied. Since coturn 4.10 it
#    prints as "error 403 ()": the reason phrase is no longer sent.
SECRET=$(grep '^TURN_STATIC_AUTH_SECRET=' .env | cut -d= -f2)
read -r U C <<<"$(python3 -c "
import hmac,hashlib,base64,time
u=f'{int(time.time())+7200}:42'
print(u, base64.b64encode(hmac.new('$SECRET'.encode(),u.encode(),hashlib.sha1).digest()).decode())
")"
docker compose exec -T coturn turnutils_uclient -v -u "$U" -w "$C" \
  -p 3479 -e 192.99.63.81 -n 1 192.99.63.81 2>&1 | grep -iE "relay addr|error"

# 3. the separation itself: the telehealth secret must NOT allocate here.
#    Expect "Cannot complete Allocation".
```

The end-to-end proof is a browser: two participants in
`/community/<slug>/live`, at least one on a mobile network, and a
`relay`-type candidate in `chrome://webrtc-internals`.

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
