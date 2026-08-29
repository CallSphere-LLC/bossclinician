# Infrastructure / deploy review — 2026-08-18

Hostile review of the deploy surface only: `docker-compose.yml`, `.dockerignore`,
`backend/Dockerfile`, `frontend/Dockerfile`, `nginx/**`, `k8s/**`, `scripts/**`,
build config and `DEPLOY.md`. Static review — nothing was built, started or
applied. Line numbers are post-fix unless the file was deleted.

The box this deploys to: 8GB RAM, 2 cores, ~4.7GB available, `/` 80% full, and
it also runs a k3d/k3s cluster serving another business plus that cluster's
Postgres. Every memory and disk finding below is sized against that.

---

## THE CLIENT-IP QUESTION — confirmed, with one correction to the premise

**Verdict: `trust proxy 1` is correct and stays. `backend/src/app.ts` is unchanged.**
Two things have to be true for that to be safe, and both are confirmed below
with evidence from the running cluster.

### Correction first: the passthrough is my edit, not the pre-existing state

The finding that "nginx forwards `X-Forwarded-For` as received in all its proxy
blocks, so Traefik is the only writer" describes the file **after** the change I
made earlier in this session. (For the record: this file has **nine** proxying
blocks, not eleven — `grep -c proxy_pass nginx/site.conf` returns 9, and all
nine now set both `X-Real-IP` and the forwarded-as-received `X-Forwarded-For`.) Before it, every proxy block used
`$proxy_add_x_forwarded_for` — nginx appended its own peer, giving Express two
entries, and `trust proxy 1` therefore returned the *inner* proxy's address.

That is not a reading of history; it is what is deployed right now. The nginx
container currently running was started from the old config, and the API's own
log proves the consequence:

```
$ docker logs bossclinician-backend-1
172.19.0.1 - - [18/Aug/2026:20:18:16 +0000] "GET /api/admin/stats/overview HTTP/1.1" 200 ...
172.19.0.1 - - [18/Aug/2026:20:09:19 +0000] "GET /verify-email/HRK... HTTP/1.1" 200 ...
```

morgan's `remote-addr` token is `req.ip`. `172.19.0.1` is the
`bossclinician_default` bridge gateway — **the address nginx itself sees as its
peer**, and the one value that can only appear in `req.ip` if nginx appended it.
A passthrough config cannot produce it. So: in production today, every rate
limiter shares one bucket and every `consentIp` row is that constant. It stops
being true when this stack is redeployed with my change, not before.

The conclusion is the same either way — keep `trust proxy 1` — but it holds
*because of* the nginx change, not independently of it. If anyone reverts the
passthrough, 1 becomes wrong and 2 becomes right, and the spoofing trade-off
inverts with it.

### 1. Does Traefik strip client-supplied `X-Forwarded-For`? **Yes. Confirmed.**

k3s's bundled Traefik, running with default forwarded-header handling:

```
$ kubectl -n kube-system get deploy traefik -o jsonpath='{...args}'
--entrypoints.web.address=:8000/tcp
--entrypoints.websecure.address=:8443/tcp
--entrypoints.websecure.http.tls=true
--providers.kubernetescrd  --providers.kubernetesingress  --api.dashboard=true  ...

$ kubectl get helmchartconfig -A
No resources found
```

No `--entrypoints.*.forwardedheaders.trustedips`, no
`--entrypoints.*.forwardedheaders.insecure`, no `proxyprotocol.trustedips`, and
no `HelmChartConfig` anywhere overriding the chart's values. With an empty
trusted-IP list and `insecure` unset, Traefik **removes every incoming
`X-Forwarded-*` header** from an untrusted peer and writes its own from the
connection. A client cannot inject a forged entry: whatever it sends is deleted
before Traefik's own value is written, so exactly one entry reaches nginx and,
with the passthrough, exactly one reaches Express. `trust proxy 1` reads that
one. Nothing in `k8s/**` alters this — our two ingress files carry only
`cert-manager.io/cluster-issuer`, `router.entrypoints` and `router.tls`
annotations, none of which touch header handling.

**Caveat the limiter story must account for:** Traefik strips faithfully, but
the value it writes is not the visitor's address. Two hops upstream destroy it
first:

- `k3d-bt-serverlb` — the container that owns `0.0.0.0:80/443` — is a pure TCP
  proxy. Its generated config is `stream { server { listen 80; proxy_pass
  80_tcp; } }`, with no `proxy_protocol` and no transparent bind, so it opens a
  fresh connection from its own address (`172.18.0.3`).
