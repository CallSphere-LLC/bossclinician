# Backend auth — hostile review

Scope: `backend/src/auth/**`, `backend/src/middleware/**`, `backend/src/routes/auth/**`,
`backend/src/routes/admin/adminUsers.ts`, `backend/src/routes/admin/auth.ts`,
`backend/src/services/{mfa,permissions,adminAudit,setPasswordLink}.ts`, `backend/src/utils/jwt.ts`.
Everything else was read but not edited.

Method: every route traced end to end through `app.ts` → `routes/admin/index.ts` /
`routes/auth/index.ts`, including middleware order, and each candidate written as a
concrete request → outcome before being kept. Findings that could not be substantiated
that way were dropped; the "looked hard, found nothing" section at the bottom lists them.

---

## Confirmed defects — fixed

### 1. HIGH — a stranger can lock any member out of sign-in, permanently

`backend/src/routes/auth/memberAuth.ts:86, 190-213 (pre-fix), 457-459 (pre-fix)`

`isLoginThrottled()` refused a sign-in **before the password was checked** when an
email had accumulated `LOGIN_DISTRIBUTED_MAX_FAILURES = 40` failures across *all*
source IPs in the last 15 minutes. Each IP is capped at 5 failures, so 8 cheap
proxies × 5 failed `POST /api/auth/login` bodies for `victim@example.com` reaches 40.

Exploit, unauthenticated, needs only the victim's email address:

```
for ip in 8 proxies:
  for i in 1..5:
    POST /api/auth/login {"email":"victim@example.com","password":"x"}   -> 401
# 40 rows in member_login_attempts, all successful = false
POST /api/auth/login {"email":"victim@example.com","password":"<the real one>"}
  -> 429 "Too many sign-in attempts."      <-- the real owner, correct password
```

Because the check ran before `verifyPassword`, **a correct password could not clear
it**, and `clearLoginFailures` is only reached on a success that can never happen.
Sustaining it costs ~40 requests per 15 minutes (≈2.7/min) forever. The one recovery
path — `forgot-password` → `reset-password`, which does call `clearLoginFailures` —
is itself capped at 5 emails per account per 15 minutes (`RESET_MAX_PER_WINDOW`), and
that ceiling is reachable by the same unauthenticated attacker from 2 IPs
(`memberEmailLinkLimiter` is 10/hour per ip+email). Combined, the victim is denied
both sign-in and recovery indefinitely. This is the same defect class the Phase 1
review closed for the per-IP counter, reintroduced at a higher threshold.

Fix (`memberAuth.ts:180-231, 484-510`): `isLoginThrottled` became
`loginThrottle(): "none" | "ip" | "account"`. The per-IP ceilings still refuse before
the password is looked at (unchanged). The account-wide ceiling no longer gates the
password check — the password is verified as normal, a correct one signs in and clears
the failure history, and only a *wrong* one is refused (429). The ceiling keeps its
whole purpose: a caller who does not know the password is still refused and still
counted; the person who does know it is no longer lockable by strangers.

### 2. MEDIUM — `/api/auth/register` burns a guest buyer's live set-password link

`backend/src/routes/auth/memberAuth.ts:235-272 (pre-fix)`

Every guest checkout, CSV import and admin-added member is a `members` row with
`password_hash IS NULL`. Posting that address to the unauthenticated `/register`
endpoint took the `!existing.password_hash` branch, which ran
`UPDATE member_password_resets SET used_at = now() WHERE member_id = $1 AND used_at IS NULL`
— invalidating the link the buyer is holding — then minted a new one and mailed it.

Exploit:

```
victim buys a course as a guest -> gets "Set your password" email at T
attacker: POST /api/auth/register {"email":"victim@x.com","password":"anything10","firstName":"a"}
  -> 200 {"status":"check_email"}    ; victim's T link is now dead
victim clicks the T link at T+60s -> "That link has expired or has already been used."
```

Repeating it every ~3 minutes (5 per 15-minute window per account) keeps the victim
chasing a link that dies before they can use it, mailbombs them from our own domain,
and — once the 5/15min ceiling is spent — makes `forgot-password` silently send
nothing for the rest of the window. `memberRegisterLimiter` is 10/hour keyed on IP
only, so a handful of IPs sustains it.

Fix (`memberAuth.ts:250-268`): `sendSetPasswordEmail` returns early when the member
already has an unused, unexpired reset row. Nothing an unauthenticated caller does can
now invalidate a live link or spend the account's ceiling; the first-time case is
unchanged.

