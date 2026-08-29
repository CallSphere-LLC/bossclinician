# Public marketing site — adversarial correctness review

Scope: `frontend/src/pages/**` (excluding `pages/admin/**` and the member/auth/checkout
pages), `frontend/src/components/**` (excluding `components/admin|member|booking`),
`frontend/src/seo/**`, `frontend/src/content/**`, `frontend/src/index.css`.

Every claim below was checked against the actual route table in `frontend/src/App.tsx`,
the SSR route list in `backend/src/routes/public/render.ts`, the redirect map in
`backend/src/db/migrations/004_phase7_redirects_and_seo.sql`, and the backend request
schemas the forms post to. SSR-breakage claims were verified by reading the module graph
(no build was run — see the RAM constraint), not by rendering.

---

## Fixed

### 1 — HIGH — `frontend/src/pages/Blog.tsx:115`

**Failure.** Google sends a visitor to `/blog?tag=documentation` (one of the 21 indexed
tag archives the sitemap advertises and the migration notes call out as traffic-carrying).
The server seeds `blog:list:documentation`, i.e. the documentation posts only. The page
used `useCollection`, whose seed is captured once in a `useState` initialiser and whose
fetch effect has `[]` dependencies — so it never re-reads when the tag changes. The
visitor taps "All Topics": the URL becomes `/blog`, but the list is still the frozen
documentation subset. The visitor taps "Marketing": `items` filters that subset by
`marketing`, finds nothing, and the page says **"No articles found for that topic yet."**
for a topic that has articles. Every one of the 21 indexed archive URLs is a dead end
for anyone who tries to browse out of it.

**Fix.** Replaced `useCollection` with `usePageData(ssrKeys.blogList(tag), …)`.
`usePageData` keys on the SSR key, so it consumes the seed on the hydrating render (no
extra request, no hydration mismatch) and re-fetches whenever the tag changes. The
bundled archive still stands in when the API is unreachable, and the existing
client-side `tag` filter is kept so the fallback path is filtered too.

### 2 — MEDIUM — `frontend/src/pages/BlogPost.tsx:109`

**Failure.** `render.ts` catches a loader error and renders anyway with `data = {}`.
`usePageData` then reports `loading`, and that branch rendered **no `<Seo>` at all**, so
`entry-server` fell through to `resolveHead(undefined, …)`: `DEFAULT_TITLE`,
`DEFAULT_DESCRIPTION`, `robots: index, follow`, HTTP **200**. A crawler arriving during a
database blip is handed every `/blog/<slug>` URL as an indexable success page carrying the
home page's title and description over a body that reads "Loading article…". That is how
eight article titles get replaced in the index by one duplicated home-page title.

**Fix.** The loading branch now declares itself: `<Seo title="Loading… | Boss Clinician"
noindex httpStatus={503} />`. `httpStatus` is server-only (`resolveHead`/`applyHead` never
read it), so the browser is unaffected; the server answers 503 and the crawler comes back
rather than filing a placeholder.

### 3 — MEDIUM — `frontend/src/pages/CourseDetail.tsx:138`

**Failure.** Identical to #2, on the route where **55 legacy bossclinician.com product
URLs land** after their 301. During a loader failure all 55 destinations answer HTTP 200
with the site default title/description and an indexable robots tag over a spinner.

**Fix.** Same `<Seo … noindex httpStatus={503} />` on the loading branch. The `error`
branch is left alone deliberately: `usePageData` can only reach `error` after a client
fetch, never on a server render, so it has no crawler-visible consequence.

### 4 — MEDIUM — `frontend/src/pages/EventRoom.tsx:225, 262, 302, 323, 337, 357`

**Failure.** `/events/:slug/room` is a ticket-gated live-session/replay room — every
useful visit carries `?ticket=<token>`. All six of its `<Seo>` descriptors omitted
`noindex`, and `useHeadContext()` defaults `indexable: true` on a client-rendered boot, so
a crawler that reaches the bare path (a shared link, a referrer) is told
`index, follow, max-image-preview:large`. The indexed result is a page that can only ever
say "This link is missing its ticket."