- The Traefik Service is `type=LoadBalancer` with
  **`externalTrafficPolicy: Cluster`**, so kube-proxy SNATs again on the way to
  the pod. (`Local` is the setting that preserves a source address — and even
  that would not help here, because the TCP proxy above has already replaced it.)

So `req.ip` after my change is a fixed cluster-internal address rather than a
fixed bridge address: still a constant. Per-IP limiting is per-*site* — one
attacker on the login endpoint locks out every admin and member — and
`consentIp` records nothing legally useful. Recovering the real address needs
PROXY protocol enabled on the k3d loadbalancer *and* the Traefik entrypoints in
the same change (turn on one without the other and the entrypoint rejects every
connection). That is a change to a cluster shared with another business, so it
is flagged for the owner, not applied from this repo. Until then, limiters that
matter for abuse need a key the app owns as well as `req.ip`.

To stop this being unanswerable from the host, `nginx/site.conf` now logs the
forwarded chain (`log_format bc_fwd`, `fwd="$http_x_forwarded_for"`): after the
next deploy, one log line shows exactly what Traefik handed over.

### 2. Is nginx reachable directly from the internet? **No. Confirmed.**

Every TCP listener on the host:

```
0.0.0.0:22      sshd
0.0.0.0:80      k3d-bt-serverlb   <- the only public entry
0.0.0.0:443     k3d-bt-serverlb   <- the only public entry
0.0.0.0:38329   k3d API server
172.18.0.1:8088 this stack's nginx
172.18.0.1:8090 another app's nginx
127.0.0.1:*     local dev tooling, the other app's Postgres
```

- This stack's nginx is bound to `172.18.0.1` — an RFC1918 address on a docker
  bridge, not routable from the internet, and a socket bound to a specific
  address cannot accept packets addressed to the host's public IP (`2.24.200.155`).
- The backend, frontend, database and AI containers publish **nothing**: compose
  gives them `expose:` only, and `docker ps` shows bare container ports
  (`4000/tcp`, `80/tcp`, `5432/tcp`, `8000/tcp`) with no host binding. There is
  no second path to port 4000.
- The k8s `Service`/`Endpoints` that reaches `172.18.0.1:8088` is cluster-only.

So Traefik is the only way in from outside, and forged XFF is not live.
Residual, unchanged by my work: any container on this host can reach
`172.18.0.1:8088` directly and set its own `X-Forwarded-For`. That is bounded by
who can already run containers here (root on the box), it applied equally before
my change, and no nginx directive can fix it — `$remote_addr` at nginx is the
docker gateway for *every* caller, Traefik included, so `set_real_ip_from`
cannot tell them apart.

### 3. Do the compose and k8s chains differ? **There is only one chain.**

`k8s/**` contains no workload — a `Namespace`, a selectorless `Service`, a
manual `Endpoints` pointing at `172.18.0.1:8088`, and Ingress objects. It runs
no copy of this application; it only routes to the compose stack. So production
is exactly one path — Traefik → compose nginx → API — and one trust value
covers it.

The case where it differs is a bare compose run with no Traefik in front (local
or a rebuild on another host). Then nothing sets `X-Forwarded-For`, nginx
forwards nothing, and Express falls back to the socket peer — the nginx
container's address. `trust proxy 1` is harmless there (there is no header to
mis-trust), and the resulting `req.ip` is again a constant. Nothing about that
case argues for a different value.

---

## Defects found and fixed

### CRITICAL

**1. CSP blocks Stripe — no payment can be taken on the site.**
`nginx/site.conf:67`
`script-src` allowed only `'self'` and `cdn.lightwidget.com`, `connect-src` only
`'self'`, `frame-src` only `lightwidget.com`. The checkout and member billing
pages call `loadStripe()` (`frontend/src/components/checkout/stripeClient.ts:36`),
which injects `https://js.stripe.com/v3` and then opens the card fields as
cross-origin iframes on `js.stripe.com` / `hooks.stripe.com` and calls
`api.stripe.com`. Every one of those was blocked: the script never loads, the
`<Elements>` provider never resolves, and the visitor sits looking at a checkout
page with no card field and a console full of CSP violations. Nothing in the
smoke test or the type checker sees this — it only appears in a browser on the
real host.
*Fixed:* `js.stripe.com` added to `script-src`; `api.stripe.com` and
`m.stripe.network` to `connect-src`; `js.stripe.com`, `hooks.stripe.com`,
`m.stripe.network` to `frame-src`; `https://*.stripe.com` to `img-src`.
Everything else in the policy is untouched — `frame-ancestors 'none'` still
stands.

