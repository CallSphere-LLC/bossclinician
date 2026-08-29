# Backend platform — adversarial review

Scope: `app.ts`, `server.ts`, `config/env.ts`, `db/**`, `ssr/**`, `utils/**`,
`validation/schemas.ts`, `validation/memberSchemas.ts`, the platform half of
`routes/admin/**` (crudFactory, index, settings, settings-v2, dashboard, stats,
pages, blog, resources, testimonials, sales, redirects, events, assessments,
forms-v2, integrations, ai, members) and `routes/public/**` (index, pages, blog,
seo, redirects, render, settings, health, api-v1, chat, realtime, leads,
testimonials, growth, assessments, events, verify), plus the services those own
(`settings`, `redirects`, `businessIdentity`, `assessments`, `events`).

Every entry below is a request and its outcome, traced through the mounted
router chain. Nothing here came from a failing test — all 412 were green before
and 442 are green after.

---

## 1. HIGH — the owner cannot delete anything on her own site

**`backend/src/routes/admin/crudFactory.ts:71`** (before the fix)

```ts
router.delete("/:id", requireRole("admin"), ...)
```

`requireRole` is an exact string comparison against the JWT role claim, and
migration `016_phase10_settings_roles_integrations.sql:62` promotes the original
account to `owner`. Yvette's account is that row.

Request: `DELETE /api/admin/blog/12` with the owner's bearer token.
Outcome: `403 {"error":"Insufficient permissions"}`. Same for
`/api/admin/courses/:id`, `/api/admin/testimonials/:id`,
`/api/admin/resources/:id` — the delete button on four admin screens answers 403
for the business owner and works for everybody else. A `marketing` account,
which the roles matrix says may manage blog posts and testimonials, was refused
too.

Fix: the guard is removed from the factory and the module's `manage` permission
is applied at the mount instead (see §2), so `owner`, `admin` and — for the
website module — `marketing` can delete, and nobody else can.

---

## 2. HIGH — a module's `view` permission was enough to write to it

*(Independently reported by the auth reviewer; §2, §3 and §4 are the same defect
class and are all closed.)*

**`backend/src/routes/admin/index.ts:82-118`**

The file's own doc comment states the contract: the mount grants `view`, and
"routers that need a finer distinction between reading and changing apply
`manage` per route inside themselves". Eleven routers apply no per-route guard
at all. `services/permissions.ts` gives `support` `contacts.view`,
`orders.view`, `offers.view` and `products.view` with no `manage`, and
`marketing` `offers.view` and `products.view` with no `manage`.

Requests, each with a **Customer support** bearer token (the weakest role that
can sign in to the admin at all):

| request | outcome before |
|---|---|
| `PUT /api/admin/courses/3 {"priceCents":1}` | 200 — the course is repriced |
| `DELETE /api/admin/contacts/41` | 200 — the contact and its timeline are gone |
| `POST /api/admin/contacts/merge {...}` | 200 — two customers merged |
| `PUT /api/admin/offers/7 {"amountCents":1}` | 200 — a live offer repriced |
| `DELETE /api/admin/products/9` | 200 |
| `POST /api/admin/affiliates/payouts/12/paid` | 200 — an affiliate payout marked settled |
| `DELETE /api/admin/tags/3`, `PUT /api/admin/segments/2`, `PATCH /api/admin/leads/8` | 200 |

A **Marketing** token gets the products/offers rows of that table.

Fix: a `moduleGate(module)` helper in `index.ts` applies `<module>.view` to
`GET`/`HEAD` and `<module>.manage` to everything else, and is used for the
blog, courses, testimonials, resources, pages, leads, curriculum, chats,
products, offers, contacts, tags, segments and affiliates mounts. Routers that
draw the line more finely than read/write — sales, members, settings-v2,
admins — keep per-route guards and are mounted on `view` as before.

---

## 3. HIGH — Customer support could create live Stripe objects and delete plans

**`backend/src/routes/admin/sales.ts:49, 99, 118, 236, 284, 299`**

