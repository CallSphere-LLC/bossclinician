# Frontend core — adversarial review

Scope: `App.tsx`, `entry-client.tsx`, `entry-server.tsx`, `src/ssr/**`, `src/lib/**`,
`src/hooks/**`, `src/components/member/**`, `src/components/booking/**`, the
member/auth/checkout pages under `src/pages/` (`member/*`, `Checkout.tsx`,
`CheckoutSuccess.tsx`, `CheckoutUpsell.tsx`), `src/types.ts`, `src/types/**`.

Line numbers are as-found, before the fixes.

Verification: `npx tsc -b --noEmit` passes (green as of the final run;
an intermediate edit briefly failed with TS18047/TS2721 in `CheckoutSuccess.tsx`
because `read`'s null-check did not survive into the hoisted `poll` — it is bound
to a non-null local now). `npm run build` was **not** run — the
box is RAM-constrained and the coordinator prohibited it. SSR claims below were
verified by reading every module `entry-server.tsx` pulls in eagerly, not by
building. Routing claims were verified by rendering the real route shapes through
the installed `react-router-dom` + `renderToString` in a throwaway script.

---

## Critical

### 1. Every member screen renders a blank page
`src/App.tsx:114-264` (the `MemberRoutes` component and the twelve
`<Route element={<MemberRoutes />}>` wrappers)

`MemberRoutes` was a **descendant** `<Routes>`: it was mounted as the element of
`<Route path="/login">`, `<Route path="/account/*">`, `<Route path="/library/*">`
and so on, and it declared its children with absolute site paths
(`/login`, `/account/profile`, `/library/:productSlug/lessons/:lessonSlug`, …).

React Router v6 matches a descendant `<Routes>` against what is **left** of the
URL after the parent route consumed it. For `/account/profile` the parent
`/account/*` consumes `/account`, so the inner router is asked to match
`/profile` against a child declared at `/account/profile` — no match. For
`/login` the parent consumes the whole path and the inner router matches `/`
against `/login` — no match either.

User-visible failure: a member (or anyone) opens `/login`, `/signup`,
`/forgot-password`, a reset-password link from their inbox, a verify-email link,
`/account`, `/library`, `/community`, `/coaching`, `/podcasts`, `/newsletters`,
or `/partners/dashboard` → **an empty page**. No error, no spinner, no 404. The
entire signed-in product and the whole sign-in funnel are unreachable. Confirmed
by rendering the exact structure through the installed react-router; it returns
`""` for every one of those URLs and react-router logs its "you rendered
descendant `<Routes>` … the parent route path has no trailing `*`" warning.

`tsc` cannot see this: it is a runtime path-matching contract, and every type
involved is correct.

**Fix:** the member surface is now `memberRoutes()`, a `<Route>` subtree spliced
directly into the app's single `<Routes>`. The Suspense boundary and the
sign-in guard became pathless layout routes (`<MemberBoundary>` renders
`<Outlet>`; `RequireMember` wraps an `<Outlet>`), so both still apply once to the
whole group. `RequireMember` itself is unchanged. Re-verified through
react-router: all member URLs now resolve to their pages, `/partners/dashboard`
still outranks the public `/partners`, and an unknown `/account/*` correctly
falls through to the marketing 404 instead of being swallowed.

### 2. The thank-you page renders the marketing 404 for every buyer
`src/App.tsx:301` — `<Route path="/checkout/success" element={<PublicRoutes />} />`

Same descendant-`<Routes>` defect, one route further along. `PublicRoutes` is a
nested `<Routes>`; the outer `/checkout/success` route consumed the whole
pathname, so the inner router matched `/`.

**Corrected by the verify pass:** `/` is the *home* route, not the `path="*"`
entry, so what the buyer actually got was the **marketing home page** — this
write-up's original claim of a "page not found" was wrong. The user-visible
failure is no less serious for it, and is arguably worse: a customer whose card
has just been charged is dropped on the sales home page with no receipt, no
order number and no sign that anything happened, so the natural next move is to
pay again. Every buyer, both checkout flows.

