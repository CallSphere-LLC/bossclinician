# Admin dashboard — hostile correctness review

Scope: `frontend/src/pages/admin/**` (there is no `frontend/src/components/admin/`).
Every screen was read in full and checked against the backend admin route and
zod schema it actually talks to. Only defects traceable to a concrete
"she clicks X → Y happens" are listed; everything unsubstantiated was dropped.

The single reader of this console is Yvette, the non-technical owner, so
"silently fails to save", "loses her work", "shows a machine message" and
"promises something that does not happen" are all real defects here.

`npx tsc -b --noEmit --force` passes after every change below.

Counts: 4 critical · 12 high · 15 medium · 6 low fixed; 9 cross-boundary items
recorded and not touched.

---

## Critical

### C1 — Turning on two-step sign-in locks her out of her own admin, permanently
`frontend/src/pages/admin/AdminUsers.tsx:186`

Settings → Who can get in → **Turn it on**, scan the code, "Two-step sign-in is
on". Next sign-in, `adminApi.login` (`frontend/src/lib/api.ts:191`) sends only
email and password; the server sees `mfa_enabled` and answers
`401 { mfaRequired: true }` (`backend/src/routes/admin/auth.ts:59-64`);
`Login.tsx:32` shows "That email or password doesn't match." There is no box for
the code and none for a recovery code. She is locked out with no way back short
of a psql prompt. The file's own header comment says nobody should switch it on
yet — the button was live anyway.

