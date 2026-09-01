# Migration to server-64gbRam — COMPLETE (2026-09-01)

`bossclinician.callsphere.site` is now served by **192.99.63.81 (ns525614)**.
The old box (`srv1588736` / 2.24.200.155) is stopped but intact for rollback.

## What the new box is
24 cores, 62 GB RAM, 118 GB free of 467 GB. Live production for other domains:
k3s + Traefik on 80/443 serving callsphere.ai, callsphere.tech, admin/health/demo.callsphere.ai
(+13 hosts), with linkerd and cert-manager. **None of that was touched. No k3s/k3d images moved.**

## What moved
- Repo → `/opt/bossclinician` (364 MB, 3,308 files; `node_modules`/`.venv`/`dist-dev` excluded and
  rebuilt there). Builds now run on 24 cores instead of the old 2.
- Postgres: `pg_dump --clean --if-exists` restored with **0 errors**, 132 tables.
- Volumes `uploads_data` (2 files) and `protected_uploads_data` (1 file) restored via tar.
- All `.env` files carried over unchanged.

## Two target-specific changes (the old values were k3d-specific and would 502 here)
1. `docker-compose.yml` nginx binding: `172.18.0.1:8088` → **`10.42.0.1:8088`**.
2. `k8s/ingress.yaml` Endpoints IP: same change, with the reason in a comment.

The old box ran k3d (k3s nodes were *containers* on a docker bridge, gateway 172.18.0.1). Here k3s
is a host service, so pods reach the host at the **cni0 gateway 10.42.0.1** — the pattern their own
host Postgres already uses. Both files must stay in sync; either alone is a silent 502.

Also installed `docker-compose-v2` (2.40.3) — the box had Docker 29.1.3 with no compose plugin.
Note it's `docker-compose-v2` on Ubuntu, not `docker-compose-plugin`.

## Verification (against the running system, not just "it started")
- **Row-count parity, all 132 tables**: every table matches the source exactly except `jobs`
  (source kept queueing after the 07:14 dump). Identical table sets, no missing tables.
- **Smoke test over public HTTPS: 17 pass, 1 fail.** The one failure — `92 dead jobs` — is
  **pre-existing**: the source has the same 92, all from Aug 17–18 with none since. The old box
  fails this identical check. Not a migration defect.
- SSR confirmed (98,639-byte homepage, no empty root shell), uploads served, `/admin` and
  `/courses` 200, sitemap/robots correct, member API 401s to anonymous, forged file token refused.
- Legacy redirect verified byte-identical to the old box over the real host.
- TLS: Let's Encrypt cert issued (`CN=bossclinician.callsphere.site`, valid to Nov 30).
  A pre-existing `CAA bossclinician` record already authorized letsencrypt.org.

### Two traps worth remembering
- Testing via `127.0.0.1` on the new box returns Traefik's 404 — Traefik is exposed by hostPort
  DNAT, which loopback bypasses. Test from off-box, or against `10.42.0.1:8088` directly.
- The first public smoke test *passed against the old box*: this box's resolver still had the old IP
  cached. Always check `curl -w '%{remote_ip}'` before believing a post-cutover test.
- Running the smoke test against `http://10.42.0.1:8088` produces one false failure: nginx rebuilds
  the redirect as absolute https and drops the non-standard port. Harmless.

## DNS
`A bossclinician` in the `callsphere.site` zone: `2.24.200.155` → `192.99.63.81` (TTL 300), via the
Hostinger API using `HOSTINGER_DNS_TOKEN`. API host is `developers.hostinger.com` (plural).
The zone holds 33 records for **several unrelated businesses**; the PUT used
`{"overwrite":true}` scoped to that one name+type, and a before/after diff confirmed
**1 record changed, 32 byte-identical**. Snapshots are in the session scratchpad.

## The one real risk found, and why it's now closed
Both boxes were briefly running the job worker against **independent copies of the same database**.
`promoteSchedules()` dedupes with a unique index *within one DB*, so that gives no protection
across two — and 16 schedules are enabled, including `coaching.reminders`, `events.reminders`,
`sequence.tick`, `broadcast.tick`, `community.digest`, `webhooks.retry`, and affiliate
accrual/clawback (money). Two boxes = duplicate emails, duplicate outbound webhooks, double accrual.

Closed by stopping the old stack. Confirmed harmless in the ~5-minute overlap: the old box ran only
3 sweep ticks, and every outbound table on the new box is identical to the source snapshot
(`email_sends` 0, `email_messages` 0, `email_events` 8, `sequence_subscriptions` 0) — nothing sent.

**Do not restart the old stack while the new one runs.** Roll back by stopping the new stack first,
then `docker compose up -d` on the old box and reverting the A record.

## Still open (deliberately not done)
- **`bossclinician.com` — OUT OF SCOPE** (user's call, 2026-09-01). Not part of this move.
  If it is ever revisited, note what was found: the domain's DNS is at **Namecheap**
  (`pdns1/pdns2.registrar-servers.com`), not Hostinger — the Hostinger token returns an empty zone
  for it, so the DNS token in `.env.deploy` cannot touch it. The domain currently serves a **live
  Kajabi site** (`ssl.kajabi.com` / `endpoint.mykajabi.com`), so a cutover is a content/member
  migration off Kajabi, not a DNS flip.
  Groundwork that is already done and needs no rework: `k8s/ingress-bossclinician-com.yaml` reuses
  the same `boss-web` Service (so it inherits the corrected `10.42.0.1` Endpoints — no IP fix
  needed) and it passes `kubectl apply --dry-run=server` cleanly. Deliberately **not applied**:
  with DNS still pointing at Kajabi, cert-manager's HTTP-01 would fail in a loop and burn
  Let's Encrypt rate limits. Whenever it happens it would also need `FRONTEND_ORIGIN` and
  `PUBLIC_SITE_URL` changed together, a frontend rebuild (the API's server-rendered HTML names the
  bundle hashes), and the Stripe webhook endpoint moved — currently
  `https://bossclinician.callsphere.site/api/stripe/webhook` (enabled, 3 events).
- **Stripe stays LIVE mode.** No test charge was made and none should be.
- **Decommission the old box** only after you're satisfied — its volumes are the rollback.
- Repo changes (`k8s/ingress.yaml`, this file) are uncommitted.