Mounted on `orders.view`, which `support` holds. No route asked for anything
more.

Request: `POST /api/admin/sales/coupons {"code":"FREE100","percentOff":100}`
with a support token.
Outcome: `201`, **and a real 100%-off coupon is created in the live Stripe
account** (`sales.ts:255` calls `stripe().coupons.create` — `backend/.env` holds
live keys). `POST /api/admin/sales/plans` likewise creates a live recurring
Price. `DELETE /api/admin/sales/plans/1` removes the plan behind an active
subscription.

Fix: `requirePermission("orders.manage")` on all six write routes.

---

## 4. HIGH — Customer support could impersonate and erase customers

**`backend/src/routes/admin/members.ts`** — mounted on `contacts.view`
(`index.ts:94`), no per-route guard anywhere in 1,008 lines.

Request: `POST /api/admin/members/7/impersonate` with a support token.
Outcome: `200 {"accessToken":"..."}` — a working 15-minute member access token
for customer 7's library, community posts and invoices.

Request: `DELETE /api/admin/members/7` with the same token.
Outcome: `204`. For a member with no orders this is a hard delete that cascades
to sessions, enrollments and community rows.

Also reachable: `POST /:id/suspend`, `POST /:id/reset-password`,
`POST /import` (5,000 rows), `POST|DELETE /:id/enrollments` — i.e. granting
paid course access for free.

Fix: `requirePermission("contacts.manage")` on every write route, and
impersonation narrowed further to `owner`/`admin` by a local
`requireBusinessAdmin` guard — there is no permission in the matrix for "may
sign in as a customer", and inventing one in a route file would put that answer
where nobody looks for it.

---

## 5. MEDIUM — server-rendered pages corrupt themselves on a `$'` in content

**`backend/src/ssr/renderer.ts:171-172`** (before the fix)

```ts
shell.replace(HEAD_MARKER, `${result.head}\n    ${result.bootstrap}`)
     .replace(APP_MARKER, result.html)
```

`String.replace` interprets `$&`, `` $` ``, `$'` and `$$` **inside the
replacement string** as substitution patterns. Both replacements carry page
content: the head block embeds the JSON payload the browser hydrates from, and
the app block is the rendered post.

Request: publish a blog post whose excerpt contains `$'` (e.g. `save $'s on
your first month`), then `GET /blog/<slug>`.
Outcome: `$'` expands to *everything in index.html after the marker*. The
`<script type="application/json">` payload block is closed by the shell's own
`</script>`, the module script tag and `<div id="root">` are emitted a second
time, hydration fails and the page renders twice. `$$` silently halves a `$$`
in a price. The injected text is the shell's own trusted markup and the payload
escapes `<`/`>`, so this is document corruption rather than XSS — but it is
corruption triggered by two characters of ordinary copy.

Fix: `composeDocument(shell, head, app)` uses function replacements, which are
inserted verbatim. Pinned by `src/ssr/renderer.test.ts`.

---

## 6. MEDIUM — the legacy settings endpoint hands out three live secrets

**`backend/src/routes/admin/settings.ts:14`** (before the fix)

```sql
SELECT key, value FROM settings WHERE key != 'seed_completed'
```