**Fix.** Added `noindex` to all six descriptors.

---

## Recorded, not fixed — cross-boundary or needs a business decision

These are all real failures with a concrete trigger; none of them can be fixed correctly
from inside my file ownership because the correct destination lives in the backend
redirect table, the offers table, or the blog table.

### 5 — HIGH — `frontend/src/content/resourceHub.ts:95` (redirect map gap)

`/resource-hub` renders a "Take the Free Quiz" card whose CTA is
`https://www.bossclinician.com/ready-quiz` (`ResourceCard.tsx:83`, `target="_blank"`).
Every one of its siblings on that page has a row in the redirect map — `/kickstartguide`,
`/insurance-guide`, `/reset-audit`, `/5-step-marketing`, `/boss-assessment`,
`/hiring-quiz` — but **`/ready-quiz` does not**. The day the domain moves, that button
opens a new tab on a hard 404. Fix belongs in the `redirects` table (backend) or by
repointing the card once a local quiz exists.

### 6 — HIGH — `frontend/src/pages/Store.tsx:66,74,82` and `frontend/src/pages/Retreats.tsx:279,288`

Five **paid** calls to action point at `https://www.bossclinician.com/offers/<id>` and
`…/offers/<id>/checkout` ($3,500 / $6,500 / $12,000 consulting packages, and the two Bali
retreat reservation buttons). `/offers/*` has no row in the redirect map. Post-cutover
every one of them 404s. `Store.tsx:101-129` additionally emits three `Product`/`Offer`
JSON-LD nodes whose `url` is those same dead paths, so the shopping markup will point at
404s on the site's own domain.

### 7 — MEDIUM — `frontend/src/pages/PracticeQuiz.tsx:56`

The page's single CTA is `https://www.bossclinician.com/practice-quiz`, and the redirect
map contains `('/practice-quiz', '/practice-quiz')`. Once this app owns the domain, the
"TAKE THE FREE QUIZ →" button on `/practice-quiz` opens a new tab on `/practice-quiz` —
the page the visitor is already on. The quiz engine exists in this app (`/quiz/:slug`,
`assessmentsPublic.ts`), so the fix is to point this at a real assessment slug; I have no
way to know which one.

### 8 — MEDIUM — `frontend/src/content/courses.ts:23,42,60,77,94,111,129,147,164,183,201,219,240,258`

All fourteen bundled fallback courses carry
`url: "https://www.bossclinician.com/resource_redirect/…"`, which has no redirect row.
`Courses.tsx:392-407` renders these as `target="_blank"` anchors whenever `course.url`
starts with `http`. This is fallback data (only reached when `GET /api/courses` fails), so
the blast radius is an outage window — but every one of these slugs already has a live
`/courses/<slug>` page in this app (they are the exact targets the redirect map uses), so
the fallback rows could simply be repointed at `/courses/<slug>` once someone confirms the
DB slugs match.

### 9 — MEDIUM — `frontend/src/components/home/luxe/LuxeBlogTeaser.tsx:54,63`

Two of the three home-page "From the blog" cards link off-site to
`bossclinician.com/blog/is-talkspace-right-for-your-practice-goals` and
`…/blog/alma-vs-private-pay-group-practice-numbers`. Neither slug exists in
`content/blog.ts` (which carries the eight posts the migration notes say were verified
slug by slug). After cutover these become same-domain links that resolve only if those two
posts are actually in `blog_posts`; if they are not, two cards on the most-linked page on
the site render the 404 panel. Needs verification against the migrated blog table before
cutover.

### 10 — MEDIUM — `backend/src/routes/public/seo.ts:110-121` (sitemap advertises non-routes)

The sitemap emits `${base}/podcasts/<slug>` for every published podcast and
`${base}/<slug>` for every row in `pages`. Neither shape exists in `PUBLIC_ROUTES`
(`App.tsx`): `/podcasts` is member-gated with no `:slug` child, and there is no public
route for CMS page slugs. Both fall through to `/*` → `NotFound`, so the sitemap submits
URLs that answer 404. (The redirect map already flags the podcast destinations as
`target_exists = false`; the sitemap does not honour that flag.)