**Fixed:** the control is disabled with a plain line ("We're still finishing this
one off — you'll be able to switch it on soon."). Enrolment handler and modal
stay wired for when sign-in learns to ask for the code (see X1).

### C2 — No file could ever be attached to a download product
`frontend/src/pages/admin/ProductsCatalog.tsx:759,762`

Download product → **Add files** → drop a PDF. Green toast "contracts.pdf is in
your files", then red "Something in that form needs fixing — check the
highlighted fields", and the file never appears. Two independent payload
mismatches: `storagePath` was sent as `asset.filename` (the bare key) while
`assertProtectedFile` (`backend/src/routes/admin/products.ts:487-495`) requires
the stored reference `protected:…` that `media.ts:262` writes into `asset.url`;
and `sizeBytes` arrives from a `BIGINT` column as a **string**, which
`commerceSchemas.ts:346` (`z.number().int()`) rejects. Every download product
stayed empty, and anyone buying one received nothing.

**Fixed:** send `asset.url` and `Number(asset.sizeBytes)`.

### C3 — A coaching session was saved four to five hours away from the time she picked
`frontend/src/pages/admin/Coaching.tsx:572`

The box showed `String(scheduledAt).slice(0, 16)` — the UTC clock — inside a
`datetime-local` input, which means local time, and sent back what she typed
without converting. She books a client for 2:00 PM; the row underneath says
10:00 AM and so does the client's portal. Re-opening a 3:00 PM session shows
7:00 PM.

**Fixed:** converted on both edges through two new shared helpers,
`toDateTimeInput` / `fromDateTimeInput` (`ui/friendly.ts`).

### C4 — A "paying members only" newsletter sent to the whole free list
`frontend/src/pages/admin/Newsletters.tsx:300`

The plan dropdown had no `required` and the save had no guard, so
`access: "paid"` with `planId: null` saved happily. `growth.ts:158-165` treats a
null plan as "everybody": `issue.access === "paid" && issue.plan_id ? <paid> :
SELECT email FROM subscribers`. The send confirmation still read "This goes to
everyone paying for the plan you linked." Paid-only content, to the free list,
irreversibly.

**Fixed:** the save refuses with "Choose which paid plan unlocks this
newsletter." A backend belt-and-braces refusal is recorded as X4.

---

## High

### H1 — Every plain-English refusal the server wrote for her was thrown away
`frontend/src/pages/admin/ui/friendly.ts:139`

`friendlyError` replaced every 400/422 with "Something in that form needs
fixing — check the highlighted fields", on screens with no form and nothing
highlighted. The messages discarded include "You already have a tag with that
name" (`tags.ts:73`), "Add a subject before sending" (`growth.ts:242`), "People
are part-way through this sequence. Pause it first" (`sequences.ts:213`), "That
video was uploaded for everyone… Upload it again and choose 'only people who
bought it'" (`curriculum.ts:82`), "A live event needs the date and time it
happens" (`events.ts:76`). Four of the six reviewers hit this independently.

**Fixed:** the server's sentence wins when it reads like English; anything
starting "Invalid" (the parser talking) still falls back to the generic line.

### H2 — A permission refusal told her she had been signed out
`frontend/src/pages/admin/ui/friendly.ts:133`

403 was lumped in with 401, so any refusal read "You've been signed out — please
sign in again." Signing in again changes nothing; the loop cannot end.

**Fixed:** 403 now reads "Your account isn't allowed to do that."

### H3 — A partner commission above $9.99 could not be typed
`frontend/src/pages/admin/AffiliateDetail.tsx:399`, and the same shape at
`frontend/src/pages/admin/Affiliates.tsx:902`

The money box was `value={(cents / 100).toFixed(2)}`, re-derived on every
keystroke: type `5`, the box becomes `5.00` with the caret at the end, and the
next digit lands after the decimal point. No sequence of keys produced $50. The
percentage boxes erased the `.` as she typed it, so 30.5% was impossible too.

**Fixed:** both screens hold what she is typing as text and convert once, on
save — the pattern already used by `CoursesAdmin.tsx:56`. A share above 100 is
now refused on screen rather than by the parser
(`backend/src/routes/admin/affiliates.ts:920`).

### H4 — A community event was advertised four to five hours early, and could not be corrected
`frontend/src/pages/admin/CommunityDetail.tsx:960` and
`frontend/src/pages/admin/Events.tsx:96`

`datetime-local` text went straight into a `TIMESTAMPTZ`
(`backend/src/routes/admin/community.ts:521`) and was read as UTC. She schedules
the Q&A for 7:00 PM; the list under the toast, and every member's calendar, say
3:00 PM.

**Fixed:** converted on write (and on read where the value is shown back). There
is still no update endpoint for a community event — recorded as X5.

### H5 — A challenge shut a day early
`frontend/src/pages/admin/CommunityDetail.tsx:732`

Date-only boxes were sent raw and stored as midnight UTC. A sprint she set for
the 18th–28th displayed as "Aug 17, 8:00 PM to Aug 27, 8:00 PM", and a member
submitting on the morning of the 28th was refused with "This challenge has
closed." (`backend/src/routes/member/community.ts:1541`).

**Fixed:** `fromDateInput(day)` / `fromDateInput(day, "end")` — a day she picked
is a day where she is, and an end date means the end of that day.

### H6 — Removing a member from a community, deleting an event or a badge fired on one click
`frontend/src/pages/admin/CommunityDetail.tsx:537,970,1134`

A mis-aimed click on the bin next to a paying member's row revoked her access
immediately, with a toast and no way back except re-adding her and losing her
points. The same file already confirms post deletion, so this was an omission,
not a policy.

**Fixed:** all three go through `useConfirm` with wording that says what is lost.

### H7 — "Turning it off means people stop getting it altogether" was false
`frontend/src/pages/admin/EmailTemplates.tsx:204`

Unticking "Send this email" makes `templateStore.ts:43` return null, and
`withStoredTemplate` then sends the **shipped** wording. She unticks it to stop
receipts; receipts keep going out, in the words she was trying to replace.

**Fixed:** the line now says what actually happens.

### H8 — Two live Automations screens, one of which silently broke the other's automations
`frontend/src/pages/admin/ui/nav.ts:99`

Both screens read and write `automations` + `automation_actions`. Conditions
built in the new builder are `{match, rules:[…]}`; the old screen renders them
through `String(value)` ("Only when rules is “[object Object]”",
`Automations.tsx:207`) and, on save, writes that string back. `evaluateConditions`
(`engineV2.ts:252-269`) then fails its parse, falls to the legacy branch, returns
false, and the automation stops firing for everybody with no error anywhere.

**Fixed:** the old screen is no longer in the menu (the route still works for
anyone who has the address). "(old)" was also the only version number on screen.

### H9 — Saving a funnel, a show or a newsletter looked like it had not worked
`frontend/src/pages/admin/Funnels.tsx:195`, `Podcasts.tsx:315`,
`Newsletters.tsx:279`

All three did `setActive((prev) => prev ?? list[0])`, so after a save the
refreshed row was never adopted. She ticks "Live on my site", saves, and the
panel still says "This funnel isn't live yet". Worse on newsletters: `send()`
read the stale `access`, so a paid-gated edition was confirmed with "This goes
to everyone on your list".

**Fixed:** all three re-read by id.

### H10 — "Save this answer to → a detail of your own" could never be saved
`frontend/src/pages/admin/FormBuilder.tsx:518`

The box prefills with the question's own wording, and
`backend/src/routes/admin/formsV2.ts:150-154` only accepts a single lower-case
word. Every value with a space or a capital — including the screen's own
placeholder — was refused. The whole feature was unreachable.

**Fixed:** the typed wording is turned into a stored key with `fieldKey` on save.

### H11 — Website Details silently reverted settings saved on other screens
`frontend/src/pages/admin/Settings.tsx:215`

`buildPayload` started from `{ ...loaded }` — every key `GET /admin/settings`
returned, including the email and payments groups — and PUT the lot, and the
route replaces per key (`settings.ts:28-34`). Saving her Instagram handle in a
tab left open since morning wrote back a morning-old snapshot of everything else.

**Fixed:** the payload now carries only what this screen owns.

### H12 — Both picture pickers offered files nobody can see
`frontend/src/pages/admin/BlogEditor.tsx:744` and `CrudManager.tsx:572`

The grid listed buyers-only uploads, whose `url` is the literal string
`protected:ab12.png` — a blank tile — and stored that string on the record. The
save was then always refused (`presentationImage`, `schemas.ts:14-22`) and the
refusal reached her as the form message from H1.

**Fixed:** protected files are left out of both pickers, and tiles render
`previewUrl`, which is the field the type has always told callers to use.

---

## Medium

### M1 — The Pages screen promised the website would pick up her words
`frontend/src/pages/admin/PagesAdmin.tsx:273`

The save is real and correct against `pages.ts`, but nothing reads it:
`api.page()` has no call sites, there is no SSR key, and every public page
imports its copy from `@/content/site`. She rewrites a headline, reads "Your site
picks up what you save here the next time it's published", and the site never
changes.

**Fixed:** the description and the toast now say it is a draft, not live, and
name what has to happen next.

### M2 — Switching pages threw away unsaved edits while the badge said "Unsaved changes"
`frontend/src/pages/admin/PagesAdmin.tsx:306` — **fixed** with a confirm.

### M3 — Leaving an offer or a form threw away everything typed
`frontend/src/pages/admin/OfferEditor.tsx:645`, `FormBuilder.tsx:835`

Six tabs of offer, or a rebuilt set of questions, gone on one click of "All
offers" / "All forms", with no prompt. **Fixed:** both check their own `dirty`
flag first.

### M4 — A stray click outside any editor dialog destroyed the draft
`frontend/src/pages/admin/ui/Dialog.tsx:39`

Radix dismisses on an outside click by default, and every call site closes by
nulling the draft — a 600-word campaign, an 8-row announcement, a half-written
testimonial. **Fixed:** an outside click no longer dismisses. Escape and the
close button (labelled "Close without saving") still cancel; both are deliberate.

### M5 — "Write me a first draft" overwrote the article she had already written
`frontend/src/pages/admin/BlogEditor.tsx:320` — no warning, nothing saved,
nothing to undo; and a reply without tags threw *after* the form had been
replaced, so she was told the draft had failed and lost her article anyway.
**Fixed:** it asks first, and reads the reply before touching the form.

### M6 — Deleting an automation step had no confirmation
`frontend/src/pages/admin/Automations.tsx:691` — the step holds the whole message
she wrote. **Fixed** with the same confirm the new builder uses.

### M7 — "Send to 0 people" on a send that goes to everyone
`frontend/src/pages/admin/Campaigns.tsx:323` — a failed audience lookup was
caught as `0`, so the dialog and the button both said nobody, while the server
resolves the real audience itself and mails the list. **Fixed:** a failed lookup
now stops the send with a plain message.

### M8 — Removed members kept a full menu of actions the server rejects
`frontend/src/pages/admin/Members.tsx:646` — a removed member with orders is
anonymised in place and stays in the list. Every action on it 400s
(`assertNotDeleted`, `members.ts:139`), which reached her as the form message
from H1. **Fixed:** the row shows "Nothing left to do".

### M9 — A money rule in the group builder stored a hundred times what she typed
`frontend/src/pages/admin/Segments.tsx:631` — "$497.50" became $49,750 because
the box was re-derived from cents on every keystroke and erased the decimal
point. **Fixed** with a typed-text draft that re-seeds when the row it belongs to
changes (the rows are keyed by position).

### M10 — The people search raced itself
`frontend/src/pages/admin/Contacts.tsx:252` — `load` returns a canceller that the
debounce discarded, so a slow "sam" landing after a fast "sam j" filled the table
with the wrong people and pruned her ticked rows against the wrong page.
**Fixed:** the canceller is kept and called.

### M11 — Field errors on the catalogue form were filed under a picker most kinds don't show
`frontend/src/pages/admin/ProductsCatalog.tsx:297` — every server correction was
re-keyed to `resource`, so a complaint about the picture rendered nowhere on a
download, and under "which course does this unlock" on a course. **Fixed:** the
map is kept, and the name and picture fields now render their own errors.

### M12 — A number the server caps was reported by the parser
`frontend/src/pages/admin/OfferEditor.tsx:1089,1123` — "How many payments in
total?" over 60 put "Number must be less than or equal to 60" under the box.
**Fixed:** clamped at both ends, matching `commerceSchemas.ts:397-398`.

### M13 — A testimonial or resource with no name failed with a message pointing at nothing
`frontend/src/pages/admin/CrudManager.tsx:222` — **fixed** with a named guard
("Fill in their name first.").

### M14 — The dashboard was permanently broken for every non-owner account
`frontend/src/pages/admin/Dashboard.tsx:84` — three requests in one `Promise.all`,
and Marketing/Support/Coach lack `orders.view` or `reports.view`, so the whole
screen showed "We couldn't load your dashboard" forever. **Fixed:** each request
stands or falls on its own; only a total failure is an error.

### M15 — A too-long report range collapsed the screen that could fix it
`frontend/src/pages/admin/ReportView.tsx:266` — the error branch unmounted the
date pickers, so there was nothing left to correct. **Fixed:** the notice renders
above the controls.

---

## Low

- **L1** `AcceptInvite.tsx:249` — the password box let through a password the
  server refuses (under 10 characters, `backend/src/auth/password.ts:31`).
  **Fixed** with `minLength={10}`.
- **L2** `AdminLayout.tsx:287` — the topbar search box was wired to nothing;
  typing and pressing Enter did nothing at all. **Removed.**
- **L3** `AdminLayout.tsx:42` — an unparseable value in browser storage threw
  during render on every load, with no screen and no way to clear it.
  **Guarded.**
- **L4** `ui/nav.ts:88` — two different screens were both labelled "Events"
  (community events vs. webinar registrations). **Relabelled.**
- **L5** `Dashboard.tsx:384,513,525` — the "Money you've kept" tile drew a
  skeleton that never resolved because its series is deliberately empty; the
  Lessons tile plotted daily revenue under a count of lessons, and the chat tile
  plotted email sign-ups. **Fixed:** an honest empty line, and no sparkline where
  nothing matching is collected.
- **L6** `Tags.tsx:353`, `Segments.tsx:817` — the heading claimed the full count
  while the list is capped at 50, so 320 people looked like 270 had vanished.
  **Fixed** with a "showing the first 50" line (raising the cap is X8).
- **L7** `Reports.tsx:110` — the download clicked a link never added to the
  document and revoked the file immediately, which is a button that silently
  produces nothing in Safari. **Fixed** by using the repo's own `saveCsv`.
- **L8** `CourseBuilder.tsx:379` — every lesson row drew a drag handle for
  reordering that does not exist. **Removed** rather than left as a control that
  does nothing.
- **L9** `Contacts.tsx:289` — "Choose everyone on this page" ticks all 200 loaded
  rows, not the 25 on screen. **Relabelled** "in this list".
- **L10** `ui/Uploader.tsx:107` — an unsupported file now reads "That kind of file
  can't be used here. Pictures work best as JPG or PNG, and videos as MP4."
  rather than "Unsupported file type: image/heic".
- **L11** `AutomationBuilder.tsx:821` — "only carry on if" could be added but had
  no editor, so it stored no conditions and let everybody through: a gate she
  believed she had set. **Hidden** until it has an editor (X6).

---

## Checked against the backend route and found correct

- **Offers** — `Offers.tsx` and `OfferEditor.tsx` payloads match `offerFields`,
  `offerUpdateSchema`, `bumpFields` and `upsellFields` field-for-field; slug and
  custom-field keys always satisfy their regexes; `choosePricing` clears exactly
  what `offerPricingIssue` forbids; every delete/archive is confirmed and wired
  to the row's own id; the upsell reorder parks a step in a free slot first
  because `(offer_id, step)` is unique.
- **Products** — `Products.tsx` is read-only; `ProductsCatalog.tsx` create/update
  payloads match `productFields`, and the "pick the thing this unlocks" check
  matches `productResourceIssue`.
- **Sequences / Automations (v2) / Email templates** — every payload matches
  `sequenceSchema`, `emailSchema`, `automationSchema`, `actionSchema`; `null`
  clears columns correctly through the `"x" in req.body` sentinels; reorder is
  server-authoritative so no row can swap on delete; "Try it out" correctly omits
  `live` so the run is a dry run.
- **Contacts / Tags / Segments / Leads / Subscribers / Conversations** — query
  parameter names, sort and status enums, `limit ≤ 200`, and every create,
  import, bulk-tag and merge body match their zod schemas; the merge direction is
  right; the lead status write is rolled back by a reload on failure.
- **Blog / Resources / Media / Sales pages** — payloads match `blogSchema`,
  `resourceSchema`, `pageUpdateSchema` and the sales routes; the media upload
  handshake (visibility before bytes, per-file abort, orphan cleanup, optimistic
  delete rolled back) is correct and is the model the pickers in H12 now follow.
- **Courses / Community / Events (v2)** — lesson and module payloads match
  `LESSON_FIELDS`; `EventsAdmin.tsx` is the one screen that already handled time
  correctly (two-pass, DST-safe, in the event's own stored zone) and its URLs,
  reorder and delete are all correct.
- **Forms / Assessments / Settings groups / Integrations / Affiliates routing /
  Reports** — payload shapes, mount paths and method verbs all match; question
  keys are generated once and never regenerated on rename, so renaming a label
  cannot orphan answers already collected; `SettingsGroup` merges rather than
  replaces, so no stored secret is wiped by an omitted field; `ReportView`'s
  "today" is the local calendar day and matches the server's, so no date desync.
- **Shared UI** — `Dialog`, `DataTable`, `primitives`, `friendly`, `StripeBanner`,
  `Charts`: table rows key on TanStack row ids rather than array indices, the
  confirm dialog resolves correctly on every dismissal path, and no screen in the
  console can put `[object Object]` or a stack trace in front of her.

---

## Cross-boundary (recorded, not touched)

1. **X1 — two-step sign-in cannot be finished from inside `pages/admin`.**
   `frontend/src/lib/api.ts:191` and `frontend/src/hooks/useAuth.tsx:47` need to
   carry an optional `code` and surface `{ mfaRequired: true }` (the server
   already sends it, `backend/src/routes/admin/auth.ts:63`) so `Login.tsx` can
   ask for the code and for a recovery code. Then re-enable C1.
2. **X2 — `formatDate` mis-renders a date-only string.**
   `frontend/src/lib/format.ts:35` parses `"2026-08-18"` as UTC midnight and
   prints it locally — "Aug 17" west of UTC. `shortDay` (:101) already appends
   `T00:00:00`; `formatDate` should do the same for a bare `YYYY-MM-DD`.
3. **X3 — editing a member's name saves nothing for most members.**
   `Members.tsx:382` sends `{ name }`, but `fullName()` prefers
   `firstName`/`lastName`, which every self-signup and purchase populates
   (`memberAuth.ts:388`, `fulfillment.ts:92`). The route accepts them
   (`members.ts:296-302`) but `adminApi.memberUpdate`'s type does not, so the fix
   needs `lib/api.ts:395` widened first.
4. **X4 — a paid newsletter with no plan should be refused server-side too.**
   `backend/src/routes/admin/growth.ts:158` falls back to every subscriber; it
   should refuse. C4 fixes the only door that exists today.
5. **X5 — a community event cannot be edited at all.** There is no `eventUpdate`
   in `lib/api.ts`; a wrong time can only be fixed by deleting and re-adding.
   Same for `moduleUpdate`, `channelUpdate`, `channelDelete`, `membershipUpdate`,
   `challengeUpdate`, `challengeDelete`, `postComments`, `commentDelete`,
   `communityUpdate` — all defined in `lib/api.ts` with no call site, so a
   section title typo is permanent unless she deletes the section and every
   lesson in it.
6. **X6 — the `branch` step has no editor.** Either give it one (the condition
   editor at `AutomationBuilder.tsx:557` is the obvious source) or drop it from
   `ACTION_DESCRIPTORS` (`backend/src/automations/engineV2.ts:135`). Hidden in
   the menu for now (L11).
7. **X7 — a zod rejection reaches her as a 500.**
   `backend/src/middleware/errorHandler.ts:34` has no `ZodError` branch, and
   several routers use throwing `.parse()` (`events.ts:108,195`,
   `formsV2.ts:180,260`, `assessments.ts` and `reports.ts` throughout). Typing
   `0` into "Longest answer" or "How long the recording stays up" tells her the
   problem is ours, not a number she can change.
8. **X8 — "See who has it" is capped at 50 rows.**
   `frontend/src/lib/contactsApi.ts:282,299` send no `limit`, so the backend
   default of 50 applies. L6 stops it reading as missing people; raising the cap
   is a change to that file.
9. **X9 — the admin has no permission awareness.** `ui/nav.ts` and `AdminApp.tsx`
   offer every module to every role while every backend router is gated, so a
   Coach or Support account is walked into refusals on most of the menu. H2 makes
   those refusals honest; filtering the nav by role is a separate piece of work
   and needs permissions exposed through `useAuth`.
10. **Already fixed by the backend owner during this pass (verified):** four of
    the six reviewers independently reported `requireRole("admin")` on the CRUD
    factory's DELETE excluding the `owner` role — every delete on blog,
    testimonials, resources, courses, forms, funnel stages, campaigns, podcasts
    and newsletters 403ing for Yvette. `grep -rn requireRole backend/src/routes`
    now finds only a comment: the route is gated at the mount by
    `requirePermission`, which owner passes. Also reported, and worth a separate
    check by whoever owns the backend: `backend/src/seed/seed.ts:22` seeds the
    first account as `'admin'` while migration 016 only promotes an account that
    already existed, so a freshly created database can leave Yvette without
    `admins.manage`.