### 3. MEDIUM — `requireRole('admin')` excluded the owner (also fixed at the call site by a parallel agent)

`backend/src/middleware/requireRole.ts:10 (pre-fix)`, call site `backend/src/routes/admin/crudFactory.ts:71 (pre-fix)`

Migration 016 renamed the top role from `admin` to `owner` and promoted the existing
account (`UPDATE admin_users SET role = 'owner' WHERE role = 'admin' AND id = (SELECT min(id) …)`).
`requireRole` compares the role string literally, so the delete route of every generic
CRUD router — blog posts, courses, testimonials, resources, growth items — refused the
business owner and admitted the Manager under her:

```
sign in as Yvette (role = owner)
DELETE /api/admin/blog/5   ->  403 {"error":"Insufficient permissions"}
sign in as a Manager (role = admin)
DELETE /api/admin/blog/5   ->  200 {"ok":true}
```

While I was working, a parallel agent removed that call site in favour of a
`moduleGate` in `routes/admin/index.ts`, so `requireRole` now has no callers. I kept
the helper's fix anyway (`requireRole.ts:17-24`): `owner` satisfies any role gate, which
is what `services/permissions.ts` already asserts unconditionally, so the trap is not
left set for the next caller. Pinned by `backend/src/middleware/requireRole.test.ts`
(4 unit tests, no DB).

---

## Confirmed defects — cross-boundary (not fixed; outside my file ownership)

### A. CRITICAL — `trust proxy` is off by one, collapsing every rate limiter into one global bucket

`backend/src/app.ts:21` (`app.set("trust proxy", 1)`), with `nginx/site.conf:42` and `k8s/ingress.yaml`

Production is **Traefik (k3s ingress) → nginx (docker, `172.18.0.1:8088`) → backend**, i.e.
two proxy hops (`k8s/ingress.yaml` routes the host to nginx; `nginx/site.conf:31` reads
`$http_x_forwarded_proto`, proving Traefik is in front and terminates TLS).

Traefik sets `X-Forwarded-For: <client>`. nginx then appends with
`$proxy_add_x_forwarded_for`, so the backend receives `X-Forwarded-For: <client>, <traefik-pod-ip>`.
Express with `trust proxy = 1` trusts one hop from the socket (nginx) and returns the
**last** XFF entry — Traefik's pod IP, which is identical for every request on the site.

Consequences, all live and all reachable by anyone:

* `member_login_attempts.ip` is one constant value. `loginThrottle`'s
  `ip_failures >= 5` therefore means **any 5 failed member sign-ins site-wide inside 15
  minutes block member sign-in for everybody**. Five requests, one attacker, whole
  customer base locked out; ordinary typo traffic can trigger it by accident.
* `loginIpLimiter` (5 / 15 min) becomes global: 5 requests every 15 minutes locks
  Yvette out of `/api/admin/auth/login` permanently.
* `checkoutLimiter` (15 / 10 min), `chatLimiter`, `leadsLimiter`, `subscribeLimiter`,
  `memberTokenLimiter`, `adminImpersonateLimiter` — all one shared global bucket, so
  the checkout page can be taken offline for the whole site with 15 requests.
* Conversely the per-IP protections give no protection: every attacker shares a bucket
  with every honest user, and the honest users hit the wall first.
* `admin_sessions.ip`, `member_sessions.ip` and `admin_audit_log.ip` all record the
  same useless value, so "where am I signed in?" and the audit trail are fiction.

Fix: `app.set("trust proxy", 2)` in `backend/src/app.ts` (or make nginx overwrite rather
than append and keep 1). Worth a follow-up assertion at boot that `req.ip` varies.

### B. HIGH — mount-level `view` permission is still the only gate on writes in most admin routers

`backend/src/routes/admin/index.ts:83-113` plus the routers themselves

A parallel agent introduced `moduleGate` and applied it to five CRUD routers while I was
reading. The rest are unchanged: `members.ts`, `offers.ts`, `sales.ts`, `contacts.ts`,
`tags.ts`, `segments.ts`, `products.ts`, `curriculum.ts`, `community.ts`, `sequences.ts`,
`automationsV2.ts`, `affiliates.ts`, `growth.ts`, `assessments.ts`, `events.ts`,
`formsV2.ts`, `redirects.ts`, `media.ts`, `chats.ts`, `leads.ts` contain **zero**
`requirePermission` calls between them, so the mount's `*.view` grants every write.

Concrete, against the documented role descriptions in `services/permissions.ts:268-320`:

* Support ("Can look things up and ask for a refund, nothing more"; cannot "change an
  order or a price") holds `orders.view` and `offers.view`:
  `PUT /api/admin/sales/plans/3 {"price_cents":1}` → 200; `PUT /api/admin/offers/7` → 200.
* Support and Marketing hold `contacts.view`, and `routes/admin/members.ts` has no
  per-route permission at all: `DELETE /api/admin/members/42` anonymises/erases a
  customer (line 389), and `POST /api/admin/members/42/impersonate` (line 493) mints a
  working member token for anybody's account.

Fix: extend `moduleGate` to the remaining mounts, and give `members.ts`'s destructive
and impersonation routes their own `requirePermission("contacts.manage")`.

### C. MEDIUM — the admin's "send a password link" email points at a URL the SPA does not route

`backend/src/routes/admin/members.ts:602`

Builds `${publicSiteUrl}/reset-password?token=<raw>`. The frontend route is
`/reset-password/:token` (`frontend/src/App.tsx:128`), and
`backend/src/email/memberTemplates.ts:33-47` documents this exact mistake as the reason
every link is built as a path segment. So the one link an admin can send a customer
lands on the reset page with no `useParams` match and renders its "missing token"
branch. Every member-side email is correct; only this hand-rolled one is not.
Fix: use `link()`/`issueSetPasswordLink().url` instead of the inline template.

### D. MEDIUM — `marketing`, `support` and `coach` accounts cannot reach their own security screen

`backend/src/routes/admin/index.ts:107`

`/admins` is mounted behind `requirePermission("admins.view")`, which only `owner` and
`admin` hold. `GET /admins/me/security`, `POST /admins/me/mfa/{start,confirm,disable}`,
`POST /admins/me/mfa/recovery-codes` and `DELETE /admins/me/sessions/:id` live inside that
router, so a Support or Coach account gets 403 on all of them — **they can never enable
two-step sign-in, see where they are signed in, or sign a lost laptop out**. Those are
the accounts most likely to be contractors on shared machines.
Fix: mount the `/me/*` half of `adminUsers.ts` as its own router behind `requireAuth`
alone. It needs an `index.ts` change, so it is not something I can do from inside
`adminUsers.ts`.

### E. MEDIUM — MFA enrolment proves nothing beyond holding the bearer token, and cannot be undone by anyone else

`backend/src/routes/admin/adminUsers.ts:540 (start)`, `:560 (confirm)`, `:603 (disable)`

`POST /admins/me/mfa/start` and `/confirm` require only a valid admin session — no
password, no re-authentication. An attacker holding a stolen admin JWT (it lives 7 days,
`env.jwtExpiresIn`) can enrol *their own* authenticator and take the ten recovery codes,
which are returned once, to them. `POST /me/mfa/disable` then requires a code, and there
is no route anywhere by which another owner can clear somebody's MFA. The real owner is
locked out of her own admin with no recovery path but a psql prompt — the exact state
`adminUsers.ts:28-36` says a button must not be able to produce.

Not fixed: requiring the current password on `/me/mfa/start` changes a request contract
the admin SPA sends (`frontend/src/pages/admin/…`), which is owned by another agent this
session, and the recovery half needs a new owner-only route plus a UI for it.

### F. LOW — no durable throttle on admin sign-in, unlike member sign-in

`backend/src/routes/admin/auth.ts:25-28`

Admin login is protected only by `loginIpLimiter`/`loginEmailLimiter`, which are
express-rate-limit's in-memory counters: they reset on every deploy and are not shared
between replicas. Member sign-in was given `member_login_attempts` for exactly that
reason (`migrations/001`, comment at line 108). The admin surface — the higher-value
one — has no equivalent, and there is no per-account counter on failed TOTP codes either,
so a stolen admin password plus a botnet can grind the 6-digit second factor at 5 guesses
per IP per 15 minutes with nothing that ever locks the account. Needs a migration, so it
is outside my files.

---

## Looked hard, found nothing

These were traced with a concrete attack in mind and came back clean. Recording them so
the next reviewer does not re-spend the time.

* **Admin/member token confusion.** `auth/secrets.ts` derives the member key by HKDF from
  `JWT_SECRET` with a domain-separated info string, so a member token fails the admin
  verifier on the *signature*, before any claim is read; `utils/jwt.ts:29` additionally
  refuses a token with no `role`. Both verifiers pin `algorithms: ["HS256"]`, so `alg:none`
  and RS→HS confusion are out. `verifyMemberAccessToken` passes `audience`. Pinned by
  `auth/tokenSeparation.test.ts`.
* **Key reuse across primitives.** Every other consumer of `env.jwtSecret` —
  `services/signedUrls.ts` (two keys), `services/events.ts`, `email/provider.ts`,
  `routes/public/checkoutOffer.ts` — HKDFs its own key with a distinct info string, so no
  HMAC an attacker can obtain is computed under the raw JWT signing key. There is no
  oracle that would let a signed download URL be reshaped into an admin JWT signature.
* **Case-folding / duplicate-account attacks.** `members.email`,
  `member_login_attempts.email`, `member_email_verifications.email` and `admin_invites.email`
  are all `CITEXT` (migration 001, 016), so `Victim@x.com` cannot register alongside
  `victim@x.com` and cannot dodge the email-keyed throttle counters. `admin_users.email` is
  plain `TEXT`, but the only writer (`adminUsers.ts:161`) lower-cases and the duplicate check
  at `:164` uses `lower(email)`.
* **Enumeration.** `login`, `forgot-password`, `resend-verification` and `magic-link` all
  return identical bodies and do identical work for a known and an unknown address;
  `auth/password.ts:56-67` and `routes/admin/auth.ts:19,45` both burn a real bcrypt compare
  against a dummy hash on the miss path. I executed both dummy hashes against `bcrypt.compare`
  — they are well-formed (no throw, ~215ms each), so the miss path cannot 500 and become an
  oracle that way.
* **Single-use token flows.** `reset-password`, `verify-email`, `magic-link/consume` and
  `admin/invite/:token` all claim their row with `UPDATE … WHERE used_at IS NULL AND
  expires_at > now() RETURNING …` inside the same transaction as the account change, so two
  tabs cannot both succeed. Tokens are 256 bits of CSPRNG, stored only as SHA-256, and
  `reset-password` and `verify-email` both refuse a `status = 'deleted'` row.
* **Refresh-token rotation.** `auth/memberSession.ts:181-287` takes `FOR UPDATE`, classifies a
  revoked row by reason, and burns the whole chain on a genuine replay. I walked the theft
  and the two-tab-race sequences: the only accepted hole is the documented 30-second grace
  window, which needs the attacker to replay inside 30s of the victim's own rotation.
* **IDOR.** Every `/api/auth/me*` handler takes the id from `req.member` (the verified token),
  never from the body or params; `DELETE /me/sessions/:id` puts `member_id` in the WHERE
  clause rather than in an `if` afterwards. `adminUsers.ts` takes the actor from
  `req.user.sub` only (`actorId`, `:75`) and the target from `:id` behind
  `requirePermission("admins.manage")`, which is owner-only.
* **Session revocation actually biting.** `middleware/auth.ts` re-reads `admin_sessions` and
  `admin_users.status` on every request and overwrites the JWT's `role` claim from the row,
  so a demotion or a suspension takes effect immediately rather than in 7 days.
  `middleware/memberAuth.ts` re-reads `members` per request for the same reason.
* **Impersonation containment.** `denyImpersonation` is present on all 34 write routes under
  `/api/member` (checked file by file), and the impersonation token is issued with no refresh
  cookie and no `member_sessions` row, so `/api/auth/refresh` has nothing to launder it into.
* **Path-matching bypass of `memberAccountRoutes.use("/me", requireMember)`.** `use()` and the
  route declarations match the same undecoded path with the same case-insensitivity, so
  `/api/auth/ME/...` is guarded and `/api/auth/%6De/...` matches neither. No divergence.
* **CSRF on the refresh cookie.** `SameSite=Lax`, `HttpOnly`, `Path=/api/auth`, and every
  cookie-reading route is POST/DELETE, so a cross-site request never carries it. CORS sets
  `credentials` only when `FRONTEND_ORIGIN` names a real origin.
* **Error handling.** `middleware/errorHandler.ts` never serialises a stack or an `err.message`
  from a non-`HttpError`; the 500 branch is a fixed string. `details` only ever carries a zod
  `flatten()`.
* **TOTP.** `services/mfa.ts` implements RFC 4226/6238 correctly (checked the truncation mask
  and the 64-bit counter), compares every step without short-circuiting, uses a ±1 step window,
  and spends recovery codes with `used_at IS NULL` inside the UPDATE so one cannot be used
  twice. Enrolment cannot be confirmed with a recovery code, and regenerating codes requires a
  live TOTP rather than a recovery code.
* **Route shadowing in `adminUsersRouter`.** `/me/...` routes are registered before
  `/:id/sessions/revoke` and differ in segment count from `/:id` and `/:id/suspend`, so no
  `:id` pattern can capture `me`.