### 11 — MEDIUM — `backend/src/routes/public/render.ts:32-80` (indexable routes with no SSR)

`/quiz/:slug`, `/events/:slug`, `/f/:slug`, `/funnel/:slug[/:step]` and `/checkout/success`
are in `PUBLIC_ROUTES`, render `<Seo>`, and none of them sets `noindex` — they are meant to
be shareable and indexable. None is in the backend's SSR `ROUTES` list, so a crawler gets
the bare SPA shell: empty `<div id="root">` plus index.html's default title and
description. Every published quiz, event and funnel is therefore a duplicate-title thin
page to a crawler that does not execute JS.

### 12 — MEDIUM — `frontend/src/pages/CheckoutSuccess.tsx:146` (not my file)

The order-confirmation page declares `<Seo title="Order Confirmation - Boss Clinician" …>`
with no `noindex`, while the redirect map 301s **eight** indexed legacy thank-you URLs
(`/thank-you`, `/starterconfirmed`, `/protectionpackthanks`, …) straight at it. Those
redirects hand a crawler an indexable post-purchase page. Owner of the checkout pages
should add `noindex`.

### 13 — BLOCKER (typecheck) — `frontend/src/pages/CheckoutSuccess.tsx:162` (not my file)

`npx tsc -b --noEmit` currently fails with two errors, both in this file and both from
another agent's in-flight edit:

```
src/pages/CheckoutSuccess.tsx(162,30): error TS2721: Cannot invoke an object which is possibly 'null'.
src/pages/CheckoutSuccess.tsx(162,30): error TS18047: 'read' is possibly 'null'.
```

`read` is narrowed by an early return at line 155 but re-read inside the `async function
poll()` closure at 162, where TypeScript cannot keep the narrowing. No file in my
ownership produced an error.

### 14 — LOW — `frontend/src/components/forms/SubscribeForm.tsx:45` (mine; copy, not correctness)

The success state is hardcoded to "Check your inbox for the masterclass link." The
component is used with `source="footer"`, `"resources"`, `"practice-reset-planner"` and
`funnel:<slug>` — three of those four promise something other than a masterclass. Not
fixed: the brief excludes copy changes, and the right wording is Yvette's call.

---

## Where I looked hard and found nothing

- **Head machinery** (`seo/head.ts`, `components/Seo.tsx`, `seo/schema.ts`,
  `ssr/context.tsx`, `entry-server.tsx`, `index.html`, `backend/src/ssr/renderer.ts`).
  No duplicate `<title>`: the backend strips the two `data-bc-default` tags out of the
  template before injecting, and `applyHead` excludes `title` from its removal pass and
  reassigns `document.title` instead. Canonical is built from `payload.origin`
  (`env.publicSiteUrl`), never from a hardcoded host and never from the `.site` staging
  domain; the query is stripped so `?utm_source=` cannot mint a second canonical, and
  `/blog?tag=` opts back in explicitly via `canonicalPath`. `noindex` is forced sitewide
  when `payload.indexable` is false. JSON-LD is escaped for both the HTML tokenizer
  (`<`) and the JSON parser on the server side.
- **JSON-LD vs the visible page.** `Retreats.tsx` Event `startDate`/`endDate`
  (2027-06-15/20), price ($4,500), capacity (12) and the `#reserve` anchor all match the
  rendered copy (`Retreats.tsx:107, 251, 253, 990`). `WorkWithMe` `FAQPage` is generated
  from the same `workWithMe.faqs` array the FAQ band renders. `Store`'s Offer price is
  parsed out of the same string the card prints. `courseNode`/`productNode` prices come
  from the same `offers` array the buy panel renders, and `payment_plan` is correctly
  totalled rather than quoted per instalment.
- **Asset references.** All 50 distinct `/images/...` paths referenced anywhere in `src`
  exist in `frontend/public/images` — including the two the head machinery depends on
  (`yvette-hero-portrait.jpg` for `og:image`, `boss-clinician-logo.png` for the
  Organization logo).