**Fix:** `/checkout/success` now renders the page directly —
`<Layout><Suspense fallback={<PageFallback />}><CheckoutSuccessPage /></Suspense></Layout>` —
using a named `lazyRoute` const that `PUBLIC_ROUTES` also points at, so the two
declarations cannot drift into loading different chunks. The route still has to
exist at the top level so `/checkout/:offerSlug` does not read "success" as an
offer slug; the comment now says why it cannot delegate to `PublicRoutes`.

### 3. The confirmation page cannot read the order the checkout actually gives it
`src/pages/CheckoutSuccess.tsx:93,113` — `params.get("session_id")` /
`api.checkoutOrder(sessionId)`

Two checkouts land here and the page only understood one of them.

- `pages/Checkout.tsx:456,527` sends the buyer to
  `successPath(receipt)` = `/checkout/success?order=<id>&token=<hmac>`, both as
  the in-app navigation and as Stripe's `return_url` for a 3DS redirect.
  `pages/CheckoutUpsell.tsx:126` does the same at the end of the upsell flow.
  This is the Payment Element flow — every offer on the site.
- Only `components/BuyButton.tsx` → `api.createCheckoutSession` still uses hosted
  Stripe Checkout, whose backend `success_url`
  (`backend/src/routes/public/checkout.ts:73,180`) carries `?session_id=`.

