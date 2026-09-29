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
- The admin API sits behind nginx basic auth, so the admin views were checked through the
  live database and the deployed bundle, not a browser session.

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