- **Internal links.** Every static `to=`/`href="/…"` in the owned files resolves to a
  path in `PUBLIC_ROUTES` or the member/admin route tables. The `/work-with-me` placeholder
  targets (Club/Lounge/Boardroom) are documented TODOs pointing at a live page, not dead
  links.
- **SSR safety.** No module-level `window`/`document`/`localStorage`/`matchMedia` anywhere
  in `src` except `entry-client.tsx`. `ChatWidget` (rendered on every public page) wraps
  both `localStorage` reads in `try/catch`, and `lib/chatSession.ts` only touches storage
  from inside functions. `hasMemberSessionHint` guards on `typeof document`. `Aurora`,
  `Marquee`, `GlassCard`, `Section`, `LuxePageHero`, `KineticText` and `Reveal` are all
  pure CSS/transform — nothing measures the DOM during a first render.
- **Hydration.** `useEntranceMotion` resolves `!entrancesEnabled` in a `useState`
  initialiser and `enableEntrances()` only runs from a committed effect, so the server and
  the hydrating render both take the static path — entrance animations cannot flip an
  element to `opacity: 0` after paint. `Footer` uses `getUTCFullYear()` on both sides.
  `Blog.publishedLabel` splits the ISO string by hand instead of going through `Date`, so
  it cannot render a day early west of Greenwich. `useHoneypot`'s `Date.now()` lives in a
  ref and is never rendered. No `Math.random()` in any rendered output.
- **Forms.** `LeadForm`, `IncomeCalculator`'s `ResultsCapture`, `FormPage`,
  `EventRegister`, `Quiz` and `AffiliateSignup` were each compared against their backend
  schema. `LeadPayload.source` matches `leadSchema`'s enum exactly; the calculator's `meta`
  keys match `PROJECTION_KEYS` in `routes/public/leads.ts`; `submitForm` posts the
  `{ data, email }` envelope `submitSchema` expects; the quiz posts `responses`/`email`/
  `name`/`timezone` plus the honeypot pair the assessment schema declares. Every submit
  button is disabled while in flight, every catch sets an error state rather than showing
  success, and no form reports success on a rejected promise.
- **Arithmetic.** `IncomeCalculator` is `rate × clients × weeks` over three bounded
  sliders (min 50/1/20), so there is no zero, no division and no empty input.
  `CourseDetail.priceLabel` states both the instalment and the total for a payment plan.
- **Effect cleanup.** `Header`'s scroll listener, `NavDropdown`'s document
  `pointerdown`/`keydown`, `useHashScroll`'s rAFs, `EventRoom`'s countdown timer,
  `Quiz`'s advance timer, and every `useCollection`/`usePageData` fetch all cancel or
  unsubscribe on unmount. `LuxeInstagram` appends the LightWidget script once, guarded on
  an existing `script[src]`, so a route change cannot duplicate it.
- **Accessibility (functional).** `NavDropdown` closes on Escape and restores focus to its
  trigger; the mobile sheet closes on route change and its toggle stays reachable; the
  quiz's answer controls are real `<button>`s with `aria-pressed` inside a labelled
  `role="group"`; `LuxeField` associates every label via `useId`; error regions carry
  `role="alert"` and are wired to the offending controls with `aria-describedby`;
  `Layout` ships a working skip link. The only gap found was that focus is not moved on
  route change (`Layout.tsx:26`) — left alone because adding focus management there risks
  stealing focus on hydration, and the skip link already covers the keyboard path.
- **Dead code (no visitor reachable, so not counted as defects).**
  `components/home/*.tsx` (the eleven pre-Luxe sections, including the
  `/offer-quiz` link in `Offers.tsx:121`) and `components/LegalPage.tsx` are imported by
  nothing.

## Verification

```
flock … npx tsc -b --noEmit
src/pages/CheckoutSuccess.tsx(162,30): error TS2721: Cannot invoke an object which is possibly 'null'.
src/pages/CheckoutSuccess.tsx(162,30): error TS18047: 'read' is possibly 'null'.
```

Two errors, both in `CheckoutSuccess.tsx` — a checkout/thank-you page outside my ownership
that I did not touch and that is currently modified in the working tree by another agent
(see #13). No file I edited or own produced a diagnostic.