The page read `session_id` only. For an offer purchase there is none, so it set
"No checkout session was provided" and immediately painted the **"We haven't
confirmed this payment yet"** panel — to somebody whose card had just been
charged. (Behind defect #2 this was unreachable at all; fixing #2 exposes it.)

**Fix:** the page now reads `?order=` + `?token=` first and polls
`commerceApi.getOrder(orderId, token)` → `GET /api/checkout/order/:id?token=…`
(`backend/src/routes/public/checkoutOffer.ts:1258`, which validates the HMAC
server-side), falling back to the `session_id` lookup for the legacy flow. Both
shapes are normalised into one `Confirmation` (`status`, `title`, `email`,
`amountCents`, `currency`) so the panel is unchanged. `status` still comes from
the database, which only the webhook can move to `paid` — no browser can talk
this page into claiming success.

### 4. Every community channel link goes to the marketing 404
`src/App.tsx:168` (as found: `path="/community/:slug/channels/:channelSlug"`;
now `path="/community/:slug/:channelSlug"`)

The API builds channel links itself:
`backend/src/routes/member/community.ts:1736` returns
`href: "/community/${slug}/${channelSlug}"`, and `CommunityLayout` renders
`<Link to={channel.href}>` verbatim. `pages/member/CommunityChannel.tsx`'s own
doc comment also says `/community/:slug/:channelSlug`. The route table was the
only place with a `channels/` segment, and nothing in the app or the backend ever
produces such a URL.

User-visible failure: a member opens their community and clicks any channel in
the sidebar → the marketing "page not found". The community is readable only at
its landing page.

**Fix:** the route is now `/community/:slug/:channelSlug`. It cannot collide with
`/community/:slug/members/:memberId` (different segment counts); verified through
react-router that `/community/growth/general` resolves to the channel and
`/community/growth/members/42` to the profile.

**Corrected by the verify pass:** "different segment counts" was only half the
story and led straight to a regression. The new route is a two-segment wildcard,
and `/community/:slug/members` — the sidebar's "N members" link — has two
segments too, so it was swallowed by it. See "Follow-up fixes (verify pass)",
item 1, below.

---

## High

### 5. The blog archive never re-fetches when the tag filter changes
`src/hooks/useCollection.ts:27-52` — `useEffect(…, [])`

The effect ran once per mount and the SSR seed was captured once, so a change of
`ssrKey`/fetcher was invisible to the hook. `pages/Blog.tsx:111` calls it as
`useCollection(() => api.blogList({ tag }), fallback, ssrKeys.blogList(tag))`.

Both the API (`backend/src/routes/public/blog.ts:18`, default `limit=10`) and the
SSR loader (`backend/src/ssr/loaders.ts:32`, `limit = 10`) return **ten** posts.

User-visible failure: a visitor lands on `/blog` (ten newest posts, unfiltered)
and clicks a tag chip. The URL changes, no request is made, and the page filters
only the ten posts it already holds — so a tag whose posts are older than the ten
newest shows a truncated archive or "nothing here", while the real tag archive
(which the same URL serves correctly on a cold load) has more. This is on the
primary SEO surface, where 21 tag archives are separately indexed.

**Fix:** the effect is keyed on the collection key. `fetcher` and `fallback` are
held in refs (both close over caller props and change identity every render), a
`settledKey` ref records which key the rows on screen belong to — seeded from the
SSR payload at mount — and the effect fetches whenever the key on screen is not
the key being asked for. The existing per-effect `cancelled` flag already
prevents an older response overwriting a newer one; it now also guards the
`settledKey` write. Same pattern as `usePageData`, which was already correct.

---

## Also fixed while in the file

`src/pages/CheckoutSuccess.tsx:146` — the order confirmation carried no
`noindex`, and eight already-indexed legacy thank-you URLs 301 to it. Google
would have indexed a page that is one customer's receipt, and it would have
competed with the course pages for the searches that sell them. Now
`<Seo … noindex />`, matching `NotFound` and `EventRoom`. (Raised by the
public-site reviewer; the file is mine.)

---

## Cross-boundary (not mine to edit)

1. `frontend/src/pages/Blog.tsx:117-120` (public pages) — the client-side
   `items.filter((post) => post.tags.includes(tag))` is now redundant: with
   defect #5 fixed the server already returns the tag archive. It is harmless but
   it is exactly the belt that hid the missing re-fetch, and it would hide the
   next one. Worth deleting.
2. `backend/src/routes/member/community.ts:1736` — the channel `href` shape is
   asserted only in prose on both sides. Nothing tests that the strings the API
   emits are strings this router resolves; defect #4 is what that costs.
3. `frontend/src/lib/api.ts:48-60` (mine, deliberately unchanged) — the **admin**
   token lives in `localStorage`. That matches the admin backend, which
   authenticates on a bearer token and sets no cookie, so it is the contract
   rather than a mismatch; noting it because the member client next door
   deliberately does the opposite. Changing it is a backend-side decision.
4. `frontend/src/entry-client.tsx:48` — `preloadPublicRoute(...).then(...)` has no
   `.catch`. If the route chunk fails to download, `hydrateRoot` is never called
   and the server HTML stays on screen, static and silent. Left alone: the
   obvious catch (hydrate anyway) makes the boundary suspend during hydration and
   is not clearly better than the current degradation, and I could not
   substantiate a concrete failure beyond "a network blip mid-load". Flagging it
   rather than guessing.

---

## Where I looked hard and found nothing

- **SSR module-top-level browser globals.** Every module `entry-server.tsx` pulls
  in eagerly (`App`, `Layout` → `Header`/`Footer`/`ChatWidget`, `NotFound`,
  `seo/head`, `ssr/*`, `hooks/useAuth` → `lib/api`, `hooks/useMember` →
  `lib/memberApi`) was scanned for `window`/`document`/`localStorage`/`navigator`
  outside a function body. The only module-level hit in the whole tree is
  `entry-client.tsx:10`, which SSR never imports. `lib/chatSession.ts` and
  `hooks/useHashScroll.ts` guard or defer theirs; `ssr/context.tsx:95` guards on
  `typeof window`.
- **Per-request state leaking between SSR renders.** `headSink` is created per
  request in `render()` and read back there (`entry-server.tsx:40,55`).
  `Seo` pushes into that sink during render, which is what a collector is.
  The three module-level mutables — `ssr/context.tsx:50` `payloadLive`,
  `hooks/useEntranceMotion.ts:37` `entrancesEnabled`, `ssr/lazyRoute.tsx:22`
  `resolved` — are only ever written from a committed effect (never runs under
  `renderToString`) or hold a component reference, not request data. Nothing in
  `lib/` holds a mutable client.
- **Hydration mismatches from Date/locale/random on the server-rendered
  surface.** The backend server-renders exactly the twenty paths in
  `backend/src/routes/public/render.ts`; none of those pages, nor `Layout`,
  formats a date. `Footer.tsx:131` deliberately uses `getUTCFullYear()`.
  `useHoneypot.tsx:29` puts `Date.now()` in a ref and never renders it.
  `lib/format.ts`'s `toLocaleDateString` helpers are reached only from
  member/admin screens, which are client-rendered.
- **The member auth flow.** The access token is a module variable, never storage.
  The refresh is single-flight (`memberApi.ts:115`), the 401 path retries exactly
  once, and the refresh call itself carries `skipRefresh` — there is no loop to
  spin. `MemberAuthProvider` starts `loading: true` and `RequireMember` holds a
  spinner rather than a redirect until the session settles, so no protected route
  ever passes for an anonymous visitor and no protected data call starts behind a
  guard that has not resolved. Every member request sends
  `credentials: "include"`; the backend requires no CSRF token or custom header
  (nothing in `backend/src` reads one).
- **All fifteen API clients** (`lib/*.ts`). Every one throws on `!res.ok` before
  touching the body, returns `undefined` on 204 rather than calling `.json()` on
  an empty body, and swallows only the *error-body* parse into a readable
  default. No path parses a non-2xx as success, and no path leaves the UI with a
  blank state and no message. The two hand-rolled fetches that bypass the shared
  wrapper (`billingApi.fetchReceipt`, `coachingApi.fetchSessionIcs`) both check
  `res.ok` and both refresh once via the shared client before retrying.
- **Money.** Every figure the member sees is integer cents from the server,
  divided by 100 only inside `Intl.NumberFormat`. `Checkout.tsx` never prices
  anything itself; `inputToCents` (`Checkout.tsx:911`) is `Math.round(dollars *
  100)`, correct for `19.99`. No float arithmetic on a price anywhere in scope.
- **Double-submit and lost input.** Every form in scope disables its submit while
  the request is in flight (`AuthSubmit`, `Checkout`'s button plus an explicit
  `if (submitting) return`, `Security`, `Profile`, `Billing`, both booking
  dialogs, `CancelSubscriptionDialog`, `Purchases`' load-more). No handler clears
  the user's fields on failure. `Checkout.tsx:415` additionally caches the opened
  order against a payload signature, so retrying a declined card confirms the same
  PaymentIntent instead of opening a second order.
- **`dangerouslySetInnerHTML`.** None in the repository. `Newsletters.tsx` renders
  member-facing markdown through `react-markdown` with no `rehype-raw`, so
  embedded HTML stays escaped.
- **Fetch races and stale closures in the remaining hooks/pages.**
  `usePageData`, `SlotSearch`, `CoursePlayer` (product, lesson, and the signed
  media renewal), `Billing`'s `useResource`, `Purchases`, `Security`,
  `CheckoutUpsell`'s settle poll and `CommunityProfile`'s debounced directory
  search all carry a cancellation flag or an in-flight-query ref and cannot paint
  an older answer over a newer one.
- **`main.tsx`.** Nothing references it; `index.html` loads
  `/src/entry-client.tsx`.

---

## Follow-up fixes (verify pass)

Everything below was queued from a reviewer or verify pass after the sections
above were written. Each item was re-confirmed against the code — and against
the backend routes, which is where three of the original claims turned out to be
wrong — before anything was changed.

### 1. The "N members" link was swallowed by the channel wildcard
`src/App.tsx` — `path="/community/:slug/:channelSlug"`

**Confirmed.** `CommunityLayout.tsx:196` renders `/community/:slug/members` as
the member-count link. The two-segment channel wildcard introduced by defect #4
matches it, so clicking the member count mounted `CommunityChannel` with
`channelSlug="members"` and the member got a channel-not-found error.

**Not confirmed:** the claim that "there is no member-directory page". There is.
`pages/member/CommunityProfile.tsx` already renders a full directory —
search box, badge/points cards, "Show more" paging — whenever `memberId` is
absent, and it was already reachable in code from `ProfileView`'s "All members"
back link. The backend directory it reads,
`GET /api/member/community/:slug/members`
(`backend/src/routes/member/community.ts:1759`), is paginated and searchable.
The page and the API were both finished; only the route was missing.

**Fix:** `<Route path="/community/:slug/members" element={<MemberCommunityProfile />} />`
added alongside the wildcard. React Router 6 *ranks* routes rather than taking
the first that matches, and a static segment outranks a dynamic one, so this
wins over `:channelSlug` regardless of declaration order — which is what makes
the ordering robust for the next `/community/:slug/<page>` somebody adds, rather
than a patch for this one link. Written above the wildcard anyway, so a reader
sees the specific case first. The one thing ranking cannot save is a channel
whose slug is literally `members`; that is noted in the route comment.

### 2. Date-only values rendered as the previous day
`src/lib/format.ts`

**Confirmed as a mechanism, not as a live symptom.** `new Date("2026-08-18")` is
specified to mean midnight **UTC**; `toLocaleDateString` then renders it in the
reader's zone, so anyone west of Greenwich sees the 17th.

**Callers checked, and this is the part that mattered:** nothing currently
reaches `formatDate`/`formatDateTime` with a date-only string. Every `*At` field
in the API is `timestamptz` and arrives with an offset; the only bare
`YYYY-MM-DD` values the frontend handles are the reporting series
(`to_char(day, 'YYYY-MM-DD')`), and those go to `shortDay`, which was already
compensating by appending `T00:00:00` itself. So no caller needed un-compensating
— had one existed, fixing the helper would have pushed it a day the other way.

**Fix:** one `parseStored` helper appends `T00:00:00` to a bare date and passes
a full timestamp through untouched; `formatDate`, `formatDateTime` and
`formatRelative` all go through it, and `shortDay`'s hand-rolled compensation was
replaced by the same call so the two cannot drift apart.

**Left, and reported rather than fixed** (outside this pass's file ownership):
`pages/admin/Segments.tsx:218` does `new Date(value).toLocaleDateString("en-US")`
on the raw contents of a `type="date"` box — a bare `YYYY-MM-DD` — so a segment
rule reads back a day early to Yvette. `pages/admin/ui/friendly.ts:137`
(`toDateInput`) has the same shape and would shift a bare date, though its only
callers hand it full timestamps.

### 3. Write-endpoint gaps in `src/lib/**`
Every write route under `backend/src/routes/admin/` was enumerated from the
mount table in `routes/admin/index.ts` and diffed against every `/admin/...` URL
in `frontend/src/lib/*.ts`. Three real gaps, four deliberate skips.

**Fixed — `memberUpdate` (`lib/api.ts`).** Confirmed live bug, and worse than
reported: the client did send `name`. A member's name is stored three ways
(`name`, `first_name`, `last_name`) and every screen prefers the pair — see
`MEMBER_NAME_SQL` in `routes/member/community.ts:199` and
`pages/admin/Members.tsx:83`, both `COALESCE(first + last, name)`. So
`Members.tsx:382` seeding the box with the *pair* and saving it as `name` wrote a
column nothing displays: the toast said "Saved" and the table did not change.
`memberUpdate` now accepts `firstName`, `lastName` and `timezone` (all of which
the backend already accepted), and a shared `withSplitName` fills the pair in
from a whole name unless the caller passes the halves itself. Splitting on the
first space is wrong for some names and right for nearly all, and is only ever
used to keep the pair agreeing with what was typed.

**Fixed — admin sign-out never ended the session.** `POST /admin/logout` had no
client at all, and `hooks/useAuth.tsx` "signed out" by dropping the token from
this browser only. The server session row stayed live until it expired: it kept
appearing on the admin's own "where you're signed in" list as though the laptop
were still open, and any copy of the token taken before the sign-out still
worked. Added `adminApi.logout()` and called it from `logout()` — started
*before* `clearToken()`, since that is where the request picks up the token it is
asking the server to revoke, and deliberately not awaited so a failed call
cannot keep somebody signed in.

**Added — `eventUpdate` (`lib/api.ts`).** `PUT /admin/community/events/:eventId`
had no client. Without it the only way to move a community event an hour later
is delete-and-recreate, which drops every RSVP. Named in the queue, so added; the
events tab in `pages/admin/CommunityDetail.tsx` still offers create and delete
only, and wiring an edit form there is outside this pass's ownership.

**Deliberately skipped — no screen needs them, and their absence is not a live
bug:**

- `POST|PUT|DELETE /admin/redirects` and `POST /admin/redirects/not-found/:id/dismiss`
  — there is no redirects screen in `pages/admin/` at all. Wrapping four
  endpoints no page can call would be dead code; the missing thing is the page.
- `POST /admin/offers/:id/grant` and `/revoke` — manual access grant/revoke.
  `Offers.tsx` offers archive, not grant; no screen asks for these.
- `DELETE /admin/offers/:id` — `Offers.tsx:184` deliberately archives instead of
  deleting, which is the right behaviour for something money has moved through.

Nothing else in the admin surface is missing a client: every other write route
across all thirty-eight admin routers already has one.

### 4. Contacts list truncation
**Not confirmed — the claim is stale.** `lib/contactsApi.ts` contains no cap of
any kind; `ContactFilters` carries both `page` and `limit`, and the backend
(`routes/admin/contacts.ts:113`) accepts `limit` up to 200 with an `OFFSET`-based
`page`. `pages/admin/Contacts.tsx:46` asks for 200 and, at line 543, already
tells Yvette in plain words when there are more: *"Showing the first N of M
people. Narrow it…"*. Nothing shows a truncated list as though it were complete,
so no change was made here.

**Reported, not fixed** (outside this pass's ownership): `Contacts.tsx` never
sends `page`, so it is stuck on the first 200 and the only way to reach person
201 is to narrow the search. The client supports paging already — the screen just
needs a control wired to it.

### 5. `entry-client.tsx` preload with no `.catch`
**Fixed, against the previous reviewer's decision to leave it, because the
failure mode is real and total.** A browser holding a cached copy of the old
`index.html` after a deploy requests a chunk hash that no longer exists. The
dynamic import rejects, `preloadPublicRoute` rejects with it, and the `.then`
never runs — so `hydrateRoot` is *never called*. The visitor is left looking at
correct server markup that is completely inert: no menu opens, no button works,
no client navigation happens, and the only trace is an unhandled rejection in a
console she will never open. Hydrating anyway is strictly the lesser failure —
React re-renders the page itself, and the worst case degrades to a loading state
that one refresh (which fetches a current `index.html`) clears.

### Out of scope, verified rather than changed
The two-step sign-in control in `pages/admin/AdminUsers.tsx` stays **disabled**.
The backend accepts a code at sign-in but nothing in `lib/api.ts`, `useAuth` or
`Login.tsx` sends one, so switching it on would lock Yvette out permanently at
her next sign-in. What was wrong was how it *read*: the badge said "Off" beside a
button that did nothing, which is indistinguishable from a broken screen. The
badge now says "Coming soon" and the note beneath it says "We're still building
this one — there's nothing for you to do, and we'll let you know the moment you
can switch it on." Both, and the `disabled` attribute, now hang off one
`MFA_SELF_ENROLMENT_READY` flag, so whoever builds the code box flips a single
constant and cannot leave the label disagreeing with the button.