**2. The affiliate portal is unreachable in production.**
`nginx/site.conf:210,224` (the server-rendered-pages regexes)
The regex matches `^/(…|partners|…)(/[^/]*)?$`, so `/partners/dashboard` was
proxied to the API. The renderer registers `/partners` and no child route
(`backend/src/routes/public/render.ts`), so Express fell through to the 404
handler and answered JSON. `error_page` only catches 5xx, so nothing rescued it.
Every affiliate following their dashboard link got a raw `{"error":…}` page.
`/partners/dashboard` is a member SPA route (`frontend/src/App.tsx:246`).
*Fixed:* `location ^~ /partners/dashboard` → frontend container, added at
the regexes at `nginx/site.conf:210` and `:224`. Superseded in the second
pass below by a fix to the whole class rather than this one instance — the
`^~ /partners/dashboard` block that first fixed it has been removed, because the
narrowed regexes no longer capture that path at all.

**3. Two full Vite builds race each other on an 8GB box at deploy time.**
`frontend/Dockerfile` (deleted), `backend/Dockerfile:15`, `docker-compose.yml:98,160`
The same React app was built twice per deploy: once in `backend/Dockerfile`'s
`frontend` stage (for the SSR bundle and the document shell) and once in
`frontend/Dockerfile` (for the browser bundle). `docker compose build` builds
services in parallel, so both ran at once, each capped at a 1536MB heap and each
carrying rollup/esbuild native memory on top — against ~4.7GB free with k3s, the
other business's Postgres and this stack's database already resident. When the
kernel OOM killer fires it picks by score, not by who started it: the likely
casualty is Postgres or a k3s pod serving the *other* site, mid-deploy, with no
log line explaining why.
Same defect, second failure mode: two independent builds can produce two
different sets of content-hashed asset names. The API image bakes in
`dist/client/index.html`, which names the browser bundle by hash; if the
frontend image's build disagreed even slightly, every server-rendered marketing
page would reference JavaScript that 404s — a page that renders and then never
becomes interactive.
*Fixed:* `frontend/Dockerfile` deleted. `backend/Dockerfile` now ends with two
runtime stages over one build — `api` (line 42) and `web` (line 88, nginx +
`dist/client`) — and the compose `frontend` service builds the same context and
Dockerfile with `target: web`. BuildKit builds the shared `frontend` stage once.
`DEPLOY.md` documents `COMPOSE_PARALLEL_LIMIT=1 docker compose build` for the
remaining parallelism.

**4. The frontend image had no `.dockerignore`, so it shipped `frontend/.env`.**
`frontend/Dockerfile:8` (deleted)
`.dockerignore` is read from the build context root, and the context was
`./frontend`, which had no such file — so the root one never applied. `COPY . .`
therefore copied `frontend/.env` into an image layer, plus `frontend/node_modules`
(overwriting the ones `npm install` had just produced, one line earlier),
`frontend/dist` (144MB) and `frontend/dist-dev` (83MB). Secrets in a layer
survive every later `rm` in the Dockerfile and travel with the image.
*Fixed:* as part of defect 3 — the image now builds from the repository root,
where `.dockerignore` already excludes `**/.env`, `**/.env.*`, `node_modules`
and `**/dist`.

### HIGH