returned every row verbatim. Three of them hold a credential beside their
ordinary fields (`services/settings.ts`): `form_settings.turnstileSecret`,
`analytics.metaAccessToken`, `email_provider.webhookSecret`. The settings-v2
screen goes to real lengths never to return these ("the full value never leaves
the server once it has been saved", `settings.ts:747`), and this endpoint made
that promise decorative.

Request: `GET /api/admin/settings` with any `settings.view` token.
Outcome: `200` with all three secrets in clear, in a response the admin SPA
keeps in memory and posts back on every save
(`frontend/src/pages/admin/Settings.tsx:215` — `buildPayload` starts from
`{...loaded}`).

Fix: `withoutSecrets()` strips the secret-typed fields from both the GET and the
PUT echo. Because the same screen posts back what it read, the PUT now merges
any secret the body does not carry back in (`keepStoredSecrets()`), so removing
them from the read cannot blank them on the next save. A body that *does* carry
one still overwrites it. `services/settings.ts` gained `secretFieldNames(key)`,
which reads the same registry the form is generated from. Pinned by
`src/routes/admin/settings.test.ts`.

---

## 7. MEDIUM — the public form endpoint had no rate limit

**`backend/src/routes/public/growthPublic.ts:134`**

Every other unauthenticated write carries `leadsLimiter` (30 / 10 min):
`/leads`, `/subscribe`, `/assessments/:slug/submit`, `/events/:slug/register`,
`/redirects/miss`. `/forms/:slug/submit` carried none.

Request: `POST /api/forms/newsletter/submit` in a loop.
Outcome: one `form_submissions` row per request, plus — when the form has
`create_lead` set — one `leads` row and one fired automation per request, at
whatever rate the attacker can open sockets. On a 1 GB API container sharing a
box with the database, that is a disk-and-memory problem as much as a spam one.

Fix: `leadsLimiter` added.

---

## 8. LOW — public 500 on a non-numeric funnel step id

**`backend/src/routes/public/growthPublic.ts:207`**

Request: `POST /api/funnels/steps/abc/view` (unauthenticated).
Outcome: Postgres `22P02 invalid input syntax for type integer`, surfaced as
`500 {"error":"Internal server error"}` with a stack in the container log. Free
log noise for anyone who wants it.

Fix: the id is validated to a positive integer and answered with 400.

---

## 9. LOW — unbounded member list on a 1 GB container

**`backend/src/routes/admin/members.ts:229`**

`GET /api/admin/members` with **no** query string deliberately returns a bare
array for the legacy screen — and did so with no `LIMIT`, selecting the whole
`members` table plus a correlated enrollment count per row into the heap of a
process that also renders the marketing pages.

Request: `GET /api/admin/members` after an import of the Kajabi list.
Outcome: every row materialised in memory and serialised to JSON in one go.

Fix: the legacy path is capped at 1,000 rows; the paged envelope (any query
string) is the answer beyond that.

---

## 10. LOW — invalid dashboard range answers 500

**`backend/src/routes/admin/dashboard.ts:162`**

`query.parse(req.query)` throws a `ZodError`, which the error handler does not
recognise.

Request: `GET /api/admin/dashboard?days=0`.
Outcome: `500 {"error":"Internal server error"}` and a stack in the log, where
the honest answer is 400. Fixed with `safeParse` + `badRequest`.

---

## 11. MEDIUM — the admin-sent password link is dead on arrival

**`backend/src/routes/admin/members.ts:602`** (reported by the auth reviewer,
re-confirmed here)

```ts
const link = `${env.publicSiteUrl}/reset-password?token=${encodeURIComponent(raw)}`;
```

The page on the other end is routed as `/reset-password/:token`
(`frontend/src/App.tsx:138`) and reads the value with `useParams`. A query
string arrives at a route that does not exist.

Request: Yvette presses "Send password link" on a member →
`POST /api/admin/members/7/reset-password`.
Outcome: the member receives `https://…/reset-password?token=abc`, clicks it and
lands on the not-found page. The token itself is valid and unusable.

This was already fixed everywhere else — `email/memberTemplates.ts:46` carries a
comment about exactly this failure, and `services/setPasswordLink.ts:85` spells
it as a path segment. This one call site was missed.

Fix: the token is now the last path segment, matching the other two builders.

---

## 12. MEDIUM — no admin below manager could switch on their own 2FA

**`backend/src/routes/admin/index.ts:112`** (reported by the auth reviewer,
re-confirmed here)

`adminUsersRouter` was mounted entirely behind `requirePermission("admins.view")`,
which only `owner` and `admin` hold. That router also carries the self-service
security routes: `GET /me/security`, `POST /me/mfa/start|confirm|disable`,
`POST /me/mfa/recovery-codes`, `DELETE /me/sessions/:id`.

Request: a Coach, Support or Marketing admin opens their own security screen →
`GET /api/admin/admins/me/security`.
Outcome: `403 {"error":"Your account doesn't have access to that."}` — the three
roles most likely to be contractors could not enable two-step sign-in on their
own accounts or end a session from a lost laptop.

Fix: an `adminsGate` in `index.ts` lets `/me/...` through on authentication
alone and keeps `admins.view` on everything else. Safe because every one of
those handlers is scoped to `actorId(req)` — the caller's own id from the
token — and never to an id in the path; the routes that act on *another* admin
(`/:id/sessions/revoke`, role changes) carry their own `admins.manage` guard
inside the router. Confirmed with Express that `req.path` inside a middleware
mounted at `/admins` is `/me/security`, so the prefix test is exact.

---

## Rejected — `trust proxy` is already correct, and raising it would be a real hole

The auth reviewer reported `app.ts:21` (`app.set("trust proxy", 1)`) as CRITICAL
on the grounds that production has two proxy hops (Traefik → nginx → app), so
`req.ip` would resolve to nginx and every rate limiter would share one bucket.
**Do not make this change.** Express does not count network hops; it counts
entries in `X-Forwarded-For` plus the socket peer, and nginx adds none.

`nginx/site.conf` forwards `X-Forwarded-For` **as received** in all eleven proxy
blocks (`proxy_set_header X-Forwarded-For $http_x_forwarded_for;`, lines 70, 106,
114, 135, 156, 165, 175, 184, 193) rather than using
`$proxy_add_x_forwarded_for`. The comment at line 58 records that the reported
symptom — one shared bucket, every consent row storing the same fake IP — is
precisely the bug that existed when nginx *did* append, and that this is the fix
for it. Traefik is therefore the only hop that writes the header, so the list
Express sees has exactly one entry: the real client.

Verified against this repo's own `proxy-addr`, using the trust function Express
compiles for a numeric setting, with socket peer `10.0.0.5`:

| `X-Forwarded-For` | trust 1 | trust 2 |
|---|---|---|
| `9.9.9.9` (the real chain) | `9.9.9.9` ✅ | `9.9.9.9` |
| `1.2.3.4, 9.9.9.9` (client forged an entry) | `9.9.9.9` ✅ | **`1.2.3.4`** ❌ |
| `1.1.1.1, 1.2.3.4, 9.9.9.9` | `9.9.9.9` ✅ | **`1.2.3.4`** ❌ |

`trust proxy: 1` already yields the real client address and cannot be displaced
by anything the client sends. `trust proxy: 2` buys nothing on the real chain and
hands `req.ip` to the caller the moment any upstream preserves a client-supplied
entry — every limiter bypassable by rotating a header, and forged consent IPs
written to `contacts`. The one path where `req.ip` is not the real client is a
request made directly to nginx, which is published on `172.18.0.1:8088` (the k3d
bridge gateway) and is not reachable from outside the host.

Standing dependency, for the infra agent to confirm rather than for this file to
assume: Traefik must keep stripping or overwriting a client-supplied
`X-Forwarded-For` (its default, with `forwardedHeaders.trustedIPs` unset). If
that is ever relaxed, the correct answer is still not a bigger number here — it
is to stop trusting the client's entry at the edge.

---

## Cross-boundary items (not fixed — outside this reviewer's files)

1. **`backend/src/middleware/errorHandler.ts:34` — a `ZodError` becomes a 500.**
   Thirty-odd routes across `routes/admin/{reports,automationsV2,sequences,
   events,assessments,formsV2,growth}.ts` validate with `schema.parse(req.body)`
   rather than `safeParse`. `PATCH /api/admin/forms-v2/1 {"published":"yes"}`
   answers `500 Internal server error` and logs a stack, and Yvette's admin
   shows her a crash where it should show her which box is wrong. One clause in
   the error handler (`if (err instanceof ZodError) → 400` with
   `err.flatten()`) fixes all of them at once and is worth more than converting
   the call sites.

2. **`backend/src/routes/admin/leads.ts:22` — `SELECT * FROM leads … ORDER BY
   created_at DESC` with no `LIMIT`.** Same unbounded-read hazard as §9, on a
   table that grows with every form submission. `routes/admin/sales.ts:229`
   (`SELECT * FROM coupons`, mine, small and admin-authored) and
   `services/redirects.ts:124` (bounded by the ~125-row legacy map) are the two
   other unbounded reads I found; both are acceptable today, the leads one is
   not.

3. **`backend/src/routes/admin/{contacts,products,offers,curriculum,tags,
   segments,affiliates,availability}.ts` have no per-route permission guards.**
   §2 closes the hole at the mount, which is where the module permission is
   already decided, but those routers should still be read once for actions that
   need something stricter than `manage` (affiliate payouts, offer publishing) —
   the mount cannot express that.

4. **`backend/src/middleware/requireRole.ts`** now has no caller in the platform
   files. It compares one exact role string in a five-role system, which is what
   caused §1; if it stays, it should take a list or be replaced by
   `requirePermission`.

---

## Looked hard, found nothing

- **SQL injection.** Every interpolated fragment in `db/**`, `crudFactory`,
  `utils/sqlUpdate.ts` and the owned routers is a compile-time constant, a value
  from a fixed map (`contacts.ts:57` `SORTS`, `growthPublic.ts:204` the
  view/conversions ternary), or a column name matched against a whitelist
  (`buildUpdate`). No user string reaches a table name, a column name, an
  `ORDER BY` or a `LIMIT`. `repo.list({orderBy})` interpolates, but every call
  site passes a literal. LIKE patterns are escaped and bound
  (`members.ts:152`, `contacts.ts`).
- **Mass assignment.** `createCrudRepo` filters the body against a column
  whitelist before it builds either statement, and `db/repos.ts` /
  `db/growthRepos.ts` list only writable columns — counters (`views`,
  `run_count`, `hit_count`), `id` and timestamps cannot be set from a body.
  `buildUpdate` behaves the same way. No route lets a client set `role`,
  `is_admin` or an ownership column; `members.ts` refuses `status: "deleted"`
  through the ordinary edit path by construction.
- **Mount order.** `app.ts` mounts `/api/admin`, `/api/auth`, `/api/member`
  before `/api`, so no public router can shadow an authenticated one; the SSR
  router is last and matches only an explicit path list; the two raw-body
  webhook mounts sit ahead of `express.json()`, which is what makes signature
  verification possible at all. In `routes/admin/index.ts` exactly two routers
  are mounted outside `requireAuth` — `authRouter` (login) and
  `adminInviteRouter` (accepting an invite, whose own token is the credential) —
  and both are deliberate and documented.
- **`X-Forwarded-For` spoofing.** `app.set("trust proxy", 1)` with nginx
  forwarding `$http_x_forwarded_for` *as received* looks wrong and is not:
  Traefik is the edge and appends the real peer, so `proxy-addr` walking back
  one hop lands on it and any client-supplied entry stays to its left. nginx is
  published on `172.18.0.1:8088` only, so it cannot be reached directly with a
  forged header. Every limiter therefore keys on a real address.
- **Connection-pool leaks.** All 39 `pool.connect()` sites have a matching
  `client.release()` in a `finally`, including the error paths that `ROLLBACK`
  and rethrow. Multi-statement writes that must be atomic (member erasure,
  migrations) are in explicit transactions.
- **`db/pool.ts` sizing.** No `max` is set, so `pg` defaults to 10 connections
  per process — sane for a single API container beside a 768 MB Postgres on an
  8 GB box, and well under the server's `max_connections`. Worth noting only
  that `connectionTimeoutMillis` is also unset, so a request that arrives with
  the pool exhausted waits rather than failing fast.
- **`config/env.ts` defaults.** `JWT_SECRET` is required with no fallback — the
  process refuses to boot without it, and there is no dev secret to ship by
  accident. `SEO_ALLOW_INDEXING` and the settings mirror of it both default
  closed, and an unreadable settings table is treated as "not indexable" in both
  `seo.ts` and `ssr/renderer.ts`. `PROTECTED_UPLOAD_DIR` nested inside
  `UPLOAD_DIR` is refused at boot. `FRONTEND_ORIGIN` defaults to `*`, but the
  CORS call then sets `credentials: false`, so the permissive case cannot carry
  a cookie; production sets a real origin.
- **Public payload leakage.** `/api/settings` is a field-level allow-list
  (already hardened, still correct); `/api/blog`, `/api/courses`,
  `/api/testimonials`, `/api/resources` and every SSR loader filter on
  `published = true`; `/api/pages/:slug` returns `SELECT *` but the table has no
  private column; `/api/verify/:code` returns only what is printed on the face
  of the certificate; the SSR payload is JSON-escaped for `<`, `>`, U+2028 and
  U+2029 before it is embedded (`frontend/src/entry-server.tsx:81`); the error
  handler never returns a stack or a database message.
- **SSR request isolation.** No module-level mutable per-request state — the
  head sink is created per render, and the two module caches
  (`template`, `bundle`, `indexableCache`) hold process-wide values only. A
  loader that throws costs the page its seed data and nothing else; a render
  that throws falls back to the untouched shell.
- **Open redirects.** `services/redirects.ts` normalises to a path, refuses a
  self-redirect, and the admin write path refuses any target that does not start
  with `/`. `/api/redirects/resolve` returns a stored path, never a caller's.
- **Zod vs the database.** No `.passthrough()` in the owned schemas; the three
  `z.unknown()` fields (`sections`, `features`, `meta`) back JSONB columns; the
  settings-v2 patch schema is `.strict()` against the registry. Route params in
  the owned files are `Number.isInteger`-checked or parsed with
  `z.coerce.number().int().positive()`; the `parseInt` → `NaN` → whole-table
  pattern does not appear.

---

## Follow-up fixes (verify pass)

Seven confirmed findings from the review/verify pass, each re-checked against the
code before it was touched. Files changed: `routes/auth/memberAuth.ts`,
`seed/seed.ts`, `routes/admin/index.ts`, `middleware/errorHandler.ts`,
`routes/admin/leads.ts`, `routes/public/seo.ts`, and a new migration
`db/migrations/019_redirect_backfill.sql`.

### 1. The account-wide sign-in ceiling was a no-op (`memberAuth.ts`)

**Confirmed.** An earlier fix moved the `email_failures_all_ips >= 40` check
inside the failure branch, to stop forty guesses from a stranger's proxies
locking the real owner out. It worked, and it also removed the bound: the
request still reached `verifyPassword`, so a correct guess at or above forty
still signed in and the only thing that changed was 401 → 429. The per-IP limit
was the only bound left, which is five guesses per IP — five times however many
IPs an attacker rents.

**Fix.** The ceiling is a *minimum gap between evaluated attempts* rather than a
refusal. Above forty failures in the window, an address must wait
`min(5 × 2^(failures − 40), 60)` seconds since its last evaluated failure; inside
that gap the request is refused with the same generic 429 the per-IP throttle
already uses, before the password is looked at. Two new pure functions,
`accountBackoffSeconds` and `accountCooldownRemaining`, carry the arithmetic and
are unit tested in `memberAuth.test.ts`.

Against the four constraints that were set:

- *The owner still gets in.* The refusal records nothing, so an attacker cannot
  renew it — only evaluated failures move the clock. At the one-minute cap an
  attacker can land at most fifteen failures inside the fifteen-minute window,
  which is below the forty it takes to be above the ceiling, so the counter
  drains under sustained attack and the gap lapses with it. There is no state to
  clear and therefore no clearing path to be rate-limited out of, which is the
  specific way the old lockout failed.
- *The attacker is bounded.* Steady state is roughly forty guesses plus fifteen
  per window regardless of how many IPs they hold, instead of 5 × N.
- *No enumeration oracle.* The counters live in `member_login_attempts`, keyed on
  the address as typed, and a failure is recorded for an address with no account
  exactly as for one with an account. The gap is reached identically either way,
  and it is applied before `findByEmail`'s result is used, so the timing does not
  split either.
- *No resource exhaustion.* Nothing sleeps; the refusal is immediate.

**Not done.** The emailed-challenge alternative. It needs a table, a template and
a screen, two of which are owned by other work in flight, and the delay shape
meets the same bound without adding a new way to send mail to an address a
stranger named.

### 2. A rebuilt database seeded Yvette as a manager, not the owner (`seed.ts`)

**Confirmed.** `server.ts` runs `applySchema()` before `runSeedIfEmpty()`, so
migration 016's `UPDATE admin_users SET role='owner' WHERE role='admin'` sweeps
an empty table and then the seed inserts `'admin'`. On any wiped or rebuilt
database Yvette comes up without `admins.manage` — she could not invite or remove
team members, and every `requireOwner` route would refuse her.

**Fix.** The seed picks the role instead of inheriting it: `owner` when
`admin_users` is empty, `admin` otherwise. Live production is untouched —
`ensureAdminUser` still returns before any write when a row with that address
already exists, and the existing row is already `owner`.

The `else` branch is deliberate rather than incidental: a non-empty table is an
install that already has an owner, and a newly seeded address there should not
become a second unconditional account.

### 3. Routers mounted on `.view` while permitting writes (`admin/index.ts`)

**Confirmed** for `/reports`: `adminReportsRouter` was mounted on `reports.view`
with no `moduleGate` and no per-route guard, so `marketing` — which holds
`reports.view` and not `reports.manage` — could `POST /saved`, `PUT /saved/:id`,
`DELETE /saved/:id` and `POST /refresh`.

**Fix.** `moduleGate` (GET/HEAD → `view`, anything else → `manage`) applied to
`/reports`, and to the other mounts in the same shape: `/settings`, `/ai`,
`/media`, `/community`, `/growth`, `/sequences`, `/email-templates`,
`/automations`, `/redirects`, `/assessments`, `/events`, `/forms-v2`, and
`/integrations` (which the verifier's list missed — same pattern, writes behind
`settings.view`).

Each was checked before it was changed. `/reports` is the only one where the
gate takes a capability away from a role that has it today, and that is the
finding. Everywhere else every role that can currently reach the screen also
holds the matching `.manage`, so the change is a door closed ahead of the next
role rather than a regression now. The owner short-circuits `can()` and is
unaffected throughout.

**Not gated, on purpose.** `/stats`, `/dashboard` and `/subscribers` expose no
route that is not a GET, so a gate there would be a comment pretending to be a
control. `/members`, `/sales`, `/settings-v2` and `/admins` draw the line more
finely than read-or-write and keep their own per-route guards.

### 4. `ZodError` fell through to 500 (`middleware/errorHandler.ts`)

**Confirmed.** Roughly thirty routes validate with `schema.parse(req.body)`,
which throws rather than returning. Nothing in the handler recognised a
`ZodError`, so every one of them answered a mistyped form with HTTP 500 —
rendered by `friendlyError` as "Something went wrong on our end", i.e. the site
telling the business owner it is broken when what happened is she left a field
empty.

**Fix.** A `ZodError` clause ahead of the generic branch, answering 400 with
`{ error, details: { fields } }`. The sentence names the field the way the screen
labels it (`ctaLabel` → "Cta label", using the same derivation as the admin's own
`humanizeKey`), and distinguishes empty from too short, too long and merely
wrong. Detection is `instanceof` plus a shape test, so a second copy of zod
anywhere in the tree does not silently put those routes back on 500.

Checked against `frontend/src/pages/admin/ui/friendly.ts`: it keeps a 400's own
wording when the text does not begin "Invalid" and is under 200 characters, so
these sentences reach her rather than being replaced by the generic line. The
tests assert both conditions.

**Not leaked.** Only the first path segment is used — `sections.2.blocks.0.href`
is our schema's shape and tells a reader nothing and an attacker something. Zod's
own text ("Expected string, received number") is not reused anywhere, including
in `details`, which carries field names only.

### 5. Unbounded `SELECT *` on the enquiries list (`admin/leads.ts`)

**Confirmed.** `GET /admin/leads` read the whole `leads` table with no limit —
a table every contact form on the public site writes to.

**Fix.** `LIMIT 1000`, matching `admin/members.ts`: same ceiling, same reasoning
(a 1GB container that also renders the marketing pages), same shape of comment.
The enquiries screen shows newest first, so the cap trims the oldest.

**Not done.** No paged envelope. `members.ts` grew one because it has search and
filters to page through; adding an unused one here would be a second response
shape for a screen that does not ask for it.

### 6. Live CTAs with no redirect row (`019_redirect_backfill.sql`)

**Confirmed** against `frontend/src/App.tsx` (current version) and
`004_phase7_redirects_and_seo.sql`. Appendix B was built from the *indexed* URL
list, so it covers no address that only ever appears as a button — which is most
of the ones with money attached.

**Added**, all lowercase because both readers lowercase before matching
(`normalizePath`, and nginx's `map` for string keys) and Kajabi's offer tokens
are mixed case:

- the three `/store` service CTAs ($3,500 / $6,500 / $12,000) → `/store`;
- both `/retreats` deposit CTAs → `/retreats`;
- fourteen `/resource_redirect/…` course links → `/courses/<slug>`, matched one
  by one against `frontend/src/content/courses.ts`;
- `/ready-quiz` → `/practice-quiz`, which is where 004 sends every quiz not yet
  rebuilt here;
- three home-page blog teasers: `/blog/how-to-stop-seeing-25-clients-a-week` →
  the same post's longer local slug, and the two posts that were never migrated
  → `/blog`.

Both URL forms are written for each offer token (`/offers/<token>` and
`/offers/<token>/checkout`): Kajabi serves both and which one is in somebody's
bookmarks is not ours to choose. Idempotent via `ON CONFLICT (from_path) DO
NOTHING`, which also means a row Yvette edits by hand survives a re-run.

**Left for Yvette to decide, not invented:**

- `/podcasts/lyrical-reflections` and its nine episode paths (already in 004).
  `/podcasts` exists only inside the member area behind `RequireMember`, and
  there is no per-show or per-episode route at all. No public page on this site
  is the right destination for a podcast listener, so the rows stay as they are —
  `target_exists = false`, i.e. already on the "needs a page" worklist.
- `/practice-quiz`. 004 maps it to itself; that row is inert by design
  (`resolveRedirect` refuses a self-redirect) and the path is a real route here,
  so no redirect can help. The actual defect is on the page — the CTA at
  `frontend/src/pages/PracticeQuiz.tsx:56` points at
  `https://www.bossclinician.com/practice-quiz`, which after cutover is the page
  the visitor is already reading. Front-end fix, not a redirect.

The fourteen course redirects are written `target_exists = false` even though
`/courses/:slug` resolves: `/api/courses/:slug` answers 404 for a slug with no
published row and `CourseDetail` renders that as a real 404, and whether each row
is published is a question about the database rather than about the migration.
004 flags the same slugs the same way. Its rows were not retro-edited.

### 7. The sitemap advertised 404s (`routes/public/seo.ts`)

**Confirmed** against the route table in `App.tsx`. Two of the four generated
blocks emitted paths the app does not route:

- `pages` was emitted as `/<slug>`. That table holds the *content* of the
  hand-built pages, read by `/api/pages/:slug` to fill in a page that already has
  its own route. There is no `/:slug` route.
- `podcasts` was emitted as `/podcasts/<slug>`. `/podcasts` exists only behind
  `RequireMember`, and there is no per-show route.

**Fix.** Both blocks removed. What remains — the static list, published blog
posts, published courses, and the `/blog?tag=` archives — was checked path by
path against `PUBLIC_ROUTES` and all of it resolves.

**Not done.** `/partners` is a real public route that the sitemap has never
listed. Adding it is a content decision (whether the affiliate signup should be
indexed at all), not a correctness fix, so it was left alone and is noted here.
