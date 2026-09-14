# Admin origin isolation follow-up

Implemented; root performs the combined deployment and final live verification.

## Reproduction

With a valid HttpOnly administrator cookie, plain JavaScript fetches from public `/account` returned contacts200/settings200 even though localStorage was null. Evidence `/tmp/boss-admin-origin/reproduction.json`. Cookie Path restricts request destinations, not the page initiating requests; it cannot isolate a shared origin.

## Actual boundary

- Dedicated origin: `https://admin.bossclinician.callsphere.site/admin`. DNS/TLS agent provisioned the A record and valid certificate using `k8s/admin-ingress.yaml`.
- Public nginx virtual host unconditionally returns401 for `/api/admin` and `/api/admin/*`, including requests carrying current/legacy cookies or bearer credentials. Public `/admin/*` navigations redirect to the dedicated origin.
- Backend independently requires the actual Host to match configured ADMIN_ORIGIN before CORS, login, refresh, or any admin route. X-Forwarded-Host cannot override that check. Existing authorization gates are unchanged.
- Admin nginx virtual host serves only the admin SPA, trusted bundled assets, and admin API. Public/member paths, quizzes/forms, and uploaded files redirect to the public host. React navigation has the same two-way origin boundary before mounting auth or page content.
- Admin cookies now use `__Host-bc_admin_session` and `__Host-bc_admin_refresh`: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain. The browser's __Host prefix also prevents a parent domain from injecting a Domain-scoped admin cookie. Five-minute access/eight-hour absolute refresh remain. Migration058 revokes previous shared-origin sessions; old names are ignored.
- Admin CORS and write CSRF accept only the exact admin origin. Public FRONTEND_ORIGIN stays unchanged. Production ADMIN_ORIGIN defaults to the new hostname; no environment secret edits are necessary.
- Public links, media URLs, podcast feeds, copied event links and administrator invitation links point to the appropriate origin. Members→View as member now transfers only its member preview credential through an exact-origin, exact-opener postMessage handshake. No administrator credential crosses origins.

## Validation before deployment

- Two isolated auth integration suites: six tests PASS. They cover valid and legacy cookie refusal on the public host, spoofed forwarded host, admin reads/refresh, exact CORS/CSRF, cookie flags and original refresh/logout/member401 cases. `/tmp/boss-admin-origin/integration.log`.
- Full frontend suite:187 tests PASS. Both typechecks PASS. nginx configuration test PASS; diff check PASS.
- DNS/TLS live evidence is owned by the DNS agent. Application-origin behavior requires root's new deployment; it is not yet claimed verified here.

## Root deployment and acceptance

1. Build/roll out backend and frontend together, then `docker compose exec -T nginx nginx -t` and `docker compose exec -T nginx nginx -s reload`. The deployment script alone does not reload nginx. Migration058 requires a fresh login at the admin origin. Keep FRONTEND_ORIGIN on the public host.
2. Log in through the actual admin UI with the ZZ owner; inspect __Host cookie flags. In that same browser context open public `/account`, `/library`, `/community/...` and `/`; ordinary `fetch('/api/admin/contacts')` and settings/offers must return401. Repeat with deliberately supplied legacy cookies. API reads and edits from the admin host must still work.
3. Public→admin cross-origin credentials fetch must not grant readable CORS access. Cross-origin writes must be403. Reload, second tab, natural access expiry/refresh and logout must retain their verified behavior on the new origin. localStorage remains null everywhere.
4. Visit admin/member routes through both hard navigation and SPA links; public content must never render under the admin hostname. Verify images, media previews, CSV/PDF exports, invitation URL, and Members→View as member popup handshake.
5. Remove the reproduction session with userAgent `codex ZZ admin-origin reproduce`, backend `/tmp/zz-admin-origin-session.json`, and host `/tmp/boss-admin-origin/session.json` after final verification. Never include credentials in the report.

## Additional assigned nginx defect

Root reproduced `/work-with-me` redirecting to itself indefinitely. Removed that exact identity row from `nginx/redirects.map`; the generator now skips identity redirects so regeneration cannot restore the loop. Valid aliases remain. Verify the route after nginx reload.
