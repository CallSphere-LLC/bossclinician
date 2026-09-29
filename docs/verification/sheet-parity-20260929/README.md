# Bug sheet, Kajabi-parity rows — 2026-09-29

Scope: [Bugs rows 32–40](https://docs.google.com/spreadsheets/d/13RTFcjDK5omngi_MalSxNNNgd4DQt8HumCBu0YnVdCs/edit#gid=0)
(the undated rows at the bottom, plus the Quinn Ford row). Release `20260929130457-787170d`;
migrations 078–082 applied at 13:06 UTC. Kajabi admin was not reachable this session, so every
change comes from the Kajabi contacts export, the `purchases` backfill, Kajabi's public pages and
feeds, or the owner's text on the sheet's "Updates & Discussion" tab. Nothing was invented.
No emails, notifications or Stripe calls: every job created since the changes is a routine
scheduled job.

| Row | Report | Valid? | Status |
| --- | --- | --- | --- |
| 32 | Quinn Ford's "[PIF] PPP Boss Builders $3997" not in admin | True, fixed 09-28 | Re-checked: `purchases` 216, order #1001, Jul 15, $0. Open: coupon code, "The Boss Move" access (see below) |
| 33 | Coaching content differs from Kajabi | True | Fixed |
| 34 | Coaching "Sessions" and "Programs" tabs look the same | True | Fixed |
| 35 | Coaching clients not mapped from Kajabi | True | Fixed |
| 36 | Community shows dummy data | True | Fixed; Kajabi posts/channels blocked |
| 37 | Courses differ from Kajabi | True | Fixed |
| 38 | Content inside each course differs | True | Test content removed; lesson bodies blocked |
| 39 | Podcast differs from Kajabi | True | Fixed |
| 40 | Offers differ from Kajabi | True | Fixed; price conflicts left for the owner |

## Coaching (33–35) — migration 078

- The only program was a dev fixture ("90-day practice accelerator", "Test description.", a
  personal Calendly link). Archived; its single test booking (a developer account) deleted.
- Programs now: Boss Clinician Club — 6-Month Coaching Program (Kajabi "The Boss Move"),
  Boss Clinician Boardroom — Mastermind, Practice Reset Intensive and Scale and Reclaim Suite
  (both drafts: 1:1 work is paused per `site.ts`). Descriptions are the owner's text; lengths and
  prices from bossclinician.com/work-with-me and /club.
- Tabs are Programs / Clients / Booked sessions, each with a one-line explanation.
- New `coaching_enrollments` (roster only, grants nothing): 30 rows, 29 people — Practice Reset
  Intensive 25, Club 5 — from the Kajabi "Bought:" tags. Kajabi clients carry a "from Kajabi"
  badge and no "sessions used" figure, because that history lives in Kajabi.
- The roster includes Kajabi's own test/owner accounts, because Kajabi's list has them too.

## Community (36) — migration 079

- Dummy rows were in the database, not the code. Archived "unicorn community" (a 09-19 QA
  fixture); deleted the empty test access group, "ZZ Badge — Test" and "test event";
  unpublished the expired empty challenge. New archive/restore in the admin list.
- The Lounge set to paid (a monthly membership in Kajabi; it had 0 members).
- Added archived "Boss Clinician Boss Builders Community" with its 4 Kajabi holders.
- "The Boss" has no Kajabi counterpart but was really used (Office Hours live room), so it stays.

## Courses (37–38) — migration 082

- The 14 published catalog items already matched bossclinician.com/all-courses.
- Archived test fixture product 25. Added draft shells for The Boss Move, Profitable Private
  Practices: Training For Clinically-Aligned Private Practices, and (archived) Leap Accelerator.
  Text comes from their public pages only; no modules.
- Removed test modules from Directory Makeover Audit ("test 1", "Clinician test") and Practice
  Reset Intensive ("ZZ Test — Module 1"). Renamed a lesson to "The Boss Biller Blueprint"
  (as /credentialsolo names it). Added the three video lesson titles Starter Suite's sales page
  lists, as unpublished empty lessons.

## Podcast (39) — migration 080

- Imported Kajabi's public show "Lyrical Reflections" from its RSS feed: artwork, trailer and
  episodes 1–8, with notes, dates and durations. The audio is re-hosted on this site (and S3), with
  byte-identical sizes. Script: `podcast-import-kajabi.py` (idempotent).
- Kajabi's URLs `/podcasts/lyrical-reflections[/episodes/<id>]` now serve a public page here
  instead of redirecting to /blog. The RSS keeps Kajabi's episode guids. The fixture "The Boss
  Clinician Show" is unpublished.

## Offers (40) — migration 081

- Source: Kajabi's public checkout data for all 25 live offers linked from its store, catalog
  and sales pages.
- 14 matched offers take Kajabi's titles and checkout copy. Checkout now keeps line breaks.
- 7 missing offers added as drafts with Kajabi's prices: The Club, both Lounge tiers, Practice
  Reset Intensive, Scale and Reclaim Suite, The Boss Boardroom, Private Practice Blueprint-VIP.
- Archived "ZZ Test — checkout probe" and the archived PPP Collective offer.
- Admin "Bought by" now counts Kajabi buyers (Credentialing Success Formula: 21).

## Live checks after deploy

- Migrations 078–082 are in `schema_migrations`.
- `/podcasts/lyrical-reflections` and its episode 2148691037 return 200.
  `/api/podcast/lyrical-reflections` returns 9 episodes; the sitemap lists 10 podcast URLs.
- `/api/courses` returns 14; `/api/courses/the-boss-move` returns 404.
  Directory Makeover Audit has 0 modules.
- `/api/offers/zz-test-checkout-probe` returns 404. Offers: 13 published, 8 draft, 2 archived.
- Coaching: 5 programs (fixture archived); client counts Club 5, Practice Reset Intensive 25.
- Communities: The Boss and The Lounge active; unicorn and Boss Builders archived.
- The deployed AdminApp bundle contains the new "Booked sessions" and "from Kajabi" UI.
- Admin routes, run inside the deployed backend container with an owner context (nginx basic
  auth blocks them from outside, and `backend/.env` ADMIN_PASSWORD no longer matches the live
  login): coaching offers 4 (5 with `?archived=1`), roster 29 clients all with Kajabi-sourced
  programs and `sessionsIncluded: null`, 0 booked sessions; community list The Lounge + The Boss
  (4 with archived); offers 23, offer 19 `purchaseCount` 21. No page was opened in a browser.
- The Lounge going paid locks out no one: its only Kajabi buyer (Lounge VIP, 2026-03-10) was
  refunded with access revoked.

## Blocked on Kajabi admin access (export or a signed-in session)

- Lesson bodies and videos. Nine courses have no curriculum here: Credentialing Success Formula,
  Ramp-Up Rate Formula, Protection Pack, Rate Negotiation Letter Template, Prepare to Profit
  Journal, Scale and Reclaim, Practice Reset Intensive, Directory Makeover Audit, Boardroom.
  The Boss Move's modules are missing too. Credential With Confidence's post-test and certificate,
  and 2 bonus PDFs, are also missing.
- The Lounge's channels, posts and roster.
- Coaching sessions used per client and program end dates.
- Offers that only appear in Kajabi purchase records (e.g. Protect Your Practice Training,
  Do's and Don'ts of Documentation, Boss Clinician Elite).
- Quinn Ford's coupon code, and granting "The Boss Move" access to its 5 holders.

## Owner decisions (left as they were)

- Credentialing Success Formula $247 / Credential With Confidence $127 (owner, migration 073)
  vs Kajabi's $17 / $27.
- Provider Partnership Guide: Kajabi checkout $47 vs sales page and here $97.
- Boardroom: $12,000 / 24 sessions (Kajabi offer) vs $18,000 (owner's Boardroom page).
- The Club's checkout copy has Kajabi's own "[LINK]" placeholder to fill before publishing.

# Rows 41–43 (added 29-Sep) — release `20260929182043-626ced5`

| Row | Report | Valid? | Status |
| --- | --- | --- | --- |
| 41 | Kajabi's two Lounge access groups not in our community page | True (The Lounge had 0 groups) | Fixed |
| 42 | Access-group pricing types differ from Kajabi | True (no Multiple payments, no trial) | Fixed |
| 43 | Web calling not visible on the community page | True (it existed but was hidden; off for The Lounge) | Fixed |

- **41, migration 083:** "Boss Clinician Lounge" (owner's Lounge description) is linked to the existing draft
  Kajabi offer 40 "The Lounge | Boss Clinician" ($1,997 or 6 × $197), so buying it grants The Lounge and
  the group. "How to Improve Relations" has no description or price because no source gives one. The offer
  stays a draft. No duplicate offer, no Stripe calls. Backup: `backups/sheet-parity-20260929/access-groups-before.sql`.
- **42:** Access is now Free or Paid, as in Kajabi. Paid means One-time payment, Subscription (monthly or yearly,
  with an optional free trial) or Multiple payments (count, amount per payment, frequency). Each is wired to the
  group's real offer and checkout. Repricing or deleting a group linked to an existing offer no longer rewrites
  or archives that offer. The member sidebar shows "6 × $197.00 / month" and trial days.
- **43, migration 084:** a "Live video call" card with Start/Join/Back-to-call sits at the top of every
  community page, including on phones (it used to be a small "Office Hours" link at the bottom of the sidebar).
  The room link is first in the sidebar. The admin has a header "Start or join the call" button and a Live room
  tab. The live room is now on for The Boss and The Lounge. Checked on a copy of production with headless
  Chromium: two members joined, and each received both video streams with TURN credentials issued.
  A call between two different networks has not been tested.

Live after deploy: 083/084 applied; admin `/community/14/access-groups` returns both groups (Lounge: $1,997,
"$197.00 every month for 6 months ($1,182 total)", checkout draft); communities 2 and 14 `live_room_enabled`;
the deployed bundles contain the new call and pricing UI; only routine scheduled jobs ran.

Open: VIP offer 41's group mapping, the description and price of "How to Improve Relations", and
whether The Lounge is a monthly subscription (Kajabi FAQ) or $1,997 / 6 × $197 (current offer). These need
Kajabi admin access or the owner.

# Second pass with the Kajabi admin open — releases `20260929195945-ea26dbd`, `20260929200839-709afda`

The first pass had no Kajabi admin access. This pass read the Kajabi admin in the owner's
signed-in Chrome (read-only: nothing was saved in Kajabi) and fixed what differed. Offer titles,
prices and copy come from Kajabi's public checkout API and checkout pages, fetched by the server.
Migrations 085–088. No emails, no Stripe calls. DB backups: `/var/backups/bossclinician/pre-k3s-20260929195945-ea26dbd.dump`
and `pre-k3s-20260929200839-709afda.dump`.

| Row | Kajabi admin says | Now |
| --- | --- | --- |
| 32 | Order #1001: [PIF] PPP Boss Builders $3,997, coupon **4UQUINN** −$3,997, total $0; product The Boss Move | Coupon + order summary on the purchase; The Boss Move granted to its 5 Kajabi holders (product still a draft) |
| 33 | The Boss Move = the Club (first lesson "Welcome to the Boss Clinician Club"); Boardroom $12,000 or $3,000 every 3 months | Club offer grants The Boss Move; Boardroom quarterly option added |
| 35 | Only Practice Reset Intensive has clients: 25, "Completed X of N sessions" | Program progress column (086) seeded from Kajabi |
| 36 | The Lounge: 1 member, **no posts** (chat = 9 automatic meetup invites); channels Boss Clinician Lounge (chat) + Q&A, Q&A in "how to improve relations"; meetup "Monthly Coaching Calls" every month on the 9th, 10:00 PT, live room | Channels added; repeating community meetups (087) + that meetup; fixture "Wins" channel removed |
| 37 | 24 products | The Practice Elevation, The Lounge VIP, Supervisory Billing Documentation Packet, The Private Practice Planner added as drafts |
| 38 | Real content is large: The Boss Move 8 modules/~55 lessons, The Practice Elevation 6/~110, Lounge VIP 1/5, plus CSF, CWC, Starter Suite, Ramp-Up, PPP Training and 10 downloads | **Still open** — see below |
| 40 | 48 offers (6 Kajabi tests); admin list uses internal titles | Internal title (085) in the admin list; 15 missing offers added as drafts; protection pack = Kajabi's published offer; purchases linked by internal title (4 deleted/test Kajabi titles stay unlinked) |
| 41 | "how to improve relations" is **free**; Lounge = $1,997 or $197/mo × 6 (already right); Lounge VIP grants The Lounge VIP + The Practice Elevation | Free offer for the group (left as a draft here); Lounge/Lounge VIP offers grant Kajabi's products |

**Row 38 blocker (changed):** Kajabi admin access is no longer the problem. Copying lesson bodies,
videos and files needs a bulk transfer out of the Kajabi session; the automated route from the
browser tab was refused by the session's safety check, so it is waiting on the owner's decision
on how to move the content.

**Owner decisions:** CSF $247 vs $17, CWC $127 vs $27, Provider Partnership $97 vs $47; Boardroom
$12,000 (Kajabi) vs $18,000 (owner page); whether to publish any of the new drafts; Bali rooms'
$500 deposit can't be charged here yet (no setup-fee support); Kajabi's own "On-Demnad" typo kept.

**Not done, flagged:** Kajabi buyers mostly have no `access_grants` here (19 grants vs 224 Kajabi
purchases), so they can't see what they bought in the rebuild.