**5. Postgres runs upstream defaults inside a 768MB cap.**
`docker-compose.yml:32-46`
Default `max_connections=100` with `work_mem` per sort node lets Postgres's own
resident set exceed the container limit; the cgroup OOM killer then kills a
backend process, and Postgres responds to a killed child by terminating *every*
session and entering crash recovery — the whole site 500s until it finishes.
Separately, Docker gives a container 64MB of `/dev/shm`, which is where parallel
query workers pass tuples: past that they fail the query outright with `could
not resize shared memory segment`.
*Fixed:* `command: postgres -c max_connections=50 -c work_mem=4MB -c
maintenance_work_mem=64MB -c effective_cache_size=512MB` (the API pool asks for
at most 10 connections — `backend/src/db/pool.ts` uses pg's default max of 10),
and `shm_size: 256mb`, which is a tmpfs and costs nothing until used.

**6. Unrotated container logs on a disk that is 80% full.**
`docker-compose.yml:6-11`
The json-file driver does not rotate by default. `morgan("combined")` logs every
request, and `/` has 20GB left and is shared with k3s, two Postgres instances
and the other business's app. One crash-looping container or one bot walking the
125 legacy redirect paths fills it, and a full disk stops Postgres writing —
for every application on the box, not just this one.
*Fixed:* `x-logging` anchor (`max-size: 10m`, `max-file: 3`) applied to all five
services.

### MEDIUM

**7. Nothing compresses the server-rendered HTML or any API response.**
`nginx/site.conf:35` and the five lines after it
The frontend container gzips only the files it serves itself; the API has no
compression middleware (`compression` is not in `backend/package.json`); and the
front nginx had no `gzip` at all. So every server-rendered marketing page —
markup plus inlined JSON-LD and bootstrap data — and every admin list response
went out at full size over the wire. This is the SEO-critical path: those pages
exist to be crawled.
*Fixed:* `gzip on` with `gzip_proxied any` (the directive that makes it apply to
proxied responses at all), `gzip_vary`, a 1KB floor and a type list. `text/html`
is always compressed by nginx and must not be listed.

**8. Client IP.** See the section above. All nine proxying blocks in
`nginx/site.conf` now forward `X-Forwarded-For` as received instead of appending
this container's peer to it, which is what made `trust proxy 1` return the
docker bridge gateway for every visitor. The file also gained a `bc_fwd` access
log format carrying `fwd="$http_x_forwarded_for"` and `proto=`, so the forwarded
chain is readable from `docker logs` after the next deploy instead of requiring
instrumentation to answer.

**9. The document shell had no cache headers.**
`frontend/nginx.conf:27`
`index.html` was served with no `Cache-Control`, so browsers apply heuristic
freshness from `Last-Modified` and hold it. A returning visitor after a deploy
gets the previous shell, which names hashed asset files that no longer exist —
a blank page until they hard-reload. The assets themselves are already immutable
and hashed, so nothing is gained by caching the shell.
*Fixed:* `location = /index.html { add_header Cache-Control "no-store" always; }`.
`try_files`'s fallback is an internal redirect, so it re-enters that block.

**10. `docker compose up -d` returned before anything could answer.**
`docker-compose.yml:53,167,202-204`
The API applies migrations and the first-boot seed before it listens
(`backend/src/server.ts`), and nginx proxies the first request it receives. With
`depends_on` naming containers rather than conditions, the first visitor after a
deploy — and `scripts/smoke-test.sh` run straight after — could hit a 502 from a
perfectly healthy deploy.
*Fixed:* healthchecks on `backend` (`/api/health`, which touches no database, so
it means exactly "listening") and `frontend`, `start_period: 60s` to cover
migrations, and `depends_on: condition: service_healthy` on nginx.

### LOW

**11. 83MB of stale local build output in every build context.**
`.dockerignore:11,15`
`**/dist` does not match `frontend/dist-dev`, which exists on this host at 83MB
and rode into the context and into the frontend build stage. `*.tsbuildinfo` was
worse than size: copied in, it makes the image's `tsc -b` believe the typecheck
is already done and skip it, so a type error that fails the build on a laptop
passes inside the image.
*Fixed:* `**/dist-dev`, `**/*.tsbuildinfo` (the `**/` matters — a bare `*.x`
pattern matches only the context root), plus root-level `*.pdf`, `*.png`,
`.claude`.

**11b. `.dockerignore` was never committed.**
`.dockerignore` (repository root)
It existed on this host but was untracked, and nothing in `.gitignore` excludes
it — it had simply never been added. A build from a fresh clone would therefore
run with no ignore file at all: `node_modules`, the 90MB `_scrape` archive,
`backups/`, and `**/.env` — the live Stripe keys — all uploaded to the daemon
and copied into the image by `COPY backend/ ./`.
*Fixed:* staged with `git add` (not committed — commits are the operator's call).

**12. `DEPLOY.md` names the wrong bind address.**
`DEPLOY.md:9-11`
It said nginx is published on `127.0.0.1:8088`; compose binds `172.18.0.1:8088`
and `k8s/ingress.yaml:28` hard-codes the same address in its `Endpoints`. The
k3d nodes are containers on the `postgres_db_default` bridge (verified:
`k3d-bt-serverlb` is `172.18.0.3`, gateway `172.18.0.1`) — loopback on the host
is not an address they can reach, so "correcting" compose to match the document
turns every Traefik route to this stack into a 502.
*Fixed:* document corrected, with the reason and the command to re-verify.
`DEPLOY.md` also gained the build-memory rules, the migration/`--wait` note, the
root-`.env` build-time requirement and the smoke-test step.

**13. `backend/.env.example` omits everything commerce needs.**
`backend/.env.example`
No `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PROTECTED_UPLOAD_DIR`,
`SEO_ALLOW_INDEXING`, `SES_*` or `WORKER_ENABLED`, and `MAX_UPLOAD_MB=10` where
production runs 512. Someone provisioning a `.env` from it gets a stack that
boots, looks healthy, and answers 503 on every checkout — and if the webhook
secret is the one missing, cards are charged and orders never fulfilled.
*Fixed:* all of them added, empty, each with the failure it causes when unset.

---

## Second pass — defects found in my own first-pass fixes

A hostile verifier went back over the changes above. Two were real, both mine,
and both are the kind that only appear when you check the running system rather
than the file you edited.

**S1. BLOCKING — the config was never going to reach the container.**
`docker-compose.yml` (nginx `volumes`)
`./nginx/site.conf` was bind-mounted as a **single file**, which pins the inode.
Every tool that writes by rename — editors, `sed -i`, Python's `write_text`, and
`generate-nginx-redirects.js` itself — replaces the file rather than its
contents, and the container keeps the inode it was started with. Confirmed on
the live stack:

```
host      : inode 1025876  11240 bytes
container : inode 1017411   5399 bytes   grep -c proxy_add_x_forwarded_for -> 5
```

The running nginx still had the appending XFF config, the old CSP and the old
regex. `nginx -s reload` and `docker compose restart nginx` would both have
re-read the same stale file and exited 0 — a deploy that reports success and
changes nothing, so no payments, no affiliate portal, no IP fix. (`redirects.map`
still matched, inode 1017610 both sides: it had not been rewritten since the
container started, which is exactly how quiet this failure is.)
*Fixed:* the whole `./nginx` directory is mounted at `/etc/nginx/conf.d` instead,
so the container resolves the filename on each read. site.conf is picked up by
the base image's `include conf.d/*.conf`, and the directory mount also masks that
image's stock `default.conf`. `DEPLOY.md` now states which command applies which
kind of change, and how to check the container rather than trusting the host.

*And on my own validation:* mounting the host file into a throwaway container and
running `nginx -t` was never fooled — it read the new bytes — but it answered a
different question from "does the running container have this?". The revalidation
now mounts the directory exactly as compose does and prints the checksum from
inside the container next to the host's: `8701dabed64ce5f9` both sides, stock
default.conf absent, `nginx -t` successful with upstreams resolving.

**S2. HIGH — I fixed one instance of a class and called it done.**
`nginx/site.conf` (the server-rendered-pages regexes)
`/partners/dashboard` was not a special case. The old regex took one optional
segment under all seventeen names while the renderer registers a child route for
exactly two (`/courses/:slug`, `/blog/:slug`), so `/about/x`, `/store/x`,
`/terms/x`, `/resources/x`, `/apply/x`, `/contact/x`, `/retreats/x`,
`/resource-hub/x`, `/work-with-me/x`, `/practice-quiz/x`, the four legal pages
and `/partners/<anything>` all reached the API and returned its raw JSON 404
body — `proxy_intercept_errors` with `error_page 500 502 503 504` does not cover
404. Those URLs used to reach the SPA and render the branded 404 page, so the
sweep that added server rendering regressed them.
*Fixed by shape, not by instance:* two regexes now, one matching only the fifteen
childless pages and one matching `courses|blog` with at most one slug segment.
Everything else falls through to the SPA as before, `^~ /partners/dashboard` is
deleted as redundant, and the drift between the nginx list and `render.ts` now
fails *safe* — a new public route under those names loses its server-rendered
HTML instead of showing a visitor a JSON error.
I did **not** take the other option offered (intercepting 404 into `@spa` for the
HTML locations). A missing blog post is rendered by the API as a genuine 404
document; routing that to the SPA would answer 200 with a shell, which is the
soft-404 the whole server-rendering effort exists to prevent.

**S3. MEDIUM — the healthcheck could abort a disaster-recovery rebuild.**
`docker-compose.yml` (backend `healthcheck`)
`start_period: 60s` against a first boot that applies schema.sql, eighteen
migrations and the full seed before binding the port. Overrun it and
`depends_on: service_healthy` fails the whole stack with "dependency failed to
start" — on the rebuild-from-empty path, which is the one that matters most.
*Fixed:* `start_period: 300s`. Failures inside the period are not counted, so it
costs nothing on a normal boot.

**S4. MEDIUM — `shm_size` was not coherent with the memory cap.**
`docker-compose.yml` (db)
A tmpfs is charged to the same 768M cgroup as Postgres, so 256MB of it competes
with `shared_buffers` when actually used — the OOM killer this limit exists to
avoid.
*Fixed:* 128mb, with the arithmetic in the comment (128MB shared_buffers + up to
50 backends + touched shm, inside 768M) instead of the misleading "costs nothing"
claim.

**S5. LOW — crawler files had no degradation path.**
`nginx/site.conf` (`/sitemap.xml`, `/robots.txt`)
Both answered a bare 502 during an API restart while every other route fell back
gracefully.
*Fixed, but deliberately not to `@spa`:* these are the two paths where the SPA
fallback is the worse answer — an HTML document returned with 200 to a request
for a sitemap is a lie a crawler cannot detect, which is why they are exact-match
blocks in the first place. They now fall back to `@unavailable`, which returns
503 with `Retry-After: 120` — the documented "still here, come back" signal, and
unlike a 502 it does not read as a broken site.

**S6. LOW — `X-Real-IP` was set in only three of the nine proxying blocks**, so a
client-supplied value passed through verbatim everywhere else. Nothing reads it
today. *Fixed:* set from `$remote_addr` in all nine.

**S7. LOW — `connect-src` omitted `https://r.stripe.com`** (Stripe.js telemetry);
console errors only. *Fixed.*

**S8. Documentation accuracy.** This file said "all nine proxy blocks" in one
place but carried line numbers that had moved under later edits. *Fixed:* counts
re-derived (`grep -c proxy_pass` = 9) and every `nginx/site.conf:N` reference
regenerated from the current file. The claim of *eleven* blocks came from the
brief I was given, not from this document; `docs/bugs/backend-platform.md` is
another agent's file and I have left it alone.

**S9. The XFF comment overstated its own result.** It claimed the fix ended the
shared rate-limit bucket and the login lockout. It does not, and the comment now
says so.

> **Plainly, so it is not lost in the detail: per-IP rate limiting on this
> deployment is per-SITE, not per-visitor, and remains so after every change in
> this document.** `loginIpLimiter` is effectively global — one attacker
> exhausting it locks every admin and every member out of login — and every
> `consentIp` written to the database is a constant private address. The client's
> IP is destroyed upstream of anything this repo controls: `k3d-bt-serverlb` is a
> plain TCP proxy, and the Traefik Service runs `externalTrafficPolicy: Cluster`,
> so kube-proxy SNATs whatever survived. The nginx change is still correct and
> worth keeping — it makes `req.ip` the outermost value anyone in the chain
> knows, makes `trust proxy 1` right, and starts carrying the true address the
> moment the edge is fixed — but it buys no abuse protection today. That needs
> PROXY protocol enabled on the k3d loadbalancer and the Traefik entrypoints in
> the same change, on a cluster shared with another business.

---

## Cross-boundary — for whoever owns `backend/src`

1. **`backend/src/app.ts:21` — leave `trust proxy` at 1.** With the nginx
   passthrough, 1 is correct. But see S9: no proxy in this topology knows the
   visitor's IP, so every IP-keyed limiter is global and `consentIp` records a
   constant. Limiters that matter for abuse (login, chat, subscribe, checkout)
   need a second key the app owns until PROXY protocol is enabled end to end.
2. **`backend/src/routes/public/render.ts` ↔ `nginx/site.conf:210,224`.** These two
   lists must stay in step and there is nothing enforcing it. The SPA is free to
   add a route under any of those 17 prefixes and it will 404 from the API, as
   `/partners/dashboard` did. A test that asserts every `PUBLIC_ROUTES` entry
   either matches the nginx regex *and* is registered by the renderer, or matches
   neither, would close it permanently.
3. **No compression middleware in the API.** Now handled at nginx (defect 7), so
   this is informational: if the API is ever fronted differently, it ships
   uncompressed.
4. **`ai/.env` has an empty `OPENAI_API_KEY`.** Compose resolves it to an empty
   value, so the chat widget's replies will fail on this deploy. Operator action
   — I did not touch the file.
5. **Job queue is failing in production right now**, visible while reading logs
   for the IP question: `coaching.reminders #1155 DEAD after attempt 5: missing
   FROM-clause entry for table "m"`, with #1168 following it. Not an infra
   defect; handing it to whoever owns the jobs code.

---

## Looked hard, found nothing

- **`vite.config.ts:16` `__dirname`.** No failure. Vite 6.4.3 bundles the config
  with esbuild and *defines* `__dirname` (and `import.meta.dirname`) as an
  injected constant — `frontend/node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js:49462`
  — for both the ESM and CJS config paths. `tsc -p tsconfig.node.json --noEmit`
  is clean, and `frontend/dist` on disk is a successful build from this config.
  Left alone: changing it would be a style edit with no failure behind it.
- **SSR artefacts.** `frontend/package.json:8` builds both outputs;
  `backend/Dockerfile:57-58` ships `dist/server` and `dist/client/index.html` to
  exactly `SSR_DIST_DIR=/app/frontend-dist`, which is where
  `backend/src/ssr/renderer.ts:51,68,88` reads them. The SSR bundle is CJS with
  `noExternal: true`, so the API image genuinely needs no React. Markers
  `<!--bc-head-->` / `<!--bc-app-->` are present in `frontend/index.html`.
- **`backend/scripts/copy-assets.js`.** Copies `db/schema.sql`, `db/migrations/*.sql`
  and `seed/data/content.json`, which is exactly the set `migrate.ts` and
  `contentLoader.ts` read at runtime. It runs in the build stage before `dist` is
  copied out. Nothing else in `backend/src` reads a non-TS file at runtime — I
  grepped every `readFileSync`.
- **Image hygiene.** Final API stage prunes dev dependencies (`npm install
  --omit=dev` after `tsc` has already run in a separate stage), runs as `node`
  (uid 1000), creates both upload roots so the volume mounts inherit non-root
  ownership, sets a heap cap below the container limit, and takes no secret build
  args (the only two are `VITE_API_BASE` and the Stripe *publishable* key). No
  `.env` reaches either image.
- **Volumes.** All three are named, not bind mounts, so a rebuild cannot lose
  them; the public and paid upload roots are separate volumes at sibling paths,
  which is what keeps course video off the open web.
- **Webhooks.** `client_max_body_size 512m` is above the app's 1mb raw-body cap,
  nginx does not touch the body, and `express.raw` is mounted ahead of
  `express.json` for both Stripe and SES — signature verification is safe.
  `proxy_request_buffering off` is right for the 512MB video uploads.
- **`scripts/smoke-test.sh`.** Read-only; creates, charges and sends nothing. Its
  mixed-case redirect assertion is valid — nginx's `map` lowercases the subject
  before lookup, and every generated key is lowercase.
  `backend/scripts/generate-nginx-redirects.js` rejects absolute targets before
  writing, which is the failure the `https://$host$redirect_target` construction
  in site.conf would otherwise produce.
- **No destructive scripts anywhere.** No drop/reset/truncate script exists in
  `scripts/` or `backend/scripts/`. Also no *backup* script: `backups/` holds
  three hand-made `pg_dump` files and **nothing backs up either upload volume**,
  which is where every course video lives and which no database dump can rebuild.
  Recorded in `DEPLOY.md`; building a backup system was outside this pass.
- **k8s manifests.** Consistent with compose: the `Endpoints` address and port
  match the published binding, the Service port name matches, and both hosts'
  ingresses point at the same Service. They declare no pods, so there are no
  resource requests to get wrong and nothing to schedule on this node. The
  `.com` manifest is correctly marked do-not-apply until DNS moves.
- **Secrets in git.** Only `*.env.example` files are tracked; `.env`,
  `.env.deploy`, `ai/.env`, `backend/.env`, `frontend/.env` are all covered by
  `.gitignore` and by `.dockerignore`. I did not read or print any of their
  contents.
- **Resource limits.** Every service already had a memory limit and
  `restart: unless-stopped`, so an OOM-killed container comes back. The Node
  runtime heap (640MB) is correctly set below the container cap (1024MB). The job
  worker runs in-process with a batch of 5 IO-bound jobs — nothing here assumes
  more than two cores.
